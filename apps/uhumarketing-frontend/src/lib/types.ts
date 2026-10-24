// Modelo que as telas usam. Espelha o que o uhumarketing-api devolve no
// bootstrap (templates Meta, audiências, campanhas, envios e o fluxo livre
// estilo n8n). Nada aqui é dado de exemplo: o que a tela mostra veio do banco,
// escopado pela conta da sessão.

/* ------------------------------------------------------------------ canal */

export type Channel = "whatsapp" | "email" | "sms";

export const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: "WhatsApp",
  email: "E-mail",
  sms: "SMS",
};

/* ---------------------------------------------------------------- templates */

/**
 * Template aprovado pela Meta (ou em análise/rejeitado). O WhatsApp é o canal
 * que exige aprovação; e-mail e SMS usam o mesmo formato de "conteúdo com
 * variáveis", por isso compartilham o tipo.
 */
export type TemplateStatus = "approved" | "pending" | "rejected" | "paused" | "draft";
export type TemplateCategory = "marketing" | "utility" | "authentication";
export type HeaderKind = "none" | "text" | "image" | "video" | "document";

export interface TemplateButton {
  type: "quick_reply" | "url" | "phone";
  text: string;
  /** Só para type=url / phone (a Meta exige destino fixo ou variável). */
  value?: string;
}

export interface TemplateVariable {
  /** Ex.: {{1}} na Meta; aqui guardamos o índice como "1". */
  index: string;
  /** O que o envio deve colocar ali: nome, cupom, produto… */
  label: string;
  /** Valor de exemplo que a Meta pediu na submissão. */
  example: string;
}

export interface TemplateMetrics {
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  clicked: number;
  failed: number;
}

export interface Template {
  id: string;
  /** Nome técnico em snake_case, como a Meta exige. */
  name: string;
  displayName: string;
  channel: Channel;
  category: TemplateCategory;
  language: string;
  status: TemplateStatus;
  header: { kind: HeaderKind; text?: string; mediaHint?: string };
  body: string;
  footer?: string;
  buttons: TemplateButton[];
  variables: TemplateVariable[];
  /** Id do template no WhatsApp Business Account. */
  metaId: string;
  /** 0–100, qualidade reportada pela Meta. */
  quality: number;
  metrics: TemplateMetrics;
  createdAt: string;
  updatedAt: string;
  rejectionReason?: string;
}

/* --------------------------------------------------------------- audiências */

export type SegmentKind = "static" | "dynamic" | "import";

export interface SegmentRule {
  id: string;
  field: ContactField;
  operator: "eq" | "neq" | "contains" | "gt" | "lt" | "in_days";
  value: string;
}

export type ContactField =
  | "cidade"
  | "uf"
  | "origem"
  | "tag"
  | "ultima_compra"
  | "total_gasto"
  | "pedidos"
  | "opt_in"
  | "plano";

export const CONTACT_FIELD_LABEL: Record<ContactField, string> = {
  cidade: "Cidade",
  uf: "UF",
  origem: "Origem",
  tag: "Tag",
  ultima_compra: "Última compra",
  total_gasto: "Total gasto",
  pedidos: "Nº de pedidos",
  opt_in: "Opt-in",
  plano: "Plano",
};

export interface Segment {
  id: string;
  name: string;
  description: string;
  kind: SegmentKind;
  /** Quantos contatos casam com a regra, calculado no servidor. */
  contactsCount: number;
  rules: SegmentRule[];
  /** Origem do dado, para o operador saber de onde veio a lista. */
  source: string;
  updatedAt: string;
  /** Amostra para a prévia no drawer. */
  sample: Contact[];
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string;
  city: string;
  uf: string;
  tags: string[];
  source: string;
  lastPurchaseAt?: string;
  totalSpent?: number;
  orders?: number;
  optIn: boolean;
}

/* ---------------------------------------------------------------- campanhas */

export type CampaignStatus = "draft" | "scheduled" | "running" | "paused" | "finished";
export type CampaignObjective = "reativacao" | "conversao" | "awareness" | "pos_venda";

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Rascunho",
  scheduled: "Agendada",
  running: "Em execução",
  paused: "Pausada",
  finished: "Concluída",
};

export const OBJECTIVE_LABEL: Record<CampaignObjective, string> = {
  reativacao: "Reativar leads frios",
  conversao: "Converter com oferta",
  awareness: "Manter presença",
  pos_venda: "Pós-venda / recompra",
};

/** Janela de disparo: horário comercial, dias da semana e vazão. */
export interface Schedule {
  startAt: string;
  endAt?: string;
  /** 0–23. Fora da janela, a fila espera. */
  windowStart: number;
  windowEnd: number;
  /** 0 = domingo … 6 = sábado. */
  days: number[];
  /** Mensagens por minuto — o "throttle" da API da Meta. */
  throttlePerMinute: number;
  timezone: string;
}

/** Oferta/cupom que a campanha carrega (pode ir como variável do template). */
export interface Offer {
  enabled: boolean;
  kind: "cupom" | "brinde" | "frete";
  /** "UHU-{nome}" gera um código único por destinatário. */
  codePattern: string;
  discountLabel: string;
  validUntil: string;
}

export interface CampaignMetrics {
  audience: number;
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  converted: number;
  failed: number;
  optOut: number;
  revenue: number;
}

export interface Campaign {
  id: string;
  name: string;
  objective: CampaignObjective;
  status: CampaignStatus;
  channel: Channel;
  templateId: string;
  segmentIds: string[];
  flowId?: string;
  schedule: Schedule;
  offer: Offer;
  /** "Só sai com aprovação humana" — o gate de envio. */
  requiresApproval: boolean;
  metrics: CampaignMetrics;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  notes?: string;
}

