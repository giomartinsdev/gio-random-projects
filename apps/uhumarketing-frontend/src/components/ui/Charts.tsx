import { useId, useMemo, useState } from "react";
import { compact, num } from "@/lib/format";

// Gráficos em SVG à mão — mesma abordagem do clubs/prospecta: sem biblioteca,
// porque o desenho é autoral e a lib só atrapalharia. Dois: linha multi-série
// com crosshair e barras empilhadas simples.

const PALETTE = ["#2563EB", "#7DA6FF", "#16A34A", "#D97706", "#A78BFA"];

export interface Series {
  label: string;
  values: number[];
  color?: string;
}

export function LineChart({
  series,
  labels,
  height = 220,
  yFormat = compact,
  showLegend = true,
}: {
  series: Series[];
  labels: string[];
  height?: number;
  yFormat?: (v: number) => string;
  showLegend?: boolean;
}) {
  const gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const W = 760;
  const pad = { t: 14, r: 12, b: 26, l: 44 };
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;

  const count = series[0]?.values.length ?? 0;

  const { min, max } = useMemo(() => {
    const all = series.flatMap((s) => s.values);
    if (!all.length) return { min: 0, max: 1 };
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    if (lo === hi) return { min: Math.max(0, lo - 1), max: hi + 1 };
    const padY = (hi - lo) * 0.18;
    return { min: Math.max(0, lo - padY), max: hi + padY };
  }, [series]);

  if (!count) {
    return <div className="px-4 py-10 text-center text-[13px] text-fg-3">sem dados no período</div>;
  }

  const xOf = (i: number) => (count === 1 ? pad.l + iw / 2 : pad.l + (i / (count - 1)) * iw);
  const yOf = (v: number) => pad.t + ih - ((v - min) / (max - min || 1)) * ih;

  const ticks = [min, min + (max - min) / 2, max];
  const labelEvery = Math.max(1, Math.ceil(count / 7));

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="relative w-full">
        <svg
          viewBox={`0 0 ${W} ${height}`}
          className="w-full"
          role="img"
          aria-label="gráfico de evolução"
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            {series.map((s, si) => (
              <linearGradient key={si} id={`g${gid}${si}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color ?? PALETTE[si]} stopOpacity="0.26" />
                <stop offset="100%" stopColor={s.color ?? PALETTE[si]} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>

          {ticks.map((t, i) => (
            <g key={i}>
              <line stroke="#26262B" strokeWidth="1" x1={pad.l} y1={yOf(t)} x2={W - pad.r} y2={yOf(t)} />
              <text x={pad.l - 7} y={yOf(t) + 3.5} textAnchor="end" fontSize="10" fill="#6E6E76">
                {yFormat(Math.round(t))}
              </text>
            </g>
          ))}

          {series.map((s, si) => {
            const color = s.color ?? PALETTE[si];
            const path = s.values.map((v, i) => `${i ? "L" : "M"} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(" ");
            const area = `${path} L ${xOf(count - 1).toFixed(1)} ${(pad.t + ih).toFixed(1)} L ${xOf(0).toFixed(
              1,
            )} ${(pad.t + ih).toFixed(1)} Z`;
            return (
              <g key={s.label}>
                {si === 0 && <path d={area} fill={`url(#g${gid}${si})`} />}
                <path d={path} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}

          {labels.map((l, i) =>
            i % labelEvery === 0 || i === count - 1 ? (
              <text key={i} x={xOf(i)} y={height - 7} textAnchor="middle" fontSize="10" fill="#6E6E76">
                {l}
              </text>
            ) : null,
          )}

          {/* Crosshair + pontos: um hit-area por índice, largura igual. */}
          {series.map((s) => (
            <path
              key={`hit-${s.label}`}
              d={s.values.map((v, i) => `${i ? "L" : "M"} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(" ")}
              fill="none"
              stroke="transparent"
              strokeWidth="14"
            />
          ))}
          {Array.from({ length: count }, (_, i) => (
            <rect
              key={`r${i}`}
              x={xOf(i) - iw / (count - 1 || 1) / 2}
              y={pad.t}
              width={iw / (count - 1 || 1)}
              height={ih}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}

          {hover !== null && (
            <g>
              <line
                x1={xOf(hover)}
                y1={pad.t}
                x2={xOf(hover)}
                y2={pad.t + ih}
                stroke="#33333A"
                strokeDasharray="3 3"
              />
              {series.map((s, si) => (
                <circle
                  key={s.label}
                  cx={xOf(hover)}
                  cy={yOf(s.values[hover] ?? 0)}
                  r="3.5"
                  fill={s.color ?? PALETTE[si]}
                  stroke="#0B0B0D"
                  strokeWidth="2"
                />
              ))}
            </g>
          )}
        </svg>

        {hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[140px] rounded-sm border border-line bg-elevated p-2.5 shadow-card"
            style={{
              left: `${(xOf(hover) / W) * 100}%`,
              transform: hover > count / 2 ? "translateX(-110%)" : "translateX(10%)",
            }}
          >
            <div className="mb-1.5 border-b border-line pb-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-3">
              {labels[hover]}
            </div>
            {series.map((s, si) => (
              <div key={s.label} className="flex items-center justify-between gap-3 py-0.5">
                <span className="flex items-center gap-1.5 text-[11px] text-fg-2">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color ?? PALETTE[si] }} />
                  {s.label}
                </span>
                <span className="font-mono text-[11px] text-fg">{num(s.values[hover] ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showLegend && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
          {series.map((s, si) => (
            <span key={s.label} className="flex items-center gap-1.5 text-[12px] text-fg-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color ?? PALETTE[si] }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Barra horizontal de proporção — para "funil" e distribuições. */
export function FunnelRow({
  label,
  value,
  total,
  color = "#2563EB",
  hint,
}: {
  label: string;
  value: number;
  total: number;
  color?: string;
  hint?: string;
}) {
  const ratio = total ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-fg-2">{label}</span>
        <span className="font-mono text-[12px] text-fg">
          {num(value)}
          {hint && <span className="ml-1.5 text-fg-3">{hint}</span>}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-bg">
        <div className="h-full rounded-full transition-[width]" style={{ width: `${ratio}%`, background: color }} />
      </div>
    </div>
  );
}

/** Minigráfico de sparkline para cartões — sem eixo nem tooltip. */
export function Sparkline({ values, color = "#7DA6FF", height = 28 }: { values: number[]; color?: string; height?: number }) {
  const W = 96;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const path = values
    .map((v, i) => {
      const x = (i / (values.length - 1 || 1)) * W;
      const y = height - ((v - min) / (max - min || 1)) * (height - 4) - 2;
      return `${i ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${height}`} width={W} height={height} className="overflow-visible" aria-hidden>
      <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
