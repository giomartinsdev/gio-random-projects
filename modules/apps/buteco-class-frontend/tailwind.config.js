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
      boxShadow: {
        // Replaces the old .glow-amber component class -- shadows compose
        // with transforms/borders better than a stacked class ever did.
        glow: "0 0 40px rgba(245, 166, 35, 0.15), 0 0 80px rgba(245, 166, 35, 0.05)",
        card: "0 4px 20px rgba(42, 23, 15, 0.35)",
      },
      // .prose (MarkdownContent) is styled here instead of via a
      // `prose-amber`-style preset so every override lives next to the
      // actual palette values.
      typography: () => ({
        DEFAULT: {
          css: {
            "--tw-prose-body": "#F5F0E8",
            "--tw-prose-headings": "#F5F0E8",
            "--tw-prose-bold": "#F5F0E8",
            "--tw-prose-links": "#F5A623",
            "--tw-prose-counters": "#D4891A",
            "--tw-prose-bullets": "#D4891A",
            "--tw-prose-hr": "rgba(255, 255, 255, 0.1)",
            "--tw-prose-quotes": "rgba(245, 240, 232, 0.8)",
            "--tw-prose-quote-borders": "#F5A623",
            "--tw-prose-captions": "rgba(245, 240, 232, 0.5)",
            "--tw-prose-code": "#F8C15C",
            "--tw-prose-th-borders": "rgba(255, 255, 255, 0.12)",
            "--tw-prose-td-borders": "rgba(255, 255, 255, 0.08)",
            "a": {
              "text-decoration-color": "rgba(245, 166, 35, 0.4)",
              "text-underline-offset": "3px",
              "&:hover": {
                "text-decoration-color": "#F5A623",
              },
            },
            "h1, h2, h3, h4": {
              fontFamily: '"Space Grotesk", system-ui, sans-serif',
            },
            "blockquote p:first-of-type::before": {
              content: "none",
            },
            "blockquote p:last-of-type::after": {
              content: "none",
            },
            "code": {
              fontFamily: '"JetBrains Mono", monospace',
              "font-weight": "500",
            },
            "code::before": {
              content: "none",
            },
            "code::after": {
              content: "none",
            },
            img: {
              borderRadius: "0.75rem",
            },
          },
        },
      }),
    },
  },
  plugins: [typography],
};