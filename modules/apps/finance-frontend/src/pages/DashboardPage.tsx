import { useCallback, useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, RefreshCw, Scale } from "lucide-react";
import {
  api,
  currentMonth,
  formatBRL,
  type CashFlowHistory,
  type CategoryAmount,
  type MonthlyDashboard,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BudgetBar, CashFlowBars, CategoryBars } from "@/components/charts";
import { TransactionForm, BudgetForm } from "@/components/forms";

export function DashboardPage() {
  const [month, setMonth] = useState(currentMonth());
  const [dash, setDash] = useState<MonthlyDashboard | null>(null);
  const [flow, setFlow] = useState<CashFlowHistory | null>(null);
  const [breakdown, setBreakdown] = useState<CategoryAmount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [d, f, b] = await Promise.all([
        api.dashboard(month),
        api.cashFlow(month),
        api.breakdown(month),
      ]);
      setDash(d);
      setFlow(f);
      setBreakdown(b.categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : "não consegui carregar seus dados");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Painel</h1>
          <p className="text-sm text-muted-foreground">Seus gastos, atualizados.</p>
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Receitas" value={dash?.income ?? "0.00"} tone="income" icon={<ArrowUpRight />} />
        <Stat label="Despesas" value={dash?.expense ?? "0.00"} tone="expense" icon={<ArrowDownRight />} />
        <Stat label="Saldo" value={dash?.net ?? "0.00"} tone="net" icon={<Scale />} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fluxo de caixa</CardTitle>
          </CardHeader>
          <CardContent>
            <CashFlowBars
              points={(flow?.days ?? []).map((d) => ({ label: d.date, value: Number(d.net) }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Despesas por categoria</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryBars
              points={breakdown.map((c) => ({ label: c.category, value: Number(c.amount) }))}
            />
          </CardContent>
        </Card>
      </div>

      {dash && dash.budgets.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Orçamentos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {dash.budgets.map((b) => (
              <div key={b.category} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{b.category}</span>
                  <span className="tnum text-muted-foreground">
                    {formatBRL(b.spent_amount)} / {formatBRL(b.limit_amount)}
                  </span>
                </div>
                <BudgetBar spent={Number(b.spent_amount)} limit={Number(b.limit_amount)} />
                <div className="flex gap-1.5">
                  {(b.thresholds_reached ?? []).map((t) => (
                    <Badge key={t} variant={t >= 100 ? "destructive" : t >= 80 ? "warning" : "default"}>
                      {t}%
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TransactionForm onDone={load} />
        <BudgetForm onDone={load} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone: "income" | "expense" | "net";
  icon: React.ReactNode;
}) {
  // Despesas vêm negativas do domínio; mostramos em módulo, com o sinal pelo
  // rótulo/cor. Saldo mantém o sinal.
  const shown = tone === "expense" ? formatBRL(String(Math.abs(Number(value)))) : formatBRL(value, { signed: tone === "net" });
  const toneClass =
    tone === "income"
      ? "text-success"
      : tone === "expense"
        ? "text-destructive"
        : Number(value) >= 0
          ? "text-foreground"
          : "text-destructive";
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`tnum text-lg font-semibold ${toneClass}`}>{shown}</p>
        </div>
        <span className={`[&_svg]:size-5 ${toneClass}`}>{icon}</span>
      </CardContent>
    </Card>
  );
}
