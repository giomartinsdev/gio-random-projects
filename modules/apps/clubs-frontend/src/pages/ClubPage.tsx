// Clube: as quatro abas (Resumo, Elenco, Partidas, Números), em linguagem de
// usuário. O clube não acompanhado mostra só os totais gerais, com uma
// explicação explícita — nunca uma tela vazia sem motivo.

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, Crosshair, Goal, Skull, Star, Trophy } from "lucide-react";
import { api } from "../lib/api";
import type {
  Club,
  DivisionChange,
  Evolution,
  Match,
  Records,
  SquadMember,
} from "../lib/types";
import { Badge, Card, Crest, Empty, FormChips, Kit, PosTag, ResultBadge, Spinner, Stat } from "../components/ui";
import { PageHead } from "../components/shell";
import { WatchStar, type LucideIcon } from "../components/icons";
import { SyncButton } from "../components/sync-button";
import { BarChart, DivisionSteps, DonutChart, LineChart, Scatter, Spark } from "../components/charts";
import {
  fmt,
  fmtDate,
  fmtDateTime,
  fmtRefresh,
  POS_LABEL,
  POS_ORDER,
  ratingColor,
  resultColor,
  TIPO_LABEL,
} from "../lib/format";
import { useI18n } from "../lib/i18n";

type Tab = "resumo" | "elenco" | "matches" | "numeros";

