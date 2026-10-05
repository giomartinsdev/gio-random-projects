/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Superfícies/linguagem do cockpit (novos tokens).
        bg: "hsl(var(--bg))",
        "bg-soft": "hsl(var(--bg-soft))",
        fg: "hsl(var(--fg))",
        "fg-dim": "hsl(var(--fg-dim))",
        "accent-real": "hsl(var(--accent))",
        surface: "hsl(var(--surface))",
        "surface-2": "hsl(var(--bg-soft))",
        "surface-3": "hsl(var(--line))",
        up: "hsl(var(--up))",
        down: "hsl(var(--down))",
        warn: "hsl(var(--warn))",
        // Aliases shadcn (os componentes de ui usam estes nomes).
        border: "hsl(0 0% 50% / 0.16)",
        input: "hsl(0 0% 50% / 0.2)",
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
        lg: "16px",
        md: "10px",
        sm: "8px",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
