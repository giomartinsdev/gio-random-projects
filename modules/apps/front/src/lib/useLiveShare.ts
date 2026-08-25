import { getDiscordBearerToken } from "./discordAuthToken.js";

// Builds the URL of the capture window and nothing more -- the window
// is opened by a real <a target="_blank"> the user clicks (see
// AulaRoom.tsx), deliberately NOT by window.open().
//
// The capture can't run in the Discord Activity's iframe at all. Two
// independent blockers, both confirmed live:
//
//   1. getDisplayMedia rejects instantly with "not granted" -- Discord
//      doesn't delegate the display-capture Permissions-Policy
//      feature to the iframe.
//   2. `new RTCPeerConnection()` throws "RTCPeerConnection is not a
//      constructor" -- Discord removes WebRTC outright, so
//      peer-to-peer video is impossible in either direction, viewer
//      side included.
//
// So capture happens in a separate top-level window
// (pages/SharePopup.tsx) that pushes JPEG frames over the room's
// WebSocket, and this page only receives them.
//
// Why an anchor and not window.open: Discord intercepts programmatic
// window.open inside an Activity and routes it through its own
// proxy-ticket flow, which was observed failing with a 403 -- leaving
// a Window handle that never navigates anywhere and no error to react
// to. A plain user-clicked link is the path Discord actually supports
// for leaving an Activity, and it works identically on the plain site.
// The cost is that we hold no Window handle, so stopping a share goes
// over the WebSocket instead (the popup closes itself on share:stop).
export function useLiveShare(opts: {
  roomId: string;
  stopShare: () => void;
}) {
  const { roomId, stopShare } = opts;

  function shareUrl(kind: "screen" | "camera"): string {
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
    return `${origin}/share-popup?${params.toString()}`;
  }

  return { shareUrl, stop: stopShare };
}
