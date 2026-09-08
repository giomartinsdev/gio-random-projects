// The theme bridge with the hub (hub.giomartins.dev) while this app
// runs embedded in its renderer iframe. Cross-origin frames can't
// share a DOM, so the two sides talk postMessage:
//
// - hub → here: { type: "hub:theme", theme } -- the hub's toggle was
//   used (or a new frame just loaded); apply it and persist it, so a
//   later standalone visit starts where the hub left off.
// - here → hub: { type: "app:theme", theme } -- this app's own toggle
//   was used; the hub adopts it (see its Renderer/App).
//
// Copied from cch-frontend verbatim (no shared package in this repo).
import { setTheme, type Theme } from "@/lib/theme";

function trustedParent(origin: string): boolean {
  return (
    origin === "https://hub.giomartins.dev" || /^http:\/\/localhost(:\d+)?$/.test(origin)
  );
}

// Wire the listener up exactly once (App's useEffect). No-ops --
// and returns a no-op cleanup -- when running standalone, where
// there's no hub to sync with.
export function initHubThemeSync(): () => void {
  if (window.parent === window) return () => {};

  function onMessage(event: MessageEvent) {
    if (!trustedParent(event.origin)) return;
    const data = event.data as { type?: string; theme?: string } | null;
    if (data?.type !== "hub:theme") return;
    if (data.theme !== "light" && data.theme !== "dark") return;
    // setTheme, not a bare applyTheme: the toggle has to hear about
    // this too, or its icon goes stale and its next click is a no-op.
    setTheme(data.theme as Theme);
  }

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

// The toggle calls this after applying its new theme, so the hub (when
// we're embedded in it) follows along. targetOrigin is "*" because a
// child can't know its parent's origin, and the payload is inert.
export function broadcastTheme(theme: Theme) {
  if (window.parent === window) return;
  window.parent.postMessage({ type: "app:theme", theme }, "*");
}