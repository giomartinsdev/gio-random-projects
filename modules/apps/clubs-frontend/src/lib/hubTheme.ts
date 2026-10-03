// A ponte de tema com o hub (hub.giomartins.dev) enquanto este app roda
// embutido no iframe do renderer. Frames cross-origin não compartilham
// DOM, então os dois lados falam postMessage:
//
// - hub → aqui: { type: "hub:theme", theme } — o toggle do hub foi usado
//   (ou um frame novo acabou de carregar); aplica e persiste, para uma
//   visita solta depois comecar de onde o hub deixou.
// - aqui → hub: { type: "app:theme", theme } — o toggle daqui foi usado;
//   o hub adota (veja o Renderer/App dele).
//
// Mesmo desenho de cch-frontend/bet-frontend (não há pacote compartilhado
// neste repo).
import type { Theme } from "./hooks";

function trustedParent(origin: string): boolean {
  return (
    origin === "https://hub.giomartins.dev" || /^http:\/\/localhost(:\d+)?$/.test(origin)
  );
}

// Liga o listener uma única vez (useEffect do App). No-op — e devolve um
// cleanup no-op — rodando solto, onde não há hub com quem sincronizar.
// O setter é o do useTheme: usar ele (e não escrever no dataset direto)
// mantém o toggle desta SPA coerente com o que o hub mandou.
export function initHubThemeSync(setTheme: (theme: Theme) => void): () => void {
  if (window.parent === window) return () => {};

  function onMessage(event: MessageEvent) {
    if (!trustedParent(event.origin)) return;
    const data = event.data as { type?: string; theme?: string } | null;
    if (data?.type !== "hub:theme") return;
    if (data.theme !== "light" && data.theme !== "dark") return;
    setTheme(data.theme as Theme);
  }

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

// O toggle chama isto depois de aplicar o novo tema, para o hub (quando
// estamos embutidos nele) acompanhar. targetOrigin é "*" porque um filho
// não sabe a origem do pai, e o payload é inerte.
export function broadcastTheme(theme: Theme) {
  if (window.parent === window) return;
  window.parent.postMessage({ type: "app:theme", theme }, "*");
}