// Catálogo de nós do editor. Cada entrada define a aparência (ícone/cor) e o
// formulário de configuração. O editor é genérico: arrasta, conecta e salva;
// a semântica de cada tipo mora aqui.

import {
  ArrowDownUp,
  CalendarClock,
  Circle,
  Clock,
  Copy,
  Filter,
  GitBranch,
  Layers,
  MessageSquare,
  Plug,
  Send,
  Sparkles,
  Tag as TagIcon,
  Timer,
  UserCheck,
  Users,
  Zap,
  type LucideProps,
} from "lucide-react";
import type { ComponentType } from "react";
import type { NodeConfig, NodeType } from "@/lib/types";

export interface NodeSpec {
  type: NodeType;
  label: string;
  group: "gatilho" | "descoberta" | "mensagem" | "lógica" | "saída" | "fim";
  icon: ComponentType<LucideProps>;
  color: string;
  /** Texto de uma linha mostrado no nó. */
  summary: (config: NodeConfig, ctx: SummaryCtx) => string;
}

export interface SummaryCtx {
  segmentName: (id: string) => string;
  templateName: (id: string) => string;
}

const short = (s: string, n = 34) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const NODE_SPECS: NodeSpec[] = [
  {
    type: "trigger.manual",
    label: "Disparo manual",
    group: "gatilho",
    icon: Zap,
    color: "#7DA6FF",
    summary: () => "você aprova e dispara",
  },
  {
    type: "trigger.schedule",
    label: "Agendamento",
    group: "gatilho",
    icon: CalendarClock,
    color: "#7DA6FF",
    summary: (c) => (c.type === "trigger.schedule" ? `cron ${c.cron}` : ""),
  },
  {
    type: "trigger.event",
    label: "Evento recebido",
    group: "gatilho",
    icon: Plug,
    color: "#7DA6FF",
    summary: (c) => (c.type === "trigger.event" ? short(c.event) : ""),
  },
  {
    type: "source.segment",
    label: "Audiência",
    group: "descoberta",
    icon: Users,
    color: "#16A34A",
    summary: (c, ctx) => (c.type === "source.segment" ? ctx.segmentName(c.segmentId) : ""),
  },
  {
    type: "source.contacts",
    label: "Contatos do CRM",
    group: "descoberta",
    icon: Layers,
    color: "#16A34A",
    summary: (c) => (c.type === "source.contacts" ? short(c.source) : ""),
  },
  {
    type: "filter.rules",
    label: "Regras de descobrimento",
    group: "descoberta",
    icon: Filter,
    color: "#16A34A",
    summary: (c) =>
      c.type === "filter.rules"
        ? `${c.rules.length} ${c.rules.length === 1 ? "regra" : "regras"} · ${c.combinator === "and" ? "todas" : "qualquer"}`
        : "",
  },
  {
    type: "action.dedupe",
    label: "Remover duplicados",
    group: "descoberta",
    icon: Copy,
    color: "#16A34A",
    summary: (c) => (c.type === "action.dedupe" ? `por ${c.key}` : ""),
  },
  {
    type: "action.limit",
    label: "Limitar volume",
    group: "descoberta",
    icon: ArrowDownUp,
    color: "#16A34A",
    summary: (c) => (c.type === "action.limit" ? `${c.max} por ${c.per === "run" ? "execução" : "dia"}` : ""),
  },
  {
    type: "action.template",
    label: "Template Meta",
    group: "mensagem",
    icon: MessageSquare,
    color: "#2563EB",
    summary: (c, ctx) => (c.type === "action.template" ? ctx.templateName(c.templateId) : ""),
  },
  {
    type: "action.coupon",
    label: "Cupom personalizado",
    group: "mensagem",
    icon: TagIcon,
    color: "#2563EB",
    summary: (c) =>
      c.type === "action.coupon" ? `${c.kind === "cupom" ? `${c.discount}%` : c.kind} · único: ${c.perRecipient ? "sim" : "não"}` : "",
  },
  {
    type: "action.personalize",
    label: "Personalizar texto",
    group: "mensagem",
    icon: Sparkles,
    color: "#2563EB",
    summary: (c) => (c.type === "action.personalize" ? `tom ${c.tone}` : ""),
  },
  {
    type: "action.delay",
    label: "Esperar",
    group: "lógica",
    icon: Clock,
    color: "#D97706",
    summary: (c) => (c.type === "action.delay" ? `${c.amount} ${c.unit}` : ""),
  },
  {
    type: "action.split",
    label: "Teste A/B",
    group: "lógica",
    icon: GitBranch,
    color: "#D97706",
    summary: (c) => (c.type === "action.split" ? `${c.a}% / ${c.b}%` : ""),
  },
  {
    type: "condition.branch",
    label: "Condição",
    group: "lógica",
    icon: GitBranch,
    color: "#D97706",
    summary: (c) => (c.type === "condition.branch" ? `${c.field} ${c.operator} ${c.value}` : ""),
  },
  {
    type: "action.waitReply",
    label: "Aguardar resposta",
    group: "lógica",
    icon: Timer,
    color: "#D97706",
    summary: (c) => (c.type === "action.waitReply" ? `${c.timeoutHours}h` : ""),
  },
  {
    type: "action.channel",
    label: "Canal de saída",
    group: "saída",
    icon: Send,
    color: "#A78BFA",
    summary: (c) => (c.type === "action.channel" ? `${c.channel} · ${short(c.sender, 22)}` : ""),
  },
  {
    type: "action.webhook",
    label: "Chamar webhook",
    group: "saída",
    icon: Plug,
    color: "#A78BFA",
    summary: (c) => (c.type === "action.webhook" ? `${c.method} ${short(c.url, 24)}` : ""),
  },
  {
    type: "action.handoff",
    label: "Passar para atendimento",
    group: "saída",
    icon: UserCheck,
    color: "#A78BFA",
    summary: (c) => (c.type === "action.handoff" ? `fila ${c.queue}` : ""),
  },
  {
    type: "end",
    label: "Fim",
    group: "fim",
    icon: Circle,
    color: "#6E6E76",
    summary: (c) => (c.type === "end" ? short(c.note ?? "", 30) : ""),
  },
];

