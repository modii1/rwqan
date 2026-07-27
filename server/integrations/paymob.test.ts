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
    assert.equal(
      requestBody.notification_url,
      "https://rwqan.sa/api/paymob/webhook",
    );
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

test("Paymob intention creation resolves and returns the provider order id", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_url: any, init?: RequestInit) => {
    calls += 1;
    if (init?.method === "POST") {
      return new Response(JSON.stringify({
        id: "INT-WITH-ORDER",
        client_secret: "secret-with-order",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      id: "INT-WITH-ORDER",
      special_reference: "ATTEMPT-WITH-ORDER",
      order_id: 7215999,
      intention_detail: { amount: 10_000, currency: "SAR" },
      confirmed: false,
      paid: false,
      is_card_expired: false,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await new PaymobService().createIntention(
      ...intentionArgs,
      {
        merchantAttemptKey: "ATTEMPT-WITH-ORDER",
        paymentId: "PAY-WITH-ORDER",
      },
    );
    assert.equal(calls, 2);
    assert.equal(result.paymobOrderId, "7215999");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Paymob add-on intentions use the persisted attempt identity and callback URL", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: any;
  globalThis.fetch = (async (_url: any, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      id: "INT-ADDON-1",
      client_secret: "secret-addon-1",
      order_id: "ORDER-ADDON-1",
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await new PaymobService().initiateAddOnPayment(
      20,
      "PROP-1",
      "Property",
      "0500000000",
      "ADDON-1",
      "Addon",
      30,
      "cards",
      {
        merchantAttemptKey: "ATTEMPT-ADDON-1",
        paymentId: "PAY-ADDON-1",
      },
    );
    assert.equal(
      requestBody.notification_url,
      "https://rwqan.sa/api/paymob/webhook",
    );
    assert.equal(requestBody.special_reference, "ATTEMPT-ADDON-1");
    assert.equal(
      requestBody.extras.creation_extras.merchantAttemptKey,
      "ATTEMPT-ADDON-1",
    );
    assert.equal(
      requestBody.extras.creation_extras.paymentId,
      "PAY-ADDON-1",
    );
    assert.equal(result.intentionId, "INT-ADDON-1");
    assert.equal(result.paymobOrderId, "ORDER-ADDON-1");
    assert.match(result.checkoutUrl, /clientSecret=secret-addon-1$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Paymob add-on creation resolves an exact provider order before returning", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_url: any, init?: RequestInit) => {
    calls += 1;
    if (init?.method === "POST") {
      return new Response(JSON.stringify({
        id: "INT-ADDON-LOOKUP",
        client_secret: "secret-addon-lookup",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      id: "INT-ADDON-LOOKUP",
      special_reference: "ATTEMPT-ADDON-LOOKUP",
      order_id: "ORDER-ADDON-LOOKUP",
      intention_detail: { amount: 2_000, currency: "SAR" },
      confirmed: false,
      paid: false,
      is_card_expired: false,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await new PaymobService().initiateAddOnPayment(
      20,
      "PROP-1",
      "Property",
      "0500000000",
      "ADDON-1",
      "Addon",
      30,
      "cards",
      {
        merchantAttemptKey: "ATTEMPT-ADDON-LOOKUP",
        paymentId: "PAY-ADDON-LOOKUP",
      },
    );
    assert.equal(calls, 2);
    assert.equal(result.paymobOrderId, "ORDER-ADDON-LOOKUP");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Paymob add-on creation fails closed when provider order identity cannot be bound", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init?: RequestInit) => {
    if (init?.method === "POST") {
      return new Response(JSON.stringify({
        id: "INT-ADDON-UNBOUND",
        client_secret: "secret-addon-unbound",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      id: "INT-ADDON-UNBOUND",
      special_reference: "ATTEMPT-DIFFERENT",
      order_id: "ORDER-ADDON-UNBOUND",
      intention_detail: { amount: 2_000, currency: "SAR" },
      confirmed: false,
      paid: false,
      is_card_expired: false,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    await assert.rejects(
      new PaymobService().initiateAddOnPayment(
        20,
        "PROP-1",
        "Property",
        "0500000000",
        "ADDON-1",
        "Addon",
        30,
        "cards",
        {
          merchantAttemptKey: "ATTEMPT-ADDON-UNBOUND",
          paymentId: "PAY-ADDON-UNBOUND",
        },
      ),
      (error: any) =>
        error instanceof PaymobIntentionError &&
        error.certainty === "unknown" &&
        error.createdIntention?.intentionId === "INT-ADDON-UNBOUND",
    );
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

test("Paymob intention lookup validates the checkout capability and normalizes paid state", async () => {
  const originalFetch = globalThis.fetch;
  const previousHmacSecret = process.env.PAYMOB_HMAC_SECRET;
  const redirectData = {
    amount_cents: "4000",
    created_at: "2026-07-27T18:30:16.504636+03:00",
    currency: "SAR",
    error_occured: "false",
    has_parent_transaction: "false",
    id: "8063350",
    integration_id: "15647",
    is_3d_secure: "false",
    is_auth: "false",
    is_capture: "false",
    is_refunded: "false",
    is_standalone_payment: "true",
    is_voided: "false",
    order: "7215886",
    owner: "13029",
    pending: "false",
    "source_data.pan": "4090",
    "source_data.sub_type": "APPLE_PAY",
    "source_data.type": "apple pay",
    success: "true",
    merchant_order_id: "ATTEMPT-1",
  };
  const redirectHmac = calculatePaymobWebhookHmac(
    redirectData,
    "lookup-test-hmac-secret",
  );
  assert.ok(redirectHmac);
  const redirectUrl = new URL("https://rwqan.sa/api/paymob/webhook");
  for (const [key, value] of Object.entries(redirectData)) {
    redirectUrl.searchParams.set(key, value);
  }
  redirectUrl.searchParams.set("hmac", redirectHmac);
  let requestedUrl = "";
  globalThis.fetch = (async (url: any) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      id: "pi_live_1",
      special_reference: "ATTEMPT-1",
      order_id: 7215886,
      intention_detail: { amount: 4_000, currency: "sar" },
      confirmed: true,
      paid: true,
      paid_at: "2026-07-27T15:30:19.043665Z",
      is_card_expired: false,
      redirection_url: redirectUrl.toString(),
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    process.env.PAYMOB_HMAC_SECRET = "lookup-test-hmac-secret";
    const result = await new PaymobService().retrieveIntention(
      "https://ksa.paymob.com/unifiedcheckout/?publicKey=pk_test_1&clientSecret=secret-1",
    );
    assert.deepEqual(result, {
      ok: true,
      snapshot: {
        intentionId: "pi_live_1",
        specialReference: "ATTEMPT-1",
        orderId: "7215886",
        amountCents: 4_000,
        currency: "SAR",
        confirmed: true,
        paid: true,
        paidAt: "2026-07-27T15:30:19.043665Z",
        cardExpired: false,
        signedTransaction: {
          transactionId: "8063350",
          orderId: "7215886",
          merchantOrderId: "ATTEMPT-1",
          amountCents: 4_000,
          currency: "SAR",
          createdAt: "2026-07-27T18:30:16.504636+03:00",
          paymentMethod: "apple pay",
          cardSubType: "APPLE_PAY",
        },
      },
    });
    assert.equal(
      requestedUrl,
      "https://ksa.paymob.com/v1/intention/element/pk_test_1/secret-1/",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previousHmacSecret === undefined) delete process.env.PAYMOB_HMAC_SECRET;
    else process.env.PAYMOB_HMAC_SECRET = previousHmacSecret;
  }
});

test("Paymob intention lookup fails closed for foreign URLs, outages, and incomplete data", async () => {
  const originalFetch = globalThis.fetch;
  const service = new PaymobService();
  try {
    assert.deepEqual(
      await service.retrieveIntention(
        "https://example.com/unifiedcheckout/?publicKey=pk&clientSecret=secret",
      ),
      { ok: false, reason: "invalid_checkout_url" },
    );

    globalThis.fetch = (async () => new Response("unavailable", {
      status: 503,
    })) as typeof fetch;
    assert.deepEqual(
      await service.retrieveIntention(
        "https://ksa.paymob.com/unifiedcheckout/?publicKey=pk&clientSecret=secret",
      ),
      { ok: false, reason: "provider_unavailable" },
    );

    globalThis.fetch = (async () => new Response(JSON.stringify({
      id: "pi_live_1",
      paid: true,
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    assert.deepEqual(
      await service.retrieveIntention(
        "https://ksa.paymob.com/unifiedcheckout/?publicKey=pk&clientSecret=secret",
      ),
      { ok: false, reason: "invalid_response" },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Paymob intention lookup never exposes refunded, voided, or errored redirects as payable evidence", async () => {
  const originalFetch = globalThis.fetch;
  const previousHmacSecret = process.env.PAYMOB_HMAC_SECRET;
  const baseRedirectData = {
    amount_cents: "4000",
    created_at: "2026-07-27T18:30:16.504636+03:00",
    currency: "SAR",
    error_occured: "false",
    has_parent_transaction: "false",
    id: "8063350",
    integration_id: "15647",
    is_3d_secure: "false",
    is_auth: "false",
    is_capture: "false",
    is_refunded: "false",
    is_standalone_payment: "true",
    is_voided: "false",
    order: "7215886",
    owner: "13029",
    pending: "false",
    "source_data.pan": "4090",
    "source_data.sub_type": "APPLE_PAY",
    "source_data.type": "apple pay",
    success: "true",
    merchant_order_id: "ATTEMPT-1",
  };

  try {
    process.env.PAYMOB_HMAC_SECRET = "lookup-test-hmac-secret";
    for (const unsafeFlag of ["error_occured", "is_refunded", "is_voided"] as const) {
      const redirectData = { ...baseRedirectData, [unsafeFlag]: "true" };
      const redirectUrl = new URL("https://rwqan.sa/api/paymob/webhook");
      for (const [key, value] of Object.entries(redirectData)) {
        redirectUrl.searchParams.set(key, value);
      }
      redirectUrl.searchParams.set(
        "hmac",
        calculatePaymobWebhookHmac(
          redirectData,
          "lookup-test-hmac-secret",
        )!,
      );
      globalThis.fetch = (async () => new Response(JSON.stringify({
        id: "pi_live_1",
        special_reference: "ATTEMPT-1",
        order_id: 7215886,
        intention_detail: { amount: 4_000, currency: "SAR" },
        confirmed: true,
        paid: true,
        is_card_expired: false,
        redirection_url: redirectUrl.toString(),
      }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

      const result = await new PaymobService().retrieveIntention(
        "https://ksa.paymob.com/unifiedcheckout/?publicKey=pk&clientSecret=secret",
      );
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.snapshot.signedTransaction, undefined);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (previousHmacSecret === undefined) delete process.env.PAYMOB_HMAC_SECRET;
    else process.env.PAYMOB_HMAC_SECRET = previousHmacSecret;
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
