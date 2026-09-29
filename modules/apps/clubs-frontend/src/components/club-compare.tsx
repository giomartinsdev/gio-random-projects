// Comparador de clubes: dois ou três lado a lado.
//
// O que a fonte não faz: cruzar dois clubes. Ela só conhece a janela recente de
// cada um isoladamente, então "quem é melhor entre estes" é uma pergunta que só
// o ACERVO do hub responde -- e é das mais naturais numa comunidade.

import { useMemo } from "react";
import { X } from "lucide-react";
import type { ClubRef } from "../lib/types";
import { Card, Crest } from "./ui";
import { fmt } from "../lib/format";
import { useI18n } from "../lib/i18n";

/** Uma linha do comparador: o rótulo e o valor de cada clube, com o maior
 * destacado. "Maior é melhor" em todas as métricas aqui, exceto gols sofridos --
 * `lowerIsBetter` inverte. */
function CompareRow({
  label,
  values,
  lowerIsBetter = false,
}: {
  label: string;
  values: number[];
  lowerIsBetter?: boolean;
}) {
  const melhor = lowerIsBetter ? Math.min(...values) : Math.max(...values);
  return (
    <tr className="border-t border-line">
      <td className="px-3 py-2 font-mono text-[10px] uppercase text-faint">{label}</td>
      {values.map((v, i) => (
        <td
          key={i}
          className="tnum px-3 py-2 text-center font-display font-bold"
          style={{ color: values.length > 1 && v === melhor ? "var(--accent)" : "var(--text)" }}
        >
          {fmt(v)}
        </td>
      ))}
    </tr>
  );
}

export function ClubCompare({
  clubs,
  onRemove,
}: {
  clubs: ClubRef[];
  onRemove?: (id: string) => void;
}) {
  const { t } = useI18n();
  const rows = useMemo(
    () =>
      [
        { label: t("common.points"), get: (c: ClubRef) => c.points },
        { label: t("common.level"), get: (c: ClubRef) => c.skill_rating },
        { label: t("club.division"), get: (c: ClubRef) => c.division_at_read, lower: true },
        { label: t("common.goals"), get: (c: ClubRef) => c.goals },
        { label: t("club.goalsAgainst"), get: (c: ClubRef) => c.goals_conceded, lower: true },
        { label: t("club.cleanSheets"), get: (c: ClubRef) => c.clean_sheets },
        { label: t("club.streak"), get: (c: ClubRef) => c.sequencia_invicta },
      ] as Array<{ label: string; get: (c: ClubRef) => number; lower?: boolean }>,
    [t],
  );

  if (clubs.length < 2) return null;

  return (
    <Card title={t("compare.title")}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="px-3 py-2" />
              {clubs.map((c) => (
                <th key={c.club_id} className="px-3 py-2">
                  <div className="flex flex-col items-center gap-1">
                    <Crest club={c} size={34} />
                    <span className="text-xs font-semibold">{c.name}</span>
                    {onRemove && (
                      <button
                        type="button"
                        onClick={() => onRemove(c.club_id)}
                        aria-label={t("compare.clear")}
                        className="rounded p-0.5 text-faint hover:text-danger"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <CompareRow key={r.label} label={r.label} values={clubs.map(r.get)} lowerIsBetter={r.lower} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
