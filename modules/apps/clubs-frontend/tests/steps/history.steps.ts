// Steps de history.feature -- a aba História do clube.
//
// Navegador real, modo demo. A aba é aberta pelo nome i18n em en-US ("History"),
// porque o navegador do Playwright não fala nenhum dos cinco idiomas e o SPA cai
// no padrão global.

import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { test } from "../fixtures";

const { When, Then } = createBdd(test);

When("clico na aba {string}", async ({ page }, nome: string) => {
  await page.getByRole("button", { name: nome, exact: true }).click();
});

Then("vejo a linha do tempo acumulada", async ({ page }) => {
  // O título da seção é o rótulo do acervo; os eventos (divisão, recorde,
  // entrada no hub) aparecem abaixo.
  await expect(
    page.getByText(/accumulated history|histórico acumulado/i).first(),
  ).toBeVisible();
  // Pelo menos um evento precisa estar visível -- a linha do tempo não pode
  // ser só o título.
  await expect(
    page.getByText(/Division change|Record|Added to the hub|Mudança de divisão|Recorde|Entrou no hub/i).first(),
  ).toBeVisible();
});

Then("vejo o resumo desde que comecei a acompanhar", async ({ page }) => {
  await expect(
    page.getByText(/Since you started following|Desde que você acompanha/i).first(),
  ).toBeVisible();
});
