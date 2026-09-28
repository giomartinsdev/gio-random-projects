// Componentes do design system. Cada um espelha um componente reutilizável do
// ui.pen (ver design/), usando só os tokens — nenhum valor de cor ou fonte é
// inventado aqui.

import { useId, type ReactNode } from "react";
import { clsx } from "clsx";
import { ChevronLeft, ChevronRight, Flag, Shield } from "lucide-react";
import type { Club, Position, Resultado, TipoPartida } from "../lib/types";
import { POS_SHORT, RESULT_LETTER, TIPO_KEY, resultColor, resultSoft } from "../lib/format";
import { clubPalette, crestPattern, crestSeed, crestShape, type Pattern } from "../lib/crest";
import { MATCH_KIND_ICONS } from "./icons";
import { useI18n } from "../lib/i18n";

// ------------------------------------------------------------------ escudo

/** O padrão desenhado por cima da forma, já recortado por ela.
 *
 * Coordenadas no mesmo 100x110 do escudo. Cada um é uma lista de paths; quem
 * desenha só preenche com `detail`. "solid" não desenha nada -- é o repouso,
 * para nem todo escudo ficar carregado. */
function patternPaths(pattern: Pattern): string[] {
  switch (pattern) {
    case "stripe":
      return ["M50 0H64V110H50Z"];
    case "stripes":
      return ["M28 0H40V110H28Z", "M60 0H72V110H60Z"];
    case "band":
      return ["M0 44H100V62H0Z"];
    case "diagonal":
      return ["M-10 78L78 -10H96L8 78Z"];
    case "half":
      return ["M50 0H100V110H50Z"];
    case "chevron":
      return ["M36 0H64L50 34 36 0Z"];
    default:
      return [];
  }
}

/** O escudo do clube, desenhado do zero.
 *
 * A forma, o padrão e -- quando a fonte devolve o kit default da EA -- as
 * cores vêm de um hash estável do clube: o mesmo clube desenha sempre o mesmo
 * escudo, e clubes diferentes se distinguem. Quem tem cores próprias na fonte
 * é desenhado com elas (ver lib/crest.ts). */
export function Crest({
  club,
  size = 34,
}: {
  club: Pick<Club, "name" | "tag" | "color_1" | "color_2" | "color_3" | "color_4" | "crest_asset_id"> &
    Partial<Pick<Club, "club_id">>;
  size?: number;
}) {
  const uid = useId();
  const seed = crestSeed(club);
  const pal = clubPalette(seed, [club.color_1, club.color_2, club.color_3, club.color_4]);
  const shape = crestShape(seed);
  const gradId = `crest-g-${uid}`;
  const clipId = `crest-c-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 100 110" aria-label={`escudo ${club.name}`}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor={pal.base} />
          <stop offset="100%" stopColor={pal.detail} />
        </linearGradient>
        <clipPath id={clipId}>
          <path d={shape} />
        </clipPath>
      </defs>
      <path d={shape} fill={`url(#${gradId})`} stroke={pal.detail} strokeWidth={4} strokeLinejoin="round" />
      <g clipPath={`url(#${clipId})`}>
        {patternPaths(crestPattern(seed)).map((d, i) => (
          <path key={i} d={d} fill={pal.detail} opacity={0.9} />
        ))}
      </g>
      <path d={shape} fill="none" stroke={pal.detail} strokeWidth={4} strokeLinejoin="round" />
      <text
        x="50"
        y="63"
        textAnchor="middle"
        fontFamily="Chakra Petch, sans-serif"
        fontSize="30"
        fontWeight="700"
        fill={pal.ink}
        style={{ paintOrder: "stroke" }}
        stroke="rgba(0,0,0,.25)"
        strokeWidth="1.6"
      >
        {club.tag || "FC"}
      </text>
    </svg>
  );
}

// -------------------------------------------------------------------- kit

/** A camisa, desenhada a partir das cores do kit (hex).
 *
 * Recebe a mesma paleta do escudo, então um clube que não customizou o kit
 * (a EA manda o default) não exibe a mesma camisa branca/roxa de todos os
 * outros -- ver lib/crest.ts. */
export function Kit({ colors, size = 52, label }: { colors: string[]; size?: number; label: string }) {
  const [c1, c2, c3, c4] = colors.map((c) => c || "var(--surface-3)");
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
  const tone = resultado === "win" ? "win" : resultado === "loss" ? "loss" : "draw";
  return (
    <Badge tone={tone} title={dnf ? `${resultado} (desistência)` : resultado}>
      {RESULT_LETTER[resultado]}
      {dnf && <Flag className="size-3" strokeWidth={2.5} />}
    </Badge>
  );
}

export function PosTag({ position }: { position: Position }) {
  return <Badge title={position}>{POS_SHORT[position]}</Badge>;
}

/** A partida é de liga, amistoso ou playoff — com ícone, porque a palavra
 * sozinha some na lista densa e o formato é o que muda a leitura do jogo.
 * O título acessível traz o nome inteiro; o badge é compacto. */
export function MatchKindBadge({ kind }: { kind: TipoPartida }) {
  const { t } = useI18n();
  const Icon = MATCH_KIND_ICONS[kind] ?? Shield;
  const label = t(TIPO_KEY[kind]);
  return (
    <Badge title={label} tone={kind === "playoff" ? "accent" : "default"}>
      <Icon className="size-3" strokeWidth={2.5} />
      <span className="hidden capitalize sm:inline">{label}</span>
    </Badge>
  );
}

/** Os últimos resultados, mais recente à esquerda. */
export function FormChips({ form, max = 10 }: { form: string[] | null; max?: number }) {
  if (!form?.length) return <span className="text-faint text-xs">sem played</span>;
  return (
    <span className="flex gap-1" title="últimos resultados, mais recente à esquerda">
      {form.slice(0, max).map((r, i) => (
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
