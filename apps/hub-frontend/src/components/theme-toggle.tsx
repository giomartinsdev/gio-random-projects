import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { onThemeChange, setTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

// The sun/moon switch. The icon swaps with a spin, the choice takes
// effect immediately on <html data-theme> and sticks in localStorage.
// While an app is embedded the change also propagates into its iframe
// (the Renderer forwards it) -- and a change coming the other way,
// from the embedded app's own toggle, arrives through onThemeChange,
// so this icon always mirrors what's on screen.
export function ThemeToggle({ className }: { className?: string }) {
  // Seeded from whatever main.tsx already applied, so first render
  // matches what's on screen.
  const [theme, setLocalTheme] = useState<Theme>(() =>
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );

  useEffect(() => onThemeChange(setLocalTheme), []);

  function toggle() {
    setTheme(theme === "light" ? "dark" : "light");
  }

  return (
    <motion.button
      type="button"
      onClick={toggle}
      whileTap={{ scale: 0.85, rotate: -15 }}
      title={theme === "light" ? "Mudar para tema escuro" : "Mudar para tema claro"}
      aria-label={theme === "light" ? "Mudar para tema escuro" : "Mudar para tema claro"}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="flex"
        >
          {theme === "light" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}