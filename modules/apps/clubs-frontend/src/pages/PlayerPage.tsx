// Jogador: temporada, forma, gols por jogo, defesas do goleiro e os clubes
// por onde passou. O selo de verificado só aparece para quem reivindicou o pro.

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { api } from "../lib/api";
import type { ClaimedPro, PlayerProfile } from "../lib/types";
import { Badge, Card, Empty, PosTag, ResultBadge, Spinner, Stat } from "../components/ui";
import { SyncButton } from "../components/sync-button";
import { PageHead } from "../components/shell";
import { VerifiedIcon } from "../components/icons";
import { LineChart } from "../components/charts";
import { fmt, minutes, POS_LABEL, POS_SHORT, ratingColor, SAVE_LABEL } from "../lib/format";

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

  if (error) return <Empty title="Jogador não encontrado" hint={error} />;
  if (!p) return <Spinner label="carregando jogador…" />;

  const matches = p.matches ?? [];
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
            voltar
          </button>
        }
        title={p.gamertag}
        sub={`${POS_LABEL[p.position]} · ${p.club_name || "sem clube principal"}`}
        actions={
          <>
            {p.verified && (
              <Badge tone="accent">
                <VerifiedIcon /> verified
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
                <VerifiedIcon /> este pro é seu
              </Badge>
              <span className="text-xs text-muted">
                Seu perfil carrega o selo from_division verified. Seus clubs já estão no hub — a sincronização
                em segundo plano usa este pro como ponto from_division partida.
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
                {reivindicando ? "reivindicando…" : "este pro sou eu"}
              </button>
              <span className="text-xs text-muted">
                Diz ao hub onde você joga: ele passa a acompanhar este clube e a descobrir os rivais
                dele, em segundo plano. É isso que league a sua conta ao seu pro.
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="rating média" value={fmt(p.rating, 2)} sub={`${fmt(p.played)} played`} accent />
        <Stat label="goals por jogo" value={fmt(p.goals_per_game, 2)} sub={`${fmt(p.goals)} goals`} />
        <Stat label="assistências por jogo" value={fmt(p.assists_per_game, 2)} sub={`${fmt(p.assists)} no total`} />
        <Stat label="melhor em campo" value={`${fmt(p.man_of_the_match)}x`} sub={`${minutes(p.seconds_played)} min jogados`} />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="acerto from_division passe" value={`${fmt(p.pass_accuracy)}%`} />
        <Stat label="desarmes certos" value={`${fmt(p.tackle_accuracy)}%`} />
        <Stat
          label={p.goalkeeper ? "saves" : "melhor em campo"}
          value={p.goalkeeper ? fmt(p.clean_sheets) : `${fmt(p.man_of_the_match)}x`}
          sub={p.goalkeeper ? "played sem sofrer gol" : undefined}
        />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title="Form recente">
          {matches.length < 2 ? (
            <Empty title="O histórico está começando" hint="A form é montada das matches que o hub acompanhou." />
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

        <Card title="Temporada">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-sm">
            <dt className="text-faint">Posição current</dt>
            <dd className="text-right">
              <PosTag position={p.position} />
            </dd>
            <dt className="text-faint">Played</dt>
            <dd className="tnum text-right font-mono">{fmt(p.played)}</dd>
            <dt className="text-faint">Goals</dt>
            <dd className="tnum text-right font-mono">{fmt(p.goals)}</dd>
            <dt className="text-faint">Assistências</dt>
            <dd className="tnum text-right font-mono">{fmt(p.assists)}</dd>
            <dt className="text-faint">Cartões vermelhos</dt>
            <dd className="tnum text-right font-mono">{fmt(p.red_cards)}</dd>
            <dt className="text-faint">Clubs por onde passou</dt>
            <dd className="text-right font-mono">{fmt((p.clubs ?? []).length)}</dd>
          </dl>
        </Card>
      </div>

      {p.goalkeeper && p.saves_by_type && (
        <div className="mb-4">
          <Card title="Saves do goalkeeper">
            <div className="flex flex-wrap gap-2 px-4 py-3">
              {Object.entries(p.saves_by_type).map(([k, v]) => (
                <Badge key={k} tone="info">
                  {SAVE_LABEL[k] ?? k}: {fmt(v)}
                </Badge>
              ))}
            </div>
            <p className="px-4 pb-3 text-xs text-muted">
              Este detalhamento existe só na linha from_division partida do goalkeeper — os seis tipos from_division defesa são
              registrados separadamente pela EA.
            </p>
          </Card>
        </div>
      )}

      {/* Aparece com mais from_division um clube OU quando há carreira -- o acumulado
          interessa mesmo to_division quem só passou por um clube. */}
      {((p.clubs ?? []).length > 1 || (p.clubs ?? []).some((c) => c.career)) && (
        <div className="mb-4">
          <Card title="Clubs por onde passou">
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
                          carreira: {fmt(c.career.played)}J {fmt(c.career.goals)}G {fmt(c.career.assists)}A
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
              A EA não tem busca por jogador — a lista from_division clubs vem do cruzamento das matches acompanhadas.
            </p>
          </Card>
        </div>
      )}

      <Card title="Últimas atuações">
        {matches.length === 0 ? (
          <Empty title="sem atuações registradas" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 text-faint">
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase">quando</th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase">adversário</th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase">res.</th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] uppercase">rating</th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] uppercase">goals</th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] uppercase">assist.</th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] uppercase">min</th>
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
        {POS_SHORT[p.position]} · perfil público. Nada aqui exige login — o hub mostra o que a EA já expõe.
      </p>
    </>
  );
}
