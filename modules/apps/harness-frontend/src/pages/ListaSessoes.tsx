// Lista de sessões do time (US-1/US-3): cards com título, repo, resumo
// do objetivo, status, autor e dono atual — ativas em destaque no topo
// (ordenação vem da API: em_andamento primeiro, depois atualizado_em
// desc). Filtros por status (multi) e dono vão como query da API
// (contracts/api.md); a lista sem filtro também popula o select de
// donos (o "cache de usuarios" exposto pelos itens da lista).
import { useEffect, useState } from "react";
import { listSessoes, type SessaoLista, type StatusSessao } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { dataAbsoluta, tempoRelativo } from "@/lib/tempo";

const STATUS: { valor: StatusSessao; rotulo: string }[] = [
  { valor: "em_andamento", rotulo: "em andamento" },
  { valor: "entregue", rotulo: "entregue" },
  { valor: "arquivada", rotulo: "arquivada" },
];

export function ListaSessoes() {
  const [sessoes, setSessoes] = useState<SessaoLista[] | null>(null);
  const [donos, setDonos] = useState<{ email: string; nome: string }[]>([]);
  const [statusFiltro, setStatusFiltro] = useState<StatusSessao[]>([]);
  const [donoFiltro, setDonoFiltro] = useState("");
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    document.title = "Sessões — harness";
  }, []);

  useEffect(() => {
    let ativo = true;
    setSessoes(null);
    const semFiltro = statusFiltro.length === 0 && !donoFiltro;
    listSessoes({
      status: statusFiltro.length ? statusFiltro : undefined,
      dono: donoFiltro || undefined,
    })
      .then((corpo) => {
        if (!ativo) return;
        setSessoes(corpo.sessoes);
        setErro(false);
        // A resposta sem filtro é a lista completa: dela saem as opções
        // do select de donos, estáveis enquanto os filtros mudam.
        if (semFiltro) setDonos(donosDistintos(corpo.sessoes));
      })
      .catch(() => {
        if (ativo) setErro(true);
      });
    return () => {
      ativo = false;
    };
  }, [statusFiltro, donoFiltro, tentativa]);

  const filtrando = statusFiltro.length > 0 || donoFiltro !== "";

  return (
    <div>
      <h1 className="text-lg font-semibold">Sessões</h1>

      {/* Filtros: chips de status (multi) + select de dono — wrap no mobile. */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {STATUS.map(({ valor, rotulo }) => {
          const ativo = statusFiltro.includes(valor);
          return (
            <button
              key={valor}
              type="button"
              aria-pressed={ativo}
              onClick={() =>
                setStatusFiltro((atual) =>
                  atual.includes(valor)
                    ? atual.filter((s) => s !== valor)
                    : [...atual, valor],
                )
              }
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                ativo
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {rotulo}
            </button>
          );
        })}
        {/* max-w-full: a opção mais longa ("nome · email") define a largura
            do select — sem isso ela empurra a barra de filtros além da tela
            em mobile (FR-014). */}
        <select
          aria-label="Filtrar por dono atual"
          value={donoFiltro}
          onChange={(e) => setDonoFiltro(e.target.value)}
          className="w-auto min-w-40 max-w-full rounded-md border border-input bg-card px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">todos os donos</option>
          {donos.map((dono) => (
            <option key={dono.email} value={dono.email}>
              {dono.nome} · {dono.email}
            </option>
          ))}
        </select>
      </div>

      {erro && (
        <div className="card mt-4 p-5 text-center">
          <p className="text-sm text-destructive">Não foi possível carregar as sessões.</p>
          <button
            type="button"
            className="btn btn-secundario mt-4"
            onClick={() => setTentativa((t) => t + 1)}
          >
            Tentar de novo
          </button>
        </div>
      )}

      {!erro && sessoes === null && (
        <p className="mt-4 text-sm text-muted-foreground">Carregando…</p>
      )}

      {!erro && sessoes !== null && sessoes.length === 0 && (
        <div className="card mt-4 p-6 text-center sm:p-8">
          {filtrando ? (
            <>
              <p className="text-sm text-muted-foreground">
                Nenhuma sessão com esses filtros.
              </p>
              <button
                type="button"
                className="btn btn-secundario mt-4"
                onClick={() => {
                  setStatusFiltro([]);
                  setDonoFiltro("");
                }}
              >
                Limpar filtros
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Nenhuma sessão ainda — comece a primeira e o time acompanha por aqui.
              </p>
              <a href="/sessoes/nova" className="btn btn-primario mt-4">
                Iniciar primeira sessão
              </a>
            </>
          )}
        </div>
      )}

      {!erro && sessoes !== null && sessoes.length > 0 && (
        <ul className="mt-4 space-y-3">
          {sessoes.map((sessao) => (
            <CardSessao key={sessao.id} sessao={sessao} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CardSessao({ sessao }: { sessao: SessaoLista }) {
  return (
    <li>
      <a
        href={`/sessoes/${sessao.id}`}
        className={`card block p-4 transition-colors hover:bg-accent sm:p-5 ${
          sessao.status === "em_andamento"
            ? "border-l-4 border-l-primary" // ativa em destaque (FR-009)
            : "border-l-4 border-l-transparent opacity-90"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="break-words font-medium leading-snug">{sessao.titulo}</h2>
          <StatusBadge status={sessao.status} />
        </div>
        {sessao.repo && (
          <p className="mt-1 font-mono text-xs text-muted-foreground">{sessao.repo}</p>
        )}
        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
          {sessao.resumo_objetivo}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          com a baton: <span className="font-medium text-foreground">{sessao.dono_atual.nome}</span>
          {" · "}criada por {sessao.criador.nome}
          {" · "}
          <time title={dataAbsoluta(sessao.atualizado_em)}>
            atualizada {tempoRelativo(sessao.atualizado_em)}
          </time>
        </p>
      </a>
    </li>
  );
}

function donosDistintos(sessoes: SessaoLista[]) {
  const porEmail = new Map<string, { email: string; nome: string }>();
  for (const sessao of sessoes) porEmail.set(sessao.dono_atual.email, sessao.dono_atual);
  return [...porEmail.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}