import { describe, expect, it } from "vitest";
import { createCredentialCrypto } from "../src/lib/crypto.js";

const KEY = "a".repeat(64);

describe("credential crypto", () => {
  it("roundtrips a password", () => {
    const crypto = createCredentialCrypto(KEY);
    const blob = crypto.encrypt("s3cret-senha!");
    expect(blob).not.toContain("s3cret");
    expect(crypto.decrypt(blob)).toBe("s3cret-senha!");
  });

  it("never produces the same blob twice (random IV)", () => {
    const crypto = createCredentialCrypto(KEY);
    expect(crypto.encrypt("same")).not.toBe(crypto.encrypt("same"));
  });

  it("refuses a wrong-size key", () => {
    expect(() => createCredentialCrypto("a".repeat(32))).toThrow(/BET_CREDENTIALS_KEY/);
  });

  it("fails to decrypt a tampered blob", () => {
    const crypto = createCredentialCrypto(KEY);
    const blob = crypto.encrypt("secret");
    const raw = Buffer.from(blob, "base64");
    raw[raw.length - 1] ^= 0xff;
    expect(() => crypto.decrypt(raw.toString("base64"))).toThrow();
  });
});