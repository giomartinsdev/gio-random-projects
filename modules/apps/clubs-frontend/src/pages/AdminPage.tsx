// Administração: o estado técnico do hub. Todo o conteúdo técnico vive aqui e
// em nenhum outro lugar — as telas de usuário falam só em nível, histórico e
// partidas.

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { api, ApiError } from "../lib/api";
import type { AdminStatus } from "../lib/types";
import { Badge, Bar, Card, Empty, Spinner, Stat } from "../components/ui";
import { PageHead } from "../components/shell";
import { BarChart, DonutChart } from "../components/charts";
import { fmt, fmtDateTime, fmtRefresh } from "../lib/format";
import { useI18n } from "../lib/i18n";

type Aba = "visao" | "integracao" | "historico";

export function AdminPage({ authed }: { authed: boolean | null }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [negado, setNegado] = useState(false);
  const [aba, setAba] = useState<Aba>("visao");

  useEffect(() => {
    if (authed !== true) return;
    api
      .adminStatus()
      .then(setStatus)
      .catch((e) => {
        if (e instanceof ApiError && e.status >= 400) setNegado(true);
        setStatus(null);
      });
  }, [authed]);

  if (authed === null) return <Spinner label={t("admin.checkingAccess")} />;
  if (authed === false || negado) {
    return (
      <>
        <PageHead title={t("admin.title")} sub={t("admin.subtitle")} />
        <div className="mx-auto max-w-lg">
          <Card title={t("admin.restricted")} actions={<Lock className="size-4 text-faint" />}>
            <p className="px-5 py-5 text-sm text-muted">
              {t("admin.restrictedHint")}
            </p>
          </Card>
        </div>
      </>
    );
  }
  if (!status) return <Spinner label={t("admin.loadingPanel")} />;

  const abas: Array<[Aba, string]> = [
    ["visao", t("admin.overview")],
    ["integracao", t("admin.integration")],
    ["historico", t("admin.rankings")],
  ];

  return (
    <>
      <PageHead
        title={t("admin.title")}
        sub={t("admin.subtitle2")}
        actions={
          <Badge tone="loss">
            <Lock className="size-3" /> admin
          </Badge>
        }
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {abas.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setAba(id)}
            aria-pressed={aba === id}
            className="rounded-md px-4 py-1.5 font-display text-xs font-bold uppercase tracking-wide transition-colors"
            style={
              aba === id
                ? { background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }
                : { background: "var(--surface-2)", color: "var(--text-muted)", border: "1px solid var(--border)" }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {aba === "visao" && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={t("admin.clubsTracked")}
              value={`${fmt(status.clubs_tracked)}/${fmt(status.clubs_total)}`}
              sub={t("admin.pending", { n: fmt(status.clubs_pending) })}
              accent
            />
            <Stat label={t("admin.matchesInDb")} value={fmt(status.matches)} sub={status.last_match_at ? `${t("admin.lastMatchLabel")} ${fmtRefresh(status.last_match_at)}` : undefined} />
            <Stat label={t("admin.players")} value={fmt(status.players)} sub={t("admin.crossClubIndex")} />
            <Stat label={t("admin.levelReadings")} value={fmt(status.snapshots)} sub={`${fmt(status.division_changes)} ${t("admin.divisionChanges").toLowerCase()}`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={t("admin.byDivisionTitle")}>
              <div className="px-4 py-4">
                {status.by_division && Object.keys(status.by_division).length > 0 ? (
                  <BarChart
                    height={200}
                    items={Object.entries(status.by_division)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([k, v]) => ({ label: k, value: v }))}
                  />
                ) : (
                  <Empty title={t("admin.noDivisions")} />
                )}
              </div>
            </Card>
            <Card title={t("admin.topByLevel")}>
              {status.top_clubs && status.top_clubs.length > 0 ? (
                <ul className="divide-y divide-[var(--border)]">
                  {status.top_clubs.map((c, i) => (
                    <li key={c.club_id} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <span className="w-5 font-mono text-xs text-faint">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="tnum font-mono text-xs text-faint">D{c.division_at_read}</span>
                      <span className="tnum w-16 text-right font-mono font-bold text-accent">{fmt(c.skill_rating)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title={t("home.noClubs")} />
              )}
            </Card>
          </div>
        </>
      )}

      {aba === "integracao" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t("admin.integration")}>
            <ol className="flex flex-col gap-3 px-4 py-4 text-sm">
              {[
                ["1", t("admin.step1"), t("admin.step1Hint")],
                ["2", t("admin.step2"), t("admin.step2Hint")],
                ["3", t("admin.step3"), t("admin.step3Hint")],
                ["4", t("admin.step4"), t("admin.step4Hint")],
                ["5", t("admin.step5"), t("admin.step5Hint")],
              ].map(([n, title, d]) => (
                <li key={n} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded bg-[var(--accent-soft)] font-mono text-xs font-bold text-accent">
                    {n}
                  </span>
                  <span>
                    <b className="font-display">{title}</b> — <span className="text-muted">{d}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>

          <Card title={t("admin.normalization")}>
            <ul className="divide-y divide-[var(--border)] text-sm">
              {[
                [t("admin.normNumbers"), t("admin.normNumbersHint")],
                [t("admin.normResults"), t("admin.normResultsHint")],
                [t("admin.normFriendly"), t("admin.normFriendlyHint")],
                [t("admin.normIds"), t("admin.normIdsHint")],
                [t("admin.normSameMatch"), t("admin.normSameMatchHint")],
              ].map(([title, d]) => (
                <li key={title} className="flex flex-col gap-0.5 px-4 py-2.5">
                  <b className="text-sm">{title}</b>
                  <span className="text-xs text-muted">{d}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title={t("admin.generatedAnnouncements")}>
            <div className="flex items-center gap-4 px-4 py-4">
              <span className="font-display tnum text-4xl font-bold text-accent">{fmt(status.announcements)}</span>
              <p className="text-xs text-muted">
                {t("admin.generatedAnnouncementsHint")}
              </p>
            </div>
          </Card>

          <Card title={t("admin.matchCoverage")}>
            <DonutChart
              size={140}
              centerLabel={t("club.matchesTab")}
              data={[
                { label: t("common.tracked"), value: status.matches, color: "var(--accent)" },
              ]}
            />
            <p className="px-4 pb-4 text-xs text-muted">
              {t("admin.matchCoverageHint")}
            </p>
          </Card>
        </div>
      )}

      {aba === "historico" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t("admin.whyHistory")}>
            <p className="px-4 py-4 text-sm text-muted">
              {t("admin.whyHistoryBody")}
            </p>
          </Card>
          <Card title={t("admin.archiveNumbers")}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-4 py-4 text-sm">
              <Row k={t("admin.levelReadings")} v={fmt(status.snapshots)} />
              <Row k={t("admin.divisionChanges")} v={fmt(status.division_changes)} />
              <Row k={t("admin.accumulatedMatches")} v={fmt(status.matches)} />
              <Row k={t("admin.distinctPlayers")} v={fmt(status.players)} />
              <Row
                k={t("admin.lastMatchLabel")}
                v={status.last_match_at ? fmtDateTime(status.last_match_at) : t("admin.noneYet")}
              />
            </dl>
          </Card>
          <Card title={t("admin.trackedClubs")}>
            <div className="px-4 py-4">
              <Bar value={status.clubs_tracked} max={Math.max(status.clubs_total, 1)} />
              <p className="mt-2 text-xs text-muted">
                {t("admin.trackedClubsHint", { total: fmt(status.clubs_total), pending: fmt(status.clubs_pending) })}
              </p>
            </div>
          </Card>
          <Card title={t("admin.decisions")}>
            <ul className="divide-y divide-[var(--border)] text-sm">
              {[
                [t("admin.decision1"), t("admin.decision1Hint")],
                [t("admin.decision2"), t("admin.decision2Hint")],
                [t("admin.decision3"), t("admin.decision3Hint")],
                [t("admin.decision4"), t("admin.decision4Hint")],
              ].map(([title, d]) => (
                <li key={title} className="flex flex-col gap-0.5 px-4 py-2.5">
                  <b className="text-sm">{title}</b>
                  <span className="text-xs text-muted">{d}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-faint">{k}</dt>
      <dd className="tnum text-right font-mono">{v}</dd>
    </>
  );
}
