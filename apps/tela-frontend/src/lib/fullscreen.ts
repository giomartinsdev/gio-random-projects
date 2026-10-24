// Real fullscreen via the Fullscreen API. The fullscreen-tile overlay is
// absolute inside the page's <main>, which leaves the browser's own bars
// on screen; putting the element in actual fullscreen hides the browser
// chrome too. WebKit prefixed these APIs until Safari 16.4, and iOS
// Safari never exposed element fullscreen at all -- there the tile just
// stays the in-page overlay it always was.
type AnyElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
type AnyDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

export function isFullscreen(): boolean {
  const d = document as AnyDocument;
  return !!(document.fullscreenElement ?? d.webkitFullscreenElement);
}

export function fullscreenChangeEventName(): string {
  return typeof document.exitFullscreen === "function" ? "fullscreenchange" : "webkitfullscreenchange";
}

// Must be called from inside a user gesture (the tile's click handler);
// anything else and the browser refuses -- which lands in the catch, and
// the tile carries on as the plain page overlay.
export async function enterFullscreen(el: HTMLElement): Promise<void> {
  const anyEl = el as AnyElement;
  try {
    if (typeof anyEl.requestFullscreen === "function") await anyEl.requestFullscreen();
    else await anyEl.webkitRequestFullscreen?.();
  } catch {
    // Refused (lost gesture, iframe blocked, user pressed Esc racing the
    // request) -- nothing to clean up, the overlay didn't depend on it.
  }
}

export async function exitFullscreen(): Promise<void> {
  if (!isFullscreen()) return;
  const d = document as AnyDocument;
  try {
    if (typeof document.exitFullscreen === "function") await document.exitFullscreen();
    else await d.webkitExitFullscreen?.();
  } catch {
    // Already leaving, or the browser refused -- the state effects
    // reconcile the overlay either way.
  }
}