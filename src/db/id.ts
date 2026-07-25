import { randomBytes } from "node:crypto";

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";
const SIZE = 21;

/**
 * nanoid-style collision-resistant id, generated in app code so every row id is
 * known before insert. `prefix` keeps ids self-describing in logs and URLs.
 */
export function id(prefix?: string): string {
  const bytes = randomBytes(SIZE);
  let out = "";
  for (let i = 0; i < SIZE; i++) out += ALPHABET[bytes[i]! & 63];
  return prefix ? `${prefix}_${out}` : out;
}
