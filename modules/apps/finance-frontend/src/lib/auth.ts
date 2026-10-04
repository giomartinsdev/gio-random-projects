// Login "Entrar com Google" (Google Identity Services), mesmo desenho do
// clubs-frontend: o SPA renderiza o botão oficial, o Google devolve um ID
// token, e o finance-api troca por um cookie de sessão. Não há Cloudflare
// Access na frente deste host.
import { apiUrl } from "./api";

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

/** Client ID público (vem no bundle; trocar não exige editar o repo). */
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

export interface GoogleAccountsId {
  initialize: (config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
  }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

let gisPromise: Promise<void> | null = null;

/** Carrega o script do Google uma vez por página (inclui o duplo mount do StrictMode). */
export function loadGoogleIdentityScript(): Promise<void> {
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("falha ao carregar o script do Google"));
    document.head.appendChild(script);
  });
  return gisPromise;
}

export function loginConfigurado(): boolean {
  return GOOGLE_CLIENT_ID !== "";
}

export interface SessionInfo {
  authenticated: boolean;
  email?: string;
  name?: string;
  phone?: string;
}

/** Manda o ID token para o finance-api trocar pela sessão. */
export async function loginWithGoogle(credential: string): Promise<SessionInfo> {
  const res = await fetch(apiUrl("/auth/google"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) throw new Error("login com Google falhou");
  return res.json();
}

export async function fetchSession(): Promise<SessionInfo> {
  const res = await fetch(apiUrl("/auth/me"), { credentials: "include" });
  if (!res.ok) return { authenticated: false };
  return res.json();
}

export async function setPhone(phone: string): Promise<SessionInfo> {
  const res = await fetch(apiUrl("/auth/phone"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? "não consegui salvar o número");
  return body;
}

export async function logout(): Promise<void> {
  await fetch(apiUrl("/auth/logout"), { method: "POST", credentials: "include" });
}
