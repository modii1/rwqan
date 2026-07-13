import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateActionDates,
  hasPriorSubscription,
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
  const tooEarly = validateSubscriptionAction("extend", subscription("نشط", 20));
  const allowed = validateSubscriptionAction("extend", subscription("نشط", 5));

  assert.equal(tooEarly.ok, false);
  assert.deepEqual(allowed, { ok: true });
});
