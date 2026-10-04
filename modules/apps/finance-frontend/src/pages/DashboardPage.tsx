import { useCallback, useEffect, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { api, currentMonth, formatBRL, type CashFlowHistory, type CategoryAmount, type MonthlyDashboard, type Transaction } from "@/lib/api";
import { Card, Cockpit, Empty, Kpi, Progress } from "@/components/primitives";
import { CashFlowBars, CategoryBars } from "@/components/charts";
import { TransactionForm } from "@/components/forms";
import { hrefFor } from "@/lib/router";
import { cn } from "@/lib/utils";

// O painel no formato cockpit: rail esquerdo com o card herói (receitas/
// despesas/saldo + KPIs), centro com o fluxo de caixa e o feed dos últimos
// lançamentos, rail direito com as categorias e os orçamentos. Tudo clicável.
export function DashboardPage() {
  const [month, setMonth] = useState(currentMonth());
  const [dash, setDash] = useState<MonthlyDashboard | null>(null);
  const [flow, setFlow] = useState<CashFlowHistory | null>(null);
  const [cats, setCats] = useState<CategoryAmount[]>([]);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  const left = (
    <>
      <Card>
        <div className="kick mb-2">
          <span>{monthLabel(month)}</span>
          <span className="ml-auto pill">{dash?.transaction_count ?? 0} lançamentos</span>
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
      </Card>

      <Card title="Orçamentos" right={<a href={hrefFor({ name: "limits" })} className="text-[12px] dim hover:text-fg">ver →</a>}>
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
    </>
  );

  const center = (
    <div className="space-y-3">
      <Card
        title="Fluxo de caixa"
        right={
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="hairline rounded-full bg-transparent px-3 py-1 text-[12px]"
          />
        }
      >
        <CashFlowBars points={(flow?.days ?? []).map((d) => ({ label: d.date, value: Number(d.net) }))} height={260} />
      </Card>

      <Card title="Últimos lançamentos" right={<a href={hrefFor({ name: "transactions" })} className="text-[12px] dim hover:text-fg">ver tudo →</a>}>
        {recent.length === 0 ? (
          <Empty text="Nada ainda neste mês." />
        ) : (
          <ul>
            {recent.map((t) => <FeedRow key={t.id} tx={t} />)}
          </ul>
        )}
      </Card>

      <Card title="Lançamento rápido">
        <TransactionForm onDone={load} />
      </Card>
    </div>
  );

  const right = (
    <>
      <Card title="Despesas por categoria">
        <CategoryBars points={cats.map((c) => ({ label: c.category, value: Number(c.amount) }))} />
      </Card>
    </>
  );

  return (
    <>
      {error && <p className="p-3 text-[13px] text-down">{error}</p>}
      <Cockpit left={left} center={center} right={right} />
    </>
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
        <span className={cn("flex size-5 items-center justify-center rounded-md", income ? "bg-up/15 text-up" : "bg-down/15 text-down")}>
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
