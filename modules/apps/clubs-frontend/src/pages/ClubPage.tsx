// Clube: as quatro abas (Resumo, Elenco, Partidas, Números), em linguagem de
// usuário. O clube não acompanhado mostra só os totais gerais, com uma
// explicação explícita — nunca uma tela vazia sem motivo.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, Crosshair, Download, Goal, Skull, Star, Trophy } from "lucide-react";
import { api } from "../lib/api";
import type {
  Club,
  ClubDeltas,
  DivisionChange,
  Evolution,
  HeadToHead,
  Match,
  Records,
  Snapshot,
  SquadMember,
  TimelineEntry,
} from "../lib/types";
import { Card, Crest, Empty, FormChips, Kit, MatchKindBadge, PosTag, ResultBadge, Spinner, Stat } from "../components/ui";
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
} from "../lib/format";
import { useI18n, type Key } from "../lib/i18n";
import { DocumentMeta } from "../lib/document-meta";
import {
  BestByPositionCard,
  IdleCard,
  MainRivalCard,
  PositionHeatmapCard,
  RollingGoalsCard,
  SeasonsCard,
  SquadComparisonCard,
  TeamOfWeekCard,
} from "../components/club-analytics";
import { ClubCompare } from "../components/club-compare";
import { Freshness } from "../components/freshness";
import { clubPalette, crestSeed } from "../lib/crest";

