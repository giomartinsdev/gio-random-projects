import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// financas-frontend fala com QUATRO backends por CORS (contas-api,
// transacional-api, asset-manager-api, dashboard-api) -- não existe um
// único "/api" para proxiar. Cada cliente em src/lib/api/*.ts lê sua
// própria VITE_*_API_URL (baked em build time) com fallback para
// localhost:8020..8023 em dev, então rodar os 4 BFFs localmente nessas
// portas já basta para `npm run dev` funcionar sem setar nada.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
});
