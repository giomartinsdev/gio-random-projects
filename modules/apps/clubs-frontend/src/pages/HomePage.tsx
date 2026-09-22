// Home: anúncios + rankings globais. É a porta de entrada e funciona sem login.

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Announcement, Club, RankPlayer } from "../lib/types";
import { Badge, Bar, Card, Crest, Empty, RankMedallion, Spinner, Stat } from "../components/ui";
import { PageHead } from "../components/shell";
import { BarChart } from "../components/charts";
import { fmt, POS_SHORT, timeAgo } from "../lib/format";

type RankTab = "clubes" | "jogadores";

export function HomePage({ onOpenClub, onOpenPlayer }: { onOpenClub: (id: string) => void; onOpenPlayer: (id: string) => void }) {
  const [anuncios, setAnuncios] = useState<Announcement[] | null>(null);
  const [tab, setTab] = useState<RankTab>("clubes");
  const [metrica, setMetrica] = useState("nivel");
  const [clubes, setClubes] = useState<Club[] | null>(null);
  const [jogadores, setJogadores] = useState<RankPlayer[] | null>(null);
  // O número do cabeçalho é o índice inteiro, não a página do ranking: o
  // ranking carrega só ao abrir a aba, então usá-lo aqui mostrava 0 na home.
  const [totalJogadores, setTotalJogadores] = useState<number | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    api.announcements().then((r) => setAnuncios(r.anuncios ?? [])).catch(() => setAnuncios([]));
  }, []);

  useEffect(() => {
    api.playerCount().then(setTotalJogadores).catch(() => setTotalJogadores(0));
  }, []);

  useEffect(() => {
    setErro("");
    if (tab === "clubes") {
      api
        .rankingClubs(metrica)
        .then((r) => setClubes(r.clubes ?? []))
        .catch((e) => setErro(String(e)));
    } else {
      api
        .rankingPlayers(metrica === "nivel" ? "nota" : metrica)
        .then((r) => setJogadores(r.jogadores ?? []))
        .catch((e) => setErro(String(e)));
    }
  }, [tab, metrica]);

  const metricas = tab === "clubes"
    ? [
        { id: "nivel", label: "Nível" },
        { id: "pontos", label: "Pontos" },
        { id: "gols", label: "Gols" },
        { id: "jogos_sem_sofrer", label: "Sem sofrer gol" },
      ]
    : [
        { id: "nota", label: "Nota" },
        { id: "gols", label: "Gols" },
        { id: "assistencias", label: "Assistências" },
        { id: "gols_por_jogo", label: "Gols/jogo" },
      ];

  const maxClube = Math.max(...(clubes ?? []).map((c) => c.nivel), 1);
  const maxJogador = Math.max(...(jogadores ?? []).map((p) => p.nota), 1);

  return (
    <>
      <PageHead
        title="Arena"
        sub="Rankings, partidas e o histórico que a EA não guarda. Tudo aberto — entre só se quiser acompanhar seus clubes."
        actions={<Badge tone="accent">pro clubs · ea fc 27</Badge>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="clubes no hub" value={fmt(clubes?.length ?? 0)} sub="com dados acumulados" accent />
        <Stat label="jogadores indexados" value={fmt(totalJogadores ?? 0)} sub="descobertos pelas partidas" />
        <Stat label="anúncios" value={fmt(anuncios?.length ?? 0)} sub="gerados dos resultados" />
        <Stat label="histórico" value="contínuo" sub="cresce a cada atualização" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card title="Feed da arena">
          {anuncios === null ? (
            <Spinner />
          ) : anuncios.length === 0 ? (
            <Empty
              title="Nenhum anúncio ainda"
              hint="O feed é gerado dos resultados que o hub acompanha. Assim que houver partidas, elas aparecem aqui."
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {anuncios.map((a) => (
                <li key={a.id} className="flex gap-3 px-4 py-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[var(--accent-soft)] text-base">
                    {a.icone || "📣"}
                  </span>
                  <div className="min-w-0">
                    <div className="label" style={{ color: "var(--accent)" }}>
                      {a.tipo}
                    </div>
                    <div className="text-sm font-semibold">{a.titulo}</div>
                    {a.texto && <div className="mt-0.5 text-xs text-muted">{a.texto}</div>}
                    <div className="mt-1 font-mono text-[10px] text-faint">{timeAgo(a.gerado_em)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Nível por clube">
          <div className="px-2 py-3">
            {clubes && clubes.length > 0 ? (
              <BarChart
                height={210}
                items={clubes.slice(0, 7).map((c) => ({ label: c.sigla || c.nome.slice(0, 3), value: c.nivel }))}
              />
            ) : (
              <Empty title="sem dados ainda" hint="Assim que o hub acumular clubes, o gráfico aparece." />
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <Card
          title="Ranking global"
          actions={
            <>
              <div className="flex rounded-md border border-line bg-surface-2 p-[3px]">
                {(["clubes", "jogadores"] as RankTab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setTab(t);
                      setMetrica(t === "clubes" ? "nivel" : "nota");
                    }}
                    aria-pressed={tab === t}
                    className="rounded-sm px-3 py-1 text-xs font-semibold capitalize transition-colors"
                    style={
                      tab === t
                        ? { background: "var(--surface)", color: "var(--text)" }
                        : { color: "var(--text-muted)" }
                    }
                  >
                    {t}
                  </button>
                ))}
              </div>
            </>
          }
        >
          <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3">
            {metricas.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMetrica(m.id)}
                aria-pressed={metrica === m.id}
                className="rounded-full border px-3 py-1 text-xs font-semibold transition-colors"
                style={
                  metrica === m.id
                    ? { borderColor: "var(--accent)", background: "var(--accent-soft)", color: "var(--accent)" }
                    : { borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text-muted)" }
                }
              >
                {m.label}
              </button>
            ))}
          </div>

          {erro ? (
            <Empty title="Não foi possível carregar o ranking" hint={erro} />
          ) : tab === "clubes" ? (
            clubes === null ? (
              <Spinner />
            ) : clubes.length === 0 ? (
              <Empty title="Nenhum clube no ranking ainda" hint="O hub começa vazio e cresce conforme acompanha clubes." />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {clubes.slice(0, 20).map((c, i) => (
                  <li key={c.club_id}>
                    <button
                      type="button"
                      onClick={() => onOpenClub(c.club_id)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-3"
                    >
                      <RankMedallion pos={i + 1} />
                      <Crest club={c} size={26} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{c.nome}</span>
                        <span className="block font-mono text-[10px] text-faint">
                          D{c.divisao_atual} · {fmt(c.jogos)} jogos
                        </span>
                      </span>
                      <span className="hidden w-32 sm:block">
                        <Bar value={c.nivel} max={maxClube} />
                      </span>
                      <span className="tnum w-16 text-right font-mono text-sm font-bold text-accent">
                        {fmt(metrica === "pontos" ? c.pontos : metrica === "gols" ? c.gols : metrica === "jogos_sem_sofrer" ? c.jogos_sem_sofrer : c.nivel)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : jogadores === null ? (
            <Spinner />
          ) : jogadores.length === 0 ? (
            <Empty title="Nenhum jogador no ranking ainda" hint="Os jogadores aparecem a partir das partidas acompanhadas." />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {jogadores.slice(0, 20).map((p, i) => (
                <li key={p.player_id}>
                  <button
                    type="button"
                    onClick={() => onOpenPlayer(p.player_id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-3"
                  >
                    <RankMedallion pos={i + 1} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {p.gamertag} {p.verificado && <span title="verificado">✓</span>}
                      </span>
                      <span className="block font-mono text-[10px] text-faint">
                        {POS_SHORT[p.posicao]} · {p.club_sigla || p.clube_nome}
                      </span>
                    </span>
                    <span className="hidden w-28 sm:block">
                      <Bar value={p.nota} max={maxJogador} color="var(--info)" />
                    </span>
                    <span className="tnum w-16 text-right font-mono text-sm font-bold text-accent">
                      {fmt(metrica === "gols" ? p.gols : metrica === "assistencias" ? p.assistencias : metrica === "gols_por_jogo" ? p.gols_por_jogo : p.nota, metrica === "nota" ? 2 : 1)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
