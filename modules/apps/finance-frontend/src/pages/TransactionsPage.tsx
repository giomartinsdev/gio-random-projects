import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Search } from "lucide-react";
import { api, currentMonth, formatBRL, type Transaction } from "@/lib/api";
import { Card, Cockpit, Empty, Kpi, PageHead } from "@/components/primitives";
import { CategoryBars } from "@/components/charts";
import { Input } from "@/components/ui/input";
import { hrefFor } from "@/lib/router";
import { cn } from "@/lib/utils";
import { useAutoRefresh } from "@/lib/useAutoRefresh";

type Filter = "all" | "INCOME" | "EXPENSE";

// Cockpit de transações: rail esquerdo com filtros e totais, centro com a lista
// densa (cada linha abre o detalhe), rail direito com a quebra por categoria.
export function TransactionsPage({ month: initialMonth }: { month?: string }) {
  const [month, setMonth] = useState(initialMonth ?? currentMonth());
  const [all, setAll] = useState<Transaction[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.transactions(month);
      setAll(res.transactions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "não consegui carregar");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  // tempo real: a compra do momento entra na lista em segundos após o sync
  useAutoRefresh(load, 20);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all.filter((t) => {
      if (filter !== "all" && t.transaction_type !== filter) return false;
      if (!needle) return true;
      return [t.counterparty, t.description, t.category, t.external_category].join(" ").toLowerCase().includes(needle);
    });
  }, [all, query, filter]);

  const totals = useMemo(() => {
    let income = 0, expense = 0;
    for (const t of rows) {
      const v = Number(t.amount);
      if (t.transaction_type === "INCOME") income += v;
      else expense += Math.abs(v);
    }
    return { income, expense };
  }, [rows]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of rows) {
      if (t.transaction_type === "INCOME") continue;
      map.set(t.category || "Outros", (map.get(t.category || "Outros") ?? 0) + Math.abs(Number(t.amount)));
    }
    return [...map.entries()].map(([label, value]) => ({ label, value: -value })).sort((a, b) => a.value - b.value);
  }, [rows]);

  const left = (
    <Card title="Filtros">
      <div className="seg mb-3 w-full">
        {(["all", "INCOME", "EXPENSE"] as Filter[]).map((f) => (
          <button key={f} data-on={filter === f} onClick={() => setFilter(f)} className="flex-1 justify-center">
            {f === "all" ? "Tudo" : f === "INCOME" ? "Entradas" : "Saídas"}
          </button>
        ))}
      </div>
      <input
        type="month"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
        className="hairline mb-4 w-full rounded-full bg-transparent px-3 py-1.5 text-[12px]"
      />
      <div className="grid grid-cols-2 gap-3">
        <Kpi label="Entradas" value={formatBRL(String(totals.income))} tone="up" />
        <Kpi label="Saídas" value={formatBRL(String(totals.expense))} tone="down" />
      </div>
      <div className="mt-3">
        <Kpi label="Resultado" value={formatBRL(String(totals.income - totals.expense), { signed: true })} />
      </div>
    </Card>
  );

  const center = (
    <div className="space-y-3">
      <PageHead
        kick="movimentações"
        title="Transações"
        sub={loading ? "carregando…" : `${rows.length} lançamentos`}
      />
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-fg-dim" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar lugar, descrição, categoria…" className="hairline rounded-full bg-transparent pl-9" />
      </div>
      {error && <p className="text-[13px] text-down">{error}</p>}
      <Card className="p-0">
        {rows.length === 0 && !loading ? (
          <Empty text="Nenhuma transação encontrada." />
        ) : (
          <ul>
            {rows.map((t) => (
              <li key={t.id}>
                <a href={hrefFor({ name: "transaction", id: t.id })} className="row px-4 hover:bg-fg/4">
                  <span className={cn("flex size-6 items-center justify-center rounded-md", t.transaction_type === "INCOME" ? "bg-up/15 text-up" : "bg-down/15 text-down")}>
                    {t.transaction_type === "INCOME" ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px]">{t.counterparty || t.description || t.category || "Lançamento"}</span>
                    <span className="block truncate text-[11px] dim">
                      {new Date(t.occurred_at).toLocaleDateString("pt-BR")} · {t.category || "Outros"}
                      {t.source === "OPEN_FINANCE_SYNC" ? " · banco" : ""}
                    </span>
                  </span>
                  <span className={cn("tnum text-[13px]", t.transaction_type === "INCOME" && "text-up")}>
                    {t.transaction_type === "INCOME" ? "+" : "−"} {formatBRL(String(Math.abs(Number(t.amount))))}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );

  const right = (
    <Card title="Por categoria">
      <CategoryBars points={byCategory} />
    </Card>
  );

  return <Cockpit left={left} center={center} right={right} />;
}
