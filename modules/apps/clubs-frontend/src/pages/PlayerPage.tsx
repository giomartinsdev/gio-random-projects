// Jogador: temporada, forma, gols por jogo, defesas do goleiro e os clubes
// por onde passou. O selo de verificado só aparece para quem reivindicou o pro.

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { api } from "../lib/api";
import type { ClaimedPro, PlayerProfile } from "../lib/types";
import { Badge, Card, Empty, MatchKindBadge, PosTag, ResultBadge, Spinner, Stat } from "../components/ui";
import { SyncButton } from "../components/sync-button";
import { PageHead } from "../components/shell";
import { VerifiedIcon } from "../components/icons";
import { BarChart, LineChart } from "../components/charts";
import { fmt, minutes, POS_LABEL, POS_SHORT, ratingColor, SAVE_LABEL } from "../lib/format";
import { useI18n } from "../lib/i18n";

export function PlayerPage({
  playerId,
  authed,
  claimed,
  onClaim,
  onOpenClub,
  onOpenMatch,
  onBack,
}: {
  playerId: string;
  authed: boolean | null;
  claimed: ClaimedPro | null;
  onClaim: (clubId: string, playerId: string) => Promise<void>;
  onOpenClub: (id: string) => void;
  onOpenMatch: (id: string) => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const [p, setP] = useState<PlayerProfile | null>(null);
  const [error, setErro] = useState("");
  const [reivindicando, setReivindicando] = useState(false);

  // Separado do primeiro load para o sync poder recarregar sem apagar a tela:
  // o perfil é DERIVADO das partidas, então ele muda quando o sync termina.
  const recarregar = useCallback(() => {
    api.player(playerId).then(setP).catch(() => {});
  }, [playerId]);

  useEffect(() => {
    setP(null);
    api.player(playerId).then(setP).catch((e) => setErro(String(e)));
  }, [playerId]);

  if (error) return <Empty title={t("player.notFound")} hint={error} />;
  if (!p) return <Spinner label={t("player.loading")} />;

  const matches = p.matches ?? [];
  const seasons = p.seasons ?? [];
  // O pro DESTA pessoa. O selo do perfil é público (qualquer um vê que o pro
  // foi reivindicado), mas o botão só faz sentido para quem entrou e ainda
  // não reivindicou — e o seu próprio pro não se re-reivindica.
  const meu = claimed?.player_id === p.player_id;
  const outroPro = !!claimed && !meu;

  return (
    <>
      <PageHead
        crumb={
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 hover:text-accent">
            <ChevronLeft className="size-3.5" />
            {t("action.back")}
          </button>
        }
        title={p.gamertag}
        sub={`${POS_LABEL[p.position]} · ${p.club_name || t("common.noData")}`}
        actions={
          <>
            {p.verified && (
              <Badge tone="accent">
                <VerifiedIcon /> {t("claim.verified")}
              </Badge>
            )}
            <SyncButton target="player" targetId={playerId} onDone={recarregar} />
            <span className="font-display tnum text-3xl font-bold" style={{ color: ratingColor(p.rating) }}>
              {fmt(p.rating, 2)}
            </span>
          </>
        }
      />

      {authed === true && !outroPro && (
        <div className="mb-4">
          {meu ? (
            <div className="surface flex flex-wrap items-center gap-3 px-4 py-3">
              <Badge tone="accent">
                <VerifiedIcon /> {t("claim.yourPro")}
              </Badge>
              <span className="text-xs text-muted">
                {t("player.mineHint")}
              </span>
            </div>
          ) : (
            <div className="surface flex flex-wrap items-center gap-3 px-4 py-3">
              <button
                type="button"
                disabled={reivindicando || !p.club_id}
                onClick={() => {
                  setReivindicando(true);
                  onClaim(p.club_id, p.player_id).catch(() => setReivindicando(false));
                }}
                className="rounded-md border px-3 py-1.5 font-display text-xs font-bold uppercase tracking-wide transition-colors disabled:opacity-40"
                style={{ borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" }}
              >
                {reivindicando ? t("player.claiming") : t("player.thisIsMe")}
              </button>
              <span className="text-xs text-muted">
                {t("player.claimHint")}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t("player.ratingAvg")} value={fmt(p.rating, 2)} sub={`${fmt(p.played)} ${t("common.played")}`} accent />
        <Stat label={t("player.goalsPerGame")} value={fmt(p.goals_per_game, 2)} sub={`${fmt(p.goals)} ${t("common.goals")}`} />
        <Stat label={t("player.assistsPerGame")} value={fmt(p.assists_per_game, 2)} sub={`${fmt(p.assists)} ${t("common.total")}`} />
        <Stat label={t("player.motm")} value={`${fmt(p.man_of_the_match)}x`} sub={`${minutes(p.seconds_played)} ${t("common.min")}`} />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label={t("player.passAccuracy")} value={`${fmt(p.pass_accuracy)}%`} />
        <Stat label={t("player.tackleAccuracy")} value={`${fmt(p.tackle_accuracy)}%`} />
        <Stat
          label={p.goalkeeper ? t("player.keeperSaves") : t("player.motm")}
          value={p.goalkeeper ? fmt(p.clean_sheets) : `${fmt(p.man_of_the_match)}x`}
          sub={p.goalkeeper ? t("club.cleanSheets") : undefined}
        />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title={t("player.form")}>
          {matches.length < 2 ? (
            <Empty title={t("club.historyStarting")} hint={t("player.formEmptyHint")} />
          ) : (
            <div className="px-2 py-3">
              <LineChart
                values={[...matches].reverse().map((x) => x.rating)}
                labels={[...matches].reverse().map((x) => x.opponent_name.slice(0, 8))}
                height={210}
                yFormat={(v) => fmt(v, 1)}
                refLine={{ y: 7.5, label: "rating 7,5" }}
              />
            </div>
          )}
        </Card>

        <Card title={t("player.season")}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-sm">
            <dt className="text-faint">{t("common.position")}</dt>
            <dd className="text-right">
              <PosTag position={p.position} />
            </dd>
            <dt className="text-faint">{t("common.played")}</dt>
            <dd className="tnum text-right font-mono">{fmt(p.played)}</dd>
            <dt className="text-faint">{t("common.goals")}</dt>
            <dd className="tnum text-right font-mono">{fmt(p.goals)}</dd>
            <dt className="text-faint">{t("common.assists")}</dt>
            <dd className="tnum text-right font-mono">{fmt(p.assists)}</dd>
            <dt className="text-faint">{t("common.redCards")}</dt>
            <dd className="tnum text-right font-mono">{fmt(p.red_cards)}</dd>
            <dt className="text-faint">{t("player.clubsPlayedAt")}</dt>
            <dd className="text-right font-mono">{fmt((p.clubs ?? []).length)}</dd>
          </dl>
        </Card>
      </div>

      <div className="mb-4">
        <Card title={t("player.goalsBySeason")}>
          {seasons.length === 0 ? (
            <Empty title={t("common.noData")} hint={t("player.seasonsHint")} />
          ) : (
            <div className="px-2 py-3">
              <BarChart
                height={200}
                items={seasons.map((s) => ({ label: s.season, value: s.goals }))}
              />
            </div>
          )}
        </Card>
      </div>

      {p.goalkeeper && p.saves_by_type && (
        <div className="mb-4">
          <Card title={t("player.keeperSavesTitle")}>
            <div className="flex flex-wrap gap-2 px-4 py-3">
              {Object.entries(p.saves_by_type).map(([k, v]) => (
                <Badge key={k} tone="info">
                  {SAVE_LABEL[k] ?? k}: {fmt(v)}
                </Badge>
              ))}
            </div>
            <p className="px-4 pb-3 text-xs text-muted">
              {t("player.keeperHint")}
            </p>
          </Card>
        </div>
      )}

      {/* Aparece com mais de um clube OU quando há carreira -- o acumulado
          interessa mesmo para quem só passou por um clube. */}
      {((p.clubs ?? []).length > 1 || (p.clubs ?? []).some((c) => c.career)) && (
        <div className="mb-4">
          <Card title={t("player.clubsPlayedAt")}>
            <ul className="divide-y divide-[var(--border)]">
              {(p.clubs ?? []).map((c) => (
                <li key={c.club_id}>
                  <button
                    type="button"
                    onClick={() => onOpenClub(c.club_id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{c.name}</span>
                      {c.career && (
                        // A carreira é o ACUMULADO no clube, que a temporada
                        // (as partidas acompanhadas) não dá. Rotulada para não
                        // ser lida como o mesmo número da linha acima.
                        <span className="block font-mono text-[10px] text-faint">
                          {t("player.careerAt")}: {fmt(c.career.played)}J {fmt(c.career.goals)}G {fmt(c.career.assists)}A
                        </span>
                      )}
                    </span>
                    <span className="tnum font-mono text-xs text-muted">
                      {fmt(c.played)}J {fmt(c.goals)}G {fmt(c.assists)}A
                    </span>
                    <span className="tnum w-12 text-right font-mono text-sm font-bold" style={{ color: ratingColor(c.rating) }}>
                      {fmt(c.rating, 2)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="px-4 py-3 text-xs text-muted">
              {t("player.clubsHint")}
            </p>
          </Card>
        </div>
      )}

      <Card title={t("player.lastAppearances")}>
        {matches.length === 0 ? (
          <Empty title={t("player.noAppearances")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 text-faint">
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase">{t("common.when")}</th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase">{t("common.match")}</th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase">{t("club.opponents")}</th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase">{t("common.result")}</th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] uppercase">{t("common.rating")}</th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] uppercase">{t("common.goals")}</th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] uppercase">{t("common.assists")}</th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] uppercase">{t("common.min")}</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((x) => (
                  <tr
                    key={x.match_id}
                    className="cursor-pointer border-t border-line transition-colors hover:bg-surface-3"
                    onClick={() => onOpenMatch(x.match_id)}
                  >
                    <td className="px-3 py-2 font-mono text-[11px] text-faint">
                      {new Date(x.timestamp).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-3 py-2">
                      <MatchKindBadge kind={x.kind} />
                    </td>
                    <td className="px-3 py-2">{x.opponent_name}</td>
                    <td className="px-3 py-2">
                      <ResultBadge resultado={x.resultado} />
                    </td>
                    <td className="tnum px-3 py-2 text-right font-mono font-bold" style={{ color: ratingColor(x.rating) }}>
                      {fmt(x.rating, 2)}
                    </td>
                    <td className="tnum px-3 py-2 text-right font-mono">{fmt(x.goals)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono">{fmt(x.assists)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono">{minutes(x.seconds_played)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-4 text-xs text-muted">
        {POS_SHORT[p.position]} · {t("player.publicProfile")}
      </p>
    </>
  );
}
