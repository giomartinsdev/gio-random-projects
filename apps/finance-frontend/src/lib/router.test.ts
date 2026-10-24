import { describe, expect, it } from "vitest";
import { hrefFor, parseRoute } from "./router";

describe("parseRoute", () => {
  it("raiz e desconhecido caem no dashboard", () => {
    expect(parseRoute("").name).toBe("dashboard");
    expect(parseRoute("#/").name).toBe("dashboard");
    expect(parseRoute("#/nao-existe").name).toBe("dashboard");
  });
  it("lê as rotas com parâmetro", () => {
    expect(parseRoute("#/transactions/2026-10")).toEqual({ name: "transactions", month: "2026-10" });
    expect(parseRoute("#/transaction/abc")).toEqual({ name: "transaction", id: "abc" });
  });
  it("transação sem id volta pra lista", () => {
    expect(parseRoute("#/transaction").name).toBe("transactions");
  });
  it("round-trip", () => {
    for (const h of ["#/dashboard", "#/transactions", "#/transactions/2026-10", "#/transaction/x", "#/accounts", "#/limits", "#/notifications", "#/openfinance", "#/settings"]) {
      expect(hrefFor(parseRoute(h))).toBe(h);
    }
  });
});
