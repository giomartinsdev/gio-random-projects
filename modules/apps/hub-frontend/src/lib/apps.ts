// The hub's whole directory. Two tiers:
//
// - MICROFRONTENDS are the SPAs the renderer opens in its iframe. They
//   stay untouched, standalone apps on their own subdomains -- the hub
//   is only chrome around them (a "renderer"), so adding one here
//   needs zero changes on the app's side. The one thing they can opt
//   into is the theme bridge (their lib/hubTheme.ts, our Renderer):
//   while embedded, whatever theme the hub is in, the app follows.
// - SHORTCUTS are admin surfaces that must NOT be iframed: several
//   set their own X-Frame-Options/CSP, and a dashboard is better in
//   its own tab anyway. They only render once the visitor logged in
//   with Google (lib/auth.ts probes the /sso Access endpoint) -- and
//   logging in here doesn't pre-auth those hostnames either: each is
//   its own Cloudflare Access application, so the first click still
//   runs a one-click Google confirmation on their domain.

export type Microfrontend = {
  id: string; // also the deep-link hash: hub.giomartins.dev/#/cch
  name: string;
  emoji: string;
  description: string;
  url: string;
};

export type Shortcut = {
  id: string;
  name: string;
  emoji: string;
  description: string;
  url: string;
};

export const MICROFRONTENDS: Microfrontend[] = [
  {
    id: "tela",
    name: "Tela",
    emoji: "📺",
    description: "compartilhe sua tela por código de sala",
    url: "https://tela.giomartins.dev",
  },
  {
    id: "clubs",
    name: "FC Clubs",
    emoji: "⚽",
    description: "rankings de clubes e jogadores, e o histórico que a EA não guarda",
    url: "https://clubs.giomartins.dev",
  },
];

export const SHORTCUTS: Shortcut[] = [
  {
    id: "grafana",
    name: "Grafana",
    emoji: "📊",
    description: "dashboards e métricas",
    url: "https://grafana.giomartins.dev",
  },
  {
    id: "minio",
    name: "MinIO",
    emoji: "🪣",
    description: "buckets e objetos",
    url: "https://minio.giomartins.dev",
  },
  {
    id: "dockhand",
    name: "Dockhand",
    emoji: "🐳",
    description: "containers, stacks e imagens",
    url: "https://dockhand.giomartins.dev",
  },
  {
    id: "adminer",
    name: "Adminer",
    emoji: "🗄️",
    description: "banco de dados (Postgres)",
    url: "https://adminer.giomartins.dev",
  },
  {
    id: "vault",
    name: "Vaultwarden",
    emoji: "🔐",
    description: "cofre de segredos",
    url: "https://vault.giomartins.dev",
  },
  {
    id: "ai",
    name: "9router",
    emoji: "🤖",
    description: "proxy de IA e seus modelos",
    url: "https://ai.giomartins.dev/dashboard",
  },
];

// Hash shape: "#/tela" -- one flat namespace, no router dependency. An
// unknown or missing id means home.
export function appIdFromHash(hash: string): string | null {
  const id = hash.replace(/^#\/?/, "").trim();
  if (!id) return null;
  return MICROFRONTENDS.some((app) => app.id === id) ? id : null;
}

export function findApp(id: string | null): Microfrontend | null {
  if (!id) return null;
  return MICROFRONTENDS.find((app) => app.id === id) ?? null;
}

// The origins the renderer trusts theme messages from (a frame
// reporting its own toggle change back to us).
export function microfrontendOrigins(): string[] {
  return MICROFRONTENDS.map((app) => new URL(app.url).origin);
}