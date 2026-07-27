import assert from "node:assert/strict";
import test from "node:test";

import { AdminApprovalError } from "../errors/AdminApprovalError";
import { firebaseService } from "../firebaseService";
import { adminApprovalService } from "./AdminApprovalService";
import { paymentService } from "./PaymentService";

const completeApproval = (propertyNumber: string) => ({
  property: {
    propertyNumber,
    name: `Property ${propertyNumber}`,
    whatsappNumber: "",
  },
  imageCount: 3,
  validation: {
    isComplete: true,
    missingFields: [],
    warnings: [],
    completionScore: 100,
  },
}) as any;

const emptyFulfillmentPlan = {
  kept: [],
  unlinked: [],
  maxProperties: 1,
  allowedLinkedCount: 0,
};

async function captureAdminApprovalError(
  operation: () => Promise<unknown>,
): Promise<AdminApprovalError> {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof AdminApprovalError);
  return caught;
}

test("manual payment approval performs no mutations when property preflight fails", async () => {
  const originals = {
    getPaymentById: firebaseService.getPaymentById,
    getPackageById: firebaseService.getPackageById,
    updatePaymentStatus: firebaseService.updatePaymentStatus,
    updatePayment: firebaseService.updatePayment,
    updateVerificationStatus: firebaseService.updateVerificationStatus,
    updateProperty: firebaseService.updateProperty,
    addVerificationLog: firebaseService.addVerificationLog,
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    requireCompleteProperty: adminApprovalService.requireCompleteProperty,
  };
  const mutations: string[] = [];

  (firebaseService as any).getPaymentById = async () => ({
    id: "PAY-1",
    propertyNumber: "PROP-1",
    packageId: "PKG-1",
    status: "قيد المراجعة",
  });
  (firebaseService as any).getPackageById = async () => ({
    id: "PKG-1",
    duration: 30,
    price: 500,
    type: "مميز",
  });
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => null;
  for (const methodName of [
    "updatePaymentStatus",
    "updatePayment",
    "updateVerificationStatus",
    "addVerificationLog",
  ] as const) {
    (firebaseService as any)[methodName] = async () => {
      mutations.push(methodName);
      throw new Error(`Unexpected mutation: ${methodName}`);
    };
  }
  (adminApprovalService as any).requireCompleteProperty = async () => {
    throw new AdminApprovalError({
      status: 422,
      code: "PROPERTY_INCOMPLETE",
      message: "Property is incomplete.",
      missingFields: ["location", "images"],
    });
  };

  try {
    await assert.rejects(
      () => paymentService.approveBankTransfer("PAY-1"),
      (error: unknown) => {
        assert.ok(error instanceof AdminApprovalError);
        assert.equal(error.code, "PROPERTY_INCOMPLETE");
        assert.deepEqual(error.missingFields, ["location", "images"]);
        return true;
      },
    );
    assert.deepEqual(mutations, []);
  } finally {
    firebaseService.getPaymentById = originals.getPaymentById;
    firebaseService.getPackageById = originals.getPackageById;
    firebaseService.updatePaymentStatus = originals.updatePaymentStatus;
    firebaseService.updatePayment = originals.updatePayment;
    firebaseService.updateVerificationStatus =
      originals.updateVerificationStatus;
    firebaseService.addVerificationLog = originals.addVerificationLog;
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    adminApprovalService.requireCompleteProperty =
      originals.requireCompleteProperty;
  }
});

test("manual payment approval preflights every linked property before activation", async () => {
  const originals = {
    getPaymentById: firebaseService.getPaymentById,
    getPackageById: firebaseService.getPackageById,
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    claimPaymentFulfillment: firebaseService.claimPaymentFulfillment,
    requireCompleteProperty: adminApprovalService.requireCompleteProperty,
  };
  const preflightCalls: string[] = [];
  let claimCalls = 0;

  (firebaseService as any).getPaymentById = async () => ({
    id: "PAY-LINKED",
    propertyNumber: "PROP-MAIN",
    packageId: "PKG-MULTI",
    status: "pending",
    action: "upgrade",
    additionalProperties: ["PROP-LINK-1", "PROP-LINK-2"],
  });
  (firebaseService as any).getPackageById = async () => ({
    id: "PKG-MULTI",
    duration: 30,
    price: 900,
    type: "premium",
    maxProperties: 3,
  });
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => ({
    id: "SUB-PROP-MAIN",
    propertyNumber: "PROP-MAIN",
    packageId: "PKG-OLD",
    startDate: "2026-07-01T00:00:00.000Z",
    endDate: "2026-07-31T00:00:00.000Z",
    status: "active",
    paymentId: "PAY-OLD",
  });
  (firebaseService as any).claimPaymentFulfillment = async () => {
    claimCalls += 1;
    throw new Error("Activation must not start before every preflight passes");
  };
  (adminApprovalService as any).requireCompleteProperty =
    async (propertyNumber: string) => {
      preflightCalls.push(propertyNumber);
      if (propertyNumber === "PROP-LINK-2") {
        throw new AdminApprovalError({
          status: 422,
          code: "PROPERTY_INCOMPLETE",
          message: "Linked property is incomplete.",
          missingFields: ["images (1/3 minimum)"],
        });
      }
      return completeApproval(propertyNumber);
    };

  try {
    const error = await captureAdminApprovalError(() =>
      paymentService.approveBankTransfer("PAY-LINKED"),
    );

    assert.deepEqual(
      {
        code: error.code,
        missingFields: error.missingFields,
        preflightCalls,
        claimCalls,
      },
      {
        code: "PROPERTY_INCOMPLETE",
        missingFields: ["PROP-LINK-2: images (1/3 minimum)"],
        preflightCalls: ["PROP-MAIN", "PROP-LINK-1", "PROP-LINK-2"],
        claimCalls: 0,
      },
    );
  } finally {
    firebaseService.getPaymentById = originals.getPaymentById;
    firebaseService.getPackageById = originals.getPackageById;
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    firebaseService.claimPaymentFulfillment =
      originals.claimPaymentFulfillment;
    adminApprovalService.requireCompleteProperty =
      originals.requireCompleteProperty;
  }
});

