import { useEffect, useState } from "react";

// Roteamento client-side por hash. Duas zonas:
//   · pública — "/" (hash vazio) é a landing; "#/login"; "#/signup";
//   · app    — "#/app" e "#/app/<tela>" (cockpit/campanha/leads/conversas/
//              configuracoes), protegida por sessão.
// Voltar/avançar do browser funciona de graça e a SPA estática em bucket não
// precisa de rewrite de servidor.
export type AppRoute = "cockpit" | "campanha" | "leads" | "conversas" | "configuracoes";
export type PublicRoute = "landing" | "login" | "signup";
export type Route =
  | { kind: "public"; name: PublicRoute }
  | { kind: "app"; name: AppRoute };

const APP_ROUTES: AppRoute[] = ["cockpit", "campanha", "leads", "conversas", "configuracoes"];

export function defaultAppRoute(): AppRoute {
  return "cockpit";
}

export function parseRoute(hash: string): Route {
  const segments = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (segments[0] === "app") {
    const name = segments[1];
    return { kind: "app", name: (APP_ROUTES as string[]).includes(name) ? (name as AppRoute) : defaultAppRoute() };
  }
  if (segments[0] === "login") return { kind: "public", name: "login" };
  if (segments[0] === "signup") return { kind: "public", name: "signup" };
  return { kind: "public", name: "landing" };
}

function setHash(hash: string): void {
  if (window.location.hash !== hash) window.location.hash = hash;
}

// Navegação do app: qualquer tela vira "#/app/<tela>".
export function navigate(route: AppRoute): void {
  setHash(`#/app/${route}`);
}

export function navigatePublic(route: PublicRoute): void {
  setHash(route === "landing" ? "#/" : `#/${route}`);
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
