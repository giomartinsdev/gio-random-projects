import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// A separate app from every frontend it embeds -- its own origin,
// served from MinIO like the others (see the infra's static_sites).
// There's no API to proxy in dev: the app is pure static chrome around
// iframes of the *.giomartins.dev SPAs, so `npm run dev` works with
// nothing else running.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});