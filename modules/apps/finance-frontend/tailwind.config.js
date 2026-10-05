/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // V3 shadcn tokens (iguais ao ui.pen §V3).
        bg: "hsl(var(--bg))",
        "bg-soft": "hsl(var(--surface-2))",
        fg: "hsl(var(--fg))",
        "fg-dim": "hsl(var(--fg-dim))",
        "accent-real": "hsl(var(--accent))",
        surface: "hsl(var(--surface))",
        up: "hsl(var(--up))",
        down: "hsl(var(--down))",
        warn: "hsl(var(--warn))",
        // Aliases shadcn (os componentes de ui usam estes nomes).
        border: "hsl(var(--line))",
        input: "hsl(var(--line-strong))",
        ring: "hsl(var(--accent))",
        background: "hsl(var(--bg))",
        foreground: "hsl(var(--fg))",
        primary: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(40 6% 5%)" },
        secondary: { DEFAULT: "hsl(var(--bg-soft))", foreground: "hsl(var(--fg))" },
        destructive: { DEFAULT: "hsl(var(--down))", foreground: "hsl(40 6% 5%)" },
        success: { DEFAULT: "hsl(var(--up))", foreground: "hsl(40 6% 5%)" },
        warning: { DEFAULT: "hsl(var(--warn))", foreground: "hsl(40 6% 5%)" },
        muted: { DEFAULT: "hsl(var(--bg-soft))", foreground: "hsl(var(--fg-dim))" },
        accent: { DEFAULT: "hsl(var(--accent) / 0.14)", foreground: "hsl(var(--accent))" },
        popover: { DEFAULT: "hsl(var(--surface))", foreground: "hsl(var(--fg))" },
        card: { DEFAULT: "hsl(var(--surface))", foreground: "hsl(var(--fg))" },
      },
      borderRadius: {
        lg: "14px",
        md: "10px",
        sm: "8px",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
