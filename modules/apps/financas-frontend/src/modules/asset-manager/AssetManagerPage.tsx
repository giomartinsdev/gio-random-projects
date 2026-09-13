import { useEffect, useState, type FormEvent } from "react";
import { Plus, AlertTriangle, TrendingUp, TrendingDown, DollarSign, XCircle } from "lucide-react";
import {
  listarAtivos,
  cadastrarAtivo,
  registrarMovimento,
  type Ativo,
} from "@/lib/api/asset-manager";
import { useContas, nomeConta } from "@/lib/useContas";
import { dataHojeCalendario } from "@/lib/datas";
import { Cartao } from "@/components/Cartao";
import { Botao } from "@/components/Botao";
import { CampoTexto } from "@/components/CampoTexto";
import { Selecao } from "@/components/Selecao";
import { Selo } from "@/components/Selo";
import { ValorMonetario } from "@/components/ValorMonetario";

export function AssetManagerPage() {
  const { contas } = useContas();
  const [ativos, setAtivos] = useState<Ativo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [movimentoAtivo, setMovimentoAtivo] = useState<Ativo | null>(null);

  async function recarregar() {
    setCarregando(true);
    try {
      setAtivos(await listarAtivos());
      setErro(null);
    } catch {
      setErro("Não foi possível carregar a carteira.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    recarregar();
  }, []);

  const contasInvestimento = (contas ?? []).filter(
    (c) => c.tipo === "investimento" && c.status === "ativa",
  );

  const abertos = ativos.filter((a) => a.status === "aberta");
  const custoTotal = abertos.reduce((acc, a) => acc + a.custoTotal, 0);
  const valorMercado = abertos.reduce((acc, a) => acc + a.valorMercadoAtual, 0);
  const rentabilidadeAbs = valorMercado - custoTotal;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Investimentos</h1>
          <p className="mt-1 text-sm text-muted-foreground">Carteira de ativos por conta de investimento.</p>
        </div>
        <Botao onClick={() => setMostrarForm((v) => !v)}>
          <Plus size={16} /> Novo ativo
        </Botao>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Cartao titulo="Custo total">
          <ValorMonetario valor={custoTotal} tamanho="lg" />
        </Cartao>
        <Cartao titulo="Valor de mercado">
          <ValorMonetario valor={valorMercado} tamanho="lg" />
        </Cartao>
        <Cartao titulo="Rentabilidade">
          <ValorMonetario valor={rentabilidadeAbs} tamanho="lg" tom="auto" />
        </Cartao>
      </div>

      {mostrarForm && (
        <FormularioAtivo
          contas={contasInvestimento}
          onCriar={async (dados) => {
            await cadastrarAtivo(dados);
            setMostrarForm(false);
            recarregar();
          }}
          onCancelar={() => setMostrarForm(false)}
        />
      )}

      {movimentoAtivo && (
        <FormularioMovimento
          ativo={movimentoAtivo}
          onSalvar={async (dados) => {
            await registrarMovimento(movimentoAtivo.id, dados);
            setMovimentoAtivo(null);
            recarregar();
          }}
          onCancelar={() => setMovimentoAtivo(null)}
        />
      )}

      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {!carregando && abertos.length === 0 && (
        <Cartao>
          <p className="text-sm text-muted-foreground">
            Nenhum ativo cadastrado ainda. Cadastre uma compra para começar a acompanhar a
            rentabilidade.
          </p>
        </Cartao>
      )}

      <div className="flex flex-col gap-3">
        {abertos.map((a) => {
          const positivo = a.rentabilidadeAbsoluta >= 0;
          return (
            <Cartao key={a.id}>
              <div className="flex flex-wrap items-center gap-6">
                <div className="min-w-[7rem]">
                  <h2 className="font-mono text-lg font-semibold tracking-tight">{a.ticker}</h2>
                  <span className="text-xs text-muted-foreground">
                    {nomeConta(contas, a.contaId)}
                  </span>
                </div>

                <div className="flex flex-1 flex-wrap items-center gap-8">
                  <Campo rotulo="Quantidade" valor={a.quantidadeAtual.toLocaleString("pt-BR")} />
                  <Campo rotulo="Custo médio" money={a.custoMedio} />
                  <Campo rotulo="Custo total" money={a.custoTotal} />
                  <div>
                    <span className="block text-xs text-muted-foreground">Cotação</span>
                    <div className="flex items-center gap-1.5">
                      <ValorMonetario valor={a.ultimaCotacao} tamanho="sm" />
                      {a.desatualizada && (
                        <span title="Cotação desatualizada — última consulta bem-sucedida exibida.">
                          <AlertTriangle size={13} className="text-primary" />
                        </span>
                      )}
                    </div>
                  </div>
                  <Campo rotulo="Valor de mercado" money={a.valorMercadoAtual} />
                  <div>
                    <span className="block text-xs text-muted-foreground">Rentabilidade</span>
                    <div className="flex items-center gap-1">
                      {positivo ? (
                        <TrendingUp size={14} className="text-positivo" />
                      ) : (
                        <TrendingDown size={14} className="text-destructive" />
                      )}
                      <ValorMonetario
                        valor={a.rentabilidadeAbsoluta}
                        tamanho="sm"
                        tom="auto"
                        semSinal
                      />
                      <span className={positivo ? "text-xs text-positivo" : "text-xs text-destructive"}>
                        ({(a.rentabilidadePercentual * 100).toFixed(1)}%)
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Botao
                    tamanho="sm"
                    variante="secundaria"
                    onClick={() => setMovimentoAtivo(a)}
                  >
                    <DollarSign size={14} /> Movimentar
                  </Botao>
                </div>
              </div>
              {a.desatualizada && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <AlertTriangle size={12} /> Cotação desatualizada — mostrando o último valor
                  conhecido em {new Date(a.ultimaCotacaoEm).toLocaleString("pt-BR")}.
                </p>
              )}
            </Cartao>
          );
        })}
      </div>

      {ativos.some((a) => a.status === "encerrada") && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Posições encerradas</h2>
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {ativos
              .filter((a) => a.status === "encerrada")
              .map((a) => (
                <div key={a.id} className="flex items-center gap-4 px-5 py-3 opacity-70">
                  <XCircle size={14} className="text-muted-foreground" />
                  <span className="font-mono text-sm">{a.ticker}</span>
                  <span className="text-xs text-muted-foreground">{nomeConta(contas, a.contaId)}</span>
                  <Selo tom={a.rentabilidadeAbsoluta >= 0 ? "positivo" : "negativo"}>
                    resultado {a.rentabilidadeAbsoluta >= 0 ? "positivo" : "negativo"}
                  </Selo>
                </div>
              ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Campo({ rotulo, valor, money }: { rotulo: string; valor?: string; money?: number }) {
  return (
    <div>
      <span className="block text-xs text-muted-foreground">{rotulo}</span>
      {money !== undefined ? (
        <ValorMonetario valor={money} tamanho="sm" />
      ) : (
        <span className="font-mono text-sm tabular">{valor}</span>
      )}
    </div>
  );
}

function FormularioAtivo({
  contas,
  onCriar,
  onCancelar,
}: {
  contas: { id: string; nome: string }[];
  onCriar: (dados: {
    contaId: string;
    ticker: string;
    quantidade: number;
    precoUnitario: number;
    data: string;
  }) => Promise<void>;
  onCancelar: () => void;
}) {
  const [contaId, setContaId] = useState(contas[0]?.id ?? "");
  const [ticker, setTicker] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [precoUnitario, setPrecoUnitario] = useState("");
  const [data, setData] = useState(dataHojeCalendario());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function aoSubmeter(e: FormEvent) {
    e.preventDefault();
    if (!contaId) {
      setErro("Cadastre primeiro uma conta do tipo investimento.");
      return;
    }
    const qtd = Number(quantidade);
    const preco = Number(precoUnitario);
    if (!qtd || qtd <= 0 || !preco || preco <= 0) {
      setErro("Quantidade e preço precisam ser maiores que zero.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await onCriar({ contaId, ticker: ticker.toUpperCase(), quantidade: qtd, precoUnitario: preco, data });
    } catch {
      setErro("Não foi possível cadastrar o ativo.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao titulo="Novo ativo">
      <form onSubmit={aoSubmeter} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Selecao rotulo="Conta" value={contaId} onChange={(e) => setContaId(e.target.value)} required>
            <option value="" disabled>
              Selecione
            </option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Selecao>
          <CampoTexto
            rotulo="Ticker"
            placeholder="PETR4"
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            required
          />
          <CampoTexto
            rotulo="Quantidade"
            type="number"
            step="1"
            min="1"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            required
          />
          <CampoTexto
            rotulo="Preço pago (R$)"
            type="number"
            step="0.01"
            min="0.01"
            value={precoUnitario}
            onChange={(e) => setPrecoUnitario(e.target.value)}
            required
          />
          <CampoTexto rotulo="Data" type="date" value={data} onChange={(e) => setData(e.target.value)} required />
        </div>
        {erro && <p className="text-sm text-destructive">{erro}</p>}
        <div className="flex gap-2">
          <Botao type="submit" disabled={salvando}>
            {salvando ? "Salvando…" : "Cadastrar"}
          </Botao>
          <Botao type="button" variante="fantasma" onClick={onCancelar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Cartao>
  );
}

function FormularioMovimento({
  ativo,
  onSalvar,
  onCancelar,
}: {
  ativo: Ativo;
  onSalvar: (dados: {
    tipo: "compra" | "venda" | "provento";
    quantidade?: number;
    precoUnitario?: number;
    valorProvento?: number;
    data: string;
  }) => Promise<void>;
  onCancelar: () => void;
}) {
  const [tipo, setTipo] = useState<"compra" | "venda" | "provento">("provento");
  const [quantidade, setQuantidade] = useState("");
  const [precoUnitario, setPrecoUnitario] = useState("");
  const [valorProvento, setValorProvento] = useState("");
  const [data, setData] = useState(dataHojeCalendario());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function aoSubmeter(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      if (tipo === "provento") {
        const valor = Number(valorProvento);
        if (!valor || valor <= 0) throw new Error("valor invalido");
        await onSalvar({ tipo, valorProvento: valor, data });
      } else {
        const qtd = Number(quantidade);
        const preco = Number(precoUnitario);
        if (!qtd || qtd <= 0 || !preco || preco <= 0) throw new Error("valores invalidos");
        if (tipo === "venda" && qtd > ativo.quantidadeAtual) {
          throw new Error("quantidade maior que a posicao atual");
        }
        await onSalvar({ tipo, quantidade: qtd, precoUnitario: preco, data });
      }
    } catch {
      setErro("Verifique os valores informados.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao titulo={`Movimentar ${ativo.ticker}`}>
      <form onSubmit={aoSubmeter} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Selecao
            rotulo="Tipo de movimento"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as typeof tipo)}
          >
            <option value="provento">Provento recebido</option>
            <option value="compra">Compra adicional</option>
            <option value="venda">Venda / encerrar posição</option>
          </Selecao>
          {tipo === "provento" ? (
            <CampoTexto
              rotulo="Valor recebido (R$)"
              type="number"
              step="0.01"
              min="0.01"
              value={valorProvento}
              onChange={(e) => setValorProvento(e.target.value)}
              required
            />
          ) : (
            <>
              <CampoTexto
                rotulo="Quantidade"
                type="number"
                step="1"
                min="1"
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                required
              />
              <CampoTexto
                rotulo="Preço unitário (R$)"
                type="number"
                step="0.01"
                min="0.01"
                value={precoUnitario}
                onChange={(e) => setPrecoUnitario(e.target.value)}
                required
              />
            </>
          )}
          <CampoTexto rotulo="Data" type="date" value={data} onChange={(e) => setData(e.target.value)} required />
        </div>
        {erro && <p className="text-sm text-destructive">{erro}</p>}
        <div className="flex gap-2">
          <Botao type="submit" disabled={salvando}>
            {salvando ? "Salvando…" : "Registrar"}
          </Botao>
          <Botao type="button" variante="fantasma" onClick={onCancelar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </Cartao>
  );
}
