import { describe, expect, it } from "vitest";
import { resolveVendorFromUrl } from "../src/lib/vendors.js";

describe("vendor resolution", () => {
  it("resolves betano links in every shape they get shared", () => {
    for (const url of [
      "https://www.betano.com.br/apostas/market/123",
      "https://betano.com/some/path",
      "https://betano.bet/xyz",
      "https://aposta.betano.com.br/x",
    ]) {
      expect(resolveVendorFromUrl(url)).toBe("betano");
    }
  });

  it("rejects other houses and garbage", () => {
    expect(resolveVendorFromUrl("https://www.bet365.com/x")).toBeNull();
    expect(resolveVendorFromUrl("https://betano-fake.example.com/x")).toBeNull();
    expect(resolveVendorFromUrl("não é url")).toBeNull();
  });
});