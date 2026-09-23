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

type Aba = "visao" | "integracao" | "historico";

export function AdminPage({ authed }: { authed: boolean | null }) {
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

  if (authed === null) return <Spinner label="verificando acesso…" />;
  if (authed === false || negado) {
    return (
      <>
        <PageHead title="Administração" sub="Área restrita à equipe do hub." />
        <div className="mx-auto max-w-lg">
          <Card title="Acesso restrito" actions={<Lock className="size-4 text-faint" />}>
            <p className="px-5 py-5 text-sm text-muted">
              Esta área concentra os detalhes técnicos: integração com a fonte, cache, histórico e decisões de
              arquitetura. Nenhum dado dela aparece para visitantes.
            </p>
          </Card>
        </div>
      </>
    );
  }
  if (!status) return <Spinner label="carregando painel…" />;

  const abas: Array<[Aba, string]> = [
    ["visao", "Visão geral"],
    ["integracao", "Integração"],
    ["historico", "Histórico"],
  ];

  return (
    <>
      <PageHead
        title="Administração"
        sub="Estado da integração com a fonte, do cache e do histórico acumulado."
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
              label="clubes acompanhados"
              value={`${fmt(status.clubes_acompanhados)}/${fmt(status.clubes_total)}`}
              sub={`${fmt(status.clubes_pendentes)} pendentes`}
              accent
            />
            <Stat label="partidas no banco" value={fmt(status.partidas)} sub={status.ultima_partida ? `última ${fmtRefresh(status.ultima_partida)}` : undefined} />
            <Stat label="jogadores distintos" value={fmt(status.jogadores)} sub="no índice cross-club" />
            <Stat label="leituras de nível" value={fmt(status.snapshots)} sub={`${fmt(status.mudancas_divisao)} mudanças de divisão`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Clubes por divisão">
              <div className="px-4 py-4">
                {status.por_divisao && Object.keys(status.por_divisao).length > 0 ? (
                  <BarChart
                    height={200}
                    items={Object.entries(status.por_divisao)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([k, v]) => ({ label: k, value: v }))}
                  />
                ) : (
                  <Empty title="sem divisões registradas ainda" />
                )}
              </div>
            </Card>
            <Card title="Top clubes por nível">
              {status.top_clubes && status.top_clubes.length > 0 ? (
                <ul className="divide-y divide-[var(--border)]">
                  {status.top_clubes.map((c, i) => (
                    <li key={c.club_id} className="flex items-center gap-3 px-4 py-2 text-sm">
                      <span className="w-5 font-mono text-xs text-faint">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate">{c.nome}</span>
                      <span className="tnum font-mono text-xs text-faint">D{c.divisao}</span>
                      <span className="tnum w-16 text-right font-mono font-bold text-accent">{fmt(c.nivel)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title="sem clubes ainda" />
              )}
            </Card>
          </div>
        </>
      )}

      {aba === "integracao" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Pipeline">
            <ol className="flex flex-col gap-3 px-4 py-4 text-sm">
              {[
                ["1", "Puxar", "o worker consulta a API pública de Pro Clubs"],
                ["2", "Traduzir", "string→número, códigos de resultado, tabelas de-para"],
                ["3", "Gravar", "via domain-api — o worker não tem banco próprio"],
                ["4", "Diferenciar", "duas leituras seguidas viram evento de divisão"],
                ["5", "Servir", "o clubs-api lê; a interface nunca fala com a fonte"],
              ].map(([n, t, d]) => (
                <li key={n} className="flex gap-3">
                  <span className="grid size-6 shrink-0 place-items-center rounded bg-[var(--accent-soft)] font-mono text-xs font-bold text-accent">
                    {n}
                  </span>
                  <span>
                    <b className="font-display">{t}</b> — <span className="text-muted">{d}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>

          <Card title="Normalização (o que a fonte manda torto)">
            <ul className="divide-y divide-[var(--border)] text-sm">
              {[
                ["Números como texto", '"25", "7.4" → número'],
                ["Códigos de resultado", "1 vitória · 2 derrota · 4 empate · 16385 vitória por DNF · 10 derrota por DNF"],
                ["Amistoso sem resultado", "derivado de gols pró vs sofridos"],
                ["Ids sem tabela", "posição, estilo, nacionalidade, escudo, ids de evento"],
                ["Mesma partida nos dois clubes", "gravada uma vez, idempotente por match_id"],
              ].map(([t, d]) => (
                <li key={t} className="flex flex-col gap-0.5 px-4 py-2.5">
                  <b className="text-sm">{t}</b>
                  <span className="text-xs text-muted">{d}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Anúncios gerados">
            <div className="flex items-center gap-4 px-4 py-4">
              <span className="font-display tnum text-4xl font-bold text-accent">{fmt(status.anuncios)}</span>
              <p className="text-xs text-muted">
                Derivados automaticamente dos fatos que o worker acabou de gravar — nenhum é escrito à mão.
              </p>
            </div>
          </Card>

          <Card title="Cobertura de partidas">
            <DonutChart
              size={140}
              centerLabel="partidas"
              data={[
                { label: "acompanhadas", value: status.partidas, color: "var(--accent)" },
              ]}
            />
            <p className="px-4 pb-4 text-xs text-muted">
              A fonte entrega ~10 partidas por tipo por consulta. Qualquer histórico além disso é acumulado pelo
              hub — é por isso que os recordes e a evolução existem.
            </p>
          </Card>
        </div>
      )}

      {aba === "historico" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Por que o histórico é construído">
            <p className="px-4 py-4 text-sm text-muted">
              A API da EA devolve apenas o estado atual: o nível de agora, a divisão de agora, as ~10 partidas
              mais recentes. Ela não guarda passado. Então cada leitura que o worker faz vira uma linha numa
              série — e é essa série que permite mostrar evolução, mudanças de divisão e recordes que já saíram
              da janela recente.
            </p>
          </Card>
          <Card title="Números do acervo">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-4 py-4 text-sm">
              <Row k="Leituras de nível" v={fmt(status.snapshots)} />
              <Row k="Mudanças de divisão" v={fmt(status.mudancas_divisao)} />
              <Row k="Partidas acumuladas" v={fmt(status.partidas)} />
              <Row k="Jogadores distintos" v={fmt(status.jogadores)} />
              <Row
                k="Última partida"
                v={status.ultima_partida ? fmtDateTime(status.ultima_partida) : "nenhuma ainda"}
              />
            </dl>
          </Card>
          <Card title="Clubes acompanhados">
            <div className="px-4 py-4">
              <Bar value={status.clubes_acompanhados} max={Math.max(status.clubes_total, 1)} />
              <p className="mt-2 text-xs text-muted">
                {fmt(status.clubes_acompanhados)} de {fmt(status.clubes_total)} clubes conhecidos têm elenco e
                partidas; os outros {fmt(status.clubes_pendentes)} têm só o histórico geral.
              </p>
            </div>
          </Card>
          <Card title="Decisões que valem para este hub">
            <ul className="divide-y divide-[var(--border)] text-sm">
              {[
                ["Sem banco nos serviços novos", "tudo passa pela base de domínio compartilhada"],
                ["Worker sem porta e sem host", "é um serviço de saída, não uma API"],
                ["Login só no /api", "o hostname é público; o dataset inteiro é aberto"],
                ["Nada de termo técnico na tela", "cache, endpoint e afins só existem aqui"],
              ].map(([t, d]) => (
                <li key={t} className="flex flex-col gap-0.5 px-4 py-2.5">
                  <b className="text-sm">{t}</b>
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
