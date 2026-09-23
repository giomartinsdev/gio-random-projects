// Os seis gráficos, em SVG à mão — same approach as the prototype's
// js/charts.js, ported to components. No chart library: the design is
// autoral and a library would mean fighting it to reproduce the .pen.
//
// Regra do .pen que vale aqui: o eixo de linha usa layout simples; para a
// linha de evolução, os pontos são posicionados por path (o sistema de
// layout do .pen não posiciona pontos individuais).

import { useId, useMemo, useState } from "react";
import type { Snapshot } from "../lib/types";
import { fmt, fmtDate } from "../lib/format";

const SERIES = ["var(--accent)", "var(--info)", "var(--accent-2)", "var(--warning)", "var(--bronze)"];

// ------------------------------------------------------------------ linha

export interface LinePoint {
  x: number; // índice categórico ou timestamp
  y: number;
}

/** O gráfico de evolução do nível: série única com tooltip e crosshair. */
export function LineChart({
  values,
  labels,
  height = 240,
  yFormat = (v: number) => fmt(v),
  invertY = false,
  area = true,
  refLine,
}: {
  values: number[];
  labels: string[];
  height?: number;
  yFormat?: (v: number) => string;
  invertY?: boolean;
  area?: boolean;
  refLine?: { y: number; label: string };
}) {
  const gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const W = 720;
  const pad = { t: 16, r: 16, b: 26, l: 46 };
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;

  const { min, max } = useMemo(() => {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    if (lo === hi) return { min: lo - 1, max: hi + 1 };
    const padY = (hi - lo) * 0.15;
    return { min: lo - padY, max: hi + padY };
  }, [values]);

  if (values.length === 0) {
    return <div className="px-4 py-8 text-center text-sm text-muted">sem dados ainda</div>;
  }

  const xOf = (i: number) => (values.length === 1 ? pad.l + iw / 2 : pad.l + (i / (values.length - 1)) * iw);
  const yOf = (v: number) => {
    const f = (v - min) / (max - min || 1);
    return invertY ? pad.t + f * ih : pad.t + ih - f * ih;
  };

  const path = values.map((v, i) => `${i ? "L" : "M"} ${xOf(i).toFixed(1)} ${yOf(v).toFixed(1)}`).join(" ");
  const areaPath = `${path} L ${xOf(values.length - 1).toFixed(1)} ${(pad.t + ih).toFixed(1)} L ${xOf(0).toFixed(1)} ${(pad.t + ih).toFixed(1)} Z`;

  const ticks = [min, min + (max - min) / 2, max];
  const tickEvery = Math.max(1, Math.ceil(values.length / 6));

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="gráfico from_division evolução">
        <defs>
          <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((t, i) => (
          <g key={i}>
            <line className="stroke-[var(--border)]" strokeWidth="1" x1={pad.l} y1={yOf(t)} x2={W - pad.r} y2={yOf(t)} />
            <text x={pad.l - 7} y={yOf(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--text-faint)">
              {yFormat(Math.round(t))}
            </text>
          </g>
        ))}

        {refLine && (
          <>
            <line
              x1={pad.l}
              y1={yOf(refLine.y)}
              x2={W - pad.r}
              y2={yOf(refLine.y)}
              stroke="var(--warning)"
              strokeDasharray="4 4"
              strokeWidth="1"
            />
            <text x={W - pad.r - 2} y={yOf(refLine.y) - 4} textAnchor="end" fontSize="10" fill="var(--warning)">
              {refLine.label}
            </text>
          </>
        )}

        {area && <path d={areaPath} fill={`url(#g${gid})`} />}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />

        {values.map((_v, i) =>
          i % tickEvery === 0 || i === values.length - 1 ? (
            <text key={i} x={xOf(i)} y={height - 7} textAnchor="middle" fontSize="10" fill="var(--text-faint)">
              {labels[i] ?? ""}
            </text>
          ) : null,
        )}

        {hover !== null && (
          <g>
            <line
              x1={xOf(hover)}
              y1={pad.t}
              x2={xOf(hover)}
              y2={pad.t + ih}
              stroke="var(--border-strong)"
              strokeDasharray="3 3"
            />
            <circle cx={xOf(hover)} cy={yOf(values[hover])} r="4" fill="var(--accent)" stroke="var(--bg)" strokeWidth="2" />
          </g>
        )}

        {/* Target from_division interação: uma faixa por ponto, to_division não depender from_division acertar
            o círculo exato. */}
        {values.map((_, i) => (
          <rect
            key={i}
            x={xOf(i) - iw / (values.length * 2 || 1)}
            y={pad.t}
            width={iw / (values.length || 1)}
            height={ih}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      {hover !== null && (
        <div
          className="surface pointer-events-none absolute z-10 px-3 py-2 text-xs"
          style={{ left: `${(xOf(hover) / W) * 100}%`, top: 0, transform: "translate(-50%, -100%)" }}
        >
          <div className="label">{labels[hover]}</div>
          <div className="tnum font-mono font-bold">{yFormat(values[hover])}</div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ barras

export function BarChart({
  items,
  height = 200,
  valueFormat = (v: number) => fmt(v),
}: {
  items: Array<{ label: string; value: number; color?: string }>;
  height?: number;
  valueFormat?: (v: number) => string;
}) {
  if (!items.length) return <div className="px-4 py-8 text-center text-sm text-muted">sem dados ainda</div>;
  const max = Math.max(...items.map((i) => i.value), 1);
  const W = 720;
  const pad = { t: 18, r: 10, b: 30, l: 42 };
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const band = iw / items.length;
  const bw = Math.min(34, band * 0.62);

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="gráfico from_division barras">
      {[0, max / 2, max].map((t, i) => {
        const y = pad.t + ih - (t / max) * ih;
        return (
          <g key={i}>
            <line className="stroke-[var(--border)]" strokeWidth="1" x1={pad.l} y1={y} x2={W - pad.r} y2={y} />
            <text x={pad.l - 6} y={y + 3.5} textAnchor="end" fontSize="10" fill="var(--text-faint)">
              {valueFormat(Math.round(t))}
            </text>
          </g>
        );
      })}
      {items.map((it, i) => {
        const x = pad.l + band * i + (band - bw) / 2;
        const h = Math.max(2, (it.value / max) * ih);
        const y = pad.t + ih - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={h} rx="4" fill={it.color ?? "var(--accent)"} opacity="0.92">
              <title>{`${it.label}: ${valueFormat(it.value)}`}</title>
            </rect>
            <text x={x + bw / 2} y={y - 5} textAnchor="middle" fontSize="10" fill="var(--text)">
              {valueFormat(it.value)}
            </text>
            <text x={pad.l + band * i + band / 2} y={height - 9} textAnchor="middle" fontSize="10" fill="var(--text-faint)">
              {it.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ------------------------------------------------------------------ rosca

export function DonutChart({
  data,
  centerLabel,
  size = 150,
}: {
  data: Array<{ label: string; value: number; color?: string }>;
  centerLabel: string;
  size?: number;
}) {
  const items = data.filter((d) => d.value > 0);
  const total = items.reduce((s, d) => s + d.value, 0);
  if (!total) return <div className="px-4 py-8 text-center text-sm text-muted">sem dados ainda</div>;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 8;
  const inner = r * 0.62;
  let a0 = -Math.PI / 2;

  const pt = (ang: number, rad: number) => `${(cx + Math.cos(ang) * rad).toFixed(1)} ${(cy + Math.sin(ang) * rad).toFixed(1)}`;

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} role="img" aria-label="gráfico from_division rosca">
        {items.map((d, i) => {
          const a1 = a0 + (d.value / total) * Math.PI * 2;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const path = `M ${pt(a0, r)} A ${r} ${r} 0 ${large} 1 ${pt(a1, r)} L ${pt(a1, inner)} A ${inner} ${inner} 0 ${large} 0 ${pt(a0, inner)} Z`;
          a0 = a1;
          return <path key={i} d={path} fill={d.color ?? SERIES[i % SERIES.length]} opacity="0.92" />;
        })}
        <text
          x={cx}
          y={cy - 2}
          textAnchor="middle"
          fontFamily="Chakra Petch, sans-serif"
          fontSize={size * 0.19}
          fontWeight="700"
          fill="var(--text)"
        >
          {total}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="9" fill="var(--text-faint)" letterSpacing="1.2">
          {centerLabel.toUpperCase()}
        </text>
      </svg>
      <div className="flex flex-col gap-1 text-xs">
        {items.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="size-2 rounded-sm" style={{ background: d.color ?? SERIES[i % SERIES.length] }} />
            <span className="text-muted">{d.label}</span>
            <span className="tnum ml-auto font-mono font-bold">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------- sparkline

export function Spark({ values, width = 84, height = 24 }: { values: number[] | null; width?: number; height?: number }) {
  if (!values || values.length < 2) return <span className="text-faint text-xs">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => 2 + (i / (values.length - 1)) * (width - 4);
  const y = (v: number) => height - 3 - ((v - min) / span) * (height - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.2" fill="var(--accent)" />
    </svg>
  );
}

// ------------------------------------------------------------ scatter

export function Scatter({
  points,
  height = 240,
  xLabel,
  yLabel,
}: {
  points: Array<{ x: number; y: number; label: string; highlight?: boolean }>;
  height?: number;
  xLabel: string;
  yLabel: string;
}) {
  if (points.length < 2) return <div className="px-4 py-8 text-center text-sm text-muted">sem dados ainda</div>;
  const W = 720;
  const pad = { t: 18, r: 16, b: 40, l: 46 };
  const iw = W - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const xMin = Math.min(...points.map((p) => p.x));
  const xMax = Math.max(...points.map((p) => p.x), xMin + 1);
  const yMin = Math.min(...points.map((p) => p.y));
  const yMax = Math.max(...points.map((p) => p.y), yMin + 1);
  const xOf = (v: number) => pad.l + ((v - xMin) / (xMax - xMin || 1)) * iw;
  const yOf = (v: number) => pad.t + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;

  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="dispersão">
      <text x={pad.l - 6} y={pad.t - 6} fontSize="10" fill="var(--text-faint)" textAnchor="end">
        {yLabel}
      </text>
      {[yMin, (yMin + yMax) / 2, yMax].map((t, i) => (
        <g key={i}>
          <line className="stroke-[var(--border)]" strokeWidth="1" x1={pad.l} y1={yOf(t)} x2={W - pad.r} y2={yOf(t)} />
          <text x={pad.l - 6} y={yOf(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--text-faint)">
            {fmt(t, 1)}
          </text>
        </g>
      ))}
      <line className="stroke-[var(--border)]" strokeWidth="1" x1={pad.l} y1={pad.t + ih} x2={W - pad.r} y2={pad.t + ih} />
      <text x={pad.l + iw / 2} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--text-faint)">
        {xLabel}
      </text>
      {points.map((p, i) => (
        <g key={i}>
          <circle
            cx={xOf(p.x)}
            cy={yOf(p.y)}
            r={p.highlight ? 7 : 5}
            fill={p.highlight ? "var(--accent)" : "var(--info)"}
            fillOpacity={p.highlight ? 0.9 : 0.6}
          >
            <title>{`${p.label}: ${fmt(p.x)} ${xLabel}, ${fmt(p.y, 1)} ${yLabel}`}</title>
          </circle>
          {p.highlight && (
            <text x={xOf(p.x) + 9} y={yOf(p.y) + 3} fontSize="10" fill="var(--text)">
              {p.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

// ----------------------------------------------- barras de divisão (escada)

/** A divisão ao longo do tempo — "mais alto = divisão melhor" é uma escada,
 * não uma linha, porque a divisão muda em degraus. */
export function DivisionSteps({ snapshots }: { snapshots: Snapshot[] }) {
  if (snapshots.length < 2) {
    return <div className="px-4 py-8 text-center text-sm text-muted">o histórico cresce a cada atualização</div>;
  }
  const changes: Array<{ at: string; division_at_read: number }> = [];
  for (const s of snapshots) {
    if (!changes.length || changes[changes.length - 1].division_at_read !== s.division_at_read) {
      changes.push({ at: s.read_at, division_at_read: s.division_at_read });
    }
  }
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      {snapshots.map((s, i) => (
        <div key={i} className="flex items-center gap-3 text-xs">
          <span className="tnum w-24 shrink-0 font-mono text-[10px] text-faint">{fmtDate(s.read_at)}</span>
          <span className="tnum w-10 shrink-0 font-mono font-bold">D{s.division_at_read}</span>
          <Bar value={8 - s.division_at_read} max={7} color="var(--accent-2)" />
        </div>
      ))}
    </div>
  );
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const width = Math.max(3, Math.min(100, (value / max) * 100));
  return (
    <span className="block h-[6px] flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
      <span className="block h-full rounded-full" style={{ width: `${width}%`, background: color }} />
    </span>
  );
}
