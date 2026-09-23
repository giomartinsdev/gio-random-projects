// Componentes do design system. Cada um espelha um componente reutilizável do
// ui.pen (ver design/), usando só os tokens — nenhum valor de cor ou fonte é
// inventado aqui.

import type { ReactNode } from "react";
import { clsx } from "clsx";
import { ChevronLeft, ChevronRight, Flag } from "lucide-react";
import type { Club, Posicao, Resultado } from "../lib/types";
import { hex, POS_SHORT, RESULT_LETTER, resultColor, resultSoft } from "../lib/format";

// ------------------------------------------------------------------ escudo

/** O escudo é desenhado do zero a partir de crest_asset_id — a EA não publica
 * uma tabela de imagens, então a forma vem da de-para por inferência. */
export function Crest({ club, size = 34 }: { club: Pick<Club, "nome" | "sigla" | "cor_1" | "cor_2" | "cor_3" | "escudo_asset_id">; size?: number }) {
  const c1 = hex(club.cor_1) === "#000000" ? "var(--accent)" : hex(club.cor_1);
  const c2 = hex(club.cor_2) === "#000000" ? "var(--text)" : hex(club.cor_2);
  const id = `crest-${club.sigla || "x"}-${size}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 110" aria-label={`escudo ${club.nome}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor={c1} />
          <stop offset="100%" stopColor={c2} />
        </linearGradient>
      </defs>
      <path
        d="M50 4 L94 20 V56 C94 82 74 98 50 106 C26 98 6 82 6 56 V20 Z"
        fill={`url(#${id})`}
        stroke={c2}
        strokeWidth={4}
        strokeLinejoin="round"
      />
      <text
        x="50"
        y="63"
        textAnchor="middle"
        fontFamily="Chakra Petch, sans-serif"
        fontSize="30"
        fontWeight="700"
        fill={c2}
        style={{ paintOrder: "stroke" }}
        stroke="rgba(0,0,0,.35)"
        strokeWidth="1.6"
      >
        {club.sigla || "FC"}
      </text>
    </svg>
  );
}

// -------------------------------------------------------------------- kit

/** A camisa, desenhada a partir de kitColor1..4 (decimal RGB → hex). */
export function Kit({ colors, size = 52, label }: { colors: number[]; size?: number; label: string }) {
  const [c1, c2, c3, c4] = colors.map((c) => (c ? hex(c) : "var(--surface-3)"));
  return (
    <svg width={size} height={size * 1.06} viewBox="0 0 100 106" aria-label={`uniforme ${label}`}>
      <path
        d="M32 8 L18 14 L6 34 L18 42 L24 34 V96 H76 V34 L82 42 L94 34 L82 14 L68 8 C64 16 36 16 32 8 Z"
        fill={c2}
        stroke="var(--border-strong)"
        strokeWidth="1.4"
      />
      <path d="M32 8 C36 16 64 16 68 8 C62 4 38 4 32 8 Z" fill={c3} />
      <path d="M56 20 H68 V96 H56 Z" fill={c1} />
      <path d="M34 20 H46 V96 H34 Z" fill={c4} />
      <path d="M34 96 H66 L68 106 H32 Z" fill={c3} />
    </svg>
  );
}

// ----------------------------------------------------------------- badges

export function Badge({
  children,
  tone = "default",
  title,
}: {
  children: ReactNode;
  tone?: "default" | "win" | "loss" | "draw" | "accent" | "info";
  title?: string;
}) {
  const tones: Record<string, string> = {
    default: "border-line-strong text-muted",
    win: "border-[var(--success)] bg-[var(--success-soft)] text-[var(--success)]",
    loss: "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]",
    draw: "border-line-strong text-[var(--draw)]",
    accent: "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]",
    info: "border-[var(--info)] bg-[var(--info-soft)] text-[var(--info)]",
  };
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2 py-[2px] font-mono text-[10px] font-bold uppercase tracking-wide",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function ResultBadge({ resultado, dnf = false }: { resultado: Resultado; dnf?: boolean }) {
  const tone = resultado === "vitoria" ? "win" : resultado === "derrota" ? "loss" : "draw";
  return (
    <Badge tone={tone} title={dnf ? `${resultado} (desistência)` : resultado}>
      {RESULT_LETTER[resultado]}
      {dnf && <Flag className="size-3" strokeWidth={2.5} />}
    </Badge>
  );
}

