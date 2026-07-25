export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Keys tracked before the least-recently-used ones are dropped. */
const DEFAULT_MAX_KEYS = 10_000;

export class SlidingWindowRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys: number = DEFAULT_MAX_KEYS,
  ) {
    if (!Number.isInteger(limit) || limit < 1 || windowMs < 1 || maxKeys < 1) {
      throw new Error("Rate-limit settings must be positive");
    }
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    this.sweep(now);

    const cutoff = now - this.windowMs;
    const recent = (this.attempts.get(key) ?? []).filter(
      (timestamp) => timestamp > cutoff,
    );

    if (recent.length >= this.limit) {
      this.touch(key, recent);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((recent[0] + this.windowMs - now) / 1000),
        ),
      };
    }

    recent.push(now);
    this.touch(key, recent);
    return {
      allowed: true,
      remaining: this.limit - recent.length,
      retryAfterSeconds: 0,
    };
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  /** Tracked keys; exposed so the eviction behaviour is observable in tests. */
  get size(): number {
    return this.attempts.size;
  }

  /** Re-insert so the key moves to the most-recently-used end of the map. */
  private touch(key: string, timestamps: number[]): void {
    this.attempts.delete(key);
    this.attempts.set(key, timestamps);

    // Keys the app never sees again (a rotated spoofed address, a one-off
    // username) would otherwise be retained forever, so the map is bounded and
    // overflow drops the least recently used entry — the one furthest from
    // being able to spend its remaining budget.
    while (this.attempts.size > this.maxKeys) {
      const oldest = this.attempts.keys().next();
      if (oldest.done) break;
      this.attempts.delete(oldest.value);
    }
  }

  /**
   * Every write re-inserts, so the map runs least- to most-recently-written and
   * the head is where fully expired windows collect. Stopping at the first live
   * entry keeps this O(number dropped) rather than O(size) per request; entries
   * that expire out of order are collected on a later pass or by the LRU cap.
   */
  private sweep(now: number): void {
    const cutoff = now - this.windowMs;
    for (const [key, timestamps] of this.attempts) {
      if ((timestamps[timestamps.length - 1] ?? 0) > cutoff) break;
      this.attempts.delete(key);
    }
  }
}

/**
 * Login budgets. The address limiter is the first gate; the account limiter is
 * keyed on the submitted username so an attacker who can rotate the address key
 * (see clientAddressKey) still cannot buy extra guesses against the account.
 */
export const loginRateLimiter = new SlidingWindowRateLimiter(
  5,
  15 * 60 * 1000,
);

export const loginAccountRateLimiter = new SlidingWindowRateLimiter(
  10,
  15 * 60 * 1000,
);
