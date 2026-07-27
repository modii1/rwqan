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
  constructor(private readonly database: FakeFirestore) {}

  async get(ref: FakeDocumentReference): Promise<FakeSnapshot>;
  async get(ref: FakeQueryReference): Promise<FakeQuerySnapshot>;
  async get(
    ref: FakeDocumentReference | FakeQueryReference,
  ): Promise<FakeSnapshot | FakeQuerySnapshot> {
    if (ref instanceof FakeQueryReference) return ref.snapshot();
    return new FakeSnapshot(this.database, ref);
  }

  update(ref: FakeDocumentReference, updates: FakeData): void {
    this.database.update(ref.collectionName, ref.id, updates);
  }

  set(ref: FakeDocumentReference, data: FakeData): void {
    this.database.set(ref.collectionName, ref.id, data);
  }

  delete(ref: FakeDocumentReference): void {
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

test("subscription-group reservation allows only one concurrent upgrade payment", async () => {
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

  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof PaymentActionConflictError);
  const lock = database.get("payment_action_locks", "PROP-ROOT");
  assert.ok(lock?.paymentId === "PAY-ROOT" || lock?.paymentId === "PAY-CHILD");
  assert.equal(lock?.state, "reserved");
});

test("new-property reservation survives queue release and blocks a duplicate payment", async () => {
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

  await assert.rejects(
    () => service.createPayment(
      actionablePayment("PAY-NEW-SECOND", "PROP-NEW", { action: "new" }) as any,
    ),
    PaymentActionConflictError,
  );
  assert.equal(database.get("payment_action_locks", "PROP-NEW")?.state, "reserved");
  assert.equal(
    database.get("payment_action_locks", "PROP-NEW")?.paymentId,
    "PAY-NEW-FIRST",
  );
});

test("transaction-time eligibility changes are not reported as another payment", async () => {
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
    (error: unknown) => {
      assert.ok(error instanceof PaymentActionEligibilityError);
      assert.equal(error.code, "PAYMENT_ACTION_NO_LONGER_ELIGIBLE");
      return true;
    },
  );
  assert.equal(database.get("payment_action_locks", "PROP-EARLY"), undefined);
  assert.equal(database.get("payments", "PAY-TOO-EARLY"), undefined);
});

test("a legacy duplicate created before another fulfillment cannot also succeed", async () => {
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
  assert.equal(secondClaim.status, "action_conflict");
  assert.equal(database.get("payments", "PAY-FIRST")?.status, "مكتمل");
  assert.equal(database.get("payments", "PAY-SECOND")?.fulfilledAt, undefined);
});

test("rejection can claim a legacy payment without stealing another payment's action lock", async () => {
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

  assert.equal(
    database.get("payment_action_locks", "PROP-1")?.paymentId,
    "PAY-ACTIVE",
  );
  assert.equal(
    database.get("payment_action_locks", "PROP-1")?.state,
    "reserved",
  );
});

