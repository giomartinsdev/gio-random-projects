// Página da sessão (US-1 leitura, US-2 retomada/edição, US-4 extensão,
// US-5 ciclo de status). O dono atual fica em destaque em toda a página
// (FR-012) — é a baton. Markdown via MarkdownView (FR-011). Edição usa
// concorrência otimista: 409 abre o diálogo "conteúdo mudou desde a
// abertura — sobrescrever?" que refaz o PATCH com force:true após
// mostrar o conteúdo vigente (o ApiError do 409 carrega .sessao).
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ApiError,
  getSessao,
  listEventos,
  mudarStatusSessao,
  patchSessao,
  retomarSessao,
  type Evento,
  type Sessao,
  type SessaoDetalhe,
  type Usuario,
} from "@/lib/api";
import { MarkdownView } from "@/components/MarkdownView";
import { StatusBadge } from "@/components/StatusBadge";
import { Timeline } from "@/components/Timeline";
import { limparRascunho, lerRascunho, salvarRascunho } from "@/lib/rascunho";
import { dataAbsoluta, tempoRelativo } from "@/lib/tempo";

type RascunhoEdicao = { contexto_md: string; proximos_passos_md: string };

const RASCUNHO_EDICAO_VAZIO: RascunhoEdicao = { contexto_md: "", proximos_passos_md: "" };

type Fase =
  | { nome: "carregando" }
  | { nome: "naoEncontrado" }
  | { nome: "erro" }
  | { nome: "pronta" };

