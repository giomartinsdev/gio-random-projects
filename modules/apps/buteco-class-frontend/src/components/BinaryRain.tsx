import { useEffect, useRef } from "react";

const GLYPHS = ["0", "1", "01", "10", "11", "00"];

type Particle = {
  el: HTMLSpanElement;
  duration: number;
  peak: number;
  // First-assign timestamp; null also marks "seed with initialProgress
  // on the first visible frame" so the opening paint is already dense.
  start: number | null;
  initialProgress: number;
};

// Ambient "0/1" particles falling behind the page content, same visual
// language as website-butecodosdev's hero. Pure rAF + DOM (no canvas,
// no animation library) so it stays cheap to run on every page. One
// single rAF loop drives the whole pool (each particle getting its own
// callback was 50 timers that all fought compositor deadlines), kept
// subtle: fewer, dimmer, smaller glyphs -- background texture, not a
// lava lamp. Respects prefers-reduced-motion and pauses via
// IntersectionObserver when out of view.
export default function BinaryRain({
  count = 26,
  minDurationMs = 5000,
  maxDurationMs = 11000,
  opacity = 0.07,
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
    let raf = 0;

    function restyle(p: Particle) {
      p.duration = minDurationMs + Math.random() * (maxDurationMs - minDurationMs);
      p.peak = opacity * (0.5 + Math.random() * 0.5);
      p.el.textContent = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      p.el.style.left = `${Math.random() * 100}%`;
      p.el.style.fontSize = `${9 + Math.random() * 3}px`;
    }

    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const el = document.createElement("span");
      el.className = "absolute top-0 font-mono text-buteco-amber select-none will-change-transform";
      container.appendChild(el);
      const p: Particle = { el, duration: 0, peak: 0, start: null, initialProgress: Math.random() };
      restyle(p);
      particles.push(p);
    }

    function tick(ts: number) {
      if (disposed) return;
      raf = requestAnimationFrame(tick);
      if (!visible) return;

      const height = container!.offsetHeight || window.innerHeight;
      for (const p of particles) {
        if (p.start === null) p.start = ts - p.initialProgress * p.duration;
        const t = (ts - p.start) / p.duration;
        if (t >= 1) {
          restyle(p);
          p.start = ts;
          continue;
        }
        p.el.style.transform = `translateY(${t * (height + 40) - 20}px)`;
        p.el.style.opacity =
          t < 0.1 ? String((t / 0.1) * p.peak) : t > 0.85 ? String(p.peak * (1 - (t - 0.85) / 0.15)) : String(p.peak);
      }
    }
    raf = requestAnimationFrame(tick);

    const observer = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting), { threshold: 0 });
    observer.observe(container);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      particles.forEach((p) => p.el.remove());
    };
  }, [count, minDurationMs, maxDurationMs, opacity]);

  return <div ref={containerRef} className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true" />;
}