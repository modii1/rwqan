import assert from "node:assert/strict";
import test from "node:test";

import { AdminApprovalError } from "../errors/AdminApprovalError";
import { firebaseService } from "../firebaseService";
import { paymobService } from "../integrations/paymob";
import { PaymentService } from "./PaymentService";

const modernPayment = {
  id: "PAY-ADMIN-1",
  propertyNumber: "PROP-ADMIN-1",
  packageId: "PKG-1",
  amount: 40,
  discountAmount: 0,
  finalAmount: 40,
  status: "قيد المراجعة",
  paymentMethod: "بطاقة",
  action: "extend",
  intentionState: "created",
  merchantAttemptKey: "RWQN-ADMIN-ATTEMPT-1",
  paymentReference: "pi_live_admin_1",
  transactionId: "pi_live_admin_1",
  paymentCheckoutUrl:
    "https://ksa.paymob.com/unifiedcheckout/?publicKey=pk&clientSecret=secret",
};

function assertAdminError(
  error: unknown,
  code: string,
  status: number,
): boolean {
  assert.equal(error instanceof AdminApprovalError, true);
  assert.equal((error as AdminApprovalError).code, code);
  assert.equal((error as AdminApprovalError).status, status);
  return true;
}

test("admin approval reconciles a modern Paymob payment and preserves bank/legacy fallbacks", async () => {
  const originalGetPayment = firebaseService.getPaymentById;
  const service = new PaymentService();
  let payment: any = { ...modernPayment };
  let reconciliations = 0;
  let manualApprovals = 0;

  (firebaseService as any).getPaymentById = async () => payment;
  (service as any).reconcilePaymobIntention = async (
    id: string,
    options: unknown,
  ) => {
    reconciliations += 1;
    assert.equal(id, payment.id);
    assert.deepEqual(options, {
      propagateActivationError: true,
      repairProcessedMetadata: true,
    });
    return { status: "paid", activation: "activated" };
  };
  (service as any).approveBankTransfer = async () => {
    manualApprovals += 1;
    return { outcome: "queued" };
  };

  try {
    assert.deepEqual(await service.approveAdminPayment(payment.id), {
      outcome: "activated",
    });
    assert.equal(reconciliations, 1);
    assert.equal(manualApprovals, 0);

    payment = {
      ...modernPayment,
      id: "PAY-BANK",
      paymentMethod: "تحويل بنكي",
    };
    assert.deepEqual(await service.approveAdminPayment(payment.id), {
      outcome: "activated",
    });
    assert.equal(reconciliations, 2);
    assert.equal(manualApprovals, 0);

    payment = {
      ...modernPayment,
      id: "PAY-BANK-LEGACY",
      paymentMethod: "تحويل بنكي",
      paymentReference: undefined,
      transactionId: undefined,
      merchantAttemptKey: undefined,
      paymentCheckoutUrl: undefined,
      paymobOrderId: undefined,
      intentionState: undefined,
    };
    assert.deepEqual(await service.approveAdminPayment(payment.id), {
      outcome: "queued",
    });
    assert.equal(reconciliations, 2);
    assert.equal(manualApprovals, 1);

    payment = {
      ...modernPayment,
      id: "PAY-LEGACY-CARD",
      paymentReference: undefined,
      transactionId: undefined,
      merchantAttemptKey: undefined,
      paymentCheckoutUrl: undefined,
      paymobOrderId: undefined,
      intentionState: undefined,
    };
    assert.deepEqual(await service.approveAdminPayment(payment.id), {
      outcome: "queued",
    });
    assert.equal(reconciliations, 2);
    assert.equal(manualApprovals, 2);
  } finally {
    (firebaseService as any).getPaymentById = originalGetPayment;
  }
});

