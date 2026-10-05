// Roteador mínimo por hash: sem dependência, funciona servido de bucket (o
// ingress sempre devolve o index.html) e é testável como função pura. As rotas
// são o mapa do site; clicar em qualquer lugar navega por aqui.
export type Route =
  | { name: "dashboard" }
  | { name: "transactions"; month?: string }
  | { name: "transaction"; id: string }
  | { name: "accounts" }
  | { name: "limits" }
  | { name: "notifications" }
  | { name: "openfinance" }
  | { name: "investments" }
  | { name: "personalize" }
  | { name: "settings" };

export function parseRoute(hash: string): Route {
  const clean = hash.replace(/^#\/?/, "").trim();
  const [head, ...rest] = clean.split("/");
  switch (head) {
    case "":
    case "dashboard":
      return { name: "dashboard" };
    case "transactions":
      return { name: "transactions", month: rest[0] || undefined };
    case "transaction":
      return rest[0] ? { name: "transaction", id: rest[0] } : { name: "transactions" };
    case "accounts":
      return { name: "accounts" };
    case "limits":
      return { name: "limits" };
    case "notifications":
      return { name: "notifications" };
    case "openfinance":
      return { name: "openfinance" };
    case "investments":
      return { name: "investments" };
    case "personalize":
      return { name: "personalize" };
    case "settings":
      return { name: "settings" };
    default:
      return { name: "dashboard" };
  }
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case "dashboard":
      return "#/dashboard";
    case "transactions":
      return route.month ? `#/transactions/${route.month}` : "#/transactions";
    case "transaction":
      return `#/transaction/${route.id}`;
    case "accounts":
      return "#/accounts";
    case "limits":
      return "#/limits";
    case "notifications":
      return "#/notifications";
    case "openfinance":
      return "#/openfinance";
    case "investments":
      return "#/investments";
    case "personalize":
      return "#/personalize";
    case "settings":
      return "#/settings";
  }
}

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route);
}
