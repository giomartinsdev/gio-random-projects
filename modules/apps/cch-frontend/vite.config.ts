import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// A separate app from cch-api -- its own origin, served from MinIO
// (see the infra's static_sites). VITE_CCH_API_URL (baked in at build
// time, see api.ts) is where /api and /ws actually go in production;
// the dev proxy below just keeps local dev pointed at a cch-api
// running on :8008 without needing that env var set.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8008",
      "/ws": { target: "ws://localhost:8008", ws: true },
    },
  },
});