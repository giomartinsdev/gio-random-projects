import type { Flow, FlowNode, Segment, Template } from "./types";

// Simulação do fluxo. Não executa nada de verdade: percorre o grafo e aplica
// taxas plausíveis para o operador ver ordem de grandeza antes de aprovar.
// É o "testar workflow" do n8n, adaptado para o que importa aqui: quantas
// pessoas entram, quantas recebem, quanto custa e quanto tempo leva.

export interface NodeResult {
  nodeId: string;
  title: string;
  kind: "entrada" | "filtro" | "mensagem" | "espera" | "saída" | "fim";
  in: number;
  out: number;
  note: string;
}

export interface SimulationResult {
  /** Universo inicial somado das origens (audiência/CRM). */
  universe: number;
  /** Quem chega ao canal de saída depois dos filtros. */
  reached: number;
  audience: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  converted: number;
  skipped: number;
  failed: number;
  cost: number;
  revenue: number;
  minutes: number;
  messages: { title: string; body: string }[];
  steps: NodeResult[];
  warnings: string[];
}

const COST = 0.0625;

interface Ctx {
  segments: Segment[];
  templates: Template[];
  throttlePerMinute: number;
}

export function simulateFlow(flow: Flow, ctx: Ctx): SimulationResult {
  const warnings: string[] = [];
  const steps: NodeResult[] = [];
  const messages: { title: string; body: string }[] = [];

  const trigger = flow.nodes.find((n) => n.type.startsWith("trigger.") && !n.disabled);
  if (!trigger) warnings.push("Sem gatilho ativo: o fluxo não tem por onde começar.");

  let audience = 0;
  let universe = 0;
  let filtered = 0;
  let skippedRate = 0;
  let totalMinutes = 0;

  // Caminhada em largura a partir do gatilho (e dos nós soltos, para o
  // operador ver o efeito de um bloco que ele ainda não conectou).
  const order = walk(flow, trigger?.id);
  const seen = new Set<string>();

  for (const node of order) {
    seen.add(node.id);
    const before = audience + filtered;
    const result = applyNode(node, ctx, {
      audience,
      filtered,
      skippedRate,
      totalMinutes,
      warnings,
      messages,
    });
    audience = result.audience;
    universe = Math.max(universe, audience);
    filtered = result.filtered;
    skippedRate = result.skippedRate;
    totalMinutes = result.totalMinutes;

    steps.push({
      nodeId: node.id,
      title: node.title,
      kind: kindOf(node),
      in: before,
      out: audience + filtered,
      note: result.note,
    });
  }

  // Nós que existem mas não são alcançáveis pelo gatilho.
  for (const node of flow.nodes) {
    if (!seen.has(node.id) && !node.disabled) {
      warnings.push(`"${node.title}" não está conectado ao gatilho e não vai rodar.`);
    }
  }

  // No canal, parte da lista é descartada (opt-out, sem consentimento); só o
  // resto vira envio de fato.
  const skipped = Math.round(filtered * skippedRate);
  const sent = filtered - skipped;
  const delivered = Math.round(sent * 0.972);
  const read = Math.round(delivered * 0.79);
  const replied = Math.round(read * 0.14);
  const converted = Math.round(read * 0.085);
  const failed = sent - delivered;
  const minutes = Math.round(totalMinutes + sent / Math.max(1, ctx.throttlePerMinute));

  return {
    universe: universe || audience + filtered,
    reached: filtered,
    audience: audience + filtered,
    sent,
    delivered,
    read,
    replied,
    converted,
    skipped,
    failed,
    cost: sent * COST,
    revenue: converted * 96,
    minutes,
    messages,
    steps,
    warnings,
  };
}

function kindOf(node: FlowNode): NodeResult["kind"] {
  if (node.type.startsWith("trigger.")) return "entrada";
  if (node.type.startsWith("source.") || node.type === "filter.rules" || node.type === "action.dedupe") return "filtro";
  if (node.type === "action.limit") return "filtro";
  if (node.type === "action.template" || node.type === "action.coupon" || node.type === "action.personalize")
    return "mensagem";
  if (node.type === "action.delay" || node.type === "action.waitReply" || node.type === "action.split" || node.type === "condition.branch")
    return "espera";
  if (node.type === "action.channel" || node.type === "action.webhook" || node.type === "action.handoff") return "saída";
  return "fim";
}

/** Ordem de visita: BFS pelo grafo (o que o n8n faz na execução). */
function walk(flow: Flow, startId?: string): FlowNode[] {
  if (!startId) return flow.nodes.filter((n) => !n.disabled);
  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const out: FlowNode[] = [];
  const visited = new Set<string>();
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const node = byId.get(id);
    if (!node || node.disabled) continue;
    out.push(node);
    for (const edge of flow.edges.filter((e) => e.from === id)) queue.push(edge.to);
  }
  return out;
}