export function PosTag({ posicao }: { posicao: Posicao }) {
  return <Badge title={posicao}>{POS_SHORT[posicao]}</Badge>;
}

/** Os últimos resultados, mais recente à esquerda. */
export function FormChips({ forma, max = 10 }: { forma: string[] | null; max?: number }) {
  if (!forma?.length) return <span className="text-faint text-xs">sem jogos</span>;
  return (
    <span className="flex gap-1" title="últimos resultados, mais recente à esquerda">
      {forma.slice(0, max).map((r, i) => (
        <span
          key={i}
          className="grid size-[18px] place-items-center rounded-sm font-mono text-[10px] font-bold"
          style={{ background: resultSoft(r), color: resultColor(r) }}
        >
          {RESULT_LETTER[r as Resultado] ?? "?"}
        </span>
      ))}
    </span>
  );
}

/** O pódio dos rankings: ouro/prata/bronze, daí cinza. */
export function RankMedallion({ pos, size = 28 }: { pos: number; size?: number }) {
  const style =
    pos === 1
      ? { background: "var(--gold)", color: "var(--gold-ink)" }
      : pos === 2
        ? { background: "var(--silver)", color: "var(--silver-ink)" }
        : pos === 3
          ? { background: "var(--bronze)", color: "var(--bronze-ink)" }
          : { background: "var(--surface-3)", color: "var(--text-muted)" };
  return (
    <span
      className="grid shrink-0 place-items-center rounded-sm font-mono text-xs font-bold"
      style={{ ...style, width: size, height: size }}
    >
      {pos}
    </span>
  );
}

// ----------------------------------------------------------------- cartões

export function Card({
  title,
  actions,
  children,
  className,
}: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("surface overflow-hidden", className)}>
      {title && (
        <header className="hair-b flex items-center gap-2 px-4 py-3">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide">{title}</h3>
          <span className="ml-auto flex items-center gap-2">{actions}</span>
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="surface px-4 py-3">
      <div className="label">{label}</div>
      <div
        className="font-display tnum mt-1 text-3xl font-bold leading-none"
        style={{ color: accent ? "var(--accent)" : "var(--text)" }}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="font-display text-base font-bold">{title}</div>
      {hint && <p className="max-w-md text-sm text-muted">{hint}</p>}
    </div>
  );
}

/** A barra de proporção usada nas tabelas de ranking. */
export function Bar({ value, max, color = "var(--accent)" }: { value: number; max: number; color?: string }) {
  const width = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className="block h-[6px] min-w-[60px] overflow-hidden rounded-full bg-[var(--surface-3)]">
      <span className="block h-full rounded-full" style={{ width: `${width}%`, background: color }} />
    </span>
  );
}

export function Spinner({ label = "carregando…" }: { label?: string }) {
  return <div className="px-4 py-10 text-center text-sm text-muted">{label}</div>;
}

/** Paginação de uma lista já carregada: a home não rola até o fim. O rótulo
 * pode dizer o que se está paginando ("10 de 100 jogadores"). */
export function Pager({
  page,
  totalPages,
  onPage,
  label,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
  label?: ReactNode;
}) {
  if (totalPages <= 1) return null;
  const btn =
    "rounded-md border px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide transition-colors disabled:opacity-40";
  return (
    <div className="hair-t flex items-center justify-between gap-3 px-4 py-2.5">
      <button
        type="button"
        disabled={page <= 0}
        onClick={() => onPage(page - 1)}
        className={btn}
        style={{ borderColor: "var(--border-strong)", color: "var(--text-muted)" }}
      >
        <ChevronLeft className="size-3.5" />
        anterior
      </button>
      <span className="font-mono text-[10px] text-faint">
        {label ?? `${page + 1} / ${totalPages}`}
      </span>
      <button
        type="button"
        disabled={page >= totalPages - 1}
        onClick={() => onPage(page + 1)}
        className={btn}
        style={{ borderColor: "var(--border-strong)", color: "var(--text-muted)" }}
      >
        próxima
        <ChevronRight className="size-3.5" />
      </button>
    </div>
  );
}
