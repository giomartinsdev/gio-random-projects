/** @type {import('tailwindcss').Config} */
// Tokens EXATOS do poc.pen (§V1). O Prospecta é dark-only: as superfícies
// `app-*` do design system viram a base (bg/surface/elevated/line) e o azul
// #2563EB é reservado para ação. Inter na UI, JetBrains Mono em dados/estados.
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0B0D",
        surface: "#141416",
        elevated: "#1C1C20",
        line: "#26262B",
        "line-strong": "#33333A",
        fg: "#FFFFFF",
        "fg-2": "#A8A8B0",
        "fg-3": "#6E6E76",
        accent: {
          DEFAULT: "#2563EB",
          light: "#7DA6FF",
          soft: "rgba(37,99,235,0.16)",
          ring: "rgba(37,99,235,0.35)",
        },
        success: { DEFAULT: "#16A34A", soft: "#12351F" },
        warn: "#D97706",
        danger: "#DC2626",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: {
        xs: "6px",
        sm: "10px",
        md: "14px",
        lg: "20px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.45)",
        drawer: "-24px 0 48px rgba(0,0,0,0.45)",
      },
      keyframes: {
        "orb-pulse": {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.55", transform: "scale(0.82)" },
        },
        "feed-in": {
          from: { opacity: "0", transform: "translateY(-4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "orb-pulse": "orb-pulse 1.8s ease-in-out infinite",
        "feed-in": "feed-in 240ms cubic-bezier(0.16,1,0.3,1)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
