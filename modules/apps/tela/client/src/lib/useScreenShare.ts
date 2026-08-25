import { useCallback, useEffect, useRef, useState } from "react";
import { wsUrl } from "./api";

// Public STUN only -- no TURN relay is run for this. That covers home
// networks and most consumer NATs; behind a symmetric NAT or a strict
// corporate firewall the peer connection simply won't establish, which
// surfaces as a viewer stuck on "conectando…".
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export type Status = "connecting" | "connected" | "host-taken" | "error" | "closed";

type Options =
  | { role: "host"; roomId: string; token: string }
  | { role: "viewer"; roomId: string; password: string };

// One peer connection per viewer, all anchored on the host: the host
// is the only source of video and viewers never talk to each other.
// The server relays offers/answers/ICE and nothing else -- media goes
// straight browser-to-browser.
export function useScreenShare(opts: Options) {
  const [status, setStatus] = useState<Status>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hostOnline, setHostOnline] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  // Every viewer currently in the room, whether or not it already has a
  // peer connection: someone who joins before the host picks a window
  // still has to be offered to once sharing starts.
  const viewersRef = useRef<Set<string>>(new Set());
  // The WS callbacks are created once, so they'd otherwise close over a
  // stale `opts`.
  const roleRef = useRef(opts.role);
  roleRef.current = opts.role;

  const send = useCallback((payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
    }
  }, []);

  const closePeer = useCallback((peerId: string) => {
    peersRef.current.get(peerId)?.close();
    peersRef.current.delete(peerId);
  }, []);

  const closeAllPeers = useCallback(() => {
    for (const pc of peersRef.current.values()) pc.close();
    peersRef.current.clear();
  }, []);

  // --- host side ---

  const offerTo = useCallback(
    async (viewerId: string) => {
      const stream = localStreamRef.current;
      if (!stream) return; // not sharing yet -- offered when the share starts

      closePeer(viewerId);
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peersRef.current.set(viewerId, pc);

      for (const track of stream.getTracks()) pc.addTrack(track, stream);
      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          send({ type: "signal", to: viewerId, payload: { kind: "ice", candidate: ev.candidate.toJSON() } });
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: "signal", to: viewerId, payload: { kind: "offer", sdp: pc.localDescription } });
    },
    [closePeer, send],
  );

  const stopSharing = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    closeAllPeers();
  }, [closeAllPeers]);

  const startSharing = useCallback(async () => {
    setErrorMessage(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
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
    // The browser's own "Stop sharing" bar ends the track.
    stream.getVideoTracks()[0]?.addEventListener("ended", () => stopSharing());

    for (const viewerId of viewersRef.current) {
      await offerTo(viewerId).catch(() => {});
    }
  }, [offerTo, stopSharing]);

  // --- viewer side ---

  const answerHost = useCallback(
    async (hostId: string, sdp: RTCSessionDescriptionInit) => {
      // Renegotiating from scratch is simpler than patching the live
      // connection, and only happens when the host restarts a share.
      closePeer(hostId);
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peersRef.current.set(hostId, pc);

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          send({ type: "signal", to: hostId, payload: { kind: "ice", candidate: ev.candidate.toJSON() } });
        }
      };
      pc.ontrack = (ev) => setRemoteStream(ev.streams[0] ?? null);

      await pc.setRemoteDescription(sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({ type: "signal", to: hostId, payload: { kind: "answer", sdp: pc.localDescription } });
    },
    [closePeer, send],
  );

  const params =
    opts.role === "host"
      ? { room: opts.roomId, role: "host", token: opts.token }
      : { room: opts.roomId, role: "viewer", password: opts.password };
  // Serialised so the effect below can depend on the connection
  // identity without re-running on every render.
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    const ws = new WebSocket(wsUrl(JSON.parse(paramsKey)));
    wsRef.current = ws;

    ws.onopen = () => setStatus("connected");

    ws.onclose = (ev) => {
      // 1008 with a reason is only ever the "someone is already
      // sharing" refusal -- worth telling apart from a generic drop,
      // because the fix is different.
      if (ev.code === 1008 && ev.reason) {
        setErrorMessage(ev.reason);
        setStatus("host-taken");
        return;
      }
      setStatus((s) => (s === "connected" ? "closed" : s));
    };

    // A rejected upgrade (401/404) reaches the browser without detail,
    // so the pages check the room over HTTP first; this is the fallback.
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
          setHostOnline(Boolean(msg.hostOnline));
          break;

        case "viewer:join": {
          const peerId = msg.peerId as string;
          viewersRef.current.add(peerId);
          setViewerCount(viewersRef.current.size);
          await offerTo(peerId).catch(() => {});
          break;
        }

        case "viewer:leave": {
          const peerId = msg.peerId as string;
          viewersRef.current.delete(peerId);
          setViewerCount(viewersRef.current.size);
          closePeer(peerId);
          break;
        }

        case "host:online":
          setHostOnline(true);
          break;

        case "host:offline":
          setHostOnline(false);
          setRemoteStream(null);
          closeAllPeers();
          break;

        case "signal": {
          const from = msg.from as string;
          const payload = msg.payload as Record<string, unknown>;

          if (payload.kind === "offer" && roleRef.current === "viewer") {
            await answerHost(from, payload.sdp as RTCSessionDescriptionInit).catch(() => {});
            return;
          }

          const pc = peersRef.current.get(from);
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
      closeAllPeers();
      viewersRef.current.clear();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    };
  }, [paramsKey, offerTo, answerHost, closePeer, closeAllPeers]);

  return {
    status,
    errorMessage,
    hostOnline,
    viewerCount,
    localStream,
    remoteStream,
    isSharing: localStream !== null,
    startSharing,
    stopSharing,
  };
}
