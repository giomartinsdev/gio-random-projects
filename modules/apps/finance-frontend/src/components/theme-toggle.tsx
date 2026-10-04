import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { broadcastTheme } from "@/lib/hubTheme";
import { currentTheme, onThemeChange, setTheme, type Theme } from "@/lib/theme";

// O interruptor sol/lua. Aplica na hora em <html class="dark">, persiste, e
// avisa o hub (quando embutido). Assina onThemeChange para o ícone refletir um
// tema que o hub tenha mandado — nunca fica dessincronizado do que está na tela.
export function ThemeToggle() {
  const [theme, setLocal] = useState<Theme>(() => currentTheme());

  useEffect(() => onThemeChange(setLocal), []);

  function toggle() {
    const next: Theme = theme === "light" ? "dark" : "light";
    setTheme(next);
    broadcastTheme(next);
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
