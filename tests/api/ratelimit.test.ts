import { describe, expect, it } from "vitest";

import { SlidingWindowRateLimiter } from "@/lib/auth/ratelimit";

describe("SlidingWindowRateLimiter", () => {
  it("blocks attempts inside the window and admits them after expiry", () => {
    const limiter = new SlidingWindowRateLimiter(2, 1_000);

    expect(limiter.consume("client", 1_000)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(limiter.consume("client", 1_100)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.consume("client", 1_200)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 1,
    });
    expect(limiter.consume("client", 2_001).allowed).toBe(true);
  });

  it("isolates keys and supports reset", () => {
    const limiter = new SlidingWindowRateLimiter(1, 1_000);

    expect(limiter.consume("a", 10).allowed).toBe(true);
    expect(limiter.consume("a", 20).allowed).toBe(false);
    expect(limiter.consume("b", 20).allowed).toBe(true);
    limiter.reset("a");
    expect(limiter.consume("a", 30).allowed).toBe(true);
  });
});
