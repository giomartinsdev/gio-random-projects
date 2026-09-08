import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// A separate app from bet-api -- its own origin, served from MinIO
// (see the infra's static_sites). VITE_BET_API_URL (baked in at build
// time, see lib/api.ts) is where the API actually goes in production;
// the dev proxy below just keeps local dev pointed at a bet-api
// running on :8009 without needing that env var set.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8009",
    },
  },
});