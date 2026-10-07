import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Orb, type OrbState } from "./Orb";

// Badge/Agent (poc.pen §V1): pílula accent-soft (raio pill, padding [6,12]) com
// orb + label 13/600 em acento. O orb mantém o estado do agente.
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

// Pílula de status com dot (Qualificado/Respondeu/Abordado…), tons do design.
export type BadgeTone = "accent" | "success" | "muted";

const TONE: Record<BadgeTone, { wrap: string; dot: string; text: string }> = {
  accent: { wrap: "bg-accent-soft", dot: "bg-accent", text: "text-accent-light" },
  success: { wrap: "bg-success-soft", dot: "bg-success", text: "text-success" },
  muted: { wrap: "bg-elevated", dot: "bg-fg-2", text: "text-fg-2" },
};

export function StatusBadge({
  tone = "muted",
  children,
  className,
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  return (
    <span className={cn("inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium", t.wrap, t.text, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", t.dot)} />
      {children}
    </span>
  );
}
