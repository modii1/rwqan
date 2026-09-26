import assert from "node:assert/strict";
import test from "node:test";

import { FirebaseService } from "./firebaseService";

type FakeData = Record<string, any>;

class FakeDocumentReference {
  constructor(
    readonly database: FakeFirestore,
    readonly collectionName: string,
    readonly id: string,
  ) {}

  async update(updates: FakeData): Promise<void> {
    this.database.update(this.collectionName, this.id, updates);
  }
}

class FakeDocumentSnapshot {
  constructor(
    readonly ref: FakeDocumentReference,
    private readonly value: FakeData | undefined,
  ) {}

  get exists(): boolean {
    return this.value !== undefined;
  }

  data(): FakeData | undefined {
    return this.value ? structuredClone(this.value) : undefined;
  }
}

class FakeTransaction {
  constructor(private readonly database: FakeFirestore) {}

  async get(ref: FakeDocumentReference): Promise<FakeDocumentSnapshot> {
    return new FakeDocumentSnapshot(
      ref,
      this.database.get(ref.collectionName, ref.id),
    );
  }

  update(ref: FakeDocumentReference, updates: FakeData): void {
    this.database.update(ref.collectionName, ref.id, updates);
  }
}

class FakeFirestore {
  private readonly documents = new Map<string, FakeData>();
  private transactionTail: Promise<void> = Promise.resolve();

  collection(name: string) {
    return {
      doc: (id: string) => new FakeDocumentReference(this, name, id),
    };
  }

  async runTransaction<T>(
    callback: (transaction: FakeTransaction) => Promise<T>,
  ): Promise<T> {
    let release!: () => void;
    const previous = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await callback(new FakeTransaction(this));
    } finally {
      release();
    }
  }

  set(collectionName: string, id: string, value: FakeData): void {
    this.documents.set(`${collectionName}/${id}`, structuredClone(value));
  }

  get(collectionName: string, id: string): FakeData | undefined {
    const value = this.documents.get(`${collectionName}/${id}`);
    return value ? structuredClone(value) : undefined;
  }

  update(collectionName: string, id: string, updates: FakeData): void {
    const key = `${collectionName}/${id}`;
    const current = this.documents.get(key);
    if (!current) throw new Error(`Missing fake document ${key}`);
    this.documents.set(key, { ...current, ...structuredClone(updates) });
  }
}

function createHarness() {
  const database = new FakeFirestore();
  database.set("owners", "12345", {
    ownerId: "12345",
    phone: "0551234567",
    password: "old-pin",
    resetCode: "",
    resetExpire: "",
    lastReset: "",
  });
  const service = new FirebaseService();
  Object.defineProperty(service, "db", { value: database });
  return { database, service };
}

test("owner reset code is purpose-bound, not stored raw, and consumed atomically once", async () => {
  const previousSecret = process.env.OWNER_ACCOUNT_HMAC_SECRET;
  process.env.OWNER_ACCOUNT_HMAC_SECRET =
    "owner-reset-test-secret-value-at-least-32-bytes";
  const { database, service } = createHarness();
  try {
    await service.updateOwnerResetCode(
      "12345",
      "123456",
      new Date(Date.now() + 10 * 60_000).toISOString(),
      new Date().toISOString(),
    );
    const stored = database.get("owners", "12345")!;
    assert.notEqual(stored.resetCode, "123456");
    assert.match(stored.resetCode, /^hmac-sha256:v1:[a-f0-9]{64}$/);
    assert.equal(stored.resetCodePurpose, "owner_password_reset");

    const results = await Promise.all([
      service.validateResetCode("12345", "123456"),
      service.validateResetCode("12345", "123456"),
    ]);
    assert.equal(results.filter((result) => result.valid).length, 1);
    assert.equal(results.filter((result) => !result.valid).length, 1);
    assert.equal(database.get("owners", "12345")?.resetCode, "");
  } finally {
    if (previousSecret === undefined) delete process.env.OWNER_ACCOUNT_HMAC_SECRET;
    else process.env.OWNER_ACCOUNT_HMAC_SECRET = previousSecret;
  }
});

test("owner reset code is burned after five invalid attempts", async () => {
  const previousSecret = process.env.OWNER_ACCOUNT_HMAC_SECRET;
  process.env.OWNER_ACCOUNT_HMAC_SECRET =
    "owner-reset-test-secret-value-at-least-32-bytes";
  const { database, service } = createHarness();
  try {
    await service.updateOwnerResetCode(
      "12345",
      "123456",
      new Date(Date.now() + 10 * 60_000).toISOString(),
      new Date().toISOString(),
    );
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await service.validateResetCode("12345", "000000");
      assert.equal(result.valid, false);
    }
    assert.equal(database.get("owners", "12345")?.resetCode, "");
    assert.equal(database.get("owners", "12345")?.resetCodeAttempts, 5);
    assert.equal(
      (await service.validateResetCode("12345", "123456")).valid,
      false,
    );
  } finally {
    if (previousSecret === undefined) delete process.env.OWNER_ACCOUNT_HMAC_SECRET;
    else process.env.OWNER_ACCOUNT_HMAC_SECRET = previousSecret;
  }
});

test("owner reset verification rejects a challenge stored for another purpose", async () => {
  const previousSecret = process.env.OWNER_ACCOUNT_HMAC_SECRET;
  process.env.OWNER_ACCOUNT_HMAC_SECRET =
    "owner-reset-test-secret-value-at-least-32-bytes";
  const { database, service } = createHarness();
  try {
    await service.updateOwnerResetCode(
      "12345",
      "123456",
      new Date(Date.now() + 10 * 60_000).toISOString(),
      new Date().toISOString(),
    );
    database.update("owners", "12345", {
      resetCodePurpose: "customer_phone_login",
    });
    assert.equal(
      (await service.validateResetCode("12345", "123456")).valid,
      false,
    );
  } finally {
    if (previousSecret === undefined) delete process.env.OWNER_ACCOUNT_HMAC_SECRET;
    else process.env.OWNER_ACCOUNT_HMAC_SECRET = previousSecret;
  }
});
