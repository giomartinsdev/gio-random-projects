import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// POC de UI do Uhumarketing: SPA estática, 100% mock. Não fala com backend —
// todo o estado vive em lib/mock + localStorage (ver lib/store.tsx). Ainda não
// é publicada: roda só em dev (`npm run dev`). Quando a integração real
// existir, VITE_UHU_API_URL vira a origem das requests, como em
// prospecta-frontend.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  server: { port: 5180, strictPort: false },
});
