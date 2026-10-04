// Tema claro/escuro: escolha do usuário, padrão = preferência do SO, persistida
// em localStorage e aplicada em <html class="dark">. main.tsx roda antes de o
// React pintar, então não há flash do tema errado.
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

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // A escolha só não sobrevive ao fechar a aba.
  }
}

export function setTheme(theme: Theme): void {
  saveTheme(theme);
  applyTheme(theme);
}
