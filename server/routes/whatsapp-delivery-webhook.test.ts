import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  captureWhatsAppWebhookRawBody,
  createRoutingWhatsAppDeliveryReceiptStore,
  createWhatsAppDeliveryWebhookRouter,
} from "./whatsapp-delivery-webhook";
import {
  parseWhatsAppProviderDeliveryEvents,
  whatsappProviderDeliveryEventKey,
  type WhatsAppDeliveryReceiptTarget,
  type WhatsAppProviderDeliveryEvent,
} from "../services/WhatsAppDeliveryService";
import type {
  PendingDeliveryReconciliation,
  WhatsAppPendingDeliveryStoreContract,
} from "../services/WhatsAppPendingDeliveryStore";

const WEBHOOK_SECRET = "delivery-test-secret-at-least-32-bytes";
const META_APP_SECRET = "meta-app-secret-at-least-32-bytes-123";
const META_VERIFY_TOKEN = "meta-verify-token-at-least-32-bytes";

async function withServer(
  router: express.Router,
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use(express.json({ verify: captureWhatsAppWebhookRawBody }));
  app.use(router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function metaSignature(body: string): string {
  return `sha256=${createHmac("sha256", META_APP_SECRET)
    .update(body)
    .digest("hex")}`;
}

function createMemoryPendingStore(): WhatsAppPendingDeliveryStoreContract & {
  size(): number;
} {
  const pending = new Map<string, WhatsAppProviderDeliveryEvent>();
  return {
    async enqueue(event) {
      const key = whatsappProviderDeliveryEventKey(event);
      if (pending.has(key)) return "duplicate";
      pending.set(key, event);
      return "stored";
    },
    async reconcile(providerMessageId, target, now) {
      const outcomes: PendingDeliveryReconciliation[] = [];
      for (const [key, event] of pending) {
        if (event.providerMessageId !== providerMessageId) continue;
        const outcome = await target.recordProviderDeliveryEvent(event, now);
        outcomes.push({ key, outcome });
        if (outcome.result !== "not_found" && outcome.result !== "conflict") {
          pending.delete(key);
        }
      }
      return outcomes;
    },
    size: () => pending.size,
  };
}

test("delivery parser supports Meta statuses without treating sent as delivered", () => {
  const events = parseWhatsAppProviderDeliveryEvents({
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        value: {
          statuses: [
            { id: "wamid.meta-1", status: "sent", timestamp: "1780000000" },
            { id: "wamid.meta-1", status: "delivered", timestamp: "1780000001" },
            { id: "wamid.meta-1", status: "read", timestamp: "1780000002" },
          ],
        },
      }],
    }],
  }, new Date("2026-05-27T00:00:00.000Z"));

  assert.deepEqual(events.map(({ providerMessageId, status }) => ({
    providerMessageId,
    status,
  })), [
    { providerMessageId: "wamid.meta-1", status: "accepted" },
    { providerMessageId: "wamid.meta-1", status: "delivered" },
    { providerMessageId: "wamid.meta-1", status: "read" },
  ]);
});

test("delivery parser handles common Enjazatik callbacks and deduplicates a batch", () => {
  const callback = {
    event_id: "event-1",
    message_id: "enjaz-message-1",
    delivery_status: "failed",
    occurred_at: "2026-09-26T09:30:00.000Z",
    reason: "invalid destination",
  };
  const events = parseWhatsAppProviderDeliveryEvents({
    events: [callback, { ...callback }],
  });

  assert.deepEqual(events, [{
    providerMessageId: "enjaz-message-1",
    status: "failed",
    occurredAt: "2026-09-26T09:30:00.000Z",
    eventId: "event-1",
    error: "invalid destination",
  }]);
  assert.deepEqual(parseWhatsAppProviderDeliveryEvents({
    messages: [{ id: "wamid.inbound-message", from: "966500000000" }],
  }), []);
});

test("delivery parser only accepts status records in documented relay envelopes", () => {
  const receivedAt = new Date("2026-09-26T09:40:00.000Z");

  assert.deepEqual(parseWhatsAppProviderDeliveryEvents({
    meta: { id: "not-a-provider-message", status: "success" },
  }, receivedAt), []);
  assert.deepEqual(parseWhatsAppProviderDeliveryEvents({
    payload: { id: "relay-message-2", status: "delivered" },
  }, receivedAt), [{
    providerMessageId: "relay-message-2",
    status: "delivered",
    occurredAt: receivedAt.toISOString(),
  }]);
});

test("delivery parser falls back safely for out-of-range provider timestamps", () => {
  const receivedAt = new Date("2026-09-26T09:45:00.000Z");
  const events = parseWhatsAppProviderDeliveryEvents({
    message_id: "enjaz-message-out-of-range",
    status: "delivered",
    timestamp: Number.MAX_VALUE,
  }, receivedAt);

  assert.equal(events.length, 1);
  assert.equal(events[0]?.occurredAt, receivedAt.toISOString());
});

