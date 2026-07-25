import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { signSession, verifySession } from "@/lib/auth/session";

const SECRET = "test-secret-with-at-least-thirty-two-characters";
const KEY = new TextEncoder().encode(SECRET);

describe("session tokens", () => {
  it("signs and verifies an HS256 session round trip", async () => {
    const user = { id: "user-1", username: "alice", sessionVersion: 3 };
    const token = await signSession(user, SECRET);

    await expect(verifySession(token, SECRET)).resolves.toEqual(user);
  });

  it("rejects tampered tokens and tokens signed by another secret", async () => {
    const token = await signSession(
      { id: "user-1", username: "alice", sessionVersion: 1 },
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

  it("rejects a token minted for another issuer or audience", async () => {
    const mint = (claims: { iss?: string; aud?: string }) =>
      new SignJWT({ username: "alice", ver: 1 })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject("user-1")
        .setIssuer(claims.iss ?? "moneta")
        .setAudience(claims.aud ?? "moneta")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(KEY);

    await expect(verifySession(await mint({}), SECRET)).resolves.toMatchObject({
      id: "user-1",
    });
    await expect(
      verifySession(await mint({ iss: "elsewhere" }), SECRET),
    ).resolves.toBeNull();
    await expect(
      verifySession(await mint({ aud: "elsewhere" }), SECRET),
    ).resolves.toBeNull();
  });

  it("rejects a token with no session version, which cannot be revoked", async () => {
    const token = await new SignJWT({ username: "alice" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject("user-1")
      .setIssuer("moneta")
      .setAudience("moneta")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(KEY);

    await expect(verifySession(token, SECRET)).resolves.toBeNull();
  });
});
