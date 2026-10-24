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
    id: "finance",
    name: "Finance",
    emoji: "💳",
    description: "gestão financeira: registre e acompanhe pelas mensagens do WhatsApp",
    url: "https://finance.giomartins.dev",
  },
];

// Order is by "what you'd open first", not alphabetical: the control
// planes of the cluster, then the data layer, then the products.
//
// Removed on purpose (they 404/refuse after the k8s migration and would
// give a dead SSO round-trip): dockhand (container at :8093 is gone --
// every stack now lives in k8s/) and maus (OpenMausBot decommissioned).
export const SHORTCUTS: Shortcut[] = [
  {
    id: "rancher",
    name: "Rancher",
    emoji: "🐄",
    description: "plano de controle do cluster k3s",
    url: "https://rancher.giomartins.dev",
  },
  {
    id: "argo",
    name: "ArgoCD",
    emoji: "🔁",
    description: "sync, diff e rollback do GitOps",
    url: "https://argo.giomartins.dev",
  },
  {
    id: "grafana",
    name: "Grafana",
    emoji: "📊",
    description: "dashboards, métricas e alertas",
    url: "https://grafana.giomartins.dev",
  },
  {
    id: "github",
    name: "GitHub",
    emoji: "🐙",
    description: "código dos apps e manifests do cluster",
    url: "https://github.com/giomartinsdev/gio-random-projects",
  },
  {
    id: "minio",
    name: "MinIO",
    emoji: "🪣",
    description: "buckets e objetos",
    url: "https://minio.giomartins.dev",
  },
  {
    id: "adminer",
    name: "Adminer",
    emoji: "🗄️",
    description: "banco de dados (Postgres)",
    url: "https://adminer.giomartins.dev",
  },
  {
    id: "rabbit",
    name: "RabbitMQ",
    emoji: "🐰",
    description: "filas, exchanges e conexões do bus",
    url: "https://rabbit.giomartins.dev",
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
  {
    id: "evolution",
    name: "Evolution",
    emoji: "💬",
    description: "instâncias do WhatsApp e seus webhooks",
    url: "https://evolution.giomartins.dev/manager",
  },
  {
    id: "draw",
    name: "Draw",
    emoji: "✏️",
    description: "lousa de diagramas (Excalidraw)",
    url: "https://draw.giomartins.dev",
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