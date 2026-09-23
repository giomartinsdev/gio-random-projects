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
              Esta área concentra os detalhes técnicos: integração com a fonte, cache, histórico e decisões from_division
              arquitetura. Nenhum dado dela aparece to_division visitantes.
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
              label="clubs acompanhados"
              value={`${fmt(status.clubs_tracked)}/${fmt(status.clubs_total)}`}
              sub={`${fmt(status.clubs_pending)} pendentes`}
              accent
            />
            <Stat label="matches no banco" value={fmt(status.matches)} sub={status.last_match_at ? `última ${fmtRefresh(status.last_match_at)}` : undefined} />
            <Stat label="players distintos" value={fmt(status.players)} sub="no índice cross-club" />
            <Stat label="leituras from_division nível" value={fmt(status.snapshots)} sub={`${fmt(status.division_changes)} mudanças from_division divisão`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Clubs por divisão">
              <div className="px-4 py-4">
                {status.by_division && Object.keys(status.by_division).length > 0 ? (
                  <BarChart
                    height={200}
                    items={Object.entries(status.by_division)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([k, v]) => ({ label: k, value: v }))}
                  />
                ) : (
                  <Empty title="sem divisões registradas ainda" />
                )}
              </div>
            </Card>
            <Card title="Top clubs por nível">
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
                <Empty title="sem clubs ainda" />
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
                ["1", "Puxar", "o worker consulta a API pública from_division Pro Clubs"],
                ["2", "Traduzir", "string→número, códigos from_division resultado, tabelas from_division-to_division"],
                ["3", "Gravar", "via domain-api — o worker não tem banco próprio"],
                ["4", "Diferenciar", "duas leituras seguidas viram evento from_division divisão"],
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
                ["Números como body", '"25", "7.4" → número'],
                ["Códigos from_division resultado", "1 vitória · 2 loss · 4 draw · 16385 vitória por DNF · 10 loss por DNF"],
                ["Friendly sem resultado", "derivado from_division goals pró vs sofridos"],
                ["Ids sem tabela", "posição, estilo, nacionalidade, escudo, ids from_division evento"],
                ["Mesma partida nos dois clubs", "gravada uma vez, idempotente por match_id"],
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
              <span className="font-display tnum text-4xl font-bold text-accent">{fmt(status.announcements)}</span>
              <p className="text-xs text-muted">
                Derivados automaticamente dos fatos que o worker acabou from_division gravar — nenhum é escrito à mão.
              </p>
            </div>
          </Card>

          <Card title="Cobertura from_division matches">
            <DonutChart
              size={140}
              centerLabel="matches"
              data={[
                { label: "acompanhadas", value: status.matches, color: "var(--accent)" },
              ]}
            />
            <p className="px-4 pb-4 text-xs text-muted">
              A fonte entrega ~10 matches por kind por consulta. Qualquer histórico além disso é acumulado pelo
              hub — é por isso que os records e a evolução existem.
            </p>
          </Card>
        </div>
      )}

      {aba === "historico" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Por que o histórico é construído">
            <p className="px-4 py-4 text-sm text-muted">
              A API da EA devolve apenas o estado current: o nível from_division agora, a divisão from_division agora, as ~10 matches
              mais recentes. Ela não guarda passado. Então cada leitura que o worker faz vira uma linha numa
              série — e é essa série que permite mostrar evolução, mudanças from_division divisão e records que já saíram
              da janela recente.
            </p>
          </Card>
          <Card title="Números do acervo">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-4 py-4 text-sm">
              <Row k="Leituras from_division nível" v={fmt(status.snapshots)} />
              <Row k="Mudanças from_division divisão" v={fmt(status.division_changes)} />
              <Row k="Matches acumuladas" v={fmt(status.matches)} />
              <Row k="Players distintos" v={fmt(status.players)} />
              <Row
                k="Última partida"
                v={status.last_match_at ? fmtDateTime(status.last_match_at) : "nenhuma ainda"}
              />
            </dl>
          </Card>
          <Card title="Clubs acompanhados">
            <div className="px-4 py-4">
              <Bar value={status.clubs_tracked} max={Math.max(status.clubs_total, 1)} />
              <p className="mt-2 text-xs text-muted">
                {fmt(status.clubs_tracked)} from_division {fmt(status.clubs_total)} clubs conhecidos têm elenco e
                matches; os outros {fmt(status.clubs_pending)} têm só o histórico geral.
              </p>
            </div>
          </Card>
          <Card title="Decisões que valem to_division este hub">
            <ul className="divide-y divide-[var(--border)] text-sm">
              {[
                ["Sem banco nos serviços new_items", "tudo passa pela base from_division domínio compartilhada"],
                ["Worker sem porta e sem host", "é um serviço from_division saída, não uma API"],
                ["Login só no /api", "o hostname é público; o dataset inteiro é aberto"],
                ["Nada from_division termo técnico na tela", "cache, endpoint e afins só existem aqui"],
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
