import assert from "node:assert/strict";
import test from "node:test";
import {
  WhatsAppPendingDeliveryStore,
} from "./WhatsAppPendingDeliveryStore";
import type {
  WhatsAppDeliveryReceiptTarget,
  WhatsAppProviderDeliveryEvent,
} from "./WhatsAppDeliveryService";

function clone<T>(value: T): T {
  return structuredClone(value);
}

class FakeDocument {
  constructor(
    private readonly rows: Map<string, Record<string, unknown>>,
    readonly key: string,
  ) {}

  async get() {
    const value = this.rows.get(this.key);
    const snapshot = value ? clone(value) : undefined;
    return { exists: Boolean(snapshot), data: () => snapshot };
  }

  set(value: Record<string, unknown>) {
    this.rows.set(this.key, clone(value));
  }

  update(value: Record<string, unknown>) {
    const current = this.rows.get(this.key);
    if (!current) throw new Error("missing document");
    this.rows.set(this.key, { ...current, ...clone(value) });
  }

  delete() {
    this.rows.delete(this.key);
  }
}

class FakeFirestore {
  readonly rows = new Map<string, Record<string, unknown>>();

  collection(name: string) {
    return {
      doc: (id: string) => new FakeDocument(this.rows, `${name}/${id}`),
    };
  }

  async runTransaction<T>(
    update: (transaction: {
      get: (reference: FakeDocument) => ReturnType<FakeDocument["get"]>;
      set: (reference: FakeDocument, value: Record<string, unknown>) => void;
      update: (reference: FakeDocument, value: Record<string, unknown>) => void;
      delete: (reference: FakeDocument) => void;
    }) => Promise<T>,
  ): Promise<T> {
    return update({
      get: (reference) => reference.get(),
      set: (reference, value) => reference.set(value),
      update: (reference, value) => reference.update(value),
      delete: (reference) => reference.delete(),
    });
  }
}

function deliveryEvent(
  eventId: string,
  status: WhatsAppProviderDeliveryEvent["status"] = "delivered",
): WhatsAppProviderDeliveryEvent {
  return {
    providerMessageId: "wamid.early-callback",
    status,
    occurredAt: "2026-09-26T10:00:00.000Z",
    eventId,
  };
}

test("pending delivery receipts are deduplicated, bounded, and TTL-backed", async () => {
  const database = new FakeFirestore();
  const store = new WhatsAppPendingDeliveryStore(database as never);
  const now = new Date("2026-09-26T10:00:00.000Z");

  assert.equal(await store.enqueue(deliveryEvent("event-0"), now), "stored");
  assert.equal(await store.enqueue(deliveryEvent("event-0"), now), "duplicate");
  for (let index = 1; index < 25; index++) {
    assert.equal(
      await store.enqueue(deliveryEvent(`event-${index}`), now),
      "stored",
    );
  }

  assert.equal(database.rows.size, 1);
  const document = [...database.rows.values()][0] as {
    events: Array<{ event: WhatsAppProviderDeliveryEvent }>;
    expiresAtTtl: Date;
  };
  assert.equal(document.events.length, 20);
  assert.equal(document.events[0]?.event.eventId, "event-5");
  assert.equal(document.events[19]?.event.eventId, "event-24");
  assert.equal(
    document.expiresAtTtl.toISOString(),
    "2026-10-03T10:00:00.000Z",
  );
});

test("an early unmatched receipt is retained and applied once after persistence", async () => {
  const database = new FakeFirestore();
  const store = new WhatsAppPendingDeliveryStore(database as never);
  const event = deliveryEvent("event-race", "read");
  let outboundPersisted = false;
  let calls = 0;
  const target: WhatsAppDeliveryReceiptTarget = {
    async recordProviderDeliveryEvent(received) {
      calls += 1;
      assert.deepEqual(received, event);
      return outboundPersisted
        ? { result: "updated", jobId: "JOB-1" }
        : { result: "not_found" };
    },
  };

  await store.enqueue(event, new Date("2026-09-26T10:01:00.000Z"));
  const early = await store.reconcile(event.providerMessageId, target);
  assert.equal(early.length, 1);
  assert.match(early[0]?.key || "", /^[a-f0-9]{64}$/);
  assert.deepEqual(early[0]?.outcome, { result: "not_found" });
  assert.equal(database.rows.size, 1);

  outboundPersisted = true;
  const applied = await store.reconcile(event.providerMessageId, target);
  assert.equal(applied.length, 1);
  assert.deepEqual(applied[0]?.outcome, {
    result: "updated",
    jobId: "JOB-1",
  });
  assert.equal(database.rows.size, 0);
  assert.equal(calls, 2);

  assert.deepEqual(await store.reconcile(event.providerMessageId, target), []);
  assert.equal(calls, 2);
});
