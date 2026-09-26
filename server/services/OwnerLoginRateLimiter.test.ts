import assert from "node:assert/strict";
import test from "node:test";

import {
  OwnerLoginRateLimiter,
  type OwnerLoginLimitStore,
} from "./OwnerLoginRateLimiter";

class MemoryLimitStore implements OwnerLoginLimitStore {
  readonly calls: Array<{ ipSubject: string; propertySubject: string }> = [];
  readonly cleared: Array<{ ipSubject: string; propertySubject: string }> = [];
  private counts = new Map<string, { count: number; start: number }>();

  async consume(input: {
    ipSubject: string;
    propertySubject: string;
    now: number;
    windowMs: number;
    maxAttemptsPerIp: number;
    maxAttemptsPerProperty: number;
  }) {
    this.calls.push(input);
    const keys = [
      [`ip:${input.ipSubject}`, input.maxAttemptsPerIp] as const,
      [`property:${input.propertySubject}`, input.maxAttemptsPerProperty] as const,
    ];
    let retryAfterMs = 0;
    for (const [key, maximum] of keys) {
      const current = this.counts.get(key);
      const active = current && input.now - current.start < input.windowMs;
      const state = active ? current : { count: 0, start: input.now };
      if (state.count >= maximum) {
        retryAfterMs = Math.max(
          retryAfterMs,
          input.windowMs - (input.now - state.start),
        );
      }
    }
    if (retryAfterMs > 0) return { allowed: false as const, retryAfterMs };
    for (const [key] of keys) {
      const current = this.counts.get(key);
      const active = current && input.now - current.start < input.windowMs;
      const state = active ? current : { count: 0, start: input.now };
      this.counts.set(key, { ...state, count: state.count + 1 });
    }
    return { allowed: true as const, retryAfterMs: 0 as const };
  }

  async clear(input: { ipSubject: string; propertySubject: string }) {
    this.cleared.push(input);
    this.counts.delete(`property:${input.propertySubject}`);
  }
}

test("legacy owner login limiter uses opaque subjects and blocks by property", async () => {
  const store = new MemoryLimitStore();
  const limiter = new OwnerLoginRateLimiter(store, {
    secret: "l".repeat(32),
    now: () => 1_000,
    windowMs: 10_000,
    maxAttemptsPerIp: 10,
    maxAttemptsPerProperty: 2,
  });
  const input = { ipAddress: "127.0.0.1", propertyNumber: "12345" };
  assert.equal((await limiter.consume(input)).allowed, true);
  assert.equal((await limiter.consume(input)).allowed, true);
  const blocked = await limiter.consume(input);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 10_000);
  assert.equal(store.calls[0]?.ipSubject.length, 64);
  assert.equal(store.calls[0]?.propertySubject.length, 64);
  assert.doesNotMatch(JSON.stringify(store.calls), /127\.0\.0\.1|12345/);
});

test("successful legacy owner login resets the property limit without erasing the IP budget", async () => {
  const store = new MemoryLimitStore();
  const limiter = new OwnerLoginRateLimiter(store, {
    secret: "l".repeat(32),
    now: () => 1_000,
    windowMs: 10_000,
    maxAttemptsPerIp: 2,
    maxAttemptsPerProperty: 1,
  });
  const input = { ipAddress: "127.0.0.1", propertyNumber: "12345" };
  assert.equal((await limiter.consume(input)).allowed, true);
  assert.equal((await limiter.consume(input)).allowed, false);
  await limiter.clear(input);
  assert.equal((await limiter.consume(input)).allowed, true);
  assert.equal((await limiter.consume({
    ipAddress: input.ipAddress,
    propertyNumber: "67890",
  })).allowed, false);
  assert.equal(store.cleared.length, 1);
});
