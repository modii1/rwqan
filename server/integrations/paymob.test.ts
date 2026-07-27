import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  buildPaymobWebhookHmacPayload,
  calculatePaymobWebhookHmac,
  PaymobIntentionError,
  PaymobService,
} from "./paymob";

const intentionArgs = [
  100,
  "PROP-1",
  "Property",
  "0500000000",
  "Package",
  30,
  "cards",
] as const;

test("Paymob persists the stable merchant attempt key and payment id in its request", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: any;
  globalThis.fetch = (async (_url: any, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      id: "INT-1",
      client_secret: "secret-1",
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await new PaymobService().createIntention(
      ...intentionArgs,
      { merchantAttemptKey: "ATTEMPT-1", paymentId: "PAY-1" },
    );
    assert.equal(requestBody.special_reference, "ATTEMPT-1");
    assert.equal(requestBody.extras.creation_extras.paymentId, "PAY-1");
    assert.equal(
      requestBody.extras.creation_extras.merchantAttemptKey,
      "ATTEMPT-1",
    );
    assert.equal(result.intentionId, "INT-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("only explicit validation/auth/not-found Paymob responses are definitive", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [400, 401, 403, 404, 422]) {
      globalThis.fetch = (async () => new Response("rejected", { status })) as typeof fetch;
      await assert.rejects(
        new PaymobService().createIntention(...intentionArgs),
        (error: any) =>
          error instanceof PaymobIntentionError && error.certainty === "rejected",
      );
    }
    for (const status of [408, 409, 425, 429, 500, 503]) {
      globalThis.fetch = (async () => new Response("ambiguous", { status })) as typeof fetch;
      await assert.rejects(
        new PaymobService().createIntention(...intentionArgs),
        (error: any) =>
          error instanceof PaymobIntentionError && error.certainty === "unknown",
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("network and malformed-success outcomes fail closed as unknown", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => {
      throw new Error("timeout");
    }) as typeof fetch;
    await assert.rejects(
      new PaymobService().createIntention(...intentionArgs),
      (error: any) =>
        error instanceof PaymobIntentionError && error.certainty === "unknown",
    );

    globalThis.fetch = (async () => new Response("not-json", { status: 200 })) as typeof fetch;
    await assert.rejects(
      new PaymobService().createIntention(...intentionArgs),
      (error: any) =>
        error instanceof PaymobIntentionError && error.certainty === "unknown",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Paymob webhook HMAC follows the documented field order for nested and flat callbacks", () => {
  const secret = "test-paymob-hmac-secret";
  const obj = {
    amount_cents: 10_000,
    created_at: "2026-07-27T10:00:00.000Z",
    currency: "SAR",
    error_occured: false,
    has_parent_transaction: false,
    id: 123456,
    integration_id: 15650,
    is_3d_secure: true,
    is_auth: false,
    is_capture: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_voided: false,
    order: { id: 98765 },
    owner: 42,
    pending: false,
    source_data: { pan: "2346", sub_type: "visa", type: "card" },
    success: true,
  };
  const documentedPayload = [
    10_000,
    "2026-07-27T10:00:00.000Z",
    "SAR",
    false,
    false,
    123456,
    15650,
    true,
    false,
    false,
    false,
    true,
    false,
    98765,
    42,
    false,
    "2346",
    "visa",
    "card",
    true,
  ].map(String).join("");
  const expected = createHmac("sha512", secret)
    .update(documentedPayload)
    .digest("hex");

  assert.equal(buildPaymobWebhookHmacPayload({ obj }), documentedPayload);
  assert.equal(calculatePaymobWebhookHmac({ obj }, secret), expected);

  const flat = {
    ...obj,
    order: obj.order.id,
    source_data: undefined,
    source_data_pan: obj.source_data.pan,
    source_data_sub_type: obj.source_data.sub_type,
    source_data_type: obj.source_data.type,
  };
  assert.equal(buildPaymobWebhookHmacPayload(flat), documentedPayload);
  assert.equal(calculatePaymobWebhookHmac(flat, secret), expected);
});

test("Paymob webhook verification fails closed for missing fields, secrets, and signatures", () => {
  const previousSecret = process.env.PAYMOB_HMAC_SECRET;
  const service = new PaymobService();
  const webhook = {
    obj: {
      amount_cents: 100,
      created_at: "2026-07-27T10:00:00.000Z",
      currency: "SAR",
      error_occured: false,
      has_parent_transaction: false,
      id: 1,
      integration_id: 15650,
      is_3d_secure: false,
      is_auth: false,
      is_capture: false,
      is_refunded: false,
      is_standalone_payment: true,
      is_voided: false,
      order: { id: 2 },
      owner: 3,
      pending: false,
      source_data: { pan: "1111", sub_type: "visa", type: "card" },
      success: true,
    },
  };

  try {
    process.env.PAYMOB_HMAC_SECRET = "route-test-secret";
    const signature = calculatePaymobWebhookHmac(
      webhook,
      process.env.PAYMOB_HMAC_SECRET,
    );
    assert.ok(signature);
    assert.equal(service.verifyWebhookSignature(webhook, signature), true);
    assert.equal(service.verifyWebhookSignature(webhook), false);
    assert.equal(service.verifyWebhookSignature(webhook, "0".repeat(128)), false);
    assert.equal(
      service.verifyWebhookSignature(
        { obj: { ...webhook.obj, currency: undefined } },
        signature,
      ),
      false,
    );
    process.env.PAYMOB_HMAC_SECRET = "";
    assert.equal(service.verifyWebhookSignature(webhook, signature), false);
  } finally {
    if (previousSecret === undefined) delete process.env.PAYMOB_HMAC_SECRET;
    else process.env.PAYMOB_HMAC_SECRET = previousSecret;
  }
});
