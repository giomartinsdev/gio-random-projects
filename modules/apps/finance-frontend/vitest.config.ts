import { defineConfig } from "vitest/config";
import path from "node:path";

// Testes de unidade do SPA: lógica pura (formatação de dinheiro, parsing do
// formulário) que um erro silencioso quebraria. Componentes/e2e ficam para
// depois; o valor imediato está nas regras do §3.4 que o SPA toca.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
