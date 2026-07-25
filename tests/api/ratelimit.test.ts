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

  it("drops keys whose whole window has expired", () => {
    const limiter = new SlidingWindowRateLimiter(5, 1_000);

    for (const key of ["a", "b", "c"]) limiter.consume(key, 100);
    expect(limiter.size).toBe(3);

    // The next request after the window is what pays for the cleanup, so the
    // map cannot keep growing between requests either.
    limiter.consume("d", 2_000);
    expect(limiter.size).toBe(1);
  });

  it("caps the map and evicts the least recently used key", () => {
    const limiter = new SlidingWindowRateLimiter(1, 60_000, 3);

    limiter.consume("a", 10);
    limiter.consume("b", 20);
    limiter.consume("c", 30);
    // Touching "a" again makes "b" the least recently used.
    expect(limiter.consume("a", 40).allowed).toBe(false);
    limiter.consume("d", 50);

    expect(limiter.size).toBe(3);
    // "a" was touched most recently and keeps its spent budget; "b" was the
    // eviction victim and starts over.
    expect(limiter.consume("a", 60).allowed).toBe(false);
    expect(limiter.consume("b", 61).allowed).toBe(true);
  });

  it("stays bounded under an unbounded stream of one-shot keys", () => {
    const limiter = new SlidingWindowRateLimiter(5, 60_000, 50);

    for (let i = 0; i < 5_000; i += 1) {
      limiter.consume(`spoofed-${i}`, 1_000 + i);
    }

    expect(limiter.size).toBeLessThanOrEqual(50);
  });
});