test("admin approval fails closed for unpaid, unavailable, or mismatched Paymob state", async () => {
  const originalGetPayment = firebaseService.getPaymentById;
  const service = new PaymentService();
  let reconciliationStatus = "unpaid";
  let manualApprovals = 0;

  (firebaseService as any).getPaymentById = async () => ({ ...modernPayment });
  (service as any).reconcilePaymobIntention = async () => ({
    status: reconciliationStatus,
  });
  (service as any).approveBankTransfer = async () => {
    manualApprovals += 1;
    return { outcome: "activated" };
  };

  try {
    for (const scenario of [
      {
        status: "unpaid",
        code: "PAYMOB_PAYMENT_NOT_PAID",
        httpStatus: 409,
      },
      {
        status: "provider_unavailable",
        code: "PAYMOB_PROVIDER_UNAVAILABLE",
        httpStatus: 503,
      },
      {
        status: "identity_mismatch",
        code: "PAYMOB_PAYMENT_IDENTITY_MISMATCH",
        httpStatus: 409,
      },
    ]) {
      reconciliationStatus = scenario.status;
      await assert.rejects(
        () => service.approveAdminPayment(modernPayment.id),
        (error) => assertAdminError(error, scenario.code, scenario.httpStatus),
      );
    }
    assert.equal(manualApprovals, 0);
  } finally {
    (firebaseService as any).getPaymentById = originalGetPayment;
  }
});

test("provider-confirmed admin approval stores the exact card subtype, transaction and order before activation", async () => {
  const originals = {
    getPayment: firebaseService.getPaymentById,
    accept: firebaseService.acceptSuccessfulPaymentIntention,
    update: firebaseService.updatePayment,
    retrieve: paymobService.retrieveIntention,
  };
  const service = new PaymentService();
  let payment: any = { ...modernPayment };
  const acceptances: any[] = [];
  let activations = 0;
  let metadataUpdates = 0;

  (firebaseService as any).getPaymentById = async () => payment;
  (paymobService as any).retrieveIntention = async () => ({
    ok: true,
    snapshot: {
      intentionId: modernPayment.paymentReference,
      specialReference: modernPayment.merchantAttemptKey,
      orderId: "7220450",
      amountCents: 4_000,
      currency: "SAR",
      confirmed: true,
      paid: true,
      paidAt: "2026-07-27T19:01:05.000Z",
      cardExpired: false,
      signedTransaction: {
        transactionId: "8069835",
        orderId: "7220450",
        merchantOrderId: modernPayment.merchantAttemptKey,
        amountCents: 4_000,
        currency: "SAR",
        createdAt: "2026-07-27T19:01:02.000Z",
        paymentMethod: "card",
        cardSubType: "APPLE_PAY",
      },
    },
  });
  (firebaseService as any).acceptSuccessfulPaymentIntention = async (
    id: string,
    expected: any,
    details: any,
  ) => {
    acceptances.push({ id, expected, details });
    payment = {
      ...payment,
      ...details,
      status: "نجح - قيد التحقق",
      transactionId: expected.transactionId,
      paymobOrderId: expected.paymobOrderId,
      completedAt: "2026-07-27T19:01:05.000Z",
    };
    return { status: "accepted", payment };
  };
  (firebaseService as any).updatePayment = async () => {
    metadataUpdates += 1;
    throw new Error("a fresh acceptance must already store exact metadata");
  };
  (service as any).approveBankTransfer = async () => {
    activations += 1;
    assert.equal(payment.paymentMethod, "APPLE_PAY");
    assert.equal(payment.transactionId, "8069835");
    assert.equal(payment.paymobOrderId, "7220450");
    return { outcome: "activated" };
  };

  try {
    assert.deepEqual(await service.approveAdminPayment(payment.id), {
      outcome: "activated",
    });
    assert.equal(activations, 1);
    assert.equal(metadataUpdates, 0);
    assert.equal(acceptances.length, 1);
    assert.deepEqual(acceptances[0].expected, {
      merchantAttemptKey: modernPayment.merchantAttemptKey,
      transactionId: "8069835",
      paymobOrderId: "7220450",
      amountCents: 4_000,
      currency: "SAR",
    });
    assert.equal(acceptances[0].details.paymentMethod, "APPLE_PAY");
    assert.notEqual(acceptances[0].details.paymentMethod, "بطاقة");

    // A provider response that only says "card" is insufficient to turn a
    // generic checkout label into a completed payment method.
    (paymobService as any).retrieveIntention = async () => ({
      ok: true,
      snapshot: {
        intentionId: modernPayment.paymentReference,
        specialReference: modernPayment.merchantAttemptKey,
        orderId: "7220450",
        amountCents: 4_000,
        currency: "SAR",
        confirmed: true,
        paid: true,
        cardExpired: false,
        signedTransaction: {
          transactionId: "8069835",
          orderId: "7220450",
          merchantOrderId: modernPayment.merchantAttemptKey,
          amountCents: 4_000,
          currency: "SAR",
          createdAt: "2026-07-27T19:01:02.000Z",
          paymentMethod: "card",
          cardSubType: "card",
        },
      },
    });
    payment = { ...modernPayment };
    await assert.rejects(
      () => service.approveAdminPayment(payment.id),
      (error) =>
        assertAdminError(error, "PAYMOB_PAYMENT_IDENTITY_MISMATCH", 409),
    );
    assert.equal(acceptances.length, 1);
    assert.equal(activations, 1);
  } finally {
    (firebaseService as any).getPaymentById = originals.getPayment;
    (firebaseService as any).acceptSuccessfulPaymentIntention = originals.accept;
    (firebaseService as any).updatePayment = originals.update;
    (paymobService as any).retrieveIntention = originals.retrieve;
  }
});

