import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// A separate app from tela-api now -- its own container, its own
// origin, served by nginx (see this app's own Dockerfile). VITE_TELA_API_URL
// (baked in at build time, see api.ts) is where /api and /ws actually
// go in production; the dev proxy below just keeps local dev pointed
// at a tela-api running on :8000 without needing that env var set.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
