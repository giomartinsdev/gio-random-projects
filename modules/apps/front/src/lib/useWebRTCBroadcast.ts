import { useCallback, useEffect, useRef, useState } from "react";
import type { Participant, SignalPayload } from "./useClassSocket.js";

// Public STUN server for NAT traversal -- no TURN relay is run for
// this app, so a small fraction of restrictive networks (symmetric
// NAT, some corporate firewalls) won't be able to connect peer-to-peer
// at all. Acceptable for a small homelab class; STUN alone covers the
// common case (home networks, most consumer NATs).
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

// Discord embeds Activities in an iframe it controls, and doesn't
// delegate the `display-capture` Permissions-Policy feature to that
// iframe -- calling getDisplayMedia directly from in here rejects
// immediately with a synchronous "not granted", no native picker ever
// shown (confirmed live: the exact same call from a plain top-level
// tab correctly reaches the OS picker instead). getUserMedia isn't
// rejected the same way, but routing both through the same popup
// keeps this one code path and one gesture-triggered permission flow.
//
// The fix isn't a Discord-side bypass (there isn't one from Activity
// JS) -- it's simply not running the capture call inside the
// restricted iframe at all. window.open()'s popup is a genuine
// top-level browsing context, subject to normal Permissions-Policy
// defaults, not the parent iframe's. See pages/SharePopup.tsx for the
// other half of this: it captures the stream there and hands the
// live MediaStream object back across the (same-origin) window
// boundary via `window.opener.__classroomReceiveStream(...)` --
// same-origin windows can pass host objects like MediaStream by
// reference through a direct call like this; postMessage isn't
// involved and wouldn't work here anyway (MediaStream isn't
// structured-clonable).
function openSharePopup(kind: "screen" | "camera"): Window | null {
  return window.open(
    `${window.location.origin}/share-popup?kind=${kind}`,
    "classroom-share-popup",
    "width=480,height=360",
  );
}

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
  const popupRef = useRef<Window | null>(null);

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

  // Called by the popup (see SharePopup.tsx) via
  // `window.opener.__classroomReceiveStream(...)` once it has a real
  // MediaStream -- exposed on `window` (not React state) because the
  // popup is a wholly separate script realm that only has a
  // same-origin `window.opener` reference to reach back through.
  useEffect(() => {
    window.__classroomReceiveStream = (stream: MediaStream, kind: "screen" | "camera") => {
      // If the popup window itself gets closed (user clicks its X,
      // browser/OS "Stop sharing" control, etc.) its tracks end --
      // react the same as clicking our own Parar button.
      stream.getVideoTracks()[0]?.addEventListener("ended", () => stopSharing());
      localStreamRef.current = stream;
      setLocalStream(stream);
      setSharing(kind);
      setShareError(null);
    };
    window.__classroomShareError = (message: string) => {
      setShareError(message);
    };
    return () => {
      delete window.__classroomReceiveStream;
      delete window.__classroomShareError;
    };
  }, []);

  function startSharing(kind: "screen" | "camera") {
    stopSharing();
    setShareError(null);
    const popup = openSharePopup(kind);
    if (!popup) {
      setShareError("Não foi possível abrir a janela de compartilhamento -- permita pop-ups para este site e tente de novo.");
      return;
    }
    popupRef.current = popup;
  }

  function stopSharing() {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setSharing(null);
    closeAllPeers();
    popupRef.current?.close();
    popupRef.current = null;
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
