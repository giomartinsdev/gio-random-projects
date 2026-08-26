import { useCallback, useEffect, useRef, useState } from "react";
import type { Participant, SignalPayload } from "./useClassSocket.js";

// Public STUN server for NAT traversal -- no TURN relay is run for
// this app, so a small fraction of restrictive networks (symmetric
// NAT, some corporate firewalls) won't be able to connect peer-to-peer
// at all. Acceptable for a small homelab class; STUN alone covers the
// common case (home networks, most consumer NATs).
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

// The host is the ONE media source; each viewer opens its own
// RTCPeerConnection directly to the host (a mesh centered on the
// host) -- classroom-api never touches media, only relays these
// offer/answer/ICE payloads by userId (see that service's
// ws/roomHub.ts). Fine for a small class; an SFU would be the next
// step if this ever needs to scale past a handful of viewers.
export function useWebRTCBroadcast(opts: {
  isHost: boolean;
  hostId: string | null;
  you: { userId: string; userName: string } | null;
  participants: Participant[];
  sendSignal: (to: string, payload: SignalPayload) => void;
}) {
  const { isHost, hostId, you, participants, sendSignal } = opts;

  // Host: one outbound connection per viewer, keyed by viewer userId.
  // Viewer: exactly one inbound connection, keyed by the host's userId.
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [sharing, setSharing] = useState<"screen" | "camera" | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  function closePeer(id: string) {
    peersRef.current.get(id)?.close();
    peersRef.current.delete(id);
  }

  function closeAllPeers() {
    for (const pc of peersRef.current.values()) pc.close();
    peersRef.current.clear();
  }

  // --- host side: one offer per viewer ---

  const createOfferFor = useCallback(
    async (viewerId: string) => {
      if (!localStreamRef.current) return;
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peersRef.current.set(viewerId, pc);
      for (const track of localStreamRef.current.getTracks()) pc.addTrack(track, localStreamRef.current);
      pc.onicecandidate = (ev) => {
        if (ev.candidate) sendSignal(viewerId, { kind: "ice", candidate: ev.candidate.toJSON() });
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal(viewerId, { kind: "offer", sdp: pc.localDescription });
    },
    [sendSignal],
  );

  // Whenever the local stream starts existing, offer it to everyone
  // already in the room; whenever a NEW viewer shows up while already
  // sharing, offer to them too.
  useEffect(() => {
    if (!isHost || !localStream) return;
    for (const p of participants) {
      if (p.userId === you?.userId) continue;
      if (!peersRef.current.has(p.userId)) createOfferFor(p.userId).catch(() => {});
    }
  }, [isHost, localStream, participants, you?.userId, createOfferFor]);

  // Drop a peer connection once its viewer leaves.
  useEffect(() => {
    if (!isHost) return;
    const present = new Set(participants.map((p) => p.userId));
    for (const id of [...peersRef.current.keys()]) {
      if (!present.has(id)) closePeer(id);
    }
  }, [isHost, participants]);

  async function startSharing(kind: "screen" | "camera") {
    stopSharing();
    setShareError(null);
    let stream: MediaStream;
    try {
      stream =
        kind === "screen"
          ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
          : await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch (err) {
      // Surfaced to the UI (see AulaRoom.tsx) instead of failing
      // silently -- inside Discord's Activity iframe this rejects with
      // a Permissions-Policy / NotAllowedError rather than showing any
      // native picker, so without this the buttons look like they do
      // nothing at all.
      const name = err instanceof Error ? err.name : "Error";
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[classroom] ${kind} share failed:`, name, message);
      setShareError(`${name}: ${message}`);
      return;
    }
    // If the user stops sharing via the browser/OS's own "Stop
    // sharing" control (screen share only), react the same as
    // clicking our own stop button.
    stream.getVideoTracks()[0]?.addEventListener("ended", () => stopSharing());
    localStreamRef.current = stream;
    setLocalStream(stream);
    setSharing(kind);
  }

  function stopSharing() {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setSharing(null);
    closeAllPeers();
  }

  // --- viewer side: exactly one connection, to the host ---

  async function handleOfferFromHost(from: string, sdp: RTCSessionDescriptionInit) {
    closePeer(from); // renegotiation-from-scratch is simpler than patching an existing connection
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peersRef.current.set(from, pc);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) sendSignal(from, { kind: "ice", candidate: ev.candidate.toJSON() });
    };
    pc.ontrack = (ev) => setRemoteStream(ev.streams[0] ?? null);
    await pc.setRemoteDescription(sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal(from, { kind: "answer", sdp: pc.localDescription });
  }

  // The host leaving (participant:leave for hostId) kills any
  // in-progress connection regardless of whether the host's own
  // browser tab closed cleanly -- clear the remote stream so the
  // viewer's UI reflects it immediately instead of a frozen last frame.
  useEffect(() => {
    if (isHost || !hostId) return;
    if (!participants.some((p) => p.userId === hostId)) {
      closePeer(hostId);
      setRemoteStream(null);
    }
  }, [isHost, hostId, participants]);

  // --- shared signal dispatch (see useClassSocket's onSignal) ---

  const handleSignal = useCallback(
    async (from: string, payload: SignalPayload) => {
      const kind = payload.kind as string;
      if (kind === "offer" && !isHost) {
        await handleOfferFromHost(from, payload.sdp as RTCSessionDescriptionInit);
        return;
      }
      const pc = peersRef.current.get(from);
      if (!pc) return;
      if (kind === "answer") {
        await pc.setRemoteDescription(payload.sdp as RTCSessionDescriptionInit);
      } else if (kind === "ice") {
        try {
          await pc.addIceCandidate(payload.candidate as RTCIceCandidateInit);
        } catch {
          // a candidate arriving before setRemoteDescription finishes is
          // dropped rather than queued -- rare enough with ICE trickle +
          // this signaling's ordering that ignoring it is fine.
        }
      }
    },
    [isHost],
  );

  useEffect(() => {
    return () => {
      closeAllPeers();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { localStream, remoteStream, sharing, shareError, startSharing, stopSharing, handleSignal };
}
