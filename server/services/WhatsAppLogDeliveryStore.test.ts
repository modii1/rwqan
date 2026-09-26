import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGeneralWhatsAppLog,
  WhatsAppLogDeliveryStore,
} from "./WhatsAppLogDeliveryStore";

type FakeData = Record<string, any>;

class FakeFirestore {
  private readonly documents = new Map<string, Map<string, FakeData>>();

  collection(name: string) {
    return {
      where: (field: string, operator: string, value: unknown) => {
        assert.equal(operator, "==");
        return {
          limit: (maximum: number) => ({
            get: async () => {
              const matches = [...(this.documents.get(name)?.entries() || [])]
                .filter(([, data]) => data[field] === value)
                .slice(0, maximum)
                .map(([id]) => new FakeSnapshot(
                  new FakeDocumentReference(this, name, id),
                ));
              return {
                empty: matches.length === 0,
                size: matches.length,
                docs: matches,
              };
            },
          }),
        };
      },
    };
  }

  async runTransaction<T>(
    operation: (transaction: FakeTransaction) => Promise<T>,
  ): Promise<T> {
    return operation(new FakeTransaction(this));
  }

  seed(collection: string, id: string, value: FakeData): void {
    let records = this.documents.get(collection);
    if (!records) {
      records = new Map();
      this.documents.set(collection, records);
    }
    records.set(id, { ...value });
  }

  read(collection: string, id: string): FakeData | undefined {
    const value = this.documents.get(collection)?.get(id);
    return value ? { ...value } : undefined;
  }

  update(collection: string, id: string, updates: FakeData): void {
    const existing = this.read(collection, id);
    if (!existing) throw new Error(`Missing ${collection}/${id}`);
    this.seed(collection, id, { ...existing, ...updates });
  }
}

class FakeDocumentReference {
  constructor(
    readonly database: FakeFirestore,
    readonly collectionName: string,
    readonly id: string,
  ) {}
}

class FakeSnapshot {
  constructor(readonly ref: FakeDocumentReference) {}

  get exists(): boolean {
    return Boolean(this.ref.database.read(this.ref.collectionName, this.ref.id));
  }

  data(): FakeData | undefined {
    return this.ref.database.read(this.ref.collectionName, this.ref.id);
  }
}

class FakeTransaction {
  constructor(private readonly database: FakeFirestore) {}

  async get(ref: FakeDocumentReference): Promise<FakeSnapshot> {
    return new FakeSnapshot(ref);
  }

  update(ref: FakeDocumentReference, updates: FakeData): void {
    this.database.update(ref.collectionName, ref.id, updates);
  }
}

function createStore(database: FakeFirestore): WhatsAppLogDeliveryStore {
  return new WhatsAppLogDeliveryStore(database as any);
}

test("general WhatsApp logs preserve transport acceptance separately from delivery", () => {
  const log = buildGeneralWhatsAppLog({
    type: "owner_subscription_expired",
    message: "test message",
    phone: "966500000000",
    status: "success",
    providerStatus: "accepted",
    providerMessageId: "wamid.general-1",
    propertyNumber: "10001",
  }, new Date("2026-09-26T09:00:00.000Z"));

  assert.equal(log.status, "success");
  assert.equal(log.providerMessageId, "wamid.general-1");
  assert.equal(log.providerDeliveryStatus, "accepted");
  assert.equal(log.providerAcceptedAt, "2026-09-26T09:00:00.000Z");
  assert.equal(log.providerDeliveredAt, null);
  assert.equal(log.providerReadAt, null);
  assert.match(log.id, /^WA-1790413200000-/);
});

test("general WhatsApp delivery receipts are idempotent and monotonic", async () => {
  const database = new FakeFirestore();
  database.seed("whatsapp_logs", "WA-1", {
    ...buildGeneralWhatsAppLog({
      type: "owner_property_message",
      message: "test",
      phone: "966500000000",
      status: "success",
      providerStatus: "accepted",
      providerMessageId: "wamid.general-2",
    }, new Date("2026-09-26T09:00:00.000Z")),
    id: "WA-1",
  });
  const store = createStore(database);

  const delivered = {
    providerMessageId: "wamid.general-2",
    status: "delivered" as const,
    occurredAt: "2026-09-26T09:01:00.000Z",
    eventId: "delivery-one",
  };
  assert.deepEqual(
    await store.recordProviderDeliveryEvent(
      delivered,
      new Date("2026-09-26T09:01:01.000Z"),
    ),
    { result: "updated", logId: "WA-1" },
  );
  assert.equal(
    database.read("whatsapp_logs", "WA-1")?.providerDeliveryStatus,
    "delivered",
  );
  assert.equal(
    database.read("whatsapp_logs", "WA-1")?.providerDeliveredAt,
    "2026-09-26T09:01:00.000Z",
  );

  assert.deepEqual(
    await store.recordProviderDeliveryEvent(delivered),
    { result: "duplicate", logId: "WA-1" },
  );
  assert.deepEqual(await store.recordProviderDeliveryEvent({
    providerMessageId: "wamid.general-2",
    status: "accepted",
    occurredAt: "2026-09-26T09:00:30.000Z",
  }), { result: "stale", logId: "WA-1" });

  assert.deepEqual(await store.recordProviderDeliveryEvent({
    providerMessageId: "wamid.general-2",
    status: "read",
    occurredAt: "2026-09-26T09:02:00.000Z",
  }), { result: "updated", logId: "WA-1" });
  const readLog = database.read("whatsapp_logs", "WA-1");
  assert.equal(readLog?.providerDeliveryStatus, "read");
  assert.equal(readLog?.providerReadAt, "2026-09-26T09:02:00.000Z");
  assert.equal(readLog?.providerDeliveryEventKeys.length, 2);
});

test("general WhatsApp failures retain a bounded provider error", async () => {
  const database = new FakeFirestore();
  database.seed("whatsapp_logs", "WA-failure", {
    ...buildGeneralWhatsAppLog({
      type: "admin_manual_owner",
      message: "test",
      phone: "966500000000",
      status: "success",
      providerStatus: "accepted",
      providerMessageId: "wamid.general-failure",
    }),
    id: "WA-failure",
  });
  const store = createStore(database);

  assert.deepEqual(await store.recordProviderDeliveryEvent({
    providerMessageId: "wamid.general-failure",
    status: "failed",
    occurredAt: "2026-09-26T10:00:00.000Z",
    error: "x".repeat(700),
  }), { result: "updated", logId: "WA-failure" });
  const failedLog = database.read("whatsapp_logs", "WA-failure");
  assert.equal(failedLog?.providerDeliveryStatus, "failed");
  assert.equal(failedLog?.providerFailedAt, "2026-09-26T10:00:00.000Z");
  assert.equal(failedLog?.providerDeliveryError.length, 500);
});

test("general WhatsApp receipt lookup fails closed on duplicate provider ids", async () => {
  const database = new FakeFirestore();
  for (const id of ["WA-a", "WA-b"]) {
    database.seed("whatsapp_logs", id, {
      id,
      providerMessageId: "duplicate-provider-id",
      providerDeliveryStatus: "accepted",
      providerDeliveryEventKeys: [],
    });
  }
  const store = createStore(database);
  assert.deepEqual(await store.recordProviderDeliveryEvent({
    providerMessageId: "duplicate-provider-id",
    status: "delivered",
    occurredAt: "2026-09-26T10:00:00.000Z",
  }), { result: "conflict" });
});