test("rejection releases the action lock owned by the rejected payment", async () => {
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

  assert.equal(
    database.get("payment_action_locks", "PROP-NEW")?.state,
    "released",
  );
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
  assert.equal(database.get("payment_action_locks", "PROP-1")?.paymentId, "PAY-RETRY");
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

test("overlapping A+B and B payments reserve the full requested set once", async () => {
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

  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(database.get("payment_action_locks", "PROP-A")?.paymentId, "PAY-A-B");
  assert.equal(database.get("payment_action_locks", "PROP-B")?.paymentId, "PAY-A-B");
  assert.equal(database.get("payments", "PAY-B"), undefined);
});

test("a requested property in another active group is rejected before any write", async () => {
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

  await assert.rejects(
    () => service.createPayment(actionablePayment("PAY-A-B", "PROP-A", {
      action: "new",
      additionalProperties: ["PROP-B"],
    }) as any),
    PaymentActionEligibilityError,
  );
  assert.equal(database.get("payments", "PAY-A-B"), undefined);
  assert.equal(database.get("payment_action_locks", "PROP-A"), undefined);
  assert.equal(database.get("payment_action_locks", "PROP-B"), undefined);
});

test("stale legacy child rows do not expand the former parent's lock group", async () => {
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
  assert.equal(database.get("payment_action_locks", "PROP-A")?.paymentId, "PAY-A");
  assert.equal(database.get("payment_action_locks", "PROP-B"), undefined);
  assert.equal(database.get("payment_action_locks", "PROP-C"), undefined);
});

test("legacy payments without an action normalize to new and block duplicates", async () => {
  const database = new FakeFirestore();
  database.set("payments", "PAY-LEGACY", {
    ...actionablePayment("PAY-LEGACY", "PROP-LEGACY", { action: undefined }),
    action: undefined,
  });
  const service = createService(database);
  const claim = await service.claimPaymentFulfillment("PAY-LEGACY", ["pending"]);
  assert.equal(claim.status, "claimed");

  await assert.rejects(
    () => service.createPayment(actionablePayment("PAY-NEW", "PROP-LEGACY", {
      action: "new",
    }) as any),
    PaymentActionConflictError,
  );
});

test("completed or provider-unknown lock owners cannot be taken over by status alone", async () => {
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

    await assert.rejects(
      () => service.createPayment(actionablePayment("PAY-TAKEOVER", "PROP-1", {
        action: "new",
      }) as any),
      PaymentActionConflictError,
    );
    assert.equal(
      database.get("payment_action_locks", "PROP-1")?.paymentId,
      "PAY-OWNER",
    );
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
  await assert.rejects(
    () => service.createPayment(actionablePayment("PAY-OTHER", "PROP-1", {
      action: "new",
    }) as any),
    PaymentActionConflictError,
  );

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
  assert.equal(
    (await service.createPayment(actionablePayment("PAY-OTHER", "PROP-1", {
      action: "new",
    }) as any)).id,
    "PAY-OTHER",
  );
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

test("retry completion verifies every lock and token before writing provider ids", async () => {
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
  database.update("payment_action_locks", "PROP-B", { state: "reserved" });

  await assert.rejects(
    () => service.completePaymentActionRetryReservation(
      "PAY-RETRY",
      retry.token,
      { paymentReference: "INT-NEW", transactionId: "INT-NEW" },
    ),
    PaymentActionConflictError,
  );
  assert.equal(database.get("payments", "PAY-RETRY")?.paymentReference, undefined);
  assert.equal(database.get("payments", "PAY-RETRY")?.retryReservationToken, retry.token);
  assert.equal(database.get("payment_action_locks", "PROP-A")?.state, "retrying");
});

test("a failed bank reference does not make a stale action lock unreleasable", async () => {
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
  assert.equal(
    database.get("payment_action_locks", "PROP-1")?.paymentId,
    "PAY-REPLACEMENT",
  );
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

test("successful callback acceptance stops on processing or fulfilled payments", async () => {
  for (const fulfillmentState of ["processing", "fulfilled"] as const) {
    const database = new FakeFirestore();
    database.set("payments", `PAY-${fulfillmentState}`, actionablePayment(
      `PAY-${fulfillmentState}`,
      "PROP-1",
      {
        action: "new",
        intentionState: "created",
        merchantAttemptKey: "ATTEMPT-1",
        paymentReference: "INT-1",
        transactionId: "INT-1",
        fulfillmentState,
      },
    ));
    const result = await createService(database).acceptSuccessfulPaymentIntention(
      `PAY-${fulfillmentState}`,
      {
        merchantAttemptKey: "ATTEMPT-1",
        transactionId: "TX-1",
        paymobOrderId: "ORDER-1",
        amountCents: 10_000,
        currency: "SAR",
      },
      { totalFees: 99 },
    );
    assert.equal(result.status, "already_processed");
    assert.equal(
      database.get("payments", `PAY-${fulfillmentState}`)?.totalFees,
      undefined,
    );
  }
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
    },
  ));
  const service = createService(database);
  const success = await service.settleAddOnPaymentCallback(
    "PAY-ADDON-1",
    {
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
    },
  ));
  const service = createService(database);
  const failure = await service.settleAddOnPaymentCallback(
    "PAY-ADDON-2",
    {
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
      },
    ));
    const service = createService(database);
    const successCall = () => service.settleAddOnPaymentCallback(
      paymentId,
      {
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
    },
  ));
  database.set("payments", "PAY-ADDON-OTHER", actionablePayment(
    "PAY-ADDON-OTHER",
    "PROP-2",
    { action: "addon", status: "قيد الدفع" },
  ));
  database.set("payments", "PAY-SUBSCRIPTION", actionablePayment(
    "PAY-SUBSCRIPTION",
    "PROP-3",
    { action: "new" },
  ));
  const service = createService(database);

  const common = {
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
