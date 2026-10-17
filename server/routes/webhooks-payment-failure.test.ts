import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";

import webhooksRouter from "./webhooks";
import { addOnService, paymentService, propertyService } from "../services";
import { firebaseService } from "../firebaseService";
import {
  calculatePaymobWebhookHmac,
  paymobService,
} from "../integrations/paymob";

const TEST_HMAC_SECRET = "test-paymob-webhook-secret";

type CallbackOptions = {
  specialReference: string;
  paymentId?: string;
  merchantAttemptKey?: string;
  success?: boolean;
  pending?: boolean;
  amountCents?: number;
  currency?: string;
  transactionId?: string;
  paymobOrderId?: string;
  includeCreationExtras?: boolean;
  errorOccurred?: boolean;
  refunded?: boolean;
  voided?: boolean;
  standalonePayment?: boolean;
  capture?: boolean;
  auth?: boolean;
  sourceType?: string;
  cardSubType?: string;
};

function transactionWebhook(options: CallbackOptions) {
  const {
    specialReference,
    paymentId,
    merchantAttemptKey,
    success = false,
    pending = false,
    amountCents = 10_000,
    currency = "SAR",
    transactionId = "TX-FAILED",
    paymobOrderId = "ORDER-1",
    includeCreationExtras = true,
    errorOccurred = !success && !pending,
    refunded = false,
    voided = false,
    standalonePayment = true,
    capture = false,
    auth = false,
    sourceType = "card",
    cardSubType = "visa",
  } = options;
  return {
    obj: {
      amount_cents: amountCents,
      created_at: "2026-07-27T10:00:00.000Z",
      currency,
      error_occured: errorOccurred,
      has_parent_transaction: false,
      id: transactionId,
      integration_id: 15650,
      is_3d_secure: true,
      is_auth: auth,
      is_capture: capture,
      is_refunded: refunded,
      is_standalone_payment: standalonePayment,
      is_voided: voided,
      merchant_order_id: specialReference,
      order: {
        id: paymobOrderId,
        merchant_order_id: specialReference,
        special_reference: specialReference,
        ...(includeCreationExtras
          ? {
              extras: {
                creation_extras: {
                  type: "subscription",
                  ...(paymentId ? { paymentId } : {}),
                  ...(merchantAttemptKey ? { merchantAttemptKey } : {}),
                },
              },
            }
          : {}),
      },
      owner: 42,
      pending,
      source_data: { pan: "2346", type: sourceType, sub_type: cardSubType },
      success,
    },
  };
}

async function signedPost(baseUrl: string, webhook: ReturnType<typeof transactionWebhook>) {
  const signature = calculatePaymobWebhookHmac(webhook, TEST_HMAC_SECRET);
  assert.ok(signature);
  return fetch(
    baseUrl + "/api/paymob/webhook?hmac=" + encodeURIComponent(signature),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(webhook),
    },
  );
}

async function signedPostWithBodyHmac(
  baseUrl: string,
  webhook: ReturnType<typeof transactionWebhook>,
  location: "envelope" | "object",
) {
  const signature = calculatePaymobWebhookHmac(webhook, TEST_HMAC_SECRET);
  assert.ok(signature);
  const signedWebhook = location === "envelope"
    ? { ...webhook, hmac: signature }
    : { ...webhook, obj: { ...webhook.obj, hmac: signature } };
  return fetch(baseUrl + "/api/paymob/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signedWebhook),
  });
}

