import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";

type Tone = "neutral" | "amber" | "live" | "muted" | "outline";

const toneClasses: Record<Tone, string> = {
  neutral: "bg-white/10 text-buteco-cream/80 border-white/10",
  amber: "bg-buteco-amber/15 text-buteco-amber-light border-buteco-amber/30",
  // "Ao vivo" -- pulsing amber dot on a warm fill.
  live: "bg-buteco-amber/15 text-buteco-amber-light border-buteco-amber/40",
  muted: "bg-transparent text-buteco-cream/50 border-white/10",
  outline: "bg-transparent text-buteco-amber border-buteco-amber/40",
};

// Small mono pill used for statuses (Encerrada, Rascunho), post types
// and "ao vivo". tone="live" renders the pulsing dot automatically.
export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span
      {...(title ? { title } : {})}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[0.65rem] uppercase tracking-wide whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
    >
      {tone === "live" && <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-buteco-amber animate-live-pulse" />}
      {children}
    </span>
  );
}

export default Badge;