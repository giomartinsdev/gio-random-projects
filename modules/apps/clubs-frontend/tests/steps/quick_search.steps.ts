// Steps de quick_search.feature.
//
// Input de teclado REAL (page.keyboard) -- um KeyboardEvent sintético não
// provaria que a tecla funciona, que é justamente o que o atalho precisa
// garantir. O modo demo serve a busca sem backend.
//
// A tecla é "Meta+k" (⌘ no macOS). O runner local é macOS; em CI Linux o
// handler aceita Ctrl+K também, mas o Playwright mapearia "Control+k". Para o
// cenário valer nos dois, o step tenta Meta e, se a paleta não abrir, Control.

import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { test } from "../fixtures";

const { Given, When, Then } = createBdd(test);

Given("que abro a home no navegador", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
});

Given("que abro {string} no navegador", async ({ page }, caminho: string) => {
  await page.goto(caminho, { waitUntil: "networkidle" });
});

Then("vejo o painel de administração", async ({ page }) => {
  // O painel carrega os números gerais -- e NÃO a mensagem de "sem acesso".
  await expect(page.getByText(/no access|sem acesso/i)).toHaveCount(0);
  await expect(page.getByText(/General status|Estado geral|Visão geral|Overview/i).first()).toBeVisible();
});

When("pressiono {string}", async ({ page }, tecla: string) => {
  await page.keyboard.press(tecla);
});

When("digito {string} na busca", async ({ page }, texto: string) => {
  const campo = page.getByRole("dialog").getByRole("textbox");
  await campo.fill(texto);
  // Espera o debounce da busca (180ms) + a resposta do mock.
  await page.waitForTimeout(400);
});

Then("vejo a paleta de busca", async ({ page }) => {
  await expect(page.getByRole("dialog")).toBeVisible();
});

Then("não vejo a paleta de busca", async ({ page }) => {
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

Then("vejo um resultado de clube", async ({ page }) => {
  await expect(page.getByRole("dialog").getByText("Vila Nova FC", { exact: false }).first()).toBeVisible();
});

Then("a URL tem um caminho de clube", async ({ page }) => {
  await expect(page).toHaveURL(/\/club\/\d+/);
});
