import { useEffect, useState } from "react";

// Standalone page opened via window.open() from AulaRoom (see
// lib/useWebRTCBroadcast.ts for why: it's a real top-level browsing
// context, not nested inside Discord's Activity iframe, so it isn't
// subject to the iframe's Permissions-Policy -- getDisplayMedia works
// here even though it's rejected instantly inside the Activity.
//
// Deliberately outside <Layout>/<ProtectedRoute> (see App.tsx): this
// needs no auth, no NavBar, nothing from the rest of the app -- just
// the capture call and a way to hand the result back to window.opener.
type Status = "requesting" | "sharing" | "error" | "no-opener";

export default function SharePopup() {
  const [status, setStatus] = useState<Status>("requesting");
  const [errorMessage, setErrorMessage] = useState("");
  const kind = (new URLSearchParams(window.location.search).get("kind") === "camera" ? "camera" : "screen") as
    | "screen"
    | "camera";

  useEffect(() => {
    if (!window.opener || typeof window.opener.__classroomReceiveStream !== "function") {
      setStatus("no-opener");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const stream =
          kind === "screen"
            ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
            : await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        // Tracks belong to THIS document -- if this popup closes
        // (user clicks its X), they end on their own, which is what
        // useWebRTCBroadcast's "ended" listener reacts to. Stopping
        // them explicitly on unload just makes that immediate instead
        // of waiting on GC/teardown timing.
        window.addEventListener("beforeunload", () => stream.getTracks().forEach((t) => t.stop()));
        window.opener.__classroomReceiveStream(stream, kind);
        setStatus("sharing");
      } catch (err) {
        const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        window.opener?.__classroomShareError?.(message);
        setErrorMessage(message);
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
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
      {status === "no-opener" && <p>Esta janela precisa ser aberta a partir da aula, na aba "Aulas".</p>}
    </div>
  );
}
