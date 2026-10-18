import assert from "node:assert/strict";
import test from "node:test";

import { OwnerAccountService } from "./OwnerAccountService";
import { FirestoreOwnerAccountStore } from "./OwnerAccountStore";

type Data = Record<string, any>;

class FakeFirestore {
  private collections = new Map<string, Map<string, Data>>();
  private queue: Promise<void> = Promise.resolve();

  collection(name: string) { return new FakeCollection(this, name); }

  async runTransaction<T>(operation: (transaction: FakeTransaction) => Promise<T>) {
    const result = this.queue.then(() => operation(new FakeTransaction(this)));
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  get(collection: string, id: string) {
    const value = this.collections.get(collection)?.get(id);
    return value ? structuredClone(value) : undefined;
  }

  set(collection: string, id: string, value: Data, merge = false) {
    let target = this.collections.get(collection);
    if (!target) {
      target = new Map();
      this.collections.set(collection, target);
    }
    target.set(id, {
      ...(merge ? target.get(id) || {} : {}),
      ...structuredClone(value),
    });
  }

  delete(collection: string, id: string) {
    this.collections.get(collection)?.delete(id);
  }

  query(collection: string, field: string, value: unknown) {
    return [...(this.collections.get(collection)?.entries() || [])]
      .filter(([, data]) => data[field] === value)
      .map(([id]) => new FakeSnapshot(this, new FakeDocument(this, collection, id)));
  }
}

class FakeCollection {
  constructor(
    private database: FakeFirestore,
    private name: string,
  ) {}
  doc(id: string) { return new FakeDocument(this.database, this.name, id); }
  where(field: string, _operator: string, value: unknown) {
    return new FakeQuery(this.database, this.name, field, value);
  }
}

class FakeQuery {
  constructor(
    private database: FakeFirestore,
    private collection: string,
    private field: string,
    private value: unknown,
  ) {}
  async get() { return { docs: this.database.query(this.collection, this.field, this.value) }; }
}

class FakeDocument {
  constructor(
    readonly database: FakeFirestore,
    readonly collection: string,
    readonly id: string,
  ) {}
  async get() { return new FakeSnapshot(this.database, this); }
  async delete() { this.database.delete(this.collection, this.id); }
}

class FakeSnapshot {
  constructor(
    private database: FakeFirestore,
    readonly ref: FakeDocument,
  ) {}
  get exists() { return this.database.get(this.ref.collection, this.ref.id) !== undefined; }
  data() { return this.database.get(this.ref.collection, this.ref.id); }
}

class FakeTransaction {
  constructor(private database: FakeFirestore) {}
  async get(reference: FakeDocument | FakeQuery): Promise<any> {
    return reference instanceof FakeQuery
      ? reference.get()
      : new FakeSnapshot(this.database, reference);
  }
  set(reference: FakeDocument, value: Data) {
    this.database.set(reference.collection, reference.id, value);
  }
  create(reference: FakeDocument, value: Data) {
    if (this.database.get(reference.collection, reference.id)) {
      throw new Error("already exists");
    }
    this.database.set(reference.collection, reference.id, value);
  }
  update(reference: FakeDocument, value: Data) {
    if (!this.database.get(reference.collection, reference.id)) {
      throw new Error("missing document");
    }
    this.database.set(reference.collection, reference.id, value, true);
  }
}

function createFixture() {
  const database = new FakeFirestore();
  const store = new FirestoreOwnerAccountStore(
    () => database as unknown as FirebaseFirestore.Firestore,
  );
  let id = 0;
  const service = new OwnerAccountService(store, {
    secret: "o".repeat(32),
    now: () => 1_800_000_000_000,
    createCode: () => "123456",
    createOpaqueId: () => `${"Z".repeat(41)}${String(++id).padStart(2, "0")}`,
    sender: async () => ({ success: true }),
    propertyReader: async (propertyNumber) => ({
      propertyNumber,
      whatsappNumber: "0551234567",
    }),
  });
  return { database, store, service };
}

test("Firestore owner membership creation isolates concurrent property claims", async () => {
  const { database, service } = createFixture();
  const [first, second] = await Promise.all([
    service.issueClaim({ propertyNumber: "P-1", ipAddress: "127.0.0.1" }),
    service.issueClaim({ propertyNumber: "P-1", ipAddress: "127.0.0.2" }),
  ]);
  const results = await Promise.allSettled([
    service.verifyClaim({ challengeId: first.challengeId, code: "123456", propertyNumber: "P-1" }),
    service.verifyClaim({ challengeId: second.challengeId, code: "123456", propertyNumber: "P-1" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const membership = database.get("owner_property_memberships", "P-1");
  assert.equal(membership?.propertyNumber, "P-1");
  assert.match(membership?.ownerAccountId || "", /^[A-Za-z0-9_-]{43}$/);
  assert.equal("phone" in membership, false);
});

test("Firestore owner session validation rejects a revoked membership and stale auth version", async () => {
  const { database, store } = createFixture();
  const accountId = "A".repeat(43);
  const timestamp = "2026-09-26T00:00:00.000Z";
  database.set("owner_accounts", accountId, {
    id: accountId,
    schemaVersion: 1,
    phoneSubject: "b".repeat(64),
    authVersion: 4,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastLoginAt: null,
  });
  database.set("owner_property_memberships", "P-1", {
    schemaVersion: 1,
    ownerAccountId: accountId,
    propertyNumber: "P-1",
    status: "revoked",
    isPrimary: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    revokedAt: timestamp,
  });
  assert.equal(await store.validateActiveMembership({
    ownerAccountId: accountId,
    authVersion: 4,
    propertyNumber: "P-1",
  }), false);

  database.set("owner_property_memberships", "P-1", {
    ...database.get("owner_property_memberships", "P-1"),
    status: "active",
    revokedAt: null,
  });
  assert.equal(await store.validateActiveMembership({
    ownerAccountId: accountId,
    authVersion: 3,
    propertyNumber: "P-1",
  }), false);
  assert.equal(await store.validateActiveMembership({
    ownerAccountId: accountId,
    authVersion: 4,
    propertyNumber: "P-1",
  }), true);
});
