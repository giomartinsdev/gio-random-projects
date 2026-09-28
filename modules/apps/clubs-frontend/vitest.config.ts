import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// A config de teste separa o que é teste de COMPONENTE (jsdom, rápido, roda no
// CI) do que é e2e (Playwright, ver playwright.config.ts). O ambiente padrão é
// jsdom porque a maior parte do valor está em render + interação, não em
// simular rede.
//
// `setupFiles` traz o `jest-dom` (matchers como toBeInTheDocument) e a limpeza
// entre testes.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/test/**", "src/**/*.test.{ts,tsx}", "src/mock-data.ts", "src/lib/mock-api.ts"],
    },
  },
});
