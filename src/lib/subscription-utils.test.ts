import assert from "node:assert/strict";
import test from "node:test";

import { canExtendSubscription } from "./subscription-utils";

function dateDaysFromToday(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

test("renewal visibility is limited to active subscriptions with 0..10 days", () => {
  assert.equal(canExtendSubscription(dateDaysFromToday(11), "active"), false);
  assert.equal(canExtendSubscription(dateDaysFromToday(10), "active"), true);
  assert.equal(canExtendSubscription(dateDaysFromToday(0), "active"), true);
  assert.equal(canExtendSubscription(dateDaysFromToday(-1), "active"), false);
  assert.equal(canExtendSubscription(null, "active"), false);
  assert.equal(canExtendSubscription(dateDaysFromToday(5), "suspended"), false);
});
