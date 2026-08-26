import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        buteco: {
          brown: "#3B2218",
          "brown-dark": "#2A170F",
          "brown-light": "#5C3A2A",
          amber: "#F5A623",
          "amber-light": "#F8C15C",
          "amber-dark": "#D4891A",
          navy: "#1E2432",
          cream: "#F5F0E8",
          "cream-dark": "#E8DFD3",
          stout: "#4A2520",
        },
      },
      fontFamily: {
        heading: ['"Space Grotesk"', "system-ui", "sans-serif"],
        body: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
    },
  },
  plugins: [typography],
};
