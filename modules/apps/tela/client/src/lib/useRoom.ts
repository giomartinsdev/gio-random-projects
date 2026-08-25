import { useCallback, useEffect, useRef, useState } from "react";
import { readIdentity, rememberIdentity, wsUrl } from "./api";

// Public STUN only -- no TURN relay is run for this. That covers home
// networks and most consumer NATs; behind a symmetric NAT or a strict
// corporate firewall a peer connection won't establish and that tile
// stays stuck on "conectando…".
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

// Someone dropping off is usually a blip -- a reload, a moment of bad
// wifi, or this server being redeployed -- not someone leaving. Tearing
// their video down the instant the WebSocket says they're gone turns a
// two-second gap into a visible interruption, so it waits. If they come
// back within the window under the same identity, the teardown is
// cancelled and the stream was never disturbed.
const LEAVE_GRACE_MS = 12_000;

// Reconnect backoff. Starts fast because the common case is a deploy --
// a couple of seconds -- and backs off so a genuinely dead server isn't
// hammered.
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 8_000;

// This is a mesh: whoever is sharing encodes a SEPARATE stream for each
// person watching. Two viewers means two encodes, three means three --
// so the cost of each one has to stay modest or the encoder falls
// behind and the picture stutters. Unconstrained capture is the usual
// culprit: without these, the browser captures at the monitor's native
// resolution (often 1440p or 4K) at up to 60fps, and two of those at
// once will out-run a laptop CPU.
//
// A shared screen is text far more often than it is video, so 1080p at
// 15fps reads better than 4K at 5fps once things get tight.
const SCREEN_CONSTRAINTS: MediaTrackConstraints = {
  frameRate: { ideal: 15, max: 30 },
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

// Total upload to spend on video, split between everyone watching --
// the bottleneck is one uplink shared by every outgoing connection, so
// what matters is the sum, not the per-connection figure. Floored so a
// big room degrades to something ugly-but-moving rather than nothing.
const SCREEN_BITRATE_BUDGET = 2_500_000;
const CAMERA_BITRATE_BUDGET = 1_200_000;
const MIN_BITRATE = 250_000;

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

// Everyone in a room is an equal participant: anyone can publish at any
// time and everyone receives whatever the others publish. That makes
// this a mesh, so each pair of peers can need TWO peer connections --
// one carrying A's stream to B, another carrying B's to A.
//
// They're kept in separate maps rather than one bidirectional
// connection because a single connection with both sides offering at
// once hits glare (two simultaneous offers on the same PC), and the
// publisher is always the offerer here. Every signalling payload
// therefore carries the SENDER's role in that particular connection, so
// the receiver knows which of the two maps an answer or ICE candidate
// belongs to -- without it, an ICE candidate is ambiguous.
type SignalRole = "publisher" | "subscriber";

export function useRoom(roomId: string, password: string) {
  const [status, setStatus] = useState<Status>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [you, setYou] = useState<{ peerId: string; name: string } | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const sourceRef = useRef<Source | null>(null);
  sourceRef.current = source;
  // Whether my own audio is going out. Kept across shares so the choice
  // sticks: someone who turned the mic off doesn't want it back on the
  // next time they share.
  const [sendingAudio, setSendingAudio] = useState(true);
  const sendingAudioRef = useRef(true);
  sendingAudioRef.current = sendingAudio;

  const wsRef = useRef<WebSocket | null>(null);
  // Connections where I'm the one publishing, keyed by who's receiving.
  const outgoingRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  // Connections where someone else is publishing to me, keyed by them.
  const incomingRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  // Read from WS callbacks, which are created once and would otherwise
  // close over a stale list.
  const peersRef = useRef<Peer[]>([]);
  peersRef.current = peers;
  // Teardowns waiting out the grace period below, keyed by peer.
  const pendingLeaveRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const send = useCallback((payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const signal = useCallback(
    (to: string, role: SignalRole, body: Record<string, unknown>) => {
      send({ type: "signal", to, payload: { ...body, role } });
    },
    [send],
  );

  const closeOutgoing = useCallback((peerId: string) => {
    outgoingRef.current.get(peerId)?.close();
    outgoingRef.current.delete(peerId);
  }, []);

  const cancelPendingLeave = useCallback((peerId: string) => {
    const timer = pendingLeaveRef.current.get(peerId);
    if (timer) {
      clearTimeout(timer);
      pendingLeaveRef.current.delete(peerId);
    }
  }, []);

  const closeIncoming = useCallback((peerId: string) => {
    incomingRef.current.get(peerId)?.close();
    incomingRef.current.delete(peerId);
    setRemoteStreams((current) => {
      if (!(peerId in current)) return current;
      const next = { ...current };
      delete next[peerId];
      return next;
    });
  }, []);

  // --- publishing side ---

  // Caps what one outgoing connection may spend, and tells the encoder
  // what to sacrifice when it can't keep up. For a shared screen that's
  // framerate (keep the text legible); for a camera it's resolution
  // (keep the motion smooth).
  const applyEncodingLimits = useCallback((pc: RTCPeerConnection, viewers: number) => {
    const screen = sourceRef.current !== "camera";
    const budget = screen ? SCREEN_BITRATE_BUDGET : CAMERA_BITRATE_BUDGET;
    const perViewer = Math.max(MIN_BITRATE, Math.floor(budget / Math.max(1, viewers)));

    for (const sender of pc.getSenders()) {
      if (sender.track?.kind !== "video") continue;
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0].maxBitrate = perViewer;
      params.degradationPreference = screen ? "maintain-resolution" : "maintain-framerate";
      // Best-effort: not every browser accepts every field, and a
      // rejected tuning shouldn't break the connection itself.
      sender.setParameters(params).catch(() => {});
    }
  }, []);

  const offerTo = useCallback(
    async (peerId: string) => {
      const stream = localStreamRef.current;
      if (!stream) return; // not publishing -- they get an offer when I start

      closeOutgoing(peerId);
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      outgoingRef.current.set(peerId, pc);

      for (const track of stream.getTracks()) pc.addTrack(track, stream);
      applyEncodingLimits(pc, Math.max(1, peersRef.current.length));
      pc.onicecandidate = (ev) => {
        if (ev.candidate) signal(peerId, "publisher", { kind: "ice", candidate: ev.candidate.toJSON() });
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      signal(peerId, "publisher", { kind: "offer", sdp: pc.localDescription });
    },
    [closeOutgoing, signal],
  );

  // Muting by disabling the track rather than removing it: `enabled =
  // false` makes the track send silence, which needs no renegotiation
  // and no new offer to every peer. Dropping the track instead would
  // mean tearing down and rebuilding every outgoing connection just to
  // toggle a microphone.
  const setAudio = useCallback((on: boolean) => {
    setSendingAudio(on);
    for (const track of localStreamRef.current?.getAudioTracks() ?? []) {
      track.enabled = on;
    }
  }, []);

  const stopSharing = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setSource(null);
    for (const peerId of [...outgoingRef.current.keys()]) closeOutgoing(peerId);
    send({ type: "publish:stop" });
  }, [closeOutgoing, send]);

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

      // getDisplayMedia only yields an audio track if the person also
      // ticked "share audio" in the picker, so there may be nothing here
      // to disable -- the UI reads hasAudioTrack to say so rather than
      // offering a control that does nothing.
      for (const track of stream.getAudioTracks()) {
        track.enabled = sendingAudioRef.current;
      }

      // Tells the encoder what this footage actually is, so it knows
      // what to protect: "detail" keeps text sharp on a shared screen at
      // the cost of framerate, "motion" does the opposite for a camera.
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) videoTrack.contentHint = from === "screen" ? "detail" : "motion";

      localStreamRef.current = stream;
      setLocalStream(stream);
      setSource(from);
      sourceRef.current = from;
      // The browser's own "Stop sharing" bar ends the track.
      stream.getVideoTracks()[0]?.addEventListener("ended", () => stopSharing());

      send({ type: "publish:start" });
      for (const peer of peersRef.current) {
        await offerTo(peer.peerId).catch(() => {});
      }
    },
    [offerTo, send, stopSharing],
  );

  // The budget is split between everyone watching, so it has to be
  // redivided when someone joins or leaves -- otherwise going from one
  // viewer to two would try to send twice as much rather than the same
  // amount split in half, which is exactly how a mesh saturates an
  // uplink.
  useEffect(() => {
    if (!localStream) return;
    const viewers = Math.max(1, peers.length);
    for (const pc of outgoingRef.current.values()) applyEncodingLimits(pc, viewers);
  }, [localStream, peers.length, applyEncodingLimits]);

  // --- receiving side ---

  const answerOffer = useCallback(
    async (from: string, sdp: RTCSessionDescriptionInit) => {
      // Renegotiating from scratch is simpler than patching a live
      // connection, and only happens when someone restarts their share.
      closeIncoming(from);
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      incomingRef.current.set(from, pc);

      pc.onicecandidate = (ev) => {
        if (ev.candidate) signal(from, "subscriber", { kind: "ice", candidate: ev.candidate.toJSON() });
      };
      pc.ontrack = (ev) => {
        const stream = ev.streams[0];
        if (stream) setRemoteStreams((current) => ({ ...current, [from]: stream }));
      };

      await pc.setRemoteDescription(sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      signal(from, "subscriber", { kind: "answer", sdp: pc.localDescription });
    },
    [closeIncoming, signal],
  );

  useEffect(() => {
    // `disposed` separates leaving the room (unmount) from losing the
    // socket (retry). Only the former tears down peer connections --
    // during a reconnect the video is still flowing over them.
    let disposed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (disposed) return;

      // Reclaims the identity the server issued, so the others in the
      // room keep the connections they already have instead of seeing a
      // stranger arrive (see api.ts's Identity and the server's resume
      // handshake).
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
      // Jittered so a room full of people doesn't reconnect in lockstep
      // and stampede a server that just came back up.
      const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt);
      attempt++;
      retryTimer = setTimeout(connect, backoff * (0.5 + Math.random()));
    };

    // A rejected upgrade (401/404) reaches the browser without detail,
    // so the page checks the room over HTTP first; this is the fallback.
    // onclose fires too, so the retry is already handled.
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
          // Kept so a reconnect can reclaim this identity rather than
          // coming back as a stranger.
          rememberIdentity(roomId, { peerId: myId, name: myName, resume: (msg.resume as string) ?? "" });

          const list = (msg.peers as Peer[]) ?? [];
          setPeers(list);

          // This may be a reconnect -- a reload, or this server being
          // redeployed. Anyone still here kept their identity, so the
          // connections already open to them are still valid and still
          // carrying video: rebuilding them is exactly the interruption
          // all of this exists to avoid. Only drop what's genuinely gone.
          const present = new Set(list.map((p) => p.peerId));
          for (const id of [...outgoingRef.current.keys()]) {
            if (!present.has(id)) closeOutgoing(id);
          }
          for (const id of [...incomingRef.current.keys()]) {
            if (!present.has(id)) closeIncoming(id);
          }
          for (const id of [...pendingLeaveRef.current.keys()]) {
            if (present.has(id)) cancelPendingLeave(id);
          }

          // A restarted server has forgotten I was publishing, so say it
          // again -- and offer only to people I'm not already connected to.
          if (localStreamRef.current) {
            send({ type: "publish:start" });
            for (const peer of list) {
              if (!outgoingRef.current.has(peer.peerId)) {
                await offerTo(peer.peerId).catch(() => {});
              }
            }
          }
          break;
        }

        case "peer:join": {
          const peer: Peer = { peerId: msg.peerId as string, name: msg.name as string, publishing: false };
          setPeers((current) => [...current.filter((p) => p.peerId !== peer.peerId), peer]);

          // Back inside the grace window: the connection to them never
          // went away, so leave it be rather than renegotiating.
          const returning = pendingLeaveRef.current.has(peer.peerId) && outgoingRef.current.has(peer.peerId);
          cancelPendingLeave(peer.peerId);
          if (!returning) {
            // If I'm mid-share, the newcomer needs my stream too.
            await offerTo(peer.peerId).catch(() => {});
          }
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
              closeOutgoing(peerId);
              closeIncoming(peerId);
            }, LEAVE_GRACE_MS),
          );
          break;
        }

        case "publish:start": {
          const peerId = msg.peerId as string;
          setPeers((current) => current.map((p) => (p.peerId === peerId ? { ...p, publishing: true } : p)));
          break;
        }

        case "publish:stop": {
          const peerId = msg.peerId as string;
          setPeers((current) => current.map((p) => (p.peerId === peerId ? { ...p, publishing: false } : p)));
          closeIncoming(peerId);
          break;
        }

        case "signal": {
          const from = msg.from as string;
          const payload = msg.payload as Record<string, unknown>;
          const senderRole = payload.role as SignalRole;

          if (payload.kind === "offer") {
            await answerOffer(from, payload.sdp as RTCSessionDescriptionInit).catch(() => {});
            return;
          }
          // The sender's role tells us which of the two connections with
          // this peer the message belongs to.
          const pc =
            senderRole === "publisher" ? incomingRef.current.get(from) : outgoingRef.current.get(from);
          if (!pc) return;

          if (payload.kind === "answer") {
            await pc.setRemoteDescription(payload.sdp as RTCSessionDescriptionInit).catch(() => {});
          } else if (payload.kind === "ice") {
            // A candidate landing before setRemoteDescription is dropped
            // rather than queued -- rare enough with this signalling
            // order that the bookkeeping isn't worth it.
            await pc.addIceCandidate(payload.candidate as RTCIceCandidateInit).catch(() => {});
          }
          break;
        }
      }
    };

    };

    connect();

    // Leaving the room for real: everything goes, including the peer
    // connections a reconnect deliberately preserves.
    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      for (const timer of pendingLeaveRef.current.values()) clearTimeout(timer);
      pendingLeaveRef.current.clear();
      wsRef.current?.close();
      for (const pc of outgoingRef.current.values()) pc.close();
      for (const pc of incomingRef.current.values()) pc.close();
      outgoingRef.current.clear();
      incomingRef.current.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
  }, [roomId, password, offerTo, answerOffer, closeOutgoing, closeIncoming, cancelPendingLeave, send]);

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