type Tab = "resumo" | "elenco" | "matches" | "numeros" | "historia" | "confronto";

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
      <DocumentMeta
        title={club.name}
        description={[club.tag, club.division ? `D${club.division}` : "", `${club.played} ${t("common.played")}`]
          .filter(Boolean)
          .join(" · ")}
        path={`/club/${club.club_id}`}
      />
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
            <Freshness at={club.updated_at} />
            <FormChips form={club.form} max={20} />
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

      {notFollowed && (
        <NotIndexed
          club={club}
          authed={authed}
          isWatched={isWatched(club.club_id)}
          onToggleWatch={() => onToggleWatch(club.club_id)}
          onOpenMatch={onOpenMatch}
        />
      )}

      {!notFollowed && (
        <>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {(
              [
                ["resumo", t("club.summaryTab")],
                ["elenco", t("club.squadTab")],
                ["matches", t("club.matchesTab")],
                ["numeros", t("club.statsTab")],
                ["historia", t("club.timelineTab")],
                ["confronto", t("club.h2h")],
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

          {tab === "resumo" && <ResumoTab club={club} onOpenMatch={onOpenMatch} onOpenClub={onOpenClub} onOpenPlayer={onOpenPlayer} />}
          {tab === "elenco" && <ElencoTab clubId={club.club_id} onOpenPlayer={onOpenPlayer} />}
          {tab === "matches" && <PartidasTab clubId={club.club_id} onOpenMatch={onOpenMatch} />}
          {tab === "numeros" && <NumerosTab clubId={club.club_id} club={club} onOpenPlayer={onOpenPlayer} onOpenMatch={onOpenMatch} />}
          {tab === "historia" && <HistoriaTab club={club} />}
          {tab === "confronto" && (
            <ConfrontoTab club={club} onOpenClub={onOpenClub} onOpenMatch={onOpenMatch} />
          )}
        </>
      )}
    </>
  );
}

/** O clube conhecido mas não acompanhado: totais gerais, as partidas que o hub
 * JÁ tem dele (apareceram pelos adversários) e o convite para seguir.
 *
 * Por que mudou: antes era só um texto explicando por que faltava dado. Mas o
 * hub costuma ter as partidas do clube -- elas entraram pela descoberta de
 * adversário -- então esconder isso era jogar fora o que já existia. E o texto
 * "por que não tem" era um beco sem saída: agora termina numa AÇÃO (seguir),
 * que é o que transforma visitante em usuário. */
function NotIndexed({
  club,
  authed,
  isWatched,
  onToggleWatch,
  onOpenMatch,
}: {
  club: Club;
  authed: boolean | null;
  isWatched: boolean;
  onToggleWatch: () => void;
  onOpenMatch: (id: string) => void;
}) {
  const { t } = useI18n();
  const [matches, setMatches] = useState<Match[] | null>(null);

  useEffect(() => {
    api.matches(club.club_id, "", 8).then((r) => setMatches(r.matches ?? [])).catch(() => setMatches([]));
  }, [club.club_id]);

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("common.played")} value={fmt(club.played)} />
        <Stat label={t("club.campaign")} value={`${club.wins}V ${club.draws}E ${club.losses}D`} />
        <Stat label={t("club.goalsForAgainst")} value={`${fmt(club.goals)}:${fmt(club.goals_conceded)}`} accent />
        <Stat label={t("common.points")} value={fmt(club.points)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card title={t("club.recentMatches")}>
          {matches === null ? (
            <Spinner />
          ) : matches.length === 0 ? (
            <Empty title={t("club.noMatchesYet")} hint={t("club.nextUpdateHint")} />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {matches.map((m) => (
                <li key={m.match_id}>
                  <button
                    type="button"
                    onClick={() => onOpenMatch(m.match_id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-3"
                  >
                    <ResultBadge resultado={m.our_result} dnf={m.decided_by_forfeit} />
                    <span className="tnum font-display w-14 text-lg font-bold" style={{ color: resultColor(m.our_result) }}>
                      {m.our_goals}–{m.their_goals}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{m.opponent_name}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-faint">
                        <MatchKindBadge kind={m.kind} />
                        <span className="font-mono text-[10px]">{fmtDateTime(m.timestamp)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* O convite: o texto explica o estado e termina numa ação. Sem login,
            o botão leva à área pessoal (é lá que se segue). */}
        <Card title={t("club.notTrackedTitle")}>
          <div className="flex flex-col gap-3 px-4 py-3">
            <p className="text-sm text-muted">{t("club.notTrackedHint2")}</p>
            {authed ? (
              <button
                type="button"
                onClick={onToggleWatch}
                className="rounded-md border px-3 py-2 font-display text-xs font-bold uppercase tracking-wide transition-colors"
                style={
                  isWatched
                    ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" }
                    : { borderColor: "var(--accent)", background: "var(--accent)", color: "var(--accent-ink)" }
                }
              >
                {isWatched ? t("clubs.unfollow") : t("clubs.follow")}
              </button>
            ) : (
              <p className="text-xs text-faint">{t("clubs.signInToFollow")}</p>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

// ------------------------------------------------------------------- resumo

function ResumoTab({ club, onOpenMatch, onOpenClub, onOpenPlayer }: { club: Club; onOpenMatch: (id: string) => void; onOpenClub: (id: string) => void; onOpenPlayer: (id: string) => void }) {
  const { t } = useI18n();
  const [matches, setMatches] = useState<Match[] | null>(null);
  useEffect(() => {
    // A janela recente toda, como o resto das telas: o clube acumula ~20
    // partidas (a fonte dá 10 por tipo e o ingest une os três), então pedir 10
    // aqui mostrava menos do que existe.
    api.matches(club.club_id, "", 20).then((r) => setMatches(r.matches ?? [])).catch(() => setMatches([]));
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
                      <span className="mt-0.5 flex items-center gap-1.5 text-faint">
                        <MatchKindBadge kind={m.kind} />
                        <span className="font-mono text-[10px]">{fmtDateTime(m.timestamp)}</span>
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
              <Kit colors={clubPalette(crestSeed(club), [club.color_1, club.color_2, club.color_3, club.color_4]).kits} label="home" />
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

      {/* Análise do acervo: o que a fonte não responde. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <PositionHeatmapCard clubId={club.club_id} />
        <MainRivalCard club={club} onOpenClub={onOpenClub} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <IdleCard clubId={club.club_id} />
        <div className="lg:col-span-2">
          <BestByPositionCard clubId={club.club_id} onOpenPlayer={onOpenPlayer} />
        </div>
      </div>
      <div className="mt-4">
        <TeamOfWeekCard clubId={club.club_id} onOpenPlayer={onOpenPlayer} />
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

// ------------------------------------------------------------------ história

/** A linha do tempo do clube: o acervo que a fonte não guarda.
 *
 * A EA só conhece o agora (nível atual, divisão atual, ~10 partidas recentes).
 * Esta tela mostra o que o hub ACUMULOU -- quando o clube entrou, as divisões
 * que mudou, os recordes que bateu -- e a mudança desde que a pessoa começou a
 * acompanhar. É o motivo de voltar: o dado aqui cresce a cada atualização, e
 * nenhum outro lugar o tem. */
function HistoriaTab({ club }: { club: Club }) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<TimelineEntry[] | null>(null);
  const [deltas, setDeltas] = useState<ClubDeltas | null>(null);

  useEffect(() => {
    setEntries(null);
    setDeltas(null);
    api.timeline(club.club_id).then((r) => setEntries(r.eventos ?? [])).catch(() => setEntries([]));
    api.deltas(club.club_id).then(setDeltas).catch(() => setDeltas(null));
  }, [club.club_id]);

  const desde = deltas?.since ? fmtDate(deltas.since) : null;

  return (
    <>
      {/* A mudança desde que a pessoa acompanha -- só o hub pode responder. */}
      {deltas && deltas.since && (
        <div className="mb-4">
          <Card title={`${t("club.sinceYouFollow")}${desde ? ` · ${desde}` : ""}`}>
            <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={t("common.matches")} value={fmt(deltas.matches)} sub={`${deltas.wins}V ${deltas.draws}E ${deltas.losses}D`} accent />
              <Stat label={t("common.goals")} value={fmt(deltas.goals)} sub={t("club.goalsForAgainst")} />
              <Stat
                label={t("common.level")}
                value={`${deltas.skill_delta >= 0 ? "+" : ""}${fmt(deltas.skill_delta)}`}
                sub={`${t("club.levelToday")}: ${fmt(club.skill_rating)}`}
              />
              <Stat
                label={t("common.division")}
                value={deltas.division_from > 0 ? `D${deltas.division_from} → D${deltas.division_to}` : `D${deltas.division_to}`}
                sub={t("club.divisionByReading")}
              />
            </div>
          </Card>
        </div>
      )}

      <Card title={t("club.accumulatedHistory")}>
        {entries === null ? (
          <Spinner />
        ) : entries.length === 0 ? (
          <Empty title={t("club.historyStarting")} hint={t("club.evolutionHint")} />
        ) : (
          <ol className="relative px-4 py-3">
            {entries.map((e, i) => (
              <li key={`${e.kind}-${e.at}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
                {/* A linha do fio, ligando um evento ao seguinte. */}
                {i < entries.length - 1 && (
                  <span className="absolute left-[7px] top-4 h-full w-px" style={{ background: "var(--border-strong)" }} />
                )}
                <span
                  className="relative mt-1 size-3.5 shrink-0 rounded-full border-2"
                  style={{
                    borderColor: TIMELINE_COLOR[e.kind] ?? "var(--border-strong)",
                    background: "var(--surface)",
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold">{t(TIMELINE_TITLE_KEY[e.kind] ?? "feed.kind.novidade")}</span>
                    <span className="font-mono text-[10px] text-faint">{fmtDate(e.at)}</span>
                  </div>
                  <div className="text-xs text-muted">{timelineDetail(e, t)}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}

/** A cor do ponto por tipo de evento -- o fio fica legível de relance. */
const TIMELINE_COLOR: Record<string, string> = {
  divisao: "var(--accent)",
  recorde: "var(--warning)",
  marco: "var(--info)",
  seguido: "var(--success)",
};

/** O evento vira frase no idioma escolhido, dos FATOS (`data`), como no feed.
 * O `title` do backend é o fallback de quem não tem os fatos. */
const TIMELINE_TITLE_KEY: Record<string, Key> = {
  divisao: "club.evtDivision",
  recorde: "club.evtRecord",
  marco: "club.evtMilestone",
  seguido: "club.evtFollowed",
};

function timelineDetail(e: TimelineEntry, t: (k: Key, p?: Record<string, string | number>) => string): string {
  const d = e.data ?? {};
  if (e.kind === "divisao") {
    const to = d.new_division as number | undefined;
    const from = d.previous_division as number | undefined;
    if (from != null && to != null) return `D${from} → D${to}`;
  }
  if (e.kind === "recorde") {
    if (d.record === "biggest_win") return `${e.detail ?? ""} · ${d.our_goals}–${d.their_goals}`;
    if (d.record === "highest_scoring") return `${e.detail ?? ""} · ${d.total_goals} ${t("common.goals")}`;  }
  return e.detail ?? "";
}

// ---------------------------------------------------------------- confronto

/** O retrospecto direto (FR-012): o rival sai dos adversários JÁ enfrentados,
 * porque o confronto só existe se os dois se enfrentaram — é o histórico
 * acumulado que o hub guarda, não um comparador arbitrário. */
function ConfrontoTab({
  club,
  onOpenClub,
  onOpenMatch,
}: {
  club: Club;
  onOpenClub: (id: string) => void;
  onOpenMatch: (id: string) => void;
}) {
  const { t } = useI18n();
  const rivals = club.adversarios ?? [];
  const [rivalId, setRivalId] = useState(rivals[0]?.club_id ?? "");
  const [h2h, setH2h] = useState<HeadToHead | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!rivalId) return;
    let cancelled = false;
    setLoading(true);
    setH2h(null);
    api
      .h2h(club.club_id, rivalId)
      .then((r) => !cancelled && setH2h(r))
      .catch(() => !cancelled && setH2h(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [club.club_id, rivalId]);

  if (rivals.length === 0) {
    return <Empty title={t("club.h2hEmpty")} hint={t("club.h2hEmptyHint")} />;
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="label">{t("club.h2hPickRival")}</span>
        <select
          value={rivalId}
          onChange={(e) => setRivalId(e.target.value)}
          className="surface rounded-md px-3 py-2 text-sm outline-none"
          aria-label={t("club.h2hPickRival")}
        >
          {rivals.map((r) => (
            <option key={r.club_id} value={r.club_id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      {loading || !h2h ? (
        <Spinner />
      ) : (
        <>
          <ClubCompare clubs={[h2h.club_a, h2h.club_b]} />
          <Card title={t("club.h2hRecord")}>
            <div className="grid grid-cols-3 gap-3 px-4 py-4 text-center">
              <div>
                <div className="font-display tnum text-3xl font-bold" style={{ color: "var(--success)" }}>
                  {fmt(h2h.wins_a)}
                </div>
                <div className="label mt-1">{t("common.win")}</div>
              </div>
              <div>
                <div className="font-display tnum text-3xl font-bold text-muted">{fmt(h2h.draws)}</div>
                <div className="label mt-1">{t("common.draw")}</div>
              </div>
              <div>
                <div className="font-display tnum text-3xl font-bold" style={{ color: "var(--danger)" }}>
                  {fmt(h2h.losses_a)}
                </div>
                <div className="label mt-1">{t("common.loss")}</div>
              </div>
            </div>
            <div className="flex items-center justify-around border-t border-line px-4 py-3 text-sm">
              <button
                type="button"
                onClick={() => onOpenClub(h2h.club_a.club_id)}
                className="font-semibold hover:text-accent"
              >
                {h2h.club_a.name}
              </button>
              <span className="tnum font-display text-lg font-bold">
                {fmt(h2h.goals_a)}–{fmt(h2h.goals_b)}
              </span>
              <button
                type="button"
                onClick={() => onOpenClub(h2h.club_b.club_id)}
                className="font-semibold hover:text-accent"
              >
                {h2h.club_b.name}
              </button>
            </div>
          </Card>

          {/* A comparação lado a lado: o retrospecto diz quem ganhou os
              confrontos, mas não COMO os dois clubes estão hoje. Os dois
              `ClubRef` já vêm no H2H, então não custa uma consulta nova. */}
          <div className="mt-4">
            <Card title={t("club.h2hCompare")}>
              <ul className="divide-y divide-[var(--border)]">
                {(
                  [
                    [t("common.level"), h2h.club_a.skill_rating, h2h.club_b.skill_rating, false],
                    [t("common.division"), h2h.club_a.division_at_read, h2h.club_b.division_at_read, true],
                    [t("common.points"), h2h.club_a.points, h2h.club_b.points, false],
                    [t("common.goals"), h2h.club_a.goals, h2h.club_b.goals, false],
                    [t("club.goalsAgainst"), h2h.club_a.goals_conceded, h2h.club_b.goals_conceded, true],
                    [t("club.cleanSheets"), h2h.club_a.clean_sheets, h2h.club_b.clean_sheets, false],
                    [t("club.streak"), h2h.club_a.sequencia_invicta, h2h.club_b.sequencia_invicta, false],
                  ] as Array<[string, number, number, boolean]>
                ).map(([label, a, b, invert]) => {
                  // Menor é melhor para divisão e gols sofridos; maior para o
                  // resto. Marcar o melhor dos dois é o ponto da comparação.
                  const aWins = invert ? a < b : a > b;
                  const bWins = invert ? b < a : b > a;
                  return (
                    <li key={label} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span
                        className="tnum w-12 text-right font-mono font-bold"
                        style={{ color: aWins ? "var(--success)" : undefined }}
                      >
                        {fmt(a)}
                      </span>
                      <span className="flex-1 text-center text-[11px] text-faint">{label}</span>
                      <span
                        className="tnum w-12 font-mono font-bold"
                        style={{ color: bWins ? "var(--success)" : undefined }}
                      >
                        {fmt(b)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>

          <div className="mt-4">
            <Card title={t("club.h2hLastMeetings")}>
              {!h2h.matches || h2h.matches.length === 0 ? (
                <Empty title={t("common.noMatches")} />
              ) : (
                <ul className="divide-y divide-[var(--border)]">
                  {h2h.matches.slice(0, 6).map((m) => (
                    <li key={m.match_id}>
                      <button
                        type="button"
                        onClick={() => onOpenMatch(m.match_id)}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-3"
                      >
                        <ResultBadge resultado={m.our_result} dnf={m.decided_by_forfeit} />
                        <span className="tnum font-display w-14 text-lg font-bold" style={{ color: resultColor(m.our_result) }}>
                          {m.our_goals}–{m.their_goals}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">{m.opponent_name}</span>
                        <span className="font-mono text-[10px] text-faint">{fmtDateTime(m.timestamp)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
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
  const [resultado, setResultado] = useState("");
  const [busca, setBusca] = useState("");
  const [list, setList] = useState<Match[] | null>(null);

  useEffect(() => {
    setList(null);
    api.matches(clubId, kind, 40).then((r) => setList(r.matches ?? [])).catch(() => setList([]));
  }, [clubId, kind]);

  // O filtro por tipo vai na API (ela filtra no banco); resultado e adversário
  // filtram a lista já carregada -- não valem uma ida ao servidor por clique.
  const filtrada = useMemo(() => {
    const needle = busca.trim().toLowerCase();
    return (list ?? [])
      .filter((m) => !resultado || m.our_result === resultado)
      .filter((m) => !needle || m.opponent_name.toLowerCase().includes(needle));
  }, [list, resultado, busca]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[
          ["", t("claim.all")],
          ["league", t("match.league")],
          ["friendly", t("match.friendly")],
          ["playoff", t("match.playoff")],
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
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        {/* Filtro por resultado: vitória/empate/derrota. */}
        <div className="flex flex-wrap gap-1.5">
          {[
            ["", t("claim.all")],
            ["win", t("result.win")],
            ["draw", t("result.draw")],
            ["loss", t("result.loss")],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setResultado(k)}
              aria-pressed={resultado === k}
              className="rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
              style={
                resultado === k
                  ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" }
                  : { borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }
              }
            >
              {label}
            </button>
          ))}
        </div>
        <label className="surface flex min-w-[180px] flex-1 items-center gap-2 px-3 py-1.5">
          <span className="text-faint">⌕</span>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={t("club.filterOpponent")}
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
            aria-label={t("club.filterOpponent")}
          />
        </label>
        {list && <span className="font-mono text-xs text-muted">{fmt(filtrada.length)} {t("common.matches")}</span>}
      </div>

      {list === null ? (
        <Spinner />
      ) : filtrada.length === 0 ? (
        <Empty title={t("club.noMatchFilter")} hint={t("club.changeFilterHint")} />
      ) : (
        <div className="surface overflow-hidden">
          <ul className="divide-y divide-[var(--border)]">
            {filtrada.map((m) => (
              <li key={m.match_id}>
                <button
                  type="button"
                  onClick={() => onOpenMatch(m.match_id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-3"
                >
                  <span className="hidden w-24 shrink-0 font-mono text-[10px] text-faint sm:block">
                    {fmtDate(m.timestamp)}
                  </span>
                  <MatchKindBadge kind={m.kind} />
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

/** As séries que os snapshots alimentam. Cada leitura grava o retrato inteiro
 * do clube, então o mesmo dado rende várias linhas: nível, gols, saldo,
 * elenco, aproveitamento. Antes só o nível era desenhado, e o resto do
 * snapshot (acumulado a cada ciclo) ficava no banco sem chegar à tela. */
type EvolutionMetric = "skill_rating" | "goals" | "goals_conceded" | "squad_size" | "points";

const EVOLUTION_METRICS: Array<{ id: EvolutionMetric; label: Key }> = [
  { id: "skill_rating", label: "common.level" },
  { id: "goals", label: "common.goals" },
  { id: "goals_conceded", label: "club.goalsAgainst" },
  { id: "squad_size", label: "club.squadSize" },
  { id: "points", label: "common.points" },
];

/** O valor de uma métrica num snapshot. `points` não vem gravado -- é derivado
 * de V/E/D (3 por vitória, 1 por empate), a mesma conta do resto do app. */
function metricValue(s: Snapshot, metric: EvolutionMetric): number {
  if (metric === "points") return s.wins * 3 + s.draws;
  return s[metric] ?? 0;
}

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
  const [metric, setMetric] = useState<EvolutionMetric>("skill_rating");
  const graficoRef = useRef<HTMLDivElement>(null);
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    api.evolution(clubId).then(setEvo).catch(() => setEvo({ serie: [], total: 0, current: null, historico_curto: true }));
    api.divisionChanges(clubId).then((r) => setChanges(r.mudancas ?? [])).catch(() => setChanges([]));
    api.records(clubId).then(setRec).catch(() => setRec(null));
    api.squad(clubId).then((r) => setSquad(r.players ?? [])).catch(() => setSquad([]));
  }, [clubId]);

  const serie = evo?.serie ?? [];

  // Exportar o histórico como PNG: é o dado que diferencia o hub, e um PNG é o
  // que circula num Discord. Só habilitado quando há série de verdade -- um
  // gráfico de um ponto só não vale o arquivo.
  const exportar = useCallback(async () => {
    if (!graficoRef.current) return;
    setExportando(true);
    try {
      const { exportSvgAsPng } = await import("../lib/export-chart");
      const tema = document.documentElement.dataset.theme === "light" ? "#ffffff" : "#0b0d0f";
      await exportSvgAsPng(graficoRef.current, `${club.name.replace(/\s+/g, "-").toLowerCase()}-historico.png`, {
        background: tema,
      });
    } catch {
      // Silencioso: um download que falha não é erro de tela. A ação pode ser
      // tentada de novo; nada no estado do app mudou.
    } finally {
      setExportando(false);
    }
  }, [club.name]);

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
        <Stat
          label={t("club.longestWinStreak")}
          value={`${rec?.longest_win_streak ?? 0}V`}
          sub={`${t("club.unbeatenStreak")}: ${rec?.longest_unbeaten_streak ?? 0}`}
        />
        <Stat label={t("club.cleanSheets")} value={fmt(rec?.clean_sheets ?? 0)} sub={`/ ${fmt(rec?.total_matches ?? 0)} ${t("common.matches")}`} />
      </div>

      <div className="mb-4">
        <Card
          title={t("club.evolution")}
          actions={
            <div className="flex flex-wrap gap-1.5">
              {EVOLUTION_METRICS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMetric(m.id)}
                  aria-pressed={metric === m.id}
                  className="rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
                  style={
                    metric === m.id
                      ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" }
                      : { borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }
                  }
                >
                  {t(m.label)}
                </button>
              ))}
              {!evo?.historico_curto && (
                <button
                  type="button"
                  onClick={exportar}
                  disabled={exportando}
                  title={t("club.exportHint")}
                  className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50"
                  style={{ borderColor: "var(--border-strong)", color: "var(--text-muted)" }}
                >
                  <Download className="size-3" />
                  {t("club.export")}
                </button>
              )}
            </div>
          }
        >
          {evo === null ? (
            <Spinner />
          ) : evo.historico_curto ? (
            <Empty title={t("club.historyStarting")} hint={t("club.evolutionHint")} />
          ) : (
            <div className="px-2 py-3" ref={graficoRef}>
              <LineChart
                values={serie.map((s) => metricValue(s, metric))}
                labels={serie.map((s) => fmtDate(s.read_at))}
                refLine={metric === "skill_rating" ? { y: 1600, label: "D2" } : undefined}
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

      {/* Análise do acervo: tendências e história que a fonte não guarda. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <RollingGoalsCard clubId={clubId} />
        <PositionHeatmapCard clubId={clubId} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SeasonsCard clubId={clubId} />
        <SquadComparisonCard clubId={clubId} />
      </div>
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