test("a post-write activation failure is partial and cannot double-extend on retry", async () => {
  const originals = {
    getPaymentById: firebaseService.getPaymentById,
    getPackageById: firebaseService.getPackageById,
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    getMultiPropertySubscriptions: firebaseService.getMultiPropertySubscriptions,
    claimPaymentFulfillment: firebaseService.claimPaymentFulfillment,
    releasePaymentFulfillment: firebaseService.releasePaymentFulfillment,
    completePaymentFulfillment: firebaseService.completePaymentFulfillment,
    addSubscriptionToSheet: firebaseService.addSubscriptionToSheet,
    updateVerificationStatus: firebaseService.updateVerificationStatus,
    updateProperty: firebaseService.updateProperty,
    updatePayment: firebaseService.updatePayment,
    addVerificationLog: firebaseService.addVerificationLog,
    requireCompleteProperty: adminApprovalService.requireCompleteProperty,
  };
  const payment = {
    id: "PAY-EXTEND",
    propertyNumber: "PROP-EXTEND",
    packageId: "PKG-EXTEND",
    status: "pending",
    action: "extend",
    amount: 500,
  } as any;
  let currentSubscription = {
    id: "SUB-PROP-EXTEND",
    propertyNumber: "PROP-EXTEND",
    packageId: "PKG-OLD",
    startDate: "2026-07-01T00:00:00.000Z",
    endDate: "2026-07-30T00:00:00.000Z",
    status: "active",
    paymentId: "PAY-OLD",
  } as any;
  let fulfillmentState: "available" | "processing" | "failed" = "available";
  let claimNumber = 0;
  let releaseCalls = 0;
  const subscriptionWrites: string[] = [];
  let mirrorRepairWrites = 0;

  (firebaseService as any).getPaymentById = async () => payment;
  (firebaseService as any).getPackageById = async () => ({
    id: "PKG-EXTEND",
    duration: 5,
    price: 500,
    type: "premium",
    maxProperties: 1,
  });
  (firebaseService as any).getSubscriptionByPropertyNumber = async () =>
    currentSubscription;
  (firebaseService as any).getMultiPropertySubscriptions = async () => [];
  (firebaseService as any).claimPaymentFulfillment = async () => {
    if (fulfillmentState === "processing") {
      return { status: "processing" };
    }
    const previousState = fulfillmentState === "failed" ? "failed" : undefined;
    claimNumber += 1;
    fulfillmentState = "processing";
    return {
      status: "claimed",
      token: `claim-${claimNumber}`,
      previousState,
    };
  };
  (firebaseService as any).releasePaymentFulfillment = async () => {
    releaseCalls += 1;
    fulfillmentState = "failed";
  };
  (firebaseService as any).addSubscriptionToSheet = async (
    _propertyNumber: string,
    subscriptionData: any,
  ) => {
    subscriptionWrites.push(subscriptionData.endDate);
    currentSubscription = {
      ...currentSubscription,
      endDate: subscriptionData.endDate,
      paymentId: payment.id,
    };
    throw new Error("Property mirror failed after subscription persisted");
  };
  (firebaseService as any).updateVerificationStatus = async () => ({});
  (firebaseService as any).updateProperty = async () => {
    mirrorRepairWrites += 1;
    return {};
  };
  (firebaseService as any).completePaymentFulfillment = async () => {
    fulfillmentState = "processing";
    payment.fulfilledAt = new Date().toISOString();
  };
  (firebaseService as any).updatePayment = async () => payment;
  (firebaseService as any).addVerificationLog = async () => undefined;
  (adminApprovalService as any).requireCompleteProperty = async (
    propertyNumber: string,
  ) => completeApproval(propertyNumber);

  try {
    const firstError = await captureAdminApprovalError(() =>
      paymentService.approveBankTransfer(payment.id),
    );
    const endDateAfterFirstWrite = currentSubscription.endDate;
    const secondError = await captureAdminApprovalError(() =>
      paymentService.approveBankTransfer(payment.id),
    );
    // Simulate the original claim becoming stale/reclaimable. Recovery must
    // detect that this payment already wrote the subscription and resume the
    // remaining idempotent steps without extending it again.
    fulfillmentState = "failed";
    const recovered = await paymentService.approveBankTransfer(payment.id);

    assert.deepEqual(
      {
        firstCode: firstError.code,
        firstPartial: firstError.partial,
        secondCode: secondError.code,
        subscriptionWriteCount: subscriptionWrites.length,
        releaseCalls,
        recoveredOutcome: recovered.outcome,
        mirrorRepairWrites,
        endDateUnchangedByRetry:
          currentSubscription.endDate === endDateAfterFirstWrite,
      },
      {
        firstCode: "PAYMENT_ACTIVATION_FAILED",
        firstPartial: true,
        secondCode: "PAYMENT_FULFILLMENT_IN_PROGRESS",
        subscriptionWriteCount: 1,
        releaseCalls: 0,
        recoveredOutcome: "activated",
        mirrorRepairWrites: 1,
        endDateUnchangedByRetry: true,
      },
    );
  } finally {
    firebaseService.getPaymentById = originals.getPaymentById;
    firebaseService.getPackageById = originals.getPackageById;
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    firebaseService.getMultiPropertySubscriptions =
      originals.getMultiPropertySubscriptions;
    firebaseService.claimPaymentFulfillment =
      originals.claimPaymentFulfillment;
    firebaseService.releasePaymentFulfillment =
      originals.releasePaymentFulfillment;
    firebaseService.completePaymentFulfillment =
      originals.completePaymentFulfillment;
    firebaseService.addSubscriptionToSheet =
      originals.addSubscriptionToSheet;
    firebaseService.updateVerificationStatus =
      originals.updateVerificationStatus;
    firebaseService.updateProperty = originals.updateProperty;
    firebaseService.updatePayment = originals.updatePayment;
    firebaseService.addVerificationLog = originals.addVerificationLog;
    adminApprovalService.requireCompleteProperty =
      originals.requireCompleteProperty;
  }
});

