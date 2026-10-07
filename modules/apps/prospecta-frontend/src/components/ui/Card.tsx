import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Orb, type OrbState } from "./Orb";

// Card genérico de superfície (raio 14, borda 1px) — a base de tudo.
export function Card({
  children,
  className,
  elevated = false,
}: {
  children: ReactNode;
  className?: string;
  elevated?: boolean;
}) {
  return (
    <section className={cn("card", elevated ? "bg-elevated" : "bg-surface", className)}>{children}</section>
  );
}

export function CardHead({ title, right, className }: { title: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      {right}
    </div>
  );
}

// Card/AgentTask (poc.pen §V1): orb + título/duração, texto da tarefa e barra
// de progresso. Usado no painel de agentes do Cockpit e no feed.
export function AgentTaskCard({
  title,
  state = "prospecting",
  meta,
  text,
  progress,
  className,
}: {
  title: string;
  state?: OrbState;
  meta?: string;
  text?: string;
  progress?: number;
  className?: string;
}) {
  return (
    <Card className={cn("w-[340px] p-5", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Orb state={state} size={20} glow={false} />
          <span className="text-[15px] font-semibold text-fg">{title}</span>
        </div>
        {meta && <span className="font-mono text-[12px] text-fg-3">{meta}</span>}
      </div>
      {text && <p className="mt-3.5 text-[14px] leading-normal text-fg-2">{text}</p>}
      {progress != null && (
        <div className="mt-3.5 h-1.5 w-full overflow-hidden rounded-full bg-bg">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      )}
    </Card>
  );
}
