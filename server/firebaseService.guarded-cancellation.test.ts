import assert from "node:assert/strict";
import test from "node:test";

import {
  FirebaseService,
  PaymentActionConflictError,
  PaymentActionEligibilityError,
  PaymentRetryNotAllowedError,
} from "./firebaseService";

type FakeData = Record<string, any>;

class FakeFirestore {
  private readonly collections = new Map<string, Map<string, FakeData>>();
  private transactionQueue: Promise<void> = Promise.resolve();

  constructor(readonly enforceReadBeforeWrite = false) {}

  collection(name: string) {
    return new FakeCollectionReference(this, name);
  }

  async runTransaction<T>(
    operation: (transaction: FakeTransaction) => Promise<T>,
  ): Promise<T> {
    const result = this.transactionQueue.then(() =>
      operation(new FakeTransaction(this)),
    );
    this.transactionQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  set(collectionName: string, id: string, data: FakeData): void {
    let collection = this.collections.get(collectionName);
    if (!collection) {
      collection = new Map();
      this.collections.set(collectionName, collection);
    }
    collection.set(id, { ...data });
  }

  get(collectionName: string, id: string): FakeData | undefined {
    return this.collections.get(collectionName)?.get(id);
  }

  update(collectionName: string, id: string, updates: FakeData): void {
    const existing = this.get(collectionName, id);
    if (!existing) throw new Error(`Missing fake document ${collectionName}/${id}`);
    this.set(collectionName, id, { ...existing, ...updates });
  }

  delete(collectionName: string, id: string): void {
    this.collections.get(collectionName)?.delete(id);
  }

  query(collectionName: string, field: string, value: unknown): FakeSnapshot[] {
    return Array.from(this.collections.get(collectionName)?.entries() ?? [])
      .filter(([, data]) => data[field] === value)
      .map(
        ([id]) =>
          new FakeSnapshot(
            this,
            new FakeDocumentReference(this, collectionName, id),
          ),
      );
  }
}

class FakeCollectionReference {
  constructor(
    private readonly database: FakeFirestore,
    private readonly collectionName: string,
  ) {}

  doc(id: string): FakeDocumentReference {
    return new FakeDocumentReference(this.database, this.collectionName, id);
  }

  where(field: string, _operator: string, value: unknown) {
    return new FakeQueryReference(
      this.database,
      this.collectionName,
      field,
      value,
    );
  }
}

class FakeQueryReference {
  constructor(
    private readonly database: FakeFirestore,
    private readonly collectionName: string,
    private readonly field: string,
    private readonly value: unknown,
  ) {}

  async get(): Promise<FakeQuerySnapshot> {
    return this.snapshot();
  }

  snapshot(): FakeQuerySnapshot {
    return new FakeQuerySnapshot(
      this.database.query(this.collectionName, this.field, this.value),
    );
  }
}

class FakeQuerySnapshot {
  constructor(readonly docs: FakeSnapshot[]) {}

  get empty(): boolean {
    return this.docs.length === 0;
  }

  get size(): number {
    return this.docs.length;
  }
}

class FakeDocumentReference {
  constructor(
    readonly database: FakeFirestore,
    readonly collectionName: string,
    readonly id: string,
  ) {}

  async set(data: FakeData): Promise<void> {
    this.database.set(this.collectionName, this.id, data);
  }
}

class FakeSnapshot {
  constructor(
    private readonly database: FakeFirestore,
    readonly ref: FakeDocumentReference,
  ) {}

  get exists(): boolean {
    return this.database.get(this.ref.collectionName, this.ref.id) !== undefined;
  }

  get id(): string {
    return this.ref.id;
  }

  data(): FakeData | undefined {
    const data = this.database.get(this.ref.collectionName, this.ref.id);
    return data ? { ...data } : undefined;
  }
}

class FakeTransaction {
  private hasWritten = false;

  constructor(private readonly database: FakeFirestore) {}

  async get(ref: FakeDocumentReference): Promise<FakeSnapshot>;
  async get(ref: FakeQueryReference): Promise<FakeQuerySnapshot>;
  async get(
    ref: FakeDocumentReference | FakeQueryReference,
  ): Promise<FakeSnapshot | FakeQuerySnapshot> {
    if (this.hasWritten && this.database.enforceReadBeforeWrite) {
      throw new Error("Firestore transaction read attempted after a write");
    }
    if (ref instanceof FakeQueryReference) return ref.snapshot();
    return new FakeSnapshot(this.database, ref);
  }

  update(ref: FakeDocumentReference, updates: FakeData): void {
    this.hasWritten = true;
    this.database.update(ref.collectionName, ref.id, updates);
  }

  set(ref: FakeDocumentReference, data: FakeData): void {
    this.hasWritten = true;
    this.database.set(ref.collectionName, ref.id, data);
  }

  delete(ref: FakeDocumentReference): void {
    this.hasWritten = true;
    this.database.delete(ref.collectionName, ref.id);
  }
}

function createService(database: FakeFirestore): FirebaseService {
  const service = new FirebaseService();
  Object.defineProperty(service, "db", { value: database });
  return service;
}

test("guarded cancellation leaves a cross-payment replacement and its property mirror untouched", async () => {
  const database = new FakeFirestore();
  database.set("subscriptions", "SUB-PROP-1", {
    id: "SUB-PROP-1",
    propertyNumber: "PROP-1",
    paymentId: "PAY-NEWER",
    status: "active",
  });
  database.set("properties", "PROP-1", {
    propertyNumber: "PROP-1",
    subscriptionType: "مميز",
  });

  const cancelled = await createService(
    database,
  ).cancelSubscriptionIfOwnedByPayment("PROP-1", "PAY-OLD", "rejected");

  assert.equal(cancelled, false);
  assert.equal(database.get("subscriptions", "SUB-PROP-1")?.status, "active");
  assert.equal(database.get("properties", "PROP-1")?.subscriptionType, "مميز");
});

test("guarded non-cascading cancellation preserves a mixed-owner linked child", async () => {
  const database = new FakeFirestore();
  database.set("subscriptions", "SUB-PROP-MAIN", {
    id: "SUB-PROP-MAIN",
    propertyNumber: "PROP-MAIN",
    paymentId: "PAY-REJECT",
    status: "active",
    linkedProperties: ["PROP-OWNED", "PROP-OTHER"],
  });
  database.set("subscriptions", "SUB-PROP-OWNED", {
    id: "SUB-PROP-OWNED",
    propertyNumber: "PROP-OWNED",
    paymentId: "PAY-REJECT",
    status: "active",
    linkedProperty: "PROP-MAIN",
  });
  database.set("subscriptions", "SUB-PROP-OTHER", {
    id: "SUB-PROP-OTHER",
    propertyNumber: "PROP-OTHER",
    paymentId: "PAY-OTHER",
    status: "active",
    linkedProperty: "PROP-MAIN",
  });
  for (const propertyNumber of ["PROP-MAIN", "PROP-OWNED", "PROP-OTHER"]) {
    database.set("properties", propertyNumber, {
      propertyNumber,
      subscriptionType: "مميز",
    });
  }

  const service = createService(database);
  assert.equal(
    await service.cancelSubscriptionIfOwnedByPayment(
      "PROP-OWNED",
      "PAY-REJECT",
    ),
    true,
  );
  assert.equal(
    await service.cancelSubscriptionIfOwnedByPayment(
      "PROP-OTHER",
      "PAY-REJECT",
    ),
    false,
  );
  assert.equal(
    await service.cancelSubscriptionIfOwnedByPayment(
      "PROP-MAIN",
      "PAY-REJECT",
    ),
    true,
  );

  assert.equal(
    database.get("subscriptions", "SUB-PROP-MAIN")?.status,
    "منتهي",
  );
  assert.equal(
    database.get("subscriptions", "SUB-PROP-OWNED")?.status,
    "منتهي",
  );
  assert.equal(
    database.get("subscriptions", "SUB-PROP-OTHER")?.status,
    "active",
  );
  assert.equal(database.get("properties", "PROP-MAIN")?.subscriptionType, "عادي");
  assert.equal(database.get("properties", "PROP-OWNED")?.subscriptionType, "عادي");
  assert.equal(database.get("properties", "PROP-OTHER")?.subscriptionType, "مميز");
});

function activeSubscription(
  propertyNumber: string,
  overrides: FakeData = {},
): FakeData {
  return {
    id: `SUB-${propertyNumber}`,
    propertyNumber,
    packageId: "PKG-OLD",
    startDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    endDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    status: "active",
    paymentId: "PAY-OLD",
    ...overrides,
  };
}

function actionablePayment(
  id: string,
  propertyNumber: string,
  overrides: FakeData = {},
): FakeData {
  return {
    id,
    propertyNumber,
    packageId: "PKG-NEW",
    amount: 100,
    finalAmount: 100,
    discountAmount: 0,
    status: "pending",
    action: "upgrade",
    ...overrides,
  };
}

test("linked properties can create independent payments without property locks", async () => {
  const database = new FakeFirestore();
  database.set("subscriptions", "SUB-PROP-ROOT", activeSubscription("PROP-ROOT"));
  database.set(
    "subscriptions",
    "SUB-PROP-CHILD",
    activeSubscription("PROP-CHILD", { linkedProperty: "PROP-ROOT" }),
  );
  const service = createService(database);

  const outcomes = await Promise.allSettled([
    service.createPayment(actionablePayment("PAY-ROOT", "PROP-ROOT") as any),
    service.createPayment(actionablePayment("PAY-CHILD", "PROP-CHILD") as any),
  ]);

  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 2);
  assert.equal(database.get("payments", "PAY-ROOT")?.propertyNumber, "PROP-ROOT");
  assert.equal(database.get("payments", "PAY-CHILD")?.propertyNumber, "PROP-CHILD");
  assert.equal(database.get("payment_action_locks", "PROP-ROOT"), undefined);
  assert.equal(database.get("payment_action_locks", "PROP-CHILD"), undefined);
});

test("a released new-property payment does not block another payment", async () => {
  const database = new FakeFirestore();
  const service = createService(database);
  await service.createPayment(
    actionablePayment("PAY-NEW-FIRST", "PROP-NEW", { action: "new" }) as any,
  );
  const queueClaim = await service.claimPaymentFulfillment(
    "PAY-NEW-FIRST",
    ["pending"],
  );
  assert.equal(queueClaim.status, "claimed");
  assert.ok(queueClaim.status === "claimed");
  await service.releasePaymentFulfillment("PAY-NEW-FIRST", queueClaim.token);

  const second = await service.createPayment(
    actionablePayment("PAY-NEW-SECOND", "PROP-NEW", { action: "new" }) as any,
  );
  assert.equal(second.id, "PAY-NEW-SECOND");
  assert.equal(database.get("payment_action_locks", "PROP-NEW"), undefined);
});

