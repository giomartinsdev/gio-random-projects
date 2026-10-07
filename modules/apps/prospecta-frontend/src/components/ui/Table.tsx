import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Tabela de leads (poc.pen §V1): superfície + borda, cabeçalho mono em caps,
// linhas com hover. As larguras de coluna seguem o design.
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("card flex min-h-0 flex-1 flex-col overflow-hidden bg-surface", className)}>{children}</div>;
}

export function TableHead({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center border-b border-line px-5 py-3">{children}</div>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">{children}</div>;
}

export function TableRow({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center px-5 py-3 transition-colors",
        onClick && "cursor-pointer hover:bg-elevated",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cn("caps", className)}>{children}</div>;
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <div className={cn("min-w-0", className)}>{children}</div>;
}

// Avatar quadrado com iniciais (o "Fav" do design): raio 10, iniciais em
// accent-light mono.
export function Avatar({
  initials,
  size = 32,
  tone = "elevated",
  className,
}: {
  initials: string;
  size?: number;
  tone?: "elevated" | "accent";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-sm font-mono font-semibold",
        tone === "accent" ? "bg-accent-soft text-accent-light" : "bg-elevated text-accent-light",
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials}
    </span>
  );
}
