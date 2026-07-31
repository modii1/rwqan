import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getPublicPropertyDisplayName,
  getPublicPropertyContactPolicyMessage,
  getPublicPropertyLabel,
  hasValidPremiumSubscription,
  isPublicPropertyPremium,
} from "./public-subscription";

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

test("expired properties expose a number label instead of their former premium name", () => {
  const expiredProperty = {
    propertyNumber: "14050",
    name: "Former premium name",
    subscriptionType: "مميز",
    subscriptionStatus: "منتهي",
    subscriptionEndDate: "2026-07-01",
    isSubscriptionExpired: true,
  };

  assert.equal(getPublicPropertyDisplayName(expiredProperty, now), "");
  assert.equal(getPublicPropertyLabel(expiredProperty, now), "عقار رقم 14050");
});

test("active premium properties retain their public name", () => {
  const premiumProperty = {
    propertyNumber: "14051",
    name: "Current premium name",
    subscriptionType: "مميز",
    subscriptionStatus: "ساري",
    subscriptionEndDate: "2026-07-11",
    isSubscriptionExpired: false,
  };

  assert.equal(
    getPublicPropertyDisplayName(premiumProperty, now),
    "Current premium name",
  );
  assert.equal(
    getPublicPropertyLabel(premiumProperty, now),
    "Current premium name",
  );
});

test("contact policy explains the free daily limit and premium unlimited access", () => {
  assert.equal(
    getPublicPropertyContactPolicyMessage({
      subscriptionType: "عادي",
      subscriptionStatus: "نشط مجاني",
      subscriptionEndDate: "2026-07-11",
    }, now),
    "العقار المجاني يتيح 3 محاولات تواصل عبر واتساب يومياً.",
  );
  assert.equal(
    getPublicPropertyContactPolicyMessage({
      subscriptionType: "مميز",
      subscriptionStatus: "ساري",
      subscriptionEndDate: "2026-07-11",
    }, now),
    "العقار المميز يتيح للعملاء تواصلاً غير محدود عبر واتساب.",
  );
});
