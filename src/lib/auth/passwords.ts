import {
  hash,
  hashSync as argon2HashSync,
  verify,
  type Algorithm,
} from "@node-rs/argon2";

const ARGON2_OPTIONS = {
  // @node-rs/argon2 exposes Algorithm as a const enum, which cannot be
  // referenced under Next's isolatedModules setting. 2 is Argon2id.
  algorithm: 2 as Algorithm,
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
  outputLen: 32,
} as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/** Synchronous variant for startup paths that are synchronous by contract. */
export function hashPasswordSync(password: string): string {
  return argon2HashSync(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
