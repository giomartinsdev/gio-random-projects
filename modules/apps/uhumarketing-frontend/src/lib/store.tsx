import type {
  ActivityEvent,
  Campaign,
  Contact,
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

// Contrato das telas com os dados. O que sobrou depois que a demonstração
// saiu: o tipo `Store` e as derivações puras (KPIs e série). Quem preenche é
// `storeRemote.tsx`; nenhuma tela importa o cliente HTTP.

/** Custo por mensagem de marketing entregue, em reais. Espelha o backend. */
export const COST_PER_MESSAGE = 0.0625;

export interface State {
  workspace: Workspace;
  contacts: Contact[];
  user: User;
  templates: Template[];
  segments: Segment[];
  campaigns: Campaign[];
  sends: Send[];
  flows: Flow[];
  activity: ActivityEvent[];
}

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
 * KPIs do período, a partir das campanhas. O servidor já manda as métricas por
 * campanha derivadas de `sends`; aqui só se soma e se calcula taxa.
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
 * Série diária de reserva. O backend manda a série real (`series` no Store);
 * esta função só existe para o gráfico não ficar vazio caso o servidor não
 * mande nada — e devolve zeros, não uma curva decorativa. Inventar movimento
 * num gráfico é a mentira mais fácil de contar sem perceber.
 */
export function seriesFor(_campaigns: Campaign[], days: number): MetricPoint[] {
  const out: MetricPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push({ date: d.toISOString().slice(0, 10), sent: 0, delivered: 0, read: 0, replied: 0 });
  }
  return out;
}

/* ------------------------------------------------------------------ store */

export interface Store extends State {
  // workspace
  /**
   * Grava a identidade da conta (nome, número de WhatsApp, janela silenciosa).
   * Espera o servidor: o número é o que libera o disparo, então "salvo" aqui
   * não pode ser otimista.
   */
  updateWorkspace: (patch: Partial<Workspace>) => Promise<void>;
  /**
   * Grava agora o documento editorial (cancela o debounce e espera o PUT).
   * Necessário quando a próxima ação do servidor depende do que acabou de ser
   * editado — publicar um fluxo e disparar a campanha, por exemplo.
   */
  saveNow: () => Promise<void>;
  // templates
  createTemplate: (t: Omit<Template, "id" | "createdAt" | "updatedAt" | "metrics" | "metaId" | "quality">) => Template;
  updateTemplate: (id: string, patch: Partial<Template>) => void;
  deleteTemplate: (id: string) => void;
  // segments
  createSegment: (s: Omit<Segment, "id" | "updatedAt" | "contactsCount" | "sample"> & { contactsCount?: number }) => Segment;
  /**
   * Importa contatos de verdade (POST /contacts) e recarrega o bootstrap. Cada
   * linha com consentimento vira um contato com opt-in registrado; sem
   * consentimento, a linha é recusada — a lista não pode "ganhar" opt-in por
   * omissão.
   */
  importContacts: (
    rows: { name: string; phone: string; email?: string; city?: string; consentAt: string }[],
    tag: string,
  ) => Promise<{ created: number; failed: { line: number; reason: string }[] }>;
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
  // util
  logActivity: (e: Omit<ActivityEvent, "id" | "at">) => void;
  // Só o backend enfileira de verdade. A tela usa a presença desta função para
  // trocar "Ativar" por "Disparar".
  launchCampaign?: (id: string) => Promise<LaunchResult>;
  testSend?: (id: string) => Promise<LaunchResult>;
  submitTemplate?: (id: string) => Promise<Template>;
  /**
   * Série diária REAL, agregada de `sends` no servidor. A presença desta
   * função também sinaliza "os números são reais", e o dashboard para de
   * mostrar variação inventada.
   */
  series?: (days: number) => MetricPoint[];
  /**
   * Estado do provedor de WhatsApp (dry-run/live, número conectado). Vem do
   * servidor: quem sabe se dá para enviar é ele, não a tela.
   */
  provider?: {
    name: string;
    mode: string;
    live: boolean;
    hasNumber: boolean;
    note: string;
  };
}

/** Resultado de um disparo real. */
export interface LaunchResult {
  campaignId?: string;
  queued: number;
  skipped: number;
  duplicate: number;
}

// As telas importam daqui; o provider publica no MESMO contexto sem importar
// este arquivo (evita ciclo).
export { useStore, useLookup } from "./storeContext";
