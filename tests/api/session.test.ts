import { describe, expect, it } from "vitest";

import { signSession, verifySession } from "@/lib/auth/session";

const SECRET = "test-secret-with-at-least-thirty-two-characters";

describe("session tokens", () => {
  it("signs and verifies an HS256 session round trip", async () => {
    const user = { id: "user-1", username: "alice" };
    const token = await signSession(user, SECRET);

    await expect(verifySession(token, SECRET)).resolves.toEqual(user);
  });

  it("rejects tampered tokens and tokens signed by another secret", async () => {
    const token = await signSession(
      { id: "user-1", username: "alice" },
      SECRET,
    );
    const segments = token.split(".");
    segments[2] = `${segments[2][0] === "a" ? "b" : "a"}${segments[2].slice(1)}`;
    const tampered = segments.join(".");

    await expect(verifySession(tampered, SECRET)).resolves.toBeNull();
    await expect(
      verifySession(token, "a-different-secret-that-is-also-long-enough"),
    ).resolves.toBeNull();
  });
});