test("a queue failure after the payment write is reported as partial", async () => {
  const originals = {
    getPaymentById: firebaseService.getPaymentById,
    getPackageById: firebaseService.getPackageById,
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    getMultiPropertySubscriptions: firebaseService.getMultiPropertySubscriptions,
    updatePayment: firebaseService.updatePayment,
    updateProperty: firebaseService.updateProperty,
    claimPaymentFulfillment: firebaseService.claimPaymentFulfillment,
    releasePaymentFulfillment: firebaseService.releasePaymentFulfillment,
    requireCompleteProperty: adminApprovalService.requireCompleteProperty,
  };
  let paymentWrites = 0;
  let queueMarkerWrites = 0;
  let propertyWriteAttempts = 0;
  let releaseCalls = 0;

  (firebaseService as any).getPaymentById = async () => ({
    id: "PAY-QUEUE",
    propertyNumber: "PROP-NEW",
    packageId: "PKG-NEW",
    status: "pending",
    action: "new",
    amount: 300,
  });
  (firebaseService as any).getPackageById = async () => ({
    id: "PKG-NEW",
    duration: 30,
    price: 300,
    type: "premium",
    maxProperties: 1,
  });
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => null;
  (firebaseService as any).getMultiPropertySubscriptions = async () => [];
  (firebaseService as any).updatePayment = async (_id: string, updates: any) => {
    paymentWrites += 1;
    if (updates.propertyApprovalQueuedAt) queueMarkerWrites += 1;
  };
  (firebaseService as any).updateProperty = async () => {
    propertyWriteAttempts += 1;
    throw new Error("Property queue write failed");
  };
  (firebaseService as any).claimPaymentFulfillment = async () => ({
    status: "claimed",
    token: "queue-claim",
  });
  (firebaseService as any).releasePaymentFulfillment = async () => {
    releaseCalls += 1;
  };
  (adminApprovalService as any).requireCompleteProperty = async (
    propertyNumber: string,
  ) => completeApproval(propertyNumber);

  try {
    const error = await captureAdminApprovalError(() =>
      paymentService.approveBankTransfer("PAY-QUEUE"),
    );

    assert.deepEqual(
      {
        code: error.code,
        partial: error.partial,
        paymentWrites,
        queueMarkerWrites,
        propertyWriteAttempts,
        releaseCalls,
      },
      {
        code: "PAYMENT_QUEUE_FAILED",
        partial: true,
        paymentWrites: 1,
        queueMarkerWrites: 0,
        propertyWriteAttempts: 1,
        releaseCalls: 0,
      },
    );
  } finally {
    firebaseService.getPaymentById = originals.getPaymentById;
    firebaseService.getPackageById = originals.getPackageById;
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    firebaseService.getMultiPropertySubscriptions =
      originals.getMultiPropertySubscriptions;
    firebaseService.updatePayment = originals.updatePayment;
    firebaseService.updateProperty = originals.updateProperty;
    firebaseService.claimPaymentFulfillment =
      originals.claimPaymentFulfillment;
    firebaseService.releasePaymentFulfillment =
      originals.releasePaymentFulfillment;
    adminApprovalService.requireCompleteProperty =
      originals.requireCompleteProperty;
  }
});

test("rejecting an unfulfilled renewal preserves the prior subscription", async () => {
  const originals = {
    getPaymentById: firebaseService.getPaymentById,
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    claimPaymentFulfillment: firebaseService.claimPaymentFulfillment,
    cancelSubscriptionIfOwnedByPayment:
      firebaseService.cancelSubscriptionIfOwnedByPayment,
    updatePaymentStatus: firebaseService.updatePaymentStatus,
    releasePaymentFulfillment: firebaseService.releasePaymentFulfillment,
    addVerificationLog: firebaseService.addVerificationLog,
  };
  const cancelledProperties: string[] = [];
  const statusWrites: string[] = [];
  let releaseCalls = 0;

  (firebaseService as any).getPaymentById = async () => ({
    id: "PAY-RENEWAL",
    propertyNumber: "PROP-MAIN",
    packageId: "PKG-NEW",
    status: "قيد المراجعة",
    action: "extend",
    additionalProperties: ["PROP-LINK"],
  });
  (firebaseService as any).getSubscriptionByPropertyNumber = async (
    propertyNumber: string,
  ) => ({
    id: `SUB-${propertyNumber}`,
    propertyNumber,
    paymentId: "PAY-PRIOR",
    status: "active",
    startDate: "2026-07-01T00:00:00.000Z",
    endDate: "2026-08-01T00:00:00.000Z",
  });
  (firebaseService as any).claimPaymentFulfillment = async () => ({
    status: "claimed",
    token: "reject-claim",
  });
  (firebaseService as any).cancelSubscriptionIfOwnedByPayment = async (
    propertyNumber: string,
  ) => {
    cancelledProperties.push(propertyNumber);
    return true;
  };
  (firebaseService as any).updatePaymentStatus = async (
    _paymentId: string,
    status: string,
  ) => {
    statusWrites.push(status);
  };
  (firebaseService as any).releasePaymentFulfillment = async () => {
    releaseCalls += 1;
  };
  (firebaseService as any).addVerificationLog = async () => undefined;

  try {
    await paymentService.rejectBankTransfer("PAY-RENEWAL");

    assert.deepEqual(cancelledProperties, []);
    assert.deepEqual(statusWrites, ["مرفوض"]);
    assert.equal(releaseCalls, 1);
  } finally {
    firebaseService.getPaymentById = originals.getPaymentById;
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    firebaseService.claimPaymentFulfillment =
      originals.claimPaymentFulfillment;
    firebaseService.cancelSubscriptionIfOwnedByPayment =
      originals.cancelSubscriptionIfOwnedByPayment;
    firebaseService.updatePaymentStatus = originals.updatePaymentStatus;
    firebaseService.releasePaymentFulfillment =
      originals.releasePaymentFulfillment;
    firebaseService.addVerificationLog = originals.addVerificationLog;
  }
});

