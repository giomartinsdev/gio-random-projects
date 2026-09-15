import { useEffect } from "react";

// Draws the tab's favicon on a canvas: the app's blue tile with a tiny
// screen glyph on it, plus a red badge while there's a live stream
// anywhere in the room. index.html ships no icon at all, so this hook
// owns the whole thing -- it creates the <link rel="icon"> if the
// document has none and swaps the drawn data URL whenever `live`
// changes. A background tab is how most people actually watch this
// app, and the dot is the only signal it gets.
function drawFavicon(live: boolean): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const rrect = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  };
  // The tile, and a little screen on it.
  rrect(0, 0, 64, 64, 14);
  ctx.fillStyle = "#3b82f6";
  ctx.fill();
  rrect(12, 19, 40, 26, 5);
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.fill();
  ctx.fillRect(26, 49, 12, 3);
  if (live) {
    // Ring in the page's own background color so the badge reads
    // against both the glyph and the browser's tab strip.
    ctx.beginPath();
    ctx.arc(49, 15, 11, 0, Math.PI * 2);
    ctx.fillStyle = "#ef4444";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#0a0a0b";
    ctx.stroke();
  }
  return canvas.toDataURL("image/png");
}

export function useLiveFavicon(live: boolean) {
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = drawFavicon(live);
  }, [live]);
}