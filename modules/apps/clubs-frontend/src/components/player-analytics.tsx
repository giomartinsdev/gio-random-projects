// Análise do jogador que vem do acervo: evolução de nota, consistência,
// disciplina, tempo em cada clube e perfil de eventos.

import { useEffect, useState } from "react";
import { AlertTriangle, Award, CalendarRange, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import type {
  PlayerClubTenure,
  PlayerConsistency,
  PlayerDiscipline,
  PlayerEventBreakdown,
  PlayerRatingEvolution,
} from "../lib/types";
import { Bar, Card, Empty, Spinner } from "./ui";
import { LineChart } from "./charts";
import { fmt, fmtDate } from "../lib/format";
import { useI18n } from "../lib/i18n";

/** A nota por partida -- o "sparkline" do perfil, com o contexto da atuação. */
export function RatingEvolutionCard({ playerId }: { playerId: string }) {
  const { t } = useI18n();
  const [evo, setEvo] = useState<PlayerRatingEvolution | null>(null);
  useEffect(() => {
    setEvo(null);
    api.ratingEvolution(playerId).then(setEvo).catch(() => setEvo({ points: [] }));
  }, [playerId]);

  const pts = evo?.points ?? [];
  return (
    <Card title={t("analytics.ratingEvolution")}>
      {evo === null ? (
        <Spinner />
      ) : pts.length < 2 ? (
        <Empty title={t("player.noAppearances")} hint={t("analytics.ratingEvolutionHint")} />
      ) : (
        <div className="px-2 py-3">
          <LineChart
            values={pts.map((p) => p.rating)}
            labels={pts.map((p) => fmtDate(p.timestamp))}
            height={200}
            yFormat={(v) => fmt(v, 1)}
          />
        </div>
      )}
    </Card>
  );
}

/** Consistência: média, variação e o rótulo derivado. */
export function ConsistencyCard({ playerId }: { playerId: string }) {
  const { t } = useI18n();
  const [c, setC] = useState<PlayerConsistency | null>(null);
  useEffect(() => {
    setC(null);
    api.consistency(playerId).then(setC).catch(() => setC(null));
  }, [playerId]);

  if (!c || c.played === 0) return null;
  // Volatilidade baixa é bom (jogador regular); alta é ruim. O corte em 15% é
  // uma leitura de produto: abaixo disso o jogador é previsível.
  const regular = c.volatility <= 15;
  return (
    <Card title={t("analytics.consistency")}>
      <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4">
        <Metric label={t("analytics.mean")} value={fmt(c.mean, 2)} />
        <Metric label={t("analytics.stddev")} value={fmt(c.std_dev, 2)} />
        <Metric label={t("analytics.volatility")} value={`${fmt(c.volatility, 1)}%`} />
        <Metric
          label={t("common.rating")}
          value={`${fmt(c.worst, 1)}–${fmt(c.best, 1)}`}
          sub={regular ? t("analytics.steady") : t("analytics.volatile")}
          tone={regular ? "var(--success)" : "var(--warning)"}
        />
      </div>
      <p className="border-t border-line px-4 py-2 text-[11px] text-faint">{t("analytics.consistencyHint")}</p>
    </Card>
  );
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="font-display tnum text-lg font-bold" style={{ color: tone }}>
        {value}
      </div>
      {sub && <div className="font-mono text-[10px] text-faint">{sub}</div>}
    </div>
  );
}

/** Disciplina: cartões e clean sheets no acervo. */
export function DisciplineCard({ playerId }: { playerId: string }) {
  const { t } = useI18n();
  const [d, setD] = useState<PlayerDiscipline | null>(null);
  useEffect(() => {
    setD(null);
    api.discipline(playerId).then(setD).catch(() => setD(null));
  }, [playerId]);

  if (!d || d.matches === 0) return null;
  return (
    <Card title={t("analytics.discipline")}>
      <div className="grid grid-cols-3 gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4" style={{ color: d.red_cards > 0 ? "var(--danger)" : "var(--text-faint)" }} />
          <Metric label={t("analytics.redCards")} value={fmt(d.red_cards)} />
        </div>
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4" style={{ color: "var(--success)" }} />
          <Metric label={t("analytics.cleanSheets")} value={fmt(d.clean_sheets)} />
        </div>
        <Metric label={t("common.played")} value={fmt(d.matches)} />
      </div>
    </Card>
  );
}

/** Tempo em cada clube, da primeira à última aparição. */
export function TenureCard({ playerId }: { playerId: string }) {
  const { t } = useI18n();
  const [list, setList] = useState<PlayerClubTenure[] | null>(null);
  useEffect(() => {
    setList(null);
    api.tenures(playerId).then((r) => setList(r.clubes ?? [])).catch(() => setList([]));
  }, [playerId]);

  if (list === null) return null;
  return (
    <Card title={t("analytics.tenure")}>
      {list.length === 0 ? (
        <Empty title={t("common.noData")} hint={t("analytics.tenureHint")} />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {list.map((tt) => (
            <li key={tt.club_id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <CalendarRange className="size-3.5 shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate font-semibold">{tt.club_name || tt.club_id}</span>
              <span className="font-mono text-[10px] text-faint">
                {fmt(tt.matches)} {t("common.matches")} · {fmt(tt.days)}d
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-line px-4 py-2 text-[11px] text-faint">{t("analytics.tenureHint")}</p>
    </Card>
  );
}

/** Perfil de eventos: contagem por TIPO (a fonte não dá o minuto). */
export function EventProfileCard({ playerId }: { playerId: string }) {
  const { t } = useI18n();
  const [ev, setEv] = useState<PlayerEventBreakdown | null>(null);
  useEffect(() => {
    setEv(null);
    api.playerEvents(playerId).then(setEv).catch(() => setEv({ player_id: playerId, events: [] }));
  }, [playerId]);

  const events = ev?.events ?? [];
  const max = Math.max(1, ...events.map((e) => e.count));
  return (
    <Card title={t("analytics.events")} actions={<Award className="size-4 text-faint" />}>
      {ev === null ? (
        <Spinner />
      ) : events.length === 0 ? (
        <Empty title={t("common.noData")} hint={t("analytics.eventsHint")} />
      ) : (
        <div className="flex flex-col gap-2 px-4 py-3">
          {events.slice(0, 8).map((e) => (
            <div key={e.label} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate font-mono text-[10.5px] text-muted">{e.label}</span>
              <span className="flex-1">
                <Bar value={e.count} max={max} color="var(--info)" />
              </span>
              <span className="tnum w-10 text-right font-mono text-xs font-bold">{fmt(e.count)}</span>
            </div>
          ))}
          <p className="mt-1 text-[11px] text-faint">{t("analytics.eventsHint")}</p>
        </div>
      )}
    </Card>
  );
}
