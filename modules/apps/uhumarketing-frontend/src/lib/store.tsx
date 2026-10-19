import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ACTIVITY,
  CAMPAIGNS,
  FLOWS,
  SEGMENTS,
  SENDS,
  TEMPLATES,
  USER,
  WORKSPACE,
  COST_PER_MESSAGE,
} from "./mock";
import type {
  ActivityEvent,
  Campaign,
  Flow,
  FlowEdge,
  FlowNode,
  MetricPoint,
  Segment,
  Send,
  Template,
  User,
  Workspace,
} from "./types";
import { uid } from "./format";
import { StoreContext } from "./storeContext";

// Estado da POC. Não há backend: este provider é a "API" inteira. Ele carrega
// o mock e persiste o que o usuário cria/edita em localStorage, para o reload
// não apagar o trabalho de demonstração. Um botão em Configurações devolve
// tudo ao seed original.
//
// Quando a integração real existir, é este arquivo que vira cliente HTTP — as
// telas só falam com `useStore()`.

const STORAGE_KEY = "uhumarketing:state:v1";

export interface State {
  workspace: Workspace;
  user: User;
  templates: Template[];
  segments: Segment[];
  campaigns: Campaign[];
  sends: Send[];
  flows: Flow[];
  activity: ActivityEvent[];
}

function seed(): State {
  return {
    workspace: WORKSPACE,
    user: USER,
    templates: TEMPLATES,
    segments: SEGMENTS,
    campaigns: CAMPAIGNS,
    sends: SENDS,
    flows: FLOWS,
    activity: ACTIVITY,
  };
}

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seed();
    const parsed = JSON.parse(raw) as Partial<State>;
    const base = seed();
    // Merge defensivo: uma versão antiga do mock não pode quebrar a tela.
    return {
      workspace: parsed.workspace ?? base.workspace,
      user: parsed.user ?? base.user,
      templates: parsed.templates ?? base.templates,
      segments: parsed.segments ?? base.segments,
      campaigns: parsed.campaigns ?? base.campaigns,
      sends: parsed.sends ?? base.sends,
      flows: parsed.flows ?? base.flows,
      activity: parsed.activity ?? base.activity,
    };
  } catch {
    return seed();
  }
}

/* --------------------------------------------------------------- derivados */

export interface Kpis {
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  converted: number;
  revenue: number;
  failed: number;
  optOut: number;
  deliveryRate: number;
  readRate: number;
  replyRate: number;
  conversionRate: number;
  cost: number;
  costPerConversion: number;
}

/**
 * KPIs do período. A fonte é o acumulado das campanhas (a base "real" do
 * negócio), não o log de envios — o log é uma amostra de 12 linhas e faria o
 * dashboard parecer uma conta recém-criada. O recorte é por campanha
 * atualizada dentro da janela.
 */
export function kpisFrom(campaigns: Campaign[], days: number): Kpis {
  const cutoff = Date.now() - days * 86_400_000;
  const inRange = campaigns.filter((c) => new Date(c.updatedAt).getTime() >= cutoff);
  const sum = (pick: (c: Campaign) => number) => inRange.reduce((acc, c) => acc + pick(c), 0);

  const sent = sum((c) => c.metrics.sent);
  const delivered = sum((c) => c.metrics.delivered);
  const read = sum((c) => c.metrics.read);
  const replied = sum((c) => c.metrics.replied);
  const converted = sum((c) => c.metrics.converted);
  const failed = sum((c) => c.metrics.failed);
  const cost = sent * COST_PER_MESSAGE;

  return {
    sent,
    delivered,
    read,
    replied,
    converted,
    revenue: sum((c) => c.metrics.revenue),
    failed,
    optOut: sum((c) => c.metrics.optOut),
    deliveryRate: sent ? (delivered / sent) * 100 : 0,
    readRate: delivered ? (read / delivered) * 100 : 0,
    replyRate: read ? (replied / read) * 100 : 0,
    conversionRate: sent ? (converted / sent) * 100 : 0,
    cost,
    costPerConversion: converted ? cost / converted : 0,
  };
}

/**
 * Série diária do período. Distribui o volume das campanhas pelos dias com o
 * mesmo formato da série decorativa (fim de semana mais fraco, onda suave),
 * para o gráfico e os KPIs contarem a mesma história.
 */
