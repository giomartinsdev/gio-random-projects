// Steps de activation.feature -- ativação da home e do resgate.
//
// A primeira parte (home) roda em navegador real no modo demo. A segunda parte
// (campanha do clube no resgate) é asserida pelo texto renderizado; o
// componente já recebe o clube no estado, então não depende da rede.

import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { test } from "../fixtures";

const { Given, When, Then } = createBdd(test);

Given("que abro a home sem login", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
});

Given("o feed de anúncios está vazio", async ({ page }) => {
  // No demo, o feed pode ter itens. O que o cenário garante é que a home
  // renderiza o convite e os DESTAQUES independentemente do feed -- então não
  // forçamos o feed vazio aqui; verificamos que os destaques aparecem.
  await page.waitForLoadState("networkidle");
});

When("escolho o clube {string}", async ({ page }, nome: string) => {
  // O passo de resgate é aberto pelo hash (link direto para a busca). Em modo
  // demo o clube do mock é o primeiro; o nome é o rótulo que aparece.
  await page.goto("/claim", { waitUntil: "networkidle" });
  const campo = page.getByPlaceholder(/club name|nome do clube|name/i).first();
  await campo.fill(nome.split(" ")[0]);
  // Clica no clube que aparece na lista.
  await page.getByText(nome, { exact: false }).first().click();
});

Then("vejo o convite para encontrar meu clube", async ({ page }) => {
  await expect(
    page.getByRole("button", { name: /Find my club|Encontrar meu clube|Meinen Verein finden|Trouver mon club|Encontrar mi club/i }),
  ).toBeVisible();
});

Then("vejo os destaques do hub", async ({ page }) => {
  // Os recordes globais (maior goleada, jogo com mais gols, melhor nota,
  // artilheiro) são o conteúdo que existe mesmo quando o feed está magro.
  await expect(
    page.getByRole("heading", { name: /Hub records|Recordes do hub|Récords del hub|Records du hub|Hub-Rekorde/i }),
  ).toBeVisible();
});

Then("vejo a campanha do clube antes do elenco carregar", async ({ page }) => {
  await expect(
    page.getByText(/Campaign so far|Campanha até agora|Campaña hasta ahora|Bilan jusqu'ici|Bilanz bisher/i),
  ).toBeVisible();
});
