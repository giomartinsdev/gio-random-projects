import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("card flex min-h-0 flex-1 flex-col overflow-hidden bg-surface", className)}>{children}</div>;
}

export function TableHead({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center border-b border-line px-5 py-3">{children}</div>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">{children}</div>;
}

export function TableRow({
  children,
  className,
  onClick,
  selected,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  selected?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-0 border-b border-line/60 px-5 py-3 transition-colors last:border-0",
        onClick && "cursor-pointer hover:bg-elevated",
        selected && "bg-elevated",
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
