// Painel de análise do clube: as visões que vêm do ACERVO acumulado, não da
// janela da fonte.
//
// Cada bloco responde a uma pergunta que a EA não responde -- distribuição do
// elenco por posição, gols pró vs contra por jogo, rivalidade principal,
// temporadas, elenco que mudou, inatividade, melhores por posição. É o que faz
// o hub ser mais que um espelho da fonte.

import { useEffect, useState } from "react";
import { Activity, CalendarClock, Swords, TrendingUp, Users } from "lucide-react";
import { api } from "../lib/api";
import type {
  BestByPosition,
  Club,
  ClubIdle,
  MainRival,
  PositionHeatmap,
  RollingGoals,
  SeasonList,
  SquadComparison,
} from "../lib/types";
import { Bar, Card, Crest, Empty, PosTag, Spinner } from "./ui";
import { LineChart } from "./charts";
import { fmt, fmtDate } from "../lib/format";
import { useI18n } from "../lib/i18n";

/** O heatmap de posição: quantos jogadores distintos o clube tem em cada uma. */
export function PositionHeatmapCard({ clubId }: { clubId: string }) {
  const { t } = useI18n();
  const [h, setH] = useState<PositionHeatmap | null>(null);
  useEffect(() => {
    setH(null);
    api.positionHeatmap(clubId).then(setH).catch(() => setH({ buckets: [], total: 0 }));
  }, [clubId]);

  const max = Math.max(1, ...(h?.buckets ?? []).map((b) => b.players));
  return (
    <Card title={t("analytics.positions")}>
      {h === null ? (
        <Spinner />
      ) : (h.buckets ?? []).length === 0 ? (
        <Empty title={t("common.noData")} hint={t("analytics.positionsHint")} />
      ) : (
        <div className="flex flex-col gap-2 px-4 py-3">
          {(h.buckets ?? []).map((b) => (
            <div key={b.position} className="flex items-center gap-3">
              <span className="w-24 shrink-0">
                <PosTag position={b.position} />
              </span>
              <span className="flex-1">
                <Bar value={b.players} max={max} />
              </span>
              <span className="tnum w-8 text-right font-mono text-xs font-bold">{fmt(b.players)}</span>
            </div>
          ))}
          <p className="mt-1 font-mono text-[10px] text-faint">
            {fmt(h.total)} {t("common.players")} · {t("analytics.distinctPlayers")}
          </p>
        </div>
      )}
    </Card>
  );
}

