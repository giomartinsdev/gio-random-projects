import type { Flow } from "./types";

// Validação do fluxo antes de publicar. Cada regra existe porque o envio real
// quebraria (ou a Meta barraria) sem ela. A tela mostra a lista no topo do
// editor — erro impede ativar; aviso deixa ativar, mas fica visível.

export type IssueLevel = "error" | "warn" | "ok";

export interface Issue {
  level: IssueLevel;
  text: string;
  nodeId?: string;
}

export function validateFlow(flow: Flow, templateStatus: (id: string) => string | undefined): Issue[] {
  const issues: Issue[] = [];
  const enabled = flow.nodes.filter((n) => !n.disabled);
  const triggers = enabled.filter((n) => n.type.startsWith("trigger."));

  if (triggers.length === 0) {
    issues.push({ level: "error", text: "Falta um gatilho: sem ele o fluxo não começa." });
  }
  if (triggers.length > 1) {
    issues.push({ level: "warn", text: `Há ${triggers.length} gatilhos. O fluxo vai rodar uma vez por gatilho.` });
  }

  const sources = enabled.filter((n) => n.type === "source.segment" || n.type === "source.contacts");
  if (sources.length === 0) {
    issues.push({ level: "error", text: "Falta uma origem de audiência (ou contatos do CRM)." });
  }

  const templateNode = enabled.find((n) => n.type === "action.template");
  if (!templateNode) {
    issues.push({ level: "error", text: "Falta o nó de template: o fluxo não tem o que enviar." });
  } else if (templateNode.config.type === "action.template") {
    const id = templateNode.config.templateId;
    if (!id) {
      issues.push({ level: "error", text: "O nó de template está sem template escolhido.", nodeId: templateNode.id });
    } else if (templateStatus(id) !== "approved") {
      issues.push({
        level: "error",
        text: `O template escolhido não está aprovado (${templateStatus(id) ?? "inexistente"}).`,
        nodeId: templateNode.id,
      });
    }
  }

  const channelNode = enabled.find((n) => n.type === "action.channel");
  if (!channelNode) {
    issues.push({ level: "error", text: "Falta um canal de saída: sem ele a mensagem não sai." });
  }

  for (const node of enabled) {
    if (node.type === "end") continue;
    if (!flow.edges.some((e) => e.from === node.id)) {
      issues.push({ level: "warn", text: `"${node.title}" não aponta para nenhum próximo nó.`, nodeId: node.id });
    }
  }

  // Alcançáveis a partir do gatilho.
  if (triggers.length > 0) {
    const reachable = new Set<string>();
    const queue = triggers.map((t) => t.id);
    while (queue.length) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const e of flow.edges.filter((x) => x.from === id)) queue.push(e.to);
    }
    for (const node of enabled) {
      if (!reachable.has(node.id)) {
        issues.push({ level: "warn", text: `"${node.title}" está solto, fora do caminho do gatilho.`, nodeId: node.id });
      }
    }
  }

  for (const node of enabled) {
    if (node.config.type === "filter.rules") {
      const empty = node.config.rules.filter((r) => !r.value.trim());
      if (empty.length > 0) {
        issues.push({
          level: "warn",
          text: `"${node.title}" tem ${empty.length} ${empty.length === 1 ? "regra" : "regras"} sem valor — elas não filtram nada.`,
          nodeId: node.id,
        });
      }
    }
    if (node.config.type === "action.channel" && !node.config.sender.trim()) {
      issues.push({ level: "error", text: `"${node.title}" está sem remetente.`, nodeId: node.id });
    }
  }

  if (issues.every((i) => i.level !== "error")) {
    issues.unshift({ level: "ok", text: "Sem erros: dá para publicar." });
  }

  return issues;
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.level === "error");
}