function applyNode(
  node: FlowNode,
  ctx: Ctx,
  state: {
    audience: number;
    filtered: number;
    skippedRate: number;
    totalMinutes: number;
    warnings: string[];
    messages: { title: string; body: string }[];
  },
): { audience: number; filtered: number; skippedRate: number; totalMinutes: number; note: string } {
  const c = node.config;

  switch (c.type) {
    case "source.segment": {
      const segment = ctx.segments.find((s) => s.id === c.segmentId);
      const count = segment?.contactsCount ?? 0;
      if (!segment) state.warnings.push(`"${node.title}": nenhuma audiência escolhida.`);
      return {
        ...state,
        audience: state.audience + count,
        note: segment ? `${segment.name} · ${count} contatos` : "audiência vazia",
      };
    }
    case "source.contacts": {
      return { ...state, audience: state.audience + 500, note: "500 contatos do CRM" };
    }
    case "filter.rules": {
      const keep = Math.max(0.2, 1 - c.rules.length * 0.08);
      const before = state.audience + state.filtered;
      const kept = Math.round(before * keep);
      return {
        ...state,
        audience: 0,
        filtered: kept,
        note: `${c.rules.length} ${c.rules.length === 1 ? "regra" : "regras"} · ${Math.round(keep * 100)}% passam`,
      };
    }
    case "action.dedupe": {
      const before = state.audience + state.filtered;
      const kept = Math.round(state.filtered * 0.96);
      return { ...state, audience: 0, filtered: kept, note: `${before - kept} duplicados removidos` };
    }
    case "action.limit": {
      const capped = Math.min(state.filtered || state.audience, c.max);
      return { ...state, audience: 0, filtered: capped, note: `limitado a ${c.max}` };
    }
    case "condition.branch": {
      const kept = Math.round(state.filtered * 0.6);
      return { ...state, filtered: kept, note: `${Math.round(kept * 100 / Math.max(1, state.filtered))}% no ramo "sim"` };
    }
    case "action.delay": {
      const minutes = c.unit === "min" ? c.amount : c.unit === "hour" ? c.amount * 60 : c.amount * 1440;
      return { ...state, totalMinutes: state.totalMinutes + minutes, note: `+${c.amount} ${c.unit}` };
    }
    case "action.waitReply": {
      return {
        ...state,
        totalMinutes: state.totalMinutes + c.timeoutHours * 60,
        note: `espera até ${c.timeoutHours}h por resposta`,
      };
    }
    case "action.template": {
      const template = ctx.templates.find((t) => t.id === c.templateId);
      if (!template) {
        state.warnings.push(`"${node.title}": template não escolhido.`);
      } else if (template.status !== "approved") {
        state.warnings.push(`"${node.title}": ${template.name} não está aprovado pela Meta.`);
      } else {
        state.messages.push({ title: template.displayName, body: renderSample(template, c.mapping) });
      }
      return { ...state, note: template ? template.name : "nenhum template" };
    }
    case "action.coupon": {
      return { ...state, note: c.kind === "cupom" ? `${c.discount}% · ${c.perRecipient ? "único" : "compartilhado"}` : c.kind };
    }
    case "action.split": {
      return { ...state, note: `A ${c.a}% · B ${c.b}%` };
    }
    case "action.personalize":
      return { ...state, note: `tom ${c.tone} · fallback "${c.fallbackName}"` };
    case "action.handoff":
      return { ...state, note: `${c.queue} · SLA ${c.slaMinutes} min` };
    case "action.webhook":
      return { ...state, note: `${c.method} ${c.url.replace(/^https?:\/\//, "").slice(0, 32)}` };
    case "end":
      return { ...state, note: "encerra a execução" };
    case "action.channel": {
      const reaching = state.filtered || state.audience;
      return {
        ...state,
        audience: 0,
        filtered: reaching,
        skippedRate: 0.012,
        note: `${reaching} contatos · ${c.channel}`,
      };
    }
    default:
      return { ...state, note: "" };
  }
}

/** Troca {{n}} pelo valor mapeado (ou pelo exemplo do template). */
function renderSample(template: Template, mapping: Record<string, string>): string {
  const VALUES: Record<string, string> = {
    primeiro_nome: "Ana",
    cupom: "VOLTA-ANA",
    desconto: "15%",
    validade: "30/11",
    origem: "Etiópia Guji",
    notas: "jasmim e pêssego",
    sacas: "80",
    resumo_carrinho: "2 itens",
    id_carrinho: "c_4821",
    produto: "Aurora Blend 250g",
  };
  return template.body.replace(/\{\{(\d+)\}\}/g, (_, i: string) => {
    const key = mapping[i];
    if (key && VALUES[key]) return VALUES[key];
    return template.variables.find((v) => v.index === i)?.example ?? `{{${i}}}`;
  });
}
