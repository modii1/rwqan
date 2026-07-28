import assert from "node:assert/strict";
import test from "node:test";

import {
  FirebaseService,
  LinkedPropertyMutationError,
  PaymentActionEligibilityError,
  SuspendedSubscriptionWriteError,
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

  set(
    collectionName: string,
    id: string,
    data: FakeData,
    merge = false,
  ): void {
    let collection = this.collections.get(collectionName);
    if (!collection) {
      collection = new Map();
      this.collections.set(collectionName, collection);
    }
    const existing = merge ? collection.get(id) : undefined;
    collection.set(id, { ...(existing || {}), ...data });
  }

  get(collectionName: string, id: string): FakeData | undefined {
    return this.collections.get(collectionName)?.get(id);
  }

  update(collectionName: string, id: string, updates: FakeData): void {
    const existing = this.get(collectionName, id);
    if (!existing) {
      throw new Error(`Missing fake document ${collectionName}/${id}`);
    }
    this.set(collectionName, id, updates, true);
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
}

class FakeSnapshot {
  constructor(
    private readonly database: FakeFirestore,
    readonly ref: FakeDocumentReference,
  ) {}

  get id(): string {
    return this.ref.id;
  }

  get exists(): boolean {
    return this.database.get(this.ref.collectionName, this.ref.id) !== undefined;
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

  set(
    ref: FakeDocumentReference,
    data: FakeData,
    options?: { merge?: boolean },
  ): void {
    this.database.set(ref.collectionName, ref.id, data, options?.merge === true);
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

function futureDate(days = 5): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function pastDate(days = 5): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function activeSubscription(
  propertyNumber: string,
  overrides: FakeData = {},
): FakeData {
  return {
    id: `SUB-${propertyNumber}`,
    propertyNumber,
    packageId: "PKG-GROUP",
    startDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    endDate: futureDate(),
    status: "active",
    subscriptionType: "premium",
    paymentId: "PAY-OLD",
    ...overrides,
  };
}

function seedPackage(database: FakeFirestore, maxProperties: number): void {
  database.set("packages", "PKG-GROUP", {
    id: "PKG-GROUP",
    name: "Group",
    duration: 30,
    price: 100,
    type: "premium",
    isActive: true,
    propertyCount: maxProperties,
    maxProperties,
  });
}

function seedProperty(database: FakeFirestore, propertyNumber: string): void {
  database.set("properties", propertyNumber, {
    propertyNumber,
    name: propertyNumber,
    subscriptionType: "normal",
    verificationStatus: "approved",
  });
}

function actionablePayment(
  id: string,
  propertyNumber: string,
  overrides: FakeData = {},
): FakeData {
  return {
    id,
    propertyNumber,
    packageId: "PKG-GROUP",
    amount: 100,
    finalAmount: 100,
    discountAmount: 0,
    status: "pending",
    action: "upgrade",
    ...overrides,
  };
}

test("an expired requested child that is still linked to a foreign parent is rejected", async () => {
  const database = new FakeFirestore();
  database.set("subscriptions", "SUB-PROP-B", activeSubscription("PROP-B", {
    linkedProperty: "PROP-C",
    status: "expired",
    endDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  }));

  await assert.rejects(
    () => createService(database).createPayment(actionablePayment(
      "PAY-A-B",
      "PROP-A",
      {
        action: "new",
        additionalProperties: ["PROP-B"],
      },
    ) as any),
    PaymentActionEligibilityError,
  );
  assert.equal(database.get("payments", "PAY-A-B"), undefined);
  assert.equal(database.get("payment_action_locks", "PROP-A"), undefined);
  assert.equal(database.get("payment_action_locks", "PROP-B"), undefined);
});

test("guarded expiry does not overwrite a newly active future subscription", async () => {
  const database = new FakeFirestore();
  seedProperty(database, "PROP-RACE-EXPIRY");
  database.update("properties", "PROP-RACE-EXPIRY", {
    subscriptionType: "مميز",
  });
  database.set(
    "subscriptions",
    "SUB-PROP-RACE-EXPIRY",
    activeSubscription("PROP-RACE-EXPIRY", {
      status: "منتهي",
      endDate: pastDate(),
    }),
  );
  const service = createService(database);

  const outcomes = await Promise.all([
    service.expireSubscriptionIfNeeded("SUB-PROP-RACE-EXPIRY"),
    service.addSubscriptionToSheet(
      "PROP-RACE-EXPIRY",
      {
        packageId: "PKG-GROUP",
        subscriptionType: "مميز",
        startDate: new Date().toISOString(),
        endDate: futureDate(20),
        paymentId: "PAY-NEW-ACTIVATION",
      },
      { propertyNumber: "PROP-RACE-EXPIRY" },
    ),
  ]);

  assert.equal(outcomes[0], true);
  assert.equal(
    database.get("subscriptions", "SUB-PROP-RACE-EXPIRY")?.status,
    "نشط",
  );
  assert.equal(
    database.get("subscriptions", "SUB-PROP-RACE-EXPIRY")?.paymentId,
    "PAY-NEW-ACTIVATION",
  );
  assert.equal(
    database.get("properties", "PROP-RACE-EXPIRY")?.subscriptionType,
    "مميز",
  );
});

test("guarded expiry ignores a future end date without cancellation metadata", async () => {
  const database = new FakeFirestore();
  seedProperty(database, "PROP-FUTURE");
  database.update("properties", "PROP-FUTURE", {
    subscriptionType: "مميز",
  });
  database.set(
    "subscriptions",
    "SUB-PROP-FUTURE",
    activeSubscription("PROP-FUTURE", {
      status: "منتهي",
      endDate: futureDate(20),
      cancelledAt: null,
    }),
  );

  const expired = await createService(database).expireSubscriptionIfNeeded(
    "SUB-PROP-FUTURE",
  );

  assert.equal(expired, false);
  assert.equal(
    database.get("properties", "PROP-FUTURE")?.subscriptionType,
    "مميز",
  );
});

test("concurrent additions cannot overflow package capacity or lose the winner", async () => {
  const database = new FakeFirestore();
  seedPackage(database, 2);
  for (const propertyNumber of ["PROP-A", "PROP-B", "PROP-C"]) {
    seedProperty(database, propertyNumber);
  }
  database.set("subscriptions", "SUB-PROP-A", activeSubscription("PROP-A", {
    linkedProperties: [],
    propertyCount: 1,
  }));
  const service = createService(database);

  const outcomes = await Promise.allSettled([
    service.mutateLinkedPropertyGroupAtomically({
      mainPropertyNumber: "PROP-A",
      addPropertyNumbers: ["PROP-B"],
      approveAddedProperties: true,
    }),
    service.mutateLinkedPropertyGroupAtomically({
      mainPropertyNumber: "PROP-A",
      addPropertyNumbers: ["PROP-C"],
      approveAddedProperties: true,
    }),
  ]);

  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof LinkedPropertyMutationError);
  assert.equal(rejected.reason.code, "PACKAGE_PROPERTY_LIMIT_EXCEEDED");
  const main = database.get("subscriptions", "SUB-PROP-A");
  assert.equal(main?.linkedProperties.length, 1);
  const winner = main?.linkedProperties[0];
  assert.ok(winner === "PROP-B" || winner === "PROP-C");
  assert.equal(
    database.get("subscriptions", `SUB-${winner}`)?.linkedProperty,
    "PROP-A",
  );
});

test("a processing payment lock blocks adding an affected child without partial writes", async () => {
  const database = new FakeFirestore();
  seedPackage(database, 3);
  for (const propertyNumber of ["PROP-A", "PROP-B"]) {
    seedProperty(database, propertyNumber);
  }
  database.set("subscriptions", "SUB-PROP-A", activeSubscription("PROP-A", {
    linkedProperties: [],
  }));
  database.set("payment_action_locks", "PROP-B", {
    propertyNumber: "PROP-B",
    paymentId: "PAY-PROCESSING",
    action: "new",
    state: "processing",
  });

  await assert.rejects(
    () => createService(database).mutateLinkedPropertyGroupAtomically({
      mainPropertyNumber: "PROP-A",
      addPropertyNumbers: ["PROP-B"],
    }),
    (error: unknown) => {
      assert.ok(error instanceof LinkedPropertyMutationError);
      assert.equal(error.code, "PAYMENT_ACTION_IN_PROGRESS");
      return true;
    },
  );
  assert.deepEqual(
    database.get("subscriptions", "SUB-PROP-A")?.linkedProperties,
    [],
  );
  assert.equal(database.get("subscriptions", "SUB-PROP-B"), undefined);
  assert.equal(database.get("properties", "PROP-B")?.linkedProperty, undefined);
});

test("atomic cancellation and unlink clears history so A and B reserve disjoint payments", async () => {
  const database = new FakeFirestore();
  seedPackage(database, 2);
  for (const propertyNumber of ["PROP-A", "PROP-B"]) {
    seedProperty(database, propertyNumber);
  }
  database.set("subscriptions", "SUB-PROP-A", activeSubscription("PROP-A", {
    linkedProperties: ["PROP-B"],
    propertyCount: 2,
  }));
  database.set("subscriptions", "SUB-PROP-B", activeSubscription("PROP-B", {
    linkedProperty: "PROP-A",
  }));
  database.set("multi_property_subscriptions", "MULTI-OLD", {
    id: "MULTI-OLD",
    packageId: "PKG-GROUP",
    propertyNumber1: "PROP-A",
    propertyNumber2: "PROP-B",
    linkedProperties: ["PROP-A", "PROP-B"],
    propertyCount: 2,
    startDate: new Date().toISOString(),
    endDate: futureDate(),
    status: "active",
    paymentId: "PAY-OLD",
  });
  const service = createService(database);

  await service.mutateLinkedPropertyGroupAtomically({
    mainPropertyNumber: "PROP-A",
    removePropertyNumbers: ["PROP-B"],
    cancelRemovedSubscriptions: true,
  });
  assert.equal(database.get("subscriptions", "SUB-PROP-B")?.linkedProperty, "");
  assert.deepEqual(database.get("subscriptions", "SUB-PROP-A")?.linkedProperties, []);
  assert.equal(database.get("multi_property_subscriptions", "MULTI-OLD"), undefined);

  const outcomes = await Promise.allSettled([
    service.createPayment(actionablePayment("PAY-A", "PROP-A") as any),
    service.createPayment(actionablePayment("PAY-B", "PROP-B", {
      action: "new",
    }) as any),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 2);
  assert.equal(database.get("payment_action_locks", "PROP-A")?.paymentId, "PAY-A");
  assert.equal(database.get("payment_action_locks", "PROP-B")?.paymentId, "PAY-B");
});

test("owner-style unlink consumes the inherited entitlement before its slot is reused", async () => {
  const database = new FakeFirestore();
  seedPackage(database, 2);
  for (const propertyNumber of ["PROP-A", "PROP-B", "PROP-C"]) {
    seedProperty(database, propertyNumber);
  }
  database.set("subscriptions", "SUB-PROP-A", activeSubscription("PROP-A", {
    linkedProperties: [],
    propertyCount: 1,
  }));
  const service = createService(database);

  await service.mutateLinkedPropertyGroupAtomically({
    mainPropertyNumber: "PROP-A",
    addPropertyNumbers: ["PROP-B"],
    approveAddedProperties: true,
  });
  assert.equal(database.get("subscriptions", "SUB-PROP-B")?.status, "active");
  assert.equal(database.get("properties", "PROP-B")?.subscriptionType, "مميز");

  await service.mutateLinkedPropertyGroupAtomically({
    mainPropertyNumber: "PROP-A",
    removePropertyNumbers: ["PROP-B"],
    cancelRemovedSubscriptions: true,
  });
  assert.equal(database.get("subscriptions", "SUB-PROP-B")?.status, "منتهي");
  assert.equal(database.get("subscriptions", "SUB-PROP-B")?.linkedProperty, "");
  assert.equal(database.get("properties", "PROP-B")?.subscriptionType, "عادي");

  await service.mutateLinkedPropertyGroupAtomically({
    mainPropertyNumber: "PROP-A",
    addPropertyNumbers: ["PROP-C"],
    approveAddedProperties: true,
  });
  await assert.rejects(
    () => service.mutateLinkedPropertyGroupAtomically({
      mainPropertyNumber: "PROP-A",
      addPropertyNumbers: ["PROP-B"],
      approveAddedProperties: true,
    }),
    (error: unknown) => {
      assert.ok(error instanceof LinkedPropertyMutationError);
      assert.equal(error.code, "PACKAGE_PROPERTY_LIMIT_EXCEEDED");
      return true;
    },
  );

  const activePremiumChildren = ["PROP-B", "PROP-C"].filter(
    (propertyNumber) =>
      database.get("subscriptions", `SUB-${propertyNumber}`)?.status === "active" &&
      database.get("properties", propertyNumber)?.subscriptionType === "مميز",
  );
  assert.deepEqual(activePremiumChildren, ["PROP-C"]);
  assert.deepEqual(
    database.get("subscriptions", "SUB-PROP-A")?.linkedProperties,
    ["PROP-C"],
  );
});

test("unlink clears stale parent history without cancelling a newer standalone entitlement", async () => {
  const database = new FakeFirestore();
  seedPackage(database, 2);
  for (const propertyNumber of ["PROP-A", "PROP-B"]) {
    seedProperty(database, propertyNumber);
  }
  database.set("subscriptions", "SUB-PROP-A", activeSubscription("PROP-A", {
    linkedProperties: ["PROP-B"],
    propertyCount: 2,
  }));
  database.set("subscriptions", "OLD-PROP-B-LINK", activeSubscription("PROP-B", {
    id: "OLD-PROP-B-LINK",
    linkedProperty: "PROP-A",
    endDate: futureDate(2),
    paymentId: "PAY-GROUP",
  }));
  database.set("subscriptions", "NEW-PROP-B-OWN", activeSubscription("PROP-B", {
    id: "NEW-PROP-B-OWN",
    linkedProperty: "",
    endDate: futureDate(8),
    paymentId: "PAY-B-OWN",
  }));
  database.update("properties", "PROP-B", {
    subscriptionType: "مميز",
    linkedProperty: "",
  });

  await createService(database).mutateLinkedPropertyGroupAtomically({
    mainPropertyNumber: "PROP-A",
    removePropertyNumbers: ["PROP-B"],
    cancelRemovedSubscriptions: true,
  });

  assert.equal(database.get("subscriptions", "OLD-PROP-B-LINK")?.linkedProperty, "");
  assert.equal(database.get("subscriptions", "OLD-PROP-B-LINK")?.status, "active");
  assert.equal(database.get("subscriptions", "NEW-PROP-B-OWN")?.status, "active");
  assert.equal(database.get("subscriptions", "NEW-PROP-B-OWN")?.paymentId, "PAY-B-OWN");
  assert.equal(database.get("properties", "PROP-B")?.subscriptionType, "مميز");
  assert.deepEqual(database.get("subscriptions", "SUB-PROP-A")?.linkedProperties, []);
});

function suspensionUpdate(propertyNumber: string, endDate: string) {
  return {
    subscriptionId: `SUB-${propertyNumber}`,
    propertyNumber,
    subscriptionUpdates: {
      status: "موقوف مؤقتاً" as const,
      endDate,
      suspendedAt: new Date().toISOString(),
      remainingDurationMs: 5 * 24 * 60 * 60 * 1000,
    },
    propertySubscriptionType: "عادي" as const,
  };
}

test("a concurrent suspension cannot be undone by an activation property mirror", async () => {
  const database = new FakeFirestore();
  const endDate = futureDate(5);
  seedProperty(database, "PROP-RACE");
  database.set(
    "subscriptions",
    "SUB-PROP-RACE",
    activeSubscription("PROP-RACE", { endDate }),
  );
  const service = createService(database);

  const outcomes = await Promise.allSettled([
    service.addSubscriptionToSheet(
      "PROP-RACE",
      {
        packageId: "PKG-GROUP",
        subscriptionType: "مميز",
        startDate: new Date().toISOString(),
        endDate,
        paymentId: "PAY-RACING-ACTIVATION",
      },
      { propertyNumber: "PROP-RACE" },
    ),
    service.updateSubscriptionLifecycleGroup([
      suspensionUpdate("PROP-RACE", endDate),
    ]),
  ]);

  assert.equal(outcomes.every((outcome) => outcome.status === "fulfilled"), true);
  assert.equal(
    database.get("subscriptions", "SUB-PROP-RACE")?.status,
    "موقوف مؤقتاً",
  );
  assert.equal(
    database.get("properties", "PROP-RACE")?.subscriptionType,
    "عادي",
  );
});

test("activation started after suspension is rejected at the transaction boundary", async () => {
  const database = new FakeFirestore();
  const endDate = futureDate(5);
  seedProperty(database, "PROP-STOP-FIRST");
  database.set(
    "subscriptions",
    "SUB-PROP-STOP-FIRST",
    activeSubscription("PROP-STOP-FIRST", { endDate }),
  );
  const service = createService(database);

  await service.updateSubscriptionLifecycleGroup([
    suspensionUpdate("PROP-STOP-FIRST", endDate),
  ]);
  await assert.rejects(
    () => service.addSubscriptionToSheet(
      "PROP-STOP-FIRST",
      {
        packageId: "PKG-GROUP",
        subscriptionType: "مميز",
        startDate: new Date().toISOString(),
        endDate,
        paymentId: "PAY-AFTER-STOP",
      },
      { propertyNumber: "PROP-STOP-FIRST" },
    ),
    SuspendedSubscriptionWriteError,
  );

  assert.equal(
    database.get("subscriptions", "SUB-PROP-STOP-FIRST")?.status,
    "موقوف مؤقتاً",
  );
  assert.equal(
    database.get("properties", "PROP-STOP-FIRST")?.subscriptionType,
    "عادي",
  );
});

test("lifecycle writes discover a newly linked child from the current main record", async () => {
  const database = new FakeFirestore();
  const endDate = futureDate(5);
  for (const propertyNumber of ["PROP-GROUP-MAIN", "PROP-GROUP-CHILD"]) {
    seedProperty(database, propertyNumber);
  }
  database.set(
    "subscriptions",
    "SUB-PROP-GROUP-MAIN",
    activeSubscription("PROP-GROUP-MAIN", {
      endDate,
      linkedProperties: ["PROP-GROUP-CHILD"],
    }),
  );
  database.set(
    "subscriptions",
    "SUB-PROP-GROUP-CHILD",
    activeSubscription("PROP-GROUP-CHILD", {
      endDate,
      linkedProperty: "PROP-GROUP-MAIN",
    }),
  );

  await createService(database).updateSubscriptionLifecycleGroup([
    suspensionUpdate("PROP-GROUP-MAIN", endDate),
  ]);

  for (const propertyNumber of ["PROP-GROUP-MAIN", "PROP-GROUP-CHILD"]) {
    assert.equal(
      database.get("subscriptions", `SUB-${propertyNumber}`)?.status,
      "موقوف مؤقتاً",
    );
    assert.equal(
      database.get("properties", propertyNumber)?.subscriptionType,
      "عادي",
    );
  }
});

test("direct activation, linked sync, generic updates, and verification cannot bypass suspension", async () => {
  const database = new FakeFirestore();
  const endDate = futureDate(5);
  for (const propertyNumber of ["PROP-LOCKED", "PROP-LOCKED-CHILD"]) {
    seedProperty(database, propertyNumber);
  }
  database.update("properties", "PROP-LOCKED", {
    verificationStatus: "pending",
  });
  database.set(
    "subscriptions",
    "SUB-PROP-LOCKED",
    activeSubscription("PROP-LOCKED", {
      endDate,
      status: "موقوف مؤقتاً",
      linkedProperties: ["PROP-LOCKED-CHILD"],
    }),
  );
  database.set(
    "subscriptions",
    "SUB-PROP-LOCKED-CHILD",
    activeSubscription("PROP-LOCKED-CHILD", {
      endDate,
      linkedProperty: "PROP-LOCKED",
    }),
  );
  const service = createService(database);

  await assert.rejects(
    () => service.activateSubscription("PROP-LOCKED", {
      status: "ساري",
      subscriptionType: "مميز",
      packageId: "PKG-GROUP",
      endDate,
    }),
    SuspendedSubscriptionWriteError,
  );
  await assert.rejects(
    () => service.createSubscription({
      propertyNumber: "PROP-LOCKED",
      packageId: "PKG-GROUP",
      paymentId: "PAY-CREATE-BYPASS",
      startDate: new Date().toISOString(),
      endDate,
      status: "ساري",
      subscriptionType: "مميز",
    } as any),
    SuspendedSubscriptionWriteError,
  );
  await assert.rejects(
    () => service.syncLinkedProperty(
      "PROP-LOCKED-CHILD",
      "PROP-LOCKED",
      {
        subscriptionType: "مميز",
        startDate: new Date().toISOString(),
        endDate,
        status: "ساري",
      },
    ),
    SuspendedSubscriptionWriteError,
  );
  await assert.rejects(
    () => service.updateSubscription("SUB-PROP-LOCKED", {
      status: "منتهي",
    }),
    SuspendedSubscriptionWriteError,
  );
  await assert.rejects(
    () => service.updateVerificationStatus("PROP-LOCKED", "approved"),
    SuspendedSubscriptionWriteError,
  );

  assert.equal(
    database.get("subscriptions", "SUB-PROP-LOCKED")?.status,
    "موقوف مؤقتاً",
  );
  assert.equal(
    database.get("subscriptions", "SUB-PROP-LOCKED-CHILD")?.paymentId,
    "PAY-OLD",
  );
  assert.equal(
    database.get("properties", "PROP-LOCKED")?.verificationStatus,
    "pending",
  );
});
