import { useCallback, useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, RefreshCw, Search } from "lucide-react";
import { api, currentMonth, formatBRL, type Transaction } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

// O extrato: histórico de transações. O nome do lugar vem do banco
// (counterparty/description); a categoria, do mapeamento da taxonomia. Dá para
// buscar por texto e filtrar por mês.
export function TransactionsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [all, setAll] = useState<Transaction[]>([]);
  const [query, setQuery] = useState("");
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

  const needle = query.trim().toLowerCase();
  const rows = needle
    ? all.filter((t) =>
        [t.counterparty, t.description, t.category, t.external_category]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
    : all;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Extrato</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "carregando…" : `${rows.length} transação(ões)`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
          <Button variant="outline" size="icon" onClick={load} disabled={loading} title="Atualizar">
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por lugar, descrição ou categoria…"
          className="pl-9"
        />
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="divide-y p-0">
          {rows.length === 0 && !loading && (
            <p className="py-10 text-center text-sm text-muted-foreground">
              Nenhuma transação neste mês.
            </p>
          )}
          {rows.map((t) => (
            <Row key={t.id} tx={t} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ tx }: { tx: Transaction }) {
  const income = tx.transaction_type === "INCOME";
  const abs = formatBRL(String(Math.abs(Number(tx.amount))));
  const when = new Date(tx.occurred_at);
  const title = tx.counterparty || tx.description || tx.category || "Lançamento";
  const fromBank = tx.source === "OPEN_FINANCE_SYNC";
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={income ? "text-success" : "text-destructive"}>
        {income ? <ArrowUpRight className="size-5" /> : <ArrowDownRight className="size-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {when.toLocaleDateString("pt-BR")} · {tx.category || "Outros"}
          {fromBank ? " · via Open Finance" : ""}
        </p>
      </div>
      <span className={`tnum shrink-0 text-sm font-semibold ${income ? "text-success" : ""}`}>
        {income ? "+" : "−"} {abs}
      </span>
    </div>
  );
}

// Reexport para o teste/grep achar o tipo usado.
export type { Transaction };