test("admin reconciliation repairs generic metadata on an already fulfilled exact Paymob payment", async () => {
  const originals = {
    getPayment: firebaseService.getPaymentById,
    accept: firebaseService.acceptSuccessfulPaymentIntention,
    update: firebaseService.updatePayment,
    retrieve: paymobService.retrieveIntention,
  };
  const service = new PaymentService();
  const payment: any = {
    ...modernPayment,
    status: "مكتمل",
    fulfillmentState: "fulfilled",
    fulfilledAt: "2026-07-27T19:01:06.000Z",
  };
  const updates: any[] = [];
  let activations = 0;

  (firebaseService as any).getPaymentById = async () => payment;
  (paymobService as any).retrieveIntention = async () => ({
    ok: true,
    snapshot: {
      intentionId: payment.paymentReference,
      specialReference: payment.merchantAttemptKey,
      orderId: "7220450",
      amountCents: 4_000,
      currency: "SAR",
      confirmed: true,
      paid: true,
      paidAt: "2026-07-27T19:01:05.000Z",
      cardExpired: false,
      signedTransaction: {
        transactionId: "8069835",
        orderId: "7220450",
        merchantOrderId: payment.merchantAttemptKey,
        amountCents: 4_000,
        currency: "SAR",
        createdAt: "2026-07-27T19:01:02.000Z",
        paymentMethod: "card",
        cardSubType: "VISA",
      },
    },
  });
  (firebaseService as any).acceptSuccessfulPaymentIntention = async () => ({
    status: "already_processed",
    payment,
  });
  (firebaseService as any).updatePayment = async (id: string, details: any) => {
    updates.push({ id, details });
    return { ...payment, ...details };
  };
  (service as any).approveBankTransfer = async () => {
    activations += 1;
    return { outcome: "activated" };
  };

  try {
    assert.deepEqual(await service.approveAdminPayment(payment.id), {
      outcome: "activated",
      alreadyProcessed: true,
    });
    assert.equal(activations, 0);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].id, payment.id);
    assert.equal(updates[0].details.paymentMethod, "VISA");
    assert.equal(updates[0].details.transactionId, "8069835");
    assert.equal(updates[0].details.paymobOrderId, "7220450");
  } finally {
    (firebaseService as any).getPaymentById = originals.getPayment;
    (firebaseService as any).acceptSuccessfulPaymentIntention = originals.accept;
    (firebaseService as any).updatePayment = originals.update;
    (paymobService as any).retrieveIntention = originals.retrieve;
  }
});

