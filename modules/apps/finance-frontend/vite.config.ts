import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// A separate app from finance-api -- its own origin, served from MinIO
// like the other SPAs. VITE_FINANCE_API_URL (baked in at build time, see
// lib/api.ts) is where requests actually go in production; the dev proxy
// below keeps local dev pointed at a finance-api on :8018 without needing
// that env var set. The routes are finance-api's own (`/healthz`,
// `/commands`), not an `/api` prefix.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    proxy: {
      "/healthz": "http://localhost:8018",
      "/commands": "http://localhost:8018",
      "/queries": "http://localhost:8018",
      "/auth": "http://localhost:8018",
    },
  },
});
