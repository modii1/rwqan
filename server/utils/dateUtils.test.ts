import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_SUBSCRIPTION_DAYS,
  MAX_SUBSCRIPTION_DURATION_MS,
  capAtMaxDays,
  capSubscriptionDurationMs,
  calculateRemainingDays,
  calculateExtensionEndDate,
  calculateSubscriptionEndDate,
  getMaxSubscriptionEndDate,
  isSubscriptionEndDateWithinMaxDays,
} from "./dateUtils";

const referenceDate = new Date("2026-07-21T12:00:00+03:00");

test("the subscription ceiling is the end of the 100th Riyadh day", () => {
  const maxEndDate = getMaxSubscriptionEndDate(referenceDate);

  assert.equal(MAX_SUBSCRIPTION_DAYS, 100);
  assert.equal(maxEndDate.toISOString(), "2026-10-29T20:59:59.999Z");
  assert.equal(
    isSubscriptionEndDateWithinMaxDays(maxEndDate, referenceDate),
    true,
  );
  assert.equal(
    isSubscriptionEndDateWithinMaxDays("2026-10-30", referenceDate),
    false,
  );
});

test("dates beyond the ceiling are capped while valid dates are preserved", () => {
  const overLimit = new Date("2026-11-19T20:59:59.999Z");
  const withinLimit = new Date("2026-10-20T20:59:59.999Z");

  assert.equal(
    capAtMaxDays(overLimit, MAX_SUBSCRIPTION_DAYS, referenceDate).toISOString(),
    "2026-10-29T20:59:59.999Z",
  );
  assert.equal(
    capAtMaxDays(withinLimit, MAX_SUBSCRIPTION_DAYS, referenceDate).toISOString(),
    withinLimit.toISOString(),
  );
});

test("calculated activations and extensions end at the Riyadh day boundary", () => {
  const activationEnd = calculateSubscriptionEndDate(null, 30);
  const extensionEnd = calculateExtensionEndDate(activationEnd, 5);
  const riyadhTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  assert.equal(riyadhTime.format(activationEnd), "23:59:59");
  assert.equal(activationEnd.getMilliseconds(), 999);
  assert.equal(calculateRemainingDays(activationEnd), 30);
  assert.equal(riyadhTime.format(extensionEnd), "23:59:59");
  assert.equal(calculateRemainingDays(extensionEnd), 35);
});

test("a 90-day package preserves the ten-day renewal balance", () => {
  const activationEnd = calculateSubscriptionEndDate(null, 90);
  const currentEnd = calculateSubscriptionEndDate(null, 10);
  const extensionEnd = calculateExtensionEndDate(currentEnd, 90);

  assert.equal(calculateRemainingDays(activationEnd), 90);
  assert.equal(calculateRemainingDays(currentEnd), 10);
  assert.equal(calculateRemainingDays(extensionEnd), 100);
});

test("frozen subscription duration cannot exceed 100 exact days", () => {
  assert.equal(
    capSubscriptionDurationMs(MAX_SUBSCRIPTION_DURATION_MS + 123_456),
    MAX_SUBSCRIPTION_DURATION_MS,
  );
  assert.equal(
    capSubscriptionDurationMs(10 * 24 * 60 * 60 * 1000),
    10 * 24 * 60 * 60 * 1000,
  );
});

test("invalid duration inputs fail closed", () => {
  assert.throws(() => capAtMaxDays(new Date("invalid")), RangeError);
  assert.throws(() => capSubscriptionDurationMs(-1), RangeError);
});
