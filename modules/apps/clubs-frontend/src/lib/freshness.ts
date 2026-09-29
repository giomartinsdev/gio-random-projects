// Frescor do dado: "quão velha está esta leitura?".
//
// Por que existe: o hub acumula leituras por atualização, então o dado tem uma
// IDADE -- e ela importa. Sem mostrar isso, a pessoa vê o mesmo "D1 · 2144" para
// um clube atualizado há 2 minutos e para um parado há 3 dias, sem saber se o
// que está lendo é de agora ou de ontem. A cor responde de relance; o texto diz
// o resto.
//
// A lógica é PURA e separada do React: o corte entre "fresco" e "velho" é uma
// regra de produto, e testá-la num componente seria caro e frágil.

export type FreshnessLevel = "fresh" | "recent" | "stale" | "old" | "unknown";

/** Quanto tempo faz, em segundos. Negativo (relógio dessincronizado) vira 0 --
 * um "atualizado daqui a pouco" seria pior que "agora". */
export function ageSeconds(iso: string | null | undefined, now: number = Date.now()): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - t) / 1000);
}

/**
 * O nível de frescor pelos cortes de produto:
 *   - `fresh`  (< 15 min): o ciclo roda a cada 15 min, então isto é "disto agora";
 *   - `recent` (< 2 h):   atualizado na última hora ou duas, ainda confiável;
 *   - `stale`  (< 24 h):  ficou para trás, mas é do dia;
 *   - `old`    (>= 24 h): o coletor pode estar parado -- vale um aviso;
 *   - `unknown`: nunca foi atualizado (o histórico começa vazio).
 *
 * Os 15 min saem do TTL das partidas (5 min) e do ciclo (15 min): abaixo disso
 * é o esperado, acima é atraso.
 */
export function freshnessLevel(iso: string | null | undefined, now: number = Date.now()): FreshnessLevel {
  const s = ageSeconds(iso, now);
  if (!Number.isFinite(s)) return "unknown";
  if (s < 15 * 60) return "fresh";
  if (s < 2 * 3600) return "recent";
  if (s < 24 * 3600) return "stale";
  return "old";
}

/** A cor associada a cada nível, pelos tokens do tema. `unknown` é neutro:
 * "ainda não atualizado" não é erro. */
export const FRESHNESS_COLOR: Record<FreshnessLevel, string> = {
  fresh: "var(--success)",
  recent: "var(--info)",
  stale: "var(--warning)",
  old: "var(--danger)",
  unknown: "var(--text-faint)",
};