test("admin rejection never terminally rejects a modern Paymob attempt", async () => {
  const originalGetPayment = firebaseService.getPaymentById;
  const service = new PaymentService();
  let payment: any = { ...modernPayment };
  let reconciliationStatus: any = { status: "unpaid" };
  let manualRejections = 0;

  (firebaseService as any).getPaymentById = async () => payment;
  (service as any).reconcilePaymobIntention = async () => reconciliationStatus;
  (service as any).rejectBankTransfer = async () => {
    manualRejections += 1;
  };

  try {
    for (const scenario of [
      {
        result: { status: "unpaid" },
        code: "PAYMOB_REJECTION_DEFERRED",
        httpStatus: 409,
      },
      {
        result: { status: "provider_unavailable" },
        code: "PAYMOB_PROVIDER_UNAVAILABLE",
        httpStatus: 503,
      },
      {
        result: { status: "identity_mismatch" },
        code: "PAYMOB_PAYMENT_IDENTITY_MISMATCH",
        httpStatus: 409,
      },
      {
        result: { status: "paid", activation: "activated" },
        code: "PAYMOB_PAYMENT_ALREADY_PAID",
        httpStatus: 409,
      },
    ]) {
      reconciliationStatus = scenario.result;
      await assert.rejects(
        () => service.rejectAdminPayment(payment.id),
        (error) => assertAdminError(error, scenario.code, scenario.httpStatus),
      );
    }
    assert.equal(manualRejections, 0);

    payment = { ...modernPayment, paymentMethod: "تحويل بنكي" };
    reconciliationStatus = { status: "unpaid" };
    await assert.rejects(
      () => service.rejectAdminPayment(payment.id),
      (error) => assertAdminError(error, "PAYMOB_REJECTION_DEFERRED", 409),
    );
    assert.equal(manualRejections, 0);

    payment = {
      ...modernPayment,
      id: "PAY-BANK-LEGACY",
      paymentMethod: "تحويل بنكي",
      paymentReference: undefined,
      transactionId: undefined,
      merchantAttemptKey: undefined,
      paymentCheckoutUrl: undefined,
      paymobOrderId: undefined,
      intentionState: undefined,
    };
    await service.rejectAdminPayment(payment.id);
    assert.equal(manualRejections, 1);
  } finally {
    (firebaseService as any).getPaymentById = originalGetPayment;
  }
});

test("subscription admin actions fail closed for a modern add-on checkout", async () => {
  const originalGetPayment = firebaseService.getPaymentById;
  const service = new PaymentService();
  let manualApprovals = 0;
  let manualRejections = 0;
  const addOnPayment: any = {
    ...modernPayment,
    id: "PAY-ADDON-ADMIN",
    action: "addon",
  };

  (firebaseService as any).getPaymentById = async () => addOnPayment;
  (service as any).approveBankTransfer = async () => {
    manualApprovals += 1;
    return { outcome: "activated" };
  };
  (service as any).rejectBankTransfer = async () => {
    manualRejections += 1;
  };

  try {
    await assert.rejects(
      () => service.approveAdminPayment(addOnPayment.id),
      (error) =>
        assertAdminError(error, "PAYMOB_PAYMENT_NOT_RECONCILABLE", 409),
    );
    await assert.rejects(
      () => service.rejectAdminPayment(addOnPayment.id),
      (error) =>
        assertAdminError(error, "PAYMOB_PAYMENT_NOT_RECONCILABLE", 409),
    );
    assert.equal(manualApprovals, 0);
    assert.equal(manualRejections, 0);
  } finally {
    (firebaseService as any).getPaymentById = originalGetPayment;
  }
});

test("partial or ambiguous Paymob identity never falls through to manual admin mutation", async () => {
  const originalGetPayment = firebaseService.getPaymentById;
  const service = new PaymentService();
  const partialPayment: any = {
    ...modernPayment,
    id: "PAY-PARTIAL-IDENTITY",
    paymentCheckoutUrl: undefined,
    intentionState: "unknown",
  };
  let reconciliations = 0;
  let manualApprovals = 0;
  let manualRejections = 0;

  (firebaseService as any).getPaymentById = async () => partialPayment;
  (service as any).reconcilePaymobIntention = async () => {
    reconciliations += 1;
    return { status: "not_supported" };
  };
  (service as any).approveBankTransfer = async () => {
    manualApprovals += 1;
    return { outcome: "activated" };
  };
  (service as any).rejectBankTransfer = async () => {
    manualRejections += 1;
  };

  try {
    await assert.rejects(
      () => service.approveAdminPayment(partialPayment.id),
      (error) =>
        assertAdminError(error, "PAYMOB_PAYMENT_NOT_RECONCILABLE", 409),
    );
    await assert.rejects(
      () => service.rejectAdminPayment(partialPayment.id),
      (error) =>
        assertAdminError(error, "PAYMOB_PAYMENT_NOT_RECONCILABLE", 409),
    );
    assert.equal(reconciliations, 2);
    assert.equal(manualApprovals, 0);
    assert.equal(manualRejections, 0);
  } finally {
    (firebaseService as any).getPaymentById = originalGetPayment;
  }
});
