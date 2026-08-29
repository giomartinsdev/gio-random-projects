import { Badge } from "../ui/index.js";

// The three live-states a room can be in, driven by plain booleans so
// the pages don't each reimplement the labels. liveLabel lets Aulas
// say "aula ao vivo" where the book club needs nothing.
export function RoomStatusBadge({ connected, closed, liveLabel = "ao vivo" }: { connected: boolean; closed: boolean; liveLabel?: string }) {
  if (closed) return <Badge tone="muted">encerrada · somente leitura</Badge>;
  if (!connected) return <Badge tone="neutral">conectando…</Badge>;
  return <Badge tone="live">{liveLabel}</Badge>;
}