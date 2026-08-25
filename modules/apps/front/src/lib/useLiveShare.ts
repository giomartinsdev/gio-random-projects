import { useRef, useState } from "react";
import { getDiscordBearerToken } from "./discordAuthToken.js";
import { isDiscordActivity, openExternalLink } from "./discordActivity.js";

// Starting/stopping the host's screen or camera share. The capture
// itself does NOT happen here -- it happens in a separate top-level
// window (pages/SharePopup.tsx), for two independent reasons, both
// confirmed live inside a real Discord Activity:
//
//   1. getDisplayMedia rejects immediately with "not granted" --
//      Discord doesn't delegate the display-capture
//      Permissions-Policy feature to the Activity iframe.
//   2. `new RTCPeerConnection()` throws "RTCPeerConnection is not a
//      constructor" -- Discord removes WebRTC from the iframe
//      entirely, so peer-to-peer video can't work in either
//      direction, viewer side included.
//
// So the popup captures, encodes to JPEG, and pushes frames over the
// room's own WebSocket; this page only ever receives them (see
// useClassSocket's `frame`/`sharing`). Everything the Activity itself
// touches -- WebSocket, <img> -- is allowed there.
export function useLiveShare(opts: {
  roomId: string;
  you: { userId: string; userName: string } | null;
  stopShare: () => void;
}) {
  const { roomId, you, stopShare } = opts;
  const popupRef = useRef<Window | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(kind: "screen" | "camera") {
    setError(null);
    if (!you) {
      setError("Aguarde a conexão terminar antes de compartilhar.");
      return;
    }

    const params = new URLSearchParams({ kind, roomId });
    // The popup is a separate page load that never runs the Discord
    // auth handshake, so it can't read the module-level bearer token
    // (see discordAuthToken.ts) -- it has to be handed one.
    const token = getDiscordBearerToken();
    if (token) params.set("token", token);

    // NOT window.location.origin: inside a Discord Activity that's
    // Discord's proxy origin (https://<app_id>.discordsays.com), which
    // only resolves within the Activity iframe -- useless as a URL for
    // a real browser window.
    const origin = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) || window.location.origin;
    const url = `${origin}/share-popup?${params.toString()}`;

    const popup = window.open(url, "classroom-share-popup", "width=520,height=400");
    popupRef.current = popup;
    if (popup) return;

    // Fallback for when the Activity iframe's sandbox blocks
    // window.open: hand the URL to Discord's client instead. Raced
    // against a timeout because this RPC has been observed never
    // settling at all inside an Activity.
    if (isDiscordActivity()) {
      const opened = await Promise.race([
        openExternalLink(url),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
      ]);
      if (opened) return;
    }

    console.error("[classroom] could not open the share window for", url);
    setError("Não foi possível abrir a janela de compartilhamento. Permita pop-ups para este site e tente de novo.");
  }

  function stop() {
    // Tells the popup to shut down (it listens for share:stop), then
    // closes it directly too when we still hold a handle -- the
    // openExternalLink fallback gives us none, hence both paths.
    stopShare();
    popupRef.current?.close();
    popupRef.current = null;
  }

  return { start, stop, error };
}
