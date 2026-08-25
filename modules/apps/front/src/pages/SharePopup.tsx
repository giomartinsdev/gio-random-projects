import { useEffect, useState } from "react";
import { wsUrlWithToken } from "../lib/classroomApi.js";

// Standalone page opened via openExternalLink (inside a Discord
// Activity) or window.open() (plain browser) from
// lib/useWebRTCBroadcast.ts's startSharing -- see that file's top
// comment for why: it's a real top-level browsing context, not nested
// inside Discord's Activity iframe, so neither of that iframe's two
// restrictions (no display-capture Permissions-Policy delegation, no
// allow-popups) applies here.
//
// Deliberately outside <Layout>/<ProtectedRoute> (see App.tsx): this
// needs no auth beyond the token already handed to it in the URL, no
// NavBar, nothing from the rest of the app -- just the capture call
// and a loopback RTCPeerConnection back to the Activity page,
// signaled over the room's own WebSocket (roomHub.sendTo, tagged with
// relayId+role -- see useWebRTCBroadcast.ts for the full protocol).
const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

type Status = "requesting" | "sharing" | "error" | "missing-params";

export default function SharePopup() {
  const [status, setStatus] = useState<Status>("requesting");
  const [errorMessage, setErrorMessage] = useState("");

  const params = new URLSearchParams(window.location.search);
  const kind = params.get("kind") === "camera" ? "camera" : "screen";
  const roomId = params.get("roomId") ?? "";
  const relayId = params.get("relayId") ?? "";
  const hostId = params.get("hostId") ?? "";
  const token = params.get("token");

  useEffect(() => {
    if (!roomId || !relayId || !hostId) {
      setStatus("missing-params");
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let pc: RTCPeerConnection | null = null;
    const ws = new WebSocket(wsUrlWithToken(roomId, token));

    function send(payload: unknown) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    }

    function cleanup() {
      pc?.close();
      stream?.getTracks().forEach((t) => t.stop());
      ws.close();
    }

    ws.onmessage = async (evt) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      if (msg.type !== "webrtc:signal") return;
      const payload = msg.payload as Record<string, unknown>;
      // Ignore the echo of our own outgoing messages -- classroom-api's
      // sendTo fans out to every connection under hostId, this tab's
      // own WS connection included.
      if (payload?.relayId !== relayId || payload?.role !== "receiver" || !pc) return;

      if (payload.kind === "answer") {
        await pc.setRemoteDescription(payload.sdp as RTCSessionDescriptionInit);
      } else if (payload.kind === "ice") {
        try {
          await pc.addIceCandidate(payload.candidate as RTCIceCandidateInit);
        } catch {
          // same trickle-ICE race as the main mesh -- safe to drop.
        }
      } else if (payload.kind === "stop") {
        cleanup();
        if (!cancelled) window.close();
      }
    };

    ws.onopen = () => {
      (async () => {
        try {
          stream =
            kind === "screen"
              ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
              : await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        } catch (err) {
          const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          if (!cancelled) {
            setErrorMessage(message);
            setStatus("error");
          }
          ws.close();
          return;
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        for (const track of stream.getTracks()) pc.addTrack(track, stream);
        pc.onicecandidate = (ev) => {
          if (ev.candidate) {
            send({
              type: "webrtc:signal",
              to: hostId,
              payload: { kind: "ice", candidate: ev.candidate.toJSON(), relayId, role: "sender" },
            });
          }
        };
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({ type: "webrtc:signal", to: hostId, payload: { kind: "offer", sdp: pc.localDescription, relayId, role: "sender" } });

        // Tracks belong to THIS document -- if this tab closes (user
        // clicks its X, or the browser/OS "Stop sharing" control on a
        // screen share), they end on their own, which the Activity
        // page's `pc.ontrack` remote-track "ended" listener reacts to.
        stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          if (!cancelled) window.close();
        });
        window.addEventListener("beforeunload", cleanup);
        setStatus("sharing");
      })();
    };

    return () => {
      cancelled = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        background: "#1a1210",
        color: "#f5e9dc",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: "24px",
        gap: "12px",
      }}
    >
      {status === "requesting" && <p>Aguardando permissão do navegador…</p>}
      {status === "sharing" && (
        <>
          <p style={{ fontSize: "18px", fontWeight: 600 }}>
            {kind === "screen" ? "Compartilhando sua tela" : "Compartilhando sua câmera"}
          </p>
          <p style={{ opacity: 0.7, fontSize: "14px" }}>
            Não feche esta janela enquanto estiver compartilhando com a aula.
          </p>
          <button
            onClick={() => window.close()}
            style={{
              marginTop: "8px",
              padding: "8px 16px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.2)",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            Parar compartilhamento
          </button>
        </>
      )}
      {status === "error" && (
        <>
          <p style={{ fontWeight: 600 }}>Não foi possível compartilhar</p>
          <p style={{ opacity: 0.7, fontSize: "14px", fontFamily: "monospace" }}>{errorMessage}</p>
        </>
      )}
      {status === "missing-params" && <p>Esta janela precisa ser aberta a partir da aula, na aba "Aulas".</p>}
    </div>
  );
}
