import { describe, expect, it } from "vitest";
import { formatBRL, formatBRLPrefixed, parseBRLToCents } from "../src/lib/money.js";

describe("money", () => {
  it("formats cents as pt-BR BRL", () => {
    expect(formatBRL(1050)).toBe("10,50");
    expect(formatBRLPrefixed(1050)).toBe("R$ 10,50");
    expect(formatBRLPrefixed(100000)).toBe("R$ 1.000,00");
  });

  it("parses the shapes a settings form sends", () => {
    expect(parseBRLToCents("10")).toBe(1000);
    expect(parseBRLToCents("10,50")).toBe(1050);
    expect(parseBRLToCents("10.50")).toBe(1050);
    expect(parseBRLToCents("R$ 10,50")).toBe(1050);
  });

  it("rejects non-numbers, negatives and sub-cent values", () => {
    expect(parseBRLToCents("abc")).toBeNull();
    expect(parseBRLToCents("")).toBeNull();
    expect(parseBRLToCents("10,123")).toBeNull();
    expect(parseBRLToCents("-5")).toBeNull();
  });
});