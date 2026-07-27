import assert from "node:assert/strict";
import test from "node:test";

import {
  activateVerifiedPaymentSubscription,
  calculateActionDates,
  hasPriorSubscription,
  isLegacyPaymentFulfillment,
  normalizeSubscriptionBoundaryEndDate,
  queueVerifiedNewPropertyForAdminApproval,
  validatePaymentSubscriptionAction,
  validateSubscriptionAction,
} from "./paymentScenarioFlow";
import { firebaseService } from "../firebaseService";
import { PartialMutationError } from "../errors/AdminApprovalError";

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

const emptyPropertyPlan = {
  kept: [],
  unlinked: [],
  maxProperties: 1,
  allowedLinkedCount: 0,
};

test("new-property queue stores and returns the same capped legacy pending end date", async () => {
  const originals = {
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    claimPaymentFulfillment: firebaseService.claimPaymentFulfillment,
    updatePayment: firebaseService.updatePayment,
    updateProperty: firebaseService.updateProperty,
    releasePaymentFulfillment: firebaseService.releasePaymentFulfillment,
  };
  let paymentUpdate: any;
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => null;
  (firebaseService as any).claimPaymentFulfillment = async () => ({
    status: "claimed",
    token: "queue-token",
  });
  (firebaseService as any).updatePayment = async (_id: string, updates: any) => {
    paymentUpdate = updates;
    return updates;
  };
  (firebaseService as any).updateProperty = async () => undefined;
  (firebaseService as any).releasePaymentFulfillment = async () => undefined;

  try {
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const result = await queueVerifiedNewPropertyForAdminApproval({
      payment: {
        id: "PAY-QUEUE-DATE",
        propertyNumber: "PROP-QUEUE",
        packageId: "PKG-1",
        amount: 100,
        finalAmount: 100,
        discountAmount: 0,
        status: "pending",
        action: "new",
      } as any,
      property: { propertyNumber: "PROP-QUEUE" } as any,
      pkg: {
        id: "PKG-1",
        name: "Package",
        duration: 30,
        price: 100,
        type: "premium",
      } as any,
      startDate: new Date(),
      endDate: farFuture,
      propertyPlan: emptyPropertyPlan,
    });

    assert.equal(result.endDate, paymentUpdate.pendingEndDate);
    assert.equal(paymentUpdate.pendingPropertyApproval, true);
    assert.ok(new Date(result.endDate).getTime() < farFuture.getTime());
  } finally {
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    firebaseService.claimPaymentFulfillment =
      originals.claimPaymentFulfillment;
    firebaseService.updatePayment = originals.updatePayment;
    firebaseService.updateProperty = originals.updateProperty;
    firebaseService.releasePaymentFulfillment =
      originals.releasePaymentFulfillment;
  }
});

test("activation persists and returns one canonical capped end date", async () => {
  const originals = {
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    claimPaymentFulfillment: firebaseService.claimPaymentFulfillment,
    addSubscriptionToSheet: firebaseService.addSubscriptionToSheet,
    updatePayment: firebaseService.updatePayment,
    updateVerificationStatus: firebaseService.updateVerificationStatus,
    getMultiPropertySubscriptions:
      firebaseService.getMultiPropertySubscriptions,
    completePaymentFulfillment: firebaseService.completePaymentFulfillment,
  };
  let storedSubscription: any;
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => null;
  (firebaseService as any).claimPaymentFulfillment = async () => ({
    status: "claimed",
    token: "activation-token",
  });
  (firebaseService as any).addSubscriptionToSheet = async (
    _propertyNumber: string,
    data: any,
  ) => {
    storedSubscription = data;
  };
  (firebaseService as any).updatePayment = async () => undefined;
  (firebaseService as any).updateVerificationStatus = async () => undefined;
  (firebaseService as any).getMultiPropertySubscriptions = async () => [];
  (firebaseService as any).completePaymentFulfillment = async () => undefined;

  try {
    const legacyPendingEnd = "2030-12-31T23:59:59.999Z";
    const expected = normalizeSubscriptionBoundaryEndDate(legacyPendingEnd);
    const result = await activateVerifiedPaymentSubscription({
      payment: {
        id: "PAY-ACTIVATE-DATE",
        propertyNumber: "PROP-ACTIVATE",
        packageId: "PKG-1",
        amount: 100,
        finalAmount: 100,
        discountAmount: 0,
        status: "نجح - قيد التحقق",
        action: "new",
      } as any,
      property: { propertyNumber: "PROP-ACTIVATE" } as any,
      pkg: {
        id: "PKG-1",
        name: "Package",
        duration: 30,
        price: 100,
        type: "premium",
      } as any,
      startDate: new Date(),
      endDate: legacyPendingEnd,
      propertyPlan: emptyPropertyPlan,
    });

    assert.equal(storedSubscription.endDate, expected);
    assert.equal(result.endDate, expected);
  } finally {
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    firebaseService.claimPaymentFulfillment =
      originals.claimPaymentFulfillment;
    firebaseService.addSubscriptionToSheet =
      originals.addSubscriptionToSheet;
    firebaseService.updatePayment = originals.updatePayment;
    firebaseService.updateVerificationStatus =
      originals.updateVerificationStatus;
    firebaseService.getMultiPropertySubscriptions =
      originals.getMultiPropertySubscriptions;
    firebaseService.completePaymentFulfillment =
      originals.completePaymentFulfillment;
  }
});