/** Gols pró e contra por partida, em ordem cronológica. */
export function RollingGoalsCard({ clubId }: { clubId: string }) {
  const { t } = useI18n();
  const [g, setG] = useState<RollingGoals | null>(null);
  useEffect(() => {
    setG(null);
    api.rollingGoals(clubId).then(setG).catch(() => setG({ matches: [] }));
  }, [clubId]);

  const pts = g?.matches ?? [];
  return (
    <Card title={t("analytics.goalsTrend")}>
      {g === null ? (
        <Spinner />
      ) : pts.length < 2 ? (
        <Empty title={t("club.historyStarting")} hint={t("analytics.goalsTrendHint")} />
      ) : (
        <div className="px-2 py-3">
          <LineChart
            values={pts.map((p) => p.our)}
            labels={pts.map((p) => fmtDate(p.timestamp))}
            height={200}
            yFormat={(v) => fmt(v)}
          />
          <div className="flex items-center justify-center gap-4 pt-1 font-mono text-[10px] text-faint">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block size-2 rounded-full" style={{ background: "var(--accent)" }} />
              {t("analytics.goalsFor")}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

/** A rivalidade principal: o adversário mais frequente no acervo. */
export function MainRivalCard({ club, onOpenClub }: { club: Club; onOpenClub: (id: string) => void }) {
  const { t } = useI18n();
  const [rival, setRival] = useState<MainRival | null | undefined>(undefined);
  useEffect(() => {
    setRival(undefined);
    api.mainRival(club.club_id).then((r) => setRival(r.rival)).catch(() => setRival(null));
  }, [club.club_id]);

  return (
    <Card title={t("analytics.mainRival")}>
      {rival === undefined ? (
        <Spinner />
      ) : rival === null ? (
        <Empty title={t("analytics.noRival")} hint={t("analytics.noRivalHint")} />
      ) : (
        <button
          type="button"
          onClick={() => onOpenClub(rival.club_id)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-3"
        >
          <Crest club={{ name: rival.name, tag: rival.tag, color_1: 0, color_2: 0, color_3: 0, color_4: 0, crest_asset_id: "", club_id: rival.club_id }} size={34} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{rival.name}</span>
            <span className="block font-mono text-[10px] text-faint">
              {fmt(rival.played)} {t("common.matches")} · {rival.wins}V {rival.draws}E {rival.losses}D
            </span>
          </span>
          <Swords className="size-4 shrink-0" style={{ color: "var(--accent)" }} />
        </button>
      )}
    </Card>
  );
}

/** Há quanto tempo o clube não joga. */
export function IdleCard({ clubId }: { clubId: string }) {
  const { t } = useI18n();
  const [idle, setIdle] = useState<ClubIdle | null>(null);
  useEffect(() => {
    setIdle(null);
    api.idle(clubId).then(setIdle).catch(() => setIdle({ last_match: null, days: 0, idle: false }));
  }, [clubId]);

  if (idle === null) return null;
  return (
    <Card title={t("analytics.activity")}>
      <div className="flex items-center gap-3 px-4 py-4">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-lg"
          style={{
            background: idle.idle ? "var(--warning-soft)" : "var(--success-soft)",
            color: idle.idle ? "var(--warning)" : "var(--success)",
          }}
        >
          {idle.idle ? <CalendarClock className="size-5" /> : <Activity className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">
            {idle.last_match ? `${t("analytics.lastPlayed")} ${fmtDate(idle.last_match)}` : t("common.noMatches")}
          </div>
          <div className="font-mono text-[10px]" style={{ color: idle.idle ? "var(--warning)" : "var(--text-faint)" }}>
            {idle.last_match
              ? idle.idle
                ? `${idle.days} ${t("analytics.daysIdle")}`
                : t("analytics.active")
              : "—"}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Os melhores por posição do clube. */
export function BestByPositionCard({ clubId, onOpenPlayer }: { clubId: string; onOpenPlayer: (id: string) => void }) {
  const { t } = useI18n();
  const [list, setList] = useState<BestByPosition[] | null>(null);
  useEffect(() => {
    setList(null);
    api.bestByPosition(clubId).then((r) => setList(r.posicoes ?? [])).catch(() => setList([]));
  }, [clubId]);

  return (
    <Card title={t("analytics.bestByPosition")}>
      {list === null ? (
        <Spinner />
      ) : list.length === 0 ? (
        <Empty title={t("common.noData")} hint={t("analytics.positionsHint")} />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {list.map((b) => (
            <li key={b.position}>
              <button
                type="button"
                onClick={() => onOpenPlayer(b.player.player_id)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-3"
              >
                <PosTag position={b.position} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{b.player.gamertag}</span>
                <span className="font-mono text-[10px] text-faint">
                  {fmt(b.player.goals)} {t("common.goals")}
                </span>
                <span className="tnum font-display text-sm font-bold" style={{ color: "var(--accent)" }}>
                  {fmt(b.player.rating, 1)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** O elenco que mudou entre a temporada corrente e a anterior. */
export function SquadComparisonCard({ clubId }: { clubId: string }) {
  const { t } = useI18n();
  const [c, setC] = useState<SquadComparison | null>(null);
  useEffect(() => {
    setC(null);
    api.squadComparison(clubId).then(setC).catch(() => setC(null));
  }, [clubId]);

  if (c === null) return null;
  if (!c.from || (!(c.entraram ?? []).length && !(c.sairam ?? []).length)) {
    return (
      <Card title={t("analytics.squadChanges")}>
        <Empty title={t("analytics.noSquadChanges")} hint={t("analytics.squadChangesHint")} />
      </Card>
    );
  }

  const linha = (kind: "entrou" | "saiu", rows: SquadComparison["entraram"]) => (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-faint">
        {kind === "entrou" ? <TrendingUp className="size-3.5" style={{ color: "var(--success)" }} /> : <Users className="size-3.5" />}
        <span className="label">{t(kind === "entrou" ? "analytics.entered" : "analytics.left")}</span>
      </div>
      {(rows ?? []).length === 0 ? (
        <span className="text-xs text-faint">—</span>
      ) : (
        (rows ?? []).map((r) => (
          <div key={r.player_id} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate">{r.gamertag}</span>
            <span className="font-mono text-[10px] text-faint">{fmt(r.goals)} {t("common.goals")}</span>
          </div>
        ))
      )}
    </div>
  );

  return (
    <Card title={`${t("analytics.squadChanges")} · ${c.from} → ${c.to}`}>
      <div className="grid gap-4 px-4 py-3 sm:grid-cols-2">
        {linha("entrou", c.entraram)}
        {linha("saiu", c.sairam)}
      </div>
    </Card>
  );
}

/** As temporadas do clube, com o artilheiro de cada uma. */
export function SeasonsCard({ clubId }: { clubId: string }) {
  const { t } = useI18n();
  const [s, setS] = useState<SeasonList | null>(null);
  useEffect(() => {
    setS(null);
    api.seasons(clubId).then(setS).catch(() => setS({ seasons: [], current: "" }));
  }, [clubId]);

  const seasons = [...(s?.seasons ?? [])].reverse();
  return (
    <Card title={t("analytics.seasons")}>
      {s === null ? (
        <Spinner />
      ) : seasons.length === 0 ? (
        <Empty title={t("club.historyStarting")} hint={t("analytics.seasonsHint")} />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {seasons.map((sn) => (
            <li key={sn.season} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-sm font-bold">
                  {sn.season}
                  {sn.season === s?.current && (
                    <span className="ml-2 font-mono text-[9px] uppercase" style={{ color: "var(--accent)" }}>
                      {t("analytics.current")}
                    </span>
                  )}
                </span>
                <span className="font-mono text-[10px] text-faint">
                  {fmt(sn.played)} {t("common.matches")}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[10px] text-muted">
                <span>{sn.wins}V {sn.draws}E {sn.losses}D</span>
                <span>{fmt(sn.goals)}–{fmt(sn.against)}</span>
              </div>
              {sn.scorers && sn.scorers.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {sn.scorers.slice(0, 3).map((sc) => (
                    <span key={sc.player_id} className="rounded-full border border-line px-2 py-0.5 text-[10px]">
                      {sc.gamertag} · {fmt(sc.goals)}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