test("payment rejection cannot race an already claimed activation", async () => {
  const originals = {
    getPaymentById: firebaseService.getPaymentById,
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    claimPaymentFulfillment: firebaseService.claimPaymentFulfillment,
    cancelSubscriptionIfOwnedByPayment:
      firebaseService.cancelSubscriptionIfOwnedByPayment,
    updatePaymentStatus: firebaseService.updatePaymentStatus,
  };
  let mutationCalls = 0;

  (firebaseService as any).getPaymentById = async () => ({
    id: "PAY-RACING",
    propertyNumber: "PROP-RACING",
    status: "نجح - قيد التحقق",
  });
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => null;
  (firebaseService as any).claimPaymentFulfillment = async () => ({
    status: "processing",
  });
  (firebaseService as any).cancelSubscriptionIfOwnedByPayment = async () => {
    mutationCalls += 1;
    return true;
  };
  (firebaseService as any).updatePaymentStatus = async () => {
    mutationCalls += 1;
  };

  try {
    const error = await captureAdminApprovalError(() =>
      paymentService.rejectBankTransfer("PAY-RACING"),
    );

    assert.equal(error.code, "PAYMENT_FULFILLMENT_IN_PROGRESS");
    assert.equal(mutationCalls, 0);
  } finally {
    firebaseService.getPaymentById = originals.getPaymentById;
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    firebaseService.claimPaymentFulfillment =
      originals.claimPaymentFulfillment;
    firebaseService.cancelSubscriptionIfOwnedByPayment =
      originals.cancelSubscriptionIfOwnedByPayment;
    firebaseService.updatePaymentStatus = originals.updatePaymentStatus;
  }
});

test("payment rejection cannot cancel a cross-payment replacement after its ownership snapshot", async () => {
  const originals = {
    getPaymentById: firebaseService.getPaymentById,
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    claimPaymentFulfillment: firebaseService.claimPaymentFulfillment,
    cancelSubscriptionIfOwnedByPayment:
      firebaseService.cancelSubscriptionIfOwnedByPayment,
    updatePaymentStatus: firebaseService.updatePaymentStatus,
    releasePaymentFulfillment: firebaseService.releasePaymentFulfillment,
    addVerificationLog: firebaseService.addVerificationLog,
  };
  const owners = new Map<string, string>([
    ["PROP-MAIN", "PAY-REJECT"],
    ["PROP-LINK", "PAY-REJECT"],
  ]);
  const cancelledProperties: string[] = [];
  const statusWrites: string[] = [];

  (firebaseService as any).getPaymentById = async () => ({
    id: "PAY-REJECT",
    propertyNumber: "PROP-MAIN",
    status: "pending",
    additionalProperties: ["PROP-LINK"],
  });
  (firebaseService as any).getSubscriptionByPropertyNumber = async (
    propertyNumber: string,
  ) => ({
    id: `SUB-${propertyNumber}`,
    propertyNumber,
    paymentId: owners.get(propertyNumber),
    linkedProperties:
      propertyNumber === "PROP-MAIN" ? ["PROP-LINK"] : undefined,
  });
  (firebaseService as any).claimPaymentFulfillment = async () => {
    // A different payment replaces both subscriptions after rejection read
    // them but before its guarded cancellation writes begin.
    owners.set("PROP-MAIN", "PAY-NEWER");
    owners.set("PROP-LINK", "PAY-NEWER");
    return { status: "claimed", token: "reject-claim" };
  };
  (firebaseService as any).cancelSubscriptionIfOwnedByPayment = async (
    propertyNumber: string,
    expectedPaymentId: string,
  ) => {
    if (owners.get(propertyNumber) !== expectedPaymentId) return false;
    cancelledProperties.push(propertyNumber);
    return true;
  };
  (firebaseService as any).updatePaymentStatus = async (
    _paymentId: string,
    status: string,
  ) => {
    statusWrites.push(status);
  };
  (firebaseService as any).releasePaymentFulfillment = async () => undefined;
  (firebaseService as any).addVerificationLog = async () => undefined;

  try {
    await assert.rejects(
      paymentService.rejectBankTransfer("PAY-REJECT"),
      (error: any) => error?.code === "PAYMENT_REJECTION_FAILED",
    );

    assert.deepEqual(cancelledProperties, []);
    assert.equal(owners.get("PROP-MAIN"), "PAY-NEWER");
    assert.equal(owners.get("PROP-LINK"), "PAY-NEWER");
    assert.deepEqual(statusWrites, []);
  } finally {
    firebaseService.getPaymentById = originals.getPaymentById;
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    firebaseService.claimPaymentFulfillment =
      originals.claimPaymentFulfillment;
    firebaseService.cancelSubscriptionIfOwnedByPayment =
      originals.cancelSubscriptionIfOwnedByPayment;
    firebaseService.updatePaymentStatus = originals.updatePaymentStatus;
    firebaseService.releasePaymentFulfillment =
      originals.releasePaymentFulfillment;
    firebaseService.addVerificationLog = originals.addVerificationLog;
  }
});

