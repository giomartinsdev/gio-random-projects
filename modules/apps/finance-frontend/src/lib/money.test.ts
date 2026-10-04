import { describe, expect, it } from "vitest";
import { formatBRL, occurredAtForDay, toDecimalString } from "./money";

describe("toDecimalString", () => {
  it("aceita inteiro e vírgula", () => {
    expect(toDecimalString("45")).toBe("45.00");
    expect(toDecimalString("45,5")).toBe("45.50");
  });
  it("aceita milhar com ponto e decimal com vírgula", () => {
    expect(toDecimalString("1.234,56")).toBe("1234.56");
  });
  it("aceita decimal com ponto", () => {
    expect(toDecimalString("45.00")).toBe("45.00");
  });
  it("recusa zero, negativo, vazio e lixo", () => {
    expect(toDecimalString("0")).toBeNull();
    expect(toDecimalString("-5")).toBeNull();
    expect(toDecimalString("")).toBeNull();
    expect(toDecimalString("abc")).toBeNull();
    expect(toDecimalString("1.2.3")).toBeNull();
  });
});

describe("formatBRL", () => {
  it("formata em reais", () => {
    expect(formatBRL("45")).toContain("45,00");
  });
  it("marca o sinal quando pedido", () => {
    expect(formatBRL("-45.00", { signed: true })).toContain("−");
    expect(formatBRL("45.00", { signed: true })).toContain("+");
  });
});

describe("occurredAtForDay", () => {
  it("devolve um instante ISO completo (tz-aware)", () => {
    const iso = occurredAtForDay("2026-10-04");
    expect(iso).toMatch(/Z$/);
  });
});
