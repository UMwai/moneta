import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiError } from "@/lib/types";

const PASSWORD = "correct horse battery staple";
const USERNAME = "ada";

const { setSession } = vi.hoisted(() => ({ setSession: vi.fn(async () => {}) }));

// The route only needs the cookie writer stubbed; next/headers is unavailable
// outside a request scope.
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  setSession,
}));

vi.mock("@/lib/server/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/store")>();
  const { hashPassword } = await import("@/lib/auth/passwords");
  return {
    ...actual,
    store: new actual.InMemoryStore({
      users: [
        {
          id: "usr_ada",
          username: USERNAME,
          passwordHash: await hashPassword(PASSWORD),
          sessionVersion: 4,
        },
      ],
    }),
  };
});

const { loginAccountRateLimiter, loginRateLimiter } = await import(
  "@/lib/auth/ratelimit"
);
const { POST: login } = await import("@/app/api/auth/login/route");

function attempt(password: string, forwardedFor?: string): Promise<Response> {
  return login(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
      },
      body: JSON.stringify({ username: USERNAME, password }),
    }),
  );
}

async function code(response: Response): Promise<string | undefined> {
  return ((await response.json()) as ApiError).error?.code;
}

beforeEach(() => {
  setSession.mockClear();
  loginRateLimiter.reset("untrusted");
  loginAccountRateLimiter.reset(USERNAME);
  for (let hop = 0; hop < 20; hop += 1) {
    loginRateLimiter.reset(`203.0.113.${hop}`);
  }
});

afterEach(() => {
  delete process.env.TRUST_PROXY;
});

describe("POST /api/auth/login", () => {
  it("signs the user in with their current session version", async () => {
    const response = await attempt(PASSWORD);

    expect(response.status).toBe(200);
    expect(setSession).toHaveBeenCalledWith({
      id: "usr_ada",
      username: USERNAME,
      sessionVersion: 4,
    });
  });

  it("blocks further attempts once the address budget is spent", async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await attempt("wrong")).status).toBe(401);
    }

    const blocked = await attempt("wrong");
    expect(blocked.status).toBe(429);
    expect(await code(blocked)).toBe("RATE_LIMITED");
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });

  it("does not let a rotated X-Forwarded-For reset the account budget", async () => {
    process.env.TRUST_PROXY = "1";

    // Each request arrives on a fresh address key, so only the per-account
    // budget stands between the attacker and unlimited guesses.
    for (let hop = 0; hop < 10; hop += 1) {
      expect(loginRateLimiter.consume(`203.0.113.${hop}`).allowed).toBe(true);
      expect(loginAccountRateLimiter.consume(USERNAME).allowed).toBe(true);
    }

    const blocked = await attempt("wrong", "203.0.113.11");
    expect(blocked.status).toBe(429);
    expect(await code(blocked)).toBe("RATE_LIMITED");
  });

  it("ignores a rotated X-Forwarded-For entirely without TRUST_PROXY", async () => {
    for (let hop = 0; hop < 5; hop += 1) {
      expect((await attempt("wrong", `203.0.113.${hop}`)).status).toBe(401);
    }

    expect((await attempt("wrong", "203.0.113.99")).status).toBe(429);
  });

  it("clears both budgets on a successful sign-in", async () => {
    for (let i = 0; i < 3; i += 1) {
      expect((await attempt("wrong")).status).toBe(401);
    }
    expect((await attempt(PASSWORD)).status).toBe(200);

    // Without the reset the sixth attempt overall would already be blocked.
    for (let i = 0; i < 3; i += 1) {
      expect((await attempt("wrong")).status).toBe(401);
    }
  });
});
