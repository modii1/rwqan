import assert from "node:assert/strict";
import test from "node:test";

import {
  FirebaseService,
  PaymentOwnerAccountConflictError,
} from "./firebaseService";

type FakeData = Record<string, any>;

class FakeDocumentReference {
  constructor(
    readonly database: FakeFirestore,
    readonly collectionName: string,
    readonly id: string,
  ) {}
}

class FakeQuery {
  constructor(
    readonly database: FakeFirestore,
    readonly collectionName: string,
    readonly field: string,
    readonly value: unknown,
  ) {}
}

class FakeDocumentSnapshot {
  constructor(
    readonly ref: FakeDocumentReference,
    private readonly value: FakeData | undefined,
  ) {}

  get id(): string {
    return this.ref.id;
  }

  get exists(): boolean {
    return this.value !== undefined;
  }

  data(): FakeData | undefined {
    return this.value ? structuredClone(this.value) : undefined;
  }
}

class FakeTransaction {
  constructor(private readonly database: FakeFirestore) {}

  async get(target: FakeDocumentReference | FakeQuery): Promise<any> {
    if (target instanceof FakeQuery) {
      return {
        docs: this.database
          .list(target.collectionName)
          .filter((entry) => entry.data[target.field] === target.value)
          .map((entry) => new FakeDocumentSnapshot(
            new FakeDocumentReference(
              this.database,
              target.collectionName,
              entry.id,
            ),
            entry.data,
          )),
      };
    }
    return new FakeDocumentSnapshot(
      target,
      this.database.get(target.collectionName, target.id),
    );
  }

  update(ref: FakeDocumentReference, updates: FakeData): void {
    this.database.update(ref.collectionName, ref.id, updates);
  }
}

class FakeFirestore {
  private readonly documents = new Map<string, FakeData>();

  collection(name: string) {
    return {
      doc: (id: string) => new FakeDocumentReference(this, name, id),
      where: (field: string, _operator: string, value: unknown) =>
        new FakeQuery(this, name, field, value),
    };
  }

  async runTransaction<T>(
    callback: (transaction: FakeTransaction) => Promise<T>,
  ): Promise<T> {
    return callback(new FakeTransaction(this));
  }

  set(collectionName: string, id: string, value: FakeData): void {
    this.documents.set(`${collectionName}/${id}`, structuredClone(value));
  }

  get(collectionName: string, id: string): FakeData | undefined {
    const value = this.documents.get(`${collectionName}/${id}`);
    return value ? structuredClone(value) : undefined;
  }

  list(collectionName: string): Array<{ id: string; data: FakeData }> {
    const prefix = `${collectionName}/`;
    return Array.from(this.documents.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, data]) => ({
        id: key.slice(prefix.length),
        data: structuredClone(data),
      }));
  }

  update(collectionName: string, id: string, updates: FakeData): void {
    const key = `${collectionName}/${id}`;
    const current = this.documents.get(key);
    if (!current) throw new Error(`Missing fake document ${key}`);
    this.documents.set(key, { ...current, ...structuredClone(updates) });
  }
}

const ACCOUNT_A = "A".repeat(43);
const ACCOUNT_B = "B".repeat(43);

function createHarness(options: {
  paymentOwnerAccountId?: string;
  secondOwnerAccountId: string;
}) {
  const database = new FakeFirestore();
  database.set("payments", "PAY-1", {
    id: "PAY-1",
    propertyNumber: "11111",
    ownerAccountId: options.paymentOwnerAccountId,
    packageId: "pkg",
    amount: 100,
    finalAmount: 100,
    status: "مكتمل",
    paymentMethod: "بطاقة",
    action: "new",
    additionalProperties: ["22222"],
  });
  database.set("owner_accounts", ACCOUNT_A, {
    id: ACCOUNT_A,
    status: "active",
  });
  database.set("owner_property_memberships", "11111", {
    propertyNumber: "11111",
    ownerAccountId: ACCOUNT_A,
    status: "active",
  });
  database.set("owner_property_memberships", "22222", {
    propertyNumber: "22222",
    ownerAccountId: options.secondOwnerAccountId,
    status: "active",
  });
  const service = new FirebaseService();
  Object.defineProperty(service, "db", { value: database });
  return { database, service };
}

test("delayed account-backed fulfillment rejects a target transferred to another account", async () => {
  const { database, service } = createHarness({
    paymentOwnerAccountId: ACCOUNT_A,
    secondOwnerAccountId: ACCOUNT_B,
  });
  await assert.rejects(
    () => service.claimPaymentFulfillment("PAY-1"),
    PaymentOwnerAccountConflictError,
  );
  assert.equal(
    database.get("payments", "PAY-1")?.fulfillmentState,
    undefined,
  );
});

test("delayed account-backed fulfillment rejects a membership revoked after checkout", async () => {
  const { database, service } = createHarness({
    paymentOwnerAccountId: ACCOUNT_A,
    secondOwnerAccountId: ACCOUNT_A,
  });
  database.update("owner_property_memberships", "22222", {
    status: "revoked",
  });

  await assert.rejects(
    () => service.claimPaymentFulfillment("PAY-1"),
    PaymentOwnerAccountConflictError,
  );
  assert.equal(
    database.get("payments", "PAY-1")?.fulfillmentState,
    undefined,
  );
});

test("legacy multi-property fulfillment rejects targets split across claimed accounts", async () => {
  const { database, service } = createHarness({
    secondOwnerAccountId: ACCOUNT_B,
  });
  await assert.rejects(
    () => service.claimPaymentFulfillment("PAY-1"),
    PaymentOwnerAccountConflictError,
  );
  assert.equal(
    database.get("payments", "PAY-1")?.fulfillmentState,
    undefined,
  );
});

test("account-backed fulfillment can claim when every target remains in the account", async () => {
  const { database, service } = createHarness({
    paymentOwnerAccountId: ACCOUNT_A,
    secondOwnerAccountId: ACCOUNT_A,
  });
  const result = await service.claimPaymentFulfillment("PAY-1");
  assert.equal(result.status, "claimed");
  assert.equal(database.get("payments", "PAY-1")?.fulfillmentState, "processing");
});
