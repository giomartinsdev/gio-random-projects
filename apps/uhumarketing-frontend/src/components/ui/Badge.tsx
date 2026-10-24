import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Orb, type OrbState } from "./Orb";

// Pílula com dot — o StatusBadge do prospecta, com tons a mais para os estados
// de campanha/template/envio.
export type BadgeTone = "accent" | "success" | "warn" | "danger" | "muted" | "purple";

const TONE: Record<BadgeTone, { wrap: string; dot: string; text: string }> = {
  accent: { wrap: "bg-accent-soft", dot: "bg-accent", text: "text-accent-light" },
  success: { wrap: "bg-success-soft", dot: "bg-success", text: "text-success" },
  warn: { wrap: "bg-warn-soft", dot: "bg-warn", text: "text-warn" },
  danger: { wrap: "bg-danger-soft", dot: "bg-danger", text: "text-danger" },
  muted: { wrap: "bg-elevated", dot: "bg-fg-2", text: "text-fg-2" },
  purple: { wrap: "bg-[#231C33]", dot: "bg-[#A78BFA]", text: "text-[#C4B5FD]" },
};

export function StatusBadge({
  tone = "muted",
  children,
  className,
  dot = true,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  const t = TONE[tone];
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium",
        t.wrap,
        t.text,
        className,
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} />}
      {children}
    </span>
  );
}

export function AgentBadge({
  label,
  state = "idle",
  className,
}: {
  label: string;
  state?: OrbState;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1.5", className)}>
      <Orb state={state} size={14} glow={false} />
      <span className="text-[13px] font-semibold text-accent-light">{label}</span>
    </span>
  );
}

/** Etiqueta neutra (categoria, canal) — sem dot, para não competir com status. */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-xs border border-line bg-bg px-1.5 py-0.5 font-mono text-[11px] text-fg-2",
        className,
      )}
    >
      {children}
    </span>
  );
}
