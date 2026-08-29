import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    // Everything the app ships is modern (2022 baseline); the default
    // "modules" target would only add transpilation for nobody.
    target: "es2022",
  },
});