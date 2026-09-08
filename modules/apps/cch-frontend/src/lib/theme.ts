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

// Who reacts to theme changes once the app is up: the toggle (keeps
// its icon honest) and the hub bridge (which forwards changes to the
// hub while embedded). setTheme() below is the only mutator any
// interactive path may call.
const listeners = new Set<(theme: Theme) => void>();

export function onThemeChange(listener: (theme: Theme) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Save, paint, and tell everyone -- used by the toggle click and by a
// theme arriving from the hub over postMessage, so the page, the
// toggle icon, and the hub can never drift apart.
export function setTheme(theme: Theme) {
  saveTheme(theme);
  applyTheme(theme);
  for (const listener of listeners) listener(theme);
}