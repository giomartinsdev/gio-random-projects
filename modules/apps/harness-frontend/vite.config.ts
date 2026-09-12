import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// SPA estática do par harness -- sem container, espelhada pelo
// ts-frontend-ci-cd para o bucket harness-frontend (research D4).
// VITE_HARNESS_API_URL (baked in at build time, see src/lib/api.ts) is
// where /api actually goes in production; the dev proxy below just keeps
// local dev pointed at a harness-api running on :8010 without needing
// that env var set.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: {
    proxy: {
      "/api": "http://localhost:8010",
    },
  },
});