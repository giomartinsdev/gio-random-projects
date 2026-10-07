import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

// Hook mínimo de leitura: dispara o fetcher e, enquanto ele não resolve (ou se
// a API estiver fora do ar), devolve o `fallback` — que é a projeção do
// design. Assim a SPA nunca aparece vazia e degrada com elegância.
export function useAsync<T>(fn: () => Promise<T>, fallback: T, deps: unknown[] = []) {
  const [data, setData] = useState<T>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const ref = useRef(fn);
  ref.current = fn;

  useEffect(() => {
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
        setError(err instanceof ApiError ? err.message : "erro inesperado");
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}
