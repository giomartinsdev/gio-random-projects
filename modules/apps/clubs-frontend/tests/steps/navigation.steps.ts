// Steps do navigation.feature -- navegação real no navegador.
//
// Usa o modo DEMO do SPA (VITE_CLUBS_DEMO=1, ver playwright.config): os dados
// são determinísticos e locais, então o cenário verifica NAVEGAÇÃO e RENDER, e
// não a API. Sem demo, cada cenário precisaria de Postgres + worker + backend de
// pé -- e falharia por motivos que não são os que ele testa.
//
// Os textos vêm do i18n em en-US (o idioma padrão quando o navegador não fala
// nenhum dos cinco); por isso as asserções usam "Arena" e o nome do clube do
// mock, não uma string traduzida a esmo.

import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { test } from "../fixtures";
import * as D from "../../src/lib/mock-data";

const { Given, When, Then } = createBdd(test);

// O clube que o mock serve no id usado pelos cenários: o primeiro do CLUBS.
const CLUBE = D.CLUBS[0];

Given("que abro {string}", async ({ page }, url: string) => {
  await page.goto(url, { waitUntil: "networkidle" });
});

When("abro {string}", async ({ page }, url: string) => {
  await page.goto(url, { waitUntil: "networkidle" });
});

Then("a URL não contém {string}", async ({ page }, fragmento: string) => {
  expect(page.url()).not.toContain(fragmento);
});

Then("a URL é {string}", async ({ page }, esperada: string) => {
  // Tolera barra final para o cenário não ficar frágil ao detalhe do servidor.
  const atual = page.url().replace(/\/$/, "");
  expect(atual).toBe(esperada.replace(/\/$/, ""));
});

Then("vejo o cabeçalho do hub", async ({ page }) => {
  await expect(page.getByText("Arena", { exact: false }).first()).toBeVisible();
});

Then("vejo o nome do clube", async ({ page }) => {
  await expect(page.getByText(CLUBE.name, { exact: false }).first()).toBeVisible();
});
