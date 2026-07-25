export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class SlidingWindowRateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    if (!Number.isInteger(limit) || limit < 1 || windowMs < 1) {
      throw new Error("Rate-limit settings must be positive");
    }
  }

  consume(key: string, now = Date.now()): RateLimitResult {
    const cutoff = now - this.windowMs;
    const recent = (this.attempts.get(key) ?? []).filter(
      (timestamp) => timestamp > cutoff,
    );

    if (recent.length >= this.limit) {
      this.attempts.set(key, recent);
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
    this.attempts.set(key, recent);
    return {
      allowed: true,
      remaining: this.limit - recent.length,
      retryAfterSeconds: 0,
    };
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}

export const loginRateLimiter = new SlidingWindowRateLimiter(
  5,
  15 * 60 * 1000,
);
