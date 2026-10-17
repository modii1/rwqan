export interface LoginRateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export const ADMIN_LOGIN_MAX_ATTEMPTS = 5;
export const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;

interface LoginAttemptWindow {
  attempts: number;
  resetAt: number;
}

/** Counts every privileged login attempt within a bounded fixed window. */
export class AdminLoginRateLimiter {
  private readonly attempts = new Map<string, LoginAttemptWindow>();

  constructor(
    private readonly maxAttempts = ADMIN_LOGIN_MAX_ATTEMPTS,
    private readonly windowMs = ADMIN_LOGIN_WINDOW_MS,
    private readonly maxTrackedClients = 10_000,
  ) {}

  consume(key: string, now = Date.now()): LoginRateLimitResult {
    this.pruneExpired(now);

    const existing = this.attempts.get(key);
    if (existing && existing.resetAt > now) {
      if (existing.attempts >= this.maxAttempts) {
        return { allowed: false, retryAfterMs: existing.resetAt - now };
      }

      existing.attempts += 1;
      return { allowed: true, retryAfterMs: 0 };
    }

    if (this.attempts.size >= this.maxTrackedClients) {
      const oldestKey = this.attempts.keys().next().value as string | undefined;
      if (oldestKey) this.attempts.delete(oldestKey);
    }

    this.attempts.set(key, {
      attempts: 1,
      resetAt: now + this.windowMs,
    });
    return { allowed: true, retryAfterMs: 0 };
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }

  private pruneExpired(now: number): void {
    for (const [key, window] of this.attempts) {
      if (window.resetAt <= now) this.attempts.delete(key);
    }
  }
}
