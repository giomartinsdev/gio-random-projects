import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Target } from "lucide-react";
import { api, currentMonth, formatBRL, type BudgetStatus } from "@/lib/api";
import { Card, Cockpit, Empty, PageHead, Progress } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const CATEGORIES = ["Alimentação", "Transporte", "Contas", "Lazer", "Saúde", "Educação", "Moradia", "Compras", "Renda Extra", "Outros"];

function toDecimal(raw: string): string | null {
  const clean = raw.trim().replace(/\s/g, "");
  const n = clean.includes(",") && clean.includes(".") ? clean.replace(/\./g, "").replace(",", ".") : clean.replace(",", ".");
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v.toFixed(2) : null;
}

// Limites no formato cockpit: centro com os limites do mês (barra + réguas),
// rail direito com o formulário de novo limite.
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

  const center = (
    <div className="space-y-3">
      <PageHead
        kick="controle"
        title="Limites"
        sub="Orçamento por categoria, com avisos em 50%, 80% e 100%."
        right={<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="hairline rounded-full bg-transparent px-3 py-1.5 text-[12px]" />}
      />
      {error && <p className="text-[13px] text-down">{error}</p>}
      <Card>
        {budgets.length === 0 && !loading ? (
          <Empty text="Nenhum limite definido neste mês." />
        ) : (
          <div className="space-y-5">
            {budgets.map((b) => {
              const spent = Math.abs(Number(b.spent_amount));
              const limit = Number(b.limit_amount);
              const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
              return (
                <div key={b.category}>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="flex items-center gap-2"><Target className="size-3.5 dim" /> {b.category}</span>
                    <span className="tnum dim">{formatBRL(String(spent))} / {formatBRL(b.limit_amount)} · {pct}%</span>
                  </div>
                  <div className="mt-1.5"><Progress used={spent} total={limit} /></div>
                  {b.thresholds_reached?.length > 0 && (
                    <p className="mt-1 text-[11px] text-warn">réguas: {b.thresholds_reached.map((t) => `${t}%`).join(", ")}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );

  const right = <BudgetForm month={month} onDone={load} />;

  return <Cockpit center={center} right={right} />;
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
    <Card title="Novo limite">
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <Label>Categoria</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Limite (R$)</Label>
          <Input inputMode="decimal" placeholder="600,00" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
        {msg && <p className={msg.ok ? "text-[13px] text-success" : "text-[13px] text-down"}>{msg.text}</p>}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? <Loader2 className="animate-spin" /> : <Plus />} Definir limite
        </Button>
        <p className="text-[11px] dim">Vale para {month}. Repetir o mesmo mês atualiza.</p>
      </form>
    </Card>
  );
}
