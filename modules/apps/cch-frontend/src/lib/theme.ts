// The viewer's light/dark choice. Defaults to the OS preference, sticks
// in localStorage (losing it just means the toggle flips back), and is
// applied to <html data-theme> -- main.tsx runs it before React paints
// anything, so there's no flash of the wrong palette.
export type Theme = "light" | "dark";

const STORAGE_KEY = "cch:theme";

export function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage disabled (private mode) -- fall through to the OS preference.
  }
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Same as above: the choice just doesn't outlive the tab.
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}