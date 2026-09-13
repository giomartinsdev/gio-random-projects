import { useEffect, useState, type FormEvent } from "react";
import { Plus, Check, X, RotateCcw } from "lucide-react";
import {
  listarApostas,
  registrarAposta,
  resolverAposta,
  type Aposta,
} from "@/lib/api/apostas";
import { useContas, nomeConta } from "@/lib/useContas";
import { dataHojeCalendario, formatarDataCalendario } from "@/lib/datas";
import { Cartao } from "@/components/Cartao";
import { Botao } from "@/components/Botao";
import { CampoTexto } from "@/components/CampoTexto";
import { Selecao } from "@/components/Selecao";
import { Selo } from "@/components/Selo";
import { ValorMonetario } from "@/components/ValorMonetario";

export function ApostasPage() {
  const { contas } = useContas();
  const [apostas, setApostas] = useState<Aposta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);

  async function recarregar() {
    setCarregando(true);
    try {
      setApostas(await listarApostas());
      setErro(null);
    } catch {
      setErro("Não foi possível carregar as apostas.");
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    recarregar();
  }, []);

  const contasAposta = (contas ?? []).filter((c) => c.tipo === "aposta" && c.status === "ativa");

  const pendentes = apostas.filter((a) => a.status === "pendente");
  const resolvidas = apostas.filter((a) => a.status !== "pendente");
  const emAberto = pendentes.reduce((acc, a) => acc + a.valorApostado, 0);
  const lucroGreen = resolvidas
    .filter((a) => a.status === "green")
    .reduce((acc, a) => acc + ((a.retornoObtido ?? 0) - a.valorApostado), 0);
  const perdaRed = resolvidas
    .filter((a) => a.status === "red")
    .reduce((acc, a) => acc + a.valorApostado, 0);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Apostas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gestão financeira das suas apostas por casa -- registrar já debita, resolver já
            credita.
          </p>
        </div>
        <Botao onClick={() => setMostrarForm((v) => !v)}>
          <Plus size={16} /> Nova aposta
        </Botao>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <Cartao titulo="Em aberto">
          <ValorMonetario valor={emAberto} tamanho="lg" />
        </Cartao>
        <Cartao titulo="Lucro em green">
          <ValorMonetario valor={lucroGreen} tamanho="lg" tom="auto" />
        </Cartao>
        <Cartao titulo="Perdido em red">
          <ValorMonetario valor={-perdaRed} tamanho="lg" tom="auto" />
        </Cartao>
      </div>

      {mostrarForm && (
        <FormularioAposta
          contas={contasAposta}
          onCriar={async (dados) => {
            await registrarAposta(dados);
            setMostrarForm(false);
            recarregar();
          }}
          onCancelar={() => setMostrarForm(false)}
        />
      )}

      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {!carregando && pendentes.length === 0 && (
        <Cartao>
          <p className="text-sm text-muted-foreground">
            Nenhuma aposta pendente. Registre uma para começar a reconciliar suas casas.
          </p>
        </Cartao>
      )}

      <div className="flex flex-col gap-3">
        {pendentes.map((a) => (
          <LinhaApostaPendente
            key={a.id}
            aposta={a}
            nomeContaAposta={nomeConta(contas, a.contaId)}
            onResolvida={recarregar}
          />
        ))}
      </div>

      {resolvidas.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">Histórico</h2>
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
            {resolvidas.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
                <span className="min-w-0 flex-1 truncate text-sm">{a.descricao}</span>
                <span className="text-xs text-muted-foreground">{nomeConta(contas, a.contaId)}</span>
                <span className="text-xs text-muted-foreground">
                  {formatarDataCalendario(a.dataResultado ?? a.dataAposta)}
                </span>
                <Selo tom={a.status === "green" ? "positivo" : a.status === "red" ? "negativo" : "neutro"}>
                  {a.status}
                </Selo>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function FormularioAposta({
  contas,
  onCriar,
  onCancelar,
}: {
  contas: { id: string; nome: string }[];
  onCriar: (dados: {
    contaId: string;
    descricao: string;
    valorApostado: number;
    odd?: number;
    dataAposta: string;
  }) => Promise<void>;
  onCancelar: () => void;
}) {
  const [contaId, setContaId] = useState(contas[0]?.id ?? "");
  const [descricao, setDescricao] = useState("");
  const [valorApostado, setValorApostado] = useState("");
  const [odd, setOdd] = useState("");
  const [data, setData] = useState(dataHojeCalendario());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function aoSubmeter(e: FormEvent) {
    e.preventDefault();
    if (!contaId) {
      setErro("Cadastre primeiro uma conta do tipo aposta.");
      return;
    }
    const valor = Number(valorApostado);
    if (!valor || valor <= 0) {
      setErro("Valor apostado precisa ser maior que zero.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await onCriar({
        contaId,
        descricao,
        valorApostado: valor,
        odd: odd ? Number(odd) : undefined,
        dataAposta: data,
      });
    } catch {
      setErro("Não foi possível registrar a aposta.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Cartao titulo="Registrar aposta">
      <form onSubmit={aoSubmeter} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Selecao rotulo="Casa (conta)" value={contaId} onChange={(e) => setContaId(e.target.value)}>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Selecao>
          <CampoTexto
            rotulo="Descrição"
            placeholder="Ex.: Real Madrid vence"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            className="sm:col-span-2"
            required
          />
          <CampoTexto
            rotulo="Valor apostado (R$)"
            type="number"
            step="0.01"
            min="0.01"
            value={valorApostado}
            onChange={(e) => setValorApostado(e.target.value)}
            required
          />
          <CampoTexto
            rotulo="Odd (opcional)"
            type="number"
            step="0.01"
            min="1"
            value={odd}
            onChange={(e) => setOdd(e.target.value)}
          />
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

function LinhaApostaPendente({
  aposta,
  nomeContaAposta,
  onResolvida,
}: {
  aposta: Aposta;
  nomeContaAposta: string;
  onResolvida: () => void;
}) {
  const [confirmandoGreen, setConfirmandoGreen] = useState(false);
  const [retorno, setRetorno] = useState(
    aposta.odd ? String(Math.round(aposta.valorApostado * aposta.odd * 100) / 100) : "",
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function resolver(status: "green" | "red" | "cancelada", retornoObtido?: number) {
    setSalvando(true);
    setErro(null);
    try {
      await resolverAposta(aposta.id, {
        status,
        retornoObtido,
        dataResultado: dataHojeCalendario(),
      });
      onResolvida();
    } catch {
      setErro("Não foi possível registrar o resultado.");
      setSalvando(false);
    }
  }

  return (
    <Cartao>
      <div className="flex flex-wrap items-center gap-6">
        <div className="min-w-[10rem] flex-1">
          <h2 className="text-sm font-medium">{aposta.descricao}</h2>
          <span className="text-xs text-muted-foreground">{nomeContaAposta}</span>
        </div>
        <div>
          <span className="block text-xs text-muted-foreground">Valor apostado</span>
          <ValorMonetario valor={aposta.valorApostado} tamanho="sm" />
        </div>
        {aposta.odd !== undefined && (
          <div>
            <span className="block text-xs text-muted-foreground">Odd</span>
            <span className="font-mono text-sm">{aposta.odd.toFixed(2)}</span>
          </div>
        )}
        <span className="text-xs text-muted-foreground">{formatarDataCalendario(aposta.dataAposta)}</span>

        {confirmandoGreen ? (
          <div className="flex items-center gap-2">
            <CampoTexto
              rotulo="Retorno total (R$)"
              type="number"
              step="0.01"
              min="0.01"
              value={retorno}
              onChange={(e) => setRetorno(e.target.value)}
              className="w-36"
            />
            <Botao
              tamanho="sm"
              disabled={salvando}
              onClick={() => resolver("green", Number(retorno))}
            >
              <Check size={14} /> Confirmar
            </Botao>
            <Botao tamanho="sm" variante="fantasma" onClick={() => setConfirmandoGreen(false)}>
              Cancelar
            </Botao>
          </div>
        ) : (
          <div className="flex gap-2">
            <Botao tamanho="sm" variante="secundaria" disabled={salvando} onClick={() => setConfirmandoGreen(true)}>
              <Check size={14} /> Green
            </Botao>
            <Botao tamanho="sm" variante="perigo" disabled={salvando} onClick={() => resolver("red")}>
              <X size={14} /> Red
            </Botao>
            <Botao tamanho="sm" variante="fantasma" disabled={salvando} onClick={() => resolver("cancelada")}>
              <RotateCcw size={14} /> Cancelada
            </Botao>
          </div>
        )}
      </div>
      {erro && <p className="mt-3 text-xs text-destructive">{erro}</p>}
    </Cartao>
  );
}
