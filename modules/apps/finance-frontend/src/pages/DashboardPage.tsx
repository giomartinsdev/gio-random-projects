import { useCallback, useEffect, useMemo, useState } from "react";
import { GripVertical, Plus, RotateCcw, X } from "lucide-react";
import {
  api,
  currentMonth,
  formatBRL,
  type CashFlowHistory,
  type CategoryAmount,
  type MonthlyDashboard,
} from "@/lib/api";
import { BudgetBar, CashFlowBars, CategoryBars } from "@/components/charts";
import { PageHeader, Panel, Stat, Empty } from "@/components/primitives";
import { TransactionForm } from "@/components/forms";
import { cn } from "@/lib/utils";

// Widgets do dashboard. O usuário ESCOLHE quais aparecem e em que ordem — a
// preferência fica em localStorage (não é dado de negócio). Arrastar reordena.
type WidgetId = "summary" | "cashflow" | "categories" | "budgets" | "quick";
const WIDGETS: { id: WidgetId; label: string }[] = [
  { id: "summary", label: "Resumo do mês" },
  { id: "cashflow", label: "Fluxo de caixa" },
  { id: "categories", label: "Despesas por categoria" },
  { id: "budgets", label: "Orçamentos" },
  { id: "quick", label: "Lançamento rápido" },
];
const STORAGE = "finance:dashboard-widgets";
const DEFAULT_ORDER: WidgetId[] = ["summary", "cashflow", "categories", "budgets", "quick"];

function loadPrefs(): WidgetId[] {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) {
      const parsed = JSON.parse(raw) as WidgetId[];
      const valid = parsed.filter((w) => WIDGETS.some((x) => x.id === w));
      if (valid.length) return valid;
    }
  } catch {
    /* storage indisponível: usa o default */
  }
  return DEFAULT_ORDER;
}

export function DashboardPage() {
  const [month, setMonth] = useState(currentMonth());
  const [order, setOrder] = useState<WidgetId[]>(loadPrefs);
  const [editing, setEditing] = useState(false);
  const [dash, setDash] = useState<MonthlyDashboard | null>(null);
  const [flow, setFlow] = useState<CashFlowHistory | null>(null);
  const [breakdown, setBreakdown] = useState<CategoryAmount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [d, f, b] = await Promise.all([api.dashboard(month), api.cashFlow(month), api.breakdown(month)]);
      setDash(d);
      setFlow(f);
      setBreakdown(b.categories);
    } catch (err) {
      setError(err instanceof Error ? err.message : "não consegui carregar");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  const saveOrder = (next: WidgetId[]) => {
    setOrder(next);
    try {
      localStorage.setItem(STORAGE, JSON.stringify(next));
    } catch {
      /* a escolha só não sobrevive ao reload */
    }
  };

  const removeWidget = (id: WidgetId) => saveOrder(order.filter((w) => w !== id));
  const addWidget = (id: WidgetId) => saveOrder([...order, id]);
  const resetWidgets = () => saveOrder(DEFAULT_ORDER);

  const hidden = WIDGETS.filter((w) => !order.includes(w.id));

  return (
    <div>
      <PageHeader
        eyebrow="visão geral"
        title="Dashboard"
        description="Seu mês em números. Personalize os blocos abaixo."
        action={
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-[13px]"
            />
            <button
              onClick={() => setEditing((e) => !e)}
              className={cn(
                "h-9 rounded-md px-3 text-[13px] transition-colors",
                editing ? "bg-primary text-primary-foreground" : "border border-border hover:bg-secondary",
              )}
            >
              {editing ? "Concluir" : "Personalizar"}
            </button>
          </div>
        }
      />

      {editing && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-3">
          <span className="eyebrow">adicionar bloco</span>
          {hidden.length === 0 && <span className="text-[13px] text-muted-foreground">todos visíveis</span>}
          {hidden.map((w) => (
            <button
              key={w.id}
              onClick={() => addWidget(w.id)}
              className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-[13px] hover:bg-secondary"
            >
              <Plus className="size-3.5" /> {w.label}
            </button>
          ))}
          <button onClick={resetWidgets} className="ml-auto inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            <RotateCcw className="size-3.5" /> Restaurar
          </button>
        </div>
      )}

      {error && <p className="mb-4 text-[13px] text-destructive">{error}</p>}

      <WidgetGrid
        order={order}
        editing={editing}
        onReorder={saveOrder}
        onRemove={removeWidget}
        render={(id) => {
          switch (id) {
            case "summary":
              return (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Stat label="Receitas" value={formatBRL(dash?.income ?? "0")} tone="income" />
                  <Stat label="Despesas" value={formatBRL(String(Math.abs(Number(dash?.expense ?? "0"))))} tone="expense" />
                  <Stat label="Saldo" value={formatBRL(dash?.net ?? "0", { signed: true })} />
                </div>
              );
            case "cashflow":
              return (
                <Panel title="Fluxo de caixa">
                  <CashFlowBars points={(flow?.days ?? []).map((d) => ({ label: d.date, value: Number(d.net) }))} />
                </Panel>
              );
            case "categories":
              return (
                <Panel title="Despesas por categoria">
                  <CategoryBars points={breakdown.map((c) => ({ label: c.category, value: Number(c.amount) }))} />
                </Panel>
              );
            case "budgets":
              return (
                <Panel title="Orçamentos">
                  {dash && dash.budgets.length > 0 ? (
                    <div className="space-y-4">
                      {dash.budgets.map((b) => (
                        <div key={b.category} className="space-y-1.5">
                          <div className="flex justify-between text-[13px]">
                            <span>{b.category}</span>
                            <span className="tnum text-muted-foreground">
                              {formatBRL(b.spent_amount)} / {formatBRL(b.limit_amount)}
                            </span>
                          </div>
                          <BudgetBar spent={Number(b.spent_amount)} limit={Number(b.limit_amount)} />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty text="Nenhum orçamento definido neste mês." />
                  )}
                </Panel>
              );
            case "quick":
              return <TransactionForm onDone={load} />;
          }
        }}
      />

      {loading && <p className="mt-4 text-center text-[13px] text-muted-foreground">carregando…</p>}
    </div>
  );
}

// Renderiza os widgets na ordem escolhida; em modo edição habilita remover e
// arrastar para reordenar.
function WidgetGrid({
  order,
  editing,
  onReorder,
  onRemove,
  render,
}: {
  order: WidgetId[];
  editing: boolean;
  onReorder: (next: WidgetId[]) => void;
  onRemove: (id: WidgetId) => void;
  render: (id: WidgetId) => React.ReactNode;
}) {
  const [drag, setDrag] = useState<WidgetId | null>(null);
  const gridCls = useMemo(
    () => "grid grid-cols-1 gap-4",
    [],
  );
  return (
    <div className={gridCls}>
      {order.map((id) => (
        <div
          key={id}
          draggable={editing}
          onDragStart={() => setDrag(id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (!drag || drag === id) return;
            const next = order.filter((w) => w !== drag);
            next.splice(next.indexOf(id), 0, drag);
            onReorder(next);
            setDrag(null);
          }}
          className={cn("relative", editing && "rounded-lg ring-1 ring-dashed ring-border")}
        >
          {editing && (
            <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
              <span className="cursor-grab rounded-md bg-card p-1 text-muted-foreground">
                <GripVertical className="size-4" />
              </span>
              <button
                onClick={() => onRemove(id)}
                className="rounded-md bg-card p-1 text-muted-foreground hover:text-destructive"
                title="Remover bloco"
              >
                <X className="size-4" />
              </button>
            </div>
          )}
          {render(id)}
        </div>
      ))}
    </div>
  );
}
