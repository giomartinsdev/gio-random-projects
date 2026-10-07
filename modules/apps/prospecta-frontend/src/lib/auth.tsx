import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import type { AuthSession, AuthUser, Company, LoginInput, SignupInput } from "./types";

// Sessão do modo cliente: cookie HttpOnly mantido pela prospecta-api. No boot
// chamamos GET /auth/me; 401 simplesmente significa "deslogado". O modo
// operador (X-API-Key + companyId no localStorage) continua existindo em
// paralelo — este contexto não mexe nele.
export interface AuthState {
  user: AuthUser | null;
  company: Company | null;
  loading: boolean;
  login: (input: LoginInput) => Promise<void>;
  signup: (input: SignupInput) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setSession(await api.me());
    } catch (err) {
      // 401 = deslogado; qualquer outro erro (API fora do ar) também cai aqui:
      // a sessão local é limpa e a guarda manda para o login.
      if (!(err instanceof ApiError)) throw err;
      setSession(null);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .me()
      .then((s) => alive && setSession(s))
      .catch(() => alive && setSession(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    setSession(await api.login(input));
  }, []);

  const signup = useCallback(async (input: SignupInput) => {
    setSession(await api.signup(input));
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setSession(null);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        company: session?.company ?? null,
        loading,
        login,
        signup,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>");
  return ctx;
}
