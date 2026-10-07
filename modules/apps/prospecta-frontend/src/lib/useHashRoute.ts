import { useEffect, useState } from "react";

// Roteamento client-side simples por hash (#/cockpit, #/leads…). Voltar/avançar
// do browser funciona de graça e a SPA estática em bucket não precisa de
// rewrite de servidor.
export type RouteName = "cockpit" | "campanha" | "leads" | "conversas" | "configuracoes";

const ROUTES: RouteName[] = ["cockpit", "campanha", "leads", "conversas", "configuracoes"];

export function parseRoute(hash: string): RouteName {
  const name = hash.replace(/^#\/?/, "").split("/")[0];
  return (ROUTES as string[]).includes(name) ? (name as RouteName) : "cockpit";
}

export function navigate(route: RouteName): void {
  if (window.location.hash !== `#/${route}`) window.location.hash = `#/${route}`;
}

export function useHashRoute(): RouteName {
  const [route, setRoute] = useState<RouteName>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
