import { cn } from "@/lib/utils";

export type OrbState = "idle" | "prospecting" | "researching" | "writing";

// "Motion orb": latch 3x3 de 9 pontos. O núcleo/estado aceso (opacity 1)
// muda por estado; os vizinhos ficam ~0.3. Tamanhos e posições do núcleo
// (índice row-major) saem direto do poc.pen §V1 (Orb/Idle…Orb/Writing).
const SPEC: Record<OrbState, { size: number; node: number; core: number; lit: number }> = {
  idle: { size: 20, node: 3, core: 4.05, lit: 4 },
  prospecting: { size: 28, node: 4.2, core: 5.67, lit: 3 },
  researching: { size: 28, node: 4.2, core: 5.67, lit: 5 },
  writing: { size: 28, node: 4.2, core: 5.67, lit: 8 },
};

export function Orb({
  state = "idle",
  size,
  color = "#7DA6FF",
  glow = true,
  className,
}: {
  state?: OrbState;
  size?: number;
  color?: string;
  glow?: boolean;
  className?: string;
}) {
  const spec = SPEC[state];
  const box = size ?? spec.size;
  const scale = box / spec.size;
  const node = spec.node * scale;
  const core = spec.core * scale;

  return (
    <span
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: box, height: box, gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(3, 1fr)" }}
      role="img"
      aria-label={`agente ${state}`}
    >
      {glow && (
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ width: box * 1.6, height: box * 1.6, background: "radial-gradient(circle, #2563EB 0%, transparent 70%)", opacity: 0.55 }}
        />
      )}
      {Array.from({ length: 9 }, (_, i) => {
        const lit = i === spec.lit;
        const d = lit ? core : node;
        return (
          <span
            key={i}
            className={cn("block rounded-full", lit && (state === "idle" ? "animate-orb-pulse" : ""))}
            style={{
              width: d,
              height: d,
              background: color,
              opacity: lit ? 1 : 0.3,
              boxShadow: lit ? `0 0 6px ${color}` : undefined,
            }}
          />
        );
      })}
    </span>
  );
}