export function ClubPage({
  clubId,
  onOpenMatch,
  onOpenPlayer,
  onOpenClub,
  isWatched,
  onToggleWatch,
  authed,
}: {
  clubId: string;
  onOpenMatch: (id: string) => void;
  onOpenPlayer: (id: string) => void;
  onOpenClub: (id: string) => void;
  isWatched: (id: string) => boolean;
  onToggleWatch: (id: string) => void;
  authed: boolean | null;
}) {
  const { t } = useI18n();
  const [club, setClub] = useState<Club | null>(null);
  const [error, setErro] = useState("");
  const [tab, setTab] = useState<Tab>("resumo");

  useEffect(() => {
    setClub(null);
    setErro("");
    setTab("resumo");
    api
      .club(clubId)
      .then(setClub)
      .catch((e) => setErro(String(e)));
  }, [clubId]);

  if (error) return <Empty title={t("club.notFound")} hint={error} />;
  if (!club) return <Spinner label={t("club.loading")} />;

  const notFollowed = !club.tracked;

  return (
    <>
      <PageHead
        crumb={
          <button type="button" onClick={() => onOpenClub("")} className="inline-flex items-center gap-1 hover:text-accent">
            <ChevronLeft className="size-3.5" />
            {t("nav.clubs")}
          </button>
        }
        title={club.name}
        sub={
          notFollowed
            ? t("club.notTrackedHint")
            : [club.stadium, club.division ? `${t("club.division")} ${club.division}` : "", club.skill_rating ? `${t("common.level")} ${fmt(club.skill_rating)}` : ""]
                .filter(Boolean)
                .join(" · ")
        }
        actions={
          <>
            <FormChips form={club.form} max={10} />
            <SyncButton target="club" targetId={club.club_id} />
            {authed && (
              <button
                type="button"
                onClick={() => onToggleWatch(club.club_id)}
                className="rounded-md border px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide transition-colors"
                style={
                  isWatched(club.club_id)
                    ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" }
                    : { borderColor: "var(--border-strong)", color: "var(--text-muted)" }
                }
              >
                {isWatched(club.club_id) ? (
                  <>
                    <WatchStar size={13} filled /> seguindo
                  </>
                ) : (
                  <>
                    <WatchStar size={13} filled={false} /> seguir
                  </>
                )}
              </button>
            )}
          </>
        }
      />

      {notFollowed && <NotIndexed club={club} />}

      {!notFollowed && (
        <>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {(
              [
                ["resumo", t("club.summaryTab")],
                ["elenco", t("club.squadTab")],
                ["matches", t("club.matchesTab")],
                ["numeros", t("club.statsTab")],
              ] as Array<[Tab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                aria-pressed={tab === id}
                className="rounded-md px-4 py-1.5 font-display text-xs font-bold uppercase tracking-wide transition-colors"
                style={
                  tab === id
                    ? { background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }
                    : { background: "var(--surface-2)", color: "var(--text-muted)", border: "1px solid var(--border)" }
                }
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "resumo" && <ResumoTab club={club} onOpenMatch={onOpenMatch} />}
          {tab === "elenco" && <ElencoTab clubId={club.club_id} onOpenPlayer={onOpenPlayer} />}
          {tab === "matches" && <PartidasTab clubId={club.club_id} onOpenMatch={onOpenMatch} />}
          {tab === "numeros" && <NumerosTab clubId={club.club_id} club={club} onOpenPlayer={onOpenPlayer} onOpenMatch={onOpenMatch} />}
        </>
      )}
    </>
  );
}

/** O clube conhecido mas não acompanhado: só os totais gerais, com uma
 * explicação de por que o resto não está ali. */
function NotIndexed({ club }: { club: Club }) {
  const { t } = useI18n();
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("common.played")} value={fmt(club.played)} />
        <Stat label={t("club.campaign")} value={`${club.wins}V ${club.draws}E ${club.losses}D`} />
        <Stat label={t("club.goalsForAgainst")} value={`${fmt(club.goals)}:${fmt(club.goals_conceded)}`} accent />
        <Stat label={t("common.points")} value={fmt(club.points)} />
      </div>
      <Card title={t("club.notTrackedTitle")}>
        <p className="px-4 py-3 text-sm text-muted">
          {t("club.notTrackedHint2")}
        </p>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------- resumo

function ResumoTab({ club, onOpenMatch }: { club: Club; onOpenMatch: (id: string) => void }) {
  const { t } = useI18n();
  const [matches, setMatches] = useState<Match[] | null>(null);
  useEffect(() => {
    api.matches(club.club_id, "", 10).then((r) => setMatches(r.matches ?? [])).catch(() => setMatches([]));
  }, [club.club_id]);

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t("common.level")}
          value={fmt(club.skill_rating)}
          sub={club.updated_at ? `${t("action.saved")} ${fmtRefresh(club.updated_at)}` : undefined}
          accent
        />
        <Stat label={t("club.division")} value={`D${club.division}`} sub={`${t("club.bestDivision")}: D${club.best_division}`} />
        <Stat label={t("club.campaign")} value={`${club.wins}V ${club.draws}E ${club.losses}D`} sub={`${fmt(club.goals)} ${t("common.goals")} · ${fmt(club.goals_conceded)}`} />
        <Stat label={t("club.streak")} value={`${club.streak?.wins ?? 0}V`} sub={`${club.streak?.unbeaten ?? 0}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title={t("club.recentMatches")}>
          {matches === null ? (
            <Spinner />
          ) : matches.length === 0 ? (
            <Empty title={t("club.noMatchesYet")} hint={t("club.nextUpdateHint")} />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {matches.slice(0, 6).map((m) => (
                <li key={m.match_id}>
                  <button
                    type="button"
                    onClick={() => onOpenMatch(m.match_id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-3"
                  >
                    <ResultBadge resultado={m.our_result} dnf={m.decided_by_forfeit} />
                    <span
                      className="tnum font-display w-14 text-lg font-bold"
                      style={{ color: resultColor(m.our_result) }}
                    >
                      {m.our_goals}–{m.their_goals}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{m.opponent_name}</span>
                      <span className="block font-mono text-[10px] text-faint">
                        {TIPO_LABEL[m.kind]} · {fmtDateTime(m.timestamp)}
                      </span>
                    </span>
                    {m.avg_rating > 0 && (
                      <span className="tnum font-mono text-sm font-bold" style={{ color: ratingColor(m.avg_rating) }}>
                        {fmt(m.avg_rating, 1)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card title={t("club.kits")}>
            <div className="flex items-center justify-around px-4 py-4">
              <Kit colors={[club.color_1, club.color_2, club.color_3, club.color_4]} label="home" />
              <div className="text-center">
                <Crest club={club} size={44} />
                <div className="label mt-1">{t("club.crest")}</div>
              </div>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line px-4 py-3 text-xs">
              <Row k={t("club.stadium")} v={club.stadium || "—"} />
              <Row k={t("club.division")} v={`D${club.division}`} />
              <Row k={t("club.bestDivision")} v={`D${club.best_division}`} />
              <Row k={t("club.promotions")} v={fmt(club.promotions)} />
              <Row k={t("club.relegations")} v={fmt(club.relegations)} />
            </dl>
          </Card>

          {club.adversarios && club.adversarios.length > 0 && (
            <Card title={t("club.opponents")}>
              <ul className="divide-y divide-[var(--border)]">
                {club.adversarios.slice(0, 5).map((a) => (
                  <li key={a.club_id} className="flex items-center gap-2 px-4 py-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    <span className="tnum font-mono text-faint">
                      {a.wins}V {a.draws}E {a.losses}D
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
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

// ------------------------------------------------------------------- elenco

function ElencoTab({ clubId, onOpenPlayer }: { clubId: string; onOpenPlayer: (id: string) => void }) {
  const { t } = useI18n();
  const [squad, setSquad] = useState<SquadMember[] | null>(null);
  useEffect(() => {
    api.squad(clubId).then((r) => setSquad(r.players ?? [])).catch(() => setSquad([]));
  }, [clubId]);

  if (squad === null) return <Spinner />;
  if (squad.length === 0) {
    return <Empty title={t("club.squadUnavailable")} hint={t("club.squadFromMatches")} />;
  }

  const porPosicao = POS_ORDER.map((p) => ({
    label: POS_LABEL[p],
    value: squad.filter((s) => s.position === p).length,
  }));

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("common.players")} value={fmt(squad.length)} sub={porPosicao.map((p) => `${p.value} ${p.label.slice(0, 3).toLowerCase()}`).join(" · ")} />
        <Stat label={t("club.ratingAvg")} value={fmt(squad.reduce((a, s) => a + s.rating, 0) / squad.length, 2)} />
        <Stat label={t("common.goals")} value={fmt(squad.reduce((a, s) => a + s.goals, 0))} sub={`${fmt(squad.reduce((a, s) => a + s.assists, 0))} ${t("common.assists")}`} />
        <Stat label={t("player.motm")} value={fmt(squad.reduce((a, s) => a + s.man_of_the_match, 0))} sub={t("common.when") && "x"} accent />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title={t("common.players")}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 text-faint">
                  <Th>{t("common.player")}</Th>
                  <Th>{t("common.pos")}</Th>
                  <Th right>{t("common.played")}</Th>
                  <Th right>{t("common.goals")}</Th>
                  <Th right>{t("common.assists")}</Th>
                  <Th right>{t("common.rating")}</Th>
                  <Th right>{t("club.form")}</Th>
                </tr>
              </thead>
              <tbody>
                {squad.map((s) => (
                  <tr
                    key={s.player_id}
                    className="cursor-pointer border-t border-line transition-colors hover:bg-surface-3"
                    onClick={() => onOpenPlayer(s.player_id)}
                  >
                    <td className="px-3 py-2 font-semibold">{s.gamertag}</td>
                    <td className="px-3 py-2">
                      <PosTag position={s.position} />
                    </td>
                    <td className="tnum px-3 py-2 text-right font-mono">{fmt(s.played)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono">{fmt(s.goals)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono">{fmt(s.assists)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono font-bold" style={{ color: ratingColor(s.rating) }}>
                      {fmt(s.rating, 2)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Spark values={s.form} width={70} height={20} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title={t("club.composition")}>
          <div className="px-4 py-4">
            <DonutChart data={porPosicao} centerLabel={t("common.players")} size={150} />
          </div>
        </Card>
      </div>
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

// ----------------------------------------------------------------- partidas

function PartidasTab({ clubId, onOpenMatch }: { clubId: string; onOpenMatch: (id: string) => void }) {
  const { t } = useI18n();
  const [kind, setTipo] = useState("");
  const [list, setList] = useState<Match[] | null>(null);

  useEffect(() => {
    setList(null);
    api.matches(clubId, kind, 40).then((r) => setList(r.matches ?? [])).catch(() => setList([]));
  }, [clubId, kind]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[
          ["", t("claim.all")],
          ["league", TIPO_LABEL["league"]],
          ["friendly", TIPO_LABEL["friendly"]],
          ["playoff", TIPO_LABEL["playoff"]],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTipo(k)}
            aria-pressed={kind === k}
            className="rounded-full border px-3 py-1 text-xs font-semibold capitalize transition-colors"
            style={
              kind === k
                ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" }
                : { borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }
            }
          >
            {label}
          </button>
        ))}
        {list && <span className="ml-auto font-mono text-xs text-muted">{fmt(list.length)} {t("common.matches")}</span>}
      </div>

      {list === null ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Empty title={t("club.noMatchFilter")} hint={t("club.changeFilterHint")} />
      ) : (
        <div className="surface overflow-hidden">
          <ul className="divide-y divide-[var(--border)]">
            {list.map((m) => (
              <li key={m.match_id}>
                <button
                  type="button"
                  onClick={() => onOpenMatch(m.match_id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-3"
                >
                  <span className="hidden w-24 shrink-0 font-mono text-[10px] text-faint sm:block">
                    {fmtDate(m.timestamp)}
                  </span>
                  <Badge>{TIPO_LABEL[m.kind]}</Badge>
                  <ResultBadge resultado={m.our_result} dnf={m.decided_by_forfeit} />
                  <span className="tnum font-display w-16 font-bold" style={{ color: resultColor(m.our_result) }}>
                    {m.our_goals}–{m.their_goals}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{m.opponent_name}</span>
                  {m.avg_rating > 0 && (
                    <span className="tnum font-mono text-sm font-bold" style={{ color: ratingColor(m.avg_rating) }}>
                      {fmt(m.avg_rating, 1)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ números

function NumerosTab({
  clubId,
  club,
  onOpenPlayer,
  onOpenMatch,
}: {
  clubId: string;
  club: Club;
  onOpenPlayer: (id: string) => void;
  onOpenMatch: (id: string) => void;
}) {
  const { t } = useI18n();
  const [evo, setEvo] = useState<Evolution | null>(null);
  const [changes, setChanges] = useState<DivisionChange[]>([]);
  const [rec, setRec] = useState<Records | null>(null);
  const [squad, setSquad] = useState<SquadMember[]>([]);

  useEffect(() => {
    api.evolution(clubId).then(setEvo).catch(() => setEvo({ serie: [], total: 0, current: null, historico_curto: true }));
    api.divisionChanges(clubId).then((r) => setChanges(r.mudancas ?? [])).catch(() => setChanges([]));
    api.records(clubId).then(setRec).catch(() => setRec(null));
    api.squad(clubId).then((r) => setSquad(r.players ?? [])).catch(() => setSquad([]));
  }, [clubId]);

  const serie = evo?.serie ?? [];

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t("club.levelToday")}
          value={fmt(club.skill_rating)}
          sub={serie.length >= 2 ? `${serie.length} ${t("admin.levelReadings")}` : t("club.historyGrows")}
          accent
        />
        <Stat label={t("club.divisionChanges")} value={fmt(changes.length)} sub={changes.length ? t("common.inferred") : t("admin.noneYet")} />
        <Stat label={t("club.longestWinStreak")} value={`${rec?.longest_win_streak ?? 0}V`} sub={t("club.accumulatedHistory")} />
        <Stat label={t("club.cleanSheets")} value={fmt(rec?.clean_sheets ?? 0)} sub={`/ ${fmt(rec?.total_matches ?? 0)} ${t("common.matches")}`} />
      </div>

      <div className="mb-4">
        <Card title={t("club.levelEvolution")}>
          {evo === null ? (
            <Spinner />
          ) : evo.historico_curto ? (
            <Empty
              title={t("club.historyStarting")}
              hint={t("club.levelEvolutionHint")}
            />
          ) : (
            <div className="px-2 py-3">
              <LineChart
                values={serie.map((s) => s.skill_rating)}
                labels={serie.map((s) => fmtDate(s.read_at))}
                refLine={{ y: 1600, label: "D2" }}
              />
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("club.divisionSteps")}>
          {changes.length === 0 ? (
            <Empty title={t("club.noDivisionChange")} hint={t("club.divisionChangeHint")} />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {changes.map((c, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span
                    className="shrink-0"
                    style={{ color: c.kind === "promotion" ? "var(--success)" : "var(--danger)" }}
                  >
                    {c.kind === "promotion" ? (
                      <ArrowUp className="size-4" strokeWidth={2.5} />
                    ) : (
                      <ArrowDown className="size-4" strokeWidth={2.5} />
                    )}
                  </span>
                  <span className="flex-1">
                    {c.kind === "promotion" ? t("club.promoted") : t("club.relegated")} D{c.previous_division} → D{c.new_division}
                  </span>
                  <span className="font-mono text-[10px] text-faint">{fmtDateTime(c.detected_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("club.divisionByReading")}>
          <DivisionSteps snapshots={serie.slice(-12)} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title={t("club.recordBook")}>
          {!rec ? (
            <Spinner />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {rec.biggest_win && (
                <RecLine medal={Trophy} title={t("club.biggestWin")} value={`${rec.biggest_win.our_goals}–${rec.biggest_win.their_goals}`} detail={`vs ${rec.biggest_win.opponent_name}`} onClick={() => onOpenMatch(rec.biggest_win!.match_id)} />
              )}
              {rec.worst_loss && (
                <RecLine medal={Skull} title={t("club.worstLoss")} value={`${rec.worst_loss.our_goals}–${rec.worst_loss.their_goals}`} detail={`vs ${rec.worst_loss.opponent_name}`} onClick={() => onOpenMatch(rec.worst_loss!.match_id)} />
              )}
              {rec.highest_scoring_match && (
                <RecLine medal={Crosshair} title={t("club.highestScoring")} value={String(rec.highest_scoring_match.total_goals)} detail={`vs ${rec.highest_scoring_match.opponent_name}`} onClick={() => onOpenMatch(rec.highest_scoring_match!.match_id)} />
              )}
              {rec.best_rating && (
                <RecLine medal={Star} title={t("club.bestRating")} value={fmt(rec.best_rating.rating, 2)} detail={`${rec.best_rating.gamertag} vs ${rec.best_rating.opponent_name}`} onClick={() => onOpenPlayer(rec.best_rating!.player_id)} />
              )}
              {rec.most_goals_in_match && (
                <RecLine medal={Goal} title={t("club.mostGoalsInMatch")} value={String(rec.most_goals_in_match.goals)} detail={`${rec.most_goals_in_match.gamertag} vs ${rec.most_goals_in_match.opponent_name}`} onClick={() => onOpenPlayer(rec.most_goals_in_match!.player_id)} />
              )}
            </ul>
          )}
        </Card>

        <Card title={t("club.scorers")}>
          {squad.length === 0 ? (
            <Empty title={t("common.noData")} />
          ) : (
            <div className="px-2 py-3">
              <BarChart
                height={210}
                items={squad.slice(0, 8).map((s) => ({ label: s.gamertag.slice(0, 8), value: s.goals }))}
              />
            </div>
          )}
        </Card>
      </div>

      {squad.length > 3 && (
        <div className="mt-4">
          <Card title={t("club.goalsVsRating")}>
            <div className="px-2 py-3">
              <Scatter
                height={260}
                xLabel={t("common.goals")}
                yLabel={t("common.rating")}
                points={squad.map((s) => ({ x: s.goals, y: s.rating, label: s.gamertag, highlight: s.rating >= 7.8 }))}
              />
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function RecLine({
  medal,
  title,
  value,
  detail,
  onClick,
}: {
  medal: LucideIcon;
  title: string;
  value: string;
  detail: string;
  onClick: () => void;
}) {
  const Icon = medal;
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[var(--accent-soft)]">
          <Icon className="size-3.5" style={{ color: "var(--accent)" }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{title}</span>
          <span className="block truncate font-mono text-[10px] text-faint">{detail}</span>
        </span>
        <span className="tnum font-display text-lg font-bold">{value}</span>
      </button>
    </li>
  );
}
