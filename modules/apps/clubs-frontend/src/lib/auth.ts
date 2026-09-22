// Login do FC Clubs Hub: "Entrar com Google" comum, via Google Identity
// Services. Não há Cloudflare Access na frente do clubs-api -- o ID token vem
// do Google e o clubs-api o troca por um cookie de sessão.
//
// O primeiro login de uma conta JÁ É a criação dela: não há formulário de
// cadastro, porque todo dado pessoal do hub é particionado por e-mail.

import { apiUrl } from "./api";

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

/** O client ID é público (aparece em todo ID token e no bundle), então vem de
 * variável de build -- trocá-lo não exige editar este repo. */
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

/** Carrega o script do Google uma única vez por página, por mais que se peça
 * (inclui o duplo mount do StrictMode). */
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

/** Manda o ID token para o clubs-api verificar e trocar pela sessão. O
 * credentials:"include" é o que deixa o browser guardar o cookie que vem
 * no Set-Cookie desta mesma resposta. */
export async function signInWithGoogle(credential: string): Promise<{ email: string; nome: string }> {
  const res = await fetch(`${apiUrl("/api/auth/google")}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) throw new Error("login com Google falhou");
  return res.json();
}

export async function logout(): Promise<void> {
  await fetch(`${apiUrl("/api/auth/logout")}`, { method: "POST", credentials: "include" });
}

/** O client ID está configurado neste build? Sem ele o botão do Google nem
 * renderiza, e a tela de entrada explica em vez de mostrar um botão morto. */
export function loginConfigurado(): boolean {
  return GOOGLE_CLIENT_ID !== "";
}
