import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";

import { calculatePaymobWebhookHmac } from "../integrations/paymob";
import { notificationService, paymentService } from "../services";
import { bookingCommissionStore } from "../services/BookingCommissionStore";
import type { BookingCommissionWebhookInput } from "../services/BookingCommissionTypes";
import webhooksRouter from "./webhooks";

const TEST_HMAC_SECRET = "booking-commission-webhook-test-secret";

type CommissionCallbackOptions = {
  transactionId?: string;
  paymobOrderId?: string;
  amountCents?: number;
  currency?: string;
  success?: boolean;
  auth?: boolean;
  refunded?: boolean;
  voided?: boolean;
  attemptId?: string;
  bookingId?: string;
  merchantAttemptKey?: string;
  sourceType?: string;
  cardSubType?: string;
};

function commissionWebhook(options: CommissionCallbackOptions = {}) {
  const {
    transactionId = "TX-BCOM-SUCCESS",
    paymobOrderId = "ORDER-BCOM-1",
    amountCents = 12_556,
    currency = "SAR",
    success = true,
    auth = false,
    refunded = false,
    voided = false,
    attemptId = "BCOM-ATT-1",
    bookingId = "BOOK-REQ-13383-001",
    merchantAttemptKey = "RWQN-BCOM-ATTEMPT-KEY",
    sourceType = "card",
    cardSubType = "visa",
  } = options;
  return {
    obj: {
      amount_cents: amountCents,
      created_at: "2026-08-15T14:30:00.000Z",
      currency,
      error_occured: false,
      has_parent_transaction: false,
      id: transactionId,
      integration_id: 15650,
      is_3d_secure: true,
      is_auth: auth,
      is_capture: false,
      is_refunded: refunded,
      is_standalone_payment: true,
      is_voided: voided,
      merchant_order_id: merchantAttemptKey,
      order: {
        id: paymobOrderId,
        merchant_order_id: merchantAttemptKey,
        special_reference: merchantAttemptKey,
        extras: {
          creation_extras: {
            type: "booking_commission",
            attemptId,
            bookingId,
            merchantAttemptKey,
          },
        },
      },
      owner: 42,
      pending: false,
      source_data: {
        pan: "2346",
        type: sourceType,
        sub_type: cardSubType,
      },
      success,
    },
  };
}

