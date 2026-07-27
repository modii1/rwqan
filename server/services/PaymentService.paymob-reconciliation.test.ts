import assert from "node:assert/strict";
import test from "node:test";

import { firebaseService } from "../firebaseService";
import { paymobService } from "../integrations/paymob";
import { PaymentService } from "./PaymentService";

const basePayment = {
  id: "PAY-1",
  propertyNumber: "PROP-1",
  packageId: "PKG-1",
  amount: 40,
  discountAmount: 0,
  finalAmount: 40,
  status: "ملغي - انتهت المهلة",
  paymentMethod: "بطاقة",
  intentionState: "created",
  merchantAttemptKey: "ATTEMPT-1",
  paymentReference: "pi_live_1",
  transactionId: "pi_live_1",
  paymentCheckoutUrl:
    "https://ksa.paymob.com/unifiedcheckout/?publicKey=pk&clientSecret=secret",
};

test("Paymob reconciliation activates only an exact provider-paid intention", async () => {
  const originals = {
    getPayment: firebaseService.getPaymentById,
    accept: firebaseService.acceptSuccessfulPaymentIntention,
    retrieve: paymobService.retrieveIntention,
  };
  const service = new PaymentService();
  let payment: any = { ...basePayment };
  const accepted: any[] = [];
  let activations = 0;

  (firebaseService as any).getPaymentById = async () => payment;
  (paymobService as any).retrieveIntention = async () => ({
    ok: true,
    snapshot: {
      intentionId: "pi_live_1",
      specialReference: "ATTEMPT-1",
      orderId: "ORDER-1",
      amountCents: 4_000,
      currency: "SAR",
      confirmed: true,
      paid: true,
      paidAt: "2026-07-27T15:30:19.043665Z",
      cardExpired: false,
      signedTransaction: {
        transactionId: "TX-8063350",
        orderId: "ORDER-1",
        merchantOrderId: "ATTEMPT-1",
        amountCents: 4_000,
        currency: "SAR",
        createdAt: "2026-07-27T15:30:16.000Z",
        paymentMethod: "apple pay",
        cardSubType: "APPLE_PAY",
      },
    },
  });
  (firebaseService as any).acceptSuccessfulPaymentIntention = async (
    id: string,
    expected: any,
    details: any,
  ) => {
    accepted.push({ id, expected, details });
    return { status: "accepted", payment: { ...payment, ...details } };
  };
  (service as any).approveBankTransfer = async () => {
    activations += 1;
    return { outcome: "activated" };
  };

  try {
    assert.deepEqual(await service.reconcilePaymobIntention("PAY-1"), {
      status: "paid",
      activation: "activated",
    });
    assert.equal(activations, 1);
    assert.equal(accepted.length, 1);
    assert.deepEqual(accepted[0].expected, {
      merchantAttemptKey: "ATTEMPT-1",
      transactionId: "TX-8063350",
      paymobOrderId: "ORDER-1",
      amountCents: 4_000,
      currency: "SAR",
    });
    assert.equal(accepted[0].details.providerPaidAt, "2026-07-27T15:30:19.043665Z");

    for (const mismatch of [
      { paymentReference: "pi_live_other" },
      { merchantAttemptKey: "ATTEMPT-OTHER" },
      { finalAmount: 39 },
      { paymobOrderId: "ORDER-OTHER" },
    ]) {
      payment = { ...basePayment, ...mismatch };
      const acceptedBefore: number = accepted.length;
      assert.deepEqual(await service.reconcilePaymobIntention("PAY-1"), {
        status: "identity_mismatch",
      });
      assert.equal(accepted.length, acceptedBefore);
    }
  } finally {
    (firebaseService as any).getPaymentById = originals.getPayment;
    (firebaseService as any).acceptSuccessfulPaymentIntention = originals.accept;
    (paymobService as any).retrieveIntention = originals.retrieve;
  }
});

