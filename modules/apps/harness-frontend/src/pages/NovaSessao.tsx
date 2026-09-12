// Form de criação de sessão (US-1) e de extensão (US-4, ?origem=ID).
// Rascunho em localStorage preservado entre visitas e falhas de API
// (edge case da spec); validação client-side espelha os limites do
// data-model: título/objetivo obrigatórios, contexto ≤ 64 KB e próximos
// passos ≤ 16 KB em bytes UTF-8 (o servidor recusa com 422 se passar).
import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ApiError, createSessao, getSessao, type Sessao } from "@/lib/api";
import { limparRascunho, lerRascunho, salvarRascunho } from "@/lib/rascunho";

type Campos = {
  titulo: string;
  objetivo: string;
  repo: string;
  contexto_md: string;
  proximos_passos_md: string;
};

const CAMPOS_VAZIOS: Campos = {
  titulo: "",
  objetivo: "",
  repo: "",
  contexto_md: "",
  proximos_passos_md: "",
};

const LIMITE_CONTEXTO_BYTES = 65_536; // 64 KB (data-model)
const LIMITE_PASSOS_BYTES = 16_384; // 16 KB

export function NovaSessao({ origemId }: { origemId: number | null }) {
  const chaveRascunho =
    origemId !== null ? `harness:rascunho:extensao-${origemId}` : "harness:rascunho:nova-sessao";
  // Só conta como rascunho restaurado se tem conteúdo — rascunho vazio
  // não deve inibir o prefill da extensão.
  const veioDeRascunho = useRef(
    (() => {
      const salvo = lerRascunho<Campos>(chaveRascunho);
      return salvo != null && Object.values(salvo).some((valor) => valor !== "");
    })(),
  );

  const [campos, setCampos] = useState<Campos>(
    () => ({ ...CAMPOS_VAZIOS, ...lerRascunho<Campos>(chaveRascunho) }),
  );
  const [origem, setOrigem] = useState<Sessao | null>(null);
  const [origemFalhou, setOrigemFalhou] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erros, setErros] = useState<Partial<Record<keyof Campos, string>>>({});
  const [erroRede, setErroRede] = useState(false);
  const [tentativaOrigem, setTentativaOrigem] = useState(0);

  useEffect(() => {
    document.title = origemId ? "Estender sessão — harness" : "Nova sessão — harness";
  }, [origemId]);

  // Sessão de origem: banner + prefill do contexto (US-4). Um rascunho
  // restaurado ganha da cópia — é o que o usuário estava digitando.
  useEffect(() => {
    if (origemId === null) return;
    let ativo = true;
    setOrigemFalhou(false);
    getSessao(origemId)
      .then((sessao) => {
        if (!ativo) return;
        setOrigem(sessao);
        if (!veioDeRascunho.current) {
          setCampos((atual) => ({
            ...atual,
            contexto_md: sessao.contexto_md ?? "",
            proximos_passos_md: sessao.proximos_passos_md ?? "",
          }));
        }
      })
      .catch(() => {
        if (ativo) setOrigemFalhou(true);
      });
    return () => {
      ativo = false;
    };
    // Executa uma vez: a origem é fixa por carga da página.
  }, [origemId, tentativaOrigem]);

  // Rascunho salvo a cada tecla — sobrevive a reload e a API fora do
  // ar. Form de volta ao vazio não guarda objeto vazio: limpa a chave,
  // para não inibir o prefill da extensão em visitas futuras.
  useEffect(() => {
    if (Object.values(campos).some((valor) => valor !== "")) {
      salvarRascunho(chaveRascunho, campos);
    } else {
      limparRascunho(chaveRascunho);
    }
  }, [chaveRascunho, campos]);

  const temConteudo = Object.values(campos).some((valor) => valor !== "");

  function editar(campo: keyof Campos, valor: string): void {
    setCampos((atual) => ({ ...atual, [campo]: valor }));
    setErros((atual) => (atual[campo] ? { ...atual, [campo]: undefined } : atual));
    setErroRede(false);
  }

  async function submeter(event: FormEvent): Promise<void> {
    event.preventDefault();
    setErroRede(false);

    // Validação client-side (mesmas regras que a API aplica em 422).
    const novosErros: Partial<Record<keyof Campos, string>> = {};
    if (!campos.titulo.trim()) novosErros.titulo = "Informe um título.";
    if (!campos.objetivo.trim()) novosErros.objetivo = "Informe um objetivo.";
    const bytesContexto = bytesUtf8(campos.contexto_md);
    if (bytesContexto > LIMITE_CONTEXTO_BYTES) {
      novosErros.contexto_md = `Contexto passa de 64 KB (${formatarBytes(bytesContexto)}) — encurte ou deixe detalhes para a página da sessão.`;
    }
    const bytesPassos = bytesUtf8(campos.proximos_passos_md);
    if (bytesPassos > LIMITE_PASSOS_BYTES) {
      novosErros.proximos_passos_md = `Próximos passos passam de 16 KB (${formatarBytes(bytesPassos)}) — encurte.`;
    }
    setErros(novosErros);
    if (Object.values(novosErros).some(Boolean) || enviando) return;

    setEnviando(true);
    try {
      const sessao = await createSessao({
        titulo: campos.titulo.trim(),
        objetivo: campos.objetivo.trim(),
        repo: campos.repo.trim() || undefined,
        contexto_md: campos.contexto_md || undefined,
        proximos_passos_md: campos.proximos_passos_md || undefined,
        origem_id: origemId ?? undefined,
      });
      limparRascunho(chaveRascunho);
      window.location.href = `/sessoes/${sessao.id}`;
    } catch (err) {
      setEnviando(false);
      if (err instanceof ApiError) {
        const mapeados: Partial<Record<keyof Campos, string>> = {};
        for (const detalhe of err.detalhes ?? []) {
          const campo = detalhe.campo as keyof Campos;
          mapeados[campo] = detalhe.problema;
        }
        setErros(mapeados);
        setErroRede(Object.keys(mapeados).length === 0);
      } else {
        // Rede/API fora do ar: o rascunho continua salvo em localStorage.
        setErroRede(true);
      }
    }
  }

  if (origemId !== null && origemFalhou) {
    return (
      <div className="card p-5 sm:p-6">
        <h1 className="text-lg font-semibold">Extensão da sessão #{origemId}</h1>
        <p className="mt-2 text-sm text-destructive">
          Não foi possível carregar a sessão de origem.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="btn btn-secundario"
            onClick={() => setTentativaOrigem((t) => t + 1)}
          >
            Tentar de novo
          </button>
          <a href="/" className="btn btn-secundario">
            Voltar para a lista
          </a>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submeter} className="space-y-4">
      {origemId !== null && (
        <div className="card border-l-4 border-l-primary p-4">
          {origem ? (
            <>
              <p className="text-sm">
                <span className="font-medium">Extensão de </span>
                <a href={`/sessoes/${origem.id}`} className="text-primary underline underline-offset-2">
                  {origem.titulo}
                </a>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                O contexto e os próximos passos da origem vêm preenchidos — ajuste ou substitua.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Carregando sessão de origem…</p>
          )}
        </div>
      )}

      <div className="card space-y-4 p-5 sm:p-6">
        <h1 className="text-lg font-semibold">{origemId ? "Estender sessão" : "Nova sessão"}</h1>

        <Campo
          rotulo="Título"
          obrigatorio
          erro={erros.titulo}
          htmlFor="titulo"
          dica={`${campos.titulo.length}/200`}
        >
          <input
            id="titulo"
            className="campo"
            value={campos.titulo}
            maxLength={200}
            placeholder="refatorar auth do bet-api"
            onChange={(e) => editar("titulo", e.target.value)}
          />
        </Campo>

        <Campo
          rotulo="Objetivo"
          obrigatorio
          erro={erros.objetivo}
          htmlFor="objetivo"
          dica="o que 'pronto' significa — quem retoma precisa saber o critério"
        >
          <textarea
            id="objetivo"
            className="campo min-h-20"
            value={campos.objetivo}
            maxLength={5000}
            rows={3}
            placeholder="trocar JWT por sessões de servidor"
            onChange={(e) => editar("objetivo", e.target.value)}
          />
        </Campo>

        <Campo rotulo="Repo / branch" htmlFor="repo" dica="opcional">
          <input
            id="repo"
            className="campo font-mono text-[13px]"
            value={campos.repo}
            maxLength={200}
            placeholder="bet-api@feat/auth-sessions"
            onChange={(e) => editar("repo", e.target.value)}
          />
        </Campo>

        <Campo
          rotulo="Contexto"
          htmlFor="contexto_md"
          erro={erros.contexto_md}
          dica={`markdown · ${formatarBytes(bytesUtf8(campos.contexto_md))} / 64 KB`}
          dicaErrada={bytesUtf8(campos.contexto_md) > LIMITE_CONTEXTO_BYTES}
        >
          <textarea
            id="contexto_md"
            className="campo min-h-40 font-mono text-[13px]"
            value={campos.contexto_md}
            rows={8}
            placeholder="decisões, gotchas, links — em markdown"
            onChange={(e) => editar("contexto_md", e.target.value)}
          />
        </Campo>

        <Campo
          rotulo="Próximos passos"
          htmlFor="proximos_passos_md"
          erro={erros.proximos_passos_md}
          dica={`markdown · ${formatarBytes(bytesUtf8(campos.proximos_passos_md))} / 16 KB`}
          dicaErrada={bytesUtf8(campos.proximos_passos_md) > LIMITE_PASSOS_BYTES}
        >
          <textarea
            id="proximos_passos_md"
            className="campo min-h-28 font-mono text-[13px]"
            value={campos.proximos_passos_md}
            rows={5}
            placeholder={"1. middleware\n2. testes"}
            onChange={(e) => editar("proximos_passos_md", e.target.value)}
          />
        </Campo>

        {erroRede && (
          <p className="text-sm text-destructive">
            Não foi possível criar a sessão — a API pode estar fora do ar. Seu rascunho
            continua salvo neste navegador.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn btn-primario" disabled={enviando}>
            {enviando ? "Criando…" : origemId ? "Criar extensão" : "Criar sessão"}
          </button>
          <a href="/" className="btn btn-secundario">
            Cancelar
          </a>
          {temConteudo && (
            <button
              type="button"
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => {
                limparRascunho(chaveRascunho);
                setCampos(CAMPOS_VAZIOS);
                setErros({});
              }}
            >
              Descartar rascunho
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function Campo({
  rotulo,
  htmlFor,
  obrigatorio,
  erro,
  dica,
  dicaErrada,
  children,
}: {
  rotulo: string;
  htmlFor: string;
  obrigatorio?: boolean;
  erro?: string;
  dica?: string;
  dicaErrada?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium">
        {rotulo}
        {obrigatorio && <span className="text-destructive"> *</span>}
      </label>
      <div className="mt-1.5">{children}</div>
      {(dica || erro) && (
        <p className={`mt-1 text-xs ${erro ? "text-destructive" : dicaErrada ? "text-destructive" : "text-muted-foreground"}`}>
          {erro ?? dica}
        </p>
      )}
    </div>
  );
}

function bytesUtf8(texto: string): number {
  return new TextEncoder().encode(texto).length;
}

function formatarBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
}