// Login com Google (Google Identity Services). Mesmo desenho do
// finance-frontend/clubs-frontend: a SPA carrega o script oficial, renderiza o
// botão do Google e recebe um ID token; a prospecta-api troca esse token pela
// sessão (POST /auth/google). Sem client ID o botão não aparece — nunca um
// botão morto.
import type { GoogleSignupDraft } from "./types";

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

/** Client ID público (vem no bundle; trocar não exige editar o repo). */
export const GOOGLE_CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? "";

/** O produto só oferece Google quando o cliente OAuth está configurado. */
export function googleConfigurado(): boolean {
  return GOOGLE_CLIENT_ID.trim() !== "";
}

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

// Botão oficial do Google: `filled_black` casa com as telas dark, `pill` com os
// botões do design system. A largura é fixa (o GIS desenha dentro de um iframe).
export const GOOGLE_BUTTON_OPTIONS: Record<string, unknown> = {
  type: "standard",
  theme: "filled_black",
  size: "large",
  shape: "pill",
  text: "continue_with",
  locale: "pt-BR",
  width: 320,
};

// Rascunho do usuário novo entre o /auth/google (sem cookie) e a conclusão do
// cadastro. Vive só em memória (sessionStorage) — o ID token é sensível e não
// deve sobreviver a um reload longo nem ir para o localStorage.
const DRAFT_KEY = "prospecta:google-draft";

export function setGoogleDraft(draft: GoogleSignupDraft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // storage indisponível: o fluxo segue no estado local do SignupPage.
  }
}

export function getGoogleDraft(): GoogleSignupDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GoogleSignupDraft>;
    if (!parsed.email || !parsed.name || !parsed.google_credential) return null;
    return { email: parsed.email, name: parsed.name, google_credential: parsed.google_credential };
  } catch {
    return null;
  }
}

export function clearGoogleDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

// Como este dispositivo entrou da última vez. Serve de pista local para saber
// se a conta é só-Google (o backend pode não reportar `has_password`), sem
// inventar estado do servidor: é só uma marca do navegador.
const METHOD_KEY = "prospecta:auth-method";

export function markGoogleSession(): void {
  try {
    localStorage.setItem(METHOD_KEY, "google");
  } catch {
    // ignore
  }
}

export function markPasswordSession(): void {
  try {
    localStorage.setItem(METHOD_KEY, "password");
  } catch {
    // ignore
  }
}

export function isGoogleSession(): boolean {
  try {
    return localStorage.getItem(METHOD_KEY) === "google";
  } catch {
    return false;
  }
}


