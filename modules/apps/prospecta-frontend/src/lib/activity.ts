import type { AgentRunEvent } from "./types";

// Projeção de um evento de /agent/activity para uma linha de feed. Tudo deriva
// do evento real; nada é inventado pelo cliente.
export interface FeedItem {
  at: string;
  verb: string;
  obj: string;
  ctx: string;
}

const STATE_LABEL: Record<string, string> = {
  running: "Rodando",
  done: "Concluiu",
  failed: "Falhou",
  pending: "Aguardando",
};

function clock(at = new Date()): string {
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

export function feedItemFromRun(event: AgentRunEvent): FeedItem {
  const metric = event.metric ? Object.entries(event.metric)[0] : undefined;
  return {
    at: clock(),
    verb: STATE_LABEL[event.state] ?? event.state,
    obj: event.agent,
    ctx: metric ? `${metric[0]} ${metric[1]}` : event.run_id,
  };
}
