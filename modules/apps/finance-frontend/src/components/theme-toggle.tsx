import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, loadTheme, setTheme, type Theme } from "@/lib/theme";

// O interruptor sol/lua. Aplica na hora em <html class="dark"> e persiste.
export function ThemeToggle() {
  const [theme, setLocal] = useState<Theme>(() => loadTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    setLocal(next);
  }

  const label = theme === "light" ? "Mudar para tema escuro" : "Mudar para tema claro";
  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {theme === "light" ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}
