// Clubes: busca (tolerante a acento, no servidor) + diretório em tabela densa.

import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { api } from "../lib/api";
import type { Club } from "../lib/types";
import { Crest, Empty, FormChips, Spinner } from "../components/ui";
import { PageHead } from "../components/shell";
import { WatchStar } from "../components/icons";
import { fmt } from "../lib/format";
import { useI18n } from "../lib/i18n";

export function ClubsPage({
  onOpenClub,
  isWatched,
  onToggleWatch,
  authed,
}: {
  onOpenClub: (id: string) => void;
  isWatched: (id: string) => boolean;
  onToggleWatch: (id: string) => void;
  authed: boolean | null;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [list, setList] = useState<Club[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api
        .searchClubs(q)
        .then((r) => !cancelled && setList(r.clubs ?? []))
        .catch(() => !cancelled && setList([]));
    }, q ? 180 : 0); // debounce: a busca é pública e barata, mas não a cada tecla
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q]);

  const seguidos = authed ? (list ?? []).filter((c) => isWatched(c.club_id)) : [];

  return (
    <>
      <PageHead
        title={t("nav.clubs")}
        sub={t("clubs.subtitle2")}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label className="surface flex min-w-[260px] flex-1 items-center gap-2 px-3 py-2">
          <span className="text-faint">⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("clubs.searchPlaceholder")}
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
            aria-label={t("action.search")}
          />
        </label>
        {list && <span className="font-mono text-xs text-muted">{fmt(list.length)} {t("common.result")}</span>}
      </div>

      {seguidos.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="label">{t("common.youFollow")}</span>
          {seguidos.map((c) => (
            <button
              key={c.club_id}
              type="button"
              onClick={() => onOpenClub(c.club_id)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1 font-mono text-[10px] font-bold text-accent"
            >
              <WatchStar size={11} filled /> {c.tag || c.name}
            </button>
          ))}
        </div>
      )}

      <div className="surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-faint">
                <Th>{t("common.club")}</Th>
                <Th right>{t("common.division")}</Th>
                <Th right>V</Th>
                <Th right>E</Th>
                <Th right>D</Th>
                <Th right>{t("common.goals")}</Th>
                <Th right>{t("common.points")}</Th>
                <Th right>{t("common.level")}</Th>
                <Th>{t("club.form")}</Th>
                <Th right>{""}</Th>
              </tr>
            </thead>
            <tbody>
              {list === null ? (
                <tr>
                  <td colSpan={10}>
                    <Spinner />
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <Empty title={t("claim.notFound")} hint={t("clubs.tryAnotherName")} />
                  </td>
                </tr>
              ) : (
                list.map((c) => (
                  <tr
                    key={c.club_id}
                    className="cursor-pointer border-t border-line transition-colors hover:bg-surface-3"
                    onClick={() => onOpenClub(c.club_id)}
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <Crest club={c} size={24} />
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{c.name}</div>
                          <div className="font-mono text-[10px] text-faint">
                            {c.tracked ? t("common.tracked") : t("clubs.overallHistory")}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="tnum px-3 py-2 text-right font-mono">{c.division ? `D${c.division}` : "—"}</td>
                    <td className="tnum px-3 py-2 text-right font-mono">{fmt(c.wins)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono">{fmt(c.draws)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono">{fmt(c.losses)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono">{fmt(c.goals)}:{fmt(c.goals_conceded)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono font-bold text-accent">{fmt(c.points)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono">{c.skill_rating ? fmt(c.skill_rating) : "—"}</td>
                    <td className="px-3 py-2">
                      <FormChips form={c.form} max={5} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      {authed ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleWatch(c.club_id);
                          }}
                          title={isWatched(c.club_id) ? t("clubs.unfollow") : t("clubs.follow")}
                          style={{ color: isWatched(c.club_id) ? "var(--gold)" : "var(--text-faint)" }}
                        >
                          <WatchStar size={16} filled={isWatched(c.club_id)} />
                        </button>
                      ) : (
                        <ChevronRight className="size-3.5 text-faint" />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {!authed && (
        <p className="mt-4 text-sm text-muted">
          {t("clubs.signInToFollow")}
        </p>
      )}
    </>
  );
}

function Th({ children, right = false }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}