test("payment rejection cancels only matching linked subscriptions", async () => {
  const originals = {
    getPaymentById: firebaseService.getPaymentById,
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    claimPaymentFulfillment: firebaseService.claimPaymentFulfillment,
    cancelSubscriptionIfOwnedByPayment:
      firebaseService.cancelSubscriptionIfOwnedByPayment,
    updatePaymentStatus: firebaseService.updatePaymentStatus,
    releasePaymentFulfillment: firebaseService.releasePaymentFulfillment,
    addVerificationLog: firebaseService.addVerificationLog,
  };
  const owners = new Map<string, string>([
    ["PROP-MAIN", "PAY-REJECT"],
    ["PROP-OWNED", "PAY-REJECT"],
    ["PROP-OTHER", "PAY-OTHER"],
  ]);
  const cancelledProperties: string[] = [];

  (firebaseService as any).getPaymentById = async () => ({
    id: "PAY-REJECT",
    propertyNumber: "PROP-MAIN",
    status: "pending",
    additionalProperties: ["PROP-OWNED", "PROP-OTHER"],
  });
  (firebaseService as any).getSubscriptionByPropertyNumber = async (
    propertyNumber: string,
  ) => ({
    id: `SUB-${propertyNumber}`,
    propertyNumber,
    paymentId: owners.get(propertyNumber),
    linkedProperties:
      propertyNumber === "PROP-MAIN"
        ? ["PROP-OWNED", "PROP-OTHER"]
        : undefined,
  });
  (firebaseService as any).claimPaymentFulfillment = async () => ({
    status: "claimed",
    token: "reject-claim",
  });
  (firebaseService as any).cancelSubscriptionIfOwnedByPayment = async (
    propertyNumber: string,
    expectedPaymentId: string,
  ) => {
    if (owners.get(propertyNumber) !== expectedPaymentId) return false;
    cancelledProperties.push(propertyNumber);
    return true;
  };
  (firebaseService as any).updatePaymentStatus = async () => undefined;
  (firebaseService as any).releasePaymentFulfillment = async () => undefined;
  (firebaseService as any).addVerificationLog = async () => undefined;

  try {
    await paymentService.rejectBankTransfer("PAY-REJECT");

    assert.deepEqual(cancelledProperties, ["PROP-OWNED", "PROP-MAIN"]);
    assert.equal(owners.get("PROP-OTHER"), "PAY-OTHER");
  } finally {
    firebaseService.getPaymentById = originals.getPaymentById;
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    firebaseService.claimPaymentFulfillment =
      originals.claimPaymentFulfillment;
    firebaseService.cancelSubscriptionIfOwnedByPayment =
      originals.cancelSubscriptionIfOwnedByPayment;
    firebaseService.updatePaymentStatus = originals.updatePaymentStatus;
    firebaseService.releasePaymentFulfillment =
      originals.releasePaymentFulfillment;
    firebaseService.addVerificationLog = originals.addVerificationLog;
  }
});

test("rejecting an explicitly queued new property clears pending state and rejects verification", async () => {
  const originals = {
    getPaymentById: firebaseService.getPaymentById,
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    claimPaymentFulfillment: firebaseService.claimPaymentFulfillment,
    updateProperty: firebaseService.updateProperty,
    updatePaymentStatus: firebaseService.updatePaymentStatus,
    releasePaymentFulfillment: firebaseService.releasePaymentFulfillment,
    addVerificationLog: firebaseService.addVerificationLog,
  };
  const propertyUpdates: any[] = [];

  (firebaseService as any).getPaymentById = async () => ({
    id: "PAY-QUEUED-NEW",
    propertyNumber: "PROP-NEW",
    packageId: "PKG-1",
    status: "نجح - قيد التحقق",
    action: "new",
    pendingPropertyApproval: true,
  });
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => null;
  (firebaseService as any).claimPaymentFulfillment = async () => ({
    status: "claimed",
    token: "reject-new",
  });
  (firebaseService as any).updateProperty = async (
    _propertyNumber: string,
    updates: any,
  ) => {
    propertyUpdates.push(updates);
  };
  (firebaseService as any).updatePaymentStatus = async () => undefined;
  (firebaseService as any).releasePaymentFulfillment = async () => undefined;
  (firebaseService as any).addVerificationLog = async () => undefined;

  try {
    await paymentService.rejectBankTransfer("PAY-QUEUED-NEW");

    assert.deepEqual(propertyUpdates, [{
      pendingPaidSubscription: false,
      verificationStatus: "rejected",
    }]);
  } finally {
    firebaseService.getPaymentById = originals.getPaymentById;
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    firebaseService.claimPaymentFulfillment =
      originals.claimPaymentFulfillment;
    firebaseService.updateProperty = originals.updateProperty;
    firebaseService.updatePaymentStatus = originals.updatePaymentStatus;
    firebaseService.releasePaymentFulfillment =
      originals.releasePaymentFulfillment;
    firebaseService.addVerificationLog = originals.addVerificationLog;
  }
});