test("Paymob reconciliation is non-mutating for unpaid/ambiguous states and preserves paid activation failures", async () => {
  const originals = {
    getPayment: firebaseService.getPaymentById,
    accept: firebaseService.acceptSuccessfulPaymentIntention,
    retrieve: paymobService.retrieveIntention,
  };
  const service = new PaymentService();
  let accepted = 0;
  (firebaseService as any).getPaymentById = async () => ({ ...basePayment });
  (firebaseService as any).acceptSuccessfulPaymentIntention = async () => {
    accepted += 1;
    return { status: "accepted", payment: { ...basePayment } };
  };
  (service as any).approveBankTransfer = async () => {
    throw new Error("property needs verification");
  };

  try {
    (paymobService as any).retrieveIntention = async () => ({
      ok: false,
      reason: "provider_unavailable",
    });
    assert.deepEqual(await service.reconcilePaymobIntention("PAY-1"), {
      status: "provider_unavailable",
    });
    assert.equal(accepted, 0);

    (paymobService as any).retrieveIntention = async () => ({
      ok: true,
      snapshot: {
        intentionId: "pi_live_1",
        specialReference: "ATTEMPT-1",
        orderId: "ORDER-1",
        amountCents: 4_000,
        currency: "SAR",
        confirmed: true,
        paid: false,
        cardExpired: false,
      },
    });
    assert.deepEqual(await service.reconcilePaymobIntention("PAY-1"), {
      status: "unpaid",
    });
    assert.equal(accepted, 0);

    (paymobService as any).retrieveIntention = async () => ({
      ok: true,
      snapshot: {
        intentionId: "pi_live_1",
        specialReference: "ATTEMPT-1",
        orderId: "ORDER-1",
        amountCents: 4_000,
        currency: "SAR",
        confirmed: true,
        paid: true,
        cardExpired: false,
      },
    });
    assert.deepEqual(await service.reconcilePaymobIntention("PAY-1"), {
      status: "identity_mismatch",
    });
    assert.equal(accepted, 0);

    (paymobService as any).retrieveIntention = async () => ({
      ok: true,
      snapshot: {
        intentionId: "pi_live_1",
        specialReference: "ATTEMPT-1",
        orderId: "ORDER-1",
        amountCents: 4_000,
        currency: "SAR",
        confirmed: false,
        paid: true,
        cardExpired: false,
        signedTransaction: {
          transactionId: "TX-8063350",
          orderId: "ORDER-1",
          merchantOrderId: "ATTEMPT-1",
          amountCents: 4_000,
          currency: "SAR",
          createdAt: "2026-07-27T15:30:16.000Z",
          paymentMethod: "apple pay",
          cardSubType: "APPLE_PAY",
        },
      },
    });
    assert.deepEqual(await service.reconcilePaymobIntention("PAY-1"), {
      status: "identity_mismatch",
    });
    assert.equal(accepted, 0);

    (paymobService as any).retrieveIntention = async () => ({
      ok: true,
      snapshot: {
        intentionId: "pi_live_1",
        specialReference: "ATTEMPT-1",
        orderId: "ORDER-1",
        amountCents: 4_000,
        currency: "SAR",
        confirmed: true,
        paid: true,
        cardExpired: false,
        signedTransaction: {
          transactionId: "TX-8063350",
          orderId: "ORDER-1",
          merchantOrderId: "ATTEMPT-1",
          amountCents: 4_000,
          currency: "SAR",
          createdAt: "2026-07-27T15:30:16.000Z",
          paymentMethod: "apple pay",
          cardSubType: "APPLE_PAY",
        },
      },
    });
    assert.deepEqual(await service.reconcilePaymobIntention("PAY-1"), {
      status: "paid",
      activation: "pending",
    });
    assert.equal(accepted, 1);
  } finally {
    (firebaseService as any).getPaymentById = originals.getPayment;
    (firebaseService as any).acceptSuccessfulPaymentIntention = originals.accept;
    (paymobService as any).retrieveIntention = originals.retrieve;
  }
});

