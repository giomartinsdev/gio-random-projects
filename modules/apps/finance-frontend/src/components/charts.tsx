import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/api";

// Gráficos em SVG à mão, como no clubs-frontend: sem lib de chart, o design é
// autoral e as cores vêm dos tokens do tema (funcionam em claro e escuro).
// Séries são strings decimais do domínio; a conversão para número é só para
// posicionar pixels — nunca para re-somar dinheiro.

export interface Point {
  label: string;
  value: number; // em reais, já assinado (negativo = saída)
}

/** Barras do fluxo de caixa diário — no molde do ui.pen: largura fixa por barra,
 *  alturas respeitando a escala (orgânicas), saldos negativos com o cinza `down`
 *  e o pico do mês destacado com o `accent`; o resto neutro. Sem verde/vermelho
 *  gritados: preto e branco com hierarquia por tom. */
export function CashFlowBars({ points, height = 220 }: { points: Point[]; height?: number }) {
  const W = 720;
  const pad = { t: 16, r: 8, b: 28, l: 8 };
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const mid = pad.t + ih / 2;

  if (points.length === 0) {
    return <EmptyChart height={height} />;
  }
  const peak = Math.max(1, ...points.map((p) => Math.abs(p.value)));
  const slot = iw / points.length;
  const barW = Math.min(46, Math.max(3, slot * 0.55));
  const half = ih / 2 - 6;

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="Fluxo de caixa por dia">
      <line x1={pad.l} x2={W - pad.r} y1={mid} y2={mid} className="stroke-border" strokeWidth={1} />
      {points.map((p, i) => {
        const x = pad.l + i * slot + (slot - barW) / 2;
        const h = (Math.abs(p.value) / peak) * half;
        const positive = p.value >= 0;
        const y = positive ? mid - h : mid;
        // destaque: só o maior saldo do período recebe accent; negativos recebem down
        const isPeak = Math.abs(p.value) === peak && positive;
        const cls = !positive ? "fill-down" : isPeak ? "fill-accent-real" : "fill-line-strong";
        return (
          <g key={p.label}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={Math.max(1, h)}
              rx={3}
              className={cls}
            />
          </g>
        );
      })}
      <text x={pad.l} y={height - 8} className="fill-fg-dim font-mono" fontSize={9.5}>
        {points[0]?.label}
      </text>
      <text x={W - pad.r} y={height - 8} textAnchor="end" className="fill-fg-dim font-mono" fontSize={9.5}>
        {points[points.length - 1]?.label}
      </text>
    </svg>
  );
}

/** Barras horizontais de despesas por categoria (as maiores primeiro). */
export function CategoryBars({ points }: { points: Point[] }) {
  if (points.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Sem despesas neste mês.</p>;
  }
  const peak = Math.max(1, ...points.map((p) => Math.abs(p.value)));
  return (
    <ul className="space-y-3">
      {points.map((p) => {
        const pct = (Math.abs(p.value) / peak) * 100;
        return (
          <li key={p.label} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate">{p.label}</span>
              <span className="tnum shrink-0 text-muted-foreground">{formatBRL(String(Math.abs(p.value)))}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-fg/25" style={{ width: `${pct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Barra de progresso de orçamento com as réguas 50/80/100 marcadas. Tone p&b:
 *  até 80% usa `up` (cinza claro), 80–100% `warn`, >=100% `down`. */
export function BudgetBar({ spent, limit }: { spent: number; limit: number }) {
  const ratio = limit > 0 ? Math.min(1.2, Math.abs(spent) / limit) : 0;
  const pct = Math.min(100, ratio * 100);
  const tone = ratio >= 1 ? "bg-down" : ratio >= 0.8 ? "bg-warn" : "bg-up";
  return (
    <div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />
      {[50, 80].map((m) => (
        <span
          key={m}
          className="absolute top-0 h-full w-px bg-background/70"
          style={{ left: `${m}%` }}
          aria-hidden
        />
      ))}
    </div>
  );
}

function EmptyChart({ height }: { height: number }) {
  return (
    <div style={{ height }} className="flex items-center justify-center rounded-md border border-dashed">
      <span className="text-sm text-muted-foreground">Sem movimentação neste mês.</span>
    </div>
  );
}
