import { useCallback, useEffect, useRef, useState } from "react";
import type { Participant, SignalPayload } from "./useClassSocket.js";
import { getDiscordBearerToken } from "./discordAuthToken.js";
import { isDiscordActivity, openExternalLink } from "./discordActivity.js";

// Public STUN server for NAT traversal -- no TURN relay is run for
// this app, so a small fraction of restrictive networks (symmetric
// NAT, some corporate firewalls) won't be able to connect peer-to-peer
// at all. Acceptable for a small homelab class; STUN alone covers the
// common case (home networks, most consumer NATs).
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

// Two independent restrictions rule out calling
// getDisplayMedia/getUserMedia directly in here: Discord's Activity
// iframe doesn't delegate the `display-capture` Permissions-Policy
// feature to it (getDisplayMedia rejects instantly with "not granted",
// no native picker ever shown), AND its sandbox has no allow-popups
// (a plain window.open() from in here returns null) -- both confirmed
// live, and there's no SDK command to request either.
//
// The fix: run the actual capture in pages/SharePopup.tsx, opened as a
// REAL top-level browsing context via openExternalLink (Discord's own
// RPC bridge to its trusted top-level frame, which isn't sandboxed the
// way this iframe is) or, outside Discord, a plain window.open().
// Either way, that popup can't hand the MediaStream back through
// window.opener (openExternalLink doesn't preserve one, and doesn't
// even guarantee the same browser process). Instead it relays the
// captured track back over a SECOND, LOOPBACK RTCPeerConnection,
// signaled through the exact same room WebSocket + sendTo(userId)
// relay already used for the real host->viewer mesh below -- the
// popup just connects to the room as a second connection under the
// host's own userId. relayId+role tag every message so each side
// ignores the echo of its own messages that classroom-api's sendTo
// fans out to every connection under that userId (see
// classroom-api's ws/roomHub.ts).
type RelayRole = "sender" | "receiver";

// The host is the ONE media source; each viewer opens its own
// RTCPeerConnection directly to the host (a mesh centered on the
// host) -- classroom-api never touches media, only relays these
// offer/answer/ICE payloads by userId (see that service's
// ws/roomHub.ts). Fine for a small class; an SFU would be the next
// step if this ever needs to scale past a handful of viewers.
export function useWebRTCBroadcast(opts: {
  roomId: string;
  isHost: boolean;
  hostId: string | null;
  you: { userId: string; userName: string } | null;
  participants: Participant[];
  sendSignal: (to: string, payload: SignalPayload) => void;
}) {
  const { roomId, isHost, hostId, you, participants, sendSignal } = opts;

  // Host: one outbound connection per viewer, keyed by viewer userId.
  // Viewer: exactly one inbound connection, keyed by the host's userId.
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [sharing, setSharing] = useState<"screen" | "camera" | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  // The loopback connection to OUR OWN SharePopup tab, and the id
  // tagging this particular share attempt's signaling messages.
  const relayPcRef = useRef<RTCPeerConnection | null>(null);
  const relayIdRef = useRef<string | null>(null);

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

  function startSharing(kind: "screen" | "camera") {
    stopSharing();
    setShareError(null);
    if (!you) {
      setShareError("Aguarde a conexão terminar antes de compartilhar.");
      return;
    }
    const relayId = crypto.randomUUID();
    relayIdRef.current = relayId;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    relayPcRef.current = pc;
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        sendSignal(you.userId, {
          kind: "ice",
          candidate: ev.candidate.toJSON(),
          relayId,
          role: "receiver" satisfies RelayRole,
        });
      }
    };
    // The actual captured stream, arriving from our own SharePopup tab.
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      stream.getVideoTracks()[0]?.addEventListener("ended", () => stopSharing());
      localStreamRef.current = stream;
      setLocalStream(stream);
      setSharing(kind);
    };

    (async () => {
      const token = getDiscordBearerToken();
      const params = new URLSearchParams({ kind, roomId, relayId, hostId: you.userId });
      if (token) params.set("token", token);

      // NOT window.location.origin: inside a Discord Activity that's
      // Discord's proxy origin (https://<app_id>.discordsays.com),
      // which only resolves inside the Activity iframe itself. Handing
      // that to openExternalLink silently does nothing -- Discord
      // won't open its own proxy domain as an "external" link, and it
      // wouldn't load as a standalone page anyway. The popup has to
      // point at this app's REAL public origin.
      const origin = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) || window.location.origin;
      const url = `${origin}/share-popup?${params.toString()}`;

      const inActivity = isDiscordActivity();
      // window.open FIRST, even inside the Activity: the iframe turns
      // out to allow popups, and a popup this page opened itself is
      // strictly better than the SDK route (we keep a Window handle,
      // so stopSharing can close it). openExternalLink is the
      // fallback -- it hands the URL to Discord's own client, but
      // returns no handle and, observed live, can leave its RPC
      // promise pending forever, so it's raced against a timeout
      // rather than awaited indefinitely.
      const popup = window.open(url, "classroom-share-popup", "width=480,height=360");
      popupRef.current = popup;
      let opened = popup !== null;
      console.log(`[classroom] share window.open -> ${opened ? "ok" : "blocked"} (activity=${inActivity})`);

      if (!opened && inActivity) {
        opened = await Promise.race([
          openExternalLink(url),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
        ]);
      }

      if (!opened) {
        console.error(`[classroom] could not open share window (activity=${inActivity}) for ${origin}`);
        setShareError(
          inActivity
            ? "O Discord não conseguiu abrir a janela de compartilhamento. Abra a aula pelo site para compartilhar a tela."
            : "Não foi possível abrir a janela de compartilhamento -- permita pop-ups para este site e tente de novo.",
        );
        relayPcRef.current?.close();
        relayPcRef.current = null;
        relayIdRef.current = null;
      }
    })();
  }

  function stopSharing() {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setSharing(null);
    closeAllPeers();
    if (you && relayIdRef.current) {
      // Tells the popup to close itself immediately instead of
      // lingering -- its own capture ending would eventually tear this
      // down too, but this makes clicking Parar instant.
      sendSignal(you.userId, { kind: "stop", relayId: relayIdRef.current, role: "receiver" satisfies RelayRole });
    }
    relayPcRef.current?.close();
    relayPcRef.current = null;
    relayIdRef.current = null;
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

      // A message from OUR OWN SharePopup tab (always `from ===
      // you.userId`, since it's the same person's second connection).
      // relayId+role filters out the echo of our own outgoing relay
      // messages, which classroom-api's sendTo fans out to every
      // connection under that userId, this one included.
      if (you && from === you.userId && payload.relayId === relayIdRef.current && payload.role === "sender") {
        const pc = relayPcRef.current;
        if (!pc) return;
        if (kind === "offer") {
          await pc.setRemoteDescription(payload.sdp as RTCSessionDescriptionInit);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal(you.userId, {
            kind: "answer",
            sdp: pc.localDescription,
            relayId: relayIdRef.current,
            role: "receiver" satisfies RelayRole,
          });
        } else if (kind === "ice") {
          try {
            await pc.addIceCandidate(payload.candidate as RTCIceCandidateInit);
          } catch {
            // same "candidate arrived before setRemoteDescription"
            // race as the mesh below -- harmless to drop.
          }
        }
        return;
      }

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
    [isHost, you],
  );

  useEffect(() => {
    return () => {
      closeAllPeers();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      relayPcRef.current?.close();
    };
  }, []);

  return { localStream, remoteStream, sharing, shareError, startSharing, stopSharing, handleSignal };
}
