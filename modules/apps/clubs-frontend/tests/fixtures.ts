// Fixture base do BDD: todo `.feature` importa `test` daqui.
//
// O motivo de existir (e não importar direto do playwright-bdd no step): ter um
// ponto único para acrescentar fixtures (páginas, API mockada, sessão) sem
// tocar em cada arquivo de steps. Hoje é só o reexport; é o gancho que evita um
// refactor quando o primeiro cenário precisar de dado.

import { test as base } from "playwright-bdd";

export const test = base;
export { expect } from "@playwright/test";
