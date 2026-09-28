import { describe, expect, it } from "vitest";
import { pathFor, parsePath } from "./routing";

// Testes de componente/unidade em Vitest do roteamento.
//
// O BDD (tests/features/routing.feature) cobre o mesmo contrato em Gherkin, com
// linguagem de produto. Este arquivo existe porque nem toda asserção merece uma
// frase de negócio: a paridade parse/pathFor é uma PROPRIEDADE, e testá-la no
// loop (com muitos exemplos) é mais honesto num teste de tabela do que em sete
// cenários. Os dois rodam; o Gherkin documenta o comportamento, o Vitest varre
// os casos.
describe("routing", () => {
  describe("parsePath", () => {
    it.each([
      ["/", { route: "home" }],
      ["/clubs", { route: "clubs" }],
      ["/club/141881", { route: "club", param: "141881" }],
      ["/match/m-99", { route: "match", param: "m-99" }],
      ["/player/938806983", { route: "player", param: "938806983" }],
      ["/players", { route: "players" }],
      ["/claim", { route: "claim" }],
      ["/my-area", { route: "my-area" }],
      ["/notifications", { route: "notifications" }],
      ["/admin", { route: "admin" }],
    ])("mapeia %s para %o", (path, esperado) => {
      expect(parsePath(path)).toEqual(esperado);
    });

    it("ignora query string", () => {
      expect(parsePath("/club/1?utm=x")).toEqual({ route: "club", param: "1" });
    });

    it("ignora barra final", () => {
      expect(parsePath("/club/1/")).toEqual({ route: "club", param: "1" });
    });

    it("decodifica id com escape", () => {
      expect(parsePath("/club/Clube%20Bom")).toEqual({ route: "club", param: "Clube Bom" });
    });

    it("cai na home para caminho desconhecido", () => {
      expect(parsePath("/nao-existe")).toEqual({ route: "home" });
    });

    it("detalhe sem id cai na lista", () => {
      expect(parsePath("/club")).toEqual({ route: "clubs" });
      expect(parsePath("/player")).toEqual({ route: "players" });
    });
  });

  describe("pathFor", () => {
    it("gera caminho real, nunca hash", () => {
      expect(pathFor({ route: "club", param: "1" })).toBe("/club/1");
      expect(pathFor({ route: "home" })).toBe("/");
    });

    it("escapa o id", () => {
      expect(pathFor({ route: "club", param: "Clube Bom" })).toBe("/club/Clube%20Bom");
    });

    it("detalhe sem id cai na lista", () => {
      expect(pathFor({ route: "club" })).toBe("/clubs");
      expect(pathFor({ route: "player" })).toBe("/players");
    });
  });

  // A propriedade que amarra os dois lados: navegar e compartilhar só funcionam
  // juntos se todo caminho gerado voltar à view que o gerou.
  describe("paridade parse(pathFor(view)) === view", () => {
    const views = [
      { route: "home" } as const,
      { route: "clubs" } as const,
      { route: "players" } as const,
      { route: "claim" } as const,
      { route: "my-area" } as const,
      { route: "notifications" } as const,
      { route: "admin" } as const,
      { route: "club", param: "141881" } as const,
      { route: "club", param: "Clube Bom Demais" } as const,
      { route: "player", param: "938806983" } as const,
      { route: "match", param: "m-99" } as const,
    ];
    it.each(views.map((v) => [v] as const))("round-trip %o", (v) => {
      expect(parsePath(pathFor(v))).toEqual(v);
    });
  });
});