test("an exact paid replay resumes processing fulfillment but never re-runs fulfilled work", async () => {
  const originals = {
    getPayment: firebaseService.getPaymentById,
    accept: firebaseService.acceptSuccessfulPaymentIntention,
    retrieve: paymobService.retrieveIntention,
  };
  const service = new PaymentService();
  const processingPayment: any = {
    ...basePayment,
    status: "نجح - قيد التحقق",
    paymentMethod: "APPLE_PAY",
    transactionId: "TX-RECOVER",
    paymobOrderId: "ORDER-RECOVER",
    completedAt: "2026-07-27T15:30:19.043665Z",
    fulfillmentState: "processing",
    fulfillmentClaimToken: "STALE-CLAIM",
    fulfillmentClaimedAt: "2026-07-27T15:00:00.000Z",
  };
  let acceptanceStatus: "already_accepted" | "already_processed" =
    "already_accepted";
  let activations = 0;

  (firebaseService as any).getPaymentById = async () => processingPayment;
  (paymobService as any).retrieveIntention = async () => ({
    ok: true,
    snapshot: {
      intentionId: "pi_live_1",
      specialReference: "ATTEMPT-1",
      orderId: "ORDER-RECOVER",
      amountCents: 4_000,
      currency: "SAR",
      confirmed: true,
      paid: true,
      paidAt: "2026-07-27T15:30:19.043665Z",
      cardExpired: false,
      signedTransaction: {
        transactionId: "TX-RECOVER",
        orderId: "ORDER-RECOVER",
        merchantOrderId: "ATTEMPT-1",
        amountCents: 4_000,
        currency: "SAR",
        createdAt: "2026-07-27T15:30:16.000Z",
        paymentMethod: "card",
        cardSubType: "APPLE_PAY",
      },
    },
  });
  (firebaseService as any).acceptSuccessfulPaymentIntention = async () => ({
    status: acceptanceStatus,
    payment: processingPayment,
  });
  (service as any).approveBankTransfer = async () => {
    activations += 1;
    return { outcome: "activated" };
  };

  try {
    assert.deepEqual(await service.reconcilePaymobIntention(processingPayment.id), {
      status: "paid",
      activation: "activated",
    });
    assert.equal(activations, 1);

    acceptanceStatus = "already_processed";
    assert.deepEqual(await service.reconcilePaymobIntention(processingPayment.id), {
      status: "already_processed",
    });
    assert.equal(activations, 1);
  } finally {
    (firebaseService as any).getPaymentById = originals.getPayment;
    (firebaseService as any).acceptSuccessfulPaymentIntention = originals.accept;
    (paymobService as any).retrieveIntention = originals.retrieve;
  }
});

