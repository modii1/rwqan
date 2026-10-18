import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

// This suite exercises the whole subscription payment seam end to end using
// isolated, in-memory doubles:
//   1. a real `paymobService.createIntention` call against a mock provider,
//   2. a persisted payment record linked to the returned intention/order,
//   3. a real, HMAC-signed Paymob webhook posted at the real router,
//   4. exactly-once subscription activation.
// It never contacts Paymob or any real service and never touches production
// data. Environment variables are set before the modules that capture them at
// import time (paymob.ts) are dynamically imported.

const TEST_HMAC_SECRET = "test-paymob-flow-hmac-secret";

(process.env as Record<string, string | undefined>).NODE_ENV = "development";
process.env.PAYMOB_ALLOW_IN_DEVELOPMENT = "true";
process.env.ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT = "false";
process.env.PAYMOB_DEV_NOTIFICATION_URL =
  "https://dev-integration.example.test/api/paymob/webhook";
process.env.PAYMOB_DEV_REDIRECT_URL =
  "https://dev-integration.example.test/api/paymob/webhook";
process.env.PAYMOB_API_KEY = "sau_sk_test_integration_flow_0001";
process.env.PAYMOB_PUBLIC_KEY = "sau_pk_test_integration_flow_0001";
process.env.PAYMOB_HMAC_SECRET = TEST_HMAC_SECRET;
process.env.PAYMOB_INTEGRATION_ID_CARDS = "15494";

const { paymobService, calculatePaymobWebhookHmac } = await import(
  "../integrations/paymob"
);
const { addOnService, paymentService, propertyService } = await import(
  "../services"
);
const { firebaseService } = await import("../firebaseService");
const { default: webhooksRouter } = await import("./webhooks");

const PROPERTY_NUMBER = "PROP-FLOW-1";
const PACKAGE_ID = "E2E_TEST_PKG_1PROP";
const MERCHANT_ATTEMPT_KEY = "ATTEMPT-FLOW-1";
const PAYMENT_ID = "PAY-FLOW-1";
const INTENTION_ID = "INT-FLOW-1";
const PAYMOB_ORDER_ID = "ORDER-FLOW-1";
const AMOUNT_SAR = 50;

type WebhookOptions = {
  amountCents?: number;
  currency?: string;
  transactionId?: string;
  paymobOrderId?: string;
  merchantAttemptKey?: string;
  paymentId?: string;
  success?: boolean;
  cardSubType?: string;
};

function subscriptionWebhook(options: WebhookOptions = {}) {
  const {
    amountCents = AMOUNT_SAR * 100,
    currency = "SAR",
    transactionId = "TX-FLOW-1",
    paymobOrderId = PAYMOB_ORDER_ID,
    merchantAttemptKey = MERCHANT_ATTEMPT_KEY,
    paymentId = PAYMENT_ID,
    success = true,
    cardSubType = "visa",
  } = options;

  return {
    obj: {
      amount_cents: amountCents,
      created_at: "2026-10-14T10:00:00.000Z",
      currency,
      error_occured: false,
      has_parent_transaction: false,
      id: transactionId,
      integration_id: 15494,
      is_3d_secure: true,
      is_auth: false,
      is_capture: false,
      is_refunded: false,
      is_standalone_payment: true,
      is_voided: false,
      merchant_order_id: merchantAttemptKey,
      order: {
        id: paymobOrderId,
        merchant_order_id: merchantAttemptKey,
        special_reference: merchantAttemptKey,
        extras: {
          creation_extras: {
            type: "subscription",
            propertyNumber: PROPERTY_NUMBER,
            paymentId,
            merchantAttemptKey,
          },
        },
      },
      owner: 42,
      pending: false,
      source_data: { pan: "2346", type: "card", sub_type: cardSubType },
      success,
    },
  };
}

async function signedPost(baseUrl: string, webhook: unknown) {
  const signature = calculatePaymobWebhookHmac(webhook, TEST_HMAC_SECRET);
  assert.ok(signature, "expected a signed HMAC payload");
  return fetch(
    baseUrl + "/api/paymob/webhook?hmac=" + encodeURIComponent(signature),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(webhook),
    },
  );
}

