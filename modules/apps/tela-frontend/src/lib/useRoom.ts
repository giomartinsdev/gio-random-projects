import { useCallback, useEffect, useRef, useState } from "react";
import { readIdentity, rememberIdentity, wsUrl } from "./api";

// STUN for this browser's side of the connection. The server advertises
// its own reachable address directly (see the Go side's SFU_PUBLIC_IP),
// so there's no TURN here: on a network that blocks UDP outright the
// connection won't establish.
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

// Someone dropping off is usually a blip -- a reload, a moment of bad
// wifi, or this server being redeployed -- not someone leaving. Tearing
// their tile down the instant the WebSocket says they're gone turns a
// two-second gap into a visible interruption, so it waits.
const LEAVE_GRACE_MS = 12_000;

// Reconnect backoff. Starts fast because the common case is a deploy --
// a couple of seconds -- and backs off so a genuinely dead server isn't
// hammered.
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 8_000;

// 1080p120 -- gaming footage lives and dies by smoothness far more
// than a document/text share does, and every number here is a
// ceiling, not a promise: TWCC congestion control (see the Go side's
// sfu.go) backs the actual send rate off in real time on a connection
// that can't sustain this, same as it always has. The SFU forwards
// packets unchanged -- nothing is transcoded -- so whatever the
// browser encodes here is exactly what every viewer receives.
const SCREEN_CONSTRAINTS: MediaTrackConstraints = {
  frameRate: { ideal: 120, max: 120 },
  width: { max: 1920 },
  height: { max: 1080 },
};

const CAMERA_CONSTRAINTS: MediaTrackConstraints = {
  // Rear camera by default -- sharing a phone's camera is usually about
  // showing something, not yourself. `ideal` rather than `exact` so a
  // laptop with one webcam still works instead of throwing
  // OverconstrainedError.
  facingMode: { ideal: "environment" },
  frameRate: { max: 30 },
  width: { max: 1280 },
  height: { max: 720 },
};

// One upload, not one per viewer: the server fans the stream out, so
// this is a flat cost however many people are watching. That's the
// whole reason the SFU exists, and why this is no longer divided by the
// size of the audience.
//
// 10 Mbps is a real-world ceiling for 1080p120 fast-motion content
// (games), not an arbitrary round number -- Twitch/OBS's own guidance
// puts 1080p60 gaming at 6-9 Mbps, and 120fps needs more headroom on
// top of that even though total bits don't scale linearly with frame
// count (consecutive frames are similar, so the codec already exploits
// that). The old 2.5 Mbps was tuned for legible text in a screen
// share, the opposite workload.
const SCREEN_MAX_BITRATE = 10_000_000;
const CAMERA_MAX_BITRATE = 1_200_000;

export type Status = "connecting" | "connected" | "reconnecting" | "error" | "closed";
export type Source = "screen" | "camera";

export type Peer = { peerId: string; name: string; publishing: boolean };

// Mobile browsers -- iOS Safari and Chrome on Android alike -- don't
// implement getDisplayMedia: capturing a phone's screen from a web page
// isn't a thing. Checked once so the UI can offer the camera instead of
// a button that could only ever fail.
export const canShareScreen =
  typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";

export const canShareCamera =
  typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";