export function PaginaSessao({ id, eu }: { id: number; eu: Usuario }) {
  const [fase, setFase] = useState<Fase>({ nome: "carregando" });
  const [sessao, setSessao] = useState<SessaoDetalhe | null>(null);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [tentativa, setTentativa] = useState(0);
  const [erroAcao, setErroAcao] = useState<string | null>(null);
  const [acaoPendente, setAcaoPendente] = useState(false);

  // ── Edição (US-2) ───────────────────────────────────────────────────
  const [editando, setEditando] = useState(false);
  const [rascunhoEdicao, setRascunhoEdicao] = useState<RascunhoEdicao>(RASCUNHO_EDICAO_VAZIO);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);
  const [conflito, setConflito] = useState<Sessao | null>(null);
  // O atualizado_em visto ao abrir a edição — base do PATCH otimista.
  const baseAtualizadoEm = useRef<number | null>(null);

  // ── Dialogs (entrega com PR link; conflito) ─────────────────────────
  const refDialogEntrega = useRef<HTMLDialogElement>(null);
  const refDialogConflito = useRef<HTMLDialogElement>(null);
  const [prLink, setPrLink] = useState("");

  const chaveRascunho = `harness:rascunho:edicao-${id}`;

  useEffect(() => {
    let ativo = true;
    setFase({ nome: "carregando" });
    Promise.all([getSessao(id), listEventos(id)])
      .then(([detalhe, corpo]) => {
        if (!ativo) return;
        setSessao(detalhe);
        setEventos(corpo.eventos);
        setFase({ nome: "pronta" });
      })
      .catch((err) => {
        if (!ativo) return;
        setFase({ nome: err instanceof ApiError && err.status === 404 ? "naoEncontrado" : "erro" });
      });
    return () => {
      ativo = false;
    };
  }, [id, tentativa]);

  useEffect(() => {
    document.title =
      fase.nome === "naoEncontrado"
        ? "Sessão não encontrada — harness"
        : sessao
          ? `${sessao.titulo} — harness`
          : "Sessão — harness";
  }, [fase.nome, sessao?.titulo]);

  async function recarregarEventos(): Promise<void> {
    try {
      const corpo = await listEventos(id);
      setEventos(corpo.eventos);
    } catch {
      // Timeline fica como está; o próximo carregamento a traz de novo.
    }
  }

  // ── Retomada ────────────────────────────────────────────────────────
  async function retomar(): Promise<void> {
    setAcaoPendente(true);
    setErroAcao(null);
    try {
      const resposta = await retomarSessao(id);
      setSessao((atual) => (atual ? { ...atual, ...resposta } : resposta));
      await recarregarEventos();
    } catch {
      setErroAcao("Não foi possível retomar a sessão.");
    } finally {
      setAcaoPendente(false);
    }
  }

  // ── Edição de contexto/próximos passos ──────────────────────────────
  function abrirEdicao(): void {
    if (!sessao) return;
    setErroAcao(null);
    // Rascunho salvo durante a edição sobrevive a reload; sem rascunho,
    // parte do conteúdo vigente.
    const salvo = lerRascunho<RascunhoEdicao>(chaveRascunho);
    setRascunhoEdicao(
      salvo ?? {
        contexto_md: sessao.contexto_md ?? "",
        proximos_passos_md: sessao.proximos_passos_md ?? "",
      },
    );
    baseAtualizadoEm.current = sessao.atualizado_em;
    setEditando(true);
  }

  function cancelarEdicao(): void {
    limparRascunho(chaveRascunho);
    setEditando(false);
    setRascunhoEdicao(RASCUNHO_EDICAO_VAZIO);
  }

  function editarCampo(campo: keyof RascunhoEdicao, valor: string): void {
    setRascunhoEdicao((atual) => ({ ...atual, [campo]: valor }));
  }

  // Rascunho da edição persiste a cada mudança — sobrevive a reload.
  useEffect(() => {
    if (editando) salvarRascunho(chaveRascunho, rascunhoEdicao);
  }, [editando, chaveRascunho, rascunhoEdicao]);

  async function salvarEdicao(force: boolean, baseConflito?: number): Promise<void> {
    if (!sessao) return;
    setSalvandoEdicao(true);
    setErroAcao(null);
    try {
      const resposta = await patchSessao(id, {
        contexto_md: rascunhoEdicao.contexto_md,
        proximos_passos_md: rascunhoEdicao.proximos_passos_md,
        base_atualizado_em: baseConflito ?? baseAtualizadoEm.current ?? undefined,
        force,
      });
      setSessao((atual) => (atual ? { ...atual, ...resposta } : resposta));
      baseAtualizadoEm.current = resposta.atualizado_em;
      cancelarEdicao();
      await recarregarEventos();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Estado vigente vem no corpo (contrato); se faltar, sigo com a
        // sessão que eu já tinha — o force decide a última escrita.
        setConflito(err.sessao ?? sessao);
        refDialogConflito.current?.showModal();
      } else if (err instanceof ApiError && err.codigo === "validacao") {
        setErroAcao(
          (err.detalhes ?? []).map((d) => `${d.campo}: ${d.problema}`).join(" · ") ||
            err.message ||
            "Conteúdo recusado pela API.",
        );
      } else {
        setErroAcao("Não foi possível salvar — seu rascunho continua aqui.");
      }
    } finally {
      setSalvandoEdicao(false);
    }
  }

  // ── Ciclo de status (US-5) ──────────────────────────────────────────
  async function mudarStatus(acao: "entregar" | "arquivar" | "reabrir", pr_link?: string): Promise<void> {
    setAcaoPendente(true);
    setErroAcao(null);
    try {
      const resposta = await mudarStatusSessao(id, acao, pr_link);
      setSessao((atual) => (atual ? { ...atual, ...resposta } : resposta));
      await recarregarEventos();
      setPrLink("");
      refDialogEntrega.current?.close();
    } catch (err) {
      if (err instanceof ApiError && err.codigo === "transicao_invalida") {
        setErroAcao("Essa mudança de status não é permitida — recarregue a página.");
      } else {
        setErroAcao(`Não foi possível ${acao === "entregar" ? "entregar" : "mudar o status"}.`);
      }
    } finally {
      setAcaoPendente(false);
    }
  }

  function submeterEntrega(event: FormEvent): void {
    event.preventDefault();
    // Fecha na submissão: o erro (se houver) aparece no banner de ações,
    // não atrás do backdrop.
    refDialogEntrega.current?.close();
    void mudarStatus("entregar", prLink.trim() || undefined);
  }

  // ── Estados de carregamento ─────────────────────────────────────────
  if (fase.nome === "carregando") {
    return <p className="text-sm text-muted-foreground">Carregando sessão…</p>;
  }
  if (fase.nome === "naoEncontrado") {
    return (
      <div className="card p-5 text-center sm:p-6">
        <h1 className="text-lg font-semibold">Sessão não encontrada</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A sessão #{id} não existe (ou foi removida).
        </p>
        <a href="/" className="btn btn-secundario mt-4">
          Voltar para a lista
        </a>
      </div>
    );
  }
  if (fase.nome === "erro" || !sessao) {
    return (
      <div className="card p-5 text-center sm:p-6">
        <p className="text-sm text-destructive">Não foi possível carregar a sessão.</p>
        <button
          type="button"
          className="btn btn-secundario mt-4"
          onClick={() => setTentativa((t) => t + 1)}
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  const souODono = sessao.dono_atual.email === eu.email;

  return (
    <div className="space-y-4">
      {/* Breadcrumb da origem (US-4) */}
      {sessao.origem && (
        <p className="text-sm text-muted-foreground">
          <a href={`/sessoes/${sessao.origem.id}`} className="text-primary underline underline-offset-2">
            ← {sessao.origem.titulo}
          </a>{" "}
          <span className="text-xs">(sessão de origem #{sessao.origem.id})</span>
        </p>
      )}

      {/* Cabeçalho: título, status, dono em destaque (FR-012), metadados */}
      <div className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="break-words text-lg font-semibold leading-snug">{sessao.titulo}</h1>
          <StatusBadge status={sessao.status} />
        </div>
        {sessao.repo && (
          <p className="mt-1 font-mono text-xs text-muted-foreground">{sessao.repo}</p>
        )}

        <div className="mt-4 rounded-md bg-accent px-3 py-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Com a baton agora
          </p>
          <p className="text-sm font-semibold">
            {sessao.dono_atual.nome}
            {souODono && <span className="font-normal text-muted-foreground"> (você)</span>}
          </p>
          <p className="text-xs text-muted-foreground">{sessao.dono_atual.email}</p>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          criada por {sessao.criador.nome} · <time title={dataAbsoluta(sessao.criado_em)}>criada {tempoRelativo(sessao.criado_em)}</time>
          {" · "}
          <time title={dataAbsoluta(sessao.atualizado_em)}>atualizada {tempoRelativo(sessao.atualizado_em)}</time>
        </p>

        {sessao.pr_link && (
          <p className="mt-2 text-sm">
            <span className="text-muted-foreground">PR: </span>
            <a
              href={sessao.pr_link}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all font-mono text-xs text-primary underline underline-offset-2"
            >
              {sessao.pr_link}
            </a>
          </p>
        )}
      </div>

      {/* Ações (US-2/US-4/US-5): conforme o status e quem está vendo */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {!souODono && (
            <button type="button" className="btn btn-primario" onClick={() => void retomar()} disabled={acaoPendente}>
              Retomar
            </button>
          )}
          {!editando && (
            <button type="button" className="btn btn-secundario" onClick={abrirEdicao}>
              Editar conteúdo
            </button>
          )}
          {sessao.status === "em_andamento" && (
            <>
              <button
                type="button"
                className="btn btn-primario"
                onClick={() => refDialogEntrega.current?.showModal()}
                disabled={acaoPendente}
              >
                Entregar
              </button>
              <button
                type="button"
                className="btn btn-secundario"
                onClick={() => void mudarStatus("arquivar")}
                disabled={acaoPendente}
              >
                Arquivar
              </button>
            </>
          )}
          {sessao.status !== "em_andamento" && (
            <button
              type="button"
              className="btn btn-primario"
              onClick={() => void mudarStatus("reabrir")}
              disabled={acaoPendente}
            >
              Reabrir
            </button>
          )}
          {sessao.status === "entregue" && (
            <button
              type="button"
              className="btn btn-secundario"
              onClick={() => void mudarStatus("arquivar")}
              disabled={acaoPendente}
            >
              Arquivar
            </button>
          )}
          <a href={`/sessoes/nova?origem=${sessao.id}`} className="btn btn-secundario">
            Estender
          </a>
        </div>
        {erroAcao && <p className="mt-2 text-sm text-destructive">{erroAcao}</p>}
      </div>

      {/* Objetivo */}
      <section className="card p-5 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Objetivo</h2>
        <p className="mt-2 text-sm leading-relaxed">{sessao.objetivo}</p>
      </section>

      {/* Contexto + próximos passos: leitura (markdown) ou edição */}
      {editando ? (
        <section className="card space-y-4 p-5 sm:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Editando conteúdo
          </h2>
          <div>
            <label htmlFor="editar-contexto" className="block text-sm font-medium">
              Contexto
            </label>
            <textarea
              id="editar-contexto"
              className="campo mt-1.5 min-h-40 font-mono text-[13px]"
              value={rascunhoEdicao.contexto_md}
              rows={8}
              onChange={(e) => editarCampo("contexto_md", e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="editar_passos" className="block text-sm font-medium">
              Próximos passos
            </label>
            <textarea
              id="editar_passos"
              className="campo mt-1.5 min-h-28 font-mono text-[13px]"
              value={rascunhoEdicao.proximos_passos_md}
              rows={5}
              onChange={(e) => editarCampo("proximos_passos_md", e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-primario"
              onClick={() => void salvarEdicao(false)}
              disabled={salvandoEdicao}
            >
              {salvandoEdicao ? "Salvando…" : "Salvar"}
            </button>
            <button type="button" className="btn btn-secundario" onClick={cancelarEdicao}>
              Cancelar
            </button>
            <p className="text-xs text-muted-foreground">Rascunho salvo automaticamente.</p>
          </div>
        </section>
      ) : (
        <>
          <SecaoMarkdown titulo="Contexto" texto={sessao.contexto_md} vazio="Sem contexto ainda — use “Editar conteúdo” para adicionar." />
          <SecaoMarkdown titulo="Próximos passos" texto={sessao.proximos_passos_md} vazio="Sem próximos passos ainda." />
        </>
      )}

      {/* Extensões (US-4) */}
      {sessao.extensoes && sessao.extensoes.length > 0 && (
        <section className="card p-5 sm:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Extensões ({sessao.extensoes.length})
          </h2>
          <ul className="mt-3 space-y-2">
            {sessao.extensoes.map((extensao) => (
              <li key={extensao.id}>
                <a
                  href={`/sessoes/${extensao.id}`}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
                >
                  <span className="font-medium">{extensao.titulo}</span>
                  <span className="text-xs text-muted-foreground">
                    {extensao.dono_atual.nome} · #{extensao.id}
                  </span>
                  <StatusBadge status={extensao.status} />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Timeline (FR-007) */}
      <section className="card p-5 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Timeline</h2>
        <div className="mt-3">
          <Timeline eventos={eventos} />
        </div>
      </section>

      {/* Dialog de entrega: PR link é opcional (US-5) */}
      <dialog
        ref={refDialogEntrega}
        onClose={() => setPrLink("")}
        className="w-[min(30rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-5 shadow-lg [&::backdrop]:bg-black/40"
      >
        <form onSubmit={submeterEntrega}>
          <h3 className="font-semibold">Entregar sessão</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            O status vira "entregue" e sai do destaque de ativas. O link do PR é opcional.
          </p>
          <input
            autoFocus
            type="url"
            className="campo mt-3 font-mono text-[13px]"
            placeholder="https://github.com/.../pull/123"
            value={prLink}
            maxLength={500}
            onChange={(e) => setPrLink(e.target.value)}
          />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-secundario" onClick={() => refDialogEntrega.current?.close()}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primario" disabled={acaoPendente}>
              {acaoPendente ? "Entregando…" : "Entregar"}
            </button>
          </div>
        </form>
      </dialog>

      {/* Dialog de conflito (409): mostra o conteúdo vigente e oferece
          a sobrescrita com force:true (edge case da spec) */}
      <dialog
        ref={refDialogConflito}
        onClose={() => setConflito(null)}
        className="w-[min(36rem,calc(100vw-2rem))] rounded-lg border border-border bg-card p-5 shadow-lg [&::backdrop]:bg-black/40"
      >
        <h3 className="font-semibold">Conteúdo mudou desde a abertura</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Alguém salvou alterações enquanto você editava. O conteúdo vigente é o abaixo —
          sobrescrever descarta essa versão (última escrita vence).
        </p>
        {conflito && (
          <div className="mt-3 space-y-2">
            <BlocoVigente rotulo="Contexto vigente" texto={conflito.contexto_md ?? "(vazio)"} />
            <BlocoVigente
              rotulo="Próximos passos vigentes"
              texto={conflito.proximos_passos_md ?? "(vazio)"}
            />
          </div>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn btn-secundario"
            onClick={() => {
              refDialogConflito.current?.close();
              setConflito(null);
            }}
          >
            Continuar editando
          </button>
          <button
            type="button"
            className="btn btn-perigoso"
            onClick={() => {
              const base = conflito?.atualizado_em;
              refDialogConflito.current?.close();
              setConflito(null);
              void salvarEdicao(true, base);
            }}
          >
            Sobrescrever
          </button>
        </div>
      </dialog>
    </div>
  );
}

function SecaoMarkdown({
  titulo,
  texto,
  vazio,
}: {
  titulo: string;
  texto: string | null;
  vazio: string;
}) {
  return (
    <section className="card p-5 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h2>
      <div className="mt-3">
        {texto ? <MarkdownView texto={texto} /> : <p className="text-sm text-muted-foreground">{vazio}</p>}
      </div>
    </section>
  );
}

function BlocoVigente({ rotulo, texto }: { rotulo: string; texto: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{rotulo}</p>
      <pre className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
        {texto}
      </pre>
    </div>
  );
}