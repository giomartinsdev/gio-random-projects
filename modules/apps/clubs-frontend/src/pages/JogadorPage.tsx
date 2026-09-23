// Jogador: temporada, forma, gols por jogo, defesas do goleiro e os clubes
// por onde passou. O selo de verificado só aparece para quem reivindicou o pro.

import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { api } from "../lib/api";
import type { ClaimedPro, PlayerProfile } from "../lib/types";
import { Badge, Card, Empty, PosTag, ResultBadge, Spinner, Stat } from "../components/ui";
import { PageHead } from "../components/shell";
import { VerifiedIcon } from "../components/icons";
import { LineChart } from "../components/charts";
import { fmt, minutes, POS_LABEL, POS_SHORT, ratingColor, SAVE_LABEL } from "../lib/format";

export function JogadorPage({
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
  const [erro, setErro] = useState("");
  const [reivindicando, setReivindicando] = useState(false);

  useEffect(() => {
    setP(null);
    api.player(playerId).then(setP).catch((e) => setErro(String(e)));
  }, [playerId]);

  if (erro) return <Empty title="Jogador não encontrado" hint={erro} />;
  if (!p) return <Spinner label="carregando jogador…" />;

  const partidas = p.partidas ?? [];
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
        sub={`${POS_LABEL[p.posicao]} · ${p.clube_nome || "sem clube principal"}`}
        actions={
          <>
            {p.verificado && (
              <Badge tone="accent">
                <VerifiedIcon /> verificado
              </Badge>
            )}
            <span className="font-display tnum text-3xl font-bold" style={{ color: ratingColor(p.nota) }}>
              {fmt(p.nota, 2)}
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
                Seu perfil carrega o selo de verificado. Seus clubes já estão no hub — a sincronização
                em segundo plano usa este pro como ponto de partida.
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
                dele, em segundo plano. É isso que liga a sua conta ao seu pro.
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="nota média" value={fmt(p.nota, 2)} sub={`${fmt(p.jogos)} jogos`} accent />
        <Stat label="gols por jogo" value={fmt(p.gols_por_jogo, 2)} sub={`${fmt(p.gols)} gols`} />
        <Stat label="assistências por jogo" value={fmt(p.assistencias_por_jogo, 2)} sub={`${fmt(p.assistencias)} no total`} />
        <Stat label="melhor em campo" value={`${fmt(p.melhor_em_campo)}x`} sub={`${minutes(p.segundos_jogados)} min jogados`} />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="acerto de passe" value={`${fmt(p.passes_precisao)}%`} />
        <Stat label="desarmes certos" value={`${fmt(p.desarmes_precisao)}%`} />
        <Stat
          label={p.goleiro ? "defesas" : "melhor em campo"}
          value={p.goleiro ? fmt(p.clean_sheets) : `${fmt(p.melhor_em_campo)}x`}
          sub={p.goleiro ? "jogos sem sofrer gol" : undefined}
        />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card title="Forma recente">
          {partidas.length < 2 ? (
            <Empty title="O histórico está começando" hint="A forma é montada das partidas que o hub acompanhou." />
          ) : (
            <div className="px-2 py-3">
              <LineChart
                values={[...partidas].reverse().map((x) => x.nota)}
                labels={[...partidas].reverse().map((x) => x.adversario_nome.slice(0, 8))}
                height={210}
                yFormat={(v) => fmt(v, 1)}
                refLine={{ y: 7.5, label: "nota 7,5" }}
              />
            </div>
          )}
        </Card>

        <Card title="Temporada">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-4 py-3 text-sm">
            <dt className="text-faint">Posição atual</dt>
            <dd className="text-right">
              <PosTag posicao={p.posicao} />
            </dd>
            <dt className="text-faint">Jogos</dt>
            <dd className="tnum text-right font-mono">{fmt(p.jogos)}</dd>
            <dt className="text-faint">Gols</dt>
            <dd className="tnum text-right font-mono">{fmt(p.gols)}</dd>
            <dt className="text-faint">Assistências</dt>
            <dd className="tnum text-right font-mono">{fmt(p.assistencias)}</dd>
            <dt className="text-faint">Cartões vermelhos</dt>
            <dd className="tnum text-right font-mono">{fmt(p.cartoes_vermelhos)}</dd>
            <dt className="text-faint">Clubes por onde passou</dt>
            <dd className="text-right font-mono">{fmt((p.clubes ?? []).length)}</dd>
          </dl>
        </Card>
      </div>

      {p.goleiro && p.defesas_por_tipo && (
        <div className="mb-4">
          <Card title="Defesas do goleiro">
            <div className="flex flex-wrap gap-2 px-4 py-3">
              {Object.entries(p.defesas_por_tipo).map(([k, v]) => (
                <Badge key={k} tone="info">
                  {SAVE_LABEL[k] ?? k}: {fmt(v)}
                </Badge>
              ))}
            </div>
            <p className="px-4 pb-3 text-xs text-muted">
              Este detalhamento existe só na linha de partida do goleiro — os seis tipos de defesa são
              registrados separadamente pela EA.
            </p>
          </Card>
        </div>
      )}

      {(p.clubes ?? []).length > 1 && (
        <div className="mb-4">
          <Card title="Clubes por onde passou">
            <ul className="divide-y divide-[var(--border)]">
              {(p.clubes ?? []).map((c) => (
                <li key={c.club_id}>
                  <button
                    type="button"
                    onClick={() => onOpenClub(c.club_id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-3"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.nome}</span>
                    <span className="tnum font-mono text-xs text-muted">
                      {fmt(c.jogos)}J {fmt(c.gols)}G {fmt(c.assistencias)}A
                    </span>
                    <span className="tnum w-12 text-right font-mono text-sm font-bold" style={{ color: ratingColor(c.nota) }}>
                      {fmt(c.nota, 2)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="px-4 py-3 text-xs text-muted">
              A EA não tem busca por jogador — a lista de clubes vem do cruzamento das partidas acompanhadas.
            </p>
          </Card>
        </div>
      )}

      <Card title="Últimas atuações">
        {partidas.length === 0 ? (
          <Empty title="sem atuações registradas" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 text-faint">
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase">quando</th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase">adversário</th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase">res.</th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] uppercase">nota</th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] uppercase">gols</th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] uppercase">assist.</th>
                  <th className="px-3 py-2 text-right font-mono text-[10px] uppercase">min</th>
                </tr>
              </thead>
              <tbody>
                {partidas.map((x) => (
                  <tr
                    key={x.match_id}
                    className="cursor-pointer border-t border-line transition-colors hover:bg-surface-3"
                    onClick={() => onOpenMatch(x.match_id)}
                  >
                    <td className="px-3 py-2 font-mono text-[11px] text-faint">
                      {new Date(x.timestamp).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-3 py-2">{x.adversario_nome}</td>
                    <td className="px-3 py-2">
                      <ResultBadge resultado={x.resultado} />
                    </td>
                    <td className="tnum px-3 py-2 text-right font-mono font-bold" style={{ color: ratingColor(x.nota) }}>
                      {fmt(x.nota, 2)}
                    </td>
                    <td className="tnum px-3 py-2 text-right font-mono">{fmt(x.gols)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono">{fmt(x.assistencias)}</td>
                    <td className="tnum px-3 py-2 text-right font-mono">{minutes(x.segundos_jogados)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-4 text-xs text-muted">
        {POS_SHORT[p.posicao]} · perfil público. Nada aqui exige login — o hub mostra o que a EA já expõe.
      </p>
    </>
  );
}
