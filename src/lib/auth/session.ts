import { randomUUID } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

import type { SessionUser } from "@/lib/types";

export const SESSION_COOKIE_NAME = "moneta_session";
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

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
  user: SessionUser,
  secret?: string,
): Promise<string> {
  return new SignJWT({ username: user.username })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(sessionSecret(secret));
}

export async function verifySession(
  token: string,
  secret?: string,
): Promise<SessionUser | null> {
  try {
    const { payload, protectedHeader } = await jwtVerify(
      token,
      sessionSecret(secret),
      { algorithms: ["HS256"] },
    );

    if (
      protectedHeader.alg !== "HS256" ||
      typeof payload.sub !== "string" ||
      typeof payload.username !== "string"
    ) {
      return null;
    }

    return { id: payload.sub, username: payload.username };
  } catch {
    return null;
  }
}

export async function setSession(user: SessionUser): Promise<void> {
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

export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return token ? verifySession(token) : null;
}

export async function requireSession(): Promise<SessionUser> {
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
