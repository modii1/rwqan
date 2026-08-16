import assert from "node:assert/strict";
import test from "node:test";

import {
  CommissionHoldOwnerChangeError,
  FirebaseService,
  LinkedPropertyMutationError,
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

  async get(): Promise<FakeSnapshot> {
    return new FakeSnapshot(this.database, this);
  }
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

  create(ref: FakeDocumentReference, data: FakeData): void {
    if (this.database.get(ref.collectionName, ref.id) !== undefined) {
      throw new Error(`Fake document already exists ${ref.collectionName}/${ref.id}`);
    }
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

test("an expired historical child link does not lock a new payment", async () => {
  const database = new FakeFirestore();
  database.set("subscriptions", "SUB-PROP-B", activeSubscription("PROP-B", {
    linkedProperty: "PROP-C",
    status: "expired",
    endDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  }));

  const payment = await createService(database).createPayment(actionablePayment(
    "PAY-A-B",
    "PROP-A",
    {
      action: "new",
      additionalProperties: ["PROP-B"],
    },
  ) as any);
  assert.equal(payment.id, "PAY-A-B");
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

test("guarded expiry downgrades both subscription metadata and property", async () => {
  const database = new FakeFirestore();
  seedProperty(database, "PROP-EXPIRED");
  database.update("properties", "PROP-EXPIRED", {
    subscriptionType: "مميز",
  });
  database.set(
    "subscriptions",
    "SUB-PROP-EXPIRED",
    activeSubscription("PROP-EXPIRED", {
      status: "ساري",
      endDate: pastDate(),
      subscriptionType: "مميز",
      packageType: "مميز",
    }),
  );

  const expired = await createService(database).expireSubscriptionIfNeeded(
    "SUB-PROP-EXPIRED",
  );

  assert.equal(expired, true);
  assert.equal(
    database.get("subscriptions", "SUB-PROP-EXPIRED")?.status,
    "منتهي",
  );
  assert.equal(
    database.get("subscriptions", "SUB-PROP-EXPIRED")?.subscriptionType,
    "عادي",
  );
  assert.equal(
    database.get("subscriptions", "SUB-PROP-EXPIRED")?.packageType,
    "عادي",
  );
  assert.equal(
    database.get("properties", "PROP-EXPIRED")?.subscriptionType,
    "عادي",
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

test("a legacy processing payment lock does not block adding an affected child", async () => {
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

  await createService(database).mutateLinkedPropertyGroupAtomically({
    mainPropertyNumber: "PROP-A",
    addPropertyNumbers: ["PROP-B"],
  });
  assert.deepEqual(
    database.get("subscriptions", "SUB-PROP-A")?.linkedProperties,
    ["PROP-B"],
  );
  assert.equal(database.get("subscriptions", "SUB-PROP-B")?.linkedProperty, "PROP-A");
  assert.equal(database.get("properties", "PROP-B")?.linkedProperty, "PROP-A");
  assert.equal(database.get("payment_action_locks", "PROP-B")?.state, "processing");
});

test("atomic cancellation and unlink leaves A and B independently payable without locks", async () => {
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
  assert.equal(database.get("payment_action_locks", "PROP-A"), undefined);
  assert.equal(database.get("payment_action_locks", "PROP-B"), undefined);
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

test("unconditional unlink restores the child snapshot and leaves main lifecycle fields unchanged", async () => {
  const database = new FakeFirestore();
  seedPackage(database, 2);
  for (const propertyNumber of ["PROP-A", "PROP-B"]) {
    seedProperty(database, propertyNumber);
  }
  const originalChildSubscription = activeSubscription("PROP-B", {
    packageId: "PKG-OLD",
    subscriptionType: "normal",
    packageType: "normal",
    status: "expired",
    startDate: pastDate(30),
    endDate: pastDate(2),
    paymentId: "PAY-B-OLD",
    cancelledAt: "2026-01-01T00:00:00.000Z",
    cancelReason: "old reason",
  });
  database.set("subscriptions", "SUB-PROP-A", activeSubscription("PROP-A", {
    linkedProperties: [],
    propertyCount: 1,
  }));
  database.set("subscriptions", "SUB-PROP-B", originalChildSubscription);
  database.update("properties", "PROP-B", {
    subscriptionType: "normal",
    verificationStatus: "pending",
    subscriptionDate: "2026-01-01",
    lastUpdate: "2026-01-02",
  });
  const service = createService(database);

  await service.mutateLinkedPropertyGroupAtomically({
    mainPropertyNumber: "PROP-A",
    addPropertyNumbers: ["PROP-B"],
    approveAddedProperties: true,
  });

  database.update("subscriptions", "SUB-PROP-A", {
    status: "موقوف مؤقتاً",
    endDate: pastDate(1),
    suspendedAt: "2026-07-01T00:00:00.000Z",
  });
  database.set("payment_action_locks", "PROP-A", {
    propertyNumber: "PROP-A",
    paymentId: "PAY-PROCESSING",
    action: "upgrade",
    state: "processing",
  });
  const mainBeforeUnlink = { ...database.get("subscriptions", "SUB-PROP-A") };

  await service.unlinkLinkedPropertiesAtomically({
    mainPropertyNumber: "PROP-A",
    propertyNumbers: ["PROP-B"],
  });

  const mainAfterUnlink = database.get("subscriptions", "SUB-PROP-A")!;
  assert.deepEqual(mainAfterUnlink.linkedProperties, []);
  assert.equal(mainAfterUnlink.propertyCount, 1);
  for (const field of [
    "packageId",
    "startDate",
    "endDate",
    "status",
    "paymentId",
    "suspendedAt",
  ]) {
    assert.equal(mainAfterUnlink[field], mainBeforeUnlink[field]);
  }

  const restoredChild = database.get("subscriptions", "SUB-PROP-B")!;
  for (const field of [
    "packageId",
    "subscriptionType",
    "packageType",
    "startDate",
    "endDate",
    "status",
    "paymentId",
    "cancelledAt",
    "cancelReason",
  ]) {
    assert.equal(restoredChild[field], originalChildSubscription[field]);
  }
  assert.equal(restoredChild.linkedProperty, undefined);

  const restoredProperty = database.get("properties", "PROP-B")!;
  assert.equal(restoredProperty.subscriptionType, "normal");
  assert.equal(restoredProperty.verificationStatus, "pending");
  assert.equal(restoredProperty.subscriptionDate, "2026-01-01");
  assert.equal(restoredProperty.lastUpdate, "2026-01-02");
  assert.equal(restoredProperty.linkedProperty, "");
  assert.equal(restoredProperty.pendingApprovalFrom, "");
  assert.equal(restoredProperty.linkedPropertyRestoreState, undefined);
});

test("direct linked activation also captures the child's pre-link state", async () => {
  const database = new FakeFirestore();
  seedProperty(database, "PROP-A");
  seedProperty(database, "PROP-B");
  database.set("subscriptions", "SUB-PROP-A", activeSubscription("PROP-A", {
    linkedProperties: [],
    propertyCount: 1,
  }));
  database.set("subscriptions", "SUB-PROP-B", activeSubscription("PROP-B", {
    packageId: "PKG-BEFORE",
    status: "expired",
    subscriptionType: "normal",
    endDate: pastDate(2),
    paymentId: "PAY-BEFORE",
  }));
  database.update("properties", "PROP-B", {
    subscriptionType: "normal",
    verificationStatus: "pending",
  });
  const service = createService(database);

  await service.addSubscriptionToSheet("PROP-B", {
    packageId: "PKG-GROUP",
    subscriptionType: "premium",
    startDate: new Date().toISOString(),
    endDate: futureDate(10),
    paymentId: "PAY-GROUP",
    linkedProperty: "PROP-A",
  }, database.get("properties", "PROP-B"), "");

  await service.unlinkLinkedPropertiesAtomically({
    mainPropertyNumber: "PROP-A",
    propertyNumbers: ["PROP-B"],
  });

  const restoredSubscription = database.get("subscriptions", "SUB-PROP-B")!;
  assert.equal(restoredSubscription.packageId, "PKG-BEFORE");
  assert.equal(restoredSubscription.status, "expired");
  assert.equal(restoredSubscription.subscriptionType, "normal");
  assert.equal(restoredSubscription.paymentId, "PAY-BEFORE");
  assert.equal(database.get("properties", "PROP-B")?.subscriptionType, "normal");
  assert.equal(database.get("properties", "PROP-B")?.verificationStatus, "pending");
});

test("unconditional unlink works from legacy membership without a main subscription", async () => {
  const database = new FakeFirestore();
  seedProperty(database, "PROP-A");
  seedProperty(database, "PROP-B");
  database.set("subscriptions", "SUB-PROP-B", activeSubscription("PROP-B", {
    linkedProperty: "PROP-A",
  }));
  database.update("properties", "PROP-B", {
    linkedProperty: "PROP-A",
    subscriptionType: "مميز",
  });
  database.set("multi_property_subscriptions", "MULTI-LEGACY", {
    id: "MULTI-LEGACY",
    packageId: "PKG-MISSING",
    propertyNumber1: "PROP-A",
    propertyNumber2: "PROP-B",
    linkedProperties: ["PROP-A", "PROP-B"],
    propertyCount: 2,
    startDate: pastDate(30),
    endDate: pastDate(1),
    status: "منتهي",
  });

  await createService(database).unlinkLinkedPropertiesAtomically({
    mainPropertyNumber: "PROP-A",
    propertyNumbers: ["PROP-B"],
  });

  assert.equal(database.get("multi_property_subscriptions", "MULTI-LEGACY"), undefined);
  assert.equal(database.get("subscriptions", "SUB-PROP-B")?.linkedProperty, "");
  assert.equal(database.get("subscriptions", "SUB-PROP-B")?.status, "منتهي");
  assert.equal(database.get("properties", "PROP-B")?.linkedProperty, "");
  assert.equal(database.get("properties", "PROP-B")?.subscriptionType, "عادي");
});

test("free-property daily contact quota accepts only three requests atomically", async () => {
  const database = new FakeFirestore();
  seedProperty(database, "PROP-FREE");
  const service = createService(database);
  const now = Date.now();
  const dailyLimit = {
    key: "PROP-FREE-DAY",
    windowStartedAt: now - 1_000,
    windowEndsAt: now + 60_000,
    maxAcceptedRequests: 3,
  };

  const outcomes = [];
  for (let index = 0; index < 4; index += 1) {
    outcomes.push(await service.createContactRequestWithCooldown(
      `VISITOR-${index}`,
      "PROP-FREE",
      0,
      {
        propertyNumber: "PROP-FREE",
        requestCode: `REQ-${index}`,
        timestamp: String(now),
        clientPhone: "512345678",
        ipAddress: `192.0.2.${index + 1}`,
        dayOfWeek: "الجمعة",
        hourOfDay: 12,
        deviceType: "mobile",
      },
      index + 1,
      {
        propertyNumber: "PROP-FREE",
        visitorKey: `VISITOR-${index}`,
        actorType: "anonymous",
        deviceType: "mobile",
        outcome: "accepted",
        requestCode: `REQ-${index}`,
      },
      undefined,
      dailyLimit,
    ));
  }

  assert.deepEqual(outcomes.map((outcome) => outcome.accepted), [true, true, true, false]);
  assert.deepEqual(
    outcomes.map((outcome) =>
      outcome.accepted ? outcome.dailyPropertyLimitReached : undefined
    ),
    [false, false, true, undefined],
  );
  assert.equal(
    outcomes[3].accepted ? undefined : outcomes[3].reason,
    "daily_property_limit",
  );
  assert.equal(database.query("requests", "propertyNumber", "PROP-FREE").length, 3);
  assert.equal(
    database.get("contact_property_daily_limits", "PROP-FREE-DAY")?.acceptedCount,
    3,
  );
});

test("contact acceptance writes booking follow-up only when the transactional subscription is free", async () => {
  const database = new FakeFirestore();
  seedProperty(database, "PROP-FREE-FOLLOWUP");
  seedProperty(database, "PROP-PREMIUM-FOLLOWUP");
  database.set(
    "subscriptions",
    "SUB-PROP-PREMIUM-FOLLOWUP",
    activeSubscription("PROP-PREMIUM-FOLLOWUP"),
  );
  database.set("subscriptions", "SUB-HISTORICAL-PROP-PREMIUM-FOLLOWUP", {
    ...activeSubscription("PROP-PREMIUM-FOLLOWUP"),
    id: "SUB-HISTORICAL-PROP-PREMIUM-FOLLOWUP",
    status: "expired",
    endDate: pastDate(),
    updatedAt: futureDate(30),
  });
  const service = createService(database);

  const acceptContact = (propertyNumber: string, bookingId: string) =>
    service.createContactRequestWithCooldown(
      `VISITOR-${propertyNumber}`,
      propertyNumber,
      0,
      {
        propertyNumber,
        requestCode: `REQ-${propertyNumber}`,
        timestamp: String(Date.now()),
        clientPhone: "512345678",
        ipAddress: "192.0.2.20",
        dayOfWeek: "الجمعة",
        hourOfDay: 12,
        deviceType: "mobile",
      },
      1,
      {
        propertyNumber,
        visitorKey: `VISITOR-${propertyNumber}`,
        actorType: "anonymous",
        deviceType: "mobile",
        outcome: "accepted",
        requestCode: `REQ-${propertyNumber}`,
        bookingFollowUpStatus: "scheduled",
      },
      undefined,
      undefined,
      {
        followUp: {
          id: bookingId,
          propertyNumber,
          isFreeProperty: true,
        },
        customerNotification: {
          id: `${bookingId}--customer_followup`,
          bookingId,
        },
      },
    );

  const freeOutcome = await acceptContact(
    "PROP-FREE-FOLLOWUP",
    "BOOK-FREE-FOLLOWUP",
  );
  const premiumOutcome = await acceptContact(
    "PROP-PREMIUM-FOLLOWUP",
    "BOOK-PREMIUM-FOLLOWUP",
  );

  assert.equal(freeOutcome.accepted, true);
  assert.equal(premiumOutcome.accepted, true);
  assert.ok(database.get("booking_followups", "BOOK-FREE-FOLLOWUP"));
  assert.ok(
    database.get(
      "booking_notification_outbox",
      "BOOK-FREE-FOLLOWUP--customer_followup",
    ),
  );
  assert.equal(database.get("booking_followups", "BOOK-PREMIUM-FOLLOWUP"), undefined);
  assert.equal(
    database.get(
      "booking_notification_outbox",
      "BOOK-PREMIUM-FOLLOWUP--customer_followup",
    ),
    undefined,
  );
  assert.equal(
    database.query("requests", "propertyNumber", "PROP-PREMIUM-FOLLOWUP").length,
    1,
  );
  assert.equal(
    database.query("contact_events", "propertyNumber", "PROP-PREMIUM-FOLLOWUP").length,
    1,
  );
  assert.equal(
    database.query("contact_events", "propertyNumber", "PROP-PREMIUM-FOLLOWUP")[0]
      ?.data()?.bookingFollowUpStatus,
    undefined,
  );
});

test("contact acceptance atomically rejects a property with a commission hold", async () => {
  const database = new FakeFirestore();
  seedProperty(database, "PROP-HELD");
  database.update("properties", "PROP-HELD", {
    commissionHold: { active: true, obligationIds: ["BOOK-1"] },
  });
  const service = createService(database);

  const outcome = await service.createContactRequestWithCooldown(
    "VISITOR-HELD",
    "PROP-HELD",
    0,
    {
      propertyNumber: "PROP-HELD",
      requestCode: "REQ-HELD",
      timestamp: String(Date.now()),
      clientPhone: "512345678",
      ipAddress: "192.0.2.10",
      dayOfWeek: "الجمعة",
      hourOfDay: 12,
      deviceType: "mobile",
    },
    1,
    {
      propertyNumber: "PROP-HELD",
      visitorKey: "VISITOR-HELD",
      actorType: "anonymous",
      deviceType: "mobile",
      outcome: "accepted",
      requestCode: "REQ-HELD",
    },
  );

  assert.deepEqual(outcome, {
    accepted: false,
    remainingMs: 0,
    reason: "property_unavailable",
  });
  assert.equal(database.query("requests", "propertyNumber", "PROP-HELD").length, 0);
});

test("property phone transfer is atomically blocked by a commission hold but canonical formatting is allowed", async () => {
  const database = new FakeFirestore();
  seedProperty(database, "PROP-HELD-PHONE");
  database.update("properties", "PROP-HELD-PHONE", {
    whatsappNumber: "0501234567",
    commissionHold: { active: true, obligationIds: ["BOOK-1"] },
  });
  const service = createService(database);

  const sameOwner = await service.updateProperty("PROP-HELD-PHONE", {
    whatsappNumber: "+966 50 123 4567",
  });
  assert.equal(sameOwner.whatsappNumber, "+966 50 123 4567");

  await assert.rejects(
    () => service.updateProperty("PROP-HELD-PHONE", {
      whatsappNumber: "0501234599",
    }),
    (error: unknown) =>
      error instanceof CommissionHoldOwnerChangeError &&
      error.status === 423 &&
      error.code === "COMMISSION_HOLD_ACTIVE",
  );
  assert.equal(
    database.get("properties", "PROP-HELD-PHONE")?.whatsappNumber,
    "+966 50 123 4567",
  );

  database.update("properties", "PROP-HELD-PHONE", {
    commissionHold: { active: false, obligationIds: [] },
  });
  const transferred = await service.updateProperty("PROP-HELD-PHONE", {
    whatsappNumber: "0501234599",
  });
  assert.equal(transferred.whatsappNumber, "0501234599");
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