test("payment eligibility remains enforced without creating a property lock", async () => {
  const database = new FakeFirestore();
  database.set(
    "subscriptions",
    "SUB-PROP-EARLY",
    activeSubscription("PROP-EARLY", {
      endDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  );
  const service = createService(database);

  await assert.rejects(
    () => service.createPayment(
      actionablePayment("PAY-TOO-EARLY", "PROP-EARLY", { action: "extend" }) as any,
    ),
    PaymentActionEligibilityError,
  );
  assert.equal(database.get("payment_action_locks", "PROP-EARLY"), undefined);
  assert.equal(database.get("payments", "PAY-TOO-EARLY"), undefined);
});

test("separate payment attempts are independent while each attempt stays idempotent", async () => {
  const database = new FakeFirestore();
  database.set("subscriptions", "SUB-PROP-1", activeSubscription("PROP-1"));
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  database.set(
    "payments",
    "PAY-FIRST",
    actionablePayment("PAY-FIRST", "PROP-1", { createdAt }),
  );
  database.set(
    "payments",
    "PAY-SECOND",
    actionablePayment("PAY-SECOND", "PROP-1", { createdAt }),
  );
  const service = createService(database);

  const firstClaim = await service.claimPaymentFulfillment("PAY-FIRST");
  assert.equal(firstClaim.status, "claimed");
  assert.ok(firstClaim.status === "claimed");
  await service.completePaymentFulfillment(
    "PAY-FIRST",
    firstClaim.token,
    "SUB-PROP-1",
  );

  const secondClaim = await service.claimPaymentFulfillment("PAY-SECOND");
  assert.equal(secondClaim.status, "claimed");
  assert.deepEqual(
    await service.claimPaymentFulfillment("PAY-FIRST"),
    { status: "fulfilled" },
  );
  assert.equal(database.get("payments", "PAY-FIRST")?.status, "مكتمل");
  assert.equal(database.get("payments", "PAY-SECOND")?.fulfilledAt, undefined);
});

test("a stale processing fulfillment is reclaimed atomically and only the new token can complete", async () => {
  const database = new FakeFirestore();
  database.set("subscriptions", "SUB-PROP-RECOVER", activeSubscription("PROP-RECOVER"));
  const service = createService(database);
  await service.createPayment(
    actionablePayment("PAY-RECOVER", "PROP-RECOVER") as any,
  );

  const firstClaim = await service.claimPaymentFulfillment("PAY-RECOVER");
  assert.equal(firstClaim.status, "claimed");
  assert.ok(firstClaim.status === "claimed");
  assert.deepEqual(
    await service.claimPaymentFulfillment("PAY-RECOVER"),
    { status: "processing" },
  );

  database.update("payments", "PAY-RECOVER", {
    fulfillmentClaimedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
  });
  const recoveryClaim = await service.claimPaymentFulfillment("PAY-RECOVER");
  assert.equal(recoveryClaim.status, "claimed");
  assert.ok(recoveryClaim.status === "claimed");
  assert.equal(recoveryClaim.previousState, "processing");
  assert.notEqual(recoveryClaim.token, firstClaim.token);
  assert.equal(database.get("payment_action_locks", "PROP-RECOVER"), undefined);

  await assert.rejects(
    () =>
      service.completePaymentFulfillment(
        "PAY-RECOVER",
        firstClaim.token,
        "SUB-PROP-RECOVER",
      ),
    /claim was lost/,
  );
  await service.completePaymentFulfillment(
    "PAY-RECOVER",
    recoveryClaim.token,
    "SUB-PROP-RECOVER",
  );
  assert.equal(
    database.get("payments", "PAY-RECOVER")?.fulfillmentState,
    "fulfilled",
  );
  assert.equal(database.get("payment_action_locks", "PROP-RECOVER"), undefined);
});

test("rejection is isolated to its own payment without creating property locks", async () => {
  const database = new FakeFirestore();
  database.set("subscriptions", "SUB-PROP-1", activeSubscription("PROP-1"));
  const service = createService(database);
  await service.createPayment(actionablePayment("PAY-ACTIVE", "PROP-1") as any);
  database.set(
    "payments",
    "PAY-LEGACY-REJECT",
    actionablePayment("PAY-LEGACY-REJECT", "PROP-1", {
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    }),
  );

  const rejectionClaim = await service.claimPaymentFulfillment(
    "PAY-LEGACY-REJECT",
    ["pending"],
    { purpose: "reject" },
  );
  assert.equal(rejectionClaim.status, "claimed");
  assert.ok(rejectionClaim.status === "claimed");
  database.update("payments", "PAY-LEGACY-REJECT", { status: "مرفوض" });
  await service.releasePaymentFulfillment(
    "PAY-LEGACY-REJECT",
    rejectionClaim.token,
  );

  assert.equal(database.get("payments", "PAY-ACTIVE")?.status, "pending");
  assert.equal(database.get("payments", "PAY-LEGACY-REJECT")?.fulfillmentState, "failed");
  assert.equal(database.get("payment_action_locks", "PROP-1"), undefined);
});

test("rejection completes without creating a property lock", async () => {
  const database = new FakeFirestore();
  const service = createService(database);
  await service.createPayment(
    actionablePayment("PAY-REJECT-OWNED", "PROP-NEW", { action: "new" }) as any,
  );

  const claim = await service.claimPaymentFulfillment(
    "PAY-REJECT-OWNED",
    ["pending"],
    { purpose: "reject" },
  );
  assert.equal(claim.status, "claimed");
  assert.ok(claim.status === "claimed");
  database.update("payments", "PAY-REJECT-OWNED", { status: "مرفوض" });
  await service.releasePaymentFulfillment("PAY-REJECT-OWNED", claim.token);

  assert.equal(database.get("payments", "PAY-REJECT-OWNED")?.fulfillmentState, "failed");
  assert.equal(database.get("payment_action_locks", "PROP-NEW"), undefined);
});

test("abandoned pre-intention reservation can be released for a retry", async () => {
  const database = new FakeFirestore();
  database.set("subscriptions", "SUB-PROP-1", activeSubscription("PROP-1"));
  const service = createService(database);
  await service.createPayment(actionablePayment("PAY-ABANDONED", "PROP-1") as any);

  assert.equal(
    await service.releasePaymentActionReservation("PAY-ABANDONED"),
    true,
  );
  const retry = await service.createPayment(
    actionablePayment("PAY-RETRY", "PROP-1") as any,
  );

  assert.equal(retry.id, "PAY-RETRY");
  assert.equal(database.get("payment_action_locks", "PROP-1"), undefined);
});

test("fulfilled and applied payments atomically repair a stale pending status", async () => {
  const database = new FakeFirestore();
  database.set("payments", "PAY-FULFILLED", {
    ...actionablePayment("PAY-FULFILLED", "PROP-1"),
    fulfillmentState: "fulfilled",
    fulfilledAt: "2026-07-10T12:00:00.000Z",
  });
  database.set(
    "payments",
    "PAY-APPLIED",
    actionablePayment("PAY-APPLIED", "PROP-2"),
  );
  database.set(
    "subscriptions",
    "LEGACY-SUBSCRIPTION-PROP-2",
    activeSubscription("PROP-2", { paymentId: "PAY-APPLIED" }),
  );
  const service = createService(database);

  assert.equal(
    (await service.claimPaymentFulfillment("PAY-FULFILLED")).status,
    "fulfilled",
  );
  assert.equal(
    await service.reconcileAppliedPaymentStatus("PAY-APPLIED"),
    true,
  );

  assert.equal(database.get("payments", "PAY-FULFILLED")?.status, "مكتمل");
  assert.equal(database.get("payments", "PAY-APPLIED")?.status, "مكتمل");
  assert.ok(database.get("payments", "PAY-APPLIED")?.completedAt);
});

test("status reconciliation does not hide modern partial or linked-property retries", async () => {
  const database = new FakeFirestore();
  database.set("payments", "PAY-PARTIAL", {
    ...actionablePayment("PAY-PARTIAL", "PROP-PARTIAL"),
    fulfillmentState: "processing",
    fulfillmentClaimToken: "still-running",
  });
  database.set(
    "subscriptions",
    "SUB-PROP-PARTIAL",
    activeSubscription("PROP-PARTIAL", { paymentId: "PAY-PARTIAL" }),
  );
  database.set("payments", "PAY-LINKED", {
    ...actionablePayment("PAY-LINKED", "PROP-LINKED"),
    additionalProperties: ["PROP-CHILD"],
  });
  database.set(
    "subscriptions",
    "SUB-PROP-LINKED",
    activeSubscription("PROP-LINKED", {
      paymentId: "PAY-LINKED",
      linkedProperties: ["PROP-CHILD"],
    }),
  );
  const service = createService(database);

  assert.equal(
    await service.reconcileAppliedPaymentStatus("PAY-PARTIAL"),
    false,
  );
  assert.equal(
    await service.reconcileAppliedPaymentStatus("PAY-LINKED"),
    false,
  );
  assert.equal(database.get("payments", "PAY-PARTIAL")?.status, "pending");
  assert.equal(database.get("payments", "PAY-LINKED")?.status, "pending");
});

test("guarded cancellation uses arbitrary legacy document ids and expires duplicate owned rows", async () => {
  const database = new FakeFirestore();
  const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  database.set("subscriptions", "LEGACY-PARENT-ID", {
    ...activeSubscription("PROP-PARENT"),
    id: "LEGACY-PARENT-ID",
    paymentId: "PAY-REJECT",
    linkedProperties: ["PROP-CHILD"],
  });
  database.set("subscriptions", "LEGACY-CHILD-OLD", {
    ...activeSubscription("PROP-CHILD"),
    id: "LEGACY-CHILD-OLD",
    paymentId: "PAY-REJECT",
    linkedProperty: "PROP-PARENT",
    endDate: future,
  });
  database.set("subscriptions", "LEGACY-CHILD-NEW", {
    ...activeSubscription("PROP-CHILD"),
    id: "LEGACY-CHILD-NEW",
    paymentId: "PAY-REJECT",
    linkedProperty: "PROP-PARENT",
    endDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
  });
  database.set("properties", "PROP-CHILD", {
    propertyNumber: "PROP-CHILD",
    subscriptionType: "مميز",
  });

  assert.equal(
    await createService(database).cancelSubscriptionIfOwnedByPayment(
      "PROP-CHILD",
      "PAY-REJECT",
    ),
    true,
  );
  assert.equal(database.get("subscriptions", "LEGACY-CHILD-OLD")?.status, "منتهي");
  assert.equal(database.get("subscriptions", "LEGACY-CHILD-NEW")?.status, "منتهي");
  assert.deepEqual(
    database.get("subscriptions", "LEGACY-PARENT-ID")?.linkedProperties,
    [],
  );
});

test("overlapping linked and solo payment records do not reserve properties", async () => {
  const database = new FakeFirestore();
  const service = createService(database);
  const outcomes = await Promise.allSettled([
    service.createPayment(actionablePayment("PAY-A-B", "PROP-A", {
      action: "new",
      additionalProperties: ["PROP-B"],
      linkedProperties: ["PROP-B"],
    }) as any),
    service.createPayment(actionablePayment("PAY-B", "PROP-B", {
      action: "new",
    }) as any),
  ]);

  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 2);
  assert.deepEqual(database.get("payments", "PAY-A-B")?.additionalProperties, ["PROP-B"]);
  assert.equal(database.get("payments", "PAY-B")?.propertyNumber, "PROP-B");
  assert.equal(database.get("payment_action_locks", "PROP-A"), undefined);
  assert.equal(database.get("payment_action_locks", "PROP-B"), undefined);
});

test("payment persistence never locks a property that belongs to another group", async () => {
  const database = new FakeFirestore();
  database.set("subscriptions", "LEGACY-B", activeSubscription("PROP-B", {
    id: "LEGACY-B",
    linkedProperty: "PROP-C",
  }));
  database.set("subscriptions", "LEGACY-C", activeSubscription("PROP-C", {
    id: "LEGACY-C",
    linkedProperties: ["PROP-B"],
  }));
  const service = createService(database);

  const payment = await service.createPayment(actionablePayment("PAY-A-B", "PROP-A", {
    action: "new",
    additionalProperties: ["PROP-B"],
  }) as any);
  assert.equal(payment.id, "PAY-A-B");
  assert.equal(database.get("payment_action_locks", "PROP-A"), undefined);
  assert.equal(database.get("payment_action_locks", "PROP-B"), undefined);
});

test("stale legacy child rows do not create any payment locks", async () => {
  const database = new FakeFirestore();
  database.set("subscriptions", "SUB-A", activeSubscription("PROP-A"));
  database.set("subscriptions", "OLD-B-A", activeSubscription("PROP-B", {
    id: "OLD-B-A",
    linkedProperty: "PROP-A",
    endDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
  }));
  database.set("subscriptions", "NEW-B-C", activeSubscription("PROP-B", {
    id: "NEW-B-C",
    linkedProperty: "PROP-C",
    endDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
  }));
  const service = createService(database);

  await service.createPayment(actionablePayment("PAY-A", "PROP-A") as any);
  assert.equal(database.get("payment_action_locks", "PROP-A"), undefined);
  assert.equal(database.get("payment_action_locks", "PROP-B"), undefined);
  assert.equal(database.get("payment_action_locks", "PROP-C"), undefined);
});

test("legacy payments without an action do not block a new payment", async () => {
  const database = new FakeFirestore();
  database.set("payments", "PAY-LEGACY", {
    ...actionablePayment("PAY-LEGACY", "PROP-LEGACY", { action: undefined }),
    action: undefined,
  });
  const service = createService(database);
  const claim = await service.claimPaymentFulfillment("PAY-LEGACY", ["pending"]);
  assert.equal(claim.status, "claimed");

  const payment = await service.createPayment(actionablePayment("PAY-NEW", "PROP-LEGACY", {
    action: "new",
  }) as any);
  assert.equal(payment.id, "PAY-NEW");
  assert.equal(database.get("payment_action_locks", "PROP-LEGACY"), undefined);
});

test("completed and provider-unknown payments do not lock later property actions", async () => {
  for (const ownerUpdates of [
    { status: "مكتمل" },
    { status: "فشل", intentionState: "unknown" },
    { status: "ملغي - انتهت المهلة", intentionState: "created", transactionId: "INT-1" },
  ]) {
    const database = new FakeFirestore();
    const service = createService(database);
    await service.createPayment(actionablePayment("PAY-OWNER", "PROP-1", {
      action: "new",
    }) as any);
    database.update("payments", "PAY-OWNER", ownerUpdates);

    const replacement = await service.createPayment(actionablePayment("PAY-TAKEOVER", "PROP-1", {
      action: "new",
    }) as any);
    assert.equal(replacement.id, "PAY-TAKEOVER");
    assert.equal(database.get("payment_action_locks", "PROP-1"), undefined);
  }
});

test("only one concurrent retry reservation can create a provider attempt", async () => {
  const database = new FakeFirestore();
  const service = createService(database);
  await service.createPayment(actionablePayment("PAY-RETRY", "PROP-1", {
    action: "new",
  }) as any);
  await service.releasePaymentActionReservation("PAY-RETRY", {
    status: "فشل",
    intentionState: "failed",
  });

  const outcomes = await Promise.allSettled([
    service.reservePaymentActionForRetry("PAY-RETRY"),
    service.reservePaymentActionForRetry("PAY-RETRY"),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.ok(
    outcomes.some(
      (outcome) =>
        outcome.status === "rejected" &&
        (
          outcome.reason instanceof PaymentActionConflictError ||
          outcome.reason instanceof PaymentRetryNotAllowedError
        ),
    ),
  );
  const independentPayment = await service.createPayment(actionablePayment(
    "PAY-OTHER",
    "PROP-1",
    { action: "new" },
  ) as any);
  assert.equal(independentPayment.id, "PAY-OTHER");
  assert.equal(database.get("payment_action_locks", "PROP-1"), undefined);

  const reserved = outcomes.find(
    (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof service.reservePaymentActionForRetry>>> =>
      outcome.status === "fulfilled",
  );
  assert.ok(reserved);
  assert.equal(
    await service.releasePaymentActionRetryReservation(
      "PAY-RETRY",
      reserved.value.token,
      { status: "فشل", intentionState: "failed" },
    ),
    true,
  );
  assert.equal(database.get("payments", "PAY-OTHER")?.id, "PAY-OTHER");
});

test("retry reservation clears stale provider identity before creating a new attempt", async () => {
  const database = new FakeFirestore();
  const service = createService(database);
  await service.createPayment(actionablePayment("PAY-RETRY", "PROP-1", {
    action: "new",
    merchantAttemptKey: "ATTEMPT-OLD",
    paymobOrderId: "ORDER-OLD",
    paymentCheckoutUrl: "https://checkout.example/old",
    providerReconciledAt: "2026-07-27T10:00:00.000Z",
    providerPaidAt: "2026-07-27T10:01:00.000Z",
    providerLastCheckedAt: "2026-07-27T10:02:00.000Z",
    providerReconciliationStartedAt: "2026-07-27T10:00:00.000Z",
    providerReconciliationClaimToken: "CLAIM-OLD",
  }) as any);
  await service.releasePaymentActionReservation("PAY-RETRY", {
    status: "فشل",
    intentionState: "failed",
    paymentReference: "",
    transactionId: "",
  });

  const retry = await service.reservePaymentActionForRetry("PAY-RETRY");
  const payment = database.get("payments", "PAY-RETRY");

  assert.notEqual(retry.merchantAttemptKey, "ATTEMPT-OLD");
  assert.equal(payment?.merchantAttemptKey, retry.merchantAttemptKey);
  assert.equal(payment?.paymobOrderId, "");
  assert.equal(payment?.paymentReference, "");
  assert.equal(payment?.transactionId, "");
  assert.equal(payment?.paymentCheckoutUrl, "");
  assert.equal(payment?.providerReconciledAt, "");
  assert.equal(payment?.providerPaidAt, "");
  assert.equal(payment?.providerLastCheckedAt, "");
  assert.equal(payment?.providerReconciliationStartedAt, "");
  assert.equal(payment?.providerReconciliationClaimToken, "");
});

test("pending or provider-identified payments cannot reserve a new retry", async () => {
  for (const overrides of [
    { status: "pending" },
    { status: "فشل", intentionState: "created", transactionId: "INT-1" },
    { status: "فشل", intentionState: "unknown" },
  ]) {
    const database = new FakeFirestore();
    database.set("payments", "PAY-RETRY", actionablePayment(
      "PAY-RETRY",
      "PROP-1",
      { action: "new", ...overrides },
    ));
    await assert.rejects(
      () => createService(database).reservePaymentActionForRetry("PAY-RETRY"),
      PaymentRetryNotAllowedError,
    );
    assert.equal(database.get("payment_action_locks", "PROP-1"), undefined);
  }
});

test("retry completion verifies its payment token without property locks", async () => {
  const database = new FakeFirestore();
  const service = createService(database);
  await service.createPayment(actionablePayment("PAY-RETRY", "PROP-A", {
    action: "new",
    additionalProperties: ["PROP-B"],
  }) as any);
  await service.releasePaymentActionReservation("PAY-RETRY", {
    status: "فشل",
    intentionState: "failed",
  });
  const retry = await service.reservePaymentActionForRetry("PAY-RETRY");

  await assert.rejects(
    () => service.completePaymentActionRetryReservation(
      "PAY-RETRY",
      "WRONG-TOKEN",
      { paymentReference: "INT-NEW", transactionId: "INT-NEW" },
    ),
    PaymentActionConflictError,
  );
  assert.equal(database.get("payments", "PAY-RETRY")?.paymentReference, "");
  assert.equal(database.get("payments", "PAY-RETRY")?.retryReservationToken, retry.token);
  await service.completePaymentActionRetryReservation(
    "PAY-RETRY",
    retry.token,
    { paymentReference: "INT-NEW", transactionId: "INT-NEW" },
  );
  assert.equal(database.get("payments", "PAY-RETRY")?.paymentReference, "INT-NEW");
  assert.equal(database.get("payments", "PAY-RETRY")?.retryReservationToken, "");
  assert.equal(database.get("payment_action_locks", "PROP-A"), undefined);
  assert.equal(database.get("payment_action_locks", "PROP-B"), undefined);
});

test("a failed bank payment never blocks a replacement payment", async () => {
  const database = new FakeFirestore();
  const service = createService(database);
  await service.createPayment(actionablePayment("PAY-BANK", "PROP-1", {
    action: "new",
    paymentMethod: "تحويل بنكي",
    paymentReference: "RWQN-BANK01",
  }) as any);
  database.update("payments", "PAY-BANK", { status: "مرفوض" });

  const replacement = await service.createPayment(actionablePayment(
    "PAY-REPLACEMENT",
    "PROP-1",
    { action: "new" },
  ) as any);
  assert.equal(replacement.id, "PAY-REPLACEMENT");
  assert.equal(database.get("payment_action_locks", "PROP-1"), undefined);
});

test("failed transaction preserves a legacy intention for a later checkout attempt", async () => {
  const database = new FakeFirestore();
  database.set("payments", "PAY-LEGACY-NO-LOCK", actionablePayment(
    "PAY-LEGACY-NO-LOCK",
    "PROP-1",
    {
      action: "new",
      paymentMethod: "بطاقة",
      intentionState: "created",
      paymobOrderId: "ORDER-LEGACY",
      paymentReference: "INT-OLD",
      transactionId: "INT-OLD",
      paymentCheckoutUrl: "https://checkout.example/old",
    },
  ));

  assert.equal(
    await createService(database).finalizeFailedPaymentIntention(
      "PAY-LEGACY-NO-LOCK",
      {
        merchantAttemptKey: "",
        transactionId: "TX-FAILED",
        paymobOrderId: "ORDER-LEGACY",
        amountCents: 10_000,
        currency: "SAR",
      },
    ),
    true,
  );
  const payment = database.get("payments", "PAY-LEGACY-NO-LOCK");
  assert.equal(payment?.status, "فشل");
  assert.equal(payment?.intentionState, "created");
  assert.equal(payment?.paymentReference, "INT-OLD");
  assert.equal(payment?.transactionId, "INT-OLD");
  assert.equal(payment?.paymentCheckoutUrl, "https://checkout.example/old");
  assert.equal(payment?.lastFailedTransactionId, "TX-FAILED");
  assert.ok(payment?.lastProviderFailureAt);
});

test("failed transaction never touches a foreign replacement lock", async () => {
  const database = new FakeFirestore();
  database.set("payments", "PAY-OLD", actionablePayment("PAY-OLD", "PROP-1", {
    action: "new",
    fulfillmentActionLockKey: "PROP-1",
    fulfillmentActionLockKeys: ["PROP-1"],
    intentionState: "created",
    paymobOrderId: "ORDER-OLD",
    transactionId: "INT-OLD",
  }));
  database.set("payment_action_locks", "PROP-1", {
    propertyNumber: "PROP-1",
    paymentId: "PAY-NEW",
    action: "new",
    state: "reserved",
  });

  await createService(database).finalizeFailedPaymentIntention(
    "PAY-OLD",
    {
      merchantAttemptKey: "",
      transactionId: "INT-OLD",
      paymobOrderId: "ORDER-OLD",
      amountCents: 10_000,
      currency: "SAR",
    },
  );
  assert.equal(
    database.get("payment_action_locks", "PROP-1")?.paymentId,
    "PAY-NEW",
  );
  assert.equal(database.get("payment_action_locks", "PROP-1")?.state, "reserved");
});

test("failed transaction retains every action lock owned by its intention", async () => {
  const database = new FakeFirestore();
  database.set("payments", "PAY-CURRENT", actionablePayment(
    "PAY-CURRENT",
    "PROP-1",
    {
      action: "new",
      fulfillmentActionLockKey: "PROP-1",
      fulfillmentActionLockKeys: ["PROP-1", "PROP-2"],
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-1",
      paymentReference: "INT-1",
      transactionId: "INT-1",
      paymentCheckoutUrl: "https://checkout.example/current",
    },
  ));
  for (const propertyNumber of ["PROP-1", "PROP-2"]) {
    database.set("payment_action_locks", propertyNumber, {
      propertyNumber,
      paymentId: "PAY-CURRENT",
      action: "new",
      state: "reserved",
    });
  }

  assert.equal(
    await createService(database).finalizeFailedPaymentIntention(
      "PAY-CURRENT",
      {
        merchantAttemptKey: "ATTEMPT-1",
        transactionId: "TX-FAILED",
        paymobOrderId: "ORDER-1",
        amountCents: 10_000,
        currency: "SAR",
      },
    ),
    true,
  );
  assert.equal(database.get("payment_action_locks", "PROP-1")?.state, "reserved");
  assert.equal(database.get("payment_action_locks", "PROP-2")?.state, "reserved");
  assert.equal(
    database.get("payments", "PAY-CURRENT")?.paymentCheckoutUrl,
    "https://checkout.example/current",
  );
});

test("order-only failed callback settles one unique modern persisted Paymob order", async () => {
  const database = new FakeFirestore();
  database.set("payments", "PAY-ORDER-ONLY", actionablePayment(
    "PAY-ORDER-ONLY",
    "PROP-1",
    {
      action: "new",
      status: "قيد المراجعة",
      paymentMethod: "بطاقة",
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-NOT-ECHOED",
      paymentReference: "INT-ORDER-ONLY",
      transactionId: "INT-ORDER-ONLY",
      paymobOrderId: "ORDER-PERSISTED",
    },
  ));
  const service = createService(database);

  assert.equal(
    await service.finalizeFailedPaymentIntention("PAY-ORDER-ONLY", {
      merchantAttemptKey: "",
      transactionId: "TX-DECLINED",
      paymobOrderId: "ORDER-PERSISTED",
      amountCents: 10_000,
      currency: "SAR",
    }),
    true,
  );
  assert.equal(database.get("payments", "PAY-ORDER-ONLY")?.status, "فشل");

  database.set("payments", "PAY-DUPLICATE-ORDER", actionablePayment(
    "PAY-DUPLICATE-ORDER",
    "PROP-2",
    {
      merchantAttemptKey: "ATTEMPT-OTHER",
      paymobOrderId: "ORDER-PERSISTED",
    },
  ));
  database.update("payments", "PAY-ORDER-ONLY", {
    status: "قيد المراجعة",
    lastFailedTransactionId: "",
  });
  assert.equal(
    await service.finalizeFailedPaymentIntention("PAY-ORDER-ONLY", {
      merchantAttemptKey: "",
      transactionId: "TX-DECLINED-2",
      paymobOrderId: "ORDER-PERSISTED",
      amountCents: 10_000,
      currency: "SAR",
    }),
    false,
  );
});

test("late provider failure cannot downgrade or unlock a successful payment", async () => {
  const database = new FakeFirestore();
  database.set("payments", "PAY-SUCCESS", actionablePayment(
    "PAY-SUCCESS",
    "PROP-1",
    {
      action: "new",
      status: "مكتمل",
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-1",
      paymentReference: "INT-1",
      transactionId: "TX-SUCCESS",
      completedAt: new Date().toISOString(),
      fulfillmentState: "fulfilled",
      fulfilledAt: new Date().toISOString(),
      fulfillmentActionLockKey: "PROP-1",
      fulfillmentActionLockKeys: ["PROP-1"],
    },
  ));
  database.set("payment_action_locks", "PROP-1", {
    propertyNumber: "PROP-1",
    paymentId: "PAY-SUCCESS",
    action: "new",
    state: "fulfilled",
  });

  assert.equal(
    await createService(database).finalizeFailedPaymentIntention(
      "PAY-SUCCESS",
      {
        merchantAttemptKey: "ATTEMPT-1",
        transactionId: "TX-SUCCESS",
        paymobOrderId: "ORDER-1",
        amountCents: 10_000,
        currency: "SAR",
      },
    ),
    false,
  );
  assert.equal(database.get("payments", "PAY-SUCCESS")?.status, "مكتمل");
  assert.equal(database.get("payments", "PAY-SUCCESS")?.transactionId, "TX-SUCCESS");
  assert.equal(database.get("payment_action_locks", "PROP-1")?.state, "fulfilled");
});

test("failure from an old retry attempt cannot release the current attempt", async () => {
  const database = new FakeFirestore();
  database.set("payments", "PAY-RETRY", actionablePayment(
    "PAY-RETRY",
    "PROP-1",
    {
      action: "new",
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-NEW",
      paymentReference: "INT-NEW",
      transactionId: "INT-NEW",
      fulfillmentActionLockKey: "PROP-1",
      fulfillmentActionLockKeys: ["PROP-1"],
    },
  ));
  database.set("payment_action_locks", "PROP-1", {
    propertyNumber: "PROP-1",
    paymentId: "PAY-RETRY",
    action: "new",
    state: "reserved",
  });

  assert.equal(
    await createService(database).finalizeFailedPaymentIntention(
      "PAY-RETRY",
      {
        merchantAttemptKey: "ATTEMPT-OLD",
        transactionId: "TX-OLD",
        paymobOrderId: "ORDER-OLD",
        amountCents: 10_000,
        currency: "SAR",
      },
    ),
    false,
  );
  assert.equal(database.get("payments", "PAY-RETRY")?.status, "pending");
  assert.equal(database.get("payments", "PAY-RETRY")?.merchantAttemptKey, "ATTEMPT-NEW");
  assert.equal(database.get("payment_action_locks", "PROP-1")?.state, "reserved");
});

test("successful callback acceptance rejects an attempt changed after route lookup", async () => {
  const database = new FakeFirestore();
  database.set("payments", "PAY-RACE", actionablePayment(
    "PAY-RACE",
    "PROP-1",
    {
      action: "new",
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-NEW",
      paymentReference: "INT-NEW",
      transactionId: "INT-NEW",
    },
  ));

  const result = await createService(database).acceptSuccessfulPaymentIntention(
    "PAY-RACE",
    {
      merchantAttemptKey: "ATTEMPT-OLD",
      transactionId: "TX-OLD-SUCCESS",
      paymobOrderId: "ORDER-1",
      amountCents: 10_000,
      currency: "SAR",
    },
    { merchantFees: 2 },
  );

  assert.deepEqual(result, { status: "rejected", reason: "stale_attempt" });
  assert.equal(database.get("payments", "PAY-RACE")?.status, "pending");
  assert.equal(database.get("payments", "PAY-RACE")?.transactionId, "INT-NEW");
  assert.equal(database.get("payments", "PAY-RACE")?.merchantFees, undefined);
});

test("successful callback acceptance rejects duplicate merchant attempt keys", async () => {
  const database = new FakeFirestore();
  for (const [id, propertyNumber] of [
    ["PAY-DUPLICATE-A", "PROP-A"],
    ["PAY-DUPLICATE-B", "PROP-B"],
  ]) {
    database.set("payments", id, actionablePayment(
      id,
      propertyNumber,
      {
        action: "new",
        intentionState: "created",
        merchantAttemptKey: "ATTEMPT-DUPLICATE",
        paymentReference: `INT-${id}`,
        transactionId: `INT-${id}`,
      },
    ));
  }

  const result = await createService(database).acceptSuccessfulPaymentIntention(
    "PAY-DUPLICATE-A",
    {
      merchantAttemptKey: "ATTEMPT-DUPLICATE",
      transactionId: "TX-DUPLICATE-SUCCESS",
      paymobOrderId: "ORDER-DUPLICATE",
      amountCents: 10_000,
      currency: "SAR",
    },
    { merchantFees: 2 },
  );

  assert.deepEqual(result, {
    status: "rejected",
    reason: "attempt_identity_conflict",
  });
  assert.equal(database.get("payments", "PAY-DUPLICATE-A")?.status, "pending");
  assert.equal(database.get("payments", "PAY-DUPLICATE-A")?.merchantFees, undefined);
});

test("successful callback acceptance prefers one persisted HMAC-covered Paymob order", async () => {
  const database = new FakeFirestore();
  database.set("payments", "PAY-BY-ORDER", actionablePayment(
    "PAY-BY-ORDER",
    "PROP-ORDER",
    {
      action: "new",
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-NOT-ECHOED",
      paymentReference: "INT-BY-ORDER",
      transactionId: "INT-BY-ORDER",
      paymobOrderId: "ORDER-PERSISTED",
    },
  ));

  const result = await createService(database).acceptSuccessfulPaymentIntention(
    "PAY-BY-ORDER",
    {
      merchantAttemptKey: "",
      transactionId: "TX-BY-ORDER",
      paymobOrderId: "ORDER-PERSISTED",
      amountCents: 10_000,
      currency: "SAR",
    },
    { merchantFees: 2 },
  );

  assert.equal(result.status, "accepted");
  assert.equal(database.get("payments", "PAY-BY-ORDER")?.transactionId, "TX-BY-ORDER");
  assert.equal(database.get("payments", "PAY-BY-ORDER")?.status, "نجح - قيد التحقق");
});

test("successful callback acceptance rejects a conflicting persisted Paymob order", async () => {
  const database = new FakeFirestore();
  database.set("payments", "PAY-ORDER-A", actionablePayment(
    "PAY-ORDER-A",
    "PROP-A",
    {
      action: "new",
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-A",
      paymentReference: "INT-A",
      transactionId: "INT-A",
      paymobOrderId: "ORDER-A",
    },
  ));
  database.set("payments", "PAY-ORDER-B", actionablePayment(
    "PAY-ORDER-B",
    "PROP-B",
    {
      action: "new",
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-B",
      paymentReference: "INT-B",
      transactionId: "INT-B",
      paymobOrderId: "ORDER-B",
    },
  ));

  const result = await createService(database).acceptSuccessfulPaymentIntention(
    "PAY-ORDER-A",
    {
      merchantAttemptKey: "ATTEMPT-A",
      transactionId: "TX-ORDER-CONFLICT",
      paymobOrderId: "ORDER-B",
      amountCents: 10_000,
      currency: "SAR",
    },
    { merchantFees: 2 },
  );

  assert.deepEqual(result, {
    status: "rejected",
    reason: "provider_order_conflict",
  });
  assert.equal(database.get("payments", "PAY-ORDER-A")?.status, "pending");
  assert.equal(database.get("payments", "PAY-ORDER-A")?.merchantFees, undefined);
});

test("success is terminal, while a failed transaction may be superseded by later success", async () => {
  const successFirstDatabase = new FakeFirestore();
  successFirstDatabase.set("payments", "PAY-SUCCESS-FIRST", actionablePayment(
    "PAY-SUCCESS-FIRST",
    "PROP-1",
    {
      action: "new",
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-1",
      paymentReference: "INT-1",
      transactionId: "INT-1",
    },
  ));
  const successFirstService = createService(successFirstDatabase);
  const accepted = await successFirstService.acceptSuccessfulPaymentIntention(
    "PAY-SUCCESS-FIRST",
    {
      merchantAttemptKey: "ATTEMPT-1",
      transactionId: "TX-1",
      paymobOrderId: "ORDER-1",
      amountCents: 10_000,
      currency: "SAR",
    },
    { totalFees: 5 },
  );
  assert.equal(accepted.status, "accepted");
  assert.equal(
    await successFirstService.finalizeFailedPaymentIntention(
      "PAY-SUCCESS-FIRST",
      {
        merchantAttemptKey: "ATTEMPT-1",
        transactionId: "TX-LATE-FAILURE",
        paymobOrderId: "ORDER-1",
        amountCents: 10_000,
        currency: "SAR",
      },
    ),
    false,
  );
  assert.equal(
    successFirstDatabase.get("payments", "PAY-SUCCESS-FIRST")?.status,
    "نجح - قيد التحقق",
  );
  assert.equal(
    successFirstDatabase.get("payments", "PAY-SUCCESS-FIRST")?.transactionId,
    "TX-1",
  );

  const failureFirstDatabase = new FakeFirestore();
  failureFirstDatabase.set("payments", "PAY-FAILURE-FIRST", actionablePayment(
    "PAY-FAILURE-FIRST",
    "PROP-2",
    {
      action: "new",
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-2",
      paymentReference: "INT-2",
      transactionId: "INT-2",
    },
  ));
  const failureFirstService = createService(failureFirstDatabase);
  assert.equal(
    await failureFirstService.finalizeFailedPaymentIntention(
      "PAY-FAILURE-FIRST",
      {
        merchantAttemptKey: "ATTEMPT-2",
        transactionId: "TX-2",
        paymobOrderId: "ORDER-2",
        amountCents: 10_000,
        currency: "SAR",
      },
    ),
    true,
  );
  const lateSuccess = await failureFirstService.acceptSuccessfulPaymentIntention(
    "PAY-FAILURE-FIRST",
    {
      merchantAttemptKey: "ATTEMPT-2",
      transactionId: "TX-2-SUCCESS",
      paymobOrderId: "ORDER-2",
      amountCents: 10_000,
      currency: "SAR",
    },
    { totalFees: 5 },
  );
  assert.equal(lateSuccess.status, "accepted");
  assert.equal(
    failureFirstDatabase.get("payments", "PAY-FAILURE-FIRST")?.status,
    "نجح - قيد التحقق",
  );
  assert.equal(
    failureFirstDatabase.get("payments", "PAY-FAILURE-FIRST")?.transactionId,
    "TX-2-SUCCESS",
  );
  assert.equal(
    failureFirstDatabase.get("payments", "PAY-FAILURE-FIRST")
      ?.lastFailedTransactionId,
    "TX-2",
  );
});

test("successful callback acceptance keeps processing resumable but stops after fulfillment", async () => {
  const processingDatabase = new FakeFirestore();
  processingDatabase.set("payments", "PAY-processing", actionablePayment(
    "PAY-processing",
    "PROP-1",
    {
      action: "new",
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-1",
      paymentReference: "INT-1",
      transactionId: "INT-1",
      fulfillmentState: "processing",
    },
  ));
  const firstSuccess = await createService(
    processingDatabase,
  ).acceptSuccessfulPaymentIntention(
    "PAY-processing",
    {
      merchantAttemptKey: "ATTEMPT-1",
      transactionId: "TX-1",
      paymobOrderId: "ORDER-1",
      amountCents: 10_000,
      currency: "SAR",
    },
    { totalFees: 99, paymentMethod: "APPLE_PAY" as any },
  );
  assert.equal(firstSuccess.status, "accepted");
  assert.equal(
    processingDatabase.get("payments", "PAY-processing")?.transactionId,
    "TX-1",
  );
  assert.equal(
    processingDatabase.get("payments", "PAY-processing")?.paymentMethod,
    "APPLE_PAY",
  );
  assert.equal(
    processingDatabase.get("payments", "PAY-processing")?.fulfillmentState,
    "processing",
  );

  const exactReplay = await createService(
    processingDatabase,
  ).acceptSuccessfulPaymentIntention(
    "PAY-processing",
    {
      merchantAttemptKey: "ATTEMPT-1",
      transactionId: "TX-1",
      paymobOrderId: "ORDER-1",
      amountCents: 10_000,
      currency: "SAR",
    },
    { totalFees: 123 },
  );
  assert.equal(exactReplay.status, "already_accepted");
  assert.equal(
    processingDatabase.get("payments", "PAY-processing")?.totalFees,
    99,
  );

  const fulfilledDatabase = new FakeFirestore();
  fulfilledDatabase.set("payments", "PAY-fulfilled", actionablePayment(
    "PAY-fulfilled",
    "PROP-1",
    {
      action: "new",
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-1",
      paymentReference: "INT-1",
      transactionId: "INT-1",
      fulfillmentState: "fulfilled",
    },
  ));
  const fulfilledReplay = await createService(
    fulfilledDatabase,
  ).acceptSuccessfulPaymentIntention(
    "PAY-fulfilled",
    {
      merchantAttemptKey: "ATTEMPT-1",
      transactionId: "TX-1",
      paymobOrderId: "ORDER-1",
      amountCents: 10_000,
      currency: "SAR",
    },
    { totalFees: 99 },
  );
  assert.equal(fulfilledReplay.status, "already_processed");
  assert.equal(
    fulfilledDatabase.get("payments", "PAY-fulfilled")?.totalFees,
    undefined,
  );
});

test("legacy success acceptance requires one exact signed Paymob order match", async () => {
  const uniqueDatabase = new FakeFirestore();
  uniqueDatabase.set("payments", "PAY-LEGACY", actionablePayment(
    "PAY-LEGACY",
    "PROP-1",
    {
      action: "new",
      paymobOrderId: "ORDER-LEGACY",
      paymentReference: "INT-LEGACY",
      transactionId: "INT-LEGACY",
    },
  ));
  const uniqueResult = await createService(
    uniqueDatabase,
  ).acceptSuccessfulPaymentIntention(
    "PAY-LEGACY",
    {
      merchantAttemptKey: "",
      transactionId: "TX-LEGACY-SUCCESS",
      paymobOrderId: "ORDER-LEGACY",
      amountCents: 10_000,
      currency: "SAR",
    },
    { totalFees: 4 },
  );
  assert.equal(uniqueResult.status, "accepted");

  const duplicateDatabase = new FakeFirestore();
  for (const id of ["PAY-LEGACY-A", "PAY-LEGACY-B"]) {
    duplicateDatabase.set("payments", id, actionablePayment(
      id,
      `PROP-${id}`,
      {
        action: "new",
        paymobOrderId: "ORDER-DUPLICATE",
        paymentReference: `INT-${id}`,
        transactionId: `INT-${id}`,
      },
    ));
  }
  const duplicateResult = await createService(
    duplicateDatabase,
  ).acceptSuccessfulPaymentIntention(
    "PAY-LEGACY-A",
    {
      merchantAttemptKey: "",
      transactionId: "TX-DUPLICATE",
      paymobOrderId: "ORDER-DUPLICATE",
      amountCents: 10_000,
      currency: "SAR",
    },
    { totalFees: 4 },
  );
  assert.deepEqual(duplicateResult, {
    status: "rejected",
    reason: "legacy_identity_conflict",
  });
  assert.equal(
    duplicateDatabase.get("payments", "PAY-LEGACY-A")?.status,
    "pending",
  );
});

test("add-on success is terminal against a later failed callback", async () => {
  const database = new FakeFirestore();
  database.set("payments", "PAY-ADDON-1", actionablePayment(
    "PAY-ADDON-1",
    "PROP-1",
    {
      action: "addon",
      status: "قيد الدفع",
      paymentMethod: "paymob",
      merchantAttemptKey: "ATTEMPT-1",
      paymobOrderId: "ORDER-1",
      intentionState: "created",
    },
  ));
  const service = createService(database);
  const success = await service.settleAddOnPaymentCallback(
    "PAY-ADDON-1",
    {
      merchantAttemptKey: "ATTEMPT-1",
      transactionId: "TX-SUCCESS",
      paymobOrderId: "ORDER-1",
      amountCents: 10_000,
      currency: "SAR",
      success: true,
    },
    { totalFees: 5 },
  );
  assert.equal(success.status, "accepted_success");

  const lateFailure = await service.settleAddOnPaymentCallback(
    "PAY-ADDON-1",
    {
      merchantAttemptKey: "ATTEMPT-1",
      transactionId: "TX-LATE-FAILURE",
      paymobOrderId: "ORDER-1",
      amountCents: 10_000,
      currency: "SAR",
      success: false,
    },
  );
  assert.equal(lateFailure.status, "already_processed");
  assert.equal(database.get("payments", "PAY-ADDON-1")?.status, "نجح - قيد التحقق");
  assert.equal(database.get("payments", "PAY-ADDON-1")?.transactionId, "TX-SUCCESS");
  assert.equal(database.get("payments", "PAY-ADDON-1")?.lastFailedTransactionId, undefined);
});

test("add-on failure retains its order and can be superseded by same-checkout success", async () => {
  const database = new FakeFirestore();
  database.set("payments", "PAY-ADDON-2", actionablePayment(
    "PAY-ADDON-2",
    "PROP-2",
    {
      action: "addon",
      status: "قيد الدفع",
      paymentMethod: "paymob",
      merchantAttemptKey: "ATTEMPT-2",
      paymobOrderId: "ORDER-2",
      intentionState: "created",
    },
  ));
  const service = createService(database);
  const failure = await service.settleAddOnPaymentCallback(
    "PAY-ADDON-2",
    {
      merchantAttemptKey: "ATTEMPT-2",
      transactionId: "TX-FAILED",
      paymobOrderId: "ORDER-2",
      amountCents: 10_000,
      currency: "SAR",
      success: false,
    },
  );
  assert.equal(failure.status, "recorded_failure");
  assert.equal(database.get("payments", "PAY-ADDON-2")?.paymobOrderId, "ORDER-2");
  assert.equal(database.get("payments", "PAY-ADDON-2")?.transactionId, undefined);

  const success = await service.settleAddOnPaymentCallback(
    "PAY-ADDON-2",
    {
      merchantAttemptKey: "ATTEMPT-2",
      transactionId: "TX-SUCCESS",
      paymobOrderId: "ORDER-2",
      amountCents: 10_000,
      currency: "SAR",
      success: true,
    },
    { netAmount: 95 },
  );
  assert.equal(success.status, "accepted_success");
  assert.equal(database.get("payments", "PAY-ADDON-2")?.status, "نجح - قيد التحقق");
  assert.equal(database.get("payments", "PAY-ADDON-2")?.transactionId, "TX-SUCCESS");
  assert.equal(database.get("payments", "PAY-ADDON-2")?.lastFailedTransactionId, "TX-FAILED");
});

test("reconciled add-on settlement writes one atomic history entry and a late callback is idempotent", async () => {
  const database = new FakeFirestore();
  const paymentId = "PAY-ADDON-RECON-HISTORY";
  database.set("payments", paymentId, actionablePayment(
    paymentId,
    "PROP-RECON",
    {
      action: "addon",
      packageId: "ADDON-RECON",
      status: "قيد الدفع",
      paymentMethod: "paymob",
      merchantAttemptKey: "ATTEMPT-RECON",
      paymentReference: "INTENTION-RECON",
      transactionId: "INTENTION-RECON",
      paymobOrderId: "ORDER-RECON",
      intentionState: "created",
    },
  ));
  const service = createService(database);
  const expected = {
    merchantAttemptKey: "ATTEMPT-RECON",
    transactionId: "TX-RECON",
    paymobOrderId: "ORDER-RECON",
    amountCents: 10_000,
    currency: "SAR",
    success: true,
  };

  assert.deepEqual(
    await service.settleAddOnPaymentCallback(
      paymentId,
      expected,
      { totalFees: 99 },
      {
        recordReconciliationHistory: true,
        expectedIntentionId: "INTENTION-STALE",
      },
    ),
    { status: "rejected", reason: "identity_conflict" },
  );
  assert.equal(database.get("addon_history", `AH-PAYMOB-RECON-${paymentId}`), undefined);

  const reconciled = await service.settleAddOnPaymentCallback(
    paymentId,
    expected,
    {
      totalFees: 6.9,
      netAmount: 93.1,
      providerReconciledAt: "2026-07-27T16:00:00.000Z",
    },
    {
      recordReconciliationHistory: true,
      expectedIntentionId: "INTENTION-RECON",
    },
  );
  assert.equal(reconciled.status, "accepted_success");
  const historyId = `AH-PAYMOB-RECON-${paymentId}`;
  const history = database.get("addon_history", historyId);
  assert.equal(history?.id, historyId);
  assert.equal(history?.propertyNumber, "PROP-RECON");
  assert.equal(history?.addOnPackageId, "ADDON-RECON");
  assert.equal(history?.action, "pending");
  assert.equal(history?.createdBy, "system");
  assert.match(history?.notes || "", /6\.9/);

  const lateCallback = await service.settleAddOnPaymentCallback(
    paymentId,
    { ...expected, transactionId: "TX-LATE-CALLBACK" },
    { totalFees: 99 },
  );
  assert.equal(lateCallback.status, "already_processed");
  assert.deepEqual(database.get("addon_history", historyId), history);
  assert.equal(database.get("payments", paymentId)?.transactionId, "TX-RECON");
  assert.equal(database.get("payments", paymentId)?.totalFees, 6.9);
});

test("concurrent opposite add-on callbacks converge to success in either arrival order", async () => {
  for (const successFirst of [false, true]) {
    const database = new FakeFirestore();
    const paymentId = successFirst ? "PAY-ADDON-SF" : "PAY-ADDON-FF";
    database.set("payments", paymentId, actionablePayment(
      paymentId,
      "PROP-1",
      {
        action: "addon",
        status: "قيد الدفع",
        paymentMethod: "paymob",
        merchantAttemptKey: `ATTEMPT-${paymentId}`,
        paymobOrderId: `ORDER-${paymentId}`,
        intentionState: "created",
      },
    ));
    const service = createService(database);
    const successCall = () => service.settleAddOnPaymentCallback(
      paymentId,
      {
        merchantAttemptKey: `ATTEMPT-${paymentId}`,
        transactionId: `TX-SUCCESS-${paymentId}`,
        paymobOrderId: `ORDER-${paymentId}`,
        amountCents: 10_000,
        currency: "SAR",
        success: true,
      },
      { totalFees: 4 },
    );
    const failureCall = () => service.settleAddOnPaymentCallback(
      paymentId,
      {
        merchantAttemptKey: `ATTEMPT-${paymentId}`,
        transactionId: `TX-FAILURE-${paymentId}`,
        paymobOrderId: `ORDER-${paymentId}`,
        amountCents: 10_000,
        currency: "SAR",
        success: false,
      },
    );
    const outcomes = await Promise.all(
      successFirst
        ? [successCall(), failureCall()]
        : [failureCall(), successCall()],
    );
    assert.ok(outcomes.some((outcome) => outcome.status === "accepted_success"));
    assert.equal(database.get("payments", paymentId)?.status, "نجح - قيد التحقق");
    assert.equal(
      database.get("payments", paymentId)?.transactionId,
      `TX-SUCCESS-${paymentId}`,
    );
  }
});

test("add-on settlement rejects wrong order ownership, amount, currency, and payment kind", async () => {
  const database = new FakeFirestore();
  database.set("payments", "PAY-ADDON-OWNER", actionablePayment(
    "PAY-ADDON-OWNER",
    "PROP-1",
    {
      action: "addon",
      status: "قيد الدفع",
      paymobOrderId: "ORDER-OWNED",
      merchantAttemptKey: "ATTEMPT-OWNED",
      intentionState: "created",
    },
  ));
  database.set("payments", "PAY-ADDON-OTHER", actionablePayment(
    "PAY-ADDON-OTHER",
    "PROP-2",
    {
      action: "addon",
      status: "قيد الدفع",
      paymobOrderId: "ORDER-OTHER",
      merchantAttemptKey: "ATTEMPT-OTHER",
      intentionState: "created",
    },
  ));
  database.set("payments", "PAY-SUBSCRIPTION", actionablePayment(
    "PAY-SUBSCRIPTION",
    "PROP-3",
    { action: "new" },
  ));
  const service = createService(database);

  const common = {
    merchantAttemptKey: "ATTEMPT-OWNED",
    transactionId: "TX-1",
    paymobOrderId: "ORDER-OWNED",
    amountCents: 10_000,
    currency: "SAR",
    success: true,
  };
  assert.deepEqual(
    await service.settleAddOnPaymentCallback("PAY-ADDON-OTHER", common),
    { status: "rejected", reason: "identity_conflict" },
  );
  assert.deepEqual(
    await service.settleAddOnPaymentCallback("PAY-ADDON-OWNER", {
      ...common,
      paymobOrderId: "ORDER-DIFFERENT",
    }),
    { status: "rejected", reason: "identity_conflict" },
  );
  assert.deepEqual(
    await service.settleAddOnPaymentCallback("PAY-ADDON-OWNER", {
      ...common,
      amountCents: 9_999,
    }),
    { status: "rejected", reason: "amount_or_currency_mismatch" },
  );
  assert.deepEqual(
    await service.settleAddOnPaymentCallback("PAY-ADDON-OWNER", {
      ...common,
      currency: "USD",
    }),
    { status: "rejected", reason: "amount_or_currency_mismatch" },
  );
  assert.deepEqual(
    await service.settleAddOnPaymentCallback("PAY-SUBSCRIPTION", {
      ...common,
      paymobOrderId: "ORDER-SUBSCRIPTION",
    }),
    { status: "rejected", reason: "not_addon" },
  );
});

test("add-on settlement fails closed until the current attempt and provider order are persisted", async () => {
  const variants = [
    {},
    { merchantAttemptKey: "ATTEMPT-BOUND", intentionState: "created" },
    { paymobOrderId: "ORDER-BOUND", intentionState: "created" },
    {
      merchantAttemptKey: "ATTEMPT-BOUND",
      paymobOrderId: "ORDER-BOUND",
      intentionState: "unknown",
    },
  ];

  for (const [index, identity] of variants.entries()) {
    const database = new FakeFirestore();
    const paymentId = `PAY-ADDON-UNBOUND-${index}`;
    database.set("payments", paymentId, actionablePayment(
      paymentId,
      "PROP-1",
      {
        action: "addon",
        status: "قيد الدفع",
        ...identity,
      },
    ));

    assert.deepEqual(
      await createService(database).settleAddOnPaymentCallback(paymentId, {
        merchantAttemptKey: "ATTEMPT-BOUND",
        transactionId: "TX-1",
        paymobOrderId: "ORDER-BOUND",
        amountCents: 10_000,
        currency: "SAR",
        success: true,
      }),
      { status: "rejected", reason: "identity_conflict" },
    );
    assert.equal(database.get("payments", paymentId)?.transactionId, undefined);
  }
});

test("add-on settlement rejects duplicate persisted attempt or order ownership", async () => {
  for (const duplicateField of ["merchantAttemptKey", "paymobOrderId"] as const) {
    const database = new FakeFirestore();
    database.set("payments", "PAY-ADDON-TARGET", actionablePayment(
      "PAY-ADDON-TARGET",
      "PROP-1",
      {
        action: "addon",
        status: "قيد الدفع",
        merchantAttemptKey: "ATTEMPT-TARGET",
        paymobOrderId: "ORDER-TARGET",
        intentionState: "created",
      },
    ));
    database.set("payments", `PAY-ADDON-DUP-${duplicateField}`, actionablePayment(
      `PAY-ADDON-DUP-${duplicateField}`,
      "PROP-2",
      {
        action: "addon",
        status: "قيد الدفع",
        merchantAttemptKey: duplicateField === "merchantAttemptKey"
          ? "ATTEMPT-TARGET"
          : "ATTEMPT-OTHER",
        paymobOrderId: duplicateField === "paymobOrderId"
          ? "ORDER-TARGET"
          : "ORDER-OTHER",
        intentionState: "created",
      },
    ));

    assert.deepEqual(
      await createService(database).settleAddOnPaymentCallback(
        "PAY-ADDON-TARGET",
        {
          merchantAttemptKey: "ATTEMPT-TARGET",
          transactionId: "TX-1",
          paymobOrderId: "ORDER-TARGET",
          amountCents: 10_000,
          currency: "SAR",
          success: true,
        },
      ),
      { status: "rejected", reason: "identity_conflict" },
    );
  }
});

test("new-property queue completion requires its durable marker, not a partial pending flag", async () => {
  const database = new FakeFirestore();
  const service = createService(database);
  await service.createPayment(
    actionablePayment("PAY-QUEUE-MARKER", "PROP-QUEUE-MARKER", {
      action: "new",
    }) as any,
  );
  database.update("payments", "PAY-QUEUE-MARKER", {
    pendingPropertyApproval: true,
  });

  const partialClaim = await service.claimPaymentFulfillment(
    "PAY-QUEUE-MARKER",
    ["pending"],
    { purpose: "queue" },
  );
  assert.equal(partialClaim.status, "claimed");
  assert.ok(partialClaim.status === "claimed");
  await service.releasePaymentFulfillment(
    "PAY-QUEUE-MARKER",
    partialClaim.token,
  );

  database.update("payments", "PAY-QUEUE-MARKER", {
    propertyApprovalQueuedAt: "2026-07-27T16:00:00.000Z",
    status: "نجح - قيد التحقق",
  });
  assert.deepEqual(
    await service.claimPaymentFulfillment(
      "PAY-QUEUE-MARKER",
      ["pending"],
      { purpose: "queue" },
    ),
    { status: "queued" },
  );
});

test("pending activation notes cannot roll a concurrently completed payment back", async () => {
  const database = new FakeFirestore();
  const service = createService(database);
  database.set("payments", "PAY-ACTIVATION-REASON", {
    ...actionablePayment("PAY-ACTIVATION-REASON", "PROP-1", {
      status: "نجح - قيد التحقق",
    }),
    transactionId: "TX-PAID",
    completedAt: "2026-07-27T16:00:00.000Z",
  });

  assert.equal(
    await service.recordPaidPaymentActivationPending(
      "PAY-ACTIVATION-REASON",
      "TX-PAID",
      "property images are incomplete",
    ),
    true,
  );
  assert.equal(
    database.get("payments", "PAY-ACTIVATION-REASON")?.notes,
    "property images are incomplete",
  );
  assert.equal(
    await service.recordPaidPaymentActivationPending(
      "PAY-ACTIVATION-REASON",
      "TX-OTHER",
      "must not be stored",
    ),
    false,
  );

  database.update("payments", "PAY-ACTIVATION-REASON", {
    status: "مكتمل",
    fulfillmentState: "fulfilled",
    fulfilledAt: "2026-07-27T16:01:00.000Z",
  });
  assert.equal(
    await service.recordPaidPaymentActivationPending(
      "PAY-ACTIVATION-REASON",
      "TX-PAID",
      "late callback must not roll status back",
    ),
    false,
  );
  assert.equal(
    database.get("payments", "PAY-ACTIVATION-REASON")?.status,
    "مكتمل",
  );
  assert.equal(
    database.get("payments", "PAY-ACTIVATION-REASON")?.notes,
    "property images are incomplete",
  );
});

test("payment timeout CAS fails closed for every unresolved Paymob identity", async () => {
  const oldCreatedAt = "2026-07-27T15:00:00.000Z";
  const cutoffMs = Date.parse("2026-07-27T15:30:00.000Z");
  const unresolvedVariants = [
    { merchantAttemptKey: "RWQN-ATTEMPT-1" },
    { intentionState: "creating" },
    { intentionState: "created" },
    { intentionState: "unknown" },
    { paymentReference: "pi_live_1" },
    { transactionId: "pi_live_1" },
    { paymobOrderId: "ORDER-1" },
    { paymentCheckoutUrl: "https://checkout.example/attempt" },
  ];

  for (const [index, unresolved] of unresolvedVariants.entries()) {
    const database = new FakeFirestore();
    const id = `PAY-UNRESOLVED-${index}`;
    database.set("payments", id, {
      ...actionablePayment(id, "PROP-1", {
        status: "قيد المراجعة",
        paymentMethod: "بطاقة",
        createdAt: oldCreatedAt,
      }),
      ...unresolved,
    });
    const candidate = database.get("payments", id) as any;

    assert.equal(
      await createService(database).expirePendingPaymentIfEligible(
        candidate,
        "card",
        cutoffMs,
      ),
      false,
    );
    assert.equal(database.get("payments", id)?.status, "قيد المراجعة");
  }
});

test("Paymob reconciliation claim is atomic, throttled, exact, and required for provider-backed timeout", async () => {
  const database = new FakeFirestore();
  const id = "PAY-CLAIMED-PROVIDER";
  const checkedAt = "2026-07-27T16:00:00.000Z";
  database.set("payments", id, actionablePayment(id, "PROP-1", {
    status: "قيد المراجعة",
    paymentMethod: "بطاقة",
    createdAt: "2026-07-27T15:00:00.000Z",
    intentionState: "created",
    merchantAttemptKey: "ATTEMPT-CLAIM",
    paymentReference: "INTENTION-CLAIM",
    transactionId: "INTENTION-CLAIM",
    paymobOrderId: "ORDER-CLAIM",
    paymentCheckoutUrl: "https://checkout.example/claim",
  }));
  const service = createService(database);
  const candidate = database.get("payments", id) as any;
  const claimOptions = {
    checkedAt,
    createdBeforeMs: Date.parse("2026-07-27T15:30:00.000Z"),
    createdAfterMs: Date.parse("2026-07-20T16:00:00.000Z"),
    minIntervalMs: 60 * 60 * 1000,
  };

  const claims = await Promise.all([
    service.claimPaymentProviderReconciliation(candidate, claimOptions),
    service.claimPaymentProviderReconciliation(candidate, claimOptions),
  ]);
  const claimed = claims.find((result) => result.claimed);
  assert.ok(claimed?.claimed);
  assert.equal(claims.filter((result) => result.claimed).length, 1);
  assert.equal(
    database.get("payments", id)?.providerReconciliationClaimToken,
    claimed.token,
  );
  assert.equal(
    database.get("payments", id)?.providerReconciliationStartedAt,
    checkedAt,
  );

  assert.equal(
    await service.expirePendingPaymentIfEligible(
      claimed.payment,
      "card",
      claimOptions.createdBeforeMs,
      { providerUnpaidClaimToken: "WRONG-CLAIM" },
    ),
    false,
  );
  assert.equal(database.get("payments", id)?.status, "قيد المراجعة");
  assert.equal(
    await service.expirePendingPaymentIfEligible(
      claimed.payment,
      "card",
      claimOptions.createdBeforeMs,
      { providerUnpaidClaimToken: claimed.token },
    ),
    true,
  );
  assert.equal(database.get("payments", id)?.status, "ملغي - انتهت المهلة");
  assert.equal(database.get("payments", id)?.paymentReference, "INTENTION-CLAIM");
  assert.equal(database.get("payments", id)?.paymobOrderId, "ORDER-CLAIM");
});

test("provider reconciliation admits only a stale processing subscription fulfillment", async () => {
  const checkedAt = "2026-07-27T16:00:00.000Z";
  const options = {
    checkedAt,
    createdBeforeMs: Date.parse("2026-07-27T15:30:00.000Z"),
    createdAfterMs: Date.parse("2026-07-20T16:00:00.000Z"),
    minIntervalMs: 60 * 60 * 1000,
  };

  for (const scenario of [
    {
      id: "PAY-PROCESSING-RECENT",
      fulfillmentClaimedAt: "2026-07-27T15:55:00.000Z",
      pendingPropertyApproval: false,
      expectedClaimed: false,
    },
    {
      id: "PAY-PROCESSING-STALE",
      fulfillmentClaimedAt: "2026-07-27T15:45:00.000Z",
      pendingPropertyApproval: false,
      expectedClaimed: true,
    },
    {
      id: "PAY-PROCESSING-PARTIAL-QUEUE",
      fulfillmentClaimedAt: "2026-07-27T15:45:00.000Z",
      pendingPropertyApproval: true,
      expectedClaimed: true,
    },
  ]) {
    const database = new FakeFirestore();
    database.set("payments", scenario.id, actionablePayment(
      scenario.id,
      "PROP-PROCESSING",
      {
        status: "نجح - قيد التحقق",
        paymentMethod: "APPLE_PAY" as any,
        createdAt: "2026-07-27T15:00:00.000Z",
        completedAt: "2026-07-27T15:30:00.000Z",
        intentionState: "created",
        merchantAttemptKey: `ATTEMPT-${scenario.id}`,
        paymentReference: `INTENTION-${scenario.id}`,
        transactionId: `TX-${scenario.id}`,
        paymobOrderId: `ORDER-${scenario.id}`,
        paymentCheckoutUrl: "https://checkout.example/processing",
        fulfillmentState: "processing",
        fulfillmentClaimToken: `OLD-${scenario.id}`,
        fulfillmentClaimedAt: scenario.fulfillmentClaimedAt,
        pendingPropertyApproval: scenario.pendingPropertyApproval,
      },
    ));
    const candidate = database.get("payments", scenario.id) as any;
    const result = await createService(
      database,
    ).claimPaymentProviderReconciliation(candidate, options);
    assert.equal(result.claimed, scenario.expectedClaimed, scenario.id);
  }
});

test("Paymob reconciliation claim includes initial add-on state and exact action", async () => {
  const database = new FakeFirestore();
  const id = "PAY-ADDON-CLAIM";
  database.set("payments", id, actionablePayment(id, "PROP-ADDON", {
    action: "addon",
    status: "قيد الدفع",
    paymentMethod: "paymob",
    createdAt: "2026-07-27T15:00:00.000Z",
    intentionState: "created",
    merchantAttemptKey: "ATTEMPT-ADDON-CLAIM",
    paymentReference: "INTENTION-ADDON-CLAIM",
    transactionId: "INTENTION-ADDON-CLAIM",
    paymobOrderId: "ORDER-ADDON-CLAIM",
    paymentCheckoutUrl: "https://checkout.example/addon-claim",
  }));
  const service = createService(database);
  const candidate = database.get("payments", id) as any;
  const options = {
    checkedAt: "2026-07-27T16:00:00.000Z",
    createdBeforeMs: Date.parse("2026-07-27T15:30:00.000Z"),
    createdAfterMs: Date.parse("2026-07-20T16:00:00.000Z"),
    minIntervalMs: 60 * 60 * 1000,
  };

  assert.equal(
    (await service.claimPaymentProviderReconciliation(candidate, options)).claimed,
    true,
  );

  const staleDatabase = new FakeFirestore();
  staleDatabase.set("payments", id, { ...candidate, action: "addon" });
  assert.deepEqual(
    await createService(staleDatabase).claimPaymentProviderReconciliation(
      { ...candidate, action: "extend" },
      options,
    ),
    { claimed: false },
  );
});

test("Paymob reconciliation claim rejects stale attempts, old repeats, and queued/completed payments", async () => {
  const checkedAt = "2026-07-27T16:00:00.000Z";
  const options = {
    checkedAt,
    createdBeforeMs: Date.parse("2026-07-27T15:30:00.000Z"),
    createdAfterMs: Date.parse("2026-07-20T16:00:00.000Z"),
    minIntervalMs: 60 * 60 * 1000,
  };
  for (const scenario of [
    { name: "outside window", createdAt: "2026-07-20T15:59:59.999Z" },
    { name: "recent check", providerLastCheckedAt: "2026-07-27T15:30:00.000Z" },
    {
      name: "queued",
      pendingPropertyApproval: true,
      propertyApprovalQueuedAt: "2026-07-27T15:20:00.000Z",
    },
    { name: "completed", completedAt: "2026-07-27T15:20:00.000Z", status: "مكتمل" },
  ]) {
    const database = new FakeFirestore();
    const id = `PAY-CLAIM-${scenario.name}`;
    database.set("payments", id, actionablePayment(id, "PROP-1", {
      status: "قيد المراجعة",
      paymentMethod: "بطاقة",
      createdAt: "2026-07-27T15:00:00.000Z",
      intentionState: "created",
      merchantAttemptKey: `ATTEMPT-${scenario.name}`,
      paymentReference: `INTENTION-${scenario.name}`,
      transactionId: `INTENTION-${scenario.name}`,
      paymentCheckoutUrl: "https://checkout.example/claim",
      ...scenario,
    }));
    const service = createService(database);
    const candidate = database.get("payments", id) as any;
    assert.deepEqual(
      await service.claimPaymentProviderReconciliation(candidate, options),
      { claimed: false },
      scenario.name,
    );
  }

  const raceDatabase = new FakeFirestore();
  raceDatabase.set("payments", "PAY-CLAIM-RACE", actionablePayment(
    "PAY-CLAIM-RACE",
    "PROP-1",
    {
      status: "قيد المراجعة",
      paymentMethod: "بطاقة",
      createdAt: "2026-07-27T15:00:00.000Z",
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-OLD",
      paymentReference: "INTENTION-OLD",
      transactionId: "INTENTION-OLD",
      paymentCheckoutUrl: "https://checkout.example/old",
    },
  ));
  const staleCandidate = raceDatabase.get("payments", "PAY-CLAIM-RACE") as any;
  raceDatabase.update("payments", "PAY-CLAIM-RACE", {
    merchantAttemptKey: "ATTEMPT-NEW",
    paymentReference: "INTENTION-NEW",
    transactionId: "INTENTION-NEW",
    paymentCheckoutUrl: "https://checkout.example/new",
  });
  assert.deepEqual(
    await createService(raceDatabase).claimPaymentProviderReconciliation(
      staleCandidate,
      options,
    ),
    { claimed: false },
  );
});

test("payment timeout CAS expires one safe legacy card attempt only once", async () => {
  const database = new FakeFirestore();
  const id = "PAY-SAFE-LEGACY";
  database.set("payments", id, actionablePayment(id, "PROP-1", {
    status: "قيد المراجعة",
    paymentMethod: "بطاقة",
    createdAt: "2026-07-27T15:00:00.000Z",
  }));
  const service = createService(database);
  const candidate = database.get("payments", id) as any;

  const outcomes = await Promise.all([
    service.expirePendingPaymentIfEligible(
      candidate,
      "card",
      Date.parse("2026-07-27T15:30:00.000Z"),
    ),
    service.expirePendingPaymentIfEligible(
      candidate,
      "card",
      Date.parse("2026-07-27T15:30:00.000Z"),
    ),
  ]);

  assert.deepEqual(outcomes.sort(), [false, true]);
  assert.equal(database.get("payments", id)?.status, "ملغي - انتهت المهلة");
});

test("payment timeout CAS rejects stale, successful, active, and invalid candidates", async () => {
  const basePayment = {
    status: "قيد المراجعة",
    paymentMethod: "بطاقة",
    createdAt: "2026-07-27T15:00:00.000Z",
  };
  const cases: Array<{
    name: string;
    candidateUpdates?: FakeData;
    freshUpdates?: FakeData;
    cutoffMs?: number;
  }> = [
    { name: "status changed", freshUpdates: { status: "مكتمل" } },
    { name: "method changed", freshUpdates: { paymentMethod: "تحويل بنكي" } },
    {
      name: "attempt changed",
      candidateUpdates: { merchantAttemptKey: "ATTEMPT-OLD" },
      freshUpdates: { merchantAttemptKey: "ATTEMPT-NEW" },
    },
    { name: "completed", freshUpdates: { completedAt: "2026-07-27T15:10:00.000Z" } },
    { name: "fulfilled", freshUpdates: { fulfilledAt: "2026-07-27T15:10:00.000Z" } },
    { name: "processing", freshUpdates: { fulfillmentState: "processing" } },
    { name: "fulfilled state", freshUpdates: { fulfillmentState: "fulfilled" } },
    {
      name: "created date changed",
      freshUpdates: { createdAt: "2026-07-27T15:01:00.000Z" },
    },
    {
      name: "invalid date",
      candidateUpdates: { createdAt: "not-a-date" },
      freshUpdates: { createdAt: "not-a-date" },
    },
    {
      name: "not old enough",
      cutoffMs: Date.parse("2026-07-27T14:59:59.999Z"),
    },
    {
      name: "exact timeout boundary",
      cutoffMs: Date.parse("2026-07-27T15:00:00.000Z"),
    },
  ];

  for (const scenario of cases) {
    const database = new FakeFirestore();
    const id = `PAY-${scenario.name}`;
    const candidate = {
      ...actionablePayment(id, "PROP-1", basePayment),
      ...(scenario.candidateUpdates || {}),
    };
    database.set("payments", id, candidate);
    if (scenario.freshUpdates) {
      database.update("payments", id, scenario.freshUpdates);
    }

    assert.equal(
      await createService(database).expirePendingPaymentIfEligible(
        candidate as any,
        "card",
        scenario.cutoffMs ?? Date.parse("2026-07-27T15:30:00.000Z"),
      ),
      false,
      scenario.name,
    );
    assert.notEqual(
      database.get("payments", id)?.status,
      "ملغي - انتهت المهلة",
      scenario.name,
    );
  }
});

test("bank timeout CAS cannot overwrite concurrent approval and expires an unchanged transfer", async () => {
  const cutoffMs = Date.parse("2026-07-27T15:30:00.000Z");
  const oldCreatedAt = "2026-07-24T15:00:00.000Z";

  const completedDatabase = new FakeFirestore();
  completedDatabase.set("payments", "PAY-BANK-COMPLETE", actionablePayment(
    "PAY-BANK-COMPLETE",
    "PROP-1",
    {
      status: "قيد التحقق",
      paymentMethod: "تحويل بنكي",
      createdAt: oldCreatedAt,
    },
  ));
  const staleCandidate = completedDatabase.get("payments", "PAY-BANK-COMPLETE") as any;
  completedDatabase.update("payments", "PAY-BANK-COMPLETE", {
    status: "مكتمل",
    completedAt: "2026-07-27T15:20:00.000Z",
  });
  assert.equal(
    await createService(completedDatabase).expirePendingPaymentIfEligible(
      staleCandidate,
      "bank",
      cutoffMs,
    ),
    false,
  );
  assert.equal(completedDatabase.get("payments", "PAY-BANK-COMPLETE")?.status, "مكتمل");

  const pendingDatabase = new FakeFirestore();
  pendingDatabase.set("payments", "PAY-BANK-OLD", actionablePayment(
    "PAY-BANK-OLD",
    "PROP-2",
    {
      status: "قيد التحقق",
      paymentMethod: "تحويل بنكي",
      createdAt: oldCreatedAt,
    },
  ));
  const pendingCandidate = pendingDatabase.get("payments", "PAY-BANK-OLD") as any;
  assert.equal(
    await createService(pendingDatabase).expirePendingPaymentIfEligible(
      pendingCandidate,
      "bank",
      cutoffMs,
    ),
    true,
  );
  assert.equal(pendingDatabase.get("payments", "PAY-BANK-OLD")?.status, "منتهي الصلاحية");
});

test("an exact signed success can supersede an Arabic timeout status", async () => {
  const database = new FakeFirestore();
  database.set("payments", "PAY-LATE-SUCCESS", actionablePayment(
    "PAY-LATE-SUCCESS",
    "PROP-1",
    {
      status: "ملغي - انتهت المهلة",
      paymentMethod: "بطاقة",
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-1",
      paymentReference: "INTENTION-1",
      transactionId: "INTENTION-1",
    },
  ));

  const result = await createService(database).acceptSuccessfulPaymentIntention(
    "PAY-LATE-SUCCESS",
    {
      merchantAttemptKey: "ATTEMPT-1",
      transactionId: "TX-SUCCESS-1",
      paymobOrderId: "ORDER-1",
      amountCents: 10_000,
      currency: "SAR",
    },
    { totalFees: 4 },
  );

  assert.equal(result.status, "accepted");
  assert.equal(database.get("payments", "PAY-LATE-SUCCESS")?.status, "نجح - قيد التحقق");
  assert.equal(database.get("payments", "PAY-LATE-SUCCESS")?.transactionId, "TX-SUCCESS-1");
});

test("an exact duplicate success is already accepted without rewriting financial details", async () => {
  const database = new FakeFirestore();
  database.set("payments", "PAY-ALREADY-ACCEPTED", actionablePayment(
    "PAY-ALREADY-ACCEPTED",
    "PROP-1",
    {
      status: "نجح - قيد التحقق",
      paymentMethod: "بطاقة",
      intentionState: "created",
      merchantAttemptKey: "ATTEMPT-1",
      paymentReference: "INTENTION-1",
      transactionId: "TX-SUCCESS-1",
      paymobOrderId: "ORDER-1",
      completedAt: "2026-07-27T15:20:00.000Z",
      merchantFees: 2,
    },
  ));

  const result = await createService(database).acceptSuccessfulPaymentIntention(
    "PAY-ALREADY-ACCEPTED",
    {
      merchantAttemptKey: "ATTEMPT-1",
      transactionId: "TX-SUCCESS-1",
      paymobOrderId: "ORDER-1",
      amountCents: 10_000,
      currency: "SAR",
    },
    { merchantFees: 99 },
  );

  assert.equal(result.status, "already_accepted");
  assert.equal(database.get("payments", "PAY-ALREADY-ACCEPTED")?.merchantFees, 2);

  database.update("payments", "PAY-ALREADY-ACCEPTED", { status: "مرفوض" });
  const terminal = await createService(database).acceptSuccessfulPaymentIntention(
    "PAY-ALREADY-ACCEPTED",
    {
      merchantAttemptKey: "ATTEMPT-1",
      transactionId: "TX-SUCCESS-1",
      paymobOrderId: "ORDER-1",
      amountCents: 10_000,
      currency: "SAR",
    },
    { merchantFees: 99 },
  );
  assert.deepEqual(terminal, {
    status: "rejected",
    reason: "terminal_failure",
  });
});

test("admin add-on approval atomically updates only its exact provider-settled payment", async () => {
  const database = new FakeFirestore(true);
  database.set("property_addons", "ADDON-EXACT", {
    id: "ADDON-EXACT",
    propertyNumber: "PROP-1",
    addOnPackageId: "PKG-1",
    paymentId: "PAY-EXACT",
    source: "paymob",
    status: "pending",
    createdAt: "2026-07-27T09:00:00.000Z",
  });
  database.set("payments", "PAY-EXACT", {
    id: "PAY-EXACT",
    propertyNumber: "PROP-1",
    packageId: "PKG-1",
    action: "addon",
    status: "نجح - قيد التحقق",
    paymentMethod: "VISA",
    merchantAttemptKey: "ATTEMPT-EXACT",
    paymentReference: "INTENTION-EXACT",
    transactionId: "TX-EXACT",
    paymentCheckoutUrl: "https://checkout.example/exact",
    paymobOrderId: "ORDER-EXACT",
    intentionState: "created",
    completedAt: "2026-07-27T10:00:00.000Z",
  });
  database.set("payments", "PAY-SAME-PROPERTY-PACKAGE", {
    id: "PAY-SAME-PROPERTY-PACKAGE",
    propertyNumber: "PROP-1",
    packageId: "PKG-1",
    action: "addon",
    status: "قيد المراجعة",
    paymentMethod: "تحويل بنكي",
  });

  const result = await createService(database).applyAdminPropertyAddOnDecision({
    addonId: "ADDON-EXACT",
    paymentId: "PAY-EXACT",
    decision: "approve",
    mode: "settled_paymob",
    startDate: "2026-07-27T11:00:00.000Z",
    endDate: "2026-08-03T11:00:00.000Z",
  });

  assert.equal(result.status, "applied");
  assert.equal(database.get("property_addons", "ADDON-EXACT")?.status, "active");
  assert.equal(database.get("property_addons", "ADDON-EXACT")?.source, "paymob");
  assert.equal(database.get("payments", "PAY-EXACT")?.status, "مكتمل");
  assert.equal(
    database.get("payments", "PAY-SAME-PROPERTY-PACKAGE")?.status,
    "قيد المراجعة",
  );
  assert.equal(
    database.get("addon_history", "AH-ADMIN-APPROVE-ADDON-EXACT")?.action,
    "activated",
  );

  const retry = await createService(database).applyAdminPropertyAddOnDecision({
    addonId: "ADDON-EXACT",
    paymentId: "PAY-EXACT",
    decision: "approve",
    mode: "settled_paymob",
    startDate: "2030-01-01T00:00:00.000Z",
    endDate: "2030-02-01T00:00:00.000Z",
  });
  assert.equal(retry.status, "already_applied");
  assert.equal(
    database.get("property_addons", "ADDON-EXACT")?.startDate,
    "2026-07-27T11:00:00.000Z",
  );
  assert.equal(
    database.get("property_addons", "ADDON-EXACT")?.endDate,
    "2026-08-03T11:00:00.000Z",
  );

  const opposite = await createService(database).applyAdminPropertyAddOnDecision({
    addonId: "ADDON-EXACT",
    paymentId: "PAY-EXACT",
    decision: "reject",
    mode: "settled_paymob",
  });
  assert.deepEqual(opposite, {
    status: "rejected",
    reason: "not_pending",
  });
  assert.equal(database.get("property_addons", "ADDON-EXACT")?.status, "active");
});

test("admin add-on decisions reject generic or unresolved Paymob evidence without writes", async () => {
  const database = new FakeFirestore(true);
  database.set("property_addons", "ADDON-UNSAFE", {
    id: "ADDON-UNSAFE",
    propertyNumber: "PROP-1",
    addOnPackageId: "PKG-1",
    paymentId: "PAY-UNSAFE",
    source: "paymob",
    status: "pending",
    createdAt: "2026-07-27T09:00:00.000Z",
  });
  database.set("payments", "PAY-UNSAFE", {
    id: "PAY-UNSAFE",
    propertyNumber: "PROP-1",
    packageId: "PKG-1",
    action: "addon",
    status: "نجح - قيد التحقق",
    paymentMethod: "بطاقة",
    merchantAttemptKey: "ATTEMPT-UNSAFE",
    paymentReference: "INTENTION-UNSAFE",
    transactionId: "TX-UNSAFE",
    paymentCheckoutUrl: "https://checkout.example/unsafe",
    paymobOrderId: "ORDER-UNSAFE",
    intentionState: "created",
    completedAt: "2026-07-27T10:00:00.000Z",
  });
  const service = createService(database);

  const wrongLink = await service.applyAdminPropertyAddOnDecision({
    addonId: "ADDON-UNSAFE",
    paymentId: "PAY-WRONG",
    decision: "approve",
    mode: "settled_paymob",
  });
  assert.deepEqual(wrongLink, {
    status: "rejected",
    reason: "link_conflict",
  });

  const genericMethod = await service.applyAdminPropertyAddOnDecision({
    addonId: "ADDON-UNSAFE",
    paymentId: "PAY-UNSAFE",
    decision: "approve",
    mode: "settled_paymob",
  });
  assert.deepEqual(genericMethod, {
    status: "rejected",
    reason: "unsafe_provider_state",
  });

  database.update("payments", "PAY-UNSAFE", { paymentMethod: "MADA" });
  const paidRejection = await service.applyAdminPropertyAddOnDecision({
    addonId: "ADDON-UNSAFE",
    paymentId: "PAY-UNSAFE",
    decision: "reject",
    mode: "settled_paymob",
  });
  assert.deepEqual(paidRejection, {
    status: "rejected",
    reason: "unsafe_provider_state",
  });
  assert.equal(database.get("property_addons", "ADDON-UNSAFE")?.status, "pending");
  assert.equal(database.get("payments", "PAY-UNSAFE")?.status, "نجح - قيد التحقق");
  assert.equal(database.get("addon_history", "AH-ADMIN-APPROVE-ADDON-UNSAFE"), undefined);
  assert.equal(database.get("addon_history", "AH-ADMIN-REJECT-ADDON-UNSAFE"), undefined);
});

test("concurrent opposite bank add-on decisions allow exactly one atomic winner", async () => {
  const database = new FakeFirestore(true);
  database.set("property_addons", "ADDON-BANK-RACE", {
    id: "ADDON-BANK-RACE",
    propertyNumber: "PROP-1",
    addOnPackageId: "PKG-1",
    paymentId: "PAY-BANK-RACE",
    source: "bank_transfer",
    receiptUrl: "https://receipts.example/race.jpg",
    status: "pending",
    createdAt: "2026-07-27T09:00:00.000Z",
  });
  database.set("payments", "PAY-BANK-RACE", {
    id: "PAY-BANK-RACE",
    propertyNumber: "PROP-1",
    packageId: "PKG-1",
    action: "addon",
    status: "قيد المراجعة",
    paymentMethod: "تحويل بنكي",
    receiptUrl: "https://receipts.example/race.jpg",
  });
  const service = createService(database);

  const [approve, reject] = await Promise.all([
    service.applyAdminPropertyAddOnDecision({
      addonId: "ADDON-BANK-RACE",
      paymentId: "PAY-BANK-RACE",
      decision: "approve",
      mode: "bank_transfer",
      startDate: "2026-07-27T11:00:00.000Z",
    }),
    service.applyAdminPropertyAddOnDecision({
      addonId: "ADDON-BANK-RACE",
      paymentId: "PAY-BANK-RACE",
      decision: "reject",
      mode: "bank_transfer",
    }),
  ]);

  assert.equal(approve.status, "applied");
  assert.deepEqual(reject, { status: "rejected", reason: "not_pending" });
  assert.equal(database.get("property_addons", "ADDON-BANK-RACE")?.status, "active");
  assert.equal(database.get("payments", "PAY-BANK-RACE")?.status, "مكتمل");
  assert.equal(
    database.get("addon_history", "AH-ADMIN-REJECT-ADDON-BANK-RACE"),
    undefined,
  );
});

test("definitively rejected add-on intention creation is cancelled atomically only before checkout exists", async () => {
  const database = new FakeFirestore(true);
  database.set("property_addons", "ADDON-CREATE", {
    id: "ADDON-CREATE",
    propertyNumber: "PROP-1",
    addOnPackageId: "PKG-1",
    paymentId: "PAY-CREATE",
    source: "paymob",
    status: "pending",
    createdAt: "2026-07-27T09:00:00.000Z",
  });
  database.set("payments", "PAY-CREATE", {
    id: "PAY-CREATE",
    propertyNumber: "PROP-1",
    packageId: "PKG-1",
    action: "addon",
    status: "قيد الدفع",
    paymentMethod: "paymob",
    merchantAttemptKey: "ATTEMPT-CREATE",
    intentionState: "creating",
  });
  const service = createService(database);

  assert.equal(
    await service.cancelRejectedAddOnIntentionCreation(
      "PAY-CREATE",
      "ADDON-CREATE",
    ),
    true,
  );
  assert.equal(database.get("payments", "PAY-CREATE")?.status, "فشل");
  assert.equal(database.get("payments", "PAY-CREATE")?.intentionState, "failed");
  assert.equal(database.get("property_addons", "ADDON-CREATE")?.status, "cancelled");
  assert.equal(
    database.get("addon_history", "AH-PAYMOB-CREATE-FAILED-ADDON-CREATE")?.action,
    "cancelled",
  );

  database.set("property_addons", "ADDON-LIVE", {
    id: "ADDON-LIVE",
    propertyNumber: "PROP-2",
    addOnPackageId: "PKG-1",
    paymentId: "PAY-LIVE",
    source: "paymob",
    status: "pending",
    createdAt: "2026-07-27T09:00:00.000Z",
  });
  database.set("payments", "PAY-LIVE", {
    id: "PAY-LIVE",
    propertyNumber: "PROP-2",
    packageId: "PKG-1",
    action: "addon",
    status: "قيد الدفع",
    paymentMethod: "paymob",
    merchantAttemptKey: "ATTEMPT-LIVE",
    intentionState: "created",
    paymentReference: "INTENTION-LIVE",
    transactionId: "INTENTION-LIVE",
    paymentCheckoutUrl: "https://checkout.example/live",
    paymobOrderId: "ORDER-LIVE",
  });
  assert.equal(
    await service.cancelRejectedAddOnIntentionCreation("PAY-LIVE", "ADDON-LIVE"),
    false,
  );
  assert.equal(database.get("payments", "PAY-LIVE")?.status, "قيد الدفع");
  assert.equal(database.get("property_addons", "ADDON-LIVE")?.status, "pending");
});
