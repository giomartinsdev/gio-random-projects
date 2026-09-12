import { useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2, Pencil, Paperclip, Info } from "lucide-react";
import {
  listarTransacoes,
  criarTransacao,
  editarTransacao,
  excluirTransacao,
  arquivoParaBase64,
  type Transacao,
  type TipoTransacao,
} from "@/lib/api/transacional";
import { useContas, nomeConta } from "@/lib/useContas";
import { Cartao } from "@/components/Cartao";
import { Botao } from "@/components/Botao";
import { CampoTexto } from "@/components/CampoTexto";
import { Selecao } from "@/components/Selecao";
import { ValorMonetario } from "@/components/ValorMonetario";

const CATEGORIAS = [
  "Alimentação",
  "Transporte",
  "Moradia",
  "Saúde",
  "Lazer",
  "Educação",
  "Salário",
  "Investimento",
  "Outros",
];

export function TransacionalPage() {
  const { contas } = useContas();
  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<Transacao | null>(null);

  const [filtroConta, setFiltroConta] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroDe, setFiltroDe] = useState("");
  const [filtroAte, setFiltroAte] = useState("");

  async function recarregar() {
    setCarregando(true);
    try {
      const lista = await listarTransacoes({
        conta: filtroConta || undefined,
        categoria: filtroCategoria || undefined,
        de: filtroDe || undefined,
        ate: filtroAte || undefined,
      });
      setTransacoes(lista);
      setErro(null);
    } catch {
      setErro("Não foi possível carregar as transações.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    recarregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroConta, filtroCategoria, filtroDe, filtroAte]);

  async function aoExcluir(id: string) {
    if (!confirm("Excluir esta transação?")) return;
    await excluirTransacao(id);
    recarregar();
  }

  const total = transacoes.reduce(
    (acc, t) => acc + (t.tipo === "entrada" ? t.valor : -t.valor),
    0,
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Transações</h1>
          <p className="mt-1 text-sm text-muted-foreground">Lançamentos manuais de entrada e saída.</p>
        </div>
        <Botao
          onClick={() => {
            setEditando(null);
            setMostrarForm((v) => !v);
          }}
        >
          <Plus size={16} /> Nova transação
        </Botao>
      </header>

      <Cartao className="!p-0">
        <div className="flex flex-wrap items-end gap-4 p-5">
          <Selecao rotulo="Conta" value={filtroConta} onChange={(e) => setFiltroConta(e.target.value)}>
            <option value="">Todas</option>
            {contas?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Selecao>
          <Selecao
            rotulo="Categoria"
            value={filtroCategoria}
            onChange={(e) => setFiltroCategoria(e.target.value)}
          >
            <option value="">Todas</option>
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Selecao>
          <CampoTexto
            rotulo="De"
            type="date"
            value={filtroDe}
            onChange={(e) => setFiltroDe(e.target.value)}
          />
          <CampoTexto
            rotulo="Até"
            type="date"
            value={filtroAte}
            onChange={(e) => setFiltroAte(e.target.value)}
          />
          <div className="ml-auto text-right">
            <span className="block text-xs text-muted-foreground">Saldo do período</span>
            <ValorMonetario valor={total} tamanho="md" tom="auto" />
          </div>
        </div>
      </Cartao>

      {(mostrarForm || editando) && (
        <FormularioTransacao
          contas={contas ?? []}
          transacao={editando}
          onSalvar={async (dados) => {
            if (editando) {
              await editarTransacao(editando.id, dados);
            } else {
              await criarTransacao({ ...dados, contaId: dados.contaId! });
            }
            setMostrarForm(false);
            setEditando(null);
            recarregar();
          }}
          onCancelar={() => {
            setMostrarForm(false);
            setEditando(null);
          }}
        />
      )}

      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {!carregando && transacoes.length === 0 && (
        <Cartao>
          <p className="text-sm text-muted-foreground">Nenhuma transação encontrada para esse filtro.</p>
        </Cartao>
      )}

      <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
        {transacoes.map((t) => (
          <div key={t.id} className="flex items-center gap-4 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{t.descricao || t.categoria}</span>
                {t.anexoImagem && (
                  <Paperclip size={13} className="shrink-0 text-muted-foreground" />
                )}
              </div>
              <span className="text-xs text-muted-foreground">
                {nomeConta(contas, t.contaId)} · {t.categoria} ·{" "}
                {new Date(t.data).toLocaleDateString("pt-BR")}
              </span>
            </div>
            <ValorMonetario
              valor={t.valor}
              tom={t.tipo === "entrada" ? "positivo" : "negativo"}
              semSinal
              tamanho="sm"
            />
            <div className="flex gap-1">
              <button
                onClick={() => setEditando(t)}
                className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label="Editar"
              >
                <Pencil size={15} />
              </button>
              <button
                onClick={() => aoExcluir(t.id)}
                className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive"
                aria-label="Excluir"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface DadosFormulario {
  contaId?: string;
  tipo: TipoTransacao;
  valor: number;
  data: string;
  categoria: string;
  descricao?: string;
  anexoImagem?: string;
}

function FormularioTransacao({
  contas,
  transacao,
  onSalvar,
  onCancelar,
}: {
  contas: { id: string; nome: string; status: string }[];
  transacao: Transacao | null;
  onSalvar: (dados: DadosFormulario) => Promise<void>;
  onCancelar: () => void;
}) {
  const contasAtivas = contas.filter((c) => c.status === "ativa");
  const [contaId, setContaId] = useState(transacao?.contaId ?? contasAtivas[0]?.id ?? "");
  const [tipo, setTipo] = useState<TipoTransacao>(transacao?.tipo ?? "saida");
  const [valor, setValor] = useState(transacao?.valor?.toString() ?? "");
  const [data, setData] = useState(transacao?.data ?? new Date().toISOString().slice(0, 10));
  const [categoria, setCategoria] = useState(transacao?.categoria ?? CATEGORIAS[0]);
  const [descricao, setDescricao] = useState(transacao?.descricao ?? "");
  const [anexoImagem, setAnexoImagem] = useState<string | undefined>(transacao?.anexoImagem);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function aoSubmeter(e: FormEvent) {
    e.preventDefault();
    const numerico = Number(valor);
    if (!numerico || numerico <= 0) {
      setErro("O valor precisa ser maior que zero.");
      return;
    }
    if (!contaId) {
      setErro("Selecione uma conta.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await onSalvar({ contaId, tipo, valor: numerico, data, categoria, descricao, anexoImagem });
    } catch {
      setErro("Não foi possível salvar a transação.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao titulo={transacao ? "Editar transação" : "Nova transação"}>
      <form onSubmit={aoSubmeter} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Selecao rotulo="Conta" value={contaId} onChange={(e) => setContaId(e.target.value)} required>
            <option value="" disabled>
              Selecione
            </option>
            {contasAtivas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Selecao>
          <Selecao rotulo="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoTransacao)}>
            <option value="entrada">Entrada</option>
            <option value="saida">Saída</option>
          </Selecao>
          <CampoTexto
            rotulo="Valor (R$)"
            type="number"
            step="0.01"
            min="0.01"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            required
          />
          <CampoTexto
            rotulo="Data"
            type="date"
            value={data}
            onChange={(e) => setData(e.target.value)}
            required
          />
          <Selecao rotulo="Categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            {CATEGORIAS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Selecao>
          <CampoTexto
            rotulo="Descrição (opcional)"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-3 rounded-md border border-dashed border-border p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Paperclip size={15} />
            <span>{anexoImagem ? "Comprovante anexado" : "Anexar imagem do comprovante"}</span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setAnexoImagem(await arquivoParaBase64(file));
              }}
            />
          </label>
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <Info size={12} /> leitura automática em breve
          </span>
        </div>

        {erro && <p className="text-sm text-destructive">{erro}</p>}

        <div className="flex gap-2">
          <Botao type="submit" disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </Botao>
          <Botao type="button" variante="fantasma" onClick={onCancelar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Cartao>
  );
}
