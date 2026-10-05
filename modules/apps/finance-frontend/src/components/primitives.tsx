import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Peças de apresentação do cockpit — replicam os componentes do seuimposto
// (`.card`, `.hd`, `.kick`, `.kpi`, `.fig`, `.sent`, `.bar`, `.row`, `.ev`).

export function Card({
  title,
  right,
  children,
  className,
  onClick,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <section className={cn("card", onClick && "cursor-pointer transition-colors hover:border-fg/20", className)} onClick={onClick}>
      {(title || right) && (
        <div className="hd">
          {title && <h3>{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

// KPI: rótulo miúdo + valor.
export function Kpi({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="kpi">
      <div className="k">{label}</div>
      <div className={cn("v tnum", tone === "up" && "text-up", tone === "down" && "text-down")}>{value}</div>
    </div>
  );
}

// Cabeçalho de seção (eyebrow + título serifa grande + ação).
export function PageHead({
  kick,
  title,
  sub,
  right,
}: {
  kick?: string;
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        {kick && <div className="kick mb-1">{kick}</div>}
        <h2 className="sent">{title}</h2>
        {sub && <p className="mt-0.5 text-[12px] dim">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="py-8 text-center text-[13px] dim">{text}</p>;
}

// Barra de progresso com valor (réguas/metas do original `.goal/.gb`).
export function Progress({ used, total, tone }: { used: number; total: number; tone?: string }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const color = tone ?? (pct >= 100 ? "hsl(var(--down))" : pct >= 80 ? "hsl(var(--warn))" : "hsl(var(--accent))");
  return (
    <div className="bar">
      <i style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

// Três colunas fixas (rail esquerdo, canvas central, rail direito) — o
// `.col.l` / centro / `.col.r` do original. Sem scroll de página; cada coluna
// rola por dentro.
export function Cockpit({
  left,
  center,
  right,
}: {
  left?: ReactNode;
  center: ReactNode;
  right?: ReactNode;
}) {
  return (
    // Espaço de segurança: as colunas não colam nas bordas da janela — padding
    // generoso (px-5 py-4) + gutters maiores entre os rails. Em telas menores
    // os rails somem e o centro respira no mesmo padding.
    <div className="grid h-full grid-cols-1 gap-4 overflow-hidden px-5 py-4 md:px-7 md:py-5 lg:grid-cols-[300px_minmax(0,1fr)_300px] lg:gap-5 xl:px-8">
      {left && <aside className="hidden min-h-0 flex-col gap-4 overflow-y-auto scroll-thin pr-1 lg:flex">{left}</aside>}
      <main className="min-h-0 overflow-y-auto scroll-thin pb-8">{center}</main>
      {right && <aside className="hidden min-h-0 flex-col gap-4 overflow-y-auto scroll-thin pr-1 xl:flex">{right}</aside>}
    </div>
  );
}