test("queued downgrade retry keeps the original unlink plan after payment arrays narrow", async () => {
  const originals = {
    getSubscriptionByPropertyNumber: firebaseService.getSubscriptionByPropertyNumber,
    claimPaymentFulfillment: firebaseService.claimPaymentFulfillment,
    updatePayment: firebaseService.updatePayment,
    updateProperty: firebaseService.updateProperty,
    updateSubscription: firebaseService.updateSubscription,
    releasePaymentFulfillment: firebaseService.releasePaymentFulfillment,
  };
  const basePayment: any = {
    id: "PAY-QUEUE-RETRY",
    propertyNumber: "PROP-MAIN",
    packageId: "PKG-DOWNGRADE",
    amount: 100,
    finalAmount: 100,
    discountAmount: 0,
    status: "pending",
    action: "upgrade",
    additionalProperties: ["PROP-KEEP", "PROP-UNLINK"],
    linkedProperties: ["PROP-KEEP", "PROP-UNLINK"],
  };
  const pkg: any = {
    id: "PKG-DOWNGRADE",
    name: "One linked property",
    duration: 30,
    price: 100,
    type: "premium",
    maxProperties: 2,
  };
  let persistedPaymentUpdate: any = null;
  let failFirstPropertyWrite = true;
  const propertyWrites: string[] = [];
  const subscriptionWrites: string[] = [];

  (firebaseService as any).getSubscriptionByPropertyNumber = async (
    propertyNumber: string,
  ) => propertyNumber === "PROP-UNLINK"
    ? { id: "LEGACY-UNLINK", propertyNumber }
    : null;
  (firebaseService as any).claimPaymentFulfillment = async () => ({
    status: "claimed",
    token: `queue-${Math.random()}`,
  });
  (firebaseService as any).updatePayment = async (_id: string, updates: any) => {
    persistedPaymentUpdate = { ...(persistedPaymentUpdate || {}), ...updates };
  };
  (firebaseService as any).updateProperty = async (propertyNumber: string) => {
    if (failFirstPropertyWrite) {
      failFirstPropertyWrite = false;
      throw new Error("simulated first queue write failure");
    }
    propertyWrites.push(propertyNumber);
  };
  (firebaseService as any).updateSubscription = async (id: string) => {
    subscriptionWrites.push(id);
  };
  (firebaseService as any).releasePaymentFulfillment = async () => undefined;

  try {
    await assert.rejects(
      queueVerifiedNewPropertyForAdminApproval({
        payment: basePayment,
        property: { propertyNumber: "PROP-MAIN" } as any,
        pkg,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }),
      PartialMutationError,
    );
    assert.deepEqual(persistedPaymentUpdate.fulfillmentPlan.unlinked, [
      "PROP-UNLINK",
    ]);
    assert.deepEqual(persistedPaymentUpdate.additionalProperties, ["PROP-KEEP"]);

    const retryPayment = {
      ...basePayment,
      ...persistedPaymentUpdate,
    };
    const result = await queueVerifiedNewPropertyForAdminApproval({
      payment: retryPayment,
      property: { propertyNumber: "PROP-MAIN" } as any,
      pkg,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    assert.deepEqual(result.unlinkedProperties, ["PROP-UNLINK"]);
    assert.ok(propertyWrites.includes("PROP-UNLINK"));
    assert.deepEqual(subscriptionWrites, ["LEGACY-UNLINK"]);
  } finally {
    firebaseService.getSubscriptionByPropertyNumber = originals.getSubscriptionByPropertyNumber;
    firebaseService.claimPaymentFulfillment = originals.claimPaymentFulfillment;
    firebaseService.updatePayment = originals.updatePayment;
    firebaseService.updateProperty = originals.updateProperty;
    firebaseService.updateSubscription = originals.updateSubscription;
    firebaseService.releasePaymentFulfillment = originals.releasePaymentFulfillment;
  }
});

test("activation downgrade retry uses its persisted pre-mutation group snapshot", async () => {
  const originals = {
    getSubscriptionByPropertyNumber: firebaseService.getSubscriptionByPropertyNumber,
    claimPaymentFulfillment: firebaseService.claimPaymentFulfillment,
    updatePayment: firebaseService.updatePayment,
    addSubscriptionToSheet: firebaseService.addSubscriptionToSheet,
    updateProperty: firebaseService.updateProperty,
    updateVerificationStatus: firebaseService.updateVerificationStatus,
    syncLinkedProperty: firebaseService.syncLinkedProperty,
    updateSubscription: firebaseService.updateSubscription,
    getMultiPropertySubscriptions: firebaseService.getMultiPropertySubscriptions,
    createMultiPropertySubscription: firebaseService.createMultiPropertySubscription,
    completePaymentFulfillment: firebaseService.completePaymentFulfillment,
  };
  const basePayment: any = {
    id: "PAY-ACTIVATE-RETRY",
    propertyNumber: "PROP-MAIN",
    packageId: "PKG-DOWNGRADE",
    amount: 100,
    finalAmount: 100,
    discountAmount: 0,
    status: "نجح - قيد التحقق",
    action: "upgrade",
    additionalProperties: ["PROP-KEEP", "PROP-UNLINK"],
    linkedProperties: ["PROP-KEEP", "PROP-UNLINK"],
  };
  const pkg: any = {
    id: "PKG-DOWNGRADE",
    name: "One linked property",
    duration: 30,
    price: 100,
    type: "premium",
    maxProperties: 2,
  };
  let persistedPlan: any = null;
  let appliedMainSubscription: any = null;
  let failFirstVerification = true;
  const propertyWrites: string[] = [];
  const unlinkedSubscriptionWrites: string[] = [];

  (firebaseService as any).getSubscriptionByPropertyNumber = async (
    propertyNumber: string,
  ) => {
    if (propertyNumber === "PROP-MAIN") return appliedMainSubscription;
    if (propertyNumber === "PROP-UNLINK") {
      return { id: "LEGACY-UNLINK", propertyNumber };
    }
    return null;
  };
  (firebaseService as any).claimPaymentFulfillment = async () => ({
    status: "claimed",
    token: `activation-${Math.random()}`,
    previousState: "processing",
  });
  (firebaseService as any).updatePayment = async (_id: string, updates: any) => {
    persistedPlan = updates.fulfillmentPlan || persistedPlan;
  };
  (firebaseService as any).addSubscriptionToSheet = async (
    propertyNumber: string,
    data: any,
  ) => {
    appliedMainSubscription = {
      id: "LEGACY-MAIN",
      propertyNumber,
      ...data,
      status: "نشط",
    };
  };
  (firebaseService as any).updateProperty = async (propertyNumber: string) => {
    propertyWrites.push(propertyNumber);
  };
  (firebaseService as any).updateVerificationStatus = async () => {
    if (failFirstVerification) {
      failFirstVerification = false;
      throw new Error("simulated post-main failure");
    }
  };
  (firebaseService as any).syncLinkedProperty = async () => undefined;
  (firebaseService as any).updateSubscription = async (id: string) => {
    unlinkedSubscriptionWrites.push(id);
  };
  (firebaseService as any).getMultiPropertySubscriptions = async () => [];
  (firebaseService as any).createMultiPropertySubscription = async () => ({});
  (firebaseService as any).completePaymentFulfillment = async () => undefined;

  try {
    await assert.rejects(
      activateVerifiedPaymentSubscription({
        payment: basePayment,
        property: { propertyNumber: "PROP-MAIN" } as any,
        pkg,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }),
      PartialMutationError,
    );
    assert.deepEqual(persistedPlan.unlinked, ["PROP-UNLINK"]);
    assert.deepEqual(appliedMainSubscription.linkedProperties, ["PROP-KEEP"]);

    const result = await activateVerifiedPaymentSubscription({
      payment: {
        ...basePayment,
        additionalProperties: ["PROP-KEEP"],
        linkedProperties: ["PROP-KEEP"],
        fulfillmentPlan: persistedPlan,
      },
      property: { propertyNumber: "PROP-MAIN" } as any,
      pkg,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    assert.deepEqual(result.unlinkedProperties, ["PROP-UNLINK"]);
    assert.ok(propertyWrites.includes("PROP-UNLINK"));
    assert.deepEqual(unlinkedSubscriptionWrites, ["LEGACY-UNLINK"]);
  } finally {
    firebaseService.getSubscriptionByPropertyNumber = originals.getSubscriptionByPropertyNumber;
    firebaseService.claimPaymentFulfillment = originals.claimPaymentFulfillment;
    firebaseService.updatePayment = originals.updatePayment;
    firebaseService.addSubscriptionToSheet = originals.addSubscriptionToSheet;
    firebaseService.updateProperty = originals.updateProperty;
    firebaseService.updateVerificationStatus = originals.updateVerificationStatus;
    firebaseService.syncLinkedProperty = originals.syncLinkedProperty;
    firebaseService.updateSubscription = originals.updateSubscription;
    firebaseService.getMultiPropertySubscriptions = originals.getMultiPropertySubscriptions;
    firebaseService.createMultiPropertySubscription = originals.createMultiPropertySubscription;
    firebaseService.completePaymentFulfillment = originals.completePaymentFulfillment;
  }
});
