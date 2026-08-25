import { useCallback, useEffect, useRef, useState } from "react";
import { wsUrl } from "./api";

// Public STUN only -- no TURN relay is run for this. That covers home
// networks and most consumer NATs; behind a symmetric NAT or a strict
// corporate firewall a peer connection won't establish and that tile
// stays stuck on "conectando…".
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export type Status = "connecting" | "connected" | "error" | "closed";
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

  const offerTo = useCallback(
    async (peerId: string) => {
      const stream = localStreamRef.current;
      if (!stream) return; // not publishing -- they get an offer when I start

      closeOutgoing(peerId);
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      outgoingRef.current.set(peerId, pc);

      for (const track of stream.getTracks()) pc.addTrack(track, stream);
      pc.onicecandidate = (ev) => {
        if (ev.candidate) signal(peerId, "publisher", { kind: "ice", candidate: ev.candidate.toJSON() });
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      signal(peerId, "publisher", { kind: "offer", sdp: pc.localDescription });
    },
    [closeOutgoing, signal],
  );

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
            ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
            : // Rear camera by default -- sharing a phone's camera is
              // usually about showing something, not yourself. `ideal`
              // rather than `exact` so a laptop with one webcam still
              // works instead of throwing OverconstrainedError.
              await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: "environment" } },
                audio: true,
              });
      } catch (err) {
        const name = err instanceof Error ? err.name : "Error";
        // Dismissing the picker is a normal thing to do, not an error.
        if (name !== "NotAllowedError" && name !== "AbortError") {
          setErrorMessage(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
        }
        return;
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
      setSource(from);
      // The browser's own "Stop sharing" bar ends the track.
      stream.getVideoTracks()[0]?.addEventListener("ended", () => stopSharing());

      send({ type: "publish:start" });
      for (const peer of peersRef.current) {
        await offerTo(peer.peerId).catch(() => {});
      }
    },
    [offerTo, send, stopSharing],
  );

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
    const ws = new WebSocket(wsUrl({ room: roomId, password }));
    wsRef.current = ws;

    ws.onopen = () => setStatus("connected");
    ws.onclose = () => setStatus((s) => (s === "connected" ? "closed" : s));
    // A rejected upgrade (401/404) reaches the browser without detail,
    // so the page checks the room over HTTP first; this is the fallback.
    ws.onerror = () => setStatus((s) => (s === "connecting" ? "error" : s));

    ws.onmessage = async (evt) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "welcome":
          setYou({ peerId: msg.peerId as string, name: msg.name as string });
          // Whoever is already publishing will offer to me on seeing my
          // peer:join, so there's nothing to initiate from here.
          setPeers((msg.peers as Peer[]) ?? []);
          break;

        case "peer:join": {
          const peer: Peer = { peerId: msg.peerId as string, name: msg.name as string, publishing: false };
          setPeers((current) => [...current.filter((p) => p.peerId !== peer.peerId), peer]);
          // If I'm mid-share, the newcomer needs my stream too.
          await offerTo(peer.peerId).catch(() => {});
          break;
        }

        case "peer:leave": {
          const peerId = msg.peerId as string;
          setPeers((current) => current.filter((p) => p.peerId !== peerId));
          closeOutgoing(peerId);
          closeIncoming(peerId);
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

    return () => {
      ws.close();
      for (const pc of outgoingRef.current.values()) pc.close();
      for (const pc of incomingRef.current.values()) pc.close();
      outgoingRef.current.clear();
      incomingRef.current.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
  }, [roomId, password, offerTo, answerOffer, closeOutgoing, closeIncoming]);

  return {
    status,
    errorMessage,
    you,
    peers,
    remoteStreams,
    localStream,
    source,
    isSharing: localStream !== null,
    startSharing,
    stopSharing,
  };
}
