import { useEffect, useState } from "react";

// Roteamento por hash, como no prospecta: duas zonas.
//   · pública — "/" (landing), "#/login", "#/cadastro";
//   · app     — "#/app/<tela>", protegida por sessão mock.
// Voltar/avançar do navegador funciona de graça e a SPA estática não precisa
// de rewrite de servidor.
export type AppRoute =
  | "dashboard"
  | "templates"
  | "campanhas"
  | "fluxos"
  | "fluxo"
  | "audiencias"
  | "envios"
  | "configuracoes";

export type PublicRoute = "landing" | "login" | "cadastro";

export type Route =
  | { kind: "public"; name: PublicRoute }
  | { kind: "app"; name: AppRoute; param?: string };

const APP_ROUTES: AppRoute[] = [
  "dashboard",
  "templates",
  "campanhas",
  "fluxos",
  "fluxo",
  "audiencias",
  "envios",
  "configuracoes",
];

export function defaultAppRoute(): AppRoute {
  return "dashboard";
}

export function parseRoute(hash: string): Route {
  const segments = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (segments[0] === "app") {
    const name = segments[1];
    return {
      kind: "app",
      name: (APP_ROUTES as string[]).includes(name) ? (name as AppRoute) : defaultAppRoute(),
      param: segments[2],
    };
  }
  if (segments[0] === "login") return { kind: "public", name: "login" };
  if (segments[0] === "cadastro") return { kind: "public", name: "cadastro" };
  return { kind: "public", name: "landing" };
}

function setHash(hash: string): void {
  if (window.location.hash !== hash) window.location.hash = hash;
}

export function navigate(route: AppRoute, param?: string): void {
  setHash(`#/app/${route}${param ? `/${param}` : ""}`);
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
