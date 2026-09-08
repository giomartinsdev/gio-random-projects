// AES-256-GCM at-rest encryption for bookmaker credentials — the one
// place in this system a Betano password is ever stored. Format:
// base64(12-byte-random-IV || ciphertext||16-byte-GCM-tag), key from
// BET_CREDENTIALS_KEY (32 bytes, hex). Key rotation isn't automatic:
// rotating the env makes every stored blob undecryptable, so save the
// credentials again after rotating (the PUT re-encrypts with the new
// key).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_LENGTH = 12;
const KEY_LENGTH = 32;

function parseKey(rawKeyHex: string): Buffer {
  const key = Buffer.from(rawKeyHex, "hex");
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `BET_CREDENTIALS_KEY must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex chars), got ${key.length}`,
    );
  }
  return key;
}

export function createCredentialCrypto(rawKeyHex: string) {
  const key = parseKey(rawKeyHex);

  return {
    encrypt(plaintext: string): string {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString("base64");
    },

    decrypt(blob: string): string {
      const data = Buffer.from(blob, "base64");
      if (data.length <= IV_LENGTH) throw new Error("encrypted credential blob is truncated");
      const iv = data.subarray(0, IV_LENGTH);
      const tag = data.subarray(data.length - 16);
      const encrypted = data.subarray(IV_LENGTH, data.length - 16);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
    },
  };
}

export type CredentialCrypto = ReturnType<typeof createCredentialCrypto>;