async function startHarness() {
  const payments: any[] = [];
  const activations: string[] = [];
  const subscriptions = new Map<string, any>();
  const acceptedMethods: string[] = [];
  const activationPending: string[] = [];

  (paymentService as any).getAll = async () => payments;
  (paymentService as any).update = async (
    id: string,
    updates: Record<string, unknown>,
  ) => {
    const record = payments.find((payment) => payment.id === id);
    if (record) Object.assign(record, updates);
    return record ?? null;
  };
  (paymentService as any).approveBankTransfer = async (id: string) => {
    const record = payments.find((payment) => payment.id === id);
    if (!record) throw new Error("payment not found");
    if (record.fulfilledAt || record.fulfillmentState === "fulfilled") {
      return { outcome: "activated", alreadyProcessed: true, payment: record };
    }
    record.status = "مكتمل";
    record.fulfillmentState = "fulfilled";
    record.fulfilledAt = new Date().toISOString();
    activations.push(id);
    subscriptions.set(record.propertyNumber, {
      id: `SUB-${record.propertyNumber}`,
      propertyNumber: record.propertyNumber,
      packageId: record.packageId,
      status: "نشط",
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    return { outcome: "activated", alreadyProcessed: false, payment: record };
  };
  (propertyService as any).getByNumber = async (propertyNumber: string) => ({
    propertyNumber,
    name: "Property Flow 1",
    whatsappNumber: "966500000000",
  });
  (addOnService as any).logHistory = async () => {};
  (firebaseService as any).acceptSuccessfulPaymentIntention = async (
    id: string,
    expected: { amountCents?: number; currency?: string },
    details: { paymentMethod?: string },
  ) => {
    const record = payments.find((payment) => payment.id === id);
    if (!record) return { status: "rejected", reason: "not_found" };
    if (
      record.fulfilledAt ||
      record.fulfillmentState === "fulfilled" ||
      record.status === "مكتمل"
    ) {
      return { status: "already_processed", payment: record };
    }
    if (
      Number(expected?.amountCents) !== Math.round(record.finalAmount * 100) ||
      String(expected?.currency || "").trim().toUpperCase() !== "SAR"
    ) {
      return { status: "rejected", reason: "amount_or_currency_mismatch" };
    }
    record.status = "نجح - قيد التحقق";
    record.completedAt = new Date().toISOString();
    acceptedMethods.push(details.paymentMethod || "");
    return { status: "accepted", payment: record };
  };
  (firebaseService as any).recordPaidPaymentActivationPending = async (
    id: string,
    _transactionId: string,
    notes: string,
  ) => {
    activationPending.push(id);
    const record = payments.find((payment) => payment.id === id);
    if (record) record.notes = notes;
    return true;
  };
  (firebaseService as any).getSubscriptionByPropertyNumber = async (
    propertyNumber: string,
  ) => subscriptions.get(propertyNumber) ?? null;
  (paymobService as any).inquiryByOrderId = async () => ({ ok: false });

  const app = express();
  app.use(express.json());
  app.use(webhooksRouter);
  const server = await new Promise<Server>((resolve) => {
    const started = app.listen(0, () => resolve(started));
  });
  const { port } = server.address() as AddressInfo;

  return {
    payments,
    activations,
    subscriptions,
    acceptedMethods,
    activationPending,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function createIntentionWithMockProvider() {
  const originalFetch = globalThis.fetch;
  const captured: { url?: string; body?: any } = {};
  globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
    captured.url = String(url);
    captured.body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    return new Response(
      JSON.stringify({
        id: INTENTION_ID,
        client_secret: "cs-flow-secret",
        order_id: PAYMOB_ORDER_ID,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;

  try {
    const intention = await paymobService.createIntention(
      AMOUNT_SAR,
      PROPERTY_NUMBER,
      "Property Flow 1",
      "0500000000",
      "E2E Test Package",
      30,
      "cards",
      { merchantAttemptKey: MERCHANT_ATTEMPT_KEY, paymentId: PAYMENT_ID },
    );
    return { intention, captured };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("creates an intention, links the payment, and activates the subscription exactly once", async () => {
  const harness = await startHarness();
  try {
    const { intention, captured } = await createIntentionWithMockProvider();

    assert.equal(captured.url, "https://ksa.paymob.com/v1/intention/");
    assert.equal(captured.body.amount, AMOUNT_SAR * 100);
    assert.equal(captured.body.currency, "SAR");
    assert.equal(
      captured.body.notification_url,
      "https://dev-integration.example.test/api/paymob/webhook",
    );
    assert.deepEqual(captured.body.payment_methods, [15494]);
    assert.equal(captured.body.special_reference, MERCHANT_ATTEMPT_KEY);
    assert.equal(
      captured.body.extras.creation_extras.paymentId,
      PAYMENT_ID,
    );
    assert.equal(
      captured.body.extras.creation_extras.merchantAttemptKey,
      MERCHANT_ATTEMPT_KEY,
    );

    assert.equal(intention.intentionId, INTENTION_ID);
    assert.equal(intention.paymobOrderId, PAYMOB_ORDER_ID);
    assert.match(intention.checkoutUrl, /publicKey=sau_pk_test_/);
    assert.match(intention.checkoutUrl, /clientSecret=cs-flow-secret/);

    // Mirror the owner route: persist a verification-pending payment and link
    // it to the provider intention/order that the mock provider returned.
    harness.payments.push({
      id: PAYMENT_ID,
      propertyNumber: PROPERTY_NUMBER,
      packageId: PACKAGE_ID,
      packageName: "E2E Test Package",
      amount: AMOUNT_SAR,
      discountAmount: 0,
      finalAmount: AMOUNT_SAR,
      status: "قيد المراجعة",
      paymentMethod: "بطاقة",
      action: "new",
      merchantAttemptKey: MERCHANT_ATTEMPT_KEY,
      intentionState: "created",
      paymentReference: intention.intentionId,
      transactionId: intention.intentionId,
      paymentCheckoutUrl: intention.checkoutUrl,
      paymobOrderId: intention.paymobOrderId,
      createdAt: new Date().toISOString(),
    });

    const settled = await signedPost(
      harness.baseUrl,
      subscriptionWebhook({ transactionId: "TX-FLOW-1" }),
    );
    assert.equal(settled.status, 200);
    const settledBody = await settled.json();
    assert.equal(settledBody.status, "activated");
    assert.equal(settledBody.activation, "activated");
    assert.equal(settledBody.paymentId, PAYMENT_ID);

    assert.equal(harness.activations.length, 1);
    assert.deepEqual(harness.acceptedMethods, ["visa"]);
    assert.equal(harness.activationPending.length, 0);

    const stored = harness.payments[0];
    assert.equal(stored.status, "مكتمل");
    assert.equal(stored.fulfillmentState, "fulfilled");
    assert.ok(stored.fulfilledAt);

    const subscription = harness.subscriptions.get(PROPERTY_NUMBER);
    assert.ok(subscription, "expected an activated subscription");
    assert.equal(subscription.status, "نشط");
    assert.equal(subscription.packageId, PACKAGE_ID);

    // A duplicate, identical callback must never activate a second time.
    const replay = await signedPost(
      harness.baseUrl,
      subscriptionWebhook({ transactionId: "TX-FLOW-1" }),
    );
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).status, "already_processed");
    assert.equal(harness.activations.length, 1);
    assert.equal(harness.subscriptions.size, 1);
  } finally {
    await harness.close();
  }
});

test("rejects an unsigned or invalid-signature callback without activating", async () => {
  const harness = await startHarness();
  try {
    harness.payments.push({
      id: PAYMENT_ID,
      propertyNumber: PROPERTY_NUMBER,
      finalAmount: AMOUNT_SAR,
      status: "قيد المراجعة",
      merchantAttemptKey: MERCHANT_ATTEMPT_KEY,
      paymentReference: INTENTION_ID,
      paymobOrderId: PAYMOB_ORDER_ID,
    });

    const unsigned = await fetch(harness.baseUrl + "/api/paymob/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(subscriptionWebhook()),
    });
    assert.equal(unsigned.status, 401);

    const forged = await fetch(
      harness.baseUrl + "/api/paymob/webhook?hmac=" + "0".repeat(128),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscriptionWebhook()),
      },
    );
    assert.equal(forged.status, 401);

    assert.equal(harness.activations.length, 0);
    assert.equal(harness.subscriptions.size, 0);
    assert.equal(harness.payments[0].status, "قيد المراجعة");
  } finally {
    await harness.close();
  }
});

test("rejects a signed callback whose amount does not match the payment", async () => {
  const harness = await startHarness();
  try {
    harness.payments.push({
      id: PAYMENT_ID,
      propertyNumber: PROPERTY_NUMBER,
      finalAmount: AMOUNT_SAR,
      status: "قيد المراجعة",
      merchantAttemptKey: MERCHANT_ATTEMPT_KEY,
      paymentReference: INTENTION_ID,
      paymobOrderId: PAYMOB_ORDER_ID,
    });

    const mismatch = await signedPost(
      harness.baseUrl,
      subscriptionWebhook({ amountCents: AMOUNT_SAR * 100 + 1 }),
    );
    assert.equal(mismatch.status, 422);
    assert.equal(harness.activations.length, 0);
    assert.equal(harness.subscriptions.size, 0);
  } finally {
    await harness.close();
  }
});

test("rejects a signed callback whose currency does not match the payment", async () => {
  const harness = await startHarness();
  try {
    harness.payments.push({
      id: PAYMENT_ID,
      propertyNumber: PROPERTY_NUMBER,
      finalAmount: AMOUNT_SAR,
      status: "قيد المراجعة",
      merchantAttemptKey: MERCHANT_ATTEMPT_KEY,
      paymentReference: INTENTION_ID,
      paymobOrderId: PAYMOB_ORDER_ID,
    });

    const mismatch = await signedPost(
      harness.baseUrl,
      subscriptionWebhook({ currency: "USD" }),
    );
    assert.equal(mismatch.status, 422);
    assert.equal(harness.activations.length, 0);
    assert.equal(harness.subscriptions.size, 0);
  } finally {
    await harness.close();
  }
});

test("a signed callback for an unknown order is not activated", async () => {
  const harness = await startHarness();
  try {
    harness.payments.push({
      id: PAYMENT_ID,
      propertyNumber: PROPERTY_NUMBER,
      finalAmount: AMOUNT_SAR,
      status: "قيد المراجعة",
      merchantAttemptKey: MERCHANT_ATTEMPT_KEY,
      paymentReference: INTENTION_ID,
      paymobOrderId: PAYMOB_ORDER_ID,
    });

    const unknown = await signedPost(
      harness.baseUrl,
      subscriptionWebhook({
        paymobOrderId: "ORDER-UNKNOWN",
        merchantAttemptKey: "ATTEMPT-FOREIGN",
        paymentId: "PAY-FOREIGN",
      }),
    );
    assert.equal(unknown.status, 404);
    assert.equal(harness.activations.length, 0);
    assert.equal(harness.subscriptions.size, 0);
  } finally {
    await harness.close();
  }
});
