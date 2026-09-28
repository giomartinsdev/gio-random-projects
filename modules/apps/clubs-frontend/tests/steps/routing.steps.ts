// Steps das rotas (tests/features/routing.feature).
//
// Estes steps chamam as funções PURAS de roteamento diretamente, sem montar o
// app nem um navegador. A razão é a mesma do módulo ser puro: o que importa
// aqui é "dado este caminho, a view é esta" -- um teste que sobe o browser
// inteiro para responder isso seria lento e frágil, e falharia por motivos que
// não têm a ver com roteamento.
//
// O e2e (tests/e2e) cobre o que precisa de browser de verdade: navegar, voltar,
// o clique. Aqui é o contrato do parse.

import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { test } from "../fixtures";
import { parsePath, pathFor, type RouteId, type View } from "../../src/lib/routing";
import { legacyHashPath } from "../../src/lib/legacy-hash";

const { Given, When, Then } = createBdd(test);

const ROUTE_NOME: Record<string, RouteId> = {
  clube: "club",
  partida: "match",
  jogador: "player",
  "lista de clubes": "clubs",
  "lista de jogadores": "players",
  "resgate de pro": "claim",
  home: "home",
  admin: "admin",
  "minha área": "my-area",
};

let atual: View;
let convertido: string | null;

Given("que abro o caminho {string}", async ({}, caminho: string) => {
  atual = parsePath(caminho);
});

When("abro o caminho {string}", async ({}, caminho: string) => {
  atual = parsePath(caminho);
});

When("converto o hash legado {string}", async ({}, hash: string) => {
  convertido = legacyHashPath(hash);
});

Then("a view atual é o {word} {string}", async ({}, tipo: string, id: string) => {
  expect(atual.route, `rota para ${tipo} ${id}`).toBe(ROUTE_NOME[tipo]);
  expect(atual.param, `param de ${tipo}`).toBe(id);
});

Then("a view atual é a {word} {string}", async ({}, tipo: string, id: string) => {
  expect(atual.route, `rota para ${tipo} ${id}`).toBe(ROUTE_NOME[tipo]);
  expect(atual.param, `param de ${tipo}`).toBe(id);
});

Then("a view atual é a lista de clubes", async () => {
  expect(atual.route).toBe("clubs");
});

Then("a view atual é a lista de jogadores", async () => {
  expect(atual.route).toBe("players");
});

Then("a view atual é o resgate de pro", async () => {
  expect(atual.route).toBe("claim");
});

Then("a view atual é a home", async () => {
  expect(atual.route).toBe("home");
});

Then("o caminho convertido é {string}", async ({}, esperado: string) => {
  expect(convertido).toBe(esperado);
});

Then("não há caminho convertido", async () => {
  expect(convertido).toBeNull();
});

Then("para toda view o caminho gerado volta à mesma view", async () => {
  const views: View[] = [
    { route: "home" },
    { route: "clubs" },
    { route: "players" },
    { route: "claim" },
    { route: "my-area" },
    { route: "notifications" },
    { route: "admin" },
    { route: "club", param: "141881" },
    { route: "club", param: "Clube Bom Demais" },
    { route: "player", param: "938806983" },
    { route: "match", param: "m-99" },
  ];
  for (const v of views) {
    const path = pathFor(v);
    const round = parsePath(path);
    expect(round, `pathFor(${JSON.stringify(v)}) = ${path}`).toEqual(v);
  }
});
