/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Every colour points at a CSS custom property, so a theme swap is a
        // single attribute change and never a class rewrite.
        bg: "var(--bg)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        "surface-3": "var(--surface-3)",
        line: "var(--border)",
        "line-strong": "var(--border-strong)",
        ink: "var(--text)",
        muted: "var(--text-muted)",
        faint: "var(--text-faint)",
        accent: "var(--accent)",
        "accent-ink": "var(--accent-ink)",
        "accent-soft": "var(--accent-soft)",
        accent2: "var(--accent-2)",
        brand: "var(--brand)",
        win: "var(--success)",
        "win-soft": "var(--success-soft)",
        warn: "var(--warning)",
        loss: "var(--danger)",
        "loss-soft": "var(--danger-soft)",
        info: "var(--info)",
        draw: "var(--draw)",
        gold: "var(--gold)",
        silver: "var(--silver)",
        bronze: "var(--bronze)",
      },
      fontFamily: {
        display: ['"Chakra Petch"', "system-ui", "sans-serif"],
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
      borderRadius: {
        sm: "3px",
        md: "5px",
        lg: "8px",
      },
    },
  },
  plugins: [],
};
