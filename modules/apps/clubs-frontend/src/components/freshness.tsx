// O indicador de frescor: "atualizado há N" com cor.
//
// Vive junto do resto da UI (não numa página) porque a informação é transversal
// -- aparece no cabeçalho do clube, no cabeçalho global do shell, onde o dado
// tiver idade. O texto é montado no idioma escolhido; a cor vem do nível.

import { Clock } from "lucide-react";
import { FRESHNESS_COLOR, ageSeconds, freshnessLevel } from "../lib/freshness";
import { useI18n, type Key } from "../lib/i18n";

/** Formata a idade em unidades grandes, com plural simples -- "há 1 min", "há
 * 3 h". Não usa Intl.RelativeTimeFormat porque cinco idiomas com uma frase só
 * não compensam a dependência e a API é verbosa para o caso. */
function idadeKey(iso: string | null | undefined): { key: Key; n: number } | { key: Key } {
  const s = ageSeconds(iso);
  if (!Number.isFinite(s)) return { key: "fresh.never" };
  if (s < 60) return { key: "fresh.now" };
  if (s < 3600) return { key: "fresh.minutes", n: Math.floor(s / 60) };
  if (s < 86400) return { key: "fresh.hours", n: Math.floor(s / 3600) };
  return { key: "fresh.days", n: Math.floor(s / 86400) };
}

export function Freshness({
  at,
  prefix = true,
  showIcon = true,
}: {
  /** Timestamp da última leitura (ISO). null/ausente = nunca atualizado. */
  at: string | null | undefined;
  /** Prefixar com "Atualizado" -- desligue onde o contexto já diz isso. */
  prefix?: boolean;
  showIcon?: boolean;
}) {
  const { t } = useI18n();
  const nivel = freshnessLevel(at);
  const idade = idadeKey(at);
  const texto = "n" in idade ? t(idade.key, { n: idade.n }) : t(idade.key);
  // O aviso só aparece quando o dado está atrasado o suficiente para valer uma
  // explicação: em "fresh"/"recent" a cor já basta.
  const dica =
    nivel === "stale" ? t("fresh.staleHint") : nivel === "old" ? t("fresh.oldHint") : undefined;

  return (
    <span
      className="inline-flex items-center gap-1 font-mono text-[10px]"
      style={{ color: FRESHNESS_COLOR[nivel] }}
      title={dica}
    >
      {showIcon && <Clock className="size-3" strokeWidth={2.5} />}
      {prefix ? `${t("fresh.updated")} ${texto}` : texto}
    </span>
  );
}