export function specOf(type: NodeType): NodeSpec {
  const spec = NODE_SPECS.find((s) => s.type === type);
  if (!spec) throw new Error(`nó desconhecido: ${type}`);
  return spec;
}

/** Config inicial de cada tipo (ao arrastar do catálogo para o canvas). */
export function defaultConfig(type: NodeType): NodeConfig {
  switch (type) {
    case "trigger.manual":
      return { type, note: "" };
    case "trigger.schedule":
      return { type, cron: "0 9 * * 1-5", note: "" };
    case "trigger.event":
      return { type, event: "pedido.criado", note: "" };
    case "source.segment":
      return { type, segmentId: "" };
    case "source.contacts":
      return { type, source: "CRM · contatos com opt-in" };
    case "filter.rules":
      return { type, combinator: "and", rules: [] };
    case "action.dedupe":
      return { type, key: "phone" };
    case "action.limit":
      return { type, max: 100, per: "run" };
    case "action.delay":
      return { type, amount: 1, unit: "hour" };
    case "action.split":
      return { type, a: 50, b: 50 };
    case "condition.branch":
      return { type, field: "tag", operator: "contains", value: "" };
    case "action.waitReply":
      return { type, timeoutHours: 24, onTimeout: "continue" };
    case "action.template":
      return { type, templateId: "", mapping: {} };
    case "action.coupon":
      return { type, discount: 10, kind: "cupom", perRecipient: true, expireDays: 14 };
    case "action.personalize":
      return { type, fallbackName: "amigo(a)", tone: "direto" };
    case "action.channel":
      return { type, channel: "whatsapp", sender: "+55 11 91234-5678", throttled: true };
    case "action.webhook":
      return { type, url: "https://api.suaempresa.com/hooks/campanha", method: "POST" };
    case "action.handoff":
      return { type, queue: "atendimento", slaMinutes: 30 };
    case "end":
      return { type, note: "" };
  }
}

/** Ícone do grupo, para a paleta do editor. */
export const GROUP_ORDER: NodeSpec["group"][] = ["gatilho", "descoberta", "mensagem", "lógica", "saída", "fim"];

export const GROUP_LABEL: Record<NodeSpec["group"], string> = {
  gatilho: "Gatilho",
  descoberta: "Descoberta",
  mensagem: "Mensagem e oferta",
  lógica: "Lógica e tempo",
  saída: "Saída",
  fim: "Fim",
};
