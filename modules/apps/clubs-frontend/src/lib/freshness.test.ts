import { describe, expect, it } from "vitest";
import { ageSeconds, freshnessLevel } from "./freshness";

// Os cortes de frescor são regra de produto: "fresco" (< 15 min) acompanha o
// ciclo do worker; acima disso é atraso, e a cor muda. Testar a função pura
// evita montar um componente para verificar uma decisão que não é de UI.
describe("freshnessLevel", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  const at = (minAtras: number) => new Date(now - minAtras * 60_000).toISOString();

  it("fresco até 15 min", () => {
    expect(freshnessLevel(at(0), now)).toBe("fresh");
    expect(freshnessLevel(at(14), now)).toBe("fresh");
  });

  it("recente entre 15 min e 2 h", () => {
    expect(freshnessLevel(at(15), now)).toBe("recent");
    expect(freshnessLevel(at(119), now)).toBe("recent");
  });

  it("atrasado entre 2 h e 24 h", () => {
    expect(freshnessLevel(at(120), now)).toBe("stale");
    expect(freshnessLevel(at(23 * 60), now)).toBe("stale");
  });

  it("velho a partir de 24 h", () => {
    expect(freshnessLevel(at(24 * 60), now)).toBe("old");
    expect(freshnessLevel(at(10 * 24 * 60), now)).toBe("old");
  });

  it("nunca atualizado é unknown, não erro", () => {
    expect(freshnessLevel(null, now)).toBe("unknown");
    expect(freshnessLevel(undefined, now)).toBe("unknown");
    expect(freshnessLevel("", now)).toBe("unknown");
  });

  it("data inválida não explode", () => {
    expect(freshnessLevel("não é data", now)).toBe("unknown");
  });
});

describe("ageSeconds", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");

  it("conta para trás", () => {
    expect(ageSeconds(new Date(now - 90_000).toISOString(), now)).toBe(90);
  });

  it("relógio dessincronizado (futuro) vira 0, não negativo", () => {
    // Um "atualizado daqui a pouco" seria pior que "agora".
    expect(ageSeconds(new Date(now + 60_000).toISOString(), now)).toBe(0);
  });

  it("ausente é infinito (nunca atualizado)", () => {
    expect(ageSeconds(null, now)).toBe(Number.POSITIVE_INFINITY);
  });
});
