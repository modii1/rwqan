import assert from "node:assert/strict";
import test from "node:test";

import {
  PaymobIntentionError,
  PaymobService,
  type BookingCommissionIntentionInput,
} from "./paymob";

(process.env as Record<string, string | undefined>).NODE_ENV = "production";

const commissionInput: BookingCommissionIntentionInput = {
  amountCents: 12_345,
  bookingId: "BOOKING-1",
  attemptId: "COMMISSION-ATTEMPT-1",
  merchantAttemptKey: "RWQN-COMMISSION-ATTEMPT-1",
  propertyNumber: "PROP-1",
  propertyName: "Property",
  ownerPhone: "0500000000",
  paymentMethod: "cards",
};

test("booking commission intention uses integer halalas and isolated provider metadata", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestBody: any;
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    requestedUrl = String(url);
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      id: "INT-COMMISSION-1",
      client_secret: "secret-commission-1",
      order_id: "ORDER-COMMISSION-1",
      special_reference: commissionInput.merchantAttemptKey,
      intention_detail: {
        amount: commissionInput.amountCents,
        currency: "sar",
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await new PaymobService()
      .createBookingCommissionIntention(commissionInput);

    assert.equal(requestedUrl, "https://ksa.paymob.com/v1/intention/");
    assert.equal(requestBody.amount, 12_345);
    assert.equal(requestBody.currency, "SAR");
    assert.equal(
      requestBody.notification_url,
      "https://rwqan.sa/api/paymob/webhook",
    );
    assert.equal(requestBody.special_reference, commissionInput.merchantAttemptKey);
    assert.equal(requestBody.items[0].amount, 12_345);
    assert.deepEqual(requestBody.extras.creation_extras, {
      type: "booking_commission",
      bookingId: commissionInput.bookingId,
      attemptId: commissionInput.attemptId,
      propertyNumber: commissionInput.propertyNumber,
      merchantAttemptKey: commissionInput.merchantAttemptKey,
    });
    for (const forbiddenField of [
      "packageName",
      "days",
      "price",
      "addonId",
      "addonName",
      "paymentId",
    ]) {
      assert.equal(
        Object.hasOwn(requestBody.extras.creation_extras, forbiddenField),
        false,
      );
    }
    assert.equal(result.intentionId, "INT-COMMISSION-1");
    assert.equal(result.orderId, "ORDER-COMMISSION-1");
    assert.match(
      result.checkoutUrl,
      /^https:\/\/ksa\.paymob\.com\/unifiedcheckout\/\?publicKey=.*&clientSecret=secret-commission-1$/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("booking commission intention selects the Apple Pay integration explicitly", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: any;
  globalThis.fetch = (async (_url: any, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      id: "INT-COMMISSION-APPLEPAY",
      client_secret: "secret-commission-applepay",
      order_id: 7_215_999,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await new PaymobService().createBookingCommissionIntention({
      ...commissionInput,
      paymentMethod: "applepay",
    });
    assert.deepEqual(requestBody.payment_methods, [
      Number(process.env.PAYMOB_INTEGRATION_ID_APPLEPAY || "15649"),
    ]);
    assert.equal(result.orderId, "7215999");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("booking commission intention validates every local identity before network access", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("network must not be called");
  }) as typeof fetch;

  const invalidInputs: Array<Record<string, unknown>> = [
    { amountCents: 0 },
    { amountCents: 1.5 },
    { amountCents: Number.MAX_SAFE_INTEGER + 1 },
    { bookingId: " " },
    { attemptId: " " },
    { merchantAttemptKey: " " },
    { propertyNumber: " " },
    { ownerPhone: " " },
    { paymentMethod: "bank" },
  ];

  try {
    for (const invalid of invalidInputs) {
      await assert.rejects(
        new PaymobService().createBookingCommissionIntention({
          ...commissionInput,
          ...invalid,
        } as BookingCommissionIntentionInput),
        (error: any) =>
          error instanceof PaymobIntentionError &&
          error.certainty === "rejected",
      );
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("booking commission intention uses a nonempty provider fallback for a legacy blank property name", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: any;
  globalThis.fetch = (async (_url: any, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      id: "INT-COMMISSION-NAME-FALLBACK",
      client_secret: "secret-name-fallback",
      order_id: "ORDER-COMMISSION-NAME-FALLBACK",
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    await new PaymobService().createBookingCommissionIntention({
      ...commissionInput,
      propertyName: "   ",
    });
    assert.equal(requestBody.billing_data.first_name, "بدون اسم");
    assert.equal(requestBody.customer.first_name, "بدون اسم");
    assert.match(requestBody.items[0].name, /بدون اسم/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("booking commission intention rejects conflicting provider echoes", async () => {
  const originalFetch = globalThis.fetch;
  const conflicts = [
    { special_reference: "DIFFERENT-ATTEMPT" },
    { intention_detail: { amount: 12_346, currency: "SAR" } },
    { intention_detail: { amount: "not-an-integer", currency: "SAR" } },
    { intention_detail: { amount: 12_345, currency: "USD" } },
  ];

  try {
    for (const conflict of conflicts) {
      globalThis.fetch = (async () => new Response(JSON.stringify({
        id: "INT-COMMISSION-CONFLICT",
        client_secret: "secret-commission-conflict",
        order_id: "ORDER-COMMISSION-CONFLICT",
        special_reference: commissionInput.merchantAttemptKey,
        intention_detail: {
          amount: commissionInput.amountCents,
          currency: "SAR",
        },
        ...conflict,
      }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

      await assert.rejects(
        new PaymobService().createBookingCommissionIntention(commissionInput),
        (error: any) =>
          error instanceof PaymobIntentionError &&
          error.certainty === "unknown" &&
          error.createdIntention?.intentionId === "INT-COMMISSION-CONFLICT" &&
          error.createdIntention?.paymobOrderId === "ORDER-COMMISSION-CONFLICT",
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("booking commission intention resolves and verifies a missing provider order", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_url: any, init?: RequestInit) => {
    calls += 1;
    if (init?.method === "POST") {
      return new Response(JSON.stringify({
        id: "INT-COMMISSION-LOOKUP",
        client_secret: "secret-commission-lookup",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      id: "INT-COMMISSION-LOOKUP",
      special_reference: commissionInput.merchantAttemptKey,
      order_id: "ORDER-COMMISSION-LOOKUP",
      intention_detail: {
        amount: commissionInput.amountCents,
        currency: "SAR",
      },
      confirmed: false,
      paid: false,
      is_card_expired: false,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    const result = await new PaymobService()
      .createBookingCommissionIntention(commissionInput);
    assert.equal(calls, 2);
    assert.equal(result.orderId, "ORDER-COMMISSION-LOOKUP");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("booking commission intention fails closed when its provider order cannot be bound", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init?: RequestInit) => {
    if (init?.method === "POST") {
      return new Response(JSON.stringify({
        id: "INT-COMMISSION-UNBOUND",
        client_secret: "secret-commission-unbound",
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      id: "INT-COMMISSION-UNBOUND",
      special_reference: "DIFFERENT-ATTEMPT",
      order_id: "ORDER-COMMISSION-UNBOUND",
      intention_detail: {
        amount: commissionInput.amountCents,
        currency: "SAR",
      },
      confirmed: false,
      paid: false,
      is_card_expired: false,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  try {
    await assert.rejects(
      new PaymobService().createBookingCommissionIntention(commissionInput),
      (error: any) =>
        error instanceof PaymobIntentionError &&
        error.certainty === "unknown" &&
        error.createdIntention?.intentionId === "INT-COMMISSION-UNBOUND" &&
        error.createdIntention?.paymobOrderId === undefined,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
