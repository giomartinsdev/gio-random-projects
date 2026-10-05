// Layout customizável da home (widgets da tela Painel) — espelha a tela
// "Personalizar" do ui.pen: widgets com on/off e ordem (arrastar), timing global
// aplicável a todos e timing próprio para widgets fixados (pin).

export interface WidgetDef {
  id: string;
  name: string;
  description: string;
  icon: "layout-dashboard" | "bar-chart-3" | "pie-chart" | "activity" | "sliders-horizontal" | "credit-card" | "target" | "git-compare";
}

export const WIDGET_DEFS: WidgetDef[] = [
  { id: "saldo", name: "Saldo do mês", description: "valor grande em serifa + régua de sobra", icon: "layout-dashboard" },
  { id: "fluxo", name: "Fluxo de caixa", description: "barras de entradas/saídas por dia", icon: "bar-chart-3" },
  { id: "categorias", name: "Categorias", description: "top gastos com barras", icon: "pie-chart" },
  { id: "feed", name: "Ao vivo", description: "feed de transações em tempo real", icon: "activity" },
  { id: "timeline", name: "Timeline", description: "linha do tempo do mês", icon: "sliders-horizontal" },
  { id: "orcamentos", name: "Orçamentos", description: "limites e consumo por categoria", icon: "credit-card" },
  { id: "meta", name: "Meta de sobra", description: "progresso da meta do mês", icon: "target" },
  { id: "comparativo", name: "Comparativo", description: "mês atual vs. anterior", icon: "git-compare" },
];

export interface WidgetState {
  id: string;
  enabled: boolean;
  pinned?: boolean;
  timingSec?: number; // só quando pinned
}

export interface DashboardLayout {
  order: string[];
  widgets: Record<string, WidgetState>;
  globalTimingSec: number;
}

export const DEFAULT_ENABLED = ["saldo", "fluxo", "categorias", "feed", "timeline"];

export function defaultLayout(): DashboardLayout {
  const widgets: Record<string, WidgetState> = {};
  for (const w of WIDGET_DEFS) {
    widgets[w.id] = { id: w.id, enabled: DEFAULT_ENABLED.includes(w.id) };
  }
  return { order: WIDGET_DEFS.map((w) => w.id), widgets, globalTimingSec: 8 };
}

const KEY = "finance.dashboardLayout.v1";

export function loadLayout(): DashboardLayout {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultLayout();
    const parsed = JSON.parse(raw) as DashboardLayout;
    // re-mescla garantindo novos widgets
    const base = defaultLayout();
    const merged = { ...base, ...parsed };
    merged.order = base.order.filter((id) => parsed.order?.includes(id)).concat(base.order.filter((id) => !parsed.order?.includes(id)));
    merged.widgets = { ...base.widgets, ...parsed.widgets };
    return merged;
  } catch {
    return defaultLayout();
  }
}

export function saveLayout(layout: DashboardLayout): void {
  localStorage.setItem(KEY, JSON.stringify(layout));
}

export function templates(): { id: string; name: string; enabled: string[] }[] {
  return [
    { id: "min", name: "Mínimo · saldo + feed", enabled: ["saldo", "feed"] },
    { id: "std", name: "Padrão · 5 widgets", enabled: DEFAULT_ENABLED },
    { id: "full", name: "Completo · 8 widgets", enabled: WIDGET_DEFS.map((w) => w.id) },
  ];
}

export function timingFor(layout: DashboardLayout, id: string): number {
  const w = layout.widgets[id];
  if (w?.pinned && w.timingSec) return w.timingSec;
  return layout.globalTimingSec;
}