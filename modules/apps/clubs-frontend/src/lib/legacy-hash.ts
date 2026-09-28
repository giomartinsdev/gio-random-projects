// Compatibilidade com os links antigos em hash.
//
// A primeira versão da SPA roteava por hash (`#/club?id=141881`). Esses links
// já circularam -- em Discord, em conversa, em histórico de navegador -- e
// quebrá-los seria transformar nossa própria migração em link morto para quem
// recebeu um. Este shim converte um hash conhecido no caminho real equivalente
// e substitui a URL (sem empilhar história), uma vez, no boot.

import { pathFor, type View } from "./routing";

const HASH_TO_ROUTE: Record<string, View["route"]> = {
  "": "home",
  clubs: "clubs",
  club: "club",
  match: "match",
  player: "player",
  players: "players",
  claim: "claim",
  "my-area": "my-area",
  notifications: "notifications",
  admin: "admin",
};

/** Tenta converter o hash atual num caminho. Devolve o caminho novo, ou null
 * quando não há hash (nada a fazer) ou ele não é uma rota conhecida. */
export function legacyHashPath(hash: string): string | null {
  const raw = hash.replace(/^#\/?/, "");
  if (!raw && hash !== "#" && hash !== "#/") return null;
  const [path, query] = raw.split("?");
  const route = HASH_TO_ROUTE[path];
  if (!route) return null;
  const params = new URLSearchParams(query ?? "");
  let param: string | undefined;
  if (route === "club") param = params.get("id") ?? undefined;
  else if (route === "match") param = params.get("m") ?? undefined;
  else if (route === "player") param = params.get("p") ?? undefined;
  return pathFor(param ? { route, param } : { route });
}
