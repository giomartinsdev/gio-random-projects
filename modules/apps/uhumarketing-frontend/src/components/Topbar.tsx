import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Topbar das telas, como no prospecta: borda inferior, título 18/600 e ações.
export function Topbar({
  title,
  left,
  right,
  className,
}: {
  title: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex shrink-0 items-center justify-between gap-4 border-b border-line px-7 py-4", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {left}
        <h1 className="truncate text-[18px] font-semibold text-fg">{title}</h1>
      </div>
      {right && <div className="flex shrink-0 items-center gap-3">{right}</div>}
    </header>
  );
}

/** Corpo padrão de tela: rola por dentro, padding do design. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto scroll-thin px-7 pb-7 pt-6", className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-[26px] font-semibold tracking-tight text-fg">{title}</h2>
        {description && <p className="max-w-2xl text-[14px] leading-snug text-fg-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
    </div>
  );
}

/** Rodapé informativo dentro de um card (o "Informativo" do prospecta). */
export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("rounded-sm bg-bg px-3.5 py-2.5 text-[12px] leading-snug text-fg-3", className)}>{children}</p>
  );
}
