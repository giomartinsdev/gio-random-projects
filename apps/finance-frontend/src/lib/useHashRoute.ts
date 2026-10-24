import { useEffect, useState } from "react";
import { parseRoute, type Route } from "./router";

// Assina o hash da URL e devolve a rota atual. Clicar num link `#/…` navega;
// voltar/avançar do browser funciona de graça.
export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
