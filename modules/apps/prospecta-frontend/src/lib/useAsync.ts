import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

// Hook mínimo de leitura. NÃO injeta dado falso: `data` começa nulo e só é
// preenchido com a resposta real da API. A tela decide o que mostrar em cada
// estado (loading / error / vazio). `enabled=false` pula o fetch (ex.: sem
// configuração ou sem item selecionado) e zera o estado.
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = [], enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const ref = useRef(fn);
  ref.current = fn;

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    ref
      .current()
      .then((value) => {
        if (!alive) return;
        setData(value);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setData(null);
        setError(err instanceof ApiError ? err.message : "erro inesperado");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce, enabled]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}
