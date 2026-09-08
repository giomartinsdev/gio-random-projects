import { describe, expect, it } from "vitest";
import { centsToStakeString, parseBalanceToCents } from "../src/lib/stake.js";

describe("centsToStakeString", () => {
  it("formats pt-BR decimals the stake input expects", () => {
    expect(centsToStakeString(10_50)).toBe("10,50");
    expect(centsToStakeString(100)).toBe("1,00");
    expect(centsToStakeString(10_500)).toBe("105,00");
    expect(centsToStakeString(1)).toBe("0,01");
  });

  it("rejects anything that is not a positive integer of cents", () => {
    expect(() => centsToStakeString(0)).toThrow();
    expect(() => centsToStakeString(-500)).toThrow();
    expect(() => centsToStakeString(10.5)).toThrow();
    expect(() => centsToStakeString(Number.NaN)).toThrow();
  });
});

describe("parseBalanceToCents", () => {
  it("reads the balance the site renders", () => {
    expect(parseBalanceToCents("R$ 1.234,56")).toBe(123_456);
    expect(parseBalanceToCents("1.234,56")).toBe(123_456);
    expect(parseBalanceToCents("10,50")).toBe(1_050);
    expect(parseBalanceToCents("R$ 100")).toBe(10_000);
    expect(parseBalanceToCents("Saldo: R$ 0,00")).toBe(0);
  });

  it("returns null for anything unparseable", () => {
    expect(parseBalanceToCents("")).toBeNull();
    expect(parseBalanceToCents("abc")).toBeNull();
    expect(parseBalanceToCents("R$ 1,234")).toBeNull();
  });
});