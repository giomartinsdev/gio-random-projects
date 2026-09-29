// Rotas do app: caminhos REAIS, não hash.
//
// Por que mudou: `#/clube?id=…` não é indexável nem gera preview de link. Numa
// comunidade de Pro Clubs, o link de um clube circula em Discord e WhatsApp --
// e um fragmento depois do `#` nunca chega ao servidor, então nem buscador nem
// bot de preview enxergam a página. Com caminho real (`/club/141881`), o nginx
// do ingress já entrega o mesmo `index.html` (a regra que roteia tudo que não
// tem extensão para o index), e o app parseia o pathname.
//
// Este módulo é PURO: recebe uma URL e devolve a view, ou recebe a view e
// devolve o caminho. É o que torna o roteamento testável sem montar o app
// inteiro -- e o que garante que `parse(pathFor(v)) === v` para toda view.

export type RouteId =
  | "home"
  | "clubs"
  | "club"
  | "match"
  | "player"
  | "players"
  | "claim"
  | "my-area"
  | "notifications"
  | "feed"
  | "admin";

export interface View {
  route: RouteId;
  /** Id do alvo, para as rotas de detalhe (clube, partida, jogador). */
  param?: string;
}

/** O segmento de caminho de cada rota de lista. As rotas de detalhe ganham um
 * segundo segmento com o id (ver `pathFor`). */
const LIST_PATHS: Record<Exclude<RouteId, "club" | "match" | "player">, string> = {
  home: "",
  clubs: "clubs",
  players: "players",
  claim: "claim",
  "my-area": "my-area",
  notifications: "notifications",
  feed: "feed",
  admin: "admin",
};

/** As rotas de detalhe e o prefixo do seu caminho. `/club/:id`, `/match/:id`,
 * `/player/:id`. */
const DETAIL_PREFIX: Record<"club" | "match" | "player", string> = {
  club: "club",
  match: "match",
  player: "player",
};

const DETAIL_ROUTES = new Set<RouteId>(["club", "match", "player"]);

/** O caminho para uma view. É a única função que monta URL -- quem navega passa
 * por aqui, então a forma do link vive num lugar só. */
export function pathFor(view: View): string {
  if (DETAIL_ROUTES.has(view.route)) {
    const prefix = DETAIL_PREFIX[view.route as "club" | "match" | "player"];
    // Sem id não há página de detalhe: cai na lista correspondente em vez de
    // gerar um caminho quebrado tipo `/club/`.
    if (!view.param) {
      return view.route === "player" ? "/players" : "/clubs";
    }
    return `/${prefix}/${encodeURIComponent(view.param)}`;
  }
  const seg = LIST_PATHS[view.route as Exclude<RouteId, "club" | "match" | "player">];
  return seg ? `/${seg}` : "/";
}

/** A view de um pathname. Tolerante a barra final e a query string (ignorada:
 * o estado do app não vive mais na URL além do id). Um caminho desconhecido cai
 * na home, que é o comportamento certo para um link velho ou digitado errado. */
export function parsePath(rawPath: string): View {
  // Descarta query e fragmento: o app não guarda estado neles.
  const path = rawPath.split(/[?#]/)[0];
  const segments = path.split("/").filter(Boolean).map(decodeSegment);
  if (segments.length === 0) return { route: "home" };

  const [first, second] = segments;
  switch (first) {
    case "clubs":
      return { route: "clubs" };
    case "club":
      return second ? { route: "club", param: second } : { route: "clubs" };
    case "match":
      return second ? { route: "match", param: second } : { route: "home" };
    case "player":
      return second ? { route: "player", param: second } : { route: "players" };
    case "players":
      return { route: "players" };
    case "claim":
      return { route: "claim" };
    case "my-area":
      return { route: "my-area" };
    case "notifications":
      return { route: "notifications" };
    case "feed":
      return { route: "feed" };
    case "admin":
      return { route: "admin" };
    default:
      return { route: "home" };
  }
}

/** `decodeURIComponent` que não estoura com um `%` solto (link colado torto):
 * devolve o segmento como veio em vez de derrubar o parse inteiro. */
function decodeSegment(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** A view do documento atual. Separada de `parsePath` para o teste cobrir o
 * parse puro sem um jsdom. */
export function currentView(): View {
  return parsePath(window.location.pathname);
}
