import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// A separate app from prospecta-api -- its own origin, served from MinIO like
// the other SPAs. VITE_PROSPECTA_API_URL (baked in at build time, see
// lib/config.ts) is where requests actually go in production; the dev proxy
// below keeps local dev pointed at a local prospecta-api on :8022 without CORS.
// The API has no `/api` prefix -- its routes are the contract's own paths.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    proxy: {
      "/auth": "http://localhost:8022",
      "/companies": "http://localhost:8022",
      "/campaigns": "http://localhost:8022",
      "/leads": "http://localhost:8022",
      "/conversations": "http://localhost:8022",
      "/messages": "http://localhost:8022",
      "/agent": "http://localhost:8022",
      "/healthz": "http://localhost:8022",
    },
  },
});
