// Alterna <html data-theme>. Papel (claro) é o padrão agora -- a
// identidade editorial pedida (referência: orchid.ai) é essencialmente
// clara; escuro fica disponível como alternativa para quem preferir.
// Mesmo padrão de aplicar antes do primeiro paint que hub-frontend/
// tela-frontend usam, para não piscar a paleta errada.
export type Theme = "dark" | "light";

const STORAGE_KEY = "financas.theme";

export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // localStorage indisponível (modo privado etc.) -- cai no padrão.
  }
  return "light";
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.dataset.theme = "dark";
  } else {
    delete root.dataset.theme;
  }
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignora -- tema só não persiste entre sessões nesse navegador.
  }
}

export function toggleTheme(current: Theme): Theme {
  const next: Theme = current === "light" ? "dark" : "light";
  applyTheme(next);
  return next;
}

// Tokens de identidade visual reaproveitados fora do CSS (ex.: cor de
// stroke de SVG nos blocos do dashboard, que não pode ler var(--x) via
// Tailwind class). Mantidos em HSL cru para casar com index.css.
export const tokens = {
  radius: "0.5rem",
  chart: {
    linha: "hsl(14 68% 55%)",
    linhaSecundaria: "hsl(30 6% 45%)",
    positivo: "hsl(92 32% 48%)",
    negativo: "hsl(6 72% 55%)",
    grade: "hsl(30 6% 24%)",
    categorias: [
      "hsl(14 68% 55%)",
      "hsl(38 55% 55%)",
      "hsl(92 32% 48%)",
      "hsl(190 30% 45%)",
      "hsl(30 6% 55%)",
      "hsl(6 55% 50%)",
    ],
  },
};
