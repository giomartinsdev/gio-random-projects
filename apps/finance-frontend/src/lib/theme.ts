// Tema claro/escuro: escolha do usuário, padrão = preferência do SO, persistida
// em localStorage e aplicada em <html class="dark">. main.tsx aplica antes de o
// React pintar, então não há flash do tema errado.
//
// Um único ponto de mutação (`setTheme`) notifica os ouvintes — assim o ícone
// do toggle e a ponte com o hub (que manda tema por postMessage) nunca
// divergem do que está na tela.
export type Theme = "light" | "dark";

const STORAGE_KEY = "finance:theme";

export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage desabilitado (modo privado): cai na preferência do SO.
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // A escolha só não sobrevive ao fechar a aba.
  }
}

// Quem reage a mudanças depois que o app subiu: o ícone do toggle e (via
// initHubThemeSync) o que o hub mandou. `setTheme` é o único mutador.
const listeners = new Set<(theme: Theme) => void>();

export function onThemeChange(listener: (theme: Theme) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setTheme(theme: Theme): void {
  saveTheme(theme);
  applyTheme(theme);
  for (const listener of listeners) listener(theme);
}

// O tema atual, para quem só quer ler (o toggle semeia o estado com ele).
export function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}