async function signedPost(
  baseUrl: string,
  webhook: ReturnType<typeof commissionWebhook>,
) {
  const hmac = calculatePaymobWebhookHmac(webhook, TEST_HMAC_SECRET);
  assert.ok(hmac);
  return fetch(`${baseUrl}/api/paymob/webhook?hmac=${encodeURIComponent(hmac)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(webhook),
  });
}

test("booking commission callbacks require HMAC and stay on the dedicated settlement path", async () => {
  const originals = {
    settle: bookingCommissionStore.settleCommissionCallback,
    reverse: bookingCommissionStore.recordCommissionReversal,
    getPayments: paymentService.getAll,
    sendAdmin: notificationService.sendAdmin,
    hmacSecret: process.env.PAYMOB_HMAC_SECRET,
  };
  const settlementInputs: BookingCommissionWebhookInput[] = [];
  const reversalInputs: Array<
    Parameters<typeof bookingCommissionStore.recordCommissionReversal>[0]
  > = [];
  const adminAlerts: string[] = [];
  let ordinaryPaymentReads = 0;

  process.env.PAYMOB_HMAC_SECRET = TEST_HMAC_SECRET;
  (bookingCommissionStore as any).settleCommissionCallback = async (
    input: BookingCommissionWebhookInput,
  ) => {
    settlementInputs.push(input);
    return {
      status: "duplicate_paid" as const,
      bookingId: "BOOK-REQ-13383-001",
      released: false,
    };
  };
  (bookingCommissionStore as any).recordCommissionReversal = async (
    input: Parameters<typeof bookingCommissionStore.recordCommissionReversal>[0],
  ) => {
    reversalInputs.push(input);
    return {
      status: "recorded" as const,
      bookingId: "BOOK-REQ-13383-001",
      reviewRequired: true,
    };
  };
  (paymentService as any).getAll = async () => {
    ordinaryPaymentReads += 1;
    throw new Error("booking commission callback fell through to ordinary payments");
  };
  (notificationService as any).sendAdmin = async (message: string) => {
    adminAlerts.push(message);
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
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const unsignedBody = commissionWebhook();
    const invalidHmac = await fetch(
      `${baseUrl}/api/paymob/webhook?hmac=${"0".repeat(128)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(unsignedBody),
      },
    );
    assert.equal(invalidHmac.status, 401);
    assert.deepEqual(settlementInputs, []);
    assert.deepEqual(reversalInputs, []);
    assert.equal(ordinaryPaymentReads, 0);

    const success = await signedPost(baseUrl, commissionWebhook());
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), {
      ok: true,
      status: "duplicate_paid",
    });
    assert.deepEqual(settlementInputs, [{
      paymobOrderId: "ORDER-BCOM-1",
      transactionId: "TX-BCOM-SUCCESS",
      amountCents: 12_556,
      currency: "SAR",
      success: true,
      exactPaymentMethod: "visa",
      providerCreatedAt: "2026-08-15T14:30:00.000Z",
      callbackAttemptId: "BCOM-ATT-1",
      callbackBookingId: "BOOK-REQ-13383-001",
      callbackMerchantAttemptKey: "RWQN-BCOM-ATTEMPT-KEY",
      callbackSpecialReference: "RWQN-BCOM-ATTEMPT-KEY",
    }]);
    assert.equal(reversalInputs.length, 0);
    assert.equal(ordinaryPaymentReads, 0);
    assert.equal(adminAlerts.length, 1, "duplicate payment is escalated for review");

    for (const [reason, flags] of [
      ["refunded", { refunded: true }],
      ["voided", { voided: true }],
      ["authorization_only", { auth: true }],
    ] as const) {
      const response = await signedPost(baseUrl, commissionWebhook({
        transactionId: `TX-BCOM-${reason.toUpperCase()}`,
        ...flags,
      }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        ok: true,
        status: "recorded",
      });
    }

    assert.deepEqual(reversalInputs, [
      {
        paymobOrderId: "ORDER-BCOM-1",
        transactionId: "TX-BCOM-REFUNDED",
        amountCents: 12_556,
        currency: "SAR",
        reason: "refunded",
      },
      {
        paymobOrderId: "ORDER-BCOM-1",
        transactionId: "TX-BCOM-VOIDED",
        amountCents: 12_556,
        currency: "SAR",
        reason: "voided",
      },
      {
        paymobOrderId: "ORDER-BCOM-1",
        transactionId: "TX-BCOM-AUTHORIZATION_ONLY",
        amountCents: 12_556,
        currency: "SAR",
        reason: "authorization_only",
      },
    ]);
    assert.deepEqual(adminAlerts.slice(1), [
      "تم رصد استرداد مالي لدفعة عمولة الحجز BOOK-REQ-13383-001. يلزم إجراء مراجعة مالية يدوية.",
      "تم رصد إلغاء العملية لدفعة عمولة الحجز BOOK-REQ-13383-001. يلزم إجراء مراجعة مالية يدوية.",
    ]);
    assert.equal(
      adminAlerts.some((message) =>
        message.includes("authorization_only") ||
        message.includes("refunded") ||
        message.includes("voided")),
      false,
      "admin alerts must not expose internal reversal enum values",
    );
    assert.equal(
      settlementInputs.length,
      1,
      "non-payable reports never enter ordinary commission settlement",
    );
    assert.equal(ordinaryPaymentReads, 0);
  } finally {
    (bookingCommissionStore as any).settleCommissionCallback = originals.settle;
    (bookingCommissionStore as any).recordCommissionReversal = originals.reverse;
    (paymentService as any).getAll = originals.getPayments;
    (notificationService as any).sendAdmin = originals.sendAdmin;
    if (originals.hmacSecret === undefined) delete process.env.PAYMOB_HMAC_SECRET;
    else process.env.PAYMOB_HMAC_SECRET = originals.hmacSecret;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
