import { useEffect, useState } from "react";
import { wsUrlWithToken } from "../lib/classroomApi.js";

// Opened as its own top-level window by lib/useLiveShare.ts (see that
// file for why the capture can't run inside the Discord Activity
// iframe at all). Captures the screen or camera here, where
// getDisplayMedia actually works, draws each frame to a canvas, and
// pushes it to the room's WebSocket as a JPEG data URL.
//
// Deliberately outside <Layout>/<ProtectedRoute> (see App.tsx): no
// auth beyond the token in the URL, no NavBar, nothing else from the
// app -- just capture and push.

// ~2 fps at 1280px/quality 0.5 keeps a slide or an editor perfectly
// legible while staying small enough to fan out through one server
// process. This is a screen-sharing-for-teaching tradeoff, not video:
// motion looks choppy, static content looks fine.
const FPS = 2;
const MAX_WIDTH = 1280;
const QUALITY = 0.5;
// Skip a frame rather than queue behind a socket that's already
// backed up -- a late frame is worth less than the next fresh one.
const MAX_BUFFERED = 1_000_000;

type Status = "requesting" | "sharing" | "error" | "missing-params";

export default function SharePopup() {
  const [status, setStatus] = useState<Status>("requesting");
  const [errorMessage, setErrorMessage] = useState("");

  const params = new URLSearchParams(window.location.search);
  const kind = params.get("kind") === "camera" ? "camera" : "screen";
  const roomId = params.get("roomId") ?? "";
  const token = params.get("token");

  useEffect(() => {
    if (!roomId) {
      setStatus("missing-params");
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const ws = new WebSocket(wsUrlWithToken(roomId, token));

    function send(payload: unknown) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    }

    function cleanup() {
      if (timer) clearInterval(timer);
      timer = null;
      stream?.getTracks().forEach((t) => t.stop());
      send({ type: "share:stop" });
      ws.close();
    }

    ws.onmessage = (evt) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }
      // The host pressed "Parar" back in the class page.
      if (msg.type === "share:stop") {
        cleanup();
        if (!cancelled) window.close();
      }
    };

    ws.onopen = () => {
      (async () => {
        try {
          stream =
            kind === "screen"
              ? await navigator.mediaDevices.getDisplayMedia({ video: true })
              : await navigator.mediaDevices.getUserMedia({ video: true });
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

        const video = document.createElement("video");
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        send({ type: "share:start" });
        setStatus("sharing");

        timer = setInterval(() => {
          if (!ctx || ws.readyState !== WebSocket.OPEN) return;
          if (ws.bufferedAmount > MAX_BUFFERED) return;
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          if (!vw || !vh) return;
          const scale = Math.min(1, MAX_WIDTH / vw);
          canvas.width = Math.round(vw * scale);
          canvas.height = Math.round(vh * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          send({ type: "frame", data: canvas.toDataURL("image/jpeg", QUALITY) });
        }, 1000 / FPS);

        // The browser/OS's own "Stop sharing" control ends the track.
        stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          cleanup();
          if (!cancelled) window.close();
        });
        window.addEventListener("beforeunload", cleanup);
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
            Deixe esta janela aberta enquanto estiver compartilhando com a aula. O áudio continua pelo canal de voz do
            Discord.
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
