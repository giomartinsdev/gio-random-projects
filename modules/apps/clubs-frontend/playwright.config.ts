import { defineConfig } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

// Config do e2e/BDD do clubs-frontend.
//
// Os `.feature` (tests/features) viram specs do Playwright via o bddgen, que
// roda no `globalSetup`. Por isso este arquivo é a fonte de verdade do BDD: um
// cenário novo é um `.feature` + um step, nunca um `test(...)` solto.
//
// O servidor de teste é o `vite preview` do build de produção -- queremos o
// comportamento real do SPA (roteamento por caminho, assets do bundle), não o
// dev server. O `playwright.config` aponta o baseURL para ele.
const testDir = defineBddConfig({
  features: "tests/features/**/*.feature",
  steps: ["tests/steps/**/*.ts", "tests/fixtures.ts"],
});

export default defineConfig({
  testDir,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.CLUBS_BASE_URL ?? "http://localhost:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Usa o Chrome do sistema por padrão (channel "chrome") em vez do Chromium
    // baixado pelo Playwright: em dev o download é um passo a mais que pode
    // falhar atrás de proxy, e o engine é o mesmo. Em CI (onde não há Chrome de
    // sistema) a pipeline seta CLUBS_PW_CHANNEL=chromium e o Playwright usa o
    // Chromium que ela mesma instala via `playwright install`.
    channel: process.env.CLUBS_PW_CHANNEL === "chromium" ? undefined : "chrome",
  },
  webServer: process.env.CLUBS_NO_SERVER
    ? undefined
    : {
        // `preview` serve um build de produção: é o app que o usuário recebe,
        // incluindo o roteamento por caminho e o fallback para index.html.
        //
        // O build do e2e vai para OUTRO diretório (dist-e2e), num MODO DEMO
        // (dados locais): o e2e verifica navegação e render, não a API. Separar
        // o diretório é de propósito -- se o build demo caísse em `dist/` e a
        // pipeline de deploy o usasse por engano (ordem de passos, um passo
        // que falha), o site iria ao ar com dados mockados e sem chamar a API.
        // Isolado, o pior caso é um diretório extra que ninguém publica.
        command:
          "VITE_CLUBS_DEMO=1 npx vite build --outDir dist-e2e && npx vite preview --outDir dist-e2e --port 4173",
        url: "http://localhost:4173",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
