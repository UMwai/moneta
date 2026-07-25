import { randomUUID } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

import type { SessionUser } from "@/lib/types";

export const SESSION_COOKIE_NAME = "moneta_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
const SESSION_ISSUER = "moneta";
const SESSION_AUDIENCE = "moneta";

/**
 * A session as it travels in the cookie. `sessionVersion` mirrors the user row;
 * the API compares the two on every request so logout and password changes can
 * revoke tokens that are otherwise valid for their full seven days.
 */
export interface SessionClaims extends SessionUser {
  sessionVersion: number;
}

function sessionSecret(secret = process.env.SESSION_SECRET): Uint8Array {
  if (!secret) {
    throw new Error("SESSION_SECRET is required");
  }

  const encoded = new TextEncoder().encode(secret);
  if (encoded.byteLength < 32) {
    throw new Error("SESSION_SECRET must be at least 32 bytes");
  }
  return encoded;
}

export function assertSessionConfigured(): void {
  sessionSecret();
}

export async function signSession(
  user: SessionClaims,
  secret?: string,
): Promise<string> {
  return new SignJWT({ username: user.username, ver: user.sessionVersion })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setJti(randomUUID())
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(sessionSecret(secret));
}

export async function verifySession(
  token: string,
  secret?: string,
): Promise<SessionClaims | null> {
  try {
    const { payload, protectedHeader } = await jwtVerify(
      token,
      sessionSecret(secret),
      {
        algorithms: ["HS256"],
        issuer: SESSION_ISSUER,
        audience: SESSION_AUDIENCE,
      },
    );

    if (
      protectedHeader.alg !== "HS256" ||
      typeof payload.sub !== "string" ||
      typeof payload.username !== "string" ||
      // A token minted before session versioning has no budget to check against,
      // so it is not accepted at all rather than defaulted to version 1.
      typeof payload.ver !== "number"
    ) {
      return null;
    }

    return {
      id: payload.sub,
      username: payload.username,
      sessionVersion: payload.ver,
    };
  } catch {
    return null;
  }
}

export async function setSession(user: SessionClaims): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, await signSession(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    path: "/",
    maxAge: 0,
  });
}

export async function getSession(): Promise<SessionClaims | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return token ? verifySession(token) : null;
}

/**
 * Signature-only check. The API additionally verifies `sessionVersion` against
 * the user row (see requireLiveSession); this is the cookie-level gate that
 * src/proxy.ts, which has no database, is limited to.
 */
export async function requireSession(): Promise<SessionClaims> {
  const user = await getSession();
  if (!user) {
    throw new SessionRequiredError();
  }
  return user;
}

export class SessionRequiredError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "SessionRequiredError";
  }
}
