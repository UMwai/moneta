/**
 * Secrets at rest — ADR 0005.
 *
 * Every provider access token, client secret and API key passes through `seal()` on
 * the way into SQLite and `open()` on the way out. AES-256-GCM with a random 96-bit
 * IV per seal; the auth tag makes tampering with the ciphertext detectable.
 *
 * Sealed format (ASCII, `:`-delimited so it survives any column/JSON round-trip):
 *
 *     v1:<iv_b64>:<ciphertext_b64>:<tag_b64>
 *
 * The literal version prefix is bound in as GCM additional authenticated data, so a
 * downgrade to a future v0/v2 reader is also caught by tag verification.
 *
 * The key comes from `APP_ENCRYPTION_KEY` (64 hex chars = 32 bytes), read at call
 * time rather than at import so the first-run wizard can generate and set it without
 * a process restart.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENV_VAR = "APP_ENCRYPTION_KEY";
const AAD = Buffer.from(VERSION, "utf8");

/** Thrown when the encryption key is missing or malformed — an operator problem. */
export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionKeyError";
  }
}

/** Thrown when a payload is malformed, truncated, tampered with, or sealed under another key. */
export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptionError";
  }
}

/** A fresh 64-char hex key for `.env` / the first-run wizard. */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString("hex");
}

/**
 * Validate and decode a hex key. Pass `key` explicitly in tests or key-rotation
 * tooling; otherwise it is read from `APP_ENCRYPTION_KEY`.
 */
export function resolveKey(key?: string): Buffer {
  const raw = key ?? process.env[ENV_VAR];
  if (!raw || raw.trim() === "") {
    throw new EncryptionKeyError(
      `${ENV_VAR} is not set. Generate one with \`openssl rand -hex 32\` and add it to your .env.`,
    );
  }
  const hex = raw.trim();
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new EncryptionKeyError(`${ENV_VAR} must be hexadecimal (64 characters).`);
  }
  if (hex.length !== KEY_BYTES * 2) {
    throw new EncryptionKeyError(
      `${ENV_VAR} must be ${KEY_BYTES * 2} hex characters (${KEY_BYTES} bytes); got ${hex.length}.`,
    );
  }
  return Buffer.from(hex, "hex");
}

/** True when `value` has the shape of a sealed payload (cheap check, no key needed). */
export function isSealed(value: string): boolean {
  const [version, iv, , tag] = value.split(":");
  return (
    value.split(":").length === 4 &&
    version === VERSION &&
    Boolean(iv) &&
    Boolean(tag)
  );
}

/** Encrypt a UTF-8 string. Output is safe to store in a TEXT column. */
export function seal(plaintext: string, key?: string): string {
  const keyBytes = resolveKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyBytes, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    ciphertext.toString("base64"),
    tag.toString("base64"),
  ].join(":");
}

/** Decrypt a payload produced by `seal()`. Throws `DecryptionError` on any mismatch. */
export function open(sealed: string, key?: string): string {
  const keyBytes = resolveKey(key);
  const parts = sealed.split(":");
  if (parts.length !== 4) {
    throw new DecryptionError("Malformed sealed value: expected 4 colon-delimited segments.");
  }
  const [version, ivB64, ciphertextB64, tagB64] = parts;
  if (version !== VERSION) {
    throw new DecryptionError(`Unsupported sealed value version "${version}"; expected "${VERSION}".`);
  }

  const iv = decodeBase64(ivB64, "iv");
  // An empty ciphertext is legitimate: sealing "" is how an unset optional field
  // round-trips. The auth tag still proves integrity.
  const ciphertext = decodeBase64(ciphertextB64, "ciphertext", true);
  const tag = decodeBase64(tagB64, "auth tag");
  if (iv.length !== IV_BYTES) {
    throw new DecryptionError(`Malformed sealed value: IV must be ${IV_BYTES} bytes.`);
  }
  if (tag.length !== TAG_BYTES) {
    throw new DecryptionError(`Malformed sealed value: auth tag must be ${TAG_BYTES} bytes.`);
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, keyBytes, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // Never echo the underlying OpenSSL error or any part of the payload.
    throw new DecryptionError(
      "Unable to decrypt: the value was tampered with or was sealed with a different APP_ENCRYPTION_KEY.",
    );
  }
}

/** Seal any JSON-serialisable value (used for provider credential blobs). */
export function sealJson(value: unknown, key?: string): string {
  return seal(JSON.stringify(value), key);
}

/**
 * Open a payload written by `sealJson`. The caller is expected to zod-validate the
 * result — the return type is a convenience, not a guarantee.
 */
export function openJson<T = unknown>(sealed: string, key?: string): T {
  const plaintext = open(sealed, key);
  try {
    return JSON.parse(plaintext) as T;
  } catch {
    throw new DecryptionError("Sealed value did not contain valid JSON.");
  }
}

/** Constant-time comparison for secrets that are compared rather than decrypted. */
export function secretsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function decodeBase64(value: string, label: string, allowEmpty = false): Buffer {
  const buf = Buffer.from(value, "base64");
  // Buffer.from silently drops invalid characters, so re-encode to confirm.
  if (
    (buf.length === 0 && !allowEmpty) ||
    buf.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")
  ) {
    throw new DecryptionError(`Malformed sealed value: ${label} is not valid base64.`);
  }
  return buf;
}