test("rejecting an unfulfilled queued renewal preserves property approval", async () => {
  const originals = {
    getPaymentById: firebaseService.getPaymentById,
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    claimPaymentFulfillment: firebaseService.claimPaymentFulfillment,
    cancelSubscriptionIfOwnedByPayment:
      firebaseService.cancelSubscriptionIfOwnedByPayment,
    updateProperty: firebaseService.updateProperty,
    updatePaymentStatus: firebaseService.updatePaymentStatus,
    releasePaymentFulfillment: firebaseService.releasePaymentFulfillment,
    addVerificationLog: firebaseService.addVerificationLog,
  };
  let propertyUpdateCalls = 0;
  let cancellationCalls = 0;

  (firebaseService as any).getPaymentById = async () => ({
    id: "PAY-QUEUED-RENEWAL",
    propertyNumber: "PROP-EXISTING",
    packageId: "PKG-1",
    status: "نجح - قيد التحقق",
    action: "extend",
  });
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => ({
    id: "SUB-PROP-EXISTING",
    propertyNumber: "PROP-EXISTING",
    paymentId: "PAY-PRIOR",
    status: "active",
  });
  (firebaseService as any).claimPaymentFulfillment = async () => ({
    status: "claimed",
    token: "reject-renewal",
  });
  (firebaseService as any).cancelSubscriptionIfOwnedByPayment = async () => {
    cancellationCalls += 1;
    return false;
  };
  (firebaseService as any).updateProperty = async () => {
    propertyUpdateCalls += 1;
  };
  (firebaseService as any).updatePaymentStatus = async () => undefined;
  (firebaseService as any).releasePaymentFulfillment = async () => undefined;
  (firebaseService as any).addVerificationLog = async () => undefined;

  try {
    await paymentService.rejectBankTransfer("PAY-QUEUED-RENEWAL");

    assert.equal(propertyUpdateCalls, 0);
    assert.equal(cancellationCalls, 0);
  } finally {
    firebaseService.getPaymentById = originals.getPaymentById;
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    firebaseService.claimPaymentFulfillment =
      originals.claimPaymentFulfillment;
    firebaseService.cancelSubscriptionIfOwnedByPayment =
      originals.cancelSubscriptionIfOwnedByPayment;
    firebaseService.updateProperty = originals.updateProperty;
    firebaseService.updatePaymentStatus = originals.updatePaymentStatus;
    firebaseService.releasePaymentFulfillment =
      originals.releasePaymentFulfillment;
    firebaseService.addVerificationLog = originals.addVerificationLog;
  }
});

test("manual confirmation preflights every linked property before fulfillment", async () => {
  const originals = {
    getPaymentById: firebaseService.getPaymentById,
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    claimPaymentFulfillment: firebaseService.claimPaymentFulfillment,
    addSubscriptionToSheet: firebaseService.addSubscriptionToSheet,
  };
  let fulfillmentClaims = 0;
  let subscriptionWrites = 0;

  (firebaseService as any).getPaymentById = async () => ({
    id: "PAY-MANUAL-GROUP",
    propertyNumber: "PROP-MAIN",
    packageId: "PKG-GROUP",
    status: "نجح - قيد التحقق",
    pendingStartDate: "2026-07-27T00:00:00.000Z",
    pendingEndDate: "2026-08-20T00:00:00.000Z",
    additionalProperties: ["PROP-CHILD"],
  });
  (firebaseService as any).getSubscriptionByPropertyNumber = async (
    propertyNumber: string,
  ) => ({
    id: `SUB-${propertyNumber}`,
    propertyNumber,
    status:
      propertyNumber === "PROP-CHILD" ? "موقوف مؤقتاً" : "ساري",
  });
  (firebaseService as any).claimPaymentFulfillment = async () => {
    fulfillmentClaims += 1;
    throw new Error("fulfillment must not be claimed");
  };
  (firebaseService as any).addSubscriptionToSheet = async () => {
    subscriptionWrites += 1;
    throw new Error("subscriptions must not be mutated");
  };

  try {
    await assert.rejects(
      () => paymentService.confirmManually("PAY-MANUAL-GROUP"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as any).code, "PROPERTY_SUSPENDED");
        assert.equal((error as any).status, 423);
        return true;
      },
    );
    assert.equal(fulfillmentClaims, 0);
    assert.equal(subscriptionWrites, 0);
  } finally {
    firebaseService.getPaymentById = originals.getPaymentById;
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    firebaseService.claimPaymentFulfillment =
      originals.claimPaymentFulfillment;
    firebaseService.addSubscriptionToSheet =
      originals.addSubscriptionToSheet;
  }
});

