/**
 * Provider credentials at rest. Thin wrapper over src/lib/crypto.ts so route and
 * store code never touches the cipher directly — and so there is exactly one
 * place to audit for credential handling.
 *
 * Nothing here logs, stringifies or re-throws the plaintext: a decrypt failure
 * surfaces as the crypto layer's DecryptionError, whose message is deliberately
 * free of payload material.
 */

import { openJson, sealJson } from "@/lib/crypto";

/** Encrypt a credential blob for the `connections.credentials_enc` column. */
export function encryptCredentials(credentials: unknown): string {
  return sealJson(credentials);
}

/** Decrypt a blob written by {@link encryptCredentials}. */
export function decryptCredentials<T = unknown>(sealed: string): T {
  return openJson<T>(sealed);
}
