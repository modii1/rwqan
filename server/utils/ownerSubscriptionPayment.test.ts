import assert from "node:assert/strict";
import test from "node:test";

import {
  createOwnerSubscriptionPaymentPlan,
  OwnerSubscriptionPaymentPlanError,
} from "./ownerSubscriptionPayment";

const legacyVip = {
  id: "pkg-month-2properties",
  name: "VIP",
  price: 25,
  maxProperties: 5,
  duration: 30,
  type: "مميز",
} as any;

test("existing VIP pair extends directly for 50 without re-entering its child", () => {
  const plan = createOwnerSubscriptionPaymentPlan({
    action: "extend",
    mainPropertyNumber: "99655",
    existingLinkedPropertyNumbers: ["99651"],
    requestedPropertyNumbers: [],
    pkg: legacyVip,
  });

  assert.deepEqual(plan.linkedPropertyNumbers, ["99651"]);
  assert.deepEqual(plan.requestedPropertyNumbers, []);
  assert.equal(plan.pricing.total, 50);
});

test("an existing VIP pair plus one genuinely new property costs 75", () => {
  const plan = createOwnerSubscriptionPaymentPlan({
    action: "extend",
    mainPropertyNumber: "99655",
    existingLinkedPropertyNumbers: ["99651"],
    requestedPropertyNumbers: ["99651", "99657"],
    pkg: legacyVip,
  });

  assert.deepEqual(plan.requestedPropertyNumbers, ["99657"]);
  assert.deepEqual(plan.linkedPropertyNumbers, ["99651", "99657"]);
  assert.equal(plan.pricing.total, 75);
});

test("a new VIP activation still requires its included second property", () => {
  assert.throws(
    () => createOwnerSubscriptionPaymentPlan({
      action: "new",
      mainPropertyNumber: "10000",
      existingLinkedPropertyNumbers: [],
      requestedPropertyNumbers: [],
      pkg: legacyVip,
    }),
    (error: unknown) => {
      assert.ok(error instanceof OwnerSubscriptionPaymentPlanError);
      assert.equal(error.code, "PACKAGE_MINIMUM_PROPERTIES_REQUIRED");
      return true;
    },
  );
});

test("new properties cannot exceed the package limit", () => {
  assert.throws(
    () => createOwnerSubscriptionPaymentPlan({
      action: "extend",
      mainPropertyNumber: "10000",
      existingLinkedPropertyNumbers: ["10001", "10002", "10003", "10004"],
      requestedPropertyNumbers: ["10005"],
      pkg: legacyVip,
    }),
    (error: unknown) => {
      assert.ok(error instanceof OwnerSubscriptionPaymentPlanError);
      assert.equal(error.code, "PACKAGE_PROPERTY_LIMIT_EXCEEDED");
      return true;
    },
  );
});

test("a solo VIP extension is allowed but retains the 50 SAR base", () => {
  const plan = createOwnerSubscriptionPaymentPlan({
    action: "extend",
    mainPropertyNumber: "10000",
    existingLinkedPropertyNumbers: [],
    requestedPropertyNumbers: [],
    pkg: legacyVip,
  });

  assert.equal(plan.pricing.total, 50);
});
