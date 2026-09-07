import { useMemo } from "react";
import { motion } from "framer-motion";

// A one-shot burst of paper bits -- no library, gone after about a
// second and a half. Render inside a relatively-positioned parent (the
// winner card, the game-over banner, the forge's publish success).
const CONFETTI_COLORS = ["#facc15", "#3b82f6", "#ec4899", "#22c55e", "#a855f7", "#f97316"];

export function Confetti({ count = 26 }: { count?: number }) {
  // Generated once per mount: a re-render must not re-roll the pieces
  // mid-flight.
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 220,
        peak: -(60 + Math.random() * 110),
        rotate: (Math.random() - 0.5) * 540,
        delay: Math.random() * 0.25,
        duration: 1.1 + Math.random() * 0.7,
        size: 5 + Math.random() * 5,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      })),
    [count],
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          initial={{ x: 0, y: 8, opacity: 1, rotate: 0 }}
          animate={{ x: p.x, y: [8, p.peak, p.peak + 150], opacity: [1, 1, 0], rotate: p.rotate }}
          transition={{ duration: p.duration, delay: p.delay, times: [0, 0.35, 1], ease: "easeOut" }}
          style={{
            position: "absolute",
            left: "50%",
            top: "45%",
            width: p.size,
            height: p.size * 0.6,
            backgroundColor: p.color,
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}