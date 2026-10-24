import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { uid } from "@/lib/format";
import { CONTACT_FIELD_LABEL, NODE_TYPE_LABEL } from "@/lib/types";
import type { Flow, FlowNode, NodeConfig, NodeType, SegmentRule } from "@/lib/types";
import { GROUP_LABEL, GROUP_ORDER, defaultConfig, NODE_SPECS, specOf, type SummaryCtx } from "@/lib/nodeCatalog";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, Input, Select, Toggle } from "@/components/ui/Input";
import { Tag } from "@/components/ui/Badge";
import { Note } from "@/components/Topbar";

const NODE_W = 214;
/** Altura de referência para as âncoras das arestas (o nó pode crescer). */
const NODE_H = 64;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.3;

interface Vec {
  x: number;
  y: number;
}

/**
 * Canvas do fluxo. Sem biblioteca de grafo (react-flow e afins): o produto precisa
 * de arrastar, ligar blocos e um inspetor — nada além disso. As coordenadas
 * ficam no próprio nó, então persistir é trivial e o layout é do usuário.
 */
export function FlowCanvas({
  flow,
  focus,
}: {
  flow: Flow;
  /** Pedido externo de seleção (ex.: clicar num aviso de validação). */
  focus?: { nodeId: string; nonce: number } | null;
}) {
  const store = useStore();
  const [zoom, setZoom] = useState(0.72);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; start: Vec; origin: Vec; now: Vec } | null>(null);
  const [connect, setConnect] = useState<{ from: string; cursor: Vec } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);

  const ctx: SummaryCtx = useMemo(
    () => ({
      segmentName: (id) => store.segments.find((s) => s.id === id)?.name ?? "audiência não escolhida",
      templateName: (id) => store.templates.find((t) => t.id === id)?.displayName ?? "template não escolhido",
    }),
    [store.segments, store.templates],
  );

  /** Posições com o arrasto em andamento aplicado (sem gravar a cada pixel). */
  const nodes = useMemo(() => {
    if (!drag) return flow.nodes;
    return flow.nodes.map((n) =>
      n.id === drag.id
        ? {
            ...n,
            x: Math.max(0, Math.round(drag.origin.x + (drag.now.x - drag.start.x) / zoom)),
            y: Math.max(0, Math.round(drag.origin.y + (drag.now.y - drag.start.y) / zoom)),
          }
        : n,
    );
  }, [flow.nodes, drag, zoom]);

  const selectedNode = nodes.find((n) => n.id === selected) ?? null;
  const selectedSpec = selectedNode ? specOf(selectedNode.type) : null;

  /** Enquadra todos os nós na primeira abertura (o layout é livre). */
  const fitView = useCallback(() => {
    const el = viewport.current;
    if (!el || flow.nodes.length === 0) return;
    const minX = Math.min(...flow.nodes.map((n) => n.x));
    const minY = Math.min(...flow.nodes.map((n) => n.y));
    const maxX = Math.max(...flow.nodes.map((n) => n.x + NODE_W));
    const maxY = Math.max(...flow.nodes.map((n) => n.y + NODE_H + 40));
    const pad = 48;
    const z = Math.min(
      1,
      Math.max(MIN_ZOOM, Math.min((el.clientWidth - pad * 2) / (maxX - minX), (el.clientHeight - pad * 2) / (maxY - minY))),
    );
    setZoom(+z.toFixed(2));
    requestAnimationFrame(() => {
      el.scrollLeft = Math.max(0, minX * z - pad);
      el.scrollTop = Math.max(0, minY * z - pad);
    });
  }, [flow.nodes]);

  // Ao abrir um fluxo, começa na origem do conteúdo (não no zoom-out máximo):
  // um fluxo largo fica ilegível se for forçado a caber. "Enquadrar" é ação
  // explícita, como no n8n.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (opened.current === flow.id) return;
    opened.current = flow.id;
    const el = viewport.current;
    if (!el) return;
    const minX = Math.min(...flow.nodes.map((n) => n.x));
    const minY = Math.min(...flow.nodes.map((n) => n.y));
    window.setTimeout(() => {
      el.scrollLeft = Math.max(0, minX * 0.72 - 40);
      el.scrollTop = Math.max(0, minY * 0.72 - 40);
    }, 80);
  }, [flow.id, flow.nodes]);

  // Foco externo: seleciona o nó e rola até ele. O nonce força o efeito mesmo
  // se o operador clicar duas vezes no mesmo aviso.
  useEffect(() => {
    if (!focus) return;
    const node = flow.nodes.find((n) => n.id === focus.nodeId);
    if (!node) return;
    setSelected(node.id);
    const el = viewport.current;
    if (!el) return;
    el.scrollTo({
      left: Math.max(0, node.x * zoom - el.clientWidth / 3),
      top: Math.max(0, node.y * zoom - el.clientHeight / 3),
      behavior: "smooth",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce]);

  /** px de tela → coordenadas do canvas. */
  const toCanvas = useCallback(
    (clientX: number, clientY: number): Vec => {
      const rect = viewport.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left + (viewport.current?.scrollLeft ?? 0)) / zoom,
        y: (clientY - rect.top + (viewport.current?.scrollTop ?? 0)) / zoom,
      };
    },
    [zoom],
  );

  /* --------------------------------------------------------------- arrasto */

  const dragRef = useRef<typeof drag>(null);
  dragRef.current = drag;

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      setDrag((d) => (d ? { ...d, now: { x: e.clientX, y: e.clientY } } : d));
    };
    const up = () => {
      const d = dragRef.current;
      if (d) {
        const x = Math.max(0, Math.round(d.origin.x + (d.now.x - d.start.x) / zoom));
        const y = Math.max(0, Math.round(d.origin.y + (d.now.y - d.start.y) / zoom));
        if (x !== d.origin.x || y !== d.origin.y) store.updateNode(flow.id, d.id, { x, y });
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, zoom, flow.id, store]);

  /* ------------------------------------------------------------ conectar */

  useEffect(() => {
    if (!connect) return;
    const move = (e: PointerEvent) => setConnect((c) => (c ? { ...c, cursor: toCanvas(e.clientX, e.clientY) } : c));
    const up = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const target = el?.closest("[data-input-node]") as HTMLElement | null;
      if (target?.dataset.inputNode) {
        store.addEdge(flow.id, { from: connect.from, to: target.dataset.inputNode });
      }
      setConnect(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [connect, toCanvas, flow.id, store]);

  /* ------------------------------------------------------------- helpers */

  /** Primeiro ponto livre numa grade, para o bloco novo não nascer empilhado. */
  function freeSpot(): Vec {
    const GAP_X = NODE_W + 48;
    const GAP_Y = 132;
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 8; col++) {
        const p = { x: 80 + col * GAP_X, y: 120 + row * GAP_Y };
        const taken = flow.nodes.some((n) => Math.abs(n.x - p.x) < NODE_W && Math.abs(n.y - p.y) < 96);
        if (!taken) return p;
      }
    }
    return { x: 80, y: 120 };
  }

  function addNode(type: NodeType, at?: Vec) {
    const pos = at ?? freeSpot();
    const node: FlowNode = {
      id: uid("n"),
      type,
      title: NODE_TYPE_LABEL[type],
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      config: defaultConfig(type),
    };
    store.addNode(flow.id, node);
    setSelected(node.id);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/x-uhu-node") as NodeType;
    if (!type) return;
    const p = toCanvas(e.clientX, e.clientY);
    addNode(type, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
  }

  const anchorOut = (n: FlowNode): Vec => ({ x: n.x + NODE_W, y: n.y + NODE_H / 2 });
  const anchorIn = (n: FlowNode): Vec => ({ x: n.x, y: n.y + NODE_H / 2 });

  function edgePath(from: FlowNode, to: FlowNode): string {
    const a = anchorOut(from);
    const b = anchorIn(to);
    const mid = Math.max(48, Math.abs(b.x - a.x) / 2);
    return `M ${a.x} ${a.y} C ${a.x + mid} ${a.y}, ${b.x - mid} ${b.y}, ${b.x} ${b.y}`;
  }

  /* -------------------------------------------------------------- render */

  return (
    <div className="relative flex min-h-0 flex-1">
      <Palette onAdd={(t) => addNode(t)} />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-4 py-2">
          <span className="caps hidden sm:inline">Arraste um bloco para o canvas ou clique nele</span>
          <span className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            onClick={fitView}
          >
            Enquadrar
          </Button>
          <div className="flex items-center gap-1 rounded-sm border border-line bg-bg">
            <IconButton label="Diminuir zoom" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.1).toFixed(2)))}>
              <ZoomOut size={14} />
            </IconButton>
            <span className="w-10 text-center font-mono text-[11px] text-fg-2">{Math.round(zoom * 100)}%</span>
            <IconButton label="Aumentar zoom" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.1).toFixed(2)))}>
              <ZoomIn size={14} />
            </IconButton>
          </div>
          <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => addNode("action.template")}>
            Nó
          </Button>
        </div>

        <div
          ref={viewport}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => setSelected(null)}
          className="flow-grid relative min-h-0 flex-1 overflow-auto scroll-thin"
          style={{ backgroundColor: "#0E0E11" }}
        >
          <div className="relative origin-top-left" style={{ width: 2400, height: 1400, transform: `scale(${zoom})` }}>
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#4A4A54" />
                </marker>
              </defs>
              {flow.edges.map((edge) => {
                const from = nodes.find((n) => n.id === edge.from);
                const to = nodes.find((n) => n.id === edge.to);
                if (!from || !to) return null;
                const a = anchorOut(from);
                const b = anchorIn(to);
                return (
                  <g key={edge.id} className="group pointer-events-auto">
                    <path d={edgePath(from, to)} fill="none" stroke="transparent" strokeWidth="16" />
                    <path
                      d={edgePath(from, to)}
                      fill="none"
                      stroke="#33333A"
                      strokeWidth="2"
                      strokeDasharray={flow.status === "active" ? "6 6" : undefined}
                      markerEnd="url(#arrow)"
                    />
                    {edge.branch && (
                      <text
                        x={(a.x + b.x) / 2}
                        y={(a.y + b.y) / 2 - 7}
                        textAnchor="middle"
                        fontSize="10"
                        fill="#6E6E76"
                        className="font-mono"
                      >
                        {edge.branch}
                      </text>
                    )}
                    <g
                      className="cursor-pointer opacity-0 transition-opacity group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        store.removeEdge(flow.id, edge.id);
                      }}
                    >
                      <title>Remover conexão</title>
                      <circle cx={(a.x + b.x) / 2} cy={(a.y + b.y) / 2} r="9" fill="#1C1C20" stroke="#33333A" />
                      <text
                        x={(a.x + b.x) / 2}
                        y={(a.y + b.y) / 2 + 3.5}
                        textAnchor="middle"
                        fontSize="11"
                        fill="#A8A8B0"
                        className="pointer-events-none select-none"
                      >
                        ×
                      </text>
                    </g>
                  </g>
                );
              })}

              {connect && (
                <path
                  d={(() => {
                    const from = nodes.find((n) => n.id === connect.from);
                    if (!from) return "";
                    const a = anchorOut(from);
                    const mid = Math.abs(connect.cursor.x - a.x) / 2;
                    return `M ${a.x} ${a.y} C ${a.x + mid} ${a.y}, ${connect.cursor.x - mid} ${connect.cursor.y}, ${connect.cursor.x} ${connect.cursor.y}`;
                  })()}
                  stroke="#2563EB"
                  strokeWidth="2"
                  strokeDasharray="5 5"
                  fill="none"
                />
              )}
            </svg>

            {nodes.map((node) => {
              const spec = specOf(node.type);
              const Icon = spec.icon;
              const isSelected = node.id === selected;
              return (
                <div
                  key={node.id}
                  className={cn(
                    "absolute animate-node-in select-none rounded-md border bg-surface shadow-node",
                    isSelected ? "z-20 border-accent ring-2 ring-accent-ring" : "z-10 border-line hover:border-line-strong",
                    node.disabled && "opacity-50",
                  )}
                  style={{ left: node.x, top: node.y, width: NODE_W, minHeight: NODE_H }}
                  onPointerDown={(e) => {
                    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
                    setSelected(node.id);
                    setDrag({
                      id: node.id,
                      start: { x: e.clientX, y: e.clientY },
                      origin: { x: node.x, y: node.y },
                      now: { x: e.clientX, y: e.clientY },
                    });
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(node.id);
                  }}
                >
                  <div className="flex items-start gap-2.5 p-3">
                    <span
                      className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-xs"
                      style={{ background: `${spec.color}22` }}
                    >
                      <Icon size={14} style={{ color: spec.color }} />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[12px] font-semibold leading-tight text-fg">{node.title}</span>
                      <span className="truncate text-[10px] leading-tight text-fg-3">{spec.summary(node.config, ctx)}</span>
                    </div>
                  </div>

                  {!node.disabled && (
                    <span
                      aria-hidden
                      className="absolute -right-[7px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 border-[#4A4A54] bg-surface"
                    />
                  )}

                  <button
                    data-input-node={node.id}
                    aria-label="Entrada do nó"
                    title="Soltar conexão aqui"
                    className={cn(
                      "absolute -left-[7px] top-1/2 z-30 h-3.5 w-3.5 -translate-y-1/2 rounded-full border-2 bg-surface transition-colors",
                      connect ? "border-accent bg-accent/40" : "border-[#4A4A54] hover:border-accent",
                    )}
                    onPointerDown={(e) => {
                      // Soltar aqui também conclui (o listener global resolve).
                      e.stopPropagation();
                      if (connect) {
                        store.addEdge(flow.id, { from: connect.from, to: node.id });
                        setConnect(null);
                      }
                    }}
                  />
                  <button
                    aria-label="Saída do nó"
                    title="Arraste para conectar"
                    className="absolute -right-[7px] top-1/2 z-30 h-3.5 w-3.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-[#4A4A54] bg-surface transition-colors hover:border-accent hover:bg-accent"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setConnect({ from: node.id, cursor: toCanvas(e.clientX, e.clientY) });
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />

                  {isSelected && selectedSpec && (
                    <div className="flex items-center justify-between gap-1 border-t border-line px-2 py-1.5" data-no-drag>
                      <span className="caps text-[9px]">{GROUP_LABEL[selectedSpec.group]}</span>
                      <div className="flex items-center gap-0.5">
                        <button
                          title={node.disabled ? "Ativar nó" : "Desativar nó"}
                          aria-label="Alternar nó"
                          className="grid h-6 w-6 place-items-center rounded-xs text-fg-3 hover:bg-elevated hover:text-fg"
                          onClick={(e) => {
                            e.stopPropagation();
                            store.updateNode(flow.id, node.id, { disabled: !node.disabled });
                          }}
                        >
                          <span className={cn("h-2 w-2 rounded-full", node.disabled ? "bg-fg-3" : "bg-success")} />
                        </button>
                        <button
                          title="Excluir nó"
                          aria-label="Excluir nó"
                          className="grid h-6 w-6 place-items-center rounded-xs text-fg-3 hover:bg-danger-soft hover:text-danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            store.removeNode(flow.id, node.id);
                            setSelected(null);
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {connect && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full bg-accent px-3 py-1.5 text-[11px] font-medium text-white shadow-card">
            solte na bolinha de entrada de outro bloco
          </div>
        )}
      </div>

      {selectedNode && selectedSpec && (
        <NodeInspector flow={flow} node={selectedNode} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- paleta */

function Palette({ onAdd }: { onAdd: (t: NodeType) => void }) {
  return (
    <aside className="flex w-[204px] shrink-0 flex-col gap-3.5 overflow-y-auto scroll-thin border-r border-line bg-surface p-3">
      <span className="caps px-1">Blocos</span>
      {GROUP_ORDER.map((g) => (
        <div key={g} className="flex flex-col gap-0.5">
          <span className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-fg-3">{GROUP_LABEL[g]}</span>
          {NODE_SPECS.filter((s) => s.group === g).map((spec) => {
            const Icon = spec.icon;
            return (
              <button
                key={spec.type}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-uhu-node", spec.type);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => onAdd(spec.type)}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-elevated"
                title={`Adicionar ${spec.label}`}
              >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-xs" style={{ background: `${spec.color}22` }}>
                  <Icon size={12} style={{ color: spec.color }} />
                </span>
                <span className="truncate text-[12px] text-fg-2">{spec.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}

/* -------------------------------------------------------------- inspetor */

function NodeInspector({ flow, node, onClose }: { flow: Flow; node: FlowNode; onClose: () => void }) {
  const store = useStore();
  const set = (patch: Partial<FlowNode>) => store.updateNode(flow.id, node.id, patch);
  const setConfig = (config: NodeConfig) => set({ config });
  const spec = specOf(node.type);
  const Icon = spec.icon;

  return (
    // Em telas estreitas o inspetor sobrepõe o canvas em vez de espremê-lo:
    // 1024px já é o mínimo para sidebar + paleta + canvas + painel.
    <aside className="absolute inset-y-0 right-0 z-30 flex w-[318px] shrink-0 flex-col border-l border-line bg-surface shadow-drawer xl:static xl:shadow-none">
      <div className="flex shrink-0 items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xs" style={{ background: `${spec.color}22` }}>
            <Icon size={15} style={{ color: spec.color }} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="caps">Configurar bloco</span>
            <span className="truncate text-[13px] font-semibold text-fg">{NODE_TYPE_LABEL[node.type]}</span>
          </div>
        </div>
        <IconButton label="Fechar" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scroll-thin p-4">
        <Field label="Nome do bloco">
          <Input value={node.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>

        <ConfigForm config={node.config} onChange={setConfig} />

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <span className="caps">Saídas</span>
          {flow.edges.filter((e) => e.from === node.id).length === 0 ? (
            <Note>Nenhuma. Arraste da bolinha à direita do bloco até a entrada do próximo.</Note>
          ) : (
            flow.edges
              .filter((e) => e.from === node.id)
              .map((edge) => {
                const to = flow.nodes.find((n) => n.id === edge.to);
                return (
                  <div key={edge.id} className="flex items-center gap-2 rounded-sm bg-bg px-2.5 py-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-fg-2">
                      {edge.branch ? `${edge.branch} → ` : ""}
                      {to?.title ?? "?"}
                    </span>
                    <IconButton label="Remover conexão" onClick={() => store.removeEdge(flow.id, edge.id)}>
                      <X size={12} />
                    </IconButton>
                  </div>
                );
              })
          )}
        </div>

        <div className="border-t border-line pt-3">
          <Toggle
            checked={!node.disabled}
            onChange={(v) => set({ disabled: !v })}
            label="Bloco ativo"
            desc="Desativado, ele é ignorado na execução."
          />
        </div>
      </div>
    </aside>
  );
}

/* ----------------------------------------------------------- formulários */

function ConfigForm({ config, onChange }: { config: NodeConfig; onChange: (c: NodeConfig) => void }) {
  const store = useStore();

  switch (config.type) {
    case "trigger.manual":
      return (
        <Field label="Observação" hint="Quem aprova o disparo.">
          <Input
            value={config.note ?? ""}
            onChange={(e) => onChange({ ...config, note: e.target.value })}
            placeholder="Aprovação de Marina"
          />
        </Field>
      );

    case "trigger.schedule":
      return (
        <>
          <Field label="Expressão cron" hint="minuto hora dia mês dia-da-semana">
            <Input className="font-mono" value={config.cron} onChange={(e) => onChange({ ...config, cron: e.target.value })} />
          </Field>
          <Note>0 9 * * 1-5 = todo dia útil, 9h. Fuso: America/Sao_Paulo.</Note>
        </>
      );

    case "trigger.event":
      return (
        <Field label="Evento" hint="Nome do evento que o sistema vai escutar.">
          <Select value={config.event} onChange={(e) => onChange({ ...config, event: e.target.value })}>
            <option value="carrinho.abandonado">carrinho.abandonado</option>
            <option value="pedido.criado">pedido.criado</option>
            <option value="pedido.entregue">pedido.entregue</option>
            <option value="assinatura.cancelada">assinatura.cancelada</option>
            <option value="contato.criado">contato.criado</option>
          </Select>
        </Field>
      );

    case "source.segment":
      return (
        <Field label="Audiência" hint="O universo de contatos do fluxo.">
          <Select value={config.segmentId} onChange={(e) => onChange({ ...config, segmentId: e.target.value })}>
            <option value="">escolha uma audiência</option>
            {store.segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.contactsCount})
              </option>
            ))}
          </Select>
        </Field>
      );

    case "source.contacts":
      return (
        <Field label="Origem" hint="De onde os contatos vêm.">
          <Input value={config.source} onChange={(e) => onChange({ ...config, source: e.target.value })} />
        </Field>
      );

    case "filter.rules":
      return <RulesEditor config={config} onChange={onChange} />;

    case "action.dedupe":
      return (
        <Field label="Chave de deduplicação">
          <Select value={config.key} onChange={(e) => onChange({ ...config, key: e.target.value as typeof config.key })}>
            <option value="phone">Telefone</option>
            <option value="email">E-mail</option>
            <option value="contact_id">Id do contato</option>
          </Select>
        </Field>
      );

    case "action.limit":
      return (
        <div className="flex gap-2.5">
          <Field label="Máximo" className="flex-1">
            <Input type="number" value={config.max} onChange={(e) => onChange({ ...config, max: Number(e.target.value) })} />
          </Field>
          <Field label="Por" className="w-[110px]">
            <Select value={config.per} onChange={(e) => onChange({ ...config, per: e.target.value as typeof config.per })}>
              <option value="run">execução</option>
              <option value="day">dia</option>
            </Select>
          </Field>
        </div>
      );

    case "action.delay":
      return (
        <div className="flex gap-2.5">
          <Field label="Esperar" className="flex-1">
            <Input
              type="number"
              value={config.amount}
              onChange={(e) => onChange({ ...config, amount: Number(e.target.value) })}
            />
          </Field>
          <Field label="Unidade" className="w-[120px]">
            <Select value={config.unit} onChange={(e) => onChange({ ...config, unit: e.target.value as typeof config.unit })}>
              <option value="min">minutos</option>
              <option value="hour">horas</option>
              <option value="day">dias</option>
            </Select>
          </Field>
        </div>
      );

    case "action.split":
      return (
        <>
          <div className="flex gap-2.5">
            <Field label="Variante A (%)" className="flex-1">
              <Input
                type="number"
                value={config.a}
                onChange={(e) => {
                  const a = Math.max(0, Math.min(100, Number(e.target.value)));
                  onChange({ ...config, a, b: 100 - a });
                }}
              />
            </Field>
            <Field label="Variante B (%)" className="flex-1">
              <Input type="number" value={config.b} readOnly />
            </Field>
          </div>
          <Note>Ligue uma saída no ramo A e outra no B — cada uma recebe a sua fatia.</Note>
        </>
      );

    case "condition.branch":
      return (
        <div className="flex flex-col gap-2.5">
          <Field label="Campo">
            <Select
              value={config.field}
              onChange={(e) => onChange({ ...config, field: e.target.value as typeof config.field })}
            >
              {Object.entries(CONTACT_FIELD_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2.5">
            <Field label="Operador" className="w-[130px]">
              <Select
                value={config.operator}
                onChange={(e) => onChange({ ...config, operator: e.target.value as typeof config.operator })}
              >
                <option value="eq">é</option>
                <option value="neq">não é</option>
                <option value="contains">contém</option>
                <option value="gt">maior que</option>
                <option value="lt">menor que</option>
                <option value="in_days">nos últimos (dias)</option>
              </Select>
            </Field>
            <Field label="Valor" className="flex-1">
              <Input value={config.value} onChange={(e) => onChange({ ...config, value: e.target.value })} />
            </Field>
          </div>
        </div>
      );

    case "action.waitReply":
      return (
        <div className="flex gap-2.5">
          <Field label="Timeout (horas)" className="flex-1">
            <Input
              type="number"
              value={config.timeoutHours}
              onChange={(e) => onChange({ ...config, timeoutHours: Number(e.target.value) })}
            />
          </Field>
          <Field label="Se não responder" className="w-[150px]">
            <Select
              value={config.onTimeout}
              onChange={(e) => onChange({ ...config, onTimeout: e.target.value as typeof config.onTimeout })}
            >
              <option value="continue">seguir fluxo</option>
              <option value="stop">encerrar</option>
            </Select>
          </Field>
        </div>
      );

    case "action.template": {
      const template = store.templates.find((t) => t.id === config.templateId);
      return (
        <>
          <Field label="Template" hint="Só aparecem os aprovados pela Meta.">
            <Select value={config.templateId} onChange={(e) => onChange({ ...config, templateId: e.target.value })}>
              <option value="">escolha um template</option>
              {store.templates
                .filter((t) => t.status === "approved")
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName}
                  </option>
                ))}
            </Select>
          </Field>
          {template && template.variables.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="caps">Mapeamento das variáveis</span>
              {template.variables.map((v) => (
                <div key={v.index} className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <Tag>{`{{${v.index}}}`}</Tag>
                    <span className="truncate text-[11px] text-fg-3">{v.label}</span>
                  </div>
                  <Input
                    value={config.mapping[v.index] ?? ""}
                    placeholder="campo do contato (ex.: primeiro_nome)"
                    onChange={(e) => onChange({ ...config, mapping: { ...config.mapping, [v.index]: e.target.value } })}
                    className="font-mono text-[12px]"
                  />
                </div>
              ))}
            </div>
          )}
          {!template && <Note>Escolha um template aprovado — a Meta não deixa enviar outro.</Note>}
        </>
      );
    }

    case "action.coupon":
      return (
        <>
          <div className="flex gap-2.5">
            <Field label="Tipo" className="flex-1">
              <Select value={config.kind} onChange={(e) => onChange({ ...config, kind: e.target.value as typeof config.kind })}>
                <option value="cupom">Cupom</option>
                <option value="brinde">Brinde</option>
                <option value="frete">Frete grátis</option>
              </Select>
            </Field>
            <Field label="Desconto (%)" className="w-[120px]">
              <Input
                type="number"
                value={config.discount}
                onChange={(e) => onChange({ ...config, discount: Number(e.target.value) })}
              />
            </Field>
          </div>
          <Field label="Validade (dias)">
            <Input
              type="number"
              value={config.expireDays}
              onChange={(e) => onChange({ ...config, expireDays: Number(e.target.value) })}
            />
          </Field>
          <Toggle
            checked={config.perRecipient}
            onChange={(v) => onChange({ ...config, perRecipient: v })}
            label="Código único por pessoa"
            desc="Gera um cupom por destinatário (rastreável) em vez de um código compartilhado."
          />
        </>
      );

    case "action.personalize":
      return (
        <div className="flex flex-col gap-2.5">
          <Field label="Tom de voz">
            <Select value={config.tone} onChange={(e) => onChange({ ...config, tone: e.target.value as typeof config.tone })}>
              <option value="direto">Direto</option>
              <option value="caloroso">Caloroso</option>
              <option value="formal">Formal</option>
            </Select>
          </Field>
          <Field label="Se não houver primeiro nome" hint="O que entra no lugar de {{1}}.">
            <Input value={config.fallbackName} onChange={(e) => onChange({ ...config, fallbackName: e.target.value })} />
          </Field>
        </div>
      );

    case "action.channel":
      return (
        <>
          <Field label="Canal">
            <Select
              value={config.channel}
              onChange={(e) => onChange({ ...config, channel: e.target.value as typeof config.channel })}
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
              <option value="sms">SMS</option>
            </Select>
          </Field>
          <Field label="Remetente">
            <Input className="font-mono" value={config.sender} onChange={(e) => onChange({ ...config, sender: e.target.value })} />
          </Field>
          <Toggle
            checked={config.throttled}
            onChange={(v) => onChange({ ...config, throttled: v })}
            label="Respeitar a vazão da campanha"
            desc="Sem isso, o fluxo dispara na velocidade que conseguir — e a Meta pode barrar."
          />
        </>
      );

    case "action.webhook":
      return (
        <>
          <Field label="URL">
            <Input className="font-mono" value={config.url} onChange={(e) => onChange({ ...config, url: e.target.value })} />
          </Field>
          <Field label="Método">
            <Select value={config.method} onChange={(e) => onChange({ ...config, method: e.target.value as typeof config.method })}>
              <option value="POST">POST</option>
              <option value="GET">GET</option>
            </Select>
          </Field>
        </>
      );

    case "action.handoff":
      return (
        <div className="flex gap-2.5">
          <Field label="Fila" className="flex-1">
            <Input value={config.queue} onChange={(e) => onChange({ ...config, queue: e.target.value })} />
          </Field>
          <Field label="SLA (min)" className="w-[100px]">
            <Input
              type="number"
              value={config.slaMinutes}
              onChange={(e) => onChange({ ...config, slaMinutes: Number(e.target.value) })}
            />
          </Field>
        </div>
      );

    case "end":
      return (
        <Field label="Observação">
          <Input value={config.note ?? ""} onChange={(e) => onChange({ ...config, note: e.target.value })} />
        </Field>
      );
  }
}

function RulesEditor({
  config,
  onChange,
}: {
  config: Extract<NodeConfig, { type: "filter.rules" }>;
  onChange: (c: NodeConfig) => void;
}) {
  const setRule = (id: string, patch: Partial<SegmentRule>) =>
    onChange({ ...config, rules: config.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <span className="caps">Regras de descobrimento</span>
      </div>

      <Field label="Combinar">
        <Select
          value={config.combinator}
          onChange={(e) => onChange({ ...config, combinator: e.target.value as "and" | "or" })}
        >
          <option value="and">todas as regras (E)</option>
          <option value="or">qualquer regra (OU)</option>
        </Select>
      </Field>

      {config.rules.map((rule) => (
        <div key={rule.id} className="flex flex-col gap-1.5 rounded-sm border border-line bg-bg p-2.5">
          <div className="flex items-center gap-2">
            <Select
              value={rule.field}
              onChange={(e) => setRule(rule.id, { field: e.target.value as SegmentRule["field"] })}
              className="flex-1"
            >
              {Object.entries(CONTACT_FIELD_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <IconButton
              label="Remover regra"
              onClick={() => onChange({ ...config, rules: config.rules.filter((r) => r.id !== rule.id) })}
            >
              <Trash2 size={13} />
            </IconButton>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={rule.operator}
              onChange={(e) => setRule(rule.id, { operator: e.target.value as SegmentRule["operator"] })}
              className="w-[130px]"
            >
              <option value="eq">é</option>
              <option value="neq">não é</option>
              <option value="contains">contém</option>
              <option value="gt">maior que</option>
              <option value="lt">menor que</option>
              <option value="in_days">últimos dias</option>
            </Select>
            <Input value={rule.value} onChange={(e) => setRule(rule.id, { value: e.target.value })} className="flex-1" />
          </div>
        </div>
      ))}

      <Button
        variant="secondary"
        size="sm"
        icon={<Plus size={13} />}
        onClick={() =>
          onChange({
            ...config,
            rules: [...config.rules, { id: uid("f"), field: "tag", operator: "contains", value: "" }],
          })
        }
      >
        Adicionar regra
      </Button>
      <Note>
        A audiência define o universo; as regras decidem quem passa. É aqui que “leads frios” deixa de ser um conceito e
        vira uma condição executável.
      </Note>
    </div>
  );
}
