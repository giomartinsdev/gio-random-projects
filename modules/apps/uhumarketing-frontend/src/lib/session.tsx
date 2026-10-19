import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

// Sessão mock: não há API. O "login" só grava uma flag no localStorage — a POC
// é sobre o produto, não sobre autenticação. A forma é a mesma de um
// AuthProvider real, então trocar por cookie/API depois não mexe nas telas.
export interface MockUser {
  name: string;
  email: string;
}

interface SessionState {
  user: MockUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string, company: string) => Promise<void>;
  logout: () => void;
}

const SESSION_KEY = "uhumarketing:session:v1";

const SessionContext = createContext<SessionState | null>(null);

function load(): MockUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as MockUser;
  } catch {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MockUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setUser(load());
    setLoading(false);
  }, []);

  const persist = useCallback((u: MockUser | null) => {
    try {
      if (u) localStorage.setItem(SESSION_KEY, JSON.stringify(u));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      // storage indisponível: sessão só nesta aba.
    }
    setUser(u);
  }, []);

  // A "validação" é proposital mas trivial: qualquer e-mail com @ e senha de
  // 4+ entra. A tela mostra as credenciais de demonstração.
  const login = useCallback(
    async (email: string, password: string) => {
      await delay(420);
      if (!email.includes("@") || password.length < 4) {
        throw new Error("Informe um e-mail válido e uma senha de pelo menos 4 caracteres.");
      }
      persist({ name: nameFromEmail(email), email });
    },
    [persist],
  );

  const signup = useCallback(
    async (name: string, email: string, password: string, _company: string) => {
      await delay(560);
      if (!email.includes("@") || password.length < 4) {
        throw new Error("Informe um e-mail válido e uma senha de pelo menos 4 caracteres.");
      }
      persist({ name: name.trim() || nameFromEmail(email), email });
    },
    [persist],
  );

  const logout = useCallback(() => persist(null), [persist]);

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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nameFromEmail(email: string): string {
  const local = email.split("@")[0].replace(/[._-]+/g, " ").trim();
  return local
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(" ");
}
