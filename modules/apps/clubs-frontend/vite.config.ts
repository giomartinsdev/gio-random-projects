import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The dev proxy points at a locally running clubs-api (PORT=8017 by default),
// so `npm run dev` works without CORS setup. In production the SPA calls the
// absolute API URL baked in at build time (VITE_CLUBS_API_URL) -- same
// convention as the other SPAs in this repo.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_CLUBS_API_URL ?? "http://localhost:8017",
        changeOrigin: true,
      },
      // As imagens de preview/súmula (/og/...) vivem na RAIZ da API, fora de
      // /api -- o crawler as busca na URL que o og:image aponta. O proxy de dev
      // também cobre esse caminho para o botão "baixar súmula" funcionar local.
      "/og": {
        target: process.env.VITE_CLUBS_API_URL ?? "http://localhost:8017",
        changeOrigin: true,
      },
    },
  },
});