test("durably queued retries cannot duplicate queue side effects", async () => {
  const originals = {
    getPaymentById: firebaseService.getPaymentById,
    getPackageById: firebaseService.getPackageById,
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    claimPaymentFulfillment: firebaseService.claimPaymentFulfillment,
    addVerificationLog: firebaseService.addVerificationLog,
    requireCompleteProperty: adminApprovalService.requireCompleteProperty,
  };
  const unexpectedCalls: string[] = [];

  (firebaseService as any).getPaymentById = async () => ({
    id: "PAY-SERVICE-DURABLY-QUEUED",
    propertyNumber: "PROP-SERVICE-DURABLY-QUEUED",
    packageId: "PKG-1",
    status: "نجح - قيد التحقق",
    action: "new",
    pendingPropertyApproval: true,
    propertyApprovalQueuedAt: "2026-07-27T16:00:00.000Z",
  });
  for (const methodName of [
    "getPackageById",
    "getSubscriptionByPropertyNumber",
    "claimPaymentFulfillment",
    "addVerificationLog",
  ] as const) {
    (firebaseService as any)[methodName] = async () => {
      unexpectedCalls.push(methodName);
      throw new Error(`Unexpected call: ${methodName}`);
    };
  }
  (adminApprovalService as any).requireCompleteProperty = async () => {
    unexpectedCalls.push("requireCompleteProperty");
    throw new Error("Property preflight must not repeat for a completed queue");
  };

  try {
    const firstResult = await paymentService.approveBankTransfer(
      "PAY-SERVICE-DURABLY-QUEUED",
    );
    const replayResult = await paymentService.approveBankTransfer(
      "PAY-SERVICE-DURABLY-QUEUED",
    );

    assert.deepEqual(firstResult, {
      outcome: "queued",
      alreadyProcessed: true,
    });
    assert.deepEqual(replayResult, {
      outcome: "queued",
      alreadyProcessed: true,
    });
    assert.deepEqual(unexpectedCalls, []);
  } finally {
    firebaseService.getPaymentById = originals.getPaymentById;
    firebaseService.getPackageById = originals.getPackageById;
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    firebaseService.claimPaymentFulfillment =
      originals.claimPaymentFulfillment;
    firebaseService.addVerificationLog = originals.addVerificationLog;
    adminApprovalService.requireCompleteProperty =
      originals.requireCompleteProperty;
  }
});

test("approval repairs partial and rejected stale-marker queue states through the atomic claim", async () => {
  const originals = {
    getPaymentById: firebaseService.getPaymentById,
    getPackageById: firebaseService.getPackageById,
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    claimPaymentFulfillment: firebaseService.claimPaymentFulfillment,
    updatePayment: firebaseService.updatePayment,
    updateProperty: firebaseService.updateProperty,
    updateSubscription: firebaseService.updateSubscription,
    releasePaymentFulfillment: firebaseService.releasePaymentFulfillment,
    addVerificationLog: firebaseService.addVerificationLog,
    requireCompleteProperty: adminApprovalService.requireCompleteProperty,
    requireCompleteLinkedProperties:
      adminApprovalService.requireCompleteLinkedProperties,
  };
  const writes: string[] = [];
  let subscriptionReads = 0;
  let claimArguments: any[] | undefined;
  let paymentRecord: any = {
    id: "PAY-SERVICE-ALREADY-QUEUED",
    propertyNumber: "PROP-SERVICE-ALREADY-QUEUED",
    packageId: "PKG-1",
    status: "pending",
    action: "new",
    amount: 100,
    pendingPropertyApproval: true,
    fulfillmentState: "processing",
    fulfillmentClaimToken: "stale-queue-claim",
    fulfillmentClaimedAt: "2026-07-27T15:00:00.000Z",
    fulfillmentPlan: emptyFulfillmentPlan,
  };

  (firebaseService as any).getPaymentById = async () => paymentRecord;
  (firebaseService as any).getPackageById = async () => ({
    id: "PKG-1",
    duration: 30,
    price: 100,
    type: "premium",
    maxProperties: 1,
  });
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => {
    subscriptionReads += 1;
    return null;
  };
  (firebaseService as any).claimPaymentFulfillment = async (...args: any[]) => {
    claimArguments = args;
    return {
      status: "claimed",
      token: "retry-queue-claim",
      previousState: "processing",
    };
  };
  (firebaseService as any).updatePayment = async (
    _id: string,
    updates: any,
  ) => {
    writes.push(
      updates.propertyApprovalQueuedAt ? "queue-marker" : "payment-pending",
    );
  };
  (firebaseService as any).updateProperty = async () => {
    writes.push("property-pending");
  };
  (firebaseService as any).updateSubscription = async () => {
    writes.push("unexpected-subscription-write");
  };
  (firebaseService as any).releasePaymentFulfillment = async () => {
    writes.push("claim-release");
  };
  (firebaseService as any).addVerificationLog = async () => {
    writes.push("verification-log");
  };
  (adminApprovalService as any).requireCompleteProperty = async () => ({
    ...completeApproval("PROP-SERVICE-ALREADY-QUEUED"),
    property: {
      propertyNumber: "PROP-SERVICE-ALREADY-QUEUED",
      name: "Already queued property",
      whatsappNumber: "",
    },
  });
  (adminApprovalService as any).requireCompleteLinkedProperties = async () =>
    undefined;

  try {
    const result = await paymentService.approveBankTransfer(
      "PAY-SERVICE-ALREADY-QUEUED",
    );

    assert.deepEqual(result, { outcome: "queued" });
    assert.deepEqual(claimArguments, [
      "PAY-SERVICE-ALREADY-QUEUED",
      ["pending"],
      { purpose: "queue" },
    ]);
    assert.deepEqual(writes, [
      "payment-pending",
      "property-pending",
      "queue-marker",
      "claim-release",
      "verification-log",
    ]);
    // The partial pending flag does not bypass suspension/preflight/current
    // subscription reads; the queue is repaired through the normal claim.
    assert.equal(subscriptionReads, 3);

    writes.length = 0;
    subscriptionReads = 0;
    claimArguments = undefined;
    paymentRecord = {
      ...paymentRecord,
      status: "مرفوض",
      propertyApprovalQueuedAt: "2026-07-27T16:00:00.000Z",
    };

    const rejectedRetry = await paymentService.approveBankTransfer(
      "PAY-SERVICE-ALREADY-QUEUED",
    );

    assert.deepEqual(rejectedRetry, { outcome: "queued" });
    assert.deepEqual(claimArguments, [
      "PAY-SERVICE-ALREADY-QUEUED",
      ["مرفوض"],
      { purpose: "queue" },
    ]);
    assert.deepEqual(writes, [
      "payment-pending",
      "property-pending",
      "queue-marker",
      "claim-release",
      "verification-log",
    ]);
    assert.equal(subscriptionReads, 3);
  } finally {
    firebaseService.getPaymentById = originals.getPaymentById;
    firebaseService.getPackageById = originals.getPackageById;
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    firebaseService.claimPaymentFulfillment =
      originals.claimPaymentFulfillment;
    firebaseService.updatePayment = originals.updatePayment;
    firebaseService.updateProperty = originals.updateProperty;
    firebaseService.updateSubscription = originals.updateSubscription;
    firebaseService.releasePaymentFulfillment =
      originals.releasePaymentFulfillment;
    firebaseService.addVerificationLog = originals.addVerificationLog;
    adminApprovalService.requireCompleteProperty =
      originals.requireCompleteProperty;
    adminApprovalService.requireCompleteLinkedProperties =
      originals.requireCompleteLinkedProperties;
  }
});

