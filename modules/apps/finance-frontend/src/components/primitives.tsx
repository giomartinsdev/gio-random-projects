import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Peças de apresentação compartilhadas — dão o ar editorial/denso (título em
// serifa, "eyebrow" em caixa alta, valores tabulares) sem repetir classes.

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="text-2xl leading-tight">{title}</h1>
        {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Panel({
  title,
  eyebrow,
  action,
  children,
  className,
  onClick,
}: {
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-card p-5",
        onClick && "cursor-pointer transition-colors hover:border-primary/40",
        className,
      )}
      onClick={onClick}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            {eyebrow && <p className="eyebrow mb-0.5">{eyebrow}</p>}
            {title && <h2 className="text-[15px]">{title}</h2>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  delta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  delta?: string;
  tone?: "neutral" | "income" | "expense";
}) {
  const toneClass =
    tone === "income" ? "text-success" : tone === "expense" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="eyebrow">{label}</p>
      <p className={cn("tnum mt-1.5 text-xl", toneClass)}>{value}</p>
      {delta && <p className="mt-0.5 text-[12px] text-muted-foreground">{delta}</p>}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center text-[13px] text-muted-foreground">{text}</p>;
}
