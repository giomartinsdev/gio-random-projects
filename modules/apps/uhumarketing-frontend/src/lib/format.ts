// Formatação em pt-BR, sem dependência: números, moeda, percentual e datas
// curtas. As métricas da POC são pequenas o bastante para não precisar de
// compactação (mil/mi) — quando precisarem, é aqui.

export function num(value: number): string {
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function pct(value: number, digits = 1): string {
  return `${new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)}%`;
}

export function money(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  }).format(value);
}

/** Compacta valores grandes onde a coluna é estreita. */
export function compact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(".", ",")}mi`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1).replace(".", ",")}k`;
  return num(value);
}

const DATE = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });
const DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});
const FULL = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

export function fmtDate(iso: string): string {
  return DATE.format(new Date(iso)).replace(".", "");
}

export function fmtDateTime(iso: string): string {
  return DATE_TIME.format(new Date(iso)).replace(".", "");
}

export function fmtFullDate(iso: string): string {
  return FULL.format(new Date(iso));
}

/** "há 2h", "há 3d" — suficiente para um feed mock. */
export function ago(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m}min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.round(h / 24);
  return `há ${d}d`;
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function initials(name: string): string {
  return name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function uid(prefix = "id"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}