/* ------------------------------------------------------------------- envios */

export type SendStatus = "queued" | "sent" | "delivered" | "read" | "replied" | "failed" | "skipped";

export const SEND_STATUS_LABEL: Record<SendStatus, string> = {
  queued: "Na fila",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  replied: "Respondida",
  failed: "Falhou",
  skipped: "Ignorada",
};

export interface Send {
  id: string;
  campaignId: string;
  contactName: string;
  destination: string;
  templateName: string;
  status: SendStatus;
  at: string;
  couponCode?: string;
  error?: string;
  cost: number;
}

/* -------------------------------------------------------------------- fluxo */

/**
 * Tipos de nó do editor livre. Agrupados em gatilho → descoberta → ação →
 * saída, que é a espinha dorsal de qualquer campanha: de onde vêm as pessoas,
 * quem passa no filtro, o que recebem e por qual canal.
 */
export type NodeType =
  // gatilhos
  | "trigger.manual"
  | "trigger.schedule"
  | "trigger.event"
  // descoberta / audiência
  | "source.segment"
  | "source.contacts"
  | "filter.rules"
  | "action.dedupe"
  | "action.limit"
  // lógica
  | "action.delay"
  | "action.split"
  | "condition.branch"
  | "action.waitReply"
  // mensagem e oferta
  | "action.template"
  | "action.coupon"
  | "action.personalize"
  // saída
  | "action.channel"
  | "action.webhook"
  | "action.handoff"
  // fim
  | "end";

export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  "trigger.manual": "Disparo manual",
  "trigger.schedule": "Agendamento",
  "trigger.event": "Evento recebido",
  "source.segment": "Audiência",
  "source.contacts": "Contatos do CRM",
  "filter.rules": "Regras de descobrimento",
  "action.dedupe": "Remover duplicados",
  "action.limit": "Limitar volume",
  "action.delay": "Esperar",
  "action.split": "Teste A/B",
  "condition.branch": "Condição",
  "action.waitReply": "Aguardar resposta",
  "action.template": "Template Meta",
  "action.coupon": "Cupom personalizado",
  "action.personalize": "Personalizar texto",
  "action.channel": "Canal de saída",
  "action.webhook": "Chamar webhook",
  "action.handoff": "Passar para atendimento",
  end: "Fim",
};

/** Cada tipo de nó guarda a própria configuração; o editor só a edita. */
export type NodeConfig =
  | { type: "trigger.manual"; note?: string }
  | { type: "trigger.schedule"; cron: string; note?: string }
  | { type: "trigger.event"; event: string; note?: string }
  | { type: "source.segment"; segmentId: string }
  | { type: "source.contacts"; source: string }
  | { type: "filter.rules"; combinator: "and" | "or"; rules: SegmentRule[] }
  | { type: "action.dedupe"; key: "phone" | "email" | "contact_id" }
  | { type: "action.limit"; max: number; per: "run" | "day" }
  | { type: "action.delay"; amount: number; unit: "min" | "hour" | "day" }
  | { type: "action.split"; a: number; b: number }
  | { type: "condition.branch"; field: ContactField; operator: SegmentRule["operator"]; value: string }
  | { type: "action.waitReply"; timeoutHours: number; onTimeout: "continue" | "stop" }
  | { type: "action.template"; templateId: string; mapping: Record<string, string> }
  | { type: "action.coupon"; discount: number; kind: Offer["kind"]; perRecipient: boolean; expireDays: number }
  | { type: "action.personalize"; fallbackName: string; tone: "direto" | "caloroso" | "formal" }
  | { type: "action.channel"; channel: Channel; sender: string; throttled: boolean }
  | { type: "action.webhook"; url: string; method: "POST" | "GET" }
  | { type: "action.handoff"; queue: string; slaMinutes: number }
  | { type: "end"; note?: string };

export interface FlowNode {
  id: string;
  type: NodeType;
  title: string;
  /** Posição no canvas (px). O editor arrasta e persiste. */
  x: number;
  y: number;
  config: NodeConfig;
  disabled?: boolean;
}

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  /** Rótulo da saída quando o nó tem mais de uma (A/B, condição). */
  branch?: string;
}

export type FlowStatus = "draft" | "active" | "paused";

export interface Flow {
  id: string;
  name: string;
  description: string;
  status: FlowStatus;
  nodes: FlowNode[];
  edges: FlowEdge[];
  campaignId?: string;
  runs: { total: number; success: number; failed: number };
  lastRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------- conta */

export interface Workspace {
  name: string;
  segment: string;
  site: string;
  timezone: string;
  plan: string;
  /** Número e e-mail que assinam os envios. */
  whatsappNumber: string;
  emailSender: string;
  /** Qualidade do número na Meta: GREEN/YELLOW/RED. */
  quality: "green" | "yellow" | "red";
  messagingLimit: string;
  optInPolicy: string;
  quietHours: { start: number; end: number };
}

export interface User {
  name: string;
  email: string;
  role: string;
}

/* ------------------------------------------------------------------- feed */

export type ActivityKind =
  | "campaign"
  | "template"
  | "flow"
  | "send"
  | "billing"
  | "team"
  /** Ativação/desativação do canal de WhatsApp da conta. */
  | "channel";

export interface ActivityEvent {
  id: string;
  at: string;
  kind: ActivityKind;
  title: string;
  detail: string;
  /** Id do objeto que gerou o evento — vira link quando existe. */
  refId?: string;
}

/* ------------------------------------------------------------------ séries */

export interface MetricPoint {
  date: string;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
}

/** Agregação de período para os cartões do topo do dashboard. */
export type Range = "7d" | "30d" | "90d";
