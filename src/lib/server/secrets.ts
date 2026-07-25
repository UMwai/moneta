import { createCipheriv, randomBytes } from "node:crypto";

const KEY_SYMBOL = Symbol.for("moneta.in-memory-credential-key");

type SecretGlobal = typeof globalThis & {
  [KEY_SYMBOL]?: Buffer;
};

function processKey(): Buffer {
  const globals = globalThis as SecretGlobal;
  globals[KEY_SYMBOL] ??= randomBytes(32);
  return globals[KEY_SYMBOL];
}

/**
 * Temporary M3 protection for credentials held by InMemoryStore.
 * TODO(M5): replace this function with src/lib/crypto.ts seal/open.
 */
export function encryptCredentials(credentials: unknown): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", processKey(), nonce);
  const plaintext = Buffer.from(JSON.stringify(credentials), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, tag, ciphertext]).toString("base64url");
}
