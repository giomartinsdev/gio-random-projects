import { useEffect, useRef } from "react";

const GLYPHS = ["0", "1", "01", "10", "11", "00"];

// Ambient "0/1" particles falling behind the page content, same visual
// language as website-butecodosdev's hero. Pure rAF + DOM (no canvas,
// no animation library) so it stays cheap to run on every page, not
// just a one-off hero section. Respects prefers-reduced-motion and
// pauses via IntersectionObserver when scrolled out of view.
export default function BinaryRain({
  count = 50,
  minDurationMs = 4000,
  maxDurationMs = 9000,
  opacity = 0.12,
}: {
  count?: number;
  minDurationMs?: number;
  maxDurationMs?: number;
  opacity?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let disposed = false;
    let visible = true;
    const frames = new Set<number>();

    // initialProgress spreads particles across the full fall cycle so
    // the rain is already dense on the very first frame, instead of
    // every particle fading in from zero together.
    function spawn(el: HTMLSpanElement, initialProgress = 0) {
      const duration = minDurationMs + Math.random() * (maxDurationMs - minDurationMs);
      const peak = opacity * (0.5 + Math.random() * 0.5);
      el.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      el.style.left = `${Math.random() * 100}%`;
      el.style.fontSize = `${10 + Math.random() * 14}px`;

      let start: number | null = null;

      function frame(ts: number) {
        if (disposed) return;
        if (!visible) {
          frames.add(requestAnimationFrame(frame));
          return;
        }
        if (start === null) start = ts - initialProgress * duration;
        const t = Math.min((ts - start) / duration, 1);
        const height = container!.offsetHeight || window.innerHeight;
        el.style.transform = `translateY(${t * (height + 40) - 20}px)`;
        el.style.opacity =
          t < 0.1 ? String((t / 0.1) * peak) : t > 0.85 ? String(peak * (1 - (t - 0.85) / 0.15)) : String(peak);

        if (t >= 1) {
          spawn(el);
          return;
        }
        frames.add(requestAnimationFrame(frame));
      }

      frames.add(requestAnimationFrame(frame));
    }

    const spans: HTMLSpanElement[] = [];
    for (let i = 0; i < count; i++) {
      const span = document.createElement("span");
      span.className = "absolute top-0 font-mono text-buteco-amber select-none will-change-transform";
      container.appendChild(span);
      spans.push(span);
      spawn(span, Math.random());
    }

    const observer = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting), { threshold: 0 });
    observer.observe(container);

    return () => {
      disposed = true;
      observer.disconnect();
      frames.forEach(cancelAnimationFrame);
      spans.forEach((s) => s.remove());
    };
  }, [count, minDurationMs, maxDurationMs, opacity]);

  return <div ref={containerRef} className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true" />;
}
