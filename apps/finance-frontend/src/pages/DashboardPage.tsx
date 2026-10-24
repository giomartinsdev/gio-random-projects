import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { api, currentMonth, formatBRL, type CashFlowHistory, type CategoryAmount, type MonthlyDashboard, type Transaction } from "@/lib/api";
import { Card, Cockpit, Empty, Kpi, Progress } from "@/components/primitives";
import { CashFlowBars, CategoryBars } from "@/components/charts";
import { AiDots } from "@/components/aidots";
import { TransactionForm } from "@/components/forms";
import { hrefFor } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import { loadLayout, timingFor, type DashboardLayout } from "@/lib/dashboardLayout";

// Painel V3 (ui.pen §V3): KPI strip mono (5 cards: receitas/despesas/resultado/
// entre-contas/saldo), grid com fluxo de caixa + INSIGHT da IA (dots animados),
// e a tabela dominante de transações recentes com estado (ativa/entre contas).
export function DashboardPage() {
  const [month, setMonth] = useState(currentMonth());
  const [dash, setDash] = useState<MonthlyDashboard | null>(null);
  const [flow, setFlow] = useState<CashFlowHistory | null>(null);
  const [cats, setCats] = useState<CategoryAmount[]>([]);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [layout, setLayout] = useState<DashboardLayout>(() => loadLayout());

  useEffect(() => {
    const onLayout = () => setLayout(loadLayout());
    window.addEventListener("finance:layout-changed", onLayout);
    return () => window.removeEventListener("finance:layout-changed", onLayout);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [d, f, b, t] = await Promise.all([
        api.dashboard(month),
        api.cashFlow(month),
        api.breakdown(month),
        api.transactions(month),
      ]);
      setDash(d);
      setFlow(f);
      setCats(b.categories);
      setRecent((t.transactions ?? []).slice(0, 12));
    } catch (err) {
      setError(err instanceof Error ? err.message : "não consegui carregar");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);
  useAutoRefresh(load, 25);

  const income = Number(dash?.income ?? 0);
  const expense = Math.abs(Number(dash?.expense ?? 0));
  const net = Number(dash?.net ?? 0);
  const savingsRate = income > 0 ? Math.round((net / income) * 100) : 0;
  const ownCounts = recent.filter((t) => t.inactive).length;

  // feed "Ao vivo": rotação pelo timing do widget (personalizável)
  const feedTiming = timingFor(layout, "feed");
  const [feedTick, setFeedTick] = useState(0);
  const feedTimer = useRef<number | null>(null);
  useEffect(() => {
    if (feedTimer.current) window.clearInterval(feedTimer.current);
    if (feedTiming > 0 && recent.length > 6) {
      feedTimer.current = window.setInterval(() => setFeedTick((t) => t + 1), feedTiming * 1000);
    }
    return () => {
      if (feedTimer.current) window.clearInterval(feedTimer.current);
    };
  }, [feedTiming, recent.length]);
  const feedStart = useMemo(() => (recent.length > 6 ? (feedTick * 6) % recent.length : 0), [feedTick, recent.length]);
  const feedWindow = useMemo(
    () => Array.from({ length: Math.min(6, recent.length) }, (_, i) => recent[(feedStart + i) % recent.length]),
    [feedStart, recent],
  );

  const widgetNodes: Record<string, React.ReactNode> = {
    saldo: (
      <Card key="saldo">
        <div className="kick mb-2">
          <button onClick={() => onMonthChange(month, -1)} className="text-fg-dim hover:text-fg" aria-label="mês anterior">←</button>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="hairline mono rounded-full bg-transparent px-2 py-0.5 text-[10.5px]" />
          <button onClick={() => onMonthChange(month, +1)} className="text-fg-dim hover:text-fg" aria-label="próximo mês">→</button>
          <span className="ml-auto pill">{dash?.transaction_count ?? 0} lançamentos</span>
        </div>
        <p className="kick">Saldo do mês</p>
        <p className={cn("mono tnum text-[20px] font-semibold tracking-tight", net >= 0 ? "text-fg" : "text-down")}>
          {formatBRL(String(net), { signed: true })}
        </p>
        <div className="mt-3 bar">
          <i style={{ width: `${Math.min(100, savingsRate)}%`, background: "hsl(var(--up))" }} />
        </div>
        <p className="mt-1.5 text-[10.5px] dim">taxa de sobra {savingsRate}% das receitas</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Kpi label="Receitas" value={formatBRL(String(income))} tone="up" />
          <Kpi label="Despesas" value={formatBRL(String(expense))} tone="down" />
        </div>
      </Card>
    ),
    fluxo: (
      <Card
        key="fluxo"
        title="Fluxo de caixa"
        right={
          <>
            <div className="seg">
              <button data-on="true">20 dias</button>
              <button>8 semanas</button>
            </div>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="hairline mono hidden rounded-full bg-transparent px-2 py-0.5 text-[10.5px] lg:block" />
          </>
        }
      >
        <CashFlowBars points={(flow?.days ?? []).map((d) => ({ label: d.date, value: Number(d.net) }))} height={200} />
      </Card>
    ),
    categorias: (
      <Card key="categorias" title="Despesas por categoria">
        <CategoryBars points={cats.map((c) => ({ label: c.category, value: Number(c.amount) }))} />
      </Card>
    ),
    feed: (
      <Card key="feed" title="Ao vivo" right={<a href={hrefFor({ name: "transactions" })} className="text-[11px] dim hover:text-fg">ver tudo →</a>}>
        {recent.length === 0 ? (
          <Empty text="Nada ainda neste mês." />
        ) : (
          <ul>{feedWindow.map((t) => <FeedRow key={t.id} tx={t} />)}</ul>
        )}
      </Card>
    ),
    timeline: <TimelineWidget key="timeline" count={recent.length} />,
    orcamentos: (
      <Card key="orcamentos" title="Orçamentos" right={<a href={hrefFor({ name: "limits" })} className="text-[11px] dim hover:text-fg">ver →</a>}>
        {dash && dash.budgets.length > 0 ? (
          <div className="space-y-4">
            {dash.budgets.map((b) => {
              const spent = Math.abs(Number(b.spent_amount));
              const limit = Number(b.limit_amount);
              return (
                <div key={b.category}>
                  <div className="flex justify-between text-[11.5px]">
                    <span>{b.category}</span>
                    <span className="mono dim">{formatBRL(b.spent_amount)} / {formatBRL(b.limit_amount)}</span>
                  </div>
                  <div className="mt-1.5"><Progress used={spent} total={limit} /></div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty text="Nenhum orçamento. Defina em Limites." />
        )}
      </Card>
    ),
    meta: <MetaWidget key="meta" savingsRate={savingsRate} />,
    comparativo: <ComparativoWidget key="comparativo" net={net} income={income} expense={expense} />,
  };

  const activeIds = layout.order.filter((id) => layout.widgets[id]?.enabled && widgetNodes[id]);
  const leftWidgets = ["saldo", "orcamentos", "meta", "comparativo"];
  const rightWidgets = ["insight", "categorias", "feed", "timeline"];
  const leftList = activeIds.filter((id) => leftWidgets.includes(id));
  const rightList = activeIds.filter((id) => rightWidgets.includes(id));
  const centerList = activeIds.filter((id) => !leftWidgets.includes(id) && !rightWidgets.includes(id));

  const left = (
    <>
      {leftList.map((id) => (
        <div key={"L" + id}>{widgetNodes[id]}</div>
      ))}
      <Card title="Lançamento rápido">
        <TransactionForm onDone={load} />
      </Card>
    </>
  );

  const center = (
    <div className="flex flex-col gap-4">
      {error && <p className="text-[13px] text-down">{error}</p>}
      {centerList.map((id) => (
        <div key={"C" + id}>{widgetNodes[id]}</div>
      ))}
      {/* DOMINANTE: tabela de transações recentes */}
      {recent.length > 0 && <RecentTable rows={recent} />}
    </div>
  );

  const right = (
    <div className="flex flex-col gap-4">
      {error && <p className="text-[13px] text-down">{error}</p>}
      {/* INSIGHT da IA (dots) */}
      {ownCounts > 0 && (
        <Card className="!p-0 overflow-hidden">
          <div className="hd !mb-0 !p-4 !pb-0 border-0">
            <AiDots width={26} height={24} tone="ok" />
            <p className="min-w-0 text-[13px] font-semibold text-fg">Insight da IA</p>
          </div>
          <div className="px-4 pb-4 pt-2">
            <p className="text-[11.5px] leading-[1.6] text-fg-dim">
              {ownCounts === 1
                ? "Detectei 1 lançamento entre contas suas (mesmo recebedor) e marquei como inativa — saiu de receitas/despesas; os saldos continuam exatos."
                : `Detectei ${ownCounts} lançamentos entre contas suas e marquei como inativos — saíram de receitas/despesas; os saldos continuam exatos.`}
            </p>
            <a href={hrefFor({ name: "transactions" })} className="mt-2.5 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-accent hover:underline">
              revisar na lista →
            </a>
          </div>
        </Card>
      )}
      {rightList.map((id) => (
        <div key={"R" + id}>{widgetNodes[id]}</div>
      ))}
    </div>
  );

  return <Cockpit left={left} center={center} right={right} />;
}

function onMonthChange(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.toISOString().slice(0, 7);
}

// ------------------------------------------------------------ RecentTable V3

function RecentTable({ rows }: { rows: Transaction[] }) {
  return (
    <Card className="!p-0 overflow-hidden">
      <div className="hd !mb-0 border-b border-border px-4 py-3">
        <p className="text-[13px] font-semibold">Transações recentes</p>
        <a href={hrefFor({ name: "transactions" })} className="text-[11px] text-fg-dim hover:text-fg">ver todas →</a>
      </div>
      <div className="mono grid grid-cols-[92px_1fr_104px_96px] items-center gap-3 bg-surface-2 px-4 py-1.5">
        {["data", "lançamento", "valor", "estado"].map((c, i) => (
          <span key={c} className={cn("font-mono text-[8.5px] font-medium uppercase tracking-[0.08em] text-fg-dim", (i === 2) && "text-right", (i === 3) && "text-right")}>
            {c}
          </span>
        ))}
      </div>
      <p className="hidden md:block" aria-hidden>
        {/* recebedor cabe na coluna do nome como subtitle */}
      </p>
      <ul className="max-h-[420px] overflow-y-auto scroll-thin">
        {rows.map((t) => {
          const income = t.transaction_type === "INCOME";
          const own = !!t.inactive;
          return (
            <li key={t.id}>
              <a href={hrefFor({ name: "transaction", id: t.id })} className="grid grid-cols-[92px_1fr_104px_96px] items-center gap-3 border-b border-border px-4 py-2.5 transition-colors hover:bg-surface-2/60 last:border-0">
                <span className="font-mono text-[10px] text-fg-dim">
                  {new Date(t.occurred_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className={cn("size-[5px] shrink-0 rounded-full", own ? "bg-fg-dim" : income ? "bg-up" : "bg-down")} aria-hidden />
                  <span className={cn("min-w-0 truncate text-[12px]", own ? "text-fg-dim" : "text-fg", !own && "font-medium")}>
                    {t.counterparty || t.description || t.category || "Lançamento"}
                    <span className="ml-2 hidden truncate font-normal text-fg-dim lg:inline-block max-w-[180px] align-middle">
                      {t.counterparty ? (t.description || t.category) : ""}
                    </span>
                  </span>
                </span>
                <span className={cn("mono text-right text-[11.5px] font-semibold", own ? "text-fg-dim" : income ? "text-up" : "text-fg")}>
                  {income ? "+" : "−"} {formatBRL(String(Math.abs(Number(t.amount))))}
                </span>
                <span className="text-right">
                  <span className={cn("pill !py-0.5 !px-2 font-mono !text-[8.5px]", own ? "!bg-transparent border border-border" : "")}>
                    <>
                      {own && <span className="dot bg-fg-dim" />}
                      {own ? "entre contas" : "ATIVA"}
                    </>
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------ widgets V3

function TimelineWidget({ count }: { count: number }) {
  return (
    <Card className="!py-0">
      <div className="flex h-11 items-center justify-between gap-3.5 !px-0">
        <span className="font-mono text-[10.5px] text-fg-dim">agora</span>
        <div className="bar flex-1 !h-[5px]"><i style={{ width: `${Math.min(100, count * 6)}%`, background: "hsl(var(--accent))" }} /></div>
        <span className="mono text-[11px] text-fg-dim">{count} lançamentos</span>
      </div>
    </Card>
  );
}

function MetaWidget({ savingsRate }: { savingsRate: number }) {
  const goal = 30;
  return (
    <Card title="Meta de sobra">
      <p className="mono text-[20px] font-semibold">{Math.min(100, savingsRate)}%</p>
      <p className="mb-3 text-[10.5px] dim">meta {goal}% das receitas</p>
      <Progress used={Math.min(100, savingsRate)} total={goal} />
      <p className="mt-2 text-[10.5px] dim">
        {savingsRate >= goal ? "meta batida neste mês 🎯" : `faltam ${goal - savingsRate}pp para a meta`}
      </p>
    </Card>
  );
}

function ComparativoWidget({ net, income, expense }: { net: number; income: number; expense: number }) {
  return (
    <Card title="Comparativo">
      <div className="grid grid-cols-2 gap-3">
        <Kpi label="Receitas" value={formatBRL(String(income))} tone="up" />
        <Kpi label="Despesas" value={formatBRL(String(expense))} tone="down" />
        <Kpi label="Resultado" value={formatBRL(String(net), { signed: true })} />
      </div>
      <p className="mt-3 text-[10.5px] dim">mês em curso · a comparação chega com mais histórico</p>
    </Card>
  );
}

// Linha do feed.
function FeedRow({ tx }: { tx: Transaction }) {
  const income = tx.transaction_type === "INCOME";
  const own = !!tx.inactive;
  return (
    <li>
      <a
        href={hrefFor({ name: "transaction", id: tx.id })}
        className={cn("ev items-center transition-colors hover:bg-surface-2/60", own && "opacity-60")}
      >
        <time>{new Date(tx.occurred_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time>
        <span className={cn("grid size-6 place-items-center rounded-md bg-surface-2", own ? "text-fg-dim" : income ? "text-up" : "text-down")}>
          {income ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
        </span>
        <p className="min-w-0">
          <span className="block truncate text-[12.5px] text-fg">
            {tx.counterparty || tx.description || tx.category || "Lançamento"}
          </span>
          <span className="flex items-center gap-1.5 text-[10.5px] dim">
            {new Date(tx.occurred_at).toLocaleDateString("pt-BR")} · {tx.category || "Outros"}
            <span className={cn("mono ml-auto", own ? "text-fg-dim" : income ? "text-up" : "text-fg")}>
              {income ? "+" : "−"} {formatBRL(String(Math.abs(Number(tx.amount))))}
            </span>
          </span>
        </p>
      </a>
    </li>
  );
}