test("approval treats an atomic fulfilled activation as already processed without duplicate status, log, or notification writes", async () => {
  const originals = {
    getPaymentById: firebaseService.getPaymentById,
    getPackageById: firebaseService.getPackageById,
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    claimPaymentFulfillment: firebaseService.claimPaymentFulfillment,
    updatePayment: firebaseService.updatePayment,
    addSubscriptionToSheet: firebaseService.addSubscriptionToSheet,
    updateProperty: firebaseService.updateProperty,
    updateVerificationStatus: firebaseService.updateVerificationStatus,
    completePaymentFulfillment: firebaseService.completePaymentFulfillment,
    releasePaymentFulfillment: firebaseService.releasePaymentFulfillment,
    addVerificationLog: firebaseService.addVerificationLog,
    requireCompleteProperty: adminApprovalService.requireCompleteProperty,
    requireCompleteLinkedProperties:
      adminApprovalService.requireCompleteLinkedProperties,
  };
  const writes: string[] = [];
  let subscriptionReads = 0;
  let claimArguments: any[] | undefined;
  const currentSubscription = {
    id: "SUB-PROP-SERVICE-FULFILLED",
    propertyNumber: "PROP-SERVICE-FULFILLED",
    packageId: "PKG-OLD",
    startDate: "2026-07-01T00:00:00.000Z",
    endDate: "2026-08-06T20:59:59.999Z",
    status: "active",
    paymentId: "PAY-OLDER",
    subscriptionType: "premium",
  } as any;

  (firebaseService as any).getPaymentById = async () => ({
    id: "PAY-SERVICE-ALREADY-FULFILLED",
    propertyNumber: "PROP-SERVICE-FULFILLED",
    packageId: "PKG-1",
    status: "pending",
    action: "upgrade",
    amount: 100,
    fulfillmentPlan: emptyFulfillmentPlan,
  });
  (firebaseService as any).getPackageById = async () => ({
    id: "PKG-1",
    duration: 30,
    price: 100,
    type: "premium",
    maxProperties: 1,
  });
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => {
    subscriptionReads += 1;
    return currentSubscription;
  };
  (firebaseService as any).claimPaymentFulfillment = async (...args: any[]) => {
    claimArguments = args;
    return { status: "fulfilled" };
  };
  for (const methodName of [
    "updatePayment",
    "addSubscriptionToSheet",
    "updateProperty",
    "updateVerificationStatus",
    "completePaymentFulfillment",
    "releasePaymentFulfillment",
    "addVerificationLog",
  ] as const) {
    (firebaseService as any)[methodName] = async () => {
      writes.push(methodName);
      throw new Error(`Unexpected write: ${methodName}`);
    };
  }
  (adminApprovalService as any).requireCompleteProperty = async () => ({
    ...completeApproval("PROP-SERVICE-FULFILLED"),
    property: {
      propertyNumber: "PROP-SERVICE-FULFILLED",
      name: "Already fulfilled property",
      whatsappNumber: "+966500000002",
    },
  });
  (adminApprovalService as any).requireCompleteLinkedProperties = async () =>
    undefined;

  try {
    const result = await paymentService.approveBankTransfer(
      "PAY-SERVICE-ALREADY-FULFILLED",
    );

    assert.deepEqual(result, {
      outcome: "activated",
      alreadyProcessed: true,
    });
    assert.deepEqual(claimArguments, [
      "PAY-SERVICE-ALREADY-FULFILLED",
      ["pending"],
    ]);
    assert.deepEqual(writes, []);
    // Suspension preflight, current-subscription lookup, and activation helper
    // read. A duplicate activation notification would add another read.
    assert.equal(subscriptionReads, 3);
  } finally {
    firebaseService.getPaymentById = originals.getPaymentById;
    firebaseService.getPackageById = originals.getPackageById;
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    firebaseService.claimPaymentFulfillment =
      originals.claimPaymentFulfillment;
    firebaseService.updatePayment = originals.updatePayment;
    firebaseService.addSubscriptionToSheet =
      originals.addSubscriptionToSheet;
    firebaseService.updateProperty = originals.updateProperty;
    firebaseService.updateVerificationStatus =
      originals.updateVerificationStatus;
    firebaseService.completePaymentFulfillment =
      originals.completePaymentFulfillment;
    firebaseService.releasePaymentFulfillment =
      originals.releasePaymentFulfillment;
    firebaseService.addVerificationLog = originals.addVerificationLog;
    adminApprovalService.requireCompleteProperty =
      originals.requireCompleteProperty;
    adminApprovalService.requireCompleteLinkedProperties =
      originals.requireCompleteLinkedProperties;
  }
});