test("add-on reconciliation settles exact missed payments for review without subscription fulfillment", async () => {
  const originals = {
    getPayment: firebaseService.getPaymentById,
    acceptSubscription: firebaseService.acceptSuccessfulPaymentIntention,
    settleAddon: firebaseService.settleAddOnPaymentCallback,
    retrieve: paymobService.retrieveIntention,
  };
  const service = new PaymentService();
  let payment: any = {
    ...basePayment,
    id: "PAY-ADDON-1",
    propertyNumber: "PROP-ADDON",
    packageId: "ADDON-PKG",
    packageName: "إضافة",
    action: "addon",
    status: "قيد الدفع",
    paymentMethod: "paymob",
    merchantAttemptKey: "RWQN-ADDON-ATTEMPT-1",
    paymentReference: "pi_addon_1",
    transactionId: "pi_addon_1",
    paymobOrderId: "ORDER-ADDON-1",
  };
  let paid = true;
  let providerPaymentMethod = "apple pay";
  let providerCardSubType = "APPLE_PAY";
  let genericAccepts = 0;
  let subscriptionActivations = 0;
  const settlements: any[] = [];

  (firebaseService as any).getPaymentById = async () => payment;
  (firebaseService as any).acceptSuccessfulPaymentIntention = async () => {
    genericAccepts += 1;
    throw new Error("add-on must not use subscription acceptance");
  };
  (service as any).approveBankTransfer = async () => {
    subscriptionActivations += 1;
    throw new Error("add-on must not activate a subscription");
  };
  (paymobService as any).retrieveIntention = async () => ({
    ok: true,
    snapshot: {
      intentionId: "pi_addon_1",
      specialReference: "RWQN-ADDON-ATTEMPT-1",
      orderId: "ORDER-ADDON-1",
      amountCents: 4_000,
      currency: "SAR",
      confirmed: true,
      paid,
      paidAt: "2026-07-27T15:30:19.043665Z",
      cardExpired: false,
      ...(paid
        ? {
            signedTransaction: {
              transactionId: "TX-ADDON-1",
              orderId: "ORDER-ADDON-1",
              merchantOrderId: "RWQN-ADDON-ATTEMPT-1",
              amountCents: 4_000,
              currency: "SAR",
              createdAt: "2026-07-27T15:30:16.000Z",
              paymentMethod: providerPaymentMethod,
              cardSubType: providerCardSubType,
            },
          }
        : {}),
    },
  });
  (firebaseService as any).settleAddOnPaymentCallback = async (
    id: string,
    expected: any,
    details: any,
    options: any,
  ) => {
    settlements.push({ id, expected, details, options });
    return {
      status: "accepted_success",
      payment: { ...payment, ...details, completedAt: new Date().toISOString() },
    };
  };

  try {
    assert.deepEqual(await service.reconcilePaymobIntention(payment.id), {
      status: "not_supported",
    });
    assert.equal(genericAccepts, 0);
    assert.equal(subscriptionActivations, 0);

    assert.deepEqual(await service.reconcilePaymobAddonIntention(payment.id), {
      status: "paid",
      review: "pending",
    });
    assert.equal(settlements.length, 1);
    assert.deepEqual(settlements[0].expected, {
      merchantAttemptKey: "RWQN-ADDON-ATTEMPT-1",
      transactionId: "TX-ADDON-1",
      paymobOrderId: "ORDER-ADDON-1",
      amountCents: 4_000,
      currency: "SAR",
      success: true,
    });
    assert.deepEqual(settlements[0].options, {
      recordReconciliationHistory: true,
      expectedIntentionId: "pi_addon_1",
    });
    assert.equal(settlements[0].details.totalFees, 2.76);
    assert.equal(settlements[0].details.netAmount, 37.24);
    assert.equal(settlements[0].details.paymentMethod, "APPLE_PAY");
    assert.equal(
      settlements[0].details.providerPaidAt,
      "2026-07-27T15:30:19.043665Z",
    );
    assert.equal(genericAccepts, 0);
    assert.equal(subscriptionActivations, 0);

    providerPaymentMethod = "card";
    providerCardSubType = "cards";
    assert.deepEqual(await service.reconcilePaymobAddonIntention(payment.id), {
      status: "identity_mismatch",
    });
    assert.equal(settlements.length, 1);
    providerPaymentMethod = "apple pay";
    providerCardSubType = "APPLE_PAY";

    paid = false;
    assert.deepEqual(await service.reconcilePaymobAddonIntention(payment.id), {
      status: "unpaid",
    });
    assert.equal(settlements.length, 1);

    paid = true;
    payment = { ...payment, paymobOrderId: undefined };
    assert.deepEqual(await service.reconcilePaymobAddonIntention(payment.id), {
      status: "not_supported",
    });
    assert.equal(settlements.length, 1);

    payment = { ...payment, paymobOrderId: "ORDER-ADDON-1" };
    (firebaseService as any).settleAddOnPaymentCallback = async () => ({
      status: "already_processed",
      payment: { ...payment, completedAt: "2026-07-27T15:30:19.043665Z" },
    });
    assert.deepEqual(await service.reconcilePaymobAddonIntention(payment.id), {
      status: "already_processed",
    });
    assert.equal(genericAccepts, 0);
    assert.equal(subscriptionActivations, 0);
  } finally {
    (firebaseService as any).getPaymentById = originals.getPayment;
    (firebaseService as any).acceptSuccessfulPaymentIntention =
      originals.acceptSubscription;
    (firebaseService as any).settleAddOnPaymentCallback = originals.settleAddon;
    (paymobService as any).retrieveIntention = originals.retrieve;
  }
});