test("Meta webhook verification echoes the challenge only for the configured token", async () => {
  const router = createWhatsAppDeliveryWebhookRouter({
    metaVerifyToken: META_VERIFY_TOKEN,
    store: {
      async recordProviderDeliveryEvent() {
        return { result: "updated" };
      },
    },
  });

  await withServer(router, async (baseUrl) => {
    const accepted = await fetch(
      `${baseUrl}/api/webhooks/whatsapp/delivery?${new URLSearchParams({
        "hub.mode": "subscribe",
        "hub.verify_token": META_VERIFY_TOKEN,
        "hub.challenge": "123456789",
      })}`,
    );
    assert.equal(accepted.status, 200);
    assert.match(accepted.headers.get("content-type") || "", /^text\/plain/);
    assert.equal(await accepted.text(), "123456789");

    const rejected = await fetch(
      `${baseUrl}/api/webhooks/whatsapp/delivery?${new URLSearchParams({
        "hub.mode": "subscribe",
        "hub.verify_token": "incorrect-token",
        "hub.challenge": "must-not-be-echoed",
      })}`,
    );
    assert.equal(rejected.status, 403);
  });
});

test("delivery webhook accepts a valid Meta X-Hub-Signature-256 over exact bytes", async () => {
  const received: WhatsAppProviderDeliveryEvent[] = [];
  const router = createWhatsAppDeliveryWebhookRouter({
    secret: "",
    metaAppSecret: META_APP_SECRET,
    store: {
      async recordProviderDeliveryEvent(event) {
        received.push(event);
        return { result: "updated" };
      },
    },
  });

  await withServer(router, async (baseUrl) => {
    const body = '{ "object": "whatsapp_business_account", "entry": [{ "changes": [{ "value": { "statuses": [{ "id": "wamid.signed-meta-1", "status": "delivered" }] } }] }] }';
    const response = await fetch(`${baseUrl}/api/webhooks/whatsapp/delivery`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": metaSignature(body),
      },
      body,
    });

    assert.equal(response.status, 200);
    assert.equal(received.length, 1);
    assert.equal(received[0]?.providerMessageId, "wamid.signed-meta-1");
    assert.equal(received[0]?.status, "delivered");
  });
});

test("delivery webhook acknowledges authenticated inbound Meta messages without recording a receipt", async () => {
  let calls = 0;
  const router = createWhatsAppDeliveryWebhookRouter({
    secret: "",
    metaAppSecret: META_APP_SECRET,
    store: {
      async recordProviderDeliveryEvent() {
        calls += 1;
        return { result: "updated" };
      },
    },
  });

  await withServer(router, async (baseUrl) => {
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{
        changes: [{
          field: "messages",
          value: {
            messages: [{
              id: "wamid.inbound-message-1",
              from: "966500000000",
              type: "text",
            }],
          },
        }],
      }],
    });
    const response = await fetch(`${baseUrl}/api/webhooks/whatsapp/delivery`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": metaSignature(body),
      },
      body,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      retryable: false,
      received: 0,
      updated: 0,
      duplicate: 0,
      stale: 0,
      not_found: 0,
      conflict: 0,
      queued: 0,
    });
    assert.equal(calls, 0);
  });
});

test("delivery webhook rejects a Meta signature made for different request bytes", async () => {
  let calls = 0;
  const router = createWhatsAppDeliveryWebhookRouter({
    secret: "",
    metaAppSecret: META_APP_SECRET,
    store: {
      async recordProviderDeliveryEvent() {
        calls += 1;
        return { result: "updated" };
      },
    },
  });

  await withServer(router, async (baseUrl) => {
    const signedBody = JSON.stringify({
      message_id: "wamid.signed-meta-2",
      status: "delivered",
    });
    const alteredBody = JSON.stringify({
      message_id: "wamid.signed-meta-2",
      status: "read",
    });
    const response = await fetch(`${baseUrl}/api/webhooks/whatsapp/delivery`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": metaSignature(signedBody),
      },
      body: alteredBody,
    });

    assert.equal(response.status, 401);
    assert.equal(calls, 0);
  });
});

