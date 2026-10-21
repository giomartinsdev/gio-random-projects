/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        pitch: {
          950: "#06120d",
          900: "#0a1b13",
          800: "#0f261a",
          700: "#16351f",
        },
        chalk: "#e8f2ea",
        flare: "#c8f751",
        ember: "#ff7a45",
        gold: "#efd27a",
      },
      fontFamily: {
        sans: ['"Instrument Sans"', "system-ui", "sans-serif"],
        display: ['"Barlow Condensed"', '"Instrument Sans"', "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        floodlight: "0 0 0 1px rgba(200,247,81,.12), 0 18px 60px -20px rgba(200,247,81,.25)",
      },
    },
  },
  plugins: [],
};
