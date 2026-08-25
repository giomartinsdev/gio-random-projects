import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Built into ../web, which the Go server serves (see main.go's WEB_DIR
// and internal/httpapi's handleStatic). In dev, /api and /ws are
// proxied to the Go server running on :8000 so the client behaves
// exactly as it does in production, where both come from one origin.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  build: {
    outDir: "../web",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
