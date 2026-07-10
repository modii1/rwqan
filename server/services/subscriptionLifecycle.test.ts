import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SubscriptionLifecycleError,
  calculateFrozenRemainingDays,
  calculateRemainingDurationMs,
  calculateResumedEndDate,
} from "./subscriptionLifecycle";

test("resume shifts expiry by the exact suspension duration", () => {
  const originalEnd = "2026-07-20T18:30:00.000Z";
  const suspendedAt = new Date("2026-07-09T10:15:00.000Z");
  const resumedAt = new Date("2026-07-14T16:45:00.000Z");

  const remainingDurationMs = calculateRemainingDurationMs(
    originalEnd,
    suspendedAt,
  );
  const resumedEnd = calculateResumedEndDate(remainingDurationMs, resumedAt);

  assert.equal(
    new Date(resumedEnd).getTime() - new Date(originalEnd).getTime(),
    resumedAt.getTime() - suspendedAt.getTime(),
  );
});

test("frozen remaining days rounds partial days up for display", () => {
  assert.equal(calculateFrozenRemainingDays(24 * 60 * 60 * 1000), 1);
  assert.equal(calculateFrozenRemainingDays(24 * 60 * 60 * 1000 + 1), 2);
});

test("a calendar-only end date includes the full final day in Riyadh", () => {
  const remainingDurationMs = calculateRemainingDurationMs(
    "2026-07-10",
    new Date("2026-07-10T12:00:00.000+03:00"),
  );

  assert.equal(calculateFrozenRemainingDays(remainingDurationMs), 1);
});

test("an expired subscription cannot be suspended", () => {
  assert.throws(
    () =>
      calculateRemainingDurationMs(
        "2026-07-09T10:00:00.000Z",
        new Date("2026-07-09T10:00:00.000Z"),
      ),
    (error: unknown) =>
      error instanceof SubscriptionLifecycleError && error.code === "NOT_ACTIVE",
  );
});

test("resume rejects missing or invalid frozen duration", () => {
  assert.throws(
    () => calculateResumedEndDate(Number.NaN, new Date()),
    (error: unknown) =>
      error instanceof SubscriptionLifecycleError &&
      error.code === "INVALID_SUSPENSION_STATE",
  );
});
