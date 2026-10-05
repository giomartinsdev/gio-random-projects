import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { api, currentMonth, formatBRL, type CashFlowHistory, type CategoryAmount, type MonthlyDashboard, type Transaction } from "@/lib/api";
import { Card, Cockpit, Empty, Kpi, Progress } from "@/components/primitives";
import { CashFlowBars, CategoryBars } from "@/components/charts";
import { TransactionForm } from "@/components/forms";
import { hrefFor } from "@/lib/router";
import { cn } from "@/lib/utils";
import { loadLayout, timingFor, type DashboardLayout } from "@/lib/dashboardLayout";

// O painel no formato cockpit. A HOME É CUSTOMIZÁVEL: os widgets (saldo, fluxo,
// categorias, feed, timeline, orçamentos, meta, comparativo) são ligados/
// desligados e reordenados em #/personalize; o timing de rotação é global
// (aplicável a todos) com exceção para widgets fixados (pin).
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

  const income = Number(dash?.income ?? 0);
  const expense = Math.abs(Number(dash?.expense ?? 0));
  const net = Number(dash?.net ?? 0);
  const savingsRate = income > 0 ? Math.round((net / income) * 100) : 0;

  // Widget "Ao vivo": alterna o destaque com o timing do layout (com carrossel
  // leve entre os últimos lançamentos para widgets com timing próprio).
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
      <SaldoWidget
        key="saldo"
        monthLabel={monthLabel(month)}
        count={dash?.transaction_count ?? 0}
        net={net}
        savingsRate={savingsRate}
        income={income}
        expense={expense}
        month={month}
        onMonth={setMonth}
      />
    ),
    fluxo: (
      <Card key="fluxo" title="Fluxo de caixa" right={
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="hairline rounded-full bg-transparent px-3 py-1 text-[12px]" />
      }>
        <CashFlowBars points={(flow?.days ?? []).map((d) => ({ label: d.date, value: Number(d.net) }))} height={240} />
      </Card>
    ),
    categorias: (
      <Card key="categorias" title="Despesas por categoria">
        <CategoryBars points={cats.map((c) => ({ label: c.category, value: Number(c.amount) }))} />
      </Card>
    ),
    feed: (
      <Card key="feed" title="Ao vivo" right={<a href={hrefFor({ name: "transactions" })} className="text-[12px] dim hover:text-fg">ver tudo →</a>}>
        {recent.length === 0 ? (
          <Empty text="Nada ainda neste mês." />
        ) : (
          <ul>{feedWindow.map((t) => <FeedRow key={t.id} tx={t} />)}</ul>
        )}
      </Card>
    ),
    timeline: <TimelineWidget key="timeline" count={recent.length} />,
    orcamentos: (
      <Card key="orcamentos" title="Orçamentos" right={<a href={hrefFor({ name: "limits" })} className="text-[12px] dim hover:text-fg">ver →</a>}>
        {dash && dash.budgets.length > 0 ? (
          <div className="space-y-4">
            {dash.budgets.map((b) => {
              const spent = Math.abs(Number(b.spent_amount));
              const limit = Number(b.limit_amount);
              return (
                <div key={b.category}>
                  <div className="flex justify-between text-[12px]">
                    <span>{b.category}</span>
                    <span className="tnum dim">{formatBRL(b.spent_amount)} / {formatBRL(b.limit_amount)}</span>
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
  const rightWidgets = ["categorias", "feed", "timeline"];
  const leftList = activeIds.filter((id) => leftWidgets.includes(id));
  const rightList = activeIds.filter((id) => rightWidgets.includes(id));
  const centerList = activeIds.filter((id) => !leftWidgets.includes(id) && !rightWidgets.includes(id));

  const left = (
    <>
      {leftList.map((id) => (
        <div key={"L" + id} data-timing={timingFor(layout, id)}>{widgetNodes[id]}</div>
      ))}
      <Card title="Lançamento rápido"><TransactionForm onDone={load} /></Card>
    </>
  );

  const center = (
    <div className="space-y-3">
      {error && <p className="text-[13px] text-down">{error}</p>}
      {centerList.map((id) => (
        <div key={"C" + id} data-timing={timingFor(layout, id)}>{widgetNodes[id]}</div>
      ))}
    </div>
  );

  const right = rightList.length > 0 || error ? (
    <div className="space-y-3">
      {error && <p className="text-[13px] text-down">{error}</p>}
      {rightList.map((id) => (
        <div key={"R" + id} data-timing={timingFor(layout, id)}>{widgetNodes[id]}</div>
      ))}
    </div>
  ) : (
    <div className="space-y-3">
      {error && <p className="text-[13px] text-down">{error}</p>}
    </div>
  );

  return <Cockpit left={left} center={center} right={right} />;
}

// -- widgets ----------------------------------------------------------------

function SaldoWidget({ monthLabel, count, net, savingsRate, income, expense, month, onMonth }: {
  monthLabel: string; count: number; net: number; savingsRate: number; income: number; expense: number; month: string; onMonth: (m: string) => void;
}) {
  return (
    <Card>
      <div className="kick mb-2">
        <button onClick={() => onMonth(prevMonth(month))} className="text-fg-dim hover:text-fg" aria-label="mês anterior">←</button>
        <input type="month" value={month} onChange={(e) => onMonth(e.target.value)} className="hairline rounded-full bg-transparent px-2 py-0.5 text-[11px]" />
        <button onClick={() => onMonth(nextMonth(month))} className="text-fg-dim hover:text-fg" aria-label="próximo mês">→</button>
        <span className="ml-auto pill">{count} lançamentos</span>
      </div>
      <p className="kick">Saldo do mês</p>
      <p className={cn("fig tnum", net >= 0 ? "text-fg" : "text-down")}>{formatBRL(String(net), { signed: true })}</p>
      <div className="mt-3 bar">
        <i style={{ width: `${Math.min(100, savingsRate)}%`, background: "hsl(var(--up))" }} />
      </div>
      <p className="mt-1.5 text-[11px] dim">taxa de sobra {savingsRate}% das receitas</p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Kpi label="Receitas" value={formatBRL(String(income))} tone="up" />
        <Kpi label="Despesas" value={formatBRL(String(expense))} tone="down" />
      </div>
      <p className="mt-2 hidden text-[11px] dim sm:block">{monthLabel}</p>
    </Card>
  );
}

function TimelineWidget({ count }: { count: number }) {
  return (
    <div className="card flex h-11 items-center gap-3.5 !p-0 px-4">
      <span className="font-mono text-[11px] text-fg-dim">agora</span>
      <div className="bar flex-1"><i style={{ width: `${Math.min(100, count * 6)}%`, background: "hsl(var(--accent))" }} /></div>
      <span className="text-[12px] dim">{count} lançamentos</span>
    </div>
  );
}

function MetaWidget({ savingsRate }: { savingsRate: number }) {
  const goal = 30;
  return (
    <Card title="Meta de sobra">
      <p className="fig tnum">{Math.min(100, savingsRate)}%</p>
      <p className="mb-3 text-[11px] dim">meta {goal}% das receitas</p>
      <Progress used={Math.min(100, savingsRate)} total={goal} />
      <p className="mt-2 text-[11px] dim">
        {savingsRate >= goal ? "meta batida neste mês" : `faltam ${goal - savingsRate}pp para a meta`}
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
      <p className="mt-3 text-[11px] dim">mês em curso · comparação com o anterior chega com mais histórico</p>
    </Card>
  );
}

// Linha do feed: hora + ícone + texto + valor (o `.ev` do original).
function FeedRow({ tx }: { tx: Transaction }) {
  const income = tx.transaction_type === "INCOME";
  return (
    <li>
      <a
        href={hrefFor({ name: "transaction", id: tx.id })}
        className="ev items-center transition-colors hover:bg-fg/4"
      >
        <time>{new Date(tx.occurred_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</time>
        <span className={cn("flex size-5 items-center justify-center rounded-md bg-surface-2", income ? "text-up" : "text-down")}>
          {income ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
        </span>
        <p className="min-w-0">
          <span className="block truncate text-[12.5px]">{tx.counterparty || tx.description || tx.category || "Lançamento"}</span>
          <span className="flex items-center gap-1.5 text-[11px] dim">
            {new Date(tx.occurred_at).toLocaleDateString("pt-BR")} · {tx.category || "Outros"}
            <span className={cn("tnum ml-auto", income ? "text-up" : "text-fg")}>
              {income ? "+" : "−"} {formatBRL(String(Math.abs(Number(tx.amount))))}
            </span>
          </span>
        </p>
      </a>
    </li>
  );
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 2, 1).toISOString().slice(0, 7);
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 1).toISOString().slice(0, 7);
}