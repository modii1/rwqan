import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateActionDates,
  hasPriorSubscription,
  isLegacyPaymentFulfillment,
  validatePaymentSubscriptionAction,
  validateSubscriptionAction,
} from "./paymentScenarioFlow";

function subscription(status: string, daysFromNow: number) {
  const endDate = new Date();
  endDate.setUTCDate(endDate.getUTCDate() + daysFromNow);

  return {
    id: "sub-test",
    propertyNumber: "12345",
    packageId: "pkg-test",
    startDate: new Date().toISOString(),
    endDate: endDate.toISOString(),
    status,
  } as any;
}

test("keeps inactive subscriptions out of upgrade and extension flows", () => {
  const inactive = subscription("غير نشط", 30);

  assert.equal(validateSubscriptionAction("upgrade", inactive).ok, false);
  assert.equal(validateSubscriptionAction("extend", inactive).ok, false);
});

test("starts a new activation from today for a prior inactive subscription", () => {
  const inactive = subscription("غير نشط", 30);
  const before = Date.now();
  const dates = calculateActionDates("new", inactive, 30);
  const after = Date.now();

  assert.equal(hasPriorSubscription(inactive), true);
  assert.ok(dates.startDate.getTime() <= after);
  assert.ok(dates.startDate.getTime() >= before - 24 * 60 * 60 * 1000);
  assert.ok(dates.endDate.getTime() > dates.startDate.getTime());
});

test("keeps the ten-day extension window for active subscriptions", () => {
  const elevenDays = validateSubscriptionAction("extend", subscription("نشط", 11));
  const tenDays = validateSubscriptionAction("extend", subscription("نشط", 10));
  const lastDay = validateSubscriptionAction("extend", subscription("نشط", 0));
  const expiringStatus = validateSubscriptionAction("extend", subscription("expiring", 5));
  const expired = validateSubscriptionAction("extend", subscription("نشط", -1));

  assert.equal(elevenDays.ok, false);
  assert.deepEqual(tenDays, { ok: true });
  assert.deepEqual(lastDay, { ok: true });
  assert.deepEqual(expiringStatus, { ok: true });
  assert.equal(expired.ok, false);
});

test("new activation cannot replace an active subscription", () => {
  assert.equal(validatePaymentSubscriptionAction("new", subscription("نشط", 20)).ok, false);
  assert.deepEqual(
    validatePaymentSubscriptionAction("new", subscription("منتهي", -1)),
    { ok: true },
  );
  assert.equal(validatePaymentSubscriptionAction("unknown", null).ok, false);
});

test("legacy fulfillment detection never bypasses an existing claim state", () => {
  const matchingSubscription = { paymentId: "PAY-1" } as any;

  assert.equal(
    isLegacyPaymentFulfillment({ id: "PAY-1" }, matchingSubscription),
    true,
  );
  assert.equal(
    isLegacyPaymentFulfillment(
      { id: "PAY-1", fulfillmentState: "processing" },
      matchingSubscription,
    ),
    false,
  );
  assert.equal(
    isLegacyPaymentFulfillment(
      { id: "PAY-1", fulfillmentState: "failed" },
      matchingSubscription,
    ),
    false,
  );
  assert.equal(
    isLegacyPaymentFulfillment(
      { id: "PAY-1", fulfilledAt: new Date().toISOString() },
      matchingSubscription,
    ),
    false,
  );
});