test("delivery webhook rejects missing or invalid authentication", async () => {
  let calls = 0;
  const router = createWhatsAppDeliveryWebhookRouter({
    secret: WEBHOOK_SECRET,
    store: {
      async recordProviderDeliveryEvent() {
        calls++;
        return { result: "updated" };
      },
    },
  });
  await withServer(router, async (baseUrl) => {
    const body = JSON.stringify({
      message_id: "enjaz-message-1",
      status: "delivered",
    });
    const missing = await fetch(`${baseUrl}/api/webhooks/whatsapp/delivery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    assert.equal(missing.status, 401);
    const invalid = await fetch(`${baseUrl}/api/webhooks/whatsapp/delivery`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong-secret-that-is-still-not-valid",
      },
      body,
    });
    assert.equal(invalid.status, 401);
    assert.equal(calls, 0);
  });
});

test("delivery webhook accepts bearer auth and summarizes idempotent outcomes", async () => {
  const received: WhatsAppProviderDeliveryEvent[] = [];
  const router = createWhatsAppDeliveryWebhookRouter({
    secret: WEBHOOK_SECRET,
    now: () => new Date("2026-09-26T10:00:00.000Z"),
    store: {
      async recordProviderDeliveryEvent(event) {
        received.push(event);
        return {
          result: received.length === 1 ? "updated" : "duplicate",
          jobId: "JOB-1",
        };
      },
    },
  });
  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/webhooks/whatsapp/delivery`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${WEBHOOK_SECRET}`,
      },
      body: JSON.stringify({
        events: [
          { message_id: "message-1", status: "delivered", event_id: "one" },
          { message_id: "message-2", status: "read", event_id: "two" },
        ],
      }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      retryable: false,
      received: 2,
      updated: 1,
      duplicate: 1,
      stale: 0,
      not_found: 0,
      conflict: 0,
      queued: 0,
    });
    assert.equal(received[0]?.occurredAt, "2026-09-26T10:00:00.000Z");
  });
});

test("delivery webhook durably queues receipts that arrive before send persistence", async () => {
  let calls = 0;
  let outboundPersisted = false;
  const pendingStore = createMemoryPendingStore();
  const store: WhatsAppDeliveryReceiptTarget = {
    async recordProviderDeliveryEvent() {
      calls += 1;
      return outboundPersisted
        ? { result: "updated", jobId: "JOB-1" }
        : { result: "not_found" };
    },
  };
  const router = createWhatsAppDeliveryWebhookRouter({
    secret: WEBHOOK_SECRET,
    store,
    pendingStore,
  });

  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/webhooks/whatsapp/delivery`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${WEBHOOK_SECRET}`,
      },
      body: JSON.stringify({
        message_id: "message-before-outbox-commit",
        status: "delivered",
      }),
    });

    assert.equal(response.status, 202);
    assert.equal(response.headers.get("retry-after"), null);
    assert.deepEqual(await response.json(), {
      ok: true,
      retryable: false,
      received: 1,
      updated: 0,
      duplicate: 0,
      stale: 0,
      not_found: 1,
      conflict: 0,
      queued: 1,
    });
    assert.equal(calls, 2);
    assert.equal(pendingStore.size(), 1);

    outboundPersisted = true;
    const replayed = await pendingStore.reconcile(
      "message-before-outbox-commit",
      store,
    );
    assert.deepEqual(replayed.map(({ outcome }) => outcome), [{
      result: "updated",
      jobId: "JOB-1",
    }]);
    assert.equal(pendingStore.size(), 0);
  });
});

test("a mixed delivery batch persists unmatched receipts without retrying matched ones", async () => {
  const pendingStore = createMemoryPendingStore();
  const router = createWhatsAppDeliveryWebhookRouter({
    secret: WEBHOOK_SECRET,
    store: {
      async recordProviderDeliveryEvent(event) {
        return event.providerMessageId === "already-persisted"
          ? { result: "updated" }
          : { result: "not_found" };
      },
    },
    pendingStore,
  });

  await withServer(router, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/webhooks/whatsapp/delivery`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${WEBHOOK_SECRET}`,
      },
      body: JSON.stringify({
        events: [
          { message_id: "already-persisted", status: "delivered" },
          { message_id: "not-persisted-yet", status: "delivered" },
        ],
      }),
    });

    assert.equal(response.status, 202);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body.updated, 1);
    assert.equal(body.not_found, 1);
    assert.equal(body.queued, 1);
    assert.equal(body.retryable, false);
    assert.equal(pendingStore.size(), 1);
  });
});

test("delivery receipt routing falls back from booking outbox to general logs", async () => {
  const calls: string[] = [];
  const store = createRoutingWhatsAppDeliveryReceiptStore({
    bookingStore: {
      async recordProviderDeliveryEvent() {
        calls.push("booking");
        return { result: "not_found" };
      },
    },
    generalLogStore: {
      async recordProviderDeliveryEvent() {
        calls.push("general");
        return { result: "updated" };
      },
    },
  });

  assert.deepEqual(await store.recordProviderDeliveryEvent({
    providerMessageId: "general-message",
    status: "delivered",
    occurredAt: "2026-09-26T10:00:00.000Z",
  }), { result: "updated" });
  assert.deepEqual(calls, ["booking", "general"]);
});

test("delivery receipt routing never mutates general logs for a booking match", async () => {
  let generalCalls = 0;
  const store = createRoutingWhatsAppDeliveryReceiptStore({
    bookingStore: {
      async recordProviderDeliveryEvent() {
        return { result: "duplicate", jobId: "JOB-1" };
      },
    },
    generalLogStore: {
      async recordProviderDeliveryEvent() {
        generalCalls += 1;
        return { result: "updated" };
      },
    },
  });

  assert.deepEqual(await store.recordProviderDeliveryEvent({
    providerMessageId: "booking-message",
    status: "delivered",
    occurredAt: "2026-09-26T10:00:00.000Z",
  }), { result: "duplicate", jobId: "JOB-1" });
  assert.equal(generalCalls, 0);
});