test("Paymob callback route rejects forgery and mutates only an exact signed final attempt", async () => {
  const originals = {
    getAll: paymentService.getAll,
    update: paymentService.update,
    approve: paymentService.approveBankTransfer,
    accept: firebaseService.acceptSuccessfulPaymentIntention,
    recordActivationPending: firebaseService.recordPaidPaymentActivationPending,
    settleAddon: firebaseService.settleAddOnPaymentCallback,
    finalize: firebaseService.finalizeFailedPaymentIntention,
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    updateVerificationStatus: firebaseService.updateVerificationStatus,
    getPropertyByNumber: propertyService.getByNumber,
    logAddonHistory: addOnService.logHistory,
    inquiry: paymobService.inquiryByOrderId,
    retrieveIntention: paymobService.retrieveIntention,
    hmacSecret: process.env.PAYMOB_HMAC_SECRET,
  };
  const payments: any[] = [
    {
      id: "PAY-1",
      propertyNumber: "PROP-1",
      finalAmount: 100,
      status: "قيد المراجعة",
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-1",
      paymentReference: "INT-1",
      paymentCheckoutUrl:
        "https://ksa.paymob.com/unifiedcheckout/?publicKey=pk&clientSecret=PAY-1",
    },
    {
      id: "PAY-2",
      propertyNumber: "PROP-1",
      finalAmount: 100,
      status: "قيد المراجعة",
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-2",
      paymentReference: "INT-2",
      paymentCheckoutUrl:
        "https://ksa.paymob.com/unifiedcheckout/?publicKey=pk&clientSecret=PAY-2",
    },
    {
      id: "PAY-3",
      propertyNumber: "PROP-3",
      finalAmount: 100,
      status: "قيد المراجعة",
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-3",
      paymentReference: "INT-3",
      paymentCheckoutUrl:
        "https://ksa.paymob.com/unifiedcheckout/?publicKey=pk&clientSecret=PAY-3",
      paymobOrderId: "ORDER-3",
    },
    {
      id: "PAY-LEGACY",
      propertyNumber: "PROP-LEGACY",
      finalAmount: 100,
      status: "قيد المراجعة",
      paymobOrderId: "ORDER-LEGACY",
    },
    {
      id: "PAY-ADDON-1",
      propertyNumber: "PROP-ADDON",
      packageId: "ADDON-1",
      packageName: "Addon",
      finalAmount: 100,
      status: "قيد الدفع",
      action: "addon",
      merchantAttemptKey: "ATTEMPT-ADDON-1",
      paymentReference: "INT-ADDON-1",
      paymentCheckoutUrl:
        "https://ksa.paymob.com/unifiedcheckout/?publicKey=pk&clientSecret=ADDON-1",
      paymobOrderId: "ORDER-ADDON",
    },
    {
      id: "PAY-ADDON-2",
      propertyNumber: "PROP-ADDON-2",
      packageId: "ADDON-2",
      packageName: "Addon 2",
      finalAmount: 100,
      status: "قيد الدفع",
      action: "addon",
      merchantAttemptKey: "ATTEMPT-ADDON-2",
      paymentReference: "INT-ADDON-2",
      paymentCheckoutUrl:
        "https://ksa.paymob.com/unifiedcheckout/?publicKey=pk&clientSecret=ADDON-2",
      paymobOrderId: "ORDER-ADDON-2",
    },
  ];
  const finalized: Array<{
    id: string;
    expected: {
      merchantAttemptKey: string;
      transactionId: string;
      paymobOrderId: string;
      amountCents: number;
      currency: string;
    };
  }> = [];
  const updates: Array<{ id: string; updates: any }> = [];
  const addonSettlements: Array<{ id: string; expected: any; details: any }> = [];
  let addonHistoryWrites = 0;
  let addonSettlementMode: "already" | "rejected" = "already";
  let paymentReads = 0;
  let changeAttemptBeforeAcceptance = false;
  let rejectNextFailureFinalization = false;
  let successAcceptanceCalls = 0;
  const acceptedPaymentMethods: string[] = [];
  let returnAlreadyAccepted = false;
  let resumeOutcome: "queued" | "activated" = "activated";
  let resumeError: Error | null = null;
  const resumedPayments: string[] = [];
  let propertySuspended = false;
  let propertyReads = 0;
  let verificationWrites = 0;
  let providerOrderOverride = "";

  process.env.PAYMOB_HMAC_SECRET = TEST_HMAC_SECRET;
  (paymentService as any).getAll = async () => {
    paymentReads += 1;
    return payments;
  };
  (paymentService as any).update = async (id: string, updatesValue: any) => {
    updates.push({ id, updates: updatesValue });
  };
  (firebaseService as any).recordPaidPaymentActivationPending = async (
    id: string,
    transactionId: string,
    notes: string,
  ) => {
    updates.push({
      id,
      updates: {
        status: "نجح - قيد التحقق",
        transactionId,
        notes,
      },
    });
    return true;
  };
  (paymentService as any).approveBankTransfer = async (id: string) => {
    if (propertySuspended) {
      throw Object.assign(
        new Error("الاشتراك موقوف مؤقتاً من الإدارة"),
        { code: "PROPERTY_SUSPENDED" },
      );
    }
    resumedPayments.push(id);
    if (resumeError) throw resumeError;
    return {
      outcome: resumeOutcome,
      alreadyProcessed: returnAlreadyAccepted,
    };
  };
  (propertyService as any).getByNumber = async (propertyNumber: string) => {
    propertyReads += 1;
    return {
      propertyNumber,
      name: "Suspended property",
      whatsappNumber: "966500000000",
    };
  };
  (firebaseService as any).getSubscriptionByPropertyNumber = async (
    propertyNumber: string,
  ) => propertySuspended
    ? {
        id: `SUB-${propertyNumber}`,
        propertyNumber,
        status: "موقوف مؤقتاً",
        startDate: "2026-07-01T00:00:00.000Z",
        endDate: "2026-08-01T00:00:00.000Z",
        suspendedAt: "2026-07-20T00:00:00.000Z",
        remainingDurationMs: 12 * 24 * 60 * 60 * 1000,
      }
    : null;
  (firebaseService as any).updateVerificationStatus = async () => {
    verificationWrites += 1;
  };
  (firebaseService as any).acceptSuccessfulPaymentIntention = async (
    id: string,
    expected: {
      merchantAttemptKey: string;
      transactionId: string;
      paymobOrderId: string;
    },
    details: any,
  ) => {
    successAcceptanceCalls += 1;
    acceptedPaymentMethods.push(details.paymentMethod);
    const current = payments.find((payment) => payment.id === id);
    if (!current) return { status: "rejected", reason: "not_found" };
    if (returnAlreadyAccepted) {
      return { status: "already_accepted", payment: current };
    }
    if (changeAttemptBeforeAcceptance) {
      current.merchantAttemptKey = "ATTEMPT-CHANGED";
      changeAttemptBeforeAcceptance = false;
    }
    if (
      current.merchantAttemptKey &&
      current.merchantAttemptKey !== expected.merchantAttemptKey &&
      current.paymobOrderId !== expected.paymobOrderId
    ) {
      return { status: "rejected", reason: "stale_attempt" };
    }
    if (current.status === "مكتمل") {
      return { status: "already_processed", payment: current };
    }
    return {
      status: "accepted",
      payment: {
        ...current,
        ...details,
        status: "نجح - قيد التحقق",
        transactionId: expected.transactionId,
      },
    };
  };
  (firebaseService as any).settleAddOnPaymentCallback = async (
    id: string,
    expected: any,
    details: any,
  ) => {
    addonSettlements.push({ id, expected, details });
    if (addonSettlementMode === "rejected") {
      return { status: "rejected", reason: "identity_conflict" };
    }
    return {
      status: "already_processed",
      payment: payments.find((payment) => payment.id === id),
    };
  };
  (firebaseService as any).finalizeFailedPaymentIntention = async (
    id: string,
    expected: {
      merchantAttemptKey: string;
      transactionId: string;
      paymobOrderId: string;
      amountCents: number;
      currency: string;
    },
  ) => {
    if (rejectNextFailureFinalization) {
      rejectNextFailureFinalization = false;
      return false;
    }
    const current = payments.find((payment) => payment.id === id);
    if (!current) return false;
    const orderMatches = payments.filter(
      (payment) => payment.paymobOrderId === expected.paymobOrderId,
    );
    if (current.merchantAttemptKey) {
      if (current.paymobOrderId) {
        if (
          current.paymobOrderId !== expected.paymobOrderId ||
          orderMatches.length !== 1 ||
          orderMatches[0].id !== id
        ) return false;
      } else if (
        payments.some(
          (payment) =>
            payment.id !== id &&
            payment.paymobOrderId === expected.paymobOrderId,
        )
      ) {
        return false;
      }
      if (expected.merchantAttemptKey) {
        const attemptMatches = payments.filter(
          (payment) =>
            payment.merchantAttemptKey === expected.merchantAttemptKey,
        );
        if (
          current.merchantAttemptKey !== expected.merchantAttemptKey ||
          attemptMatches.length !== 1 ||
          attemptMatches[0].id !== id
        ) return false;
      } else if (!current.paymobOrderId) {
        return false;
      }
    } else if (
      expected.merchantAttemptKey ||
      orderMatches.length !== 1 ||
      orderMatches[0].id !== id
    ) {
      return false;
    }
    finalized.push({ id, expected });
    return true;
  };
  (paymobService as any).inquiryByOrderId = async () => ({ ok: false });
  (paymobService as any).retrieveIntention = async (checkoutUrl: string) => {
    const localId = new URL(checkoutUrl).searchParams.get("clientSecret");
    const suffix = localId === "PAY-2" ? "2" : "1";
    return {
      ok: true,
      snapshot: {
        intentionId: `INT-${suffix}`,
        specialReference: `ATTEMPT-${suffix}`,
        orderId: providerOrderOverride || "ORDER-1",
        amountCents: 10_000,
        currency: "SAR",
        confirmed: true,
        paid: true,
        cardExpired: false,
      },
    };
  };
  (addOnService as any).logHistory = async () => {
    addonHistoryWrites += 1;
  };

  const app = express();
  app.use(express.json());
  app.use(webhooksRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = "http://127.0.0.1:" + port;

  try {
    const forgedGet = await fetch(
      baseUrl + "/api/paymob/webhook?success=true&special_reference=ATTEMPT-1",
      { redirect: "manual" },
    );
    assert.equal(forgedGet.status, 302);
    assert.equal(
      forgedGet.headers.get("location"),
      "/subscription?payment=processing",
    );
    assert.equal(paymentReads, 0);
    assert.deepEqual(updates, []);
    assert.deepEqual(finalized, []);

    // Paymob's browser redirect returns the intention reference as
    // merchant_order_id. New add-on attempts must stay in the owner dashboard
    // on both success and failure while the signed POST settles the payment.
    for (const [success, expectedState] of [
      [true, "processing"],
      [false, "failed"],
    ] as const) {
      const addonGet = await fetch(
        baseUrl +
          "/api/paymob/webhook?success=" +
          success +
          "&merchant_order_id=RWQN-ADDON-12345678-1234-1234-1234-123456789ABC",
        { redirect: "manual" },
      );
      assert.equal(addonGet.status, 302);
      assert.equal(
        addonGet.headers.get("location"),
        `/owner/dashboard?addon_payment=${expectedState}`,
      );
    }

    // Keep compatibility with callback variants that expose the same new
    // merchant attempt through special_reference instead.
    const addonSpecialReferenceGet = await fetch(
      baseUrl +
        "/api/paymob/webhook?success=false&special_reference=RWQN-ADDON-ABCDEF",
      { redirect: "manual" },
    );
    assert.equal(addonSpecialReferenceGet.status, 302);
    assert.equal(
      addonSpecialReferenceGet.headers.get("location"),
      "/owner/dashboard?addon_payment=failed",
    );
    assert.equal(paymentReads, 0);
    assert.deepEqual(updates, []);
    assert.deepEqual(finalized, []);

    const unsignedWebhook = transactionWebhook({
      specialReference: "ATTEMPT-1",
      paymentId: "PAY-1",
      merchantAttemptKey: "ATTEMPT-1",
    });
    const unsigned = await fetch(baseUrl + "/api/paymob/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(unsignedWebhook),
    });
    assert.equal(unsigned.status, 401);
    assert.equal(paymentReads, 0);
    assert.deepEqual(updates, []);
    assert.deepEqual(finalized, []);

    const invalidSignature = await fetch(
      baseUrl + "/api/paymob/webhook?hmac=" + "0".repeat(128),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(unsignedWebhook),
      },
    );
    assert.equal(invalidSignature.status, 401);
    assert.equal(paymentReads, 0);
    assert.deepEqual(updates, []);
    assert.deepEqual(finalized, []);

    const pending = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-2",
      paymentId: "PAY-2",
      merchantAttemptKey: "ATTEMPT-2",
      pending: true,
      transactionId: "TX-PENDING",
    }));
    assert.equal(pending.status, 200);
    assert.equal((await pending.json()).status, "pending");
    assert.equal(paymentReads, 0);
    assert.deepEqual(finalized, []);

    for (const location of ["envelope", "object"] as const) {
      const bodySignedPending = await signedPostWithBodyHmac(
        baseUrl,
        transactionWebhook({
          specialReference: "ATTEMPT-2",
          paymentId: "PAY-2",
          merchantAttemptKey: "ATTEMPT-2",
          pending: true,
          transactionId: `TX-PENDING-${location}`,
        }),
        location,
      );
      assert.equal(bodySignedPending.status, 200);
      assert.equal((await bodySignedPending.json()).status, "pending");
      assert.equal(paymentReads, 0);
      assert.deepEqual(finalized, []);
    }

    const terminalAddonSuccess = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-ADDON-1",
      paymentId: "PAY-ADDON-1",
      merchantAttemptKey: "ATTEMPT-ADDON-1",
      success: true,
      transactionId: "TX-ADDON-SUCCESS",
      paymobOrderId: "ORDER-ADDON",
    }));
    assert.equal(terminalAddonSuccess.status, 200);
    assert.equal((await terminalAddonSuccess.json()).status, "already_processed");
    assert.equal(addonSettlements.length, 1);
    assert.equal(addonSettlements[0].details.paymentMethod, "visa");

    const genericMethodAddon = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-ADDON-1",
      paymentId: "PAY-ADDON-1",
      merchantAttemptKey: "ATTEMPT-ADDON-1",
      success: true,
      transactionId: "TX-ADDON-GENERIC-METHOD",
      paymobOrderId: "ORDER-ADDON",
      sourceType: "card",
      cardSubType: "card",
    }));
    assert.equal(genericMethodAddon.status, 422);
    assert.equal(
      (await genericMethodAddon.json()).reason,
      "generic_payment_method",
    );
    assert.equal(addonSettlements.length, 1);

    const lateAddonFailure = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-ADDON-1",
      paymentId: "PAY-ADDON-1",
      merchantAttemptKey: "ATTEMPT-ADDON-1",
      transactionId: "TX-ADDON-LATE-FAILURE",
      paymobOrderId: "ORDER-ADDON",
    }));
    assert.equal(lateAddonFailure.status, 200);
    assert.equal((await lateAddonFailure.json()).status, "ignored_late_failure");
    assert.equal(addonHistoryWrites, 0);
    assert.equal(addonSettlements.length, 2);
    assert.equal(
      addonSettlements[0].expected.merchantAttemptKey,
      "ATTEMPT-ADDON-1",
    );

    // special_reference and creation_extras are not part of Paymob's HMAC.
    // Rewriting them to another same-price add-on must not redirect the
    // signed order or create any settlement side effect.
    const replayedAddon = await signedPost(baseUrl, transactionWebhook({
      specialReference: "PAY-ADDON-2",
      paymentId: "PAY-ADDON-2",
      success: true,
      transactionId: "TX-ADDON-REPLAY",
      paymobOrderId: "ORDER-ADDON",
    }));
    assert.equal(replayedAddon.status, 409);
    assert.equal(addonSettlements.length, 2);

    addonSettlementMode = "rejected";
    const rejectedAddon = await signedPost(baseUrl, transactionWebhook({
      specialReference: "PAY-ADDON-1",
      paymentId: "PAY-ADDON-1",
      success: true,
      transactionId: "TX-ADDON-REJECTED",
      paymobOrderId: "ORDER-CONFLICT",
    }));
    assert.equal(rejectedAddon.status, 409);
    assert.equal(addonHistoryWrites, 0);
    addonSettlementMode = "already";

    const ambiguous = await signedPost(baseUrl, transactionWebhook({
      specialReference: "PROP-1-LEGACY-UNKNOWN",
    }));
    assert.equal(ambiguous.status, 404);
    assert.deepEqual(finalized, []);

    // Current Paymob callbacks can omit creation_extras entirely. A future
    // intention remains safely identifiable by its unique persisted numeric
    // order, which is included in the verified callback HMAC.
    const futureDeclineWithoutExtras = await signedPost(
      baseUrl,
      transactionWebhook({
        specialReference: "",
        includeCreationExtras: false,
        transactionId: "TX-FUTURE-DECLINED",
        paymobOrderId: "ORDER-3",
      }),
    );
    assert.equal(futureDeclineWithoutExtras.status, 200);
    assert.equal(
      (await futureDeclineWithoutExtras.json()).status,
      "recorded_failure",
    );
    assert.deepEqual(finalized, [{
      id: "PAY-3",
      expected: {
        merchantAttemptKey: "",
        transactionId: "TX-FUTURE-DECLINED",
        paymobOrderId: "ORDER-3",
        amountCents: 10_000,
        currency: "SAR",
      },
    }]);

    const conflictingSignedOrder = await signedPost(
      baseUrl,
      transactionWebhook({
        specialReference: "ATTEMPT-1",
        paymentId: "PAY-1",
        merchantAttemptKey: "ATTEMPT-1",
        transactionId: "TX-CONFLICTING-SIGNED-ORDER",
        paymobOrderId: "ORDER-3",
      }),
    );
    assert.equal(conflictingSignedOrder.status, 409);
    assert.equal(finalized.length, 1);

    const staleAttemptForSignedOrder = await signedPost(
      baseUrl,
      transactionWebhook({
        specialReference: "ATTEMPT-OLD",
        transactionId: "TX-STALE-SIGNED-ORDER",
        paymobOrderId: "ORDER-3",
      }),
    );
    assert.equal(staleAttemptForSignedOrder.status, 409);
    assert.equal(finalized.length, 1);

    const unknownPaymentWithSignedOrder = await signedPost(
      baseUrl,
      transactionWebhook({
        specialReference: "",
        paymentId: "PAY-UNKNOWN",
        transactionId: "TX-UNKNOWN-WITH-SIGNED-ORDER",
        paymobOrderId: "ORDER-3",
      }),
    );
    assert.equal(unknownPaymentWithSignedOrder.status, 404);
    assert.equal(finalized.length, 1);

    payments[1].paymobOrderId = "ORDER-3";
    const duplicateSignedOrder = await signedPost(
      baseUrl,
      transactionWebhook({
        specialReference: "",
        includeCreationExtras: false,
        transactionId: "TX-DUPLICATE-SIGNED-ORDER",
        paymobOrderId: "ORDER-3",
      }),
    );
    assert.equal(duplicateSignedOrder.status, 409);
    assert.equal(finalized.length, 1);
    delete payments[1].paymobOrderId;

    const legacyOrderFailure = await signedPost(
      baseUrl,
      transactionWebhook({
        specialReference: "",
        includeCreationExtras: false,
        transactionId: "TX-LEGACY-FAILED",
        paymobOrderId: "ORDER-LEGACY",
      }),
    );
    assert.equal(legacyOrderFailure.status, 200);
    assert.equal(
      (await legacyOrderFailure.json()).status,
      "recorded_failure",
    );
    assert.equal(finalized.length, 2);
    assert.deepEqual(finalized[1], {
      id: "PAY-LEGACY",
      expected: {
        merchantAttemptKey: "",
        transactionId: "TX-LEGACY-FAILED",
        paymobOrderId: "ORDER-LEGACY",
        amountCents: 10_000,
        currency: "SAR",
      },
    });

    const missingPaymentIdFailure = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-2",
      transactionId: "TX-ATTEMPT-2-FAILED",
    }));
    assert.equal(missingPaymentIdFailure.status, 200);
    assert.equal(
      (await missingPaymentIdFailure.json()).status,
      "recorded_failure",
    );
    assert.equal(finalized.length, 3);
    assert.equal(
      (finalized as unknown as Array<{ id: string }>).at(-1)?.id,
      "PAY-2",
    );

    const stalePaymentId = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-OLD",
      paymentId: "PAY-1",
      merchantAttemptKey: "ATTEMPT-OLD",
      transactionId: "TX-OLD-FAILED",
    }));
    assert.equal(stalePaymentId.status, 409);
    assert.equal(finalized.length, 3);

    const conflictingIdentifiers = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-2",
      paymentId: "PAY-1",
      merchantAttemptKey: "ATTEMPT-2",
      transactionId: "TX-CONFLICT-FAILED",
    }));
    assert.equal(conflictingIdentifiers.status, 409);
    assert.equal(finalized.length, 3);

    const exactPaymentId = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-1",
      paymentId: "PAY-1",
      merchantAttemptKey: "ATTEMPT-1",
      transactionId: "TX-ATTEMPT-1-FAILED",
    }));
    assert.equal(exactPaymentId.status, 200);
    assert.equal(finalized.length, 4);
    assert.deepEqual(finalized[3], {
      id: "PAY-1",
      expected: {
        merchantAttemptKey: "ATTEMPT-1",
        transactionId: "TX-ATTEMPT-1-FAILED",
        paymobOrderId: "ORDER-1",
        amountCents: 10_000,
        currency: "SAR",
      },
    });

    const wrongAmount = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-1",
      paymentId: "PAY-1",
      merchantAttemptKey: "ATTEMPT-1",
      amountCents: 9_999,
      transactionId: "TX-WRONG-AMOUNT",
    }));
    assert.equal(wrongAmount.status, 409);
    assert.equal(finalized.length, 4);

    const wrongCurrency = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-1",
      paymentId: "PAY-1",
      merchantAttemptKey: "ATTEMPT-1",
      currency: "USD",
      transactionId: "TX-WRONG-CURRENCY",
    }));
    assert.equal(wrongCurrency.status, 409);
    assert.equal(finalized.length, 4);

    // The route lookup is advisory. If the authoritative transaction observes
    // a retry/duplicate identity race, the callback must surface a conflict and
    // must not be reported as recorded.
    rejectNextFailureFinalization = true;
    const transactionalIdentityConflict = await signedPost(
      baseUrl,
      transactionWebhook({
        specialReference: "",
        includeCreationExtras: false,
        transactionId: "TX-TRANSACTIONAL-CONFLICT",
        paymobOrderId: "ORDER-3",
      }),
    );
    assert.equal(transactionalIdentityConflict.status, 409);
    assert.equal(finalized.length, 4);

    const nonPayableBaseline = {
      accepted: successAcceptanceCalls,
      finalized: finalized.length,
      propertyReads,
      updates: updates.length,
    };
    const nonPayableSuccessCases: Array<{
      transactionId: string;
      flags: Partial<CallbackOptions>;
    }> = [
      {
        transactionId: "TX-SUCCESS-BUT-REFUNDED",
        flags: { refunded: true },
      },
      {
        transactionId: "TX-SUCCESS-BUT-VOIDED",
        flags: { voided: true },
      },
      {
        transactionId: "TX-SUCCESS-BUT-ERRORED",
        flags: { errorOccurred: true },
      },
      {
        transactionId: "TX-SUCCESS-BUT-AUTH-ONLY",
        flags: {
          auth: true,
          standalonePayment: false,
          capture: false,
        },
      },
    ];
    for (const { transactionId: nonPayableId, flags } of nonPayableSuccessCases) {
      const response = await signedPost(
        baseUrl,
        transactionWebhook({
          specialReference: "",
          includeCreationExtras: false,
          success: true,
          transactionId: nonPayableId,
          paymobOrderId: "ORDER-3",
          ...flags,
        }),
      );
      assert.equal(response.status, 200);
      assert.equal(
        (await response.json()).status,
        "ignored_non_payable_settlement",
      );
    }
    assert.equal(successAcceptanceCalls, nonPayableBaseline.accepted);
    assert.equal(finalized.length, nonPayableBaseline.finalized);
    assert.equal(propertyReads, nonPayableBaseline.propertyReads);
    assert.equal(updates.length, nonPayableBaseline.updates);

    const genericMethodBaseline = {
      accepted: successAcceptanceCalls,
      resumed: resumedPayments.length,
    };
    const genericMethodSuccess = await signedPost(
      baseUrl,
      transactionWebhook({
        specialReference: "ATTEMPT-3",
        paymentId: "PAY-3",
        merchantAttemptKey: "ATTEMPT-3",
        success: true,
        transactionId: "TX-GENERIC-METHOD-SUCCESS",
        paymobOrderId: "ORDER-3",
        sourceType: "card",
        cardSubType: "card",
      }),
    );
    assert.equal(genericMethodSuccess.status, 422);
    assert.deepEqual(await genericMethodSuccess.json(), {
      error: "Payment callback requires an exact payment subtype",
      reason: "generic_payment_method",
    });
    assert.equal(successAcceptanceCalls, genericMethodBaseline.accepted);
    assert.equal(resumedPayments.length, genericMethodBaseline.resumed);

    const staleSuccess = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-OLD",
      paymentId: "PAY-1",
      merchantAttemptKey: "ATTEMPT-OLD",
      success: true,
      transactionId: "TX-OLD-SUCCESS",
    }));
    assert.equal(staleSuccess.status, 409);
    assert.deepEqual(updates, []);

    payments[1].status = "مكتمل";
    const missingPaymentIdSuccess = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-2",
      success: true,
      transactionId: "TX-MISSING-ID-SUCCESS",
    }));
    assert.equal(missingPaymentIdSuccess.status, 200);
    assert.equal(
      (await missingPaymentIdSuccess.json()).status,
      "already_processed",
    );
    assert.deepEqual(updates, []);
    payments[1].status = "قيد المراجعة";

    providerOrderOverride = "ORDER-DIFFERENT";
    const providerOrderMismatch = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-2",
      success: true,
      transactionId: "TX-PROVIDER-ORDER-MISMATCH",
    }));
    assert.equal(providerOrderMismatch.status, 409);
    providerOrderOverride = "";

    payments[0].merchantAttemptKey = "ATTEMPT-2";
    const duplicateAttempt = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-2",
      success: true,
      transactionId: "TX-DUPLICATE-ATTEMPT",
    }));
    assert.equal(duplicateAttempt.status, 409);
    assert.deepEqual(updates, []);
    payments[0].merchantAttemptKey = "ATTEMPT-1";

    payments[1].status = "مكتمل";
    payments[1].paymobOrderId = "ORDER-PERSISTED";
    const persistedOrderSuccess = await signedPost(baseUrl, transactionWebhook({
      specialReference: "",
      success: true,
      transactionId: "TX-PERSISTED-ORDER",
      paymobOrderId: "ORDER-PERSISTED",
    }));
    assert.equal(persistedOrderSuccess.status, 200);
    assert.equal(
      (await persistedOrderSuccess.json()).status,
      "already_processed",
    );

    const unknownExplicitPayment = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-2",
      paymentId: "PAY-UNKNOWN",
      merchantAttemptKey: "ATTEMPT-2",
      success: true,
      transactionId: "TX-UNKNOWN-PAYMENT-ID",
      paymobOrderId: "ORDER-PERSISTED",
    }));
    assert.equal(unknownExplicitPayment.status, 404);
    delete payments[1].paymobOrderId;
    payments[1].status = "قيد المراجعة";

    // Simulate a retry replacing the attempt after the route's initial lookup
    // but before the authoritative transactional acceptance.
    changeAttemptBeforeAcceptance = true;
    const changedAttemptRace = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-1",
      paymentId: "PAY-1",
      merchantAttemptKey: "ATTEMPT-1",
      success: true,
      transactionId: "TX-RACING-SUCCESS",
    }));
    assert.equal(changedAttemptRace.status, 409);
    assert.deepEqual(updates, []);
    payments[0].merchantAttemptKey = "ATTEMPT-1";

    propertySuspended = true;
    const suspendedSuccess = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-1",
      paymentId: "PAY-1",
      merchantAttemptKey: "ATTEMPT-1",
      success: true,
      transactionId: "TX-SUSPENDED-SUCCESS",
    }));
    const suspendedPayload = await suspendedSuccess.json();
    assert.equal(suspendedSuccess.status, 200);
    assert.equal(suspendedPayload.status, "property_suspended");
    assert.equal(suspendedPayload.paymentId, "PAY-1");
    assert.equal(acceptedPaymentMethods.at(-1), "visa");
    assert.equal(updates.length, 1);
    const heldUpdate = (
      updates as unknown as Array<{ id: string; updates: any }>
    )[0];
    assert.equal(heldUpdate.id, "PAY-1");
    assert.equal(heldUpdate.updates.status, "نجح - قيد التحقق");
    assert.match(heldUpdate.updates.notes, /موقوف مؤقتاً/);
    assert.equal(verificationWrites, 0);
    propertySuspended = false;

    // A final signed success following a pending event is accepted. Marking the
    // fixture complete exercises the idempotent success return without invoking
    // unrelated notification integrations in this route-level security test.
    payments[1].status = "مكتمل";
    const finalSuccess = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-2",
      paymentId: "PAY-2",
      merchantAttemptKey: "ATTEMPT-2",
      success: true,
      transactionId: "TX-ATTEMPT-2-SUCCESS",
    }));
    assert.equal(finalSuccess.status, 200);
    assert.equal(updates.length, 1);

    // An exact duplicate financial success resumes only the shared idempotent
    // fulfillment service. It must not fall through to this route's legacy
    // property verification/update/notification block.
    payments[0].transactionId = "TX-DUPLICATE-SUCCESS";
    payments[0].completedAt = "2026-07-27T10:00:00.000Z";
    payments[0].status = "نجح - قيد التحقق";
    returnAlreadyAccepted = true;
    const duplicateBaseline = {
      finalized: finalized.length,
      propertyReads,
      updates: updates.length,
      verificationWrites,
    };
    const duplicateCaptureSuccess = await signedPost(
      baseUrl,
      transactionWebhook({
        specialReference: "ATTEMPT-1",
        paymentId: "PAY-1",
        merchantAttemptKey: "ATTEMPT-1",
        success: true,
        standalonePayment: false,
        capture: true,
        transactionId: "TX-DUPLICATE-SUCCESS",
      }),
    );
    assert.equal(duplicateCaptureSuccess.status, 200);
    assert.deepEqual(await duplicateCaptureSuccess.json(), {
      ok: true,
      status: "activation_resumed",
      activation: "activated",
      paymentId: "PAY-1",
    });
    assert.deepEqual(resumedPayments, ["PAY-1"]);
    assert.equal(finalized.length, duplicateBaseline.finalized);
    assert.equal(propertyReads, duplicateBaseline.propertyReads);
    assert.equal(updates.length, duplicateBaseline.updates);
    assert.equal(verificationWrites, duplicateBaseline.verificationWrites);

    resumeOutcome = "queued";
    const duplicateQueuedSuccess = await signedPost(
      baseUrl,
      transactionWebhook({
        specialReference: "ATTEMPT-1",
        paymentId: "PAY-1",
        merchantAttemptKey: "ATTEMPT-1",
        success: true,
        transactionId: "TX-DUPLICATE-SUCCESS",
      }),
    );
    assert.equal(duplicateQueuedSuccess.status, 200);
    assert.deepEqual(await duplicateQueuedSuccess.json(), {
      ok: true,
      status: "pending_activation",
      activation: "queued",
      paymentId: "PAY-1",
    });

    resumeError = Object.assign(new Error("property is incomplete"), {
      code: "PROPERTY_INCOMPLETE",
    });
    const duplicatePendingActivation = await signedPost(
      baseUrl,
      transactionWebhook({
        specialReference: "ATTEMPT-1",
        paymentId: "PAY-1",
        merchantAttemptKey: "ATTEMPT-1",
        success: true,
        transactionId: "TX-DUPLICATE-SUCCESS",
      }),
    );
    assert.equal(duplicatePendingActivation.status, 200);
    assert.deepEqual(await duplicatePendingActivation.json(), {
      ok: true,
      status: "pending_verification",
      paymentId: "PAY-1",
      reason: "PROPERTY_INCOMPLETE",
    });
    assert.deepEqual(resumedPayments, ["PAY-1", "PAY-1", "PAY-1"]);
    assert.equal(finalized.length, duplicateBaseline.finalized);
    assert.equal(propertyReads, duplicateBaseline.propertyReads);
    assert.equal(updates.length, duplicateBaseline.updates + 1);
    assert.equal(verificationWrites, duplicateBaseline.verificationWrites);

    const acceptedPaymentLateFailure = await signedPost(
      baseUrl,
      transactionWebhook({
        specialReference: "ATTEMPT-1",
        paymentId: "PAY-1",
        merchantAttemptKey: "ATTEMPT-1",
        transactionId: "TX-LATE-FAILURE-AFTER-SUCCESS",
      }),
    );
    assert.equal(acceptedPaymentLateFailure.status, 200);
    assert.deepEqual(await acceptedPaymentLateFailure.json(), {
      ok: true,
      status: "ignored_late_failure",
    });
    assert.equal(finalized.length, duplicateBaseline.finalized);
  } finally {
    (paymentService as any).getAll = originals.getAll;
    (paymentService as any).update = originals.update;
    (paymentService as any).approveBankTransfer = originals.approve;
    (firebaseService as any).acceptSuccessfulPaymentIntention = originals.accept;
    (firebaseService as any).recordPaidPaymentActivationPending =
      originals.recordActivationPending;
    (firebaseService as any).settleAddOnPaymentCallback = originals.settleAddon;
    (firebaseService as any).finalizeFailedPaymentIntention = originals.finalize;
    (firebaseService as any).getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    (firebaseService as any).updateVerificationStatus =
      originals.updateVerificationStatus;
    (propertyService as any).getByNumber = originals.getPropertyByNumber;
    (addOnService as any).logHistory = originals.logAddonHistory;
    (paymobService as any).inquiryByOrderId = originals.inquiry;
    (paymobService as any).retrieveIntention = originals.retrieveIntention;
    if (originals.hmacSecret === undefined) delete process.env.PAYMOB_HMAC_SECRET;
    else process.env.PAYMOB_HMAC_SECRET = originals.hmacSecret;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
