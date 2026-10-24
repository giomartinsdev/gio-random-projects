import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Orb, type OrbState } from "./Orb";

export function Card({
  children,
  className,
  elevated = false,
}: {
  children: ReactNode;
  className?: string;
  elevated?: boolean;
}) {
  return <section className={cn("card", elevated ? "bg-elevated" : "bg-surface", className)}>{children}</section>;
}

export function CardHead({
  title,
  subtitle,
  right,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
        {subtitle && <p className="text-[12px] leading-snug text-fg-3">{subtitle}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

/**
 * Cartão de métrica do topo das telas. `trend` é a variação percentual contra
 * o período anterior; null esconde a linha (quando não há base de comparação).
 */
export function StatCard({
  label,
  value,
  hint,
  trend,
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  trend?: number | null;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-1 flex-col gap-3 p-[18px]", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-fg-2">{label}</span>
        {icon && <span className="text-fg-3">{icon}</span>}
      </div>
      <span className="text-[28px] font-semibold leading-none tracking-tight text-fg">{value}</span>
      <div className="flex items-center gap-2">
        {trend != null && (
          <span
            className={cn(
              "font-mono text-[12px] font-medium",
              trend > 0 ? "text-success" : trend < 0 ? "text-danger" : "text-fg-3",
            )}
          >
            {trend > 0 ? "+" : ""}
            {trend.toFixed(1).replace(".", ",")}%
          </span>
        )}
        {hint && <span className="truncate text-[12px] text-fg-3">{hint}</span>}
      </div>
    </Card>
  );
}

/**
 * Cartão de "motor" (o AgentTaskCard do prospecta): orb + título + progresso.
 * Usado no dashboard para o que está rodando agora e na lista de fluxos.
 */
export function EngineCard({
  title,
  state = "running",
  meta,
  text,
  progress,
  className,
  right,
}: {
  title: string;
  state?: OrbState;
  meta?: string;
  text?: string;
  progress?: number;
  className?: string;
  right?: ReactNode;
}) {
  return (
    <Card className={cn("flex flex-col gap-3 p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Orb state={state} size={18} glow={false} />
          <span className="truncate text-[14px] font-semibold text-fg">{title}</span>
        </div>
        {right ?? (meta && <span className="shrink-0 font-mono text-[11px] text-fg-3">{meta}</span>)}
      </div>
      {text && <p className="text-[13px] leading-snug text-fg-2">{text}</p>}
      {progress != null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg">
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
          />
        </div>
      )}
    </Card>
  );
}
