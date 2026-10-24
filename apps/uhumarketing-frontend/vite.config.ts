import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// SPA do uhumarketing.
//
// Em dev a API roda em :8195 e o Vite faz proxy de /api e /webhooks para ela —
// assim o cliente HTTP usa caminho relativo nos dois ambientes (dev e deploy),
// e não existe CORS nem URL absoluta embutida no bundle. `VITE_UHU_API_URL` só
// é necessário quando a SPA e a API são publicadas em origens diferentes.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    port: 5180,
    strictPort: false,
    proxy: {
      "/api": { target: "http://localhost:8195", changeOrigin: true },
      "/webhooks": { target: "http://localhost:8195", changeOrigin: true },
      "/healthz": { target: "http://localhost:8195", changeOrigin: true },
    },
  },
});
