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
  } = options;
  return {
    obj: {
      amount_cents: amountCents,
      created_at: "2026-07-27T10:00:00.000Z",
      currency,
      error_occured: !success && !pending,
      has_parent_transaction: false,
      id: transactionId,
      integration_id: 15650,
      is_3d_secure: true,
      is_auth: false,
      is_capture: false,
      is_refunded: false,
      is_standalone_payment: true,
      is_voided: false,
      merchant_order_id: specialReference,
      order: {
        id: paymobOrderId,
        merchant_order_id: specialReference,
        special_reference: specialReference,
        extras: {
          creation_extras: {
            type: "subscription",
            ...(paymentId ? { paymentId } : {}),
            ...(merchantAttemptKey ? { merchantAttemptKey } : {}),
          },
        },
      },
      owner: 42,
      pending,
      source_data: { pan: "2346", type: "card", sub_type: "visa" },
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
    accept: firebaseService.acceptSuccessfulPaymentIntention,
    settleAddon: firebaseService.settleAddOnPaymentCallback,
    finalize: firebaseService.finalizeFailedPaymentIntention,
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    updateVerificationStatus: firebaseService.updateVerificationStatus,
    getPropertyByNumber: propertyService.getByNumber,
    logAddonHistory: addOnService.logHistory,
    inquiry: paymobService.inquiryByOrderId,
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
    },
    {
      id: "PAY-2",
      propertyNumber: "PROP-1",
      finalAmount: 100,
      status: "قيد المراجعة",
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-2",
    },
    {
      id: "PAY-ADDON-1",
      propertyNumber: "PROP-ADDON",
      packageId: "ADDON-1",
      packageName: "Addon",
      finalAmount: 100,
      status: "قيد الدفع",
      action: "addon",
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
  const addonSettlements: Array<{ id: string; expected: any }> = [];
  let addonHistoryWrites = 0;
  let addonSettlementMode: "already" | "rejected" = "already";
  let paymentReads = 0;
  let changeAttemptBeforeAcceptance = false;
  let propertySuspended = false;
  let verificationWrites = 0;

  process.env.PAYMOB_HMAC_SECRET = TEST_HMAC_SECRET;
  (paymentService as any).getAll = async () => {
    paymentReads += 1;
    return payments;
  };
  (paymentService as any).update = async (id: string, updatesValue: any) => {
    updates.push({ id, updates: updatesValue });
  };
  (propertyService as any).getByNumber = async (propertyNumber: string) => ({
    propertyNumber,
    name: "Suspended property",
    whatsappNumber: "966500000000",
  });
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
    expected: { merchantAttemptKey: string; transactionId: string },
    details: any,
  ) => {
    const current = payments.find((payment) => payment.id === id);
    if (!current) return { status: "rejected", reason: "not_found" };
    if (changeAttemptBeforeAcceptance) {
      current.merchantAttemptKey = "ATTEMPT-CHANGED";
      changeAttemptBeforeAcceptance = false;
    }
    if (
      current.merchantAttemptKey &&
      current.merchantAttemptKey !== expected.merchantAttemptKey
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
  ) => {
    addonSettlements.push({ id, expected });
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
    finalized.push({ id, expected });
    return true;
  };
  (paymobService as any).inquiryByOrderId = async () => ({ ok: false });
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
      specialReference: "PAY-ADDON-1",
      paymentId: "PAY-ADDON-1",
      success: true,
      transactionId: "TX-ADDON-SUCCESS",
      paymobOrderId: "ORDER-ADDON",
    }));
    assert.equal(terminalAddonSuccess.status, 200);
    assert.equal((await terminalAddonSuccess.json()).status, "already_processed");

    const lateAddonFailure = await signedPost(baseUrl, transactionWebhook({
      specialReference: "PAY-ADDON-1",
      paymentId: "PAY-ADDON-1",
      transactionId: "TX-ADDON-LATE-FAILURE",
      paymobOrderId: "ORDER-ADDON",
    }));
    assert.equal(lateAddonFailure.status, 200);
    assert.equal((await lateAddonFailure.json()).status, "ignored_late_failure");
    assert.equal(addonHistoryWrites, 0);
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
    assert.equal(ambiguous.status, 200);
    assert.deepEqual(finalized, []);

    const missingPaymentIdFailure = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-2",
      transactionId: "TX-ATTEMPT-2-FAILED",
    }));
    assert.equal(missingPaymentIdFailure.status, 200);
    assert.deepEqual(finalized, []);

    const stalePaymentId = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-OLD",
      paymentId: "PAY-1",
      merchantAttemptKey: "ATTEMPT-OLD",
      transactionId: "TX-OLD-FAILED",
    }));
    assert.equal(stalePaymentId.status, 200);
    assert.equal(finalized.length, 0);

    const conflictingIdentifiers = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-2",
      paymentId: "PAY-1",
      merchantAttemptKey: "ATTEMPT-2",
      transactionId: "TX-CONFLICT-FAILED",
    }));
    assert.equal(conflictingIdentifiers.status, 200);
    assert.equal(finalized.length, 0);

    const exactPaymentId = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-1",
      paymentId: "PAY-1",
      merchantAttemptKey: "ATTEMPT-1",
      transactionId: "TX-ATTEMPT-1-FAILED",
    }));
    assert.equal(exactPaymentId.status, 200);
    assert.deepEqual(finalized, [{
      id: "PAY-1",
      expected: {
        merchantAttemptKey: "ATTEMPT-1",
        transactionId: "TX-ATTEMPT-1-FAILED",
        paymobOrderId: "ORDER-1",
        amountCents: 10_000,
        currency: "SAR",
      },
    }]);

    const wrongAmount = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-1",
      paymentId: "PAY-1",
      merchantAttemptKey: "ATTEMPT-1",
      amountCents: 9_999,
      transactionId: "TX-WRONG-AMOUNT",
    }));
    assert.equal(wrongAmount.status, 422);
    assert.equal(finalized.length, 1);

    const wrongCurrency = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-1",
      paymentId: "PAY-1",
      merchantAttemptKey: "ATTEMPT-1",
      currency: "USD",
      transactionId: "TX-WRONG-CURRENCY",
    }));
    assert.equal(wrongCurrency.status, 422);
    assert.equal(finalized.length, 1);

    const staleSuccess = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-OLD",
      paymentId: "PAY-1",
      merchantAttemptKey: "ATTEMPT-OLD",
      success: true,
      transactionId: "TX-OLD-SUCCESS",
    }));
    assert.equal(staleSuccess.status, 409);
    assert.deepEqual(updates, []);

    const missingPaymentIdSuccess = await signedPost(baseUrl, transactionWebhook({
      specialReference: "ATTEMPT-2",
      merchantAttemptKey: "ATTEMPT-2",
      success: true,
      transactionId: "TX-MISSING-ID-SUCCESS",
    }));
    assert.equal(missingPaymentIdSuccess.status, 404);
    assert.deepEqual(updates, []);

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
  } finally {
    (paymentService as any).getAll = originals.getAll;
    (paymentService as any).update = originals.update;
    (firebaseService as any).acceptSuccessfulPaymentIntention = originals.accept;
    (firebaseService as any).settleAddOnPaymentCallback = originals.settleAddon;
    (firebaseService as any).finalizeFailedPaymentIntention = originals.finalize;
    (firebaseService as any).getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    (firebaseService as any).updateVerificationStatus =
      originals.updateVerificationStatus;
    (propertyService as any).getByNumber = originals.getPropertyByNumber;
    (addOnService as any).logHistory = originals.logAddonHistory;
    (paymobService as any).inquiryByOrderId = originals.inquiry;
    if (originals.hmacSecret === undefined) delete process.env.PAYMOB_HMAC_SECRET;
    else process.env.PAYMOB_HMAC_SECRET = originals.hmacSecret;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
