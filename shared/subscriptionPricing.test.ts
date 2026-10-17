import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateSubscriptionPrice,
  getMaximumPropertyCount,
} from "./subscriptionPricing";

test("legacy VIP pricing charges 50 SAR for two properties and 25 for each extra", () => {
  const legacyVip = {
    id: "pkg-month-2properties",
    price: 25,
    maxProperties: 5,
  } as any;

  assert.deepEqual(calculateSubscriptionPrice(legacyVip, 1), {
    basePrice: 50,
    includedPropertyCount: 2,
    additionalPropertyPrice: 25,
    billedPropertyCount: 2,
    additionalPropertyCount: 0,
    total: 50,
  });
  assert.equal(calculateSubscriptionPrice(legacyVip, 2).total, 50);
  assert.equal(calculateSubscriptionPrice(legacyVip, 3).total, 75);
  assert.equal(calculateSubscriptionPrice(legacyVip, 4).total, 100);
  assert.equal(calculateSubscriptionPrice(legacyVip, 5).total, 125);
  assert.equal(getMaximumPropertyCount(legacyVip), 5);
});

test("normalized multi-property pricing uses the configured base and add-on price", () => {
  const vip = {
    id: "vip-v2",
    price: 50,
    pricePerProperty: 25,
    propertyCount: 2,
    maxProperties: 5,
  } as any;

  assert.equal(calculateSubscriptionPrice(vip, 1).total, 50);
  assert.equal(calculateSubscriptionPrice(vip, 2).total, 50);
  assert.equal(calculateSubscriptionPrice(vip, 3).total, 75);
});

test("single-property packages retain their configured price", () => {
  const single = {
    id: "gold",
    price: 40,
    propertyCount: 1,
    maxProperties: 1,
  } as any;

  assert.equal(calculateSubscriptionPrice(single, 1).total, 40);
  assert.equal(getMaximumPropertyCount(single), 1);
});
