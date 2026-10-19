import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function LoadingState({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-3 p-10 text-fg-2">
      <Loader2 size={20} className="animate-spin text-accent-light" />
      <span className="text-[14px]">{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  icon,
  className,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 p-10 text-center", className)}>
      {icon && (
        <span className="grid h-11 w-11 place-items-center rounded-full bg-elevated text-fg-3">{icon}</span>
      )}
      <span className="text-[14px] font-medium text-fg-2">{title}</span>
      {hint && <span className="max-w-sm text-[13px] leading-snug text-fg-3">{hint}</span>}
      {action}
    </div>
  );
}
