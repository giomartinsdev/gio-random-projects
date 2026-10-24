import { useEffect, useMemo, useState } from "react";
import { GripVertical, Pin, Plus, RotateCcw } from "lucide-react";
import { Cockpit, Card, Kpi } from "@/components/primitives";
import {
  WIDGET_DEFS,
  defaultLayout,
  loadLayout,
  saveLayout,
  templates,
  type DashboardLayout,
} from "@/lib/dashboardLayout";
import { cn } from "@/lib/utils";
import { hrefFor } from "@/lib/router";
import { Kbd } from "@/components/search";

// Tela "Personalizar" do ui.pen: os widgets da home com toggle (ligar/desligar),
// drag-and-drop para reordenar, timing global (aplica em todos) e timing próprio
// para widgets fixados (pin). Tudo persiste em localStorage e o Painel re-renderiza.

const EVENT = "finance:layout-changed";

function commit(next: DashboardLayout) {
  saveLayout(next);
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function PersonalizePage() {
  const [layout, setLayout] = useState<DashboardLayout>(() => loadLayout());
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // qualquer mudança local já salva (fonte da verdade é o estado aqui)
  const update = (mutate: (l: DashboardLayout) => DashboardLayout) => {
    setLayout((cur) => {
      const next = mutate(cur);
      commit(next);
      setSavedAt(Date.now());
      return next;
    });
  };

  useEffect(() => {
    const reload = () => setLayout(loadLayout());
    window.addEventListener(EVENT, reload);
    return () => window.removeEventListener(EVENT, reload);
  }, []);

  const activeCount = useMemo(() => Object.values(layout.widgets).filter((w) => w.enabled).length, [layout]);

  const onDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) return setDragIdx(null);
    update((l) => {
      const order = [...l.order];
      const [moved] = order.splice(dragIdx, 1);
      order.splice(targetIdx, 0, moved);
      return { ...l, order };
    });
    setDragIdx(null);
  };

  const activeCountPinned = Object.values(layout.widgets).filter((w) => w.enabled && w.pinned).length;

  return (
    <Cockpit
      left={
        <>
          <Card>
            <p className="kick mb-1">{activeCount} widgets ativos de {WIDGET_DEFS.length} disponíveis</p>
            <p className="kick">Sua home</p>
            <p className="fig text-[28px]">Layout próprio</p>
            <p className="mt-1 text-[11px] dim">arraste para reordenar · ligue/desligue à vontade</p>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <Kpi label="Ativos" value={String(activeCount)} tone="up" />
              <Kpi label="Desligados" value={String(WIDGET_DEFS.length - activeCount)} />
              <Kpi label="Fixados" value={String(activeCountPinned)} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => update(() => defaultLayout())} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-soft px-3 py-1.5 text-[12px] text-fg transition-colors hover:bg-fg/8">
                <RotateCcw className="size-3" /> restaurar padrão
              </button>
              <span className="inline-flex h-[30px] items-center gap-2 rounded-full border border-border bg-bg-soft/85 px-3 text-[12.5px] text-fg-dim">
                {savedAt ? "salvo ✓" : "salvo automaticamente"} <Kbd>⌘K</Kbd>
              </span>
            </div>
          </Card>

          <Card title="Timing dos widgets">
            <TimingGlobal layout={layout} onChange={(sec) => update((l) => ({ ...l, globalTimingSec: sec }))} />
            <p className="mt-2 text-[11.5px] dim w-full" style={{ textWrap: "pretty" }}>
              widgets fixados individualmente ignoram o timing global e mantêm sua própria rotação:
            </p>
            <div className="mt-2 space-y-1.5">
              {layout.order.filter((id) => layout.widgets[id]?.pinned).map((id) => {
                const w = layout.widgets[id];
                const def = WIDGET_DEFS.find((d) => d.id === id);
                return (
                  <div key={id} className="flex h-10 items-center gap-2.5 rounded-[10px] bg-bg-soft px-2.5">
                    <Pin className={cn("size-3", w.enabled ? "text-warn" : "text-fg-dim")} />
                    <span className="text-[12.5px]">{def?.name}</span>
                    <span className="ml-auto font-mono text-[11px] text-fg-dim">fixado em {w.timingSec ?? layout.globalTimingSec}s</span>
                    <button onClick={() => update((l) => ({ ...l, widgets: { ...l.widgets, [id]: { ...w, pinned: false, timingSec: undefined } } }))} className="text-[12px] text-fg-dim hover:text-fg">
                      desafixar
                    </button>
                  </div>
                );
              })}
              {activeCountPinned === 0 && (
                <div className="flex h-10 items-center gap-2.5 rounded-[10px] bg-bg-soft px-2.5 text-[12.5px] text-fg-dim">
                  <Pin className="size-3" /> nenhum widget fixado — todos seguem o global
                </div>
              )}
            </div>
          </Card>
        </>
      }
      center={
        <Card
          title="Seus widgets"
          right={<a href={hrefFor({ name: "dashboard" })} className="text-[12px] dim hover:text-fg">ver a home →</a>}
          className="min-h-0"
        >
          <ul className="space-y-1.5">
            {layout.order.map((id, idx) => {
              const def = WIDGET_DEFS.find((d) => d.id === id);
              if (!def) return null;
              const w = layout.widgets[id];
              return (
                <li
                  key={id}
                  draggable
                  onDragStart={() => setDragIdx(idx)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDrop(idx)}
                  className={cn(
                    "flex h-[52px] select-none items-center gap-3 rounded-[10px] px-3 transition-opacity",
                    w.enabled ? "bg-bg-soft" : "border border-dashed border-border opacity-45",
                    dragIdx === idx && "ring-1 ring-fg/40",
                  )}
                >
                  <GripVertical className="size-3.5 cursor-grab text-fg-dim" aria-hidden />
                  <span className={cn("flex size-[30px] items-center justify-center rounded-[9px]", w.enabled ? "bg-fg/10 text-fg" : "bg-fg/5 text-fg-dim")}>
                    <WidgetIcon name={def.icon} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{def.name}</span>
                    <span className="block truncate text-[11px] dim">{def.description}</span>
                  </span>
                  <button
                    role="switch"
                    aria-checked={w.enabled}
                    onClick={() => update((l) => ({ ...l, widgets: { ...l.widgets, [id]: { ...w, enabled: !w.enabled } } }))}
                    className={cn("flex h-5 w-[34px] shrink-0 items-center rounded-full p-0.5 transition-colors", w.enabled ? "justify-end bg-primary" : "justify-start bg-fg/15")}
                  >
                    <span className="size-4 rounded-full bg-bg" />
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      }
      right={
        <>
          <Card title="Timing individual (fixados)">
            <div className="space-y-1.5">
              {layout.order.filter((id) => layout.widgets[id]?.enabled && !layout.widgets[id]?.pinned).slice(0, 5).map((id) => {
                const def = WIDGET_DEFS.find((d) => d.id === id);
                return (
                  <div key={id} className="flex h-9 items-center gap-2.5 rounded-[9px] bg-bg-soft px-2.5">
                    <Pin className="size-3 text-fg-dim" />
                    <span className="truncate text-[12.5px]">{def?.name}</span>
                    <span className="ml-auto font-mono text-[11px] text-fg-dim segue">segue global · {layout.globalTimingSec}s</span>
                    <button
                      onClick={() => update((l) => ({ ...l, widgets: { ...l.widgets, [id]: { ...l.widgets[id], pinned: true, timingSec: l.globalTimingSec + 4 } } }))}
                      className="text-[12px] text-fg-dim hover:text-fg"
                    >
                      fixar
                    </button>
                  </div>
                );
              })}
              <div className="flex h-9 items-center gap-2.5 rounded-[9px] border border-dashed border-border px-2.5 text-[12px] text-fg-dim">
                <Plus className="size-3" /> fixe um widget para dar tempo maior a ele
              </div>
            </div>
          </Card>

          <Card title="Prévia · como fica">
            <div className="rounded-[10px] border border-border p-2.5">
              <ul className="space-y-2">
                {layout.order.filter((id) => layout.widgets[id]?.enabled).slice(0, 5).map((id, i) => {
                  const def = WIDGET_DEFS.find((d) => d.id === id);
                  return (
                    <li key={id} className="flex h-[26px] items-center gap-2 rounded-md bg-bg-soft px-2 text-[10.5px]">
                      <span className={cn("size-1.5 rounded-full", i % 2 ? "bg-up" : "bg-primary")} />
                      {def?.name}
                    </li>
                  );
                })}
                <li className="flex h-[26px] items-center justify-center rounded-md border border-dashed border-border text-[10.5px] dim">
                  + soltar aqui
                </li>
              </ul>
            </div>
          </Card>

          <Card title="Comece por um molde">
            <div className="space-y-2">
              {templates().map((t) => (
                <button
                  key={t.id}
                  onClick={() => update((l) => {
                    const widgets = { ...l.widgets };
                    for (const id of l.order) widgets[id] = { ...widgets[id], enabled: t.enabled.includes(id) };
                    return { ...l, widgets };
                  })}
                  className="block w-full rounded-full border border-border-strong bg-bg-soft px-3 py-1.5 text-left text-[12px] text-fg transition-colors hover:bg-fg/8"
                >
                  {t.name}
                </button>
              ))}
            </div>
          </Card>
        </>
      }
    />
  );
}

function TimingGlobal({ layout, onChange }: { layout: DashboardLayout; onChange: (sec: number) => void }) {
  const [sec, setSec] = useState(layout.globalTimingSec);
  useEffect(() => setSec(layout.globalTimingSec), [layout.globalTimingSec]);
  return (
    <div className="flex h-[54px] items-center gap-3 rounded-xl border border-border bg-bg-soft px-3.5">
      <span className="flex size-4 items-center justify-center text-[13px]">⏱</span>
      <span className="min-w-0">
        <span className="block text-[13px]">Rotação de todos os widgets</span>
        <span className="block text-[11px] dim">aplica em todos · os fixados mantêm o dele</span>
      </span>
      <span className="ml-auto flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-bg px-2.5">
        <span className="font-mono text-[13px]">{sec}s</span>
        <span className="flex items-center">
          <button onClick={() => { const v = Math.max(1, sec - 1); setSec(v); onChange(v); }} className="px-1 text-fg-dim hover:text-fg" aria-label="diminuir">▲</button>
          <button onClick={() => { const v = Math.min(60, sec + 1); setSec(v); onChange(v); }} className="px-1 text-fg-dim hover:text-fg" aria-label="aumentar">▼</button>
        </span>
      </span>
      <button onClick={() => onChange(sec)} className="rounded-full bg-fg/10 px-2.5 py-1 text-[12px] text-fg transition-colors hover:bg-fg/20">
        aplicar
      </button>
    </div>
  );
}

function WidgetIcon({ name }: { name: string }) {
  // ícones em linhas simples; sem lib de ícone pesada no bundle
  const glyphs: Record<string, string> = {
    "layout-dashboard": "▦",
    "bar-chart-3": "▟",
    "pie-chart": "◔",
    activity: "∿",
    "sliders-horizontal": "☰",
    "credit-card": "▭",
    target: "◎",
    "git-compare": "⇄",
  };
  return <span aria-hidden className="text-[13px] leading-none">{glyphs[name] ?? "▦"}</span>;
}