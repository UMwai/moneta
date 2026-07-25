import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "@/lib/auth/passwords";

describe("passwords", () => {
  it("hashes with argon2id and verifies the right password", async () => {
    const passwordHash = await hashPassword("correct horse battery staple");

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    await expect(
      verifyPassword(passwordHash, "correct horse battery staple"),
    ).resolves.toBe(true);
    await expect(verifyPassword(passwordHash, "wrong password")).resolves.toBe(
      false,
    );
  });

  it("fails closed for a malformed hash", async () => {
    await expect(verifyPassword("not-an-argon-hash", "password")).resolves.toBe(
      false,
    );
  });
});
