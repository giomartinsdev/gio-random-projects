// financas' own auth: no Cloudflare Access anymore. contas-api verifies
// the Google ID token Identity Services hands us and mints a
// financas_session cookie (Domain=.giomartins.dev) the other 3 backends
// only verify. A visitor's first Google login IS their account creation
// -- there's no separate signup form, no allowlist.
import { CONTAS_API_URL } from "./api/contas";

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

let gisScriptPromise: Promise<void> | null = null;

// loadGoogleIdentityScript loads accounts.google.com/gsi/client exactly
// once per page, however many times callers ask for it (StrictMode
// double-mount included).
export function loadGoogleIdentityScript(): Promise<void> {
  if (gisScriptPromise) return gisScriptPromise;
  gisScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
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
  return gisScriptPromise;
}

// signInWithGoogle hands contas-api the ID token Identity Services just
// produced; contas-api verifies it server-side (signature, issuer,
// audience) and, if valid, sets the financas_session cookie via
// Set-Cookie on this very response -- credentials:"include" is what
// lets the browser keep it.
export async function signInWithGoogle(credential: string): Promise<{ email: string; nome: string }> {
  const res = await fetch(`${CONTAS_API_URL}/api/auth/google`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) {
    throw new Error("login com Google falhou");
  }
  return res.json();
}

// logout clears the financas_session cookie via contas-api -- the only
// service that issues it, so the only one that needs to answer this.
export async function logout(): Promise<void> {
  await fetch(`${CONTAS_API_URL}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

// probeLogin is the identity check the SPA's gate (PortaoLogin) uses:
// no session cookie means a plain 401 now (there's no Access edge to
// intercept the request first), so a simple fetch is enough -- no
// redirect:"manual" trick needed anymore.
export async function probeLogin(): Promise<boolean> {
  try {
    const res = await fetch(`${CONTAS_API_URL}/api/me`, {
      credentials: "include",
      cache: "no-store",
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
