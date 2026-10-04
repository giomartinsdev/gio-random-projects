// A ponte de tema com o hub (hub.giomartins.dev) enquanto este app roda no
// iframe do renderer. Frames cross-origin não compartilham DOM, então os dois
// lados falam postMessage — mesmo desenho do clubs-frontend:
//
// - hub → aqui: { type: "hub:theme", theme } — o toggle do hub foi usado (ou o
//   frame acabou de carregar); aplica e persiste.
// - aqui → hub: { type: "app:theme", theme } — o toggle daqui foi usado; o hub
//   adota (o listener do App dele absorve e re-aplica, sem loop).
import type { Theme } from "./theme";

// As mensagens do hub podem chegar de qualquer subdomínio de giomartins.dev
// (hoje é hub., mas o renderer é quem importa); em dev, de localhost. Um
// origin fora disso é ignorado.
const HUB_ORIGINS = new Set(["https://hub.giomartins.dev"]);

export function trustedParent(origin: string): boolean {
  return HUB_ORIGINS.has(origin) || /^http:\/\/localhost(:\d+)?$/.test(origin);
}

/** O tema que uma mensagem carrega, ou ``null`` se não for uma mensagem de tema válida. */
export function themeFromMessage(data: unknown): Theme | null {
  if (typeof data !== "object" || data === null) return null;
  const msg = data as { type?: unknown; theme?: unknown };
  if (msg.type !== "hub:theme") return null;
  if (msg.theme !== "light" && msg.theme !== "dark") return null;
  return msg.theme;
}

// Liga o listener uma única vez (useEffect do App). No-op quando roda solto
// (sem hub), devolvendo um cleanup no-op. O setter é o do tema, para o toggle
// desta SPA ficar coerente com o que o hub mandou.
export function initHubThemeSync(setTheme: (theme: Theme) => void): () => void {
  if (window.parent === window) return () => {};

  function onMessage(event: MessageEvent) {
    if (!trustedParent(event.origin)) return;
    const theme = themeFromMessage(event.data);
    if (theme === null) return;
    setTheme(theme);
  }

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

// O toggle chama isto depois de aplicar o novo tema, para o hub (quando
// embutidos) acompanhar. targetOrigin "*" porque um filho não conhece a origem
// do pai, e o payload é inerte.
export function broadcastTheme(theme: Theme): void {
  if (window.parent === window) return;
  window.parent.postMessage({ type: "app:theme", theme }, "*");
}
