import { useEffect, useState, type FormEvent } from "react";
import { Plus, Archive, Pencil, Check, X } from "lucide-react";
import {
  listarContas,
  criarConta,
  editarConta,
  arquivarConta,
  saldoConta,
  type Conta,
  type TipoConta,
} from "@/lib/api/contas";
import { Cartao } from "@/components/Cartao";
import { Botao } from "@/components/Botao";
import { CampoTexto } from "@/components/CampoTexto";
import { Selecao } from "@/components/Selecao";
import { Selo } from "@/components/Selo";
import { ValorMonetario } from "@/components/ValorMonetario";

export function ContasPage() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [saldos, setSaldos] = useState<Record<string, number>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nomeEdicao, setNomeEdicao] = useState("");

  async function recarregar() {
    try {
      const lista = await listarContas();
      setContas(lista);
      const pares = await Promise.all(
        lista.map(async (c) => {
          try {
            const s = await saldoConta(c.id);
            return [c.id, s.saldo] as const;
          } catch {
            return [c.id, 0] as const;
          }
        }),
      );
      setSaldos(Object.fromEntries(pares));
    } catch {
      setErro("Não foi possível carregar as contas. Tente novamente em instantes.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    recarregar();
  }, []);

  async function aoCriar(nome: string, tipo: TipoConta) {
    await criarConta({ nome, tipo });
    setMostrarForm(false);
    recarregar();
  }

  async function aoSalvarEdicao(id: string) {
    if (!nomeEdicao.trim()) return;
    await editarConta(id, nomeEdicao.trim());
    setEditandoId(null);
    recarregar();
  }

  async function aoArquivar(id: string) {
    if (!confirm("Arquivar esta conta? O histórico é preservado, mas ela sai da lista ativa."))
      return;
    await arquivarConta(id);
    recarregar();
  }

  const ativas = contas.filter((c) => c.status === "ativa");
  const arquivadas = contas.filter((c) => c.status === "arquivada");

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Contas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A base de tudo: cada transação e cada ativo pertence a uma conta.
          </p>
        </div>
        <Botao onClick={() => setMostrarForm((v) => !v)}>
          <Plus size={16} /> Nova conta
        </Botao>
      </header>

      {mostrarForm && <FormularioConta onCriar={aoCriar} onCancelar={() => setMostrarForm(false)} />}

      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {carregando && <p className="text-sm text-muted-foreground">Carregando contas…</p>}

      {!carregando && ativas.length === 0 && !mostrarForm && (
        <Cartao>
          <p className="text-sm text-muted-foreground">
            Nenhuma conta cadastrada ainda. Crie a primeira para começar a lançar transações ou
            ativos.
          </p>
        </Cartao>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ativas.map((conta) => (
          <Cartao key={conta.id}>
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-2">
                {editandoId === conta.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <CampoTexto
                      autoFocus
                      value={nomeEdicao}
                      onChange={(e) => setNomeEdicao(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && aoSalvarEdicao(conta.id)}
                    />
                    <button
                      onClick={() => aoSalvarEdicao(conta.id)}
                      className="text-positivo"
                      aria-label="Salvar"
                    >
                      <Check size={18} />
                    </button>
                    <button
                      onClick={() => setEditandoId(null)}
                      className="text-muted-foreground"
                      aria-label="Cancelar"
                    >
                      <X size={18} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div>
                      <h2 className="font-display text-lg font-medium">{conta.nome}</h2>
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        {conta.tipo === "corrente" ? "Conta corrente" : "Investimento"}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          setEditandoId(conta.id);
                          setNomeEdicao(conta.nome);
                        }}
                        className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        aria-label="Editar nome"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        onClick={() => aoArquivar(conta.id)}
                        className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        aria-label="Arquivar"
                      >
                        <Archive size={15} />
                      </button>
                    </div>
                  </>
                )}
              </div>
              <ValorMonetario valor={saldos[conta.id] ?? 0} tamanho="lg" tom="auto" />
            </div>
          </Cartao>
        ))}
      </div>

      {arquivadas.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Contas arquivadas</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {arquivadas.map((conta) => (
              <div
                key={conta.id}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-3 opacity-60"
              >
                <span className="text-sm">{conta.nome}</span>
                <Selo>arquivada</Selo>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function FormularioConta({
  onCriar,
  onCancelar,
}: {
  onCriar: (nome: string, tipo: TipoConta) => Promise<void>;
  onCancelar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<TipoConta>("corrente");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function aoSubmeter(e: FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      await onCriar(nome.trim(), tipo);
    } catch {
      setErro("Não foi possível criar a conta.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao titulo="Nova conta">
      <form onSubmit={aoSubmeter} className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <CampoTexto
          rotulo="Nome"
          placeholder="Ex.: Nubank, XP"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          className="sm:w-64"
          required
        />
        <Selecao rotulo="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoConta)}>
          <option value="corrente">Corrente</option>
          <option value="investimento">Investimento</option>
        </Selecao>
        <div className="flex gap-2">
          <Botao type="submit" disabled={salvando}>
            {salvando ? "Criando…" : "Criar conta"}
          </Botao>
          <Botao type="button" variante="fantasma" onClick={onCancelar}>
            Cancelar
          </Botao>
        </div>
      </form>
      {erro && <p className="mt-2 text-sm text-destructive">{erro}</p>}
    </Cartao>
  );
}
