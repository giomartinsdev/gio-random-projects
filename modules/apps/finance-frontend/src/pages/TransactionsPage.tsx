import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Search } from "lucide-react";
import { api, currentMonth, formatBRL, type Transaction } from "@/lib/api";
import { PageHeader, Panel, Empty } from "@/components/primitives";
import { Input } from "@/components/ui/input";
import { hrefFor } from "@/lib/router";
import { cn } from "@/lib/utils";

type Filter = "all" | "INCOME" | "EXPENSE";

// Lista densa de transações, com busca e filtros. Cada linha é clicável e leva
// ao detalhe profundo.
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
      setError(err instanceof Error ? err.message : "não consegui carregar o extrato");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return all.filter((t) => {
      if (filter !== "all" && t.transaction_type !== filter) return false;
      if (!needle) return true;
      return [t.counterparty, t.description, t.category, t.external_category]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [all, query, filter]);

  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const t of rows) {
      const v = Number(t.amount);
      if (t.transaction_type === "INCOME") income += v;
      else expense += Math.abs(v);
    }
    return { income, expense };
  }, [rows]);

  return (
    <div>
      <PageHeader
        eyebrow="movimentações"
        title="Transações"
        description={loading ? "carregando…" : `${rows.length} lançamentos`}
        action={
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar lugar, descrição, categoria…" className="pl-9" />
        </div>
        <div className="flex gap-1">
          {(["all", "INCOME", "EXPENSE"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-3 py-1.5 text-[13px] transition-colors",
                filter === f ? "bg-primary text-primary-foreground" : "border border-border hover:bg-secondary",
              )}
            >
              {f === "all" ? "Tudo" : f === "INCOME" ? "Entradas" : "Saídas"}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-4 text-[13px]">
          <span className="text-success">+ {formatBRL(String(totals.income))}</span>
          <span className="text-destructive">− {formatBRL(String(totals.expense))}</span>
        </div>
      </div>

      {error && <p className="mb-4 text-[13px] text-destructive">{error}</p>}

      <Panel className="p-0">
        {rows.length === 0 && !loading ? (
          <Empty text="Nenhuma transação encontrada." />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((t) => (
              <li key={t.id}>
                <a
                  href={hrefFor({ name: "transaction", id: t.id })}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-secondary"
                >
                  <span className={cn("[&_svg]:size-4", t.transaction_type === "INCOME" ? "text-success" : "text-destructive")}>
                    {t.transaction_type === "INCOME" ? <ArrowUpRight /> : <ArrowDownRight />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{t.counterparty || t.description || t.category || "Lançamento"}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {new Date(t.occurred_at).toLocaleDateString("pt-BR")} · {t.category || "Outros"}
                      {t.source === "OPEN_FINANCE_SYNC" ? " · banco" : ""}
                    </p>
                  </div>
                  <span className={cn("tnum shrink-0 text-[13px]", t.transaction_type === "INCOME" && "text-success")}>
                    {t.transaction_type === "INCOME" ? "+" : "−"} {formatBRL(String(Math.abs(Number(t.amount))))}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
