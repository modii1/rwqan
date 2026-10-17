import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS,
  MAX_SUBSCRIPTION_REMAINING_DAYS,
  SUBSCRIPTION_RENEWAL_WINDOW_DAYS,
  isPurchasableSubscriptionPackage,
  isSubscriptionPackageDurationAllowed,
  normalizeSubscriptionPackageDuration,
} from "./subscriptionPackagePolicy";

test("normalizes positive whole-day package durations", () => {
  assert.equal(normalizeSubscriptionPackageDuration(1), 1);
  assert.equal(normalizeSubscriptionPackageDuration("90"), 90);

  for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "", "days", true, null]) {
    assert.equal(normalizeSubscriptionPackageDuration(invalid), null);
  }
});

test("limits active packages to 90 days while allowing longer inactive packages", () => {
  assert.equal(MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS, 90);
  assert.equal(SUBSCRIPTION_RENEWAL_WINDOW_DAYS, 10);
  assert.equal(MAX_SUBSCRIPTION_REMAINING_DAYS, 100);
  assert.equal(
    isSubscriptionPackageDurationAllowed(MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS, true),
    true,
  );
  assert.equal(
    isSubscriptionPackageDurationAllowed(MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS + 1, true),
    false,
  );
  assert.equal(
    isSubscriptionPackageDurationAllowed(MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS + 1, false),
    true,
  );
  assert.equal(isSubscriptionPackageDurationAllowed(365, false), true);
  assert.equal(isSubscriptionPackageDurationAllowed(0, false), false);
});

test("only active packages within the duration limit are purchasable", () => {
  assert.equal(
    isPurchasableSubscriptionPackage({ duration: 90, isActive: true }),
    true,
  );
  assert.equal(
    isPurchasableSubscriptionPackage({ durationDays: 30, isActive: true }),
    true,
  );
  assert.equal(
    isPurchasableSubscriptionPackage({ duration: 91, isActive: true }),
    false,
  );
  assert.equal(
    isPurchasableSubscriptionPackage({ duration: 30, isActive: false }),
    false,
  );
  assert.equal(
    isPurchasableSubscriptionPackage({ duration: 0, isActive: true }),
    false,
  );
});
