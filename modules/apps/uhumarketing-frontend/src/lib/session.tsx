import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type Account } from "./api";
import { clearToken, readToken, writeToken } from "./token";

// Sessão de verdade: quem manda é o uhumarketing-api.
//
// O token é opaco e vive no localStorage — não há cookie httpOnly porque a SPA
// é servida de outra origem em desenvolvimento. O que importa é que o servidor
// resolve o token em usuário + workspace; nada daqui é usado para decidir
// permissão, só para pintar a tela.
export interface SessionUser {
  name: string;
  email: string;
  workspaceId: string;
}

interface SessionState {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string, company: string) => Promise<void>;
  logout: () => void;
}

const USER_KEY = "uhumarketing:session:v2";

const SessionContext = createContext<SessionState | null>(null);

function loadCached(): SessionUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

function cache(user: SessionUser | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // storage indisponível: sessão só nesta aba.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  // No boot, o token é a única verdade: se ele não vale mais, o cache do
  // usuário é descartado. Confiar no localStorage faria a SPA abrir "logada"
  // com um token expirado e só descobrir no primeiro request.
  useEffect(() => {
    let alive = true;

    async function restore() {
      if (!readToken()) {
        cache(null);
        if (alive) {
          setUser(null);
          setLoading(false);
        }
        return;
      }
      try {
        const me = await api.me();
        if (!alive) return;
        const next: SessionUser = { name: me.name, email: me.email, workspaceId: me.workspaceId };
        cache(next);
        setUser(next);
      } catch (err) {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 401) {
          clearToken();
          cache(null);
        } else {
          // Backend fora do ar: mantém o cache para a tela não piscar para o
          // login por causa de uma queda de rede.
          setUser(loadCached());
        }
      } finally {
        if (alive) setLoading(false);
      }
    }

    void restore();
    return () => {
      alive = false;
    };
  }, []);

  const adopt = useCallback((acc: Account) => {
    writeToken(acc.token);
    const next: SessionUser = { name: acc.name, email: acc.email, workspaceId: acc.workspaceId };
    cache(next);
    setUser(next);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      adopt(await api.login(email, password));
    },
    [adopt],
  );

  const signup = useCallback(
    async (name: string, email: string, password: string, company: string) => {
      adopt(await api.signup(name, email, password, company));
    },
    [adopt],
  );

  const logout = useCallback(() => {
    // Revogar no servidor importa: um token que continua válido depois do
    // "sair" é uma sessão que ninguém consegue encerrar.
    void api.logout().catch(() => undefined);
    clearToken();
    cache(null);
    setUser(null);
  }, []);

  return (
    <SessionContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession precisa estar dentro de <SessionProvider>");
  return ctx;
}
