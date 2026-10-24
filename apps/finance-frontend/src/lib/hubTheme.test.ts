import { describe, expect, it } from "vitest";
import { themeFromMessage, trustedParent } from "./hubTheme";

describe("themeFromMessage", () => {
  it("aceita uma mensagem de tema do hub", () => {
    expect(themeFromMessage({ type: "hub:theme", theme: "light" })).toBe("light");
    expect(themeFromMessage({ type: "hub:theme", theme: "dark" })).toBe("dark");
  });
  it("ignora tipo diferente", () => {
    expect(themeFromMessage({ type: "app:theme", theme: "light" })).toBeNull();
  });
  it("ignora tema inválido", () => {
    expect(themeFromMessage({ type: "hub:theme", theme: "blue" })).toBeNull();
    expect(themeFromMessage({ type: "hub:theme" })).toBeNull();
  });
  it("ignora payload que não é objeto", () => {
    expect(themeFromMessage(null)).toBeNull();
    expect(themeFromMessage("light")).toBeNull();
    expect(themeFromMessage(42)).toBeNull();
  });
});

describe("trustedParent", () => {
  it("confia no hub e em localhost", () => {
    expect(trustedParent("https://hub.giomartins.dev")).toBe(true);
    expect(trustedParent("http://localhost:5199")).toBe(true);
  });
  it("não confia em outra origem", () => {
    expect(trustedParent("https://evil.example")).toBe(false);
    expect(trustedParent("https://finance.giomartins.dev")).toBe(false);
  });
});
