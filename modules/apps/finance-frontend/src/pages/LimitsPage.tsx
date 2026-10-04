import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Target } from "lucide-react";
import { api, currentMonth, formatBRL, type BudgetStatus } from "@/lib/api";
import { PageHeader, Panel, Empty } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BudgetBar } from "@/components/charts";

const CATEGORIES = ["Alimentação", "Transporte", "Contas", "Lazer", "Saúde", "Educação", "Moradia", "Compras", "Renda Extra", "Outros"];

function toDecimal(raw: string): string | null {
  const clean = raw.trim().replace(/\s/g, "");
  const n = clean.includes(",") && clean.includes(".") ? clean.replace(/\./g, "").replace(",", ".") : clean.replace(",", ".");
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v.toFixed(2) : null;
}

// Limites (orçamentos) por categoria e mês, com as réguas 50/80/100%.
export function LimitsPage() {
  const [month, setMonth] = useState(currentMonth());
  const [budgets, setBudgets] = useState<BudgetStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const d = await api.dashboard(month);
      setBudgets(d.budgets ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "não consegui carregar os limites");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <PageHeader
        eyebrow="controle"
        title="Limites"
        description="Orçamento por categoria, com avisos em 50%, 80% e 100%."
        action={
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 text-[13px]" />
        }
      />

      {error && <p className="mb-4 text-[13px] text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <Panel title="Limites do mês">
          {budgets.length === 0 && !loading ? (
            <Empty text="Nenhum limite definido neste mês." />
          ) : (
            <div className="space-y-5">
              {budgets.map((b) => {
                const spent = Math.abs(Number(b.spent_amount));
                const limit = Number(b.limit_amount);
                const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
                return (
                  <div key={b.category} className="space-y-1.5">
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="flex items-center gap-2">
                        <Target className="size-3.5 text-muted-foreground" />
                        {b.category}
                      </span>
                      <span className="tnum text-muted-foreground">
                        {formatBRL(String(spent))} / {formatBRL(b.limit_amount)} · {pct}%
                      </span>
                    </div>
                    <BudgetBar spent={spent} limit={limit} />
                    {b.thresholds_reached?.length > 0 && (
                      <p className="text-[11px] text-warning">réguas: {b.thresholds_reached.map((t) => `${t}%`).join(", ")}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <BudgetForm month={month} onDone={load} />
      </div>
    </div>
  );
}

function BudgetForm({ month, onDone }: { month: string; onDone: () => void }) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = toDecimal(limit);
    if (!value) return setMsg({ ok: false, text: "Informe um limite maior que zero." });
    setBusy(true);
    setMsg(null);
    try {
      await api.setBudget({ category, limit: value, period: month });
      setLimit("");
      setMsg({ ok: true, text: "Limite salvo." });
      onDone();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "não consegui salvar" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Novo limite">
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label>Categoria</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Limite (R$)</Label>
          <Input inputMode="decimal" placeholder="600,00" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
        {msg && <p className={msg.ok ? "text-[13px] text-success" : "text-[13px] text-destructive"}>{msg.text}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? <Loader2 className="animate-spin" /> : <Plus />} Definir limite
        </Button>
        <p className="text-[11px] text-muted-foreground">Vale para {month}. Repetir o mesmo mês atualiza o valor.</p>
      </form>
    </Panel>
  );
}
