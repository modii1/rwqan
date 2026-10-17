import assert from "node:assert/strict";
import test from "node:test";
import {
  isSubscriptionStatusSuspended,
  normalizeSubscriptionStatus,
} from "./subscriptionType";

test("suspended subscription statuses normalize across current and legacy values", () => {
  for (const status of ["موقوف مؤقتاً", "  موقوف مؤقتاً  ", "suspended", " SUSPENDED "]) {
    assert.equal(normalizeSubscriptionStatus(status), "موقوف مؤقتاً");
    assert.equal(isSubscriptionStatusSuspended(status), true);
  }
});

test("non-suspended subscription statuses are not treated as suspended", () => {
  for (const status of [undefined, null, "", "ساري", "active", "موقوف", "cancelled", "expired"]) {
    assert.equal(isSubscriptionStatusSuspended(status), false);
  }
});
