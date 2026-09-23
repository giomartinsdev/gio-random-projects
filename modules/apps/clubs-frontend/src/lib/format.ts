// Formatadores e rótulos de apresentação. Linguagem de usuário: nada de
// "snapshot", "ingest", "skillRating" nas telas.

import type { Position, Resultado, TipoPartida } from "./types";

export function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function pct(part: number, total: number): string {
  if (!total) return "—";
  return `${fmt((part / total) * 100, 0)}%`;
}

export function hex(decimal: number | undefined | null): string {
  return "#" + Number(decimal ?? 0).toString(16).padStart(6, "0");
}

export function fmtDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "2-digit" });
}

export function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeAgo(iso: string): string {
  if (!iso) return "—";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "agora";
  if (s < 3600) return `${Math.floor(s / 60)} min atrás`;
  if (s < 86400) return `${Math.floor(s / 3600)} h atrás`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d} d atrás`;
  return fmtDate(iso);
}

/** O histórico cresce por atualização, então "nunca sincronizado" é um estado
 * real e precisa de nome — não pode virar "—" sem explicação. */
export function fmtRefresh(iso: string): string {
  if (!iso) return "ainda não atualizado";
  return timeAgo(iso);
}

export const POS_LABEL: Record<Position, string> = {
  goalkeeper: "Goalkeeper",
  defender: "Defender",
  midfielder: "Midfielder-campista",
  forward: "Forward",
};

export const POS_SHORT: Record<Position, string> = {
  goalkeeper: "GK",
  defender: "DEF",
  midfielder: "MEI",
  forward: "ATA",
};

export const POS_ORDER: Position[] = ["goalkeeper", "defender", "midfielder", "forward"];

export const RESULT_LETTER: Record<Resultado, string> = {
  win: "V",
  draw: "E",
  loss: "D",
};

export const RESULT_LABEL: Record<Resultado, string> = {
  win: "Vitória",
  draw: "Draw",
  loss: "Loss",
};

export const TIPO_LABEL: Record<TipoPartida, string> = {
  league: "League",
  friendly: "Friendly",
  playoff: "Playoff",
};

/** A cor de um resultado, usando só os tokens de status. */
export function resultColor(r: Resultado | string): string {
  switch (r) {
    case "win":
      return "var(--success)";
    case "loss":
      return "var(--danger)";
    default:
      return "var(--draw)";
  }
}

export function resultSoft(r: Resultado | string): string {
  switch (r) {
    case "win":
      return "var(--success-soft)";
    case "loss":
      return "var(--danger-soft)";
    default:
      return "var(--draw-soft)";
  }
}

/** A nota individual: cor por faixa, para a leitura rápida de uma súmula. */
export function ratingColor(r: number): string {
  if (r >= 8.5) return "var(--success)";
  if (r >= 7.5) return "var(--accent)";
  if (r >= 6.5) return "var(--warning)";
  return "var(--danger)";
}

export function minutes(seconds: number): number {
  return Math.round((seconds || 0) / 60);
}

/** As seis naturezas de defesa que só existem na linha do goleiro. */
export const SAVE_LABEL: Record<string, string> = {
  ballDiveSaves: "Mergulhos",
  crossSaves: "Cruzamentos",
  goodDirectionSaves: "Boa direção",
  parrySaves: "Rebotes",
  punchSaves: "Socos",
  reflexSaves: "Reflexo",
};

/** Os rótulos da timeline, inferidos por correlação (nunca inventados). */
export const EVENT_LABEL: Record<string, string> = {
  toque: "Toques",
  passe: "Passes",
  passe_certo: "Passes certos",
  passe_tentado: "Passes tentados",
  chute: "Shots",
  chute_no_gol: "Shots no gol",
  desarme: "Desarmes",
  acao_goleiro: "Ações de goleiro",
  movimentacao: "Movimentação",
  inicio_periodo: "Início de período",
};
