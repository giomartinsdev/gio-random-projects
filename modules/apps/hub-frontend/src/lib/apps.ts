// The hub's whole directory. Two tiers:
//
// - MICROFRONTENDS are the SPAs the renderer opens in its iframe. They
//   stay untouched, standalone apps on their own subdomains -- the hub
//   is only chrome around them (a "renderer"), so adding one here needs
//   zero changes on the app's side.
// - SHORTCUTS are admin surfaces that must NOT be iframed: they're
//   behind Cloudflare Access (which iframes would handle fine, actually)
//   but several set their own X-Frame-Options/CSP -- and a dashboard is
//   better in its own tab anyway. They open in a new tab; the SSO
//   session is shared, so no second login.

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
    id: "cch",
    name: "CCH",
    emoji: "🎴",
    description: "cartas contra a humanidade, sem cadastro",
    url: "https://cch.giomartins.dev",
  },
  {
    id: "buteco-class",
    name: "Buteco Class",
    emoji: "🌭",
    description: "o blog do Buteco dos Devs",
    url: "https://buteco-class.giomartins.dev",
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
    id: "beszel",
    name: "Beszel",
    emoji: "📈",
    description: "saúde da VPS e dos containers",
    url: "https://beszel.giomartins.dev",
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