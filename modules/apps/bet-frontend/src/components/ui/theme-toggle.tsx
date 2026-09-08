import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { onThemeChange, setTheme, type Theme } from "@/lib/theme";
import { broadcastTheme } from "@/lib/hubTheme";
import { cn } from "@/lib/utils";

// The sun/moon switch. The choice takes effect immediately on
// <html data-theme> and sticks in localStorage. While embedded in the
// hub, a theme can also arrive from outside (the hub's own toggle) --
// onThemeChange keeps this icon honest, and our click reports back to
// the hub via broadcastTheme. (Same behavior as cch-frontend's toggle,
// minus the framer-motion spin.)
export function ThemeToggle({ className }: { className?: string }) {
  // Seeded from whatever main.tsx already applied, so first render
  // matches what's on screen.
  const [theme, setLocalTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );

  useEffect(() => onThemeChange(setLocalTheme), []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    // Embedded in the hub? It follows along (lib/hubTheme.ts).
    broadcastTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={theme === "light" ? "Mudar para tema escuro" : "Mudar para tema claro"}
      aria-label={theme === "light" ? "Mudar para tema escuro" : "Mudar para tema claro"}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
        className,
      )}
    >
      {theme === "light" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}