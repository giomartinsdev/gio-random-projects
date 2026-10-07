import { useEffect, useState } from "react";
import { openActivityStream } from "./api";
import type { AgentRunEvent } from "./types";

// Assina o SSE real de GET /agent/activity. Sem semente: o feed/estado vêm
// exclusivamente dos eventos recebidos; vazio quando não há runs. `enabled`
// evita abrir o stream sem configuração.
export function useActivityStream(enabled: boolean) {
  const [events, setEvents] = useState<AgentRunEvent[]>([]);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setEvents([]);
      setLive(false);
      setError(null);
      return;
    }
    setError(null);
    const handle = openActivityStream(
      (event) => {
        setLive(true);
        setError(null);
        setEvents((prev) => [event, ...prev].slice(0, 50));
      },
      (err) => {
        setLive(false);
        setError(err instanceof Error ? err.message : "conexão de atividade interrompida");
      },
    );
    return () => handle.close();
  }, [enabled]);

  return { events, live, error };
}