export function seriesFor(campaigns: Campaign[], days: number): MetricPoint[] {
  const total = campaigns
    .filter((c) => new Date(c.updatedAt).getTime() >= Date.now() - days * 86_400_000)
    .reduce((acc, c) => acc + c.metrics.sent, 0);
  const base = total / days;
  const out: MetricPoint[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const weekend = d.getDay() === 0 || d.getDay() === 6 ? 0.45 : 1;
    const wave = 1 + 0.18 * Math.sin((days - i) / 2.4);
    const sent = Math.round(base * weekend * wave);
    const delivered = Math.round(sent * 0.972);
    const read = Math.round(delivered * 0.79);
    out.push({
      date: d.toISOString().slice(0, 10),
      sent,
      delivered,
      read,
      replied: Math.round(read * 0.14),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ store */

export interface Store extends State {
  // templates
  createTemplate: (t: Omit<Template, "id" | "createdAt" | "updatedAt" | "metrics" | "metaId" | "quality">) => Template;
  updateTemplate: (id: string, patch: Partial<Template>) => void;
  deleteTemplate: (id: string) => void;
  // segments
  createSegment: (s: Omit<Segment, "id" | "updatedAt" | "contactsCount" | "sample"> & { contactsCount?: number }) => Segment;
  updateSegment: (id: string, patch: Partial<Segment>) => void;
  // campaigns
  createCampaign: (c: Omit<Campaign, "id" | "createdAt" | "updatedAt" | "metrics">) => Campaign;
  updateCampaign: (id: string, patch: Partial<Campaign>) => void;
  // flows
  createFlow: (f: Omit<Flow, "id" | "createdAt" | "updatedAt" | "runs">) => Flow;
  updateFlow: (id: string, patch: Partial<Flow>) => void;
  addNode: (flowId: string, node: FlowNode) => void;
  updateNode: (flowId: string, nodeId: string, patch: Partial<FlowNode>) => void;
  removeNode: (flowId: string, nodeId: string) => void;
  addEdge: (flowId: string, edge: Omit<FlowEdge, "id">) => void;
  removeEdge: (flowId: string, edgeId: string) => void;
  // envios
  enqueueSend: (s: Omit<Send, "id" | "at" | "cost">) => Send;
  // util
  logActivity: (e: Omit<ActivityEvent, "id" | "at">) => void;
  reset: () => void;
  // Opcional: só o provider do backend sabe enfileirar de verdade. A tela usa
  // a presença desta função para trocar "Ativar" por "Disparar".
  launchCampaign?: (id: string) => Promise<LaunchResult>;
  submitTemplate?: (id: string) => Promise<Template>;
  /**
   * Série diária REAL, quando existe. O mock devolve uma curva decorativa
   * (seriesFor) porque não tem histórico; o backend agrega `sends` por dia.
   * A presença desta função também sinaliza "os números são reais", e o
   * dashboard para de mostrar variações inventadas.
   */
  series?: (days: number) => MetricPoint[];
}

/** Resultado de um disparo real. Existe só no modo Backend. */
export interface LaunchResult {
  queued: number;
  skipped: number;
  duplicate: number;
}

// Reexportado do módulo de contexto: as telas continuam importando de
// "@/lib/store", e o provider do backend publica no MESMO contexto sem
// importar este arquivo.
export { useStore, useLookup } from "./storeContext";

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage cheio/indisponível: a sessão vale só nesta aba.
    }
  }, [state]);

  const now = () => new Date().toISOString();

  const pushActivity = useCallback((e: Omit<ActivityEvent, "id" | "at">) => {
    setState((prev) => ({
      ...prev,
      activity: [{ ...e, id: uid("act"), at: now() }, ...prev.activity].slice(0, 60),
    }));
  }, []);

  const createTemplate = useCallback<Store["createTemplate"]>((input) => {
    const t: Template = {
      ...input,
      id: uid("tpl"),
      metaId: "—",
      quality: 0,
      metrics: { sent: 0, delivered: 0, read: 0, replied: 0, clicked: 0, failed: 0 },
      createdAt: now(),
      updatedAt: now(),
    };
    setState((prev) => ({ ...prev, templates: [t, ...prev.templates] }));
    return t;
  }, []);

  const updateTemplate = useCallback<Store["updateTemplate"]>((id, patch) => {
    setState((prev) => ({
      ...prev,
      templates: prev.templates.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: now() } : t)),
    }));
  }, []);

  const deleteTemplate = useCallback<Store["deleteTemplate"]>((id) => {
    setState((prev) => ({ ...prev, templates: prev.templates.filter((t) => t.id !== id) }));
  }, []);

  const createSegment = useCallback<Store["createSegment"]>((input) => {
    const s: Segment = {
      ...input,
      id: uid("seg"),
      contactsCount: input.contactsCount ?? 0,
      sample: [],
      updatedAt: now(),
    };
    setState((prev) => ({ ...prev, segments: [s, ...prev.segments] }));
    return s;
  }, []);

  const updateSegment = useCallback<Store["updateSegment"]>((id, patch) => {
    setState((prev) => ({
      ...prev,
      segments: prev.segments.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: now() } : s)),
    }));
  }, []);

  const createCampaign = useCallback<Store["createCampaign"]>((input) => {
    const c: Campaign = {
      ...input,
      id: uid("cmp"),
      metrics: {
        audience: 0,
        queued: 0,
        sent: 0,
        delivered: 0,
        read: 0,
        replied: 0,
        converted: 0,
        failed: 0,
        optOut: 0,
        revenue: 0,
      },
      createdAt: now(),
      updatedAt: now(),
    };
    setState((prev) => ({ ...prev, campaigns: [c, ...prev.campaigns] }));
    return c;
  }, []);

  const updateCampaign = useCallback<Store["updateCampaign"]>((id, patch) => {
    setState((prev) => ({
      ...prev,
      campaigns: prev.campaigns.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: now() } : c)),
    }));
  }, []);

  const createFlow = useCallback<Store["createFlow"]>((input) => {
    const f: Flow = {
      ...input,
      id: uid("flow"),
      runs: { total: 0, success: 0, failed: 0 },
      createdAt: now(),
      updatedAt: now(),
    };
    setState((prev) => ({ ...prev, flows: [f, ...prev.flows] }));
    return f;
  }, []);

  const updateFlow = useCallback<Store["updateFlow"]>((id, patch) => {
    setState((prev) => ({
      ...prev,
      flows: prev.flows.map((f) => (f.id === id ? { ...f, ...patch, updatedAt: now() } : f)),
    }));
  }, []);

  const addNode = useCallback<Store["addNode"]>((flowId, node) => {
    setState((prev) => ({
      ...prev,
      flows: prev.flows.map((f) =>
        f.id === flowId ? { ...f, nodes: [...f.nodes, node], updatedAt: now() } : f,
      ),
    }));
  }, []);

  const updateNode = useCallback<Store["updateNode"]>((flowId, nodeId, patch) => {
    setState((prev) => ({
      ...prev,
      flows: prev.flows.map((f) =>
        f.id === flowId
          ? {
              ...f,
              nodes: f.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
              updatedAt: now(),
            }
          : f,
      ),
    }));
  }, []);

  const removeNode = useCallback<Store["removeNode"]>((flowId, nodeId) => {
    setState((prev) => ({
      ...prev,
      flows: prev.flows.map((f) =>
        f.id === flowId
          ? {
              ...f,
              nodes: f.nodes.filter((n) => n.id !== nodeId),
              edges: f.edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
              updatedAt: now(),
            }
          : f,
      ),
    }));
  }, []);

  const addEdge = useCallback<Store["addEdge"]>((flowId, edge) => {
    setState((prev) => ({
      ...prev,
      flows: prev.flows.map((f) => {
        if (f.id !== flowId) return f;
        // Sem laço e sem aresta duplicada entre o mesmo par.
        if (edge.from === edge.to) return f;
        if (f.edges.some((e) => e.from === edge.from && e.to === edge.to)) return f;
        return { ...f, edges: [...f.edges, { ...edge, id: uid("e") }], updatedAt: now() };
      }),
    }));
  }, []);

  const removeEdge = useCallback<Store["removeEdge"]>((flowId, edgeId) => {
    setState((prev) => ({
      ...prev,
      flows: prev.flows.map((f) =>
        f.id === flowId ? { ...f, edges: f.edges.filter((e) => e.id !== edgeId), updatedAt: now() } : f,
      ),
    }));
  }, []);

  const enqueueSend = useCallback<Store["enqueueSend"]>((input) => {
    const s: Send = { ...input, id: uid("snd"), at: now(), cost: 0.0625 };
    setState((prev) => ({ ...prev, sends: [s, ...prev.sends] }));
    return s;
  }, []);

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setState(seed());
  }, []);

  const value = useMemo<Store>(
    () => ({
      ...state,
      createTemplate,
      updateTemplate,
      deleteTemplate,
      createSegment,
      updateSegment,
      createCampaign,
      updateCampaign,
      createFlow,
      updateFlow,
      addNode,
      updateNode,
      removeNode,
      addEdge,
      removeEdge,
      enqueueSend,
      logActivity: pushActivity,
      reset,
    }),
    [
      state,
      createTemplate,
      updateTemplate,
      deleteTemplate,
      createSegment,
      updateSegment,
      createCampaign,
      updateCampaign,
      createFlow,
      updateFlow,
      addNode,
      updateNode,
      removeNode,
      addEdge,
      removeEdge,
      enqueueSend,
      pushActivity,
      reset,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