// Two peer connections with the server, and that's all, however many
// people are in the room:
//
//   publish   -- this browser's own stream going up. Created when you
//                start sharing; this side offers, because it's the one
//                that knows what it's about to send.
//   subscribe -- everyone else's streams coming down, multiplexed. The
//                SERVER offers on this one, since tracks appear and
//                vanish as people start and stop sharing.
//
// The mesh this replaced needed a connection per person and made the
// publisher encode separately for each of them, which is why a second
// viewer used to halve the framerate.
export function useRoom(roomId: string, password: string) {
  const [status, setStatus] = useState<Status>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [you, setYou] = useState<{ peerId: string; name: string } | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [sendingAudio, setSendingAudio] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const publishRef = useRef<RTCPeerConnection | null>(null);
  const subscribeRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingLeaveRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Read inside the WebSocket callbacks, which are created once and
  // would otherwise close over stale values.
  const sendingAudioRef = useRef(true);
  sendingAudioRef.current = sendingAudio;
  const sourceRef = useRef<Source | null>(null);
  sourceRef.current = source;
  const remoteStreamsRef = useRef<Record<string, MediaStream>>({});
  remoteStreamsRef.current = remoteStreams;

  const send = useCallback((payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const cancelPendingLeave = useCallback((peerId: string) => {
    const timer = pendingLeaveRef.current.get(peerId);
    if (timer) {
      clearTimeout(timer);
      pendingLeaveRef.current.delete(peerId);
    }
  }, []);

  const dropRemote = useCallback((peerId: string) => {
    setRemoteStreams((current) => {
      if (!(peerId in current)) return current;
      const next = { ...current };
      delete next[peerId];
      return next;
    });
  }, []);

  // --- publishing ---

  // Caps what this browser sends and tells the encoder what to give up
  // when it can't keep up. Both sources now prefer smooth motion over
  // sharpness: a screen share used to mean mostly static text/docs
  // (where a soft frame drop is worse than a slightly blurrier
  // picture), but 120fps game footage is the opposite -- a stutter is
  // far more noticeable than the encoder shaving resolution to keep up.
  const applyEncodingLimits = useCallback((pc: RTCPeerConnection) => {
    const screen = sourceRef.current !== "camera";
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== "video") continue;
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0].maxBitrate = screen ? SCREEN_MAX_BITRATE : CAMERA_MAX_BITRATE;
      params.degradationPreference = "maintain-framerate";
      // Best-effort: not every browser accepts every field, and a
      // rejected tuning shouldn't break the connection.
      sender.setParameters(params).catch(() => {});
    }
  }, []);

  const stopSharing = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setSource(null);
    sourceRef.current = null;
    publishRef.current?.close();
    publishRef.current = null;
    send({ type: "publish:stop" });
  }, [send]);

  const startSharing = useCallback(
    async (from: Source) => {
      setErrorMessage(null);
      let stream: MediaStream;
      try {
        stream =
          from === "screen"
            ? await navigator.mediaDevices.getDisplayMedia({ video: SCREEN_CONSTRAINTS, audio: true })
            : await navigator.mediaDevices.getUserMedia({ video: CAMERA_CONSTRAINTS, audio: true });
      } catch (err) {
        const name = err instanceof Error ? err.name : "Error";
        // Dismissing the picker is a normal thing to do, not an error.
        if (name !== "NotAllowedError" && name !== "AbortError") {
          setErrorMessage(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
        }
        return;
      }

      // Tells the encoder what this footage actually is: "detail" keeps
      // text sharp on a shared screen at the cost of framerate, "motion"
      // does the opposite for a camera.
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) videoTrack.contentHint = from === "screen" ? "detail" : "motion";
      // getDisplayMedia only yields audio if the person also ticked
      // "share audio", so there may be nothing here to disable.
      for (const track of stream.getAudioTracks()) track.enabled = sendingAudioRef.current;

      localStreamRef.current = stream;
      setLocalStream(stream);
      setSource(from);
      sourceRef.current = from;
      // The browser's own "Stop sharing" bar ends the track.
      videoTrack?.addEventListener("ended", () => stopSharing());

      // Replace rather than stack, so switching from screen to camera
      // doesn't leave the previous connection running.
      publishRef.current?.close();
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      publishRef.current = pc;

      for (const track of stream.getTracks()) pc.addTrack(track, stream);
      applyEncodingLimits(pc);
      pc.onicecandidate = (ev) => {
        if (ev.candidate) send({ type: "publish:ice", candidate: ev.candidate.toJSON() });
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: "publish:offer", sdp: pc.localDescription });
    },
    [applyEncodingLimits, send, stopSharing],
  );

  const setAudio = useCallback((on: boolean) => {
    setSendingAudio(on);
    // Disabling the track sends silence, which needs no renegotiation;
    // removing it would mean rebuilding the publish connection.
    for (const track of localStreamRef.current?.getAudioTracks() ?? []) track.enabled = on;
  }, []);

  useEffect(() => {
    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed) return;

      // Reclaims the identity the server issued, so a reconnect slots
      // back into the room rather than arriving as a stranger.
      const saved = readIdentity(roomId);
      const ws = new WebSocket(
        wsUrl({
          room: roomId,
          password,
          ...(saved ? { peerId: saved.peerId, name: saved.name, resume: saved.resume } : {}),
        }),
      );
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setStatus("connected");
      };

      ws.onclose = () => {
        if (disposed) return;
        setStatus("reconnecting");
        // Jittered so a room full of people doesn't reconnect in
        // lockstep and stampede a server that just came back up.
        const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt);
        attempt++;
        retryTimer = setTimeout(connect, backoff * (0.5 + Math.random()));
      };

      ws.onerror = () => setStatus((s) => (s === "connecting" ? "error" : s));

      ws.onmessage = async (evt) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(evt.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case "welcome": {
            const myId = msg.peerId as string;
            const myName = msg.name as string;
            setYou({ peerId: myId, name: myName });
            rememberIdentity(roomId, { peerId: myId, name: myName, resume: (msg.resume as string) ?? "" });

            const list = (msg.peers as Peer[]) ?? [];
            setPeers(list);

            const present = new Set(list.map((p) => p.peerId));
            for (const id of [...pendingLeaveRef.current.keys()]) {
              if (present.has(id)) cancelPendingLeave(id);
            }
            for (const id of Object.keys(remoteStreamsRef.current)) {
              if (!present.has(id)) dropRemote(id);
            }

            // A restarted server has forgotten everything, this
            // browser's publish connection included -- so republish from
            // scratch. The receive side is re-offered by the server.
            if (localStreamRef.current && sourceRef.current) {
              subscribeRef.current?.close();
              subscribeRef.current = null;
              await startSharing(sourceRef.current).catch(() => {});
            }
            break;
          }

          case "peer:join": {
            const peer: Peer = { peerId: msg.peerId as string, name: msg.name as string, publishing: false };
            setPeers((current) => [...current.filter((p) => p.peerId !== peer.peerId), peer]);
            cancelPendingLeave(peer.peerId);
            break;
          }

          case "peer:leave": {
            const peerId = msg.peerId as string;
            setPeers((current) => current.filter((p) => p.peerId !== peerId));
            // Deferred rather than immediate -- see LEAVE_GRACE_MS.
            cancelPendingLeave(peerId);
            pendingLeaveRef.current.set(
              peerId,
              setTimeout(() => {
                pendingLeaveRef.current.delete(peerId);
                dropRemote(peerId);
              }, LEAVE_GRACE_MS),
            );
            break;
          }

          case "publish:start":
            setPeers((current) =>
              current.map((p) => (p.peerId === msg.peerId ? { ...p, publishing: true } : p)),
            );
            break;

          case "publish:stop": {
            const peerId = msg.peerId as string;
            setPeers((current) => current.map((p) => (p.peerId === peerId ? { ...p, publishing: false } : p)));
            dropRemote(peerId);
            break;
          }

          case "publish:answer": {
            const pc = publishRef.current;
            if (pc && msg.sdp) {
              await pc.setRemoteDescription(msg.sdp as RTCSessionDescriptionInit).catch(() => {});
            }
            break;
          }

          case "publish:ice": {
            const pc = publishRef.current;
            if (pc && msg.candidate) {
              await pc.addIceCandidate(msg.candidate as RTCIceCandidateInit).catch(() => {});
            }
            break;
          }

          case "publish:error":
            setErrorMessage((msg.error as string) ?? "não foi possível transmitir");
            break;

          // The server offers on the receive side, and re-offers every
          // time someone starts or stops sharing.
          case "subscribe:offer": {
            let pc = subscribeRef.current;
            if (!pc) {
              pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
              subscribeRef.current = pc;
              pc.onicecandidate = (ev) => {
                if (ev.candidate) send({ type: "subscribe:ice", candidate: ev.candidate.toJSON() });
              };
              pc.ontrack = (ev) => {
                // The SFU tags every outgoing track with the publisher's
                // peer id as its stream id, which is how a track is
                // matched back to the person it came from.
                const stream = ev.streams[0];
                if (!stream) return;
                setRemoteStreams((current) => ({ ...current, [stream.id]: stream }));
              };
            }
            await pc.setRemoteDescription(msg.sdp as RTCSessionDescriptionInit).catch(() => {});
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            send({ type: "subscribe:answer", sdp: pc.localDescription });
            break;
          }

          case "subscribe:ice": {
            const pc = subscribeRef.current;
            if (pc && msg.candidate) {
              await pc.addIceCandidate(msg.candidate as RTCIceCandidateInit).catch(() => {});
            }
            break;
          }
        }
      };
    };

    connect();

    // Leaving the room for real.
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      for (const timer of pendingLeaveRef.current.values()) clearTimeout(timer);
      pendingLeaveRef.current.clear();
      wsRef.current?.close();
      publishRef.current?.close();
      subscribeRef.current?.close();
      publishRef.current = null;
      subscribeRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
  }, [roomId, password, cancelPendingLeave, dropRemote, send, startSharing]);

  return {
    status,
    errorMessage,
    you,
    peers,
    remoteStreams,
    localStream,
    source,
    isSharing: localStream !== null,
    sendingAudio,
    setAudio,
    hasAudioTrack: (localStream?.getAudioTracks().length ?? 0) > 0,
    startSharing,
    stopSharing,
  };
}
