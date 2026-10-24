/** @type {import('tailwindcss').Config} */
// Mesmos tokens do prospecta-frontend (que vieram do poc.pen): superfícies
// app-* (bg/surface/elevated/line), azul #2563EB só para ação, Inter na UI e
// JetBrains Mono em dados/estados. A landing pública usa a paleta `lp-*`
// (branco/azul), como no prospecta.
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
        lp: {
          bg: "#FFFFFF",
          surface: "#F6F6F4",
          ink: "#111111",
          "ink-2": "#57575C",
          "ink-3": "#9B9BA1",
          line: "#E8E8EC",
          dark: "#111111",
          "dark-2": "#1C1C1A",
          "dark-line": "#2E2E2B",
        },
        accent: {
          DEFAULT: "#2563EB",
          light: "#7DA6FF",
          soft: "rgba(37,99,235,0.16)",
          ring: "rgba(37,99,235,0.35)",
        },
        success: { DEFAULT: "#16A34A", soft: "#12351F" },
        warn: { DEFAULT: "#D97706", soft: "#2C1F07" },
        danger: { DEFAULT: "#DC2626", soft: "#2E1315" },
        // Verde de bolha do WhatsApp: só no preview de template (é o canal, não
        // a nossa identidade).
        wa: "#DCF8C6",
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
        node: "0 8px 24px rgba(0,0,0,0.45)",
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
        "node-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "edge-dash": {
          to: { strokeDashoffset: "-24" },
        },
      },
      animation: {
        "orb-pulse": "orb-pulse 1.8s ease-in-out infinite",
        "feed-in": "feed-in 240ms cubic-bezier(0.16,1,0.3,1)",
        "node-in": "node-in 160ms cubic-bezier(0.16,1,0.3,1)",
        "edge-dash": "edge-dash 1s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
