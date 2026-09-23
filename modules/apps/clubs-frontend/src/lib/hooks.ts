// Hooks de sessão, tema e sincronização.
//
// O hub é usável sem login: o estado de visitante é o padrão e o login é
// opt-in. `useAuth` só responde "estou autenticado?" — é o mesmo probe do
// /sso do hub e do /api/me do bet-api, sem redirect.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { logout } from "./auth";
import type { SyncRun } from "./types";

export interface Session {
  autenticado: boolean | null; // null = ainda sondando
  email: string;
  refresh: () => void;
}

export function useAuth(): Session {
  const [autenticado, setAutenticado] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");

  const refresh = useCallback(() => {
    api
      .me()
      .then((r) => {
        setAutenticado(true);
        setEmail(r.email);
      })
      .catch((err) => {
        // 401 é a resposta esperada para quem não entrou — não é erro.
        setAutenticado(err instanceof ApiError && err.status === 401 ? false : false);
      });
  }, []);

  useEffect(refresh, [refresh]);
  return { autenticado, email, refresh };
}

/** Encerra a sessão no servidor e recarrega: sem cookie, o hub volta ao
 * estado de visitante sem quebrar a tela em que a pessoa estava. */
export async function sair(): Promise<void> {
  try {
    await logout();
  } finally {
    window.location.reload();
  }
}

// --- tema -----------------------------------------------------------------

export type Theme = "dark" | "light";

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem("clubs.theme");
    return saved === "light" ? "light" : "dark";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("clubs.theme", theme);
  }, [theme]);

  return { theme, setTheme: setThemeState };
}

// --- sincronização em segundo plano ---------------------------------------

/**
 * Polling do progresso da sincronização. O backend é quem faz o trabalho; isto
 * só desenha o indicador — e nunca bloqueia a navegação.
 */
export function useSyncStatus(enabled: boolean) {
  const [run, setRun] = useState<SyncRun | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setRun(null);
      return;
    }
    let cancelled = false;

    const tick = async () => {
      try {
        const s = await api.syncStatus();
        if (cancelled) return;
        setRun(s);
        // Continua pollando enquanto houver trabalho; para quando termina.
        if (s.running) {
          timer.current = window.setTimeout(tick, 1500);
        }
      } catch {
        // Silencioso: um indicador que falha não pode virar erro de tela.
      }
    };
    tick();

    return () => {
      cancelled = true;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [enabled]);

  const start = useCallback(async () => {
    try {
      await api.startSync();
      setRun((prev) => (prev ? { ...prev, running: true, skill_rating: 1 } : prev));
    } catch {
      // idem
    }
  }, []);

  return { run, start };
}
