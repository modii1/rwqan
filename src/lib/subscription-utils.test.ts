import assert from "node:assert/strict";
import test from "node:test";

import { canExtendSubscription } from "./subscription-utils";

function dateDaysFromToday(days: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = new Date(Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day) + days,
    12,
  ));
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
