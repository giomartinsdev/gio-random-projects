import { useEffect, useState, type FormEvent } from "react";
import { Plus, RotateCcw } from "lucide-react";
import {
  buscarLayout,
  salvarLayout,
  removerLayout,
  type Bloco,
  type DashboardLayout,
  type FonteDados,
  type TipoVisualizacao,
} from "@/lib/api/dashboard";
import { LAYOUT_PADRAO } from "./defaultLayout";
import {
  normalizarLayout,
  VISUALIZACAO_PADRAO,
  visualizacoesValidas,
  ROTULO_VISUALIZACAO,
} from "./visualizacoes";
import { BlocoContainer } from "./BlocoContainer";
import { useContas } from "@/lib/useContas";
import { Botao } from "@/components/Botao";
import { Cartao } from "@/components/Cartao";
import { Selecao } from "@/components/Selecao";
import { CampoTexto } from "@/components/CampoTexto";

const LARGURA_GRADE = 8;

export function DashboardPage() {
  const { contas } = useContas();
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [salvandoErro, setSalvandoErro] = useState<string | null>(null);

  useEffect(() => {
    buscarLayout()
      .then((l) => setLayout(normalizarLayout(l ?? LAYOUT_PADRAO)))
      .catch(() => setLayout(LAYOUT_PADRAO))
      .finally(() => setCarregando(false));
  }, []);

  async function persistir(novo: DashboardLayout) {
    setLayout(novo);
    try {
      await salvarLayout(novo);
      setSalvandoErro(null);
    } catch {
      setSalvandoErro("Não foi possível salvar a personalização agora. Suas mudanças ficam só nesta sessão.");
    }
  }

  function atualizarBloco(id: string, mudar: (b: Bloco) => Bloco) {
    if (!layout) return;
    persistir({ blocos: layout.blocos.map((b) => (b.id === id ? mudar(b) : b)) });
  }

  function removerBloco(id: string) {
    if (!layout) return;
    persistir({ blocos: layout.blocos.filter((b) => b.id !== id) });
  }

  function adicionarBloco(bloco: Bloco) {
    if (!layout) return;
    persistir({ blocos: [...layout.blocos, bloco] });
    setMostrarForm(false);
  }

  async function restaurarPadrao() {
    if (!confirm("Restaurar o layout padrão? Sua personalização atual será substituída.")) return;
    try {
      await removerLayout();
    } catch {
      // segue mesmo se o DELETE falhar -- o PUT abaixo já reflete o padrão.
    }
    persistir(LAYOUT_PADRAO);
  }

  if (carregando || !layout) {
    return <p className="text-sm text-muted-foreground">Carregando dashboard…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Visão geral</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Monte seu painel: adicione, mova, redimensione ou remova blocos livremente.
          </p>
        </div>
        <div className="flex gap-2">
          <Botao variante="secundaria" onClick={restaurarPadrao}>
            <RotateCcw size={15} /> Restaurar padrão
          </Botao>
          <Botao onClick={() => setMostrarForm((v) => !v)}>
            <Plus size={15} /> Adicionar bloco
          </Botao>
        </div>
      </header>

      {salvandoErro && <p className="text-xs text-destructive">{salvandoErro}</p>}

      {mostrarForm && (
        <FormularioBloco
          contas={contas ?? []}
          onAdicionar={adicionarBloco}
          onCancelar={() => setMostrarForm(false)}
        />
      )}

      {layout.blocos.length === 0 ? (
        <Cartao>
          <p className="text-sm text-muted-foreground">
            Nenhum bloco no seu painel. Adicione um ou restaure o layout padrão.
          </p>
        </Cartao>
      ) : (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(${LARGURA_GRADE}, minmax(0, 1fr))` }}
        >
          {layout.blocos.map((bloco) => (
            <BlocoContainer
              key={bloco.id}
              bloco={bloco}
              contas={contas}
              onMover={(dx, dy) =>
                atualizarBloco(bloco.id, (b) => ({
                  ...b,
                  posicao: {
                    x: Math.max(0, Math.min(LARGURA_GRADE - b.tamanho.largura, b.posicao.x + dx)),
                    y: Math.max(0, b.posicao.y + dy),
                  },
                }))
              }
              onRedimensionar={(dl, da) =>
                atualizarBloco(bloco.id, (b) => ({
                  ...b,
                  tamanho: {
                    largura: Math.max(2, Math.min(LARGURA_GRADE, b.tamanho.largura + dl)),
                    altura: Math.max(2, b.tamanho.altura + da),
                  },
                }))
              }
              onRemover={() => removerBloco(bloco.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const TIPOS_FONTE = [
  { valor: "saldo-consolidado", rotulo: "Saldo consolidado" },
  { valor: "gastos-por-categoria", rotulo: "Gastos por categoria" },
  { valor: "evolucao-patrimonial", rotulo: "Evolução patrimonial" },
  { valor: "extrato-conta", rotulo: "Extrato de uma conta" },
  { valor: "carteira-ativos", rotulo: "Carteira de ativos" },
] as const;

function FormularioBloco({
  contas,
  onAdicionar,
  onCancelar,
}: {
  contas: { id: string; nome: string }[];
  onAdicionar: (bloco: Bloco) => void;
  onCancelar: () => void;
}) {
  const [tipoFonte, setTipoFonte] = useState<(typeof TIPOS_FONTE)[number]["valor"]>(
    "saldo-consolidado",
  );
  const [tipoVisualizacao, setTipoVisualizacao] = useState<TipoVisualizacao>("indicador");
  const [contaId, setContaId] = useState(contas[0]?.id ?? "");
  const [titulo, setTitulo] = useState("");

  function aoSubmeter(e: FormEvent) {
    e.preventDefault();
    let fonteDados: FonteDados;
    switch (tipoFonte) {
      case "extrato-conta":
        fonteDados = { tipo: "extrato-conta", contaId };
        break;
      case "carteira-ativos":
        fonteDados = { tipo: "carteira-ativos", contaId: contaId || undefined };
        break;
      case "gastos-por-categoria":
        fonteDados = { tipo: "gastos-por-categoria", contaId: contaId || undefined, periodoDias: 30 };
        break;
      case "evolucao-patrimonial":
        fonteDados = { tipo: "evolucao-patrimonial", periodoDias: 90 };
        break;
      default:
        fonteDados = { tipo: "saldo-consolidado" };
    }

    onAdicionar({
      id: `bloco-${Date.now()}`,
      tipoVisualizacao,
      titulo: titulo.trim() || TIPOS_FONTE.find((f) => f.valor === tipoFonte)!.rotulo,
      fonteDados,
      posicao: { x: 0, y: 999 },
      tamanho: { largura: 4, altura: tipoVisualizacao === "indicador" ? 2 : 4 },
    });
  }

  const precisaConta = tipoFonte === "extrato-conta";

  return (
    <Cartao titulo="Novo bloco">
      <form onSubmit={aoSubmeter} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Selecao
            rotulo="Fonte de dados"
            value={tipoFonte}
            onChange={(e) => {
              const nova = e.target.value as typeof tipoFonte;
              setTipoFonte(nova);
              // A visualização acompanha a fonte: dados de forma
              // diferente pedem render diferente (visualizacoes.ts).
              setTipoVisualizacao(VISUALIZACAO_PADRAO[nova]);
            }}
          >
            {TIPOS_FONTE.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.rotulo}
              </option>
            ))}
          </Selecao>
          <Selecao
            rotulo="Visualização"
            value={tipoVisualizacao}
            onChange={(e) => setTipoVisualizacao(e.target.value as TipoVisualizacao)}
          >
            {visualizacoesValidas(tipoFonte).map((v) => (
              <option key={v} value={v}>
                {ROTULO_VISUALIZACAO[v]}
              </option>
            ))}
          </Selecao>
          {(precisaConta || tipoFonte === "carteira-ativos" || tipoFonte === "gastos-por-categoria") && (
            <Selecao
              rotulo={precisaConta ? "Conta" : "Conta (opcional)"}
              value={contaId}
              onChange={(e) => setContaId(e.target.value)}
              required={precisaConta}
            >
              <option value="">{precisaConta ? "Selecione" : "Todas"}</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Selecao>
          )}
          <CampoTexto
            rotulo="Título (opcional)"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Botao type="submit">Adicionar</Botao>
          <Botao type="button" variante="fantasma" onClick={onCancelar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Cartao>
  );
}
