import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Topbar das telas (poc.pen §V1): altura implícita, padding [16,28], borda
// inferior, título 18/600 à esquerda e ações à direita.
export function Topbar({
  title,
  left,
  right,
  className,
}: {
  title: string;
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex shrink-0 items-center justify-between gap-4 border-b border-line px-7 py-4", className)}>
      <div className="flex items-center gap-3">
        {left}
        <h1 className="text-[18px] font-semibold text-fg">{title}</h1>
      </div>
      {right && <div className="flex items-center gap-3">{right}</div>}
    </header>
  );
}
