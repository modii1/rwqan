import assert from "node:assert/strict";
import { test } from "node:test";

import { hasValidPremiumSubscription, isPublicPropertyPremium } from "./public-subscription";

const now = new Date("2026-07-10T12:00:00.000+03:00");

test("premium requires an active, unexpired subscription", () => {
  assert.equal(hasValidPremiumSubscription({
    subscriptionType: "مميز",
    status: "ساري",
    endDate: "2026-07-11",
  }, now), true);

  assert.equal(hasValidPremiumSubscription({
    subscriptionType: "مميز",
    status: "منتهي",
    endDate: "2026-07-11",
  }, now), false);

  assert.equal(hasValidPremiumSubscription({
    subscriptionType: "مميز",
    status: "موقوف مؤقتاً",
    endDate: "2026-07-11",
  }, now), false);
});

test("the final calendar day is still valid", () => {
  assert.equal(isPublicPropertyPremium({
    subscriptionType: "مميز",
    subscriptionStatus: "ساري",
    subscriptionEndDate: "2026-07-10",
    isSubscriptionExpired: false,
  }, now), true);
});

test("a stale premium property without a valid end date is ordinary", () => {
  assert.equal(isPublicPropertyPremium({
    subscriptionType: "مميز",
    subscriptionStatus: "ساري",
    subscriptionEndDate: null,
  }, now), false);
});
