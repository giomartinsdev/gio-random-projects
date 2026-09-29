// Hooks de sessão, tema e sincronização.
//
// O hub é usável sem login: o estado de visitante é o padrão e o login é
// opt-in. `useAuth` só responde "estou autenticado?" — é o mesmo probe do
// /sso do hub e do /api/me do bet-api, sem redirect.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { logout } from "./auth";
import type { SourceStatus, SyncRun } from "./types";

export interface Session {
  autenticado: boolean | null; // null = ainda sondando
  email: string;
  /** Quem pode ver a administração. Vem do servidor (`/me` -> is_admin), e é
   * só para decidir se MOSTRA a aba -- a autoridade é a rota, que responde 403. */
  isAdmin: boolean;
  refresh: () => void;
}

export function useAuth(): Session {
  const [autenticado, setAutenticado] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const refresh = useCallback(() => {
    api
      .me()
      .then((r) => {
        setAutenticado(true);
        setEmail(r.email);
        setIsAdmin(!!r.is_admin);
      })
      .catch((err) => {
        // 401 é a resposta esperada para quem não entrou — não é erro.
        setAutenticado(err instanceof ApiError && err.status === 401 ? false : false);
        setIsAdmin(false);
      });
  }, []);

  useEffect(refresh, [refresh]);
  return { autenticado, email, isAdmin, refresh };
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

// --- busca rápida (⌘K) ----------------------------------------------------

/**
 * O atalho de busca: ⌘K no macOS, Ctrl+K no resto. `metaKey || ctrlKey` cobre
 * os dois com um binding só -- exigir a tecla "certa" por sistema obrigaria a
 * detectar plataforma, o que dá errado em teclado externo e no iPad.
 *
 * Ignora quando o foco já está num campo: digitar "k" num input é digitar, não
 * pedir busca.
 */
export function useCommandPalette(): { open: boolean; setOpen: (v: boolean) => void } {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      const digitando =
        alvo &&
        (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (digitando) return;
      if (e.key === "/" ) {
        // "/" também abre -- é o atalho de busca de vários apps, e não conflita
        // com nada porque só vale fora de um campo.
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { open, setOpen };
}

// --- saúde da fonte -------------------------------------------------------

/**
 * Sonda a saúde da fonte (EA/CDN) de tempos em tempos.
 *
 * Quando a fornecedora dos dados está fora, a interface precisa dizer isso, em
 * vez de mostrar o vazio como se fosse resposta. O polling é lento de
 * propósito: é um estado de infraestrutura, muda em minutos, e a tela não
 * pode gastar requisição por nada. Se a sonda falhar (o próprio backend fora),
 * o silêncio é o certo -- um aviso errado é pior que nenhum.
 */
export function useSourceStatus(): SourceStatus | null {
  const [status, setStatus] = useState<SourceStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await api.sourceStatus();
        if (!cancelled) setStatus(s);
      } catch {
        // Silencioso: um indicador que falha não vira erro de tela.
      }
    };
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return status;
}
