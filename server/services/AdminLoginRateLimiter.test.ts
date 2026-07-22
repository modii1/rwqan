import assert from "node:assert/strict";
import test from "node:test";
import { AdminLoginRateLimiter } from "./AdminLoginRateLimiter";

test("admin login limiter blocks attempts beyond its fixed window", () => {
  const limiter = new AdminLoginRateLimiter(2, 1_000);

  assert.equal(limiter.consume("client", 100).allowed, true);
  assert.equal(limiter.consume("client", 200).allowed, true);
  assert.deepEqual(limiter.consume("client", 300), {
    allowed: false,
    retryAfterMs: 800,
  });
});

test("admin login limiter resets after expiry or successful login", () => {
  const limiter = new AdminLoginRateLimiter(1, 1_000);

  assert.equal(limiter.consume("client", 100).allowed, true);
  assert.equal(limiter.consume("client", 200).allowed, false);
  assert.equal(limiter.consume("client", 1_100).allowed, true);

  limiter.clear("client");
  assert.equal(limiter.consume("client", 1_101).allowed, true);
});
