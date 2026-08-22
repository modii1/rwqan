import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOKING_ADMIN_CUSTOMER_WHATSAPP_COOLDOWN_MS,
  DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
  bookingFollowUpRecordSchema,
} from "../../shared/booking";
import {
  BOOKING_FOLLOW_UP_DELAY_MS,
  BOOKING_CUSTOMER_RESPONSE_WINDOW_MS,
  BOOKING_OWNER_NOTICE_RETRY_MS,
  BookingCommissionStore,
  BookingWorkflowError,
  buildInitialBookingWorkflow,
  latestCommissionReminderOffsetDue,
} from "./BookingCommissionStore";

const now = new Date("2026-08-15T12:34:56.789Z");

type FakeData = Record<string, any>;

class FakeFirestore {
  private readonly collections = new Map<string, Map<string, FakeData>>();
  readonly queryLog: Array<{
    collection: string;
    filters: Array<{ field: string; operator: string; value: unknown }>;
    orderBy: Array<{ field: string; direction: string }>;
    limit: number;
  }> = [];

  collection(name: string) {
    return {
      doc: (id: string) => new FakeDocumentReference(this, name, id),
      where: (field: string, operator: string, value: unknown) =>
        new FakeQuery(this, name).where(field, operator, value),
    };
  }

  async runTransaction<T>(operation: (transaction: FakeTransaction) => Promise<T>): Promise<T> {
    return operation(new FakeTransaction(this));
  }

  batch() {
    const updates: Array<{
      ref: FakeDocumentReference;
      data: FakeData;
    }> = [];
    return {
      update: (ref: FakeDocumentReference, data: FakeData) => {
        updates.push({ ref, data });
      },
      commit: async () => {
        for (const update of updates) {
          this.update(
            update.ref.collectionName,
            update.ref.id,
            update.data,
          );
        }
      },
    };
  }

  seed(collection: string, id: string, data: FakeData): void {
    let documents = this.collections.get(collection);
    if (!documents) {
      documents = new Map();
      this.collections.set(collection, documents);
    }
    documents.set(id, { ...data });
  }

  read(collection: string, id: string): FakeData | undefined {
    const value = this.collections.get(collection)?.get(id);
    return value ? { ...value } : undefined;
  }

  entries(collection: string): Array<[string, FakeData]> {
    return [...(this.collections.get(collection)?.entries() || [])]
      .map(([id, value]) => [id, { ...value }]);
  }

  update(collection: string, id: string, updates: FakeData): void {
    const current = this.read(collection, id);
    if (!current) throw new Error(`Missing fake document ${collection}/${id}`);
    this.seed(collection, id, { ...current, ...updates });
  }
}

class FakeQuery {
  private readonly filters: Array<{ field: string; operator: string; value: unknown }> = [];
  private max = Number.POSITIVE_INFINITY;
  private readonly ordering: Array<{ field: string; direction: string }> = [];
  private cursorId: string | null = null;

  constructor(
    private readonly database: FakeFirestore,
    private readonly collectionName: string,
  ) {}

  where(field: string, operator: string, value: unknown): FakeQuery {
    this.filters.push({ field, operator, value });
    return this;
  }

  orderBy(field: string, direction = "asc"): FakeQuery {
    this.ordering.push({ field, direction });
    return this;
  }

  limit(value: number): FakeQuery {
    this.max = value;
    return this;
  }

  startAfter(snapshot: FakeSnapshot): FakeQuery {
    this.cursorId = snapshot.ref.id;
    return this;
  }

  async get() {
    this.database.queryLog.push({
      collection: this.collectionName,
      filters: [...this.filters],
      orderBy: [...this.ordering],
      limit: this.max,
    });
    const documents = (this.database as any).collections.get(this.collectionName) as
      | Map<string, FakeData>
      | undefined;
    const orderedDocs = [...(documents?.keys() || [])]
      .map((id) => new FakeSnapshot(
        new FakeDocumentReference(this.database, this.collectionName, id),
      ))
      .filter((snapshot) => this.filters.every(({ field, operator, value }) => {
        const actual = snapshot.data()?.[field];
        if (operator === "==") return actual === value;
        if (operator === "<=") {
          return typeof actual === "number" && typeof value === "number"
            ? actual <= value
            : String(actual) <= String(value);
        }
        throw new Error(`Unsupported fake query operator ${operator}`);
      }))
      .sort((left, right) => {
        for (const { field, direction } of this.ordering) {
          const comparison = String(left.data()?.[field] ?? "")
            .localeCompare(String(right.data()?.[field] ?? ""));
          if (comparison !== 0) return direction === "desc" ? -comparison : comparison;
        }
        return left.ref.id.localeCompare(right.ref.id);
      });
    const cursorIndex = this.cursorId
      ? orderedDocs.findIndex((snapshot) => snapshot.ref.id === this.cursorId)
      : -1;
    const docs = orderedDocs
      .slice(cursorIndex + 1)
      .slice(0, this.max);
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

class FakeDocumentReference {
  constructor(
    readonly database: FakeFirestore,
    readonly collectionName: string,
    readonly id: string,
  ) {}

  async get(): Promise<FakeSnapshot> {
    return new FakeSnapshot(this);
  }
}

class FakeSnapshot {
  constructor(readonly ref: FakeDocumentReference) {}

  get exists(): boolean {
    return this.ref.database.read(this.ref.collectionName, this.ref.id) !== undefined;
  }

  data(): FakeData | undefined {
    return this.ref.database.read(this.ref.collectionName, this.ref.id);
  }
}

class FakeTransaction {
  constructor(private readonly database: FakeFirestore) {}

  async get(ref: FakeDocumentReference | FakeQuery): Promise<FakeSnapshot | Awaited<ReturnType<FakeQuery["get"]>>> {
    if (ref instanceof FakeQuery) return ref.get();
    return new FakeSnapshot(ref);
  }

  update(ref: FakeDocumentReference, updates: FakeData): void {
    this.database.update(ref.collectionName, ref.id, updates);
  }

  create(ref: FakeDocumentReference, data: FakeData): void {
    if (this.database.read(ref.collectionName, ref.id)) {
      throw new Error(`Existing fake document ${ref.collectionName}/${ref.id}`);
    }
    this.database.seed(ref.collectionName, ref.id, data);
  }

  set(ref: FakeDocumentReference, data: FakeData): void {
    this.database.seed(ref.collectionName, ref.id, data);
  }
}

function buildWorkflow(isFreeProperty = true) {
  return buildInitialBookingWorkflow({
    requestCode: "REQ-13383-001",
    propertyNumber: "13383",
    propertyName: "شاليه الريف المائي",
    ownerPhone: "+966500000001",
    customerPhone: "+966500000002",
    customerSubject: "customer-subject-hmac",
    isFreeProperty,
    listedPriceOptionsHalalas: [75_000, 125_050],
    now,
  });
}

test("initial workflow schedules one customer follow-up exactly 24 hours later", () => {
  const { followUp, customerNotification } = buildWorkflow();
  const expectedDueAt = new Date(now.getTime() + BOOKING_FOLLOW_UP_DELAY_MS).toISOString();

  assert.equal(followUp.id, "BOOK-REQ-13383-001");
  assert.equal(followUp.createdAt, now.toISOString());
  assert.equal(followUp.updatedAt, now.toISOString());
  assert.equal(followUp.followUpDueAt, expectedDueAt);
  assert.deepEqual(followUp.listedPriceOptionsHalalas, [75_000, 125_050]);
  assert.equal(Date.parse(followUp.followUpDueAt) - now.getTime(), 24 * 60 * 60 * 1_000);
  assert.deepEqual(followUp.events, [
    { type: "contact_accepted", at: now.toISOString() },
    { type: "customer_followup_scheduled", at: now.toISOString() },
  ]);

  assert.deepEqual(customerNotification, {
    id: "BOOK-REQ-13383-001--customer_followup",
    bookingId: "BOOK-REQ-13383-001",
    propertyNumber: "13383",
    recipientRole: "customer",
    recipientPhone: "+966500000002",
    recipientQuotaKey: "customer-subject-hmac",
    kind: "customer_followup",
    reminderOffsetDays: null,
    scheduledAt: expectedDueAt,
    status: "pending",
    isFreeProperty: true,
    quotaCategory: "customer_followup",
    attempts: 0,
    leaseToken: null,
    leaseExpiresAt: null,
    claimedAt: null,
    sentAt: null,
    failedAt: null,
    suppressedAt: null,
    providerError: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
});

test("initial workflow snapshots a validated configurable follow-up delay", () => {
  const configured = buildInitialBookingWorkflow({
    requestCode: "REQ-13383-CONFIGURED",
    propertyNumber: "13383",
    propertyName: "شاليه الريف المائي",
    ownerPhone: "+966500000001",
    customerPhone: "+966500000002",
    customerSubject: "customer-subject-hmac",
    isFreeProperty: true,
    customerFollowUpDelayMinutes: 2_160,
    now,
  });
  const expectedDueAt = new Date(
    now.getTime() + 36 * 60 * 60 * 1_000,
  ).toISOString();
  assert.equal(configured.followUp.followUpDueAt, expectedDueAt);
  assert.equal(configured.customerNotification.scheduledAt, expectedDueAt);

  for (const customerFollowUpDelayMinutes of [0, 1.5, 7_201]) {
    assert.throws(() => buildInitialBookingWorkflow({
      requestCode: "REQ-13383-INVALID",
      propertyNumber: "13383",
      propertyName: "شاليه الريف المائي",
      ownerPhone: "+966500000001",
      customerPhone: "+966500000002",
      customerSubject: "customer-subject-hmac",
      isFreeProperty: true,
      customerFollowUpDelayMinutes,
      now,
    }));
  }
});

test("worker scans use single-field time indexes and retain exact status gates", async () => {
  const database = new FakeFirestore();
  const store = new BookingCommissionStore(database as any);
  const workflow = buildWorkflow();
  const expiredLease = new Date(now.getTime() - 60_000).toISOString();

  database.seed("booking_notification_outbox", "CLAIMED-EXPIRED", {
    ...workflow.customerNotification,
    id: "CLAIMED-EXPIRED",
    status: "claimed",
    leaseToken: "lease-expired",
    leaseExpiresAt: expiredLease,
  });
  database.seed("booking_notification_outbox", "SENT-WITH-OLD-LEASE", {
    ...workflow.customerNotification,
    id: "SENT-WITH-OLD-LEASE",
    status: "sent",
    leaseToken: null,
    leaseExpiresAt: expiredLease,
  });

  assert.equal(await store.recoverExpiredNotificationClaims(now), 1);
  assert.equal(database.read("booking_notification_outbox", "CLAIMED-EXPIRED")?.status, "pending");
  assert.equal(database.read("booking_notification_outbox", "SENT-WITH-OLD-LEASE")?.status, "sent");
  const recoveryQuery = database.queryLog.find((query) =>
    query.collection === "booking_notification_outbox" &&
    query.filters.some((filter) => filter.field === "leaseExpiresAt"));
  assert.deepEqual(recoveryQuery?.filters.map(({ field, operator }) => ({ field, operator })), [
    { field: "leaseExpiresAt", operator: "<=" },
  ]);
  assert.deepEqual(recoveryQuery?.orderBy, [
    { field: "leaseExpiresAt", direction: "asc" },
  ]);

  database.seed("booking_notification_outbox", "TERMINAL-DUE", {
    ...workflow.customerNotification,
    id: "TERMINAL-DUE",
    status: "sent",
    scheduledAt: new Date(now.getTime() - 120_000).toISOString(),
  });
  for (let index = 0; index < 105; index++) {
    database.seed("booking_notification_outbox", `TERMINAL-DUE-${index}`, {
      ...workflow.customerNotification,
      id: `TERMINAL-DUE-${index}`,
      status: "sent",
      scheduledAt: new Date(now.getTime() - 10_000_000 + index).toISOString(),
    });
  }
  database.seed("booking_followups", workflow.followUp.id, {
    ...workflow.followUp,
    contactRequestId: "CONTACT-QUERY-SHAPE",
  });
  database.seed("booking_notification_outbox", workflow.customerNotification.id, {
    ...workflow.customerNotification,
    scheduledAt: new Date(now.getTime() - 60_000).toISOString(),
  });

  const claims = await store.claimDueNotificationJobs(now, 1, {
    followUpNotificationsEnabled: true,
    commissionNotificationsEnabled: true,
  });
  assert.equal(claims.length, 1);
  assert.equal(claims[0].id, workflow.customerNotification.id);
  assert.equal(database.read("booking_notification_outbox", "TERMINAL-DUE")?.status, "sent");
  const dueQuery = database.queryLog.findLast((query) =>
    query.collection === "booking_notification_outbox" &&
    query.filters.some((filter) => filter.field === "scheduledAt"));
  assert.deepEqual(dueQuery?.filters.map(({ field, operator }) => ({ field, operator })), [
    { field: "scheduledAt", operator: "<=" },
  ]);
  assert.deepEqual(dueQuery?.orderBy, [
    { field: "scheduledAt", direction: "asc" },
  ]);
  assert.ok(
    database.queryLog.filter((query) =>
      query.collection === "booking_notification_outbox" &&
      query.filters.some((filter) => filter.field === "scheduledAt")).length >= 2,
    "terminal jobs filling the first page must not starve a later pending job",
  );

  for (let index = 0; index < 205; index++) {
    database.seed("booking_followups", `COMMISSION-CLOSED-${index}`, {
      ...workflow.followUp,
      id: `COMMISSION-CLOSED-${index}`,
      bookingStatus: "confirmed",
      commissionStatus: "paid",
      commissionDueAt: new Date(now.getTime() - 20_000_000 + index).toISOString(),
    });
  }
  database.seed("booking_followups", "COMMISSION-PENDING", {
    ...workflow.followUp,
    id: "COMMISSION-PENDING",
    bookingStatus: "confirmed",
    commissionStatus: "pending",
    disputeStatus: "none",
    commissionDueAt: new Date(now.getTime() - 60_000).toISOString(),
    enforcementDeferredUntil: null,
  });
  const candidates = await store.listCommissionEnforcementCandidates(now, 1);
  assert.deepEqual(candidates.map((candidate) => candidate.id), ["COMMISSION-PENDING"]);
  const commissionQuery = database.queryLog.findLast((query) =>
    query.collection === "booking_followups" &&
    query.filters.some((filter) => filter.field === "commissionDueAt"));
  assert.deepEqual(commissionQuery?.filters.map(({ field, operator }) => ({ field, operator })), [
    { field: "commissionDueAt", operator: "<=" },
  ]);
  assert.deepEqual(commissionQuery?.orderBy, [
    { field: "commissionDueAt", direction: "asc" },
  ]);
  assert.ok(
    database.queryLog.filter((query) =>
      query.collection === "booking_followups" &&
      query.filters.some((filter) => filter.field === "commissionDueAt")).length >= 2,
    "closed commissions filling the first page must not starve a later pending commission",
  );
});

test("initial workflow has no booking, commission, dispute, or enforcement outcome yet", () => {
  const { followUp } = buildWorkflow();

  assert.equal(followUp.bookingStatus, "awaiting_response");
  assert.equal(followUp.bookingDecision, null);
  assert.equal(followUp.questionnaireStartedAt, null);
  assert.equal(followUp.confirmationFacts, null);
  assert.equal(followUp.confirmedAt, null);
  assert.equal(followUp.declinedAt, null);
  assert.equal(followUp.commissionStatus, "not_applicable");
  assert.equal(followUp.commissionAmountHalalas, null);
  assert.equal(followUp.commissionDueAt, null);
  assert.equal(followUp.commissionPaidAt, null);
  assert.deepEqual(followUp.commissionReminderOffsetsSent, []);
  assert.equal(followUp.complianceStatus, "clear");
  assert.equal(followUp.activeAttemptId, null);
  assert.equal(followUp.paidAttemptId, null);
  assert.equal(followUp.disputeStatus, "none");
  assert.equal(followUp.disputedAt, null);
  assert.equal(followUp.disputeReason, null);
  assert.equal(followUp.enforcementDeferredUntil, null);
  assert.equal(followUp.enforcementLastError, null);
  assert.equal(followUp.isFreeProperty, true);
  assert.equal(followUp.freeEligibilityRevokedAt, null);

  assert.equal(bookingFollowUpRecordSchema.safeParse({
    id: followUp.id,
    contactRequestId: "CONTACT-DOC-1",
    requestCode: followUp.requestCode,
    propertyNumber: followUp.propertyNumber,
    customerSubject: followUp.customerSubject,
    followUpDueAt: followUp.followUpDueAt,
    createdAt: followUp.createdAt,
    updatedAt: followUp.updatedAt,
    bookingStatus: followUp.bookingStatus,
    commissionStatus: followUp.commissionStatus,
    complianceStatus: followUp.complianceStatus,
    confirmationFacts: followUp.confirmationFacts,
    confirmedAt: followUp.confirmedAt,
    declinedAt: followUp.declinedAt,
    commissionAmountHalalas: followUp.commissionAmountHalalas,
    commissionDueAt: followUp.commissionDueAt,
    commissionPaidAt: followUp.commissionPaidAt,
    commissionReminderOffsetsSent: followUp.commissionReminderOffsetsSent,
  }).success, true);
});

test("free-workflow settings fall back to env and persist idempotently with one audit event", async () => {
  const envNames = [
    "CUSTOMER_BOOKING_FOLLOWUP_DAILY_LIMIT",
    "CUSTOMER_BOOKING_FOLLOWUP_DELAY_MINUTES",
    "CUSTOMER_BOOKING_FOLLOWUP_DELAY_HOURS",
    "FREE_OWNER_BOOKING_NOTIFICATION_DAILY_LIMIT",
    "FREE_PROPERTY_DAILY_CONTACT_LIMIT",
  ] as const;
  const previousEnvironment = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  );
  const database = new FakeFirestore();
  const store = new BookingCommissionStore(database as any);
  const updatedAt = new Date("2026-08-18T10:00:00.000Z");
  const existingNotification = buildWorkflow().customerNotification;
  database.seed(
    "booking_notification_outbox",
    existingNotification.id,
    existingNotification,
  );

  try {
    process.env.CUSTOMER_BOOKING_FOLLOWUP_DAILY_LIMIT = "7";
    delete process.env.CUSTOMER_BOOKING_FOLLOWUP_DELAY_MINUTES;
    process.env.CUSTOMER_BOOKING_FOLLOWUP_DELAY_HOURS = "36";
    process.env.FREE_OWNER_BOOKING_NOTIFICATION_DAILY_LIMIT = "8";
    process.env.FREE_PROPERTY_DAILY_CONTACT_LIMIT = "9";

    const environmentSettings = {
      customerDailyLimit: 7,
      freeOwnerDailyLimit: 8,
      freePropertyContactDailyLimit: 9,
      customerFollowUpDelayMinutes: 2_160,
      whatsappTemplates: DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
      optionalCommissionReminderDays: [3, 4],
      updatedAt: null,
      updatedBy: "environment" as const,
      source: "environment" as const,
    };
    assert.deepEqual(await store.getFreeWorkflowSettings(), environmentSettings);
    process.env.CUSTOMER_BOOKING_FOLLOWUP_DELAY_MINUTES = "135";
    assert.equal(
      (await store.getFreeWorkflowSettings()).customerFollowUpDelayMinutes,
      135,
    );
    delete process.env.CUSTOMER_BOOKING_FOLLOWUP_DELAY_MINUTES;
    process.env.CUSTOMER_BOOKING_FOLLOWUP_DELAY_HOURS = "121";
    assert.equal(
      (await store.getFreeWorkflowSettings()).customerFollowUpDelayMinutes,
      1_440,
    );
    process.env.CUSTOMER_BOOKING_FOLLOWUP_DELAY_HOURS = "1.5";
    assert.equal(
      (await store.getFreeWorkflowSettings()).customerFollowUpDelayMinutes,
      1_440,
      "the legacy whole-hour variable must not gain fractional-hour semantics",
    );
    process.env.CUSTOMER_BOOKING_FOLLOWUP_DELAY_HOURS = "36";

    const configuration = {
      customerDailyLimit: 4,
      freeOwnerDailyLimit: 5,
      freePropertyContactDailyLimit: 6,
      customerFollowUpDelayMinutes: 2_880,
      whatsappTemplates: {
        ...DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
        property_released_paid:
          "{{propertyName}} ({{propertyNumber}}): paid and released",
      },
      optionalCommissionReminderDays: [3] as Array<3 | 4>,
    };
    const expected = {
      ...configuration,
      updatedAt: updatedAt.toISOString(),
      updatedBy: "admin" as const,
      source: "firestore" as const,
    };
    assert.deepEqual(
      await store.updateFreeWorkflowSettings(configuration, updatedAt),
      expected,
    );
    assert.deepEqual(await store.getFreeWorkflowSettings(), expected);
    assert.deepEqual(
      database.read("booking_notification_outbox", existingNotification.id),
      existingNotification,
      "changing the configured delay does not reschedule an existing job",
    );
    assert.deepEqual(database.read("settings", "booking_free_workflow_limits"), {
      schemaVersion: 5,
      ...configuration,
      updatedAt: updatedAt.toISOString(),
      updatedBy: "admin",
    });

    const auditEntries = database.entries("booking_free_workflow_limits_audit");
    assert.equal(auditEntries.length, 1);
    assert.match(auditEntries[0][0], /^BOOKING-LIMITS-\d+-[a-f0-9]{12}$/);
    assert.deepEqual(auditEntries[0][1], {
      id: auditEntries[0][0],
      type: "booking_free_workflow_settings_updated",
      previous: environmentSettings,
      next: configuration,
      updatedAt: updatedAt.toISOString(),
      updatedBy: "admin",
    });

    assert.deepEqual(
      await store.updateFreeWorkflowSettings(
        configuration,
        new Date("2026-08-18T11:00:00.000Z"),
      ),
      expected,
    );
    assert.equal(
      database.entries("booking_free_workflow_limits_audit").length,
      1,
      "an unchanged full replacement does not create another audit record",
    );

    for (const invalid of [
      { ...configuration, customerDailyLimit: -1 },
      { ...configuration, customerDailyLimit: 4.5 },
      { ...configuration, freePropertyContactDailyLimit: 1_001 },
      { ...configuration, customerFollowUpDelayMinutes: 0 },
      { ...configuration, customerFollowUpDelayMinutes: 1.5 },
      { ...configuration, customerFollowUpDelayMinutes: 7_201 },
      { ...configuration, whatsappTemplates: {} },
      { ...configuration, optionalCommissionReminderDays: [5] },
    ]) {
      await assert.rejects(() =>
        store.updateFreeWorkflowSettings(invalid as any, updatedAt));
    }
    await assert.rejects(() =>
      store.updateFreeWorkflowSettings(
        configuration,
        new Date("invalid"),
      ), RangeError);
    assert.equal(database.entries("booking_free_workflow_limits_audit").length, 1);
  } finally {
    for (const name of envNames) {
      const value = previousEnvironment[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("legacy limit-only settings migrate in memory without writing during GET", async () => {
  const database = new FakeFirestore();
  const legacy = {
    schemaVersion: 1,
    customerDailyLimit: 11,
    freeOwnerDailyLimit: 12,
    freePropertyContactDailyLimit: 13,
    updatedAt: "2026-08-18T09:00:00.000Z",
    updatedBy: "admin",
  };
  database.seed("settings", "booking_free_workflow_limits", legacy);

  assert.deepEqual(
    await new BookingCommissionStore(database as any).getFreeWorkflowSettings(),
    {
      customerDailyLimit: 11,
      freeOwnerDailyLimit: 12,
      freePropertyContactDailyLimit: 13,
      customerFollowUpDelayMinutes: 1_440,
      whatsappTemplates: DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
      optionalCommissionReminderDays: [3, 4],
      updatedAt: legacy.updatedAt,
      updatedBy: "admin",
      source: "firestore",
    },
  );
  assert.deepEqual(
    database.read("settings", "booking_free_workflow_limits"),
    legacy,
  );
  assert.equal(
    database.entries("booking_free_workflow_limits_audit").length,
    0,
  );

  await new BookingCommissionStore(database as any).updateFreeWorkflowSettings(
    {
      customerDailyLimit: 11,
      freeOwnerDailyLimit: 12,
      freePropertyContactDailyLimit: 13,
      customerFollowUpDelayMinutes: 1_440,
      whatsappTemplates: DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
      optionalCommissionReminderDays: [3, 4],
    },
    new Date("2026-08-18T10:00:00.000Z"),
  );
  assert.equal(
    database.read("settings", "booking_free_workflow_limits")
      ?.schemaVersion,
    5,
  );
  assert.equal(
    database.read("settings", "booking_free_workflow_limits")
      ?.customerFollowUpDelayMinutes,
    1_440,
  );
  assert.equal(
    database.entries("booking_free_workflow_limits_audit").length,
    1,
    "an explicit replacement persists and audits the migrated delay",
  );
});

test("schema-four whole-hour follow-up delay migrates to minutes on the next admin save", async () => {
  const database = new FakeFirestore();
  const legacy = {
    schemaVersion: 4,
    customerDailyLimit: 3,
    freeOwnerDailyLimit: 3,
    freePropertyContactDailyLimit: 3,
    customerFollowUpDelayHours: 36,
    whatsappTemplates: DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
    optionalCommissionReminderDays: [3, 4],
    updatedAt: "2026-08-18T09:00:00.000Z",
    updatedBy: "admin",
  };
  database.seed("settings", "booking_free_workflow_limits", legacy);
  const store = new BookingCommissionStore(database as any);

  const migrated = await store.getFreeWorkflowSettings();
  assert.equal(migrated.customerFollowUpDelayMinutes, 2_160);
  assert.deepEqual(
    database.read("settings", "booking_free_workflow_limits"),
    legacy,
    "read-time migration remains non-mutating",
  );

  await store.updateFreeWorkflowSettings({
    customerDailyLimit: migrated.customerDailyLimit,
    freeOwnerDailyLimit: migrated.freeOwnerDailyLimit,
    freePropertyContactDailyLimit: migrated.freePropertyContactDailyLimit,
    customerFollowUpDelayMinutes: migrated.customerFollowUpDelayMinutes,
    whatsappTemplates: migrated.whatsappTemplates,
    optionalCommissionReminderDays: migrated.optionalCommissionReminderDays,
  }, new Date("2026-08-18T10:00:00.000Z"));
  const persisted = database.read("settings", "booking_free_workflow_limits");
  assert.equal(persisted?.schemaVersion, 5);
  assert.equal(persisted?.customerFollowUpDelayMinutes, 2_160);
  assert.equal("customerFollowUpDelayHours" in (persisted || {}), false);
  assert.equal(
    database.entries("booking_free_workflow_limits_audit").length,
    1,
  );
});

test("malformed schema-four hour values do not become valid minute delays", async () => {
  const previousMinutes = process.env.CUSTOMER_BOOKING_FOLLOWUP_DELAY_MINUTES;
  process.env.CUSTOMER_BOOKING_FOLLOWUP_DELAY_MINUTES = "1440";
  try {
    for (const customerFollowUpDelayHours of [1.5, true]) {
      const database = new FakeFirestore();
      database.seed("settings", "booking_free_workflow_limits", {
        schemaVersion: 4,
        customerDailyLimit: 3,
        freeOwnerDailyLimit: 3,
        freePropertyContactDailyLimit: 3,
        customerFollowUpDelayHours,
        whatsappTemplates: DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
        optionalCommissionReminderDays: [3, 4],
        updatedAt: "2026-08-18T09:00:00.000Z",
        updatedBy: "admin",
      });

      assert.equal(
        (await new BookingCommissionStore(database as any)
          .getFreeWorkflowSettings()).customerFollowUpDelayMinutes,
        1_440,
      );
    }
  } finally {
    if (previousMinutes === undefined) {
      delete process.env.CUSTOMER_BOOKING_FOLLOWUP_DELAY_MINUTES;
    } else {
      process.env.CUSTOMER_BOOKING_FOLLOWUP_DELAY_MINUTES = previousMinutes;
    }
  }
});

test("legacy seven-template settings migrate per template without losing unrelated custom copy", async () => {
  const database = new FakeFirestore();
  const {
    commission_dispute_rejected: _newTemplate,
    ...legacyTemplates
  } = DEFAULT_BOOKING_WHATSAPP_TEMPLATES;
  const legacyOwnerFacts = `CUSTOM FACTS {{propertyName}} / {{propertyNumber}}
{{timing}} | {{bookingDate}} | {{pricePaidSar}}`;
  const legacyOwnerCommission = `CUSTOM COMMISSION {{propertyName}} / {{propertyNumber}}
{{timing}} | {{bookingDate}} | {{pricePaidSar}}
{{commissionPercent}} | {{commissionAmountSar}} | {{paymentWindowDays}} | {{paymentLink}}`;
  const stored = {
    schemaVersion: 2,
    customerDailyLimit: 7,
    freeOwnerDailyLimit: 8,
    freePropertyContactDailyLimit: 9,
    whatsappTemplates: {
      ...legacyTemplates,
      customer_followup: "CUSTOM {{propertyLabel}} {{followUpLink}}",
      owner_booking_facts: legacyOwnerFacts,
      owner_booking_commission: legacyOwnerCommission,
      property_released_paid: "CUSTOM PAID {{propertyName}} {{propertyNumber}}",
    },
    optionalCommissionReminderDays: [3],
    updatedAt: "2026-08-20T09:00:00.000Z",
    updatedBy: "admin",
  };
  database.seed("settings", "booking_free_workflow_limits", stored);

  const settings = await new BookingCommissionStore(database as any)
    .getFreeWorkflowSettings();

  assert.equal(
    settings.whatsappTemplates.customer_followup,
    "CUSTOM {{propertyLabel}} {{followUpLink}}",
  );
  assert.equal(settings.customerFollowUpDelayMinutes, 1_440);
  assert.equal(
    settings.whatsappTemplates.property_released_paid,
    "CUSTOM PAID {{propertyName}} {{propertyNumber}}",
  );
  assert.equal(
    settings.whatsappTemplates.owner_booking_facts,
    `${legacyOwnerFacts}\n\nرقم الطلب: {{requestCode}}\nرقم العميل: {{customerPhone}}`,
  );
  assert.equal(
    settings.whatsappTemplates.owner_booking_commission,
    `${legacyOwnerCommission}\n\nرقم الطلب: {{requestCode}}\nرقم العميل: {{customerPhone}}`,
  );
  assert.equal(
    settings.whatsappTemplates.commission_dispute_rejected,
    DEFAULT_BOOKING_WHATSAPP_TEMPLATES.commission_dispute_rejected,
  );
  assert.deepEqual(
    database.read("settings", "booking_free_workflow_limits"),
    stored,
    "read-time migration must not rewrite live settings",
  );
});

function confirmedObserveOnlyFixture() {
  const workflow = buildWorkflow();
  return {
    ...workflow.followUp,
    contactRequestId: "CONTACT-MANUAL-RESEND",
    bookingStatus: "confirmed" as const,
    bookingDecision: "yes" as const,
    confirmationFacts: {
      timing: "weekend" as const,
      bookingDate: { value: "2026-08-15", precision: "day" as const },
      pricePaidHalalas: 100_000,
    },
    confirmedAt: now.toISOString(),
    declinedAt: null,
    commissionStatus: "not_applicable" as const,
    commissionAmountHalalas: null,
    commissionDueAt: null,
    commissionNoticeSentAt: null,
    commissionPaidAt: null,
    commissionReminderOffsetsSent: [],
  };
}

function ownerNotificationFixture(
  booking: ReturnType<typeof confirmedObserveOnlyFixture>,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `${booking.id}--owner_booking_confirmed`,
    bookingId: booking.id,
    propertyNumber: booking.propertyNumber,
    recipientRole: "owner",
    recipientPhone: booking.ownerPhone,
    recipientQuotaKey: "500000001",
    kind: "owner_booking_confirmed",
    reminderOffsetDays: null,
    scheduledAt: now.toISOString(),
    status: "sent",
    isFreeProperty: true,
    quotaCategory: "free_owner_booking",
    attempts: 1,
    leaseToken: null,
    leaseExpiresAt: null,
    claimedAt: now.toISOString(),
    sentAt: now.toISOString(),
    failedAt: null,
    suppressedAt: null,
    providerError: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

test("manual resend creates one separate audited job and replays the same idempotency key", async () => {
  const database = new FakeFirestore();
  const booking = confirmedObserveOnlyFixture();
  const source = ownerNotificationFixture(booking);
  database.seed("booking_followups", booking.id, booking);
  database.seed("booking_notification_outbox", source.id, source);
  database.seed("properties", booking.propertyNumber, {
    propertyNumber: booking.propertyNumber,
    whatsappNumber: "0500000001",
    commissionHold: { active: false, obligationIds: [] },
  });
  const store = new BookingCommissionStore(database as any);
  const input = {
    bookingId: booking.id,
    sourceJobId: source.id,
    idempotencyKey: "admin-resend-key-00000001",
    now,
  };

  const first = await store.scheduleManualNotificationResend(input);
  const replay = await store.scheduleManualNotificationResend(input);

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.job.id, first.job.id);
  assert.equal(first.job.manualResendOfJobId, source.id);
  assert.equal(first.job.manualResendRequestedAt, now.toISOString());
  assert.equal(first.job.status, "pending");
  assert.equal(first.job.scheduledAt, now.toISOString());
  assert.deepEqual(
    database.read("booking_notification_outbox", source.id),
    source,
    "manual resend must not mutate the original notification history",
  );
  assert.equal(
    database.entries("booking_notification_outbox")
      .filter(([, job]) => job.manualResendOfJobId === source.id).length,
    1,
  );
  const audits = database.entries("booking_notification_manual_resend_audit");
  assert.equal(audits.length, 1);
  assert.equal(audits[0][1].sourceJobId, source.id);
  assert.equal(audits[0][1].resendJobId, first.job.id);
  assert.equal(JSON.stringify(audits[0][1]).includes("500000"), false);
  assert.equal(
    database.read("booking_followups", booking.id)?.events.at(-1)?.type,
    "notification_manual_resend_scheduled",
  );
});

test("manual resend rejects active jobs, superseded reminders, and release messages for held properties", async () => {
  for (const status of ["pending", "claimed"] as const) {
    const activeDatabase = new FakeFirestore();
    const activeBooking = confirmedObserveOnlyFixture();
    const activeSource = ownerNotificationFixture(activeBooking, {
      status,
      ...(status === "claimed" ? { leaseToken: "active-send-lease" } : {}),
    });
    activeDatabase.seed("booking_followups", activeBooking.id, activeBooking);
    activeDatabase.seed("booking_notification_outbox", activeSource.id, activeSource);
    await assert.rejects(
      () => new BookingCommissionStore(activeDatabase as any)
        .scheduleManualNotificationResend({
          bookingId: activeBooking.id,
          sourceJobId: activeSource.id,
          idempotencyKey: `admin-resend-active-${status}-000001`,
          now,
        }),
      (error: unknown) => error instanceof BookingWorkflowError &&
        error.code === (status === "claimed"
          ? "NOTIFICATION_SEND_IN_PROGRESS"
          : "NOTIFICATION_NOT_RESENDABLE"),
    );
    assert.equal(activeDatabase.entries("booking_notification_manual_resend_audit").length, 0);
  }

  const activeBooking = confirmedObserveOnlyFixture();

  const reminderDatabase = new FakeFirestore();
  const reminderBooking = {
    ...activeBooking,
    commissionStatus: "pending",
    commissionAmountHalalas: 10_000,
    commissionNoticeSentAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1_000).toISOString(),
    commissionDueAt: now.toISOString(),
    disputeStatus: "rejected",
  };
  const reminderSource = ownerNotificationFixture(reminderBooking as any, {
    id: `${reminderBooking.id}--commission_reminder_3`,
    kind: "commission_reminder_3",
    reminderOffsetDays: 3,
    quotaCategory: "transactional",
  });
  reminderDatabase.seed("booking_followups", reminderBooking.id, reminderBooking);
  reminderDatabase.seed("booking_notification_outbox", reminderSource.id, reminderSource);
  await assert.rejects(
    () => new BookingCommissionStore(reminderDatabase as any)
      .scheduleManualNotificationResend({
        bookingId: reminderBooking.id,
        sourceJobId: reminderSource.id,
        idempotencyKey: "admin-resend-reminder-0001",
        now,
      }),
    (error: unknown) => error instanceof BookingWorkflowError &&
      error.code === "NOTIFICATION_REMINDER_SUPERSEDED",
  );

  const releaseDatabase = new FakeFirestore();
  const releasedBooking = {
    ...activeBooking,
    commissionStatus: "paid",
    complianceStatus: "released",
  };
  const releaseSource = ownerNotificationFixture(releasedBooking as any, {
    id: `${releasedBooking.id}--property_released`,
    kind: "property_released",
    quotaCategory: "transactional",
  });
  releaseDatabase.seed("booking_followups", releasedBooking.id, releasedBooking);
  releaseDatabase.seed("booking_notification_outbox", releaseSource.id, releaseSource);
  releaseDatabase.seed("properties", releasedBooking.propertyNumber, {
    propertyNumber: releasedBooking.propertyNumber,
    whatsappNumber: "0500000001",
    commissionHold: { active: true, obligationIds: ["OTHER-BOOKING"] },
  });
  await assert.rejects(
    () => new BookingCommissionStore(releaseDatabase as any)
      .scheduleManualNotificationResend({
        bookingId: releasedBooking.id,
        sourceJobId: releaseSource.id,
        idempotencyKey: "admin-resend-release-00001",
        now,
      }),
    (error: unknown) => error instanceof BookingWorkflowError &&
      error.code === "NOTIFICATION_STATE_CHANGED",
  );
  assert.equal(releaseDatabase.entries("booking_notification_manual_resend_audit").length, 0);
});

test("manual resend enforces customer expiry, free-tier eligibility, and current owner identity", async () => {
  const expiredDatabase = new FakeFirestore();
  const workflow = buildWorkflow();
  const expiredBooking = {
    ...workflow.followUp,
    contactRequestId: "CONTACT-EXPIRED-MANUAL-RESEND",
  };
  const expiredSource = {
    ...workflow.customerNotification,
    status: "failed",
    attempts: 1,
    failedAt: workflow.customerNotification.scheduledAt,
  };
  expiredDatabase.seed("booking_followups", expiredBooking.id, expiredBooking);
  expiredDatabase.seed("booking_notification_outbox", expiredSource.id, expiredSource);
  await assert.rejects(
    () => new BookingCommissionStore(expiredDatabase as any)
      .scheduleManualNotificationResend({
        bookingId: expiredBooking.id,
        sourceJobId: expiredSource.id,
        idempotencyKey: "admin-resend-expired-customer-01",
        now: new Date(now.getTime() + BOOKING_CUSTOMER_RESPONSE_WINDOW_MS),
      }),
    (error: unknown) => error instanceof BookingWorkflowError &&
      error.code === "NOTIFICATION_STATE_CHANGED",
  );

  const premiumDatabase = new FakeFirestore();
  const premiumBooking = confirmedObserveOnlyFixture();
  const premiumSource = ownerNotificationFixture(premiumBooking);
  premiumDatabase.seed("booking_followups", premiumBooking.id, premiumBooking);
  premiumDatabase.seed("booking_notification_outbox", premiumSource.id, premiumSource);
  premiumDatabase.seed("properties", premiumBooking.propertyNumber, {
    propertyNumber: premiumBooking.propertyNumber,
    whatsappNumber: "0500000001",
  });
  premiumDatabase.seed("subscriptions", "SUB-MANUAL-RESEND", {
    id: "SUB-MANUAL-RESEND",
    propertyNumber: premiumBooking.propertyNumber,
    subscriptionType: "مميز",
    status: "ساري",
    endDate: "2099-12-31T00:00:00.000Z",
  });
  await assert.rejects(
    () => new BookingCommissionStore(premiumDatabase as any)
      .scheduleManualNotificationResend({
        bookingId: premiumBooking.id,
        sourceJobId: premiumSource.id,
        idempotencyKey: "admin-resend-premium-owner-001",
        now,
      }),
    (error: unknown) => error instanceof BookingWorkflowError &&
      error.code === "BOOKING_NOT_FOUND",
  );
  assert.equal(
    typeof premiumDatabase.read("booking_followups", premiumBooking.id)
      ?.freeEligibilityRevokedAt,
    "string",
  );
  assert.equal(premiumDatabase.entries("booking_notification_manual_resend_audit").length, 0);

  const ownerDatabase = new FakeFirestore();
  const ownerBooking = confirmedObserveOnlyFixture();
  const ownerSource = ownerNotificationFixture(ownerBooking);
  ownerDatabase.seed("booking_followups", ownerBooking.id, ownerBooking);
  ownerDatabase.seed("booking_notification_outbox", ownerSource.id, ownerSource);
  ownerDatabase.seed("properties", ownerBooking.propertyNumber, {
    propertyNumber: ownerBooking.propertyNumber,
    whatsappNumber: "0500000099",
  });
  await assert.rejects(
    () => new BookingCommissionStore(ownerDatabase as any)
      .scheduleManualNotificationResend({
        bookingId: ownerBooking.id,
        sourceJobId: ownerSource.id,
        idempotencyKey: "admin-resend-owner-changed-001",
        now,
      }),
    (error: unknown) => error instanceof BookingWorkflowError &&
      error.code === "OWNER_IDENTITY_CHANGED",
  );
  assert.equal(ownerDatabase.entries("booking_notification_manual_resend_audit").length, 0);
});

test("a rejected-dispute notification is cancelled if payment closes before claim", async () => {
  const database = new FakeFirestore();
  const booking = {
    ...confirmedObserveOnlyFixture(),
    commissionStatus: "paid",
    commissionAmountHalalas: 10_000,
    commissionNoticeSentAt: new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
    commissionDueAt: new Date(now.getTime() + 4 * 24 * 60 * 60 * 1_000).toISOString(),
    commissionPaidAt: now.toISOString(),
    disputeStatus: "rejected",
  };
  const job = ownerNotificationFixture(booking as any, {
    id: `${booking.id}--commission_dispute_rejected`,
    kind: "commission_dispute_rejected",
    status: "pending",
    attempts: 0,
    claimedAt: null,
    sentAt: null,
    scheduledAt: now.toISOString(),
    quotaCategory: "transactional",
  });
  database.seed("booking_followups", booking.id, booking);
  database.seed("booking_notification_outbox", job.id, job);

  assert.deepEqual(
    await new BookingCommissionStore(database as any).claimDueNotificationJobs(
      now,
      5,
      {
        followUpNotificationsEnabled: true,
        commissionNotificationsEnabled: true,
      },
    ),
    [],
  );
  assert.equal(database.read("booking_notification_outbox", job.id)?.status, "cancelled");
  assert.equal(
    database.read("booking_notification_outbox", job.id)?.providerError,
    "notification_state_changed",
  );
});

test("notification claims use persisted customer and free-owner quota limits", async () => {
  const database = new FakeFirestore();
  database.seed("settings", "booking_free_workflow_limits", {
    schemaVersion: 1,
    customerDailyLimit: 0,
    freeOwnerDailyLimit: 0,
    freePropertyContactDailyLimit: 6,
    updatedAt: now.toISOString(),
    updatedBy: "admin",
  });

  const customerWorkflow = buildWorkflow();
  const claimAt = new Date(Date.parse(customerWorkflow.customerNotification.scheduledAt));
  database.seed("booking_followups", customerWorkflow.followUp.id, {
    ...customerWorkflow.followUp,
    contactRequestId: "CONTACT-QUOTA-CUSTOMER",
  });
  database.seed(
    "booking_notification_outbox",
    customerWorkflow.customerNotification.id,
    customerWorkflow.customerNotification,
  );

  const ownerBookingId = "BOOK-REQ-13383-OWNER-QUOTA";
  const ownerJobId = `${ownerBookingId}--owner_booking_confirmed`;
  database.seed("booking_followups", ownerBookingId, {
    ...customerWorkflow.followUp,
    id: ownerBookingId,
    requestCode: "REQ-13383-OWNER-QUOTA",
    contactRequestId: "CONTACT-QUOTA-OWNER",
    bookingStatus: "confirmed",
    bookingDecision: "yes",
    confirmedAt: claimAt.toISOString(),
    commissionStatus: "not_applicable",
    confirmationFacts: {
      timing: "weekend",
      bookingDate: { value: "2026-08-15", precision: "day" },
      pricePaidHalalas: 100_000,
    },
  });
  database.seed("properties", "13383", {
    propertyNumber: "13383",
    whatsappNumber: "0500000001",
  });
  database.seed("booking_notification_outbox", ownerJobId, {
    ...customerWorkflow.customerNotification,
    id: ownerJobId,
    bookingId: ownerBookingId,
    recipientRole: "owner",
    recipientPhone: customerWorkflow.followUp.ownerPhone,
    recipientQuotaKey: "500000001",
    kind: "owner_booking_confirmed",
    quotaCategory: "free_owner_booking",
  });

  const store = new BookingCommissionStore(database as any);
  assert.deepEqual(await store.claimDueNotificationJobs(claimAt, 5, {
    followUpNotificationsEnabled: true,
    commissionNotificationsEnabled: true,
  }), []);

  for (const [jobId, eventType] of [
    [customerWorkflow.customerNotification.id, "customer_followup_suppressed"],
    [ownerJobId, "owner_notification_suppressed"],
  ] as const) {
    const job = database.read("booking_notification_outbox", jobId);
    assert.equal(job?.status, "suppressed_quota");
    assert.equal(job?.providerError, "daily_notification_quota");
    const booking = database.read("booking_followups", job?.bookingId);
    assert.equal(booking?.events.at(-1)?.type, eventType);
  }
});

test("initial workflow rejects a non-free property origin", () => {
  assert.throws(
    () => buildWorkflow(false),
    (error: unknown) =>
      error instanceof BookingWorkflowError &&
      error.code === "BOOKING_NOT_FOUND" &&
      error.status === 404,
  );
});

test("initial workflow rejects an invalid clock value", () => {
  assert.throws(() => buildInitialBookingWorkflow({
    requestCode: "REQ-1",
    propertyNumber: "13383",
    propertyName: "Property",
    ownerPhone: "+966500000001",
    customerPhone: "+966500000002",
    customerSubject: "customer-subject-hmac",
    isFreeProperty: true,
    now: new Date(Number.NaN),
  }), RangeError);
});

test("an empty property name receives a safe nonempty workflow fallback", () => {
  const workflow = buildInitialBookingWorkflow({
    requestCode: "REQ-EMPTY-NAME",
    propertyNumber: "13383",
    propertyName: "   ",
    ownerPhone: "+966500000001",
    customerPhone: "+966500000002",
    customerSubject: "customer-subject-hmac",
    isFreeProperty: true,
    now,
  });
  assert.equal(workflow.followUp.propertyName, "بدون اسم");
});

test("admin audit reads are not capped at the former booking and notification limits", async () => {
  const bookings = Array.from({ length: 501 }, (_, index) => ({
    id: `BOOK-AUDIT-${index}`,
  }));
  const jobs = Array.from({ length: 5_001 }, (_, index) => ({
    id: `JOB-AUDIT-${index}`,
  }));
  const database = {
    collection(name: string) {
      const values = name === "booking_followups" ? bookings : jobs;
      return {
        orderBy() {
          return {
            async get() {
              return {
                docs: values.map((value) => ({ data: () => value })),
              };
            },
          };
        },
      };
    },
  };
  const store = new BookingCommissionStore(database as any);

  assert.equal((await store.listAllBookings()).length, 501);
  assert.equal((await store.listAllNotificationJobs()).length, 5_001);
});

test("an unanswered workflow expires after seven days but terminal records remain readable", async () => {
  const database = new FakeFirestore();
  const workflow = buildWorkflow();
  const bookingId = workflow.followUp.id;
  database.seed("booking_followups", bookingId, {
    ...workflow.followUp,
    contactRequestId: "CONTACT-1",
  });
  const store = new BookingCommissionStore(database as any);
  const expiredAt = new Date(now.getTime() + BOOKING_CUSTOMER_RESPONSE_WINDOW_MS);

  await assert.rejects(
    () => store.markCustomerOpened(bookingId, expiredAt),
    (error: unknown) =>
      error instanceof Error &&
      (error as any).code === "BOOKING_RESPONSE_EXPIRED" &&
      (error as any).status === 410,
  );
  await assert.rejects(
    () => store.startQuestionnaire(bookingId, expiredAt),
    (error: unknown) => (error as any)?.code === "BOOKING_RESPONSE_EXPIRED",
  );

  database.seed("booking_followups", bookingId, {
    ...database.read("booking_followups", bookingId),
    bookingStatus: "declined",
    declinedAt: new Date(now.getTime() + 1_000).toISOString(),
  });
  assert.equal((await store.markCustomerOpened(bookingId, expiredAt)).bookingStatus, "declined");
});

test("an active premium subscription durably closes a free workflow and prevents later resurrection", async () => {
  const database = new FakeFirestore();
  const workflow = buildWorkflow();
  const bookingId = workflow.followUp.id;
  database.seed("booking_followups", bookingId, {
    ...workflow.followUp,
    contactRequestId: "CONTACT-PREMIUM-UPGRADE",
  });
  database.seed("booking_notification_outbox", workflow.customerNotification.id, {
    ...workflow.customerNotification,
    scheduledAt: now.toISOString(),
  });
  database.seed("subscriptions", "SUB-13383", {
    id: "SUB-13383",
    propertyNumber: "13383",
    subscriptionType: "مميز",
    status: "ساري",
    endDate: "2099-12-31T00:00:00.000Z",
  });
  const store = new BookingCommissionStore(database as any);

  await assert.rejects(
    () => store.markCustomerOpened(bookingId, now),
    (error: unknown) =>
      error instanceof BookingWorkflowError &&
      error.code === "BOOKING_NOT_FOUND" &&
      error.status === 404,
  );
  const revoked = database.read("booking_followups", bookingId);
  assert.equal(typeof revoked?.freeEligibilityRevokedAt, "string");
  assert.equal(revoked?.events.at(-1)?.type, "booking_free_eligibility_lost");
  assert.equal(
    database.read("booking_notification_outbox", workflow.customerNotification.id)?.status,
    "cancelled",
  );

  database.update("subscriptions", "SUB-13383", {
    subscriptionType: "عادي",
    status: "نشط مجاني",
  });
  await assert.rejects(
    () => store.startQuestionnaire(bookingId, new Date(now.getTime() + 1_000)),
    (error: unknown) => (error as any)?.code === "BOOKING_NOT_FOUND",
  );
  assert.equal(database.read("booking_followups", bookingId)?.bookingDecision, null);
});

test("a premium upgrade between notification preparation and completion cannot anchor commission debt", async () => {
  const database = new FakeFirestore();
  const workflow = buildWorkflow();
  const bookingId = workflow.followUp.id;
  const jobId = `${bookingId}--owner_booking_confirmed`;
  database.seed("booking_followups", bookingId, {
    ...workflow.followUp,
    contactRequestId: "CONTACT-NOTICE-TIER-RACE",
    bookingStatus: "confirmed",
    bookingDecision: "yes",
    confirmedAt: now.toISOString(),
    commissionStatus: "pending",
    commissionAmountHalalas: 10_000,
    commissionDueAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1_000).toISOString(),
  });
  database.seed("booking_notification_outbox", jobId, {
    ...workflow.customerNotification,
    id: jobId,
    bookingId,
    recipientRole: "owner",
    kind: "owner_booking_confirmed",
    status: "claimed",
    leaseToken: "tier-race-lease",
  });
  database.seed("subscriptions", "SUB-13383", {
    id: "SUB-13383",
    propertyNumber: "13383",
    subscriptionType: "مميز",
    status: "ساري",
    endDate: "2099-12-31T00:00:00.000Z",
  });
  const store = new BookingCommissionStore(database as any);

  assert.equal(await store.finishNotificationJob({
    jobId,
    leaseToken: "tier-race-lease",
    success: true,
    now,
  }), true);
  assert.equal(database.read("booking_notification_outbox", jobId)?.status, "cancelled");
  const booking = database.read("booking_followups", bookingId);
  assert.equal(booking?.commissionStatus, "waived");
  assert.equal(booking?.commissionNoticeSentAt, null);
});

test("premium reconciliation releases only the upgraded booking hold obligation", async () => {
  const database = new FakeFirestore();
  const workflow = buildWorkflow();
  const bookingId = workflow.followUp.id;
  database.seed("booking_followups", bookingId, {
    ...workflow.followUp,
    contactRequestId: "CONTACT-HELD-UPGRADE",
    bookingStatus: "confirmed",
    bookingDecision: "yes",
    confirmedAt: now.toISOString(),
    commissionStatus: "overdue",
    complianceStatus: "paused",
    commissionAmountHalalas: 10_000,
  });
  database.seed("properties", "13383", {
    propertyNumber: "13383",
    whatsappNumber: "0500000001",
    commissionHold: {
      active: true,
      obligationIds: [bookingId, "BOOK-OTHER-OBLIGATION"],
      appliedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  });
  database.seed("subscriptions", "SUB-13383", {
    id: "SUB-13383",
    propertyNumber: "13383",
    subscriptionType: "مميز",
    status: "ساري",
    endDate: "2099-12-31T00:00:00.000Z",
  });
  const store = new BookingCommissionStore(database as any);

  assert.equal(await store.reconcilePausedFreeEligibility(now), 1);
  assert.equal(database.read("booking_followups", bookingId)?.commissionStatus, "waived");
  assert.equal(database.read("booking_followups", bookingId)?.complianceStatus, "released");
  assert.deepEqual(database.read("properties", "13383")?.commissionHold, {
    active: true,
    obligationIds: ["BOOK-OTHER-OBLIGATION"],
    appliedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
});

test("confirmation creates debt only while the current property owner identity still matches", async () => {
  const facts = {
    timing: "weekend" as const,
    bookingDate: { value: "2026-08-15", precision: "day" as const },
    pricePaidHalalas: 100_000,
  };
  for (const changed of [false, true]) {
    const database = new FakeFirestore();
    const workflow = buildWorkflow();
    const bookingId = workflow.followUp.id;
    database.seed("booking_followups", bookingId, {
      ...workflow.followUp,
      contactRequestId: "CONTACT-1",
      bookingDecision: "yes",
      questionnaireStartedAt: now.toISOString(),
    });
    database.seed("properties", "13383", {
      propertyNumber: "13383",
      whatsappNumber: changed ? "0500000099" : "0500000001",
    });
    const store = new BookingCommissionStore(database as any);
    const confirmed = await store.confirmBooking(
      bookingId,
      facts,
      new Date(now.getTime() + 1_000),
      true,
    );

    assert.equal(confirmed.bookingStatus, "confirmed");
    assert.equal(confirmed.commissionStatus, changed ? "not_applicable" : "pending");
    assert.equal(confirmed.enforcementLastError, changed ? "owner_identity_changed" : null);
    assert.equal(
      database.read("booking_notification_outbox", `${bookingId}--owner_booking_confirmed`) !== undefined,
      !changed,
    );
    if (changed) {
      assert.equal(confirmed.disputeStatus, "none");
      assert.equal(confirmed.events.at(-1)?.type, "owner_identity_changed");
      assert.equal(JSON.stringify(confirmed.events).includes("050000"), false);
    }
  }
});

test("confirmation schedules configured optional reminders and always schedules day five", async () => {
  const database = new FakeFirestore();
  const workflow = buildWorkflow();
  const bookingId = workflow.followUp.id;
  database.seed("booking_followups", bookingId, {
    ...workflow.followUp,
    contactRequestId: "CONTACT-CONFIGURED-REMINDERS",
    bookingDecision: "yes",
    questionnaireStartedAt: now.toISOString(),
  });
  database.seed("properties", "13383", {
    propertyNumber: "13383",
    whatsappNumber: "0500000001",
  });
  database.seed("settings", "booking_free_workflow_limits", {
    schemaVersion: 2,
    customerDailyLimit: 3,
    freeOwnerDailyLimit: 3,
    freePropertyContactDailyLimit: 3,
    whatsappTemplates: DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
    optionalCommissionReminderDays: [4],
    updatedAt: now.toISOString(),
    updatedBy: "admin",
  });

  await new BookingCommissionStore(database as any).confirmBooking(
    bookingId,
    {
      timing: "weekend",
      bookingDate: { value: "2026-08-15", precision: "day" },
      pricePaidHalalas: 100_000,
    },
    new Date(now.getTime() + 1_000),
    true,
  );

  assert.equal(
    database.read(
      "booking_notification_outbox",
      `${bookingId}--commission_reminder_3`,
    ),
    undefined,
  );
  assert.ok(database.read(
    "booking_notification_outbox",
    `${bookingId}--commission_reminder_4`,
  ));
  assert.ok(database.read(
    "booking_notification_outbox",
    `${bookingId}--commission_reminder_5`,
  ));
});

test("admin customer WhatsApp contact is limited once per customer every 30 minutes", async () => {
  const database = new FakeFirestore();
  const store = new BookingCommissionStore(database as any);
  const seedBooking = (
    requestCode: string,
    propertyNumber: string,
    customerSubject: string,
  ) => {
    const workflow = buildInitialBookingWorkflow({
      requestCode,
      propertyNumber,
      propertyName: `Property ${propertyNumber}`,
      ownerPhone: "+966500000001",
      customerPhone: "+966500000002",
      customerSubject,
      isFreeProperty: true,
      now,
    });
    database.seed("booking_followups", workflow.followUp.id, {
      ...workflow.followUp,
      contactRequestId: `CONTACT-${requestCode}`,
    });
    database.seed("properties", propertyNumber, {
      propertyNumber,
      whatsappNumber: "0500000001",
    });
    return workflow.followUp.id;
  };

  const firstId = seedBooking("ADMIN-CONTACT-1", "ADMIN-PROP-1", "same-customer");
  const secondId = seedBooking("ADMIN-CONTACT-2", "ADMIN-PROP-2", "same-customer");
  const otherCustomerId = seedBooking(
    "ADMIN-CONTACT-3",
    "ADMIN-PROP-3",
    "other-customer",
  );

  const first = await store.claimAdminCustomerWhatsAppContact(firstId, now);
  assert.equal(first?.adminCustomerWhatsAppLastOpenedAt, now.toISOString());
  assert.equal(first?.events.at(-1)?.type, "admin_customer_whatsapp_opened");

  await assert.rejects(
    () => store.claimAdminCustomerWhatsAppContact(
      secondId,
      new Date(now.getTime() + BOOKING_ADMIN_CUSTOMER_WHATSAPP_COOLDOWN_MS - 60_000),
    ),
    (error: unknown) =>
      error instanceof BookingWorkflowError &&
      error.code === "ADMIN_CUSTOMER_WHATSAPP_RATE_LIMITED" &&
      error.status === 429 &&
      error.retryAfterSeconds === 60,
  );
  assert.equal(
    database.read("booking_followups", secondId)
      ?.adminCustomerWhatsAppLastOpenedAt,
    undefined,
  );

  const otherCustomer = await store.claimAdminCustomerWhatsAppContact(
    otherCustomerId,
    new Date(now.getTime() + 5 * 60_000),
  );
  assert.ok(otherCustomer?.adminCustomerWhatsAppLastOpenedAt);

  const boundary = new Date(
    now.getTime() + BOOKING_ADMIN_CUSTOMER_WHATSAPP_COOLDOWN_MS,
  );
  const second = await store.claimAdminCustomerWhatsAppContact(
    secondId,
    boundary,
  );
  assert.equal(second?.adminCustomerWhatsAppLastOpenedAt, boundary.toISOString());
});

test("rejected admin customer WhatsApp handoffs do not consume the cooldown", async () => {
  const database = new FakeFirestore();
  const store = new BookingCommissionStore(database as any);
  const workflow = buildWorkflow();
  const bookingId = workflow.followUp.id;
  database.seed("booking_followups", bookingId, {
    ...workflow.followUp,
    contactRequestId: "CONTACT-ADMIN-INVALID",
    customerPhone: "invalid",
  });
  database.seed("properties", workflow.followUp.propertyNumber, {
    propertyNumber: workflow.followUp.propertyNumber,
    whatsappNumber: "0500000001",
  });

  await assert.rejects(
    () => store.claimAdminCustomerWhatsAppContact(bookingId, now),
    (error: unknown) =>
      error instanceof BookingWorkflowError &&
      error.code === "INVALID_CUSTOMER_PHONE",
  );
  assert.equal(
    database.read("booking_followups", bookingId)
      ?.adminCustomerWhatsAppLastOpenedAt,
    undefined,
  );

  database.update("booking_followups", bookingId, {
    customerPhone: "+966500000002",
  });
  database.update("properties", workflow.followUp.propertyNumber, {
    whatsappNumber: "0500000099",
  });
  await assert.rejects(
    () => store.claimAdminCustomerWhatsAppContact(bookingId, now),
    (error: unknown) =>
      error instanceof BookingWorkflowError &&
      error.code === "OWNER_IDENTITY_CHANGED",
  );
  assert.equal(
    database.read("booking_followups", bookingId)
      ?.adminCustomerWhatsAppLastOpenedAt,
    undefined,
  );
});

test("a stale owner link is blocked and its later signed payment is retained for refund review", async () => {
  const database = new FakeFirestore();
  const workflow = buildWorkflow();
  const bookingId = workflow.followUp.id;
  database.seed("booking_followups", bookingId, {
    ...workflow.followUp,
    contactRequestId: "CONTACT-STALE-OWNER",
    bookingDecision: "yes",
    questionnaireStartedAt: now.toISOString(),
  });
  database.seed("properties", "13383", {
    propertyNumber: "13383",
    whatsappNumber: "0500000001",
  });
  const store = new BookingCommissionStore(database as any);
  const confirmed = await store.confirmBooking(bookingId, {
    timing: "weekend",
    bookingDate: { value: "2026-08-15", precision: "day" },
    pricePaidHalalas: 100_000,
  }, new Date(now.getTime() + 1_000), true);
  const attemptId = "BCOM-ATT-STALE-OWNER";
  const merchantAttemptKey = "RWQN-BCOM-STALE-OWNER";
  const orderId = "ORDER-STALE-OWNER";
  const reservation = await store.reservePaymentAttempt({
    bookingId,
    attemptId,
    merchantAttemptKey,
    paymentMethod: "cards",
    now: new Date(now.getTime() + 2_000),
  });
  assert.equal(reservation.status, "reserved");
  await store.completePaymentAttemptCreation({
    attemptId,
    intentionId: "INTENTION-STALE-OWNER",
    paymobOrderId: orderId,
    checkoutUrl: "https://ksa.paymob.com/unifiedcheckout/?clientSecret=stale-owner",
    now: new Date(now.getTime() + 3_000),
  });

  database.update("properties", "13383", {
    whatsappNumber: "0500000099",
  });
  const ownerChanged = (error: unknown) =>
    error instanceof BookingWorkflowError &&
    error.code === "OWNER_IDENTITY_CHANGED" &&
    error.status === 423;
  await assert.rejects(
    () => store.getBookingForCurrentOwner(bookingId),
    ownerChanged,
  );
  await assert.rejects(
    () => store.disputeCommission(bookingId, "valid owner dispute", now),
    ownerChanged,
  );
  await assert.rejects(
    () => store.reservePaymentAttempt({
      bookingId,
      attemptId: "BCOM-ATT-STALE-OWNER-NEW",
      merchantAttemptKey: "RWQN-BCOM-STALE-OWNER-NEW",
      paymentMethod: "cards",
      now: new Date(now.getTime() + 4_000),
    }),
    ownerChanged,
  );
  assert.equal(
    database.read("booking_commission_payment_attempts", "BCOM-ATT-STALE-OWNER-NEW"),
    undefined,
  );
  assert.equal(database.read("booking_followups", bookingId)?.disputeStatus, "none");

  const settlement = await store.settleCommissionCallback({
    paymobOrderId: orderId,
    transactionId: "TX-STALE-OWNER-SIGNED-SUCCESS",
    amountCents: confirmed.commissionAmountHalalas!,
    currency: "SAR",
    success: true,
    exactPaymentMethod: "visa",
    callbackAttemptId: attemptId,
    callbackBookingId: bookingId,
    callbackMerchantAttemptKey: merchantAttemptKey,
    callbackSpecialReference: merchantAttemptKey,
  }, new Date(now.getTime() + 5_000));
  assert.equal(settlement.status, "duplicate_paid");
  assert.equal(database.read("booking_followups", bookingId)?.commissionStatus, "pending");
  assert.equal(
    database.read("booking_commission_payment_attempts", attemptId)
      ?.financialReviewDecision,
    "refund_review",
  );
  assert.equal(
    database.read("booking_commission_payment_attempts", attemptId)
      ?.financialReviewReason,
    "owner_identity_changed",
  );
  assert.equal(
    database.read("booking_commission_transaction_bindings", "TX-STALE-OWNER-SIGNED-SUCCESS")
      ?.refundReview,
    true,
  );
});

test("reminder supersession follows the delivered commission notice, not confirmation", () => {
  const booking = {
    confirmedAt: "2026-08-01T12:00:00.000Z",
    commissionNoticeSentAt: "2026-08-10T12:00:00.000Z",
  };

  assert.equal(
    latestCommissionReminderOffsetDue(booking, new Date("2026-08-13T11:59:59.999Z")),
    null,
  );
  assert.equal(
    latestCommissionReminderOffsetDue(booking, new Date("2026-08-13T12:00:00.000Z")),
    3,
  );
  assert.equal(
    latestCommissionReminderOffsetDue(booking, new Date("2026-08-15T12:00:00.000Z")),
    5,
  );
});

test("reminder supersession falls back to confirmation for legacy records", () => {
  assert.equal(latestCommissionReminderOffsetDue({
    confirmedAt: "2026-08-10T12:00:00.000Z",
    commissionNoticeSentAt: null,
  }, new Date("2026-08-14T12:00:00.000Z")), 4);
});

test("a new successful transaction on a paid attempt is bound and escalated as duplicate", async () => {
  const database = new FakeFirestore();
  const bookingId = "BOOK-REQ-13383-001";
  const attemptId = "BCOM-ATT-1";
  const paymobOrderId = "ORDER-BCOM-1";
  const merchantAttemptKey = "RWQN-BCOM-ATTEMPT-KEY";
  database.seed("booking_followups", bookingId, {
    id: bookingId,
    propertyNumber: "13383",
    ownerPhone: "+966500000001",
    commissionStatus: "paid",
    complianceStatus: "clear",
    events: [{ type: "commission_paid", at: "2026-08-15T12:00:00.000Z" }],
  });
  database.seed("booking_commission_payment_attempts", attemptId, {
    id: attemptId,
    bookingId,
    paymobOrderId,
    merchantAttemptKey,
    amountCents: 12_556,
    currency: "SAR",
    status: "paid",
    transactionId: "TX-ORIGINAL",
  });
  database.seed("booking_commission_order_bindings", paymobOrderId, {
    bookingId,
    attemptId,
    merchantAttemptKey,
    amountCents: 12_556,
    currency: "SAR",
  });
  database.seed("booking_commission_transaction_bindings", "TX-ORIGINAL", {
    bookingId,
    attemptId,
    transactionId: "TX-ORIGINAL",
    success: true,
  });
  const store = new BookingCommissionStore(database as any);
  const callback = {
    paymobOrderId,
    amountCents: 12_556,
    currency: "SAR",
    success: true,
    exactPaymentMethod: "visa",
  };

  const originalReplay = await store.settleCommissionCallback({
    ...callback,
    transactionId: "TX-ORIGINAL",
  }, now);
  assert.equal(originalReplay.status, "already_processed");

  const duplicate = await store.settleCommissionCallback({
    ...callback,
    transactionId: "TX-DUPLICATE",
  }, now);
  assert.equal(duplicate.status, "duplicate_paid");
  assert.deepEqual(database.read(
    "booking_commission_transaction_bindings",
    "TX-DUPLICATE",
  ), {
    transactionId: "TX-DUPLICATE",
    bookingId,
    attemptId,
    success: true,
    duplicate: true,
    createdAt: now.toISOString(),
  });
  assert.equal(
    database.read("booking_commission_payment_attempts", attemptId)?.transactionId,
    "TX-ORIGINAL",
    "the primary settled transaction remains available for reconciliation",
  );
  assert.equal(
    database.read("booking_followups", bookingId)?.events.at(-1)?.type,
    "commission_duplicate_payment",
  );

  const duplicateReplay = await store.settleCommissionCallback({
    ...callback,
    transactionId: "TX-DUPLICATE",
  }, now);
  assert.equal(duplicateReplay.status, "already_processed");
  assert.equal(database.read("booking_followups", bookingId)?.events.length, 2);
});

test("a late failure callback cannot clear a newer active payment attempt", async () => {
  const database = new FakeFirestore();
  const bookingId = "BOOK-REQ-13383-002";
  const oldAttemptId = "BCOM-ATT-OLD";
  const newAttemptId = "BCOM-ATT-NEW";
  const paymobOrderId = "ORDER-BCOM-OLD";
  const merchantAttemptKey = "RWQN-BCOM-OLD-KEY";
  database.seed("booking_followups", bookingId, {
    id: bookingId,
    propertyNumber: "13383",
    ownerPhone: "+966500000001",
    bookingStatus: "confirmed",
    commissionStatus: "pending",
    complianceStatus: "clear",
    activeAttemptId: newAttemptId,
    events: [],
  });
  database.seed("booking_commission_payment_attempts", oldAttemptId, {
    id: oldAttemptId,
    bookingId,
    paymobOrderId,
    merchantAttemptKey,
    amountCents: 12_556,
    currency: "SAR",
    status: "created",
  });
  database.seed("booking_commission_payment_attempts", newAttemptId, {
    id: newAttemptId,
    bookingId,
    amountCents: 12_556,
    currency: "SAR",
    status: "created",
  });
  database.seed("booking_commission_order_bindings", paymobOrderId, {
    bookingId,
    attemptId: oldAttemptId,
    merchantAttemptKey,
    amountCents: 12_556,
    currency: "SAR",
  });
  const store = new BookingCommissionStore(database as any);

  const result = await store.settleCommissionCallback({
    paymobOrderId,
    transactionId: "TX-OLD-FAILURE",
    amountCents: 12_556,
    currency: "SAR",
    success: false,
  }, now);

  assert.equal(result.status, "failure_recorded");
  assert.equal(
    database.read("booking_followups", bookingId)?.activeAttemptId,
    newAttemptId,
  );
});

async function pendingElectronicPaymentFixture(suffix: string) {
  const database = new FakeFirestore();
  const workflow = buildWorkflow();
  const bookingId = workflow.followUp.id;
  database.seed("booking_followups", bookingId, {
    ...workflow.followUp,
    contactRequestId: `CONTACT-ELECTRONIC-${suffix}`,
    bookingDecision: "yes",
    questionnaireStartedAt: now.toISOString(),
  });
  database.seed("properties", "13383", {
    propertyNumber: "13383",
    whatsappNumber: "0500000001",
    commissionHold: { active: false, obligationIds: [] },
  });
  const store = new BookingCommissionStore(database as any);
  const confirmed = await store.confirmBooking(bookingId, {
    timing: "weekend",
    bookingDate: { value: "2026-08-15", precision: "day" },
    pricePaidHalalas: 100_000,
  }, new Date(now.getTime() + 1_000), true);
  const attemptId = `BCOM-ATT-ELECTRONIC-${suffix}`;
  const merchantAttemptKey = `RWQN-BCOM-ELECTRONIC-${suffix}`;
  const paymobOrderId = `ORDER-ELECTRONIC-${suffix}`;
  await store.reservePaymentAttempt({
    bookingId,
    attemptId,
    merchantAttemptKey,
    paymentMethod: "cards",
    now: new Date(now.getTime() + 2_000),
  });
  await store.completePaymentAttemptCreation({
    attemptId,
    intentionId: `INTENTION-ELECTRONIC-${suffix}`,
    paymobOrderId,
    checkoutUrl: `https://ksa.paymob.com/unifiedcheckout/?clientSecret=${suffix}`,
    now: new Date(now.getTime() + 3_000),
  });
  return {
    database,
    store,
    bookingId,
    attemptId,
    merchantAttemptKey,
    paymobOrderId,
    amountCents: confirmed.commissionAmountHalalas!,
  };
}

async function creatingElectronicPaymentFixture(suffix: string) {
  const database = new FakeFirestore();
  const workflow = buildWorkflow();
  const bookingId = workflow.followUp.id;
  database.seed("booking_followups", bookingId, {
    ...workflow.followUp,
    contactRequestId: `CONTACT-CREATING-${suffix}`,
    bookingDecision: "yes",
    questionnaireStartedAt: now.toISOString(),
  });
  database.seed("properties", "13383", {
    propertyNumber: "13383",
    whatsappNumber: "0500000001",
  });
  const store = new BookingCommissionStore(database as any);
  await store.confirmBooking(bookingId, {
    timing: "weekend",
    bookingDate: { value: "2026-08-15", precision: "day" },
    pricePaidHalalas: 100_000,
  }, new Date(now.getTime() + 1_000), true);
  const attemptId = `BCOM-ATT-CREATING-${suffix}`;
  await store.reservePaymentAttempt({
    bookingId,
    attemptId,
    merchantAttemptKey: `RWQN-BCOM-CREATING-${suffix}`,
    paymentMethod: "cards",
    now: new Date(now.getTime() + 2_000),
  });
  return { database, store, bookingId, attemptId };
}

test("provider checkout completion fails closed across owner, dispute, waiver, supersession, and upgrade races", async () => {
  const scenarios = [
    "OWNER",
    "DISPUTE",
    "WAIVED",
    "SUPERSEDED",
    "UPGRADED",
  ] as const;
  for (const scenario of scenarios) {
    const fixture = await creatingElectronicPaymentFixture(scenario);
    if (scenario === "OWNER") {
      fixture.database.update("properties", "13383", {
        whatsappNumber: "0500000099",
      });
    } else if (scenario === "DISPUTE") {
      fixture.database.update("booking_followups", fixture.bookingId, {
        disputeStatus: "pending",
        disputedAt: new Date(now.getTime() + 2_500).toISOString(),
        disputeReason: "اعتراض متزامن",
      });
    } else if (scenario === "WAIVED") {
      fixture.database.update("booking_followups", fixture.bookingId, {
        commissionStatus: "waived",
        activeAttemptId: null,
      });
    } else if (scenario === "SUPERSEDED") {
      fixture.database.update("booking_followups", fixture.bookingId, {
        activeAttemptId: "BCOM-ATT-NEWER",
      });
    } else {
      fixture.database.seed("subscriptions", "SUB-UPGRADED-CHECKOUT", {
        id: "SUB-UPGRADED-CHECKOUT",
        propertyNumber: "13383",
        subscriptionType: "مميز",
        status: "ساري",
        endDate: "2099-12-31T00:00:00.000Z",
      });
    }
    const orderId = `ORDER-CREATING-${scenario}`;
    await assert.rejects(
      () => fixture.store.completePaymentAttemptCreation({
        attemptId: fixture.attemptId,
        intentionId: `INTENTION-CREATING-${scenario}`,
        paymobOrderId: orderId,
        checkoutUrl: `https://ksa.paymob.com/unifiedcheckout/?clientSecret=${scenario}`,
        now: new Date(now.getTime() + 3_000),
      }),
      (error: unknown) =>
        error instanceof BookingWorkflowError &&
        error.code === "PAYMENT_ATTEMPT_RECONCILIATION_REQUIRED",
    );
    const attempt = fixture.database.read(
      "booking_commission_payment_attempts",
      fixture.attemptId,
    );
    assert.equal(attempt?.status, "unknown", scenario);
    assert.equal(attempt?.paymobOrderId, orderId, scenario);
    assert.ok(attempt?.failureReason?.startsWith("checkout_"), scenario);
    assert.equal(
      fixture.database.read("booking_commission_order_bindings", orderId)
        ?.attemptId,
      fixture.attemptId,
      scenario,
    );
    assert.notEqual(
      fixture.database.read("booking_followups", fixture.bookingId)
        ?.commissionStatus,
      "paid",
      scenario,
    );
  }
});

test("an electronic success after a premium upgrade is retained for refund review without settling commission", async () => {
  const fixture = await pendingElectronicPaymentFixture("UPGRADE-RACE");
  fixture.database.seed("subscriptions", "SUB-13383-UPGRADE-RACE", {
    id: "SUB-13383-UPGRADE-RACE",
    propertyNumber: "13383",
    subscriptionType: "مميز",
    status: "ساري",
    endDate: "2099-12-31T00:00:00.000Z",
  });

  const result = await fixture.store.settleCommissionCallback({
    paymobOrderId: fixture.paymobOrderId,
    transactionId: "TX-ELECTRONIC-UPGRADE-RACE",
    amountCents: fixture.amountCents,
    currency: "SAR",
    success: true,
    exactPaymentMethod: "visa",
    callbackAttemptId: fixture.attemptId,
    callbackBookingId: fixture.bookingId,
    callbackMerchantAttemptKey: fixture.merchantAttemptKey,
    callbackSpecialReference: fixture.merchantAttemptKey,
  }, new Date(now.getTime() + 4_000));

  assert.equal(result.status, "duplicate_paid");
  const booking = fixture.database.read("booking_followups", fixture.bookingId);
  assert.equal(booking?.commissionStatus, "waived");
  assert.equal(booking?.commissionPaidAt, null);
  assert.equal(booking?.activeAttemptId, null);
  const attempt = fixture.database.read(
    "booking_commission_payment_attempts",
    fixture.attemptId,
  );
  assert.equal(attempt?.status, "duplicate_paid");
  assert.equal(attempt?.financialReviewDecision, "refund_review");
  assert.equal(attempt?.financialReviewReason, "booking_free_eligibility_lost");
  assert.equal(attempt?.transactionId, "TX-ELECTRONIC-UPGRADE-RACE");
});

test("a superseded electronic checkout cannot settle or release another active obligation", async () => {
  const fixture = await pendingElectronicPaymentFixture("SUPERSEDED");
  fixture.database.update("booking_followups", fixture.bookingId, {
    activeAttemptId: "BCOM-ATT-ELECTRONIC-NEWER",
    complianceStatus: "paused",
  });
  fixture.database.update("properties", "13383", {
    commissionHold: {
      active: true,
      obligationIds: [fixture.bookingId],
      appliedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  });

  const result = await fixture.store.settleCommissionCallback({
    paymobOrderId: fixture.paymobOrderId,
    transactionId: "TX-ELECTRONIC-SUPERSEDED",
    amountCents: fixture.amountCents,
    currency: "SAR",
    success: true,
    exactPaymentMethod: "visa",
  }, new Date(now.getTime() + 4_000));

  assert.equal(result.status, "duplicate_paid");
  assert.equal(
    fixture.database.read("booking_followups", fixture.bookingId)?.commissionStatus,
    "pending",
  );
  assert.equal(
    fixture.database.read("properties", "13383")?.commissionHold?.active,
    true,
  );
  assert.equal(
    fixture.database.read("booking_commission_payment_attempts", fixture.attemptId)
      ?.financialReviewReason,
    "payment_attempt_superseded",
  );
});

test("an already-open electronic checkout may settle a pending dispute as before", async () => {
  const fixture = await pendingElectronicPaymentFixture("DISPUTE");
  fixture.database.update("booking_followups", fixture.bookingId, {
    disputeStatus: "pending",
    disputedAt: new Date(now.getTime() + 3_500).toISOString(),
    disputeReason: "اعتراض قائم أثناء الدفع",
  });

  const result = await fixture.store.settleCommissionCallback({
    paymobOrderId: fixture.paymobOrderId,
    transactionId: "TX-ELECTRONIC-DISPUTE",
    amountCents: fixture.amountCents,
    currency: "SAR",
    success: true,
    exactPaymentMethod: "visa",
  }, new Date(now.getTime() + 4_000));

  assert.equal(result.status, "paid");
  const booking = fixture.database.read("booking_followups", fixture.bookingId);
  assert.equal(booking?.commissionStatus, "paid");
  assert.equal(booking?.disputeStatus, "rejected");
  assert.equal(booking?.events.at(-1)?.detail, "dispute_resolved_by_payment");
});

async function pendingBankReceiptFixture() {
  const database = new FakeFirestore();
  const workflow = buildWorkflow();
  const bookingId = workflow.followUp.id;
  database.seed("booking_followups", bookingId, {
    ...workflow.followUp,
    contactRequestId: "CONTACT-BANK-RECEIPT",
    bookingDecision: "yes",
    questionnaireStartedAt: now.toISOString(),
  });
  database.seed("properties", "13383", {
    propertyNumber: "13383",
    whatsappNumber: "0500000001",
  });
  const store = new BookingCommissionStore(database as any);
  await store.confirmBooking(bookingId, {
    timing: "weekend",
    bookingDate: { value: "2026-08-15", precision: "day" },
    pricePaidHalalas: 100_000,
  }, new Date(now.getTime() + 1_000), true);
  const attemptId = "BCOM-ATT-BANK-1";
  await store.reservePaymentAttempt({
    bookingId,
    attemptId,
    merchantAttemptKey: "RWQN-BCOM-BANK-1",
    paymentMethod: "bank_transfer",
    now: new Date(now.getTime() + 2_000),
  });
  await store.completeBankTransferAttempt({
    attemptId,
    receiptUrl: "https://receipts.example/opaque-receipt.pdf",
    receiptObjectKey: "booking-commission-receipts/a/b.pdf",
    receiptContentType: "application/pdf",
    receiptSizeBytes: 512,
    now: new Date(now.getTime() + 3_000),
  });
  return { database, store, bookingId, attemptId };
}

test("bank receipt approval is idempotent and releases only its own property obligation", async () => {
  const { database, store, bookingId, attemptId } =
    await pendingBankReceiptFixture();
  database.update("booking_followups", bookingId, {
    commissionStatus: "overdue",
    complianceStatus: "paused",
  });
  database.update("properties", "13383", {
    commissionHold: {
      active: true,
      obligationIds: [bookingId, "BOOK-OTHER-OBLIGATION"],
      appliedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  });

  const approvedAt = new Date(now.getTime() + 4_000);
  const approved = await store.resolveBankTransferAttempt({
    bookingId,
    attemptId,
    resolution: "approve",
    now: approvedAt,
  });
  assert.deepEqual(approved, {
    status: "approved",
    bookingId,
    attemptId,
    propertyReleased: false,
    reviewReason: null,
  });
  const booking = database.read("booking_followups", bookingId);
  assert.equal(booking?.commissionStatus, "paid");
  assert.equal(booking?.complianceStatus, "released");
  assert.equal(booking?.paidAttemptId, attemptId);
  assert.equal(booking?.events.at(-1)?.type, "commission_paid");
  const attempt = database.read("booking_commission_payment_attempts", attemptId);
  assert.equal(attempt?.status, "paid");
  assert.equal(attempt?.exactPaymentMethod, "bank_transfer");
  assert.equal(attempt?.receiptObjectKey, "booking-commission-receipts/a/b.pdf");
  assert.equal(attempt?.bankReviewDecision, "approved");
  assert.deepEqual(
    database.read("properties", "13383")?.commissionHold?.obligationIds,
    ["BOOK-OTHER-OBLIGATION"],
  );
  assert.equal(
    database.read("properties", "13383")?.commissionHold?.active,
    true,
  );
  assert.equal(
    database.read("booking_notification_outbox", `${bookingId}--property_released`),
    undefined,
  );

  const eventCount = booking?.events.length;
  assert.deepEqual(await store.resolveBankTransferAttempt({
    bookingId,
    attemptId,
    resolution: "approve",
    now: new Date(now.getTime() + 5_000),
  }), approved);
  assert.equal(
    database.read("booking_followups", bookingId)?.events.length,
    eventCount,
  );
  await assert.rejects(
    () => store.resolveBankTransferAttempt({
      bookingId,
      attemptId,
      resolution: "reject",
      now: new Date(now.getTime() + 6_000),
    }),
    (error: unknown) =>
      error instanceof BookingWorkflowError &&
      error.code === "BANK_TRANSFER_REVIEW_CONFLICT" &&
      error.status === 409,
  );
});

test("bank receipt rejection is idempotent, preserves evidence, and rejects a later opposite decision", async () => {
  const { database, store, bookingId, attemptId } =
    await pendingBankReceiptFixture();
  const rejected = await store.resolveBankTransferAttempt({
    bookingId,
    attemptId,
    resolution: "reject",
    now: new Date(now.getTime() + 4_000),
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(
    database.read("booking_followups", bookingId)?.activeAttemptId,
    null,
  );
  assert.equal(
    database.read("booking_commission_payment_attempts", attemptId)?.receiptUrl,
    "https://receipts.example/opaque-receipt.pdf",
  );
  assert.deepEqual(await store.resolveBankTransferAttempt({
    bookingId,
    attemptId,
    resolution: "reject",
    now: new Date(now.getTime() + 5_000),
  }), rejected);
  await assert.rejects(
    () => store.resolveBankTransferAttempt({
      bookingId,
      attemptId,
      resolution: "approve",
      now: new Date(now.getTime() + 6_000),
    }),
    (error: unknown) =>
      error instanceof BookingWorkflowError &&
      error.code === "BANK_TRANSFER_REVIEW_CONFLICT" &&
      error.status === 409,
  );

  const next = await store.reservePaymentAttempt({
    bookingId,
    attemptId: "BCOM-ATT-BANK-2",
    merchantAttemptKey: "RWQN-BCOM-BANK-2",
    paymentMethod: "bank_transfer",
    now: new Date(now.getTime() + 7_000),
  });
  assert.equal(next.status, "reserved");
});

test("a free-to-premium race preserves a submitted bank receipt for refund review without settling it", async () => {
  const database = new FakeFirestore();
  const workflow = buildWorkflow();
  const bookingId = workflow.followUp.id;
  database.seed("booking_followups", bookingId, {
    ...workflow.followUp,
    contactRequestId: "CONTACT-BANK-PREMIUM-RACE",
    bookingDecision: "yes",
    questionnaireStartedAt: now.toISOString(),
  });
  database.seed("properties", "13383", {
    propertyNumber: "13383",
    whatsappNumber: "0500000001",
  });
  const store = new BookingCommissionStore(database as any);
  await store.confirmBooking(bookingId, {
    timing: "weekend",
    bookingDate: { value: "2026-08-15", precision: "day" },
    pricePaidHalalas: 100_000,
  }, new Date(now.getTime() + 1_000), true);
  const attemptId = "BCOM-ATT-BANK-PREMIUM";
  await store.reservePaymentAttempt({
    bookingId,
    attemptId,
    merchantAttemptKey: "RWQN-BCOM-BANK-PREMIUM",
    paymentMethod: "bank_transfer",
    now: new Date(now.getTime() + 2_000),
  });
  database.seed("subscriptions", "SUB-13383", {
    id: "SUB-13383",
    propertyNumber: "13383",
    subscriptionType: "مميز",
    status: "ساري",
    endDate: "2099-12-31T00:00:00.000Z",
  });

  const completed = await store.completeBankTransferAttempt({
    attemptId,
    receiptUrl: "https://receipts.example/premium-race.pdf",
    receiptObjectKey: "booking-commission-receipts/race/premium.pdf",
    receiptContentType: "application/pdf",
    receiptSizeBytes: 100,
    now: new Date(now.getTime() + 3_000),
  });
  assert.equal(completed.status, "review_required");
  const booking = database.read("booking_followups", bookingId);
  assert.equal(booking?.commissionStatus, "waived");
  assert.equal(booking?.commissionPaidAt, null);
  assert.equal(booking?.activeAttemptId, null);
  const attempt = database.read("booking_commission_payment_attempts", attemptId);
  assert.equal(attempt?.status, "review_required");
  assert.equal(attempt?.bankReviewDecision, "refund_review");
  assert.equal(attempt?.bankReviewReason, "booking_free_eligibility_lost");
  assert.equal(attempt?.receiptObjectKey, "booking-commission-receipts/race/premium.pdf");
  assert.equal((await store.resolveBankTransferAttempt({
    bookingId,
    attemptId,
    resolution: "approve",
    now: new Date(now.getTime() + 4_000),
  })).status, "review_required");
  assert.equal(database.read("booking_followups", bookingId)?.commissionStatus, "waived");
});

test("a bank upload keeps its receipt when another request revokes free eligibility first", async () => {
  const database = new FakeFirestore();
  const workflow = buildWorkflow();
  const bookingId = workflow.followUp.id;
  database.seed("booking_followups", bookingId, {
    ...workflow.followUp,
    contactRequestId: "CONTACT-BANK-INTERLEAVED-UPGRADE",
    bookingDecision: "yes",
    questionnaireStartedAt: now.toISOString(),
  });
  database.seed("properties", "13383", {
    propertyNumber: "13383",
    whatsappNumber: "0500000001",
  });
  const store = new BookingCommissionStore(database as any);
  await store.confirmBooking(bookingId, {
    timing: "weekend",
    bookingDate: { value: "2026-08-15", precision: "day" },
    pricePaidHalalas: 100_000,
  }, new Date(now.getTime() + 1_000), true);
  const attemptId = "BCOM-ATT-BANK-INTERLEAVED-UPGRADE";
  await store.reservePaymentAttempt({
    bookingId,
    attemptId,
    merchantAttemptKey: "RWQN-BCOM-BANK-INTERLEAVED-UPGRADE",
    paymentMethod: "bank_transfer",
    now: new Date(now.getTime() + 2_000),
  });
  database.seed("subscriptions", "SUB-BANK-INTERLEAVED-UPGRADE", {
    id: "SUB-BANK-INTERLEAVED-UPGRADE",
    propertyNumber: "13383",
    subscriptionType: "مميز",
    status: "ساري",
    endDate: "2099-12-31T00:00:00.000Z",
  });
  await assert.rejects(
    () => store.requireCurrentFreeEligibility(
      bookingId,
      new Date(now.getTime() + 2_500),
    ),
    (error: unknown) =>
      error instanceof BookingWorkflowError &&
      error.code === "BOOKING_NOT_FOUND",
  );
  assert.equal(
    database.read("booking_commission_payment_attempts", attemptId)?.status,
    "review_required",
  );
  assert.equal(
    database.read("booking_commission_payment_attempts", attemptId)?.receiptUrl,
    null,
  );

  const completion = await store.completeBankTransferAttempt({
    attemptId,
    receiptUrl: "https://receipts.example/interleaved-upgrade.pdf",
    receiptObjectKey: "booking-commission-receipts/interleaved-upgrade.pdf",
    receiptContentType: "application/pdf",
    receiptSizeBytes: 321,
    now: new Date(now.getTime() + 3_000),
  });
  assert.equal(completion.status, "review_required");
  assert.equal(
    completion.attempt.receiptObjectKey,
    "booking-commission-receipts/interleaved-upgrade.pdf",
  );
  assert.equal(completion.attempt.bankReviewDecision, "refund_review");
});

test("a bank upload and dispute cannot deadlock collection in concurrent tabs", async () => {
  const database = new FakeFirestore();
  const workflow = buildWorkflow();
  const bookingId = workflow.followUp.id;
  database.seed("booking_followups", bookingId, {
    ...workflow.followUp,
    contactRequestId: "CONTACT-BANK-DISPUTE-RACE",
    bookingDecision: "yes",
    questionnaireStartedAt: now.toISOString(),
  });
  database.seed("properties", "13383", {
    propertyNumber: "13383",
    whatsappNumber: "0500000001",
  });
  const store = new BookingCommissionStore(database as any);
  await store.confirmBooking(bookingId, {
    timing: "weekend",
    bookingDate: { value: "2026-08-15", precision: "day" },
    pricePaidHalalas: 100_000,
  }, new Date(now.getTime() + 1_000), true);
  const attemptId = "BCOM-ATT-BANK-DISPUTE-RACE";
  await store.reservePaymentAttempt({
    bookingId,
    attemptId,
    merchantAttemptKey: "RWQN-BCOM-BANK-DISPUTE-RACE",
    paymentMethod: "bank_transfer",
    now: new Date(now.getTime() + 2_000),
  });

  await assert.rejects(
    () => store.disputeCommission(
      bookingId,
      "اعتراض من نافذة ثانية",
      new Date(now.getTime() + 3_000),
    ),
    (error: unknown) =>
      error instanceof BookingWorkflowError &&
      error.code === "COMMISSION_BANK_TRANSFER_UNDER_REVIEW" &&
      error.status === 409,
  );

  // Simulate a legacy/in-flight transaction that set the dispute just before
  // this gate was deployed. Receipt evidence must be kept, never settled, and
  // must not prevent the dispute from being accepted afterward.
  database.update("booking_followups", bookingId, {
    disputeStatus: "pending",
    disputedAt: new Date(now.getTime() + 3_500).toISOString(),
    disputeReason: "اعتراض قديم متزامن",
  });
  const completion = await store.completeBankTransferAttempt({
    attemptId,
    receiptUrl: "https://receipts.example/dispute-race.pdf",
    receiptObjectKey: "booking-commission-receipts/race/dispute.pdf",
    receiptContentType: "application/pdf",
    receiptSizeBytes: 256,
    now: new Date(now.getTime() + 4_000),
  });
  assert.equal(completion.status, "review_required");
  assert.equal(
    completion.attempt.bankReviewReason,
    "commission_disputed_during_receipt_upload",
  );
  assert.equal(completion.attempt.bankReviewDecision, "refund_review");
  assert.equal(
    database.read("booking_followups", bookingId)?.commissionStatus,
    "pending",
  );

  const resolved = await store.resolveCommissionDispute(
    bookingId,
    "cancel_commission",
    new Date(now.getTime() + 5_000),
  );
  assert.equal(resolved.booking.commissionStatus, "waived");
  assert.equal(resolved.booking.disputeStatus, "accepted");
  assert.equal(
    database.read("booking_commission_payment_attempts", attemptId)
      ?.receiptObjectKey,
    "booking-commission-receipts/race/dispute.pdf",
  );
  assert.equal(
    database.read("booking_commission_payment_attempts", attemptId)
      ?.status,
    "review_required",
  );
});

test("bank receipt approval fails closed for dispute and owner-identity races", async () => {
  const disputedFixture = await pendingBankReceiptFixture();
  await assert.rejects(
    () => disputedFixture.store.disputeCommission(
      disputedFixture.bookingId,
      "اعتراض بعد رفع الإيصال",
      new Date(now.getTime() + 4_000),
    ),
    (error: unknown) =>
      error instanceof BookingWorkflowError &&
      error.code === "COMMISSION_BANK_TRANSFER_UNDER_REVIEW" &&
      error.status === 409,
  );
  assert.equal(
    disputedFixture.database.read("booking_followups", disputedFixture.bookingId)
      ?.disputeStatus,
    "none",
  );
  disputedFixture.database.update("booking_followups", disputedFixture.bookingId, {
    disputeStatus: "pending",
    disputedAt: new Date(now.getTime() + 4_000).toISOString(),
    disputeReason: "اعتراض صالح للاختبار",
  });
  await assert.rejects(
    () => disputedFixture.store.resolveBankTransferAttempt({
      bookingId: disputedFixture.bookingId,
      attemptId: disputedFixture.attemptId,
      resolution: "approve",
      now: new Date(now.getTime() + 5_000),
    }),
    (error: unknown) =>
      error instanceof BookingWorkflowError &&
      error.code === "COMMISSION_DISPUTED" &&
      error.status === 423,
  );
  assert.equal(
    disputedFixture.database.read(
      "booking_commission_payment_attempts",
      disputedFixture.attemptId,
    )?.status,
    "pending_review",
  );

  const ownerFixture = await pendingBankReceiptFixture();
  ownerFixture.database.update("properties", "13383", {
    whatsappNumber: "0500000099",
  });
  const ownerChanged = await ownerFixture.store.resolveBankTransferAttempt({
    bookingId: ownerFixture.bookingId,
    attemptId: ownerFixture.attemptId,
    resolution: "approve",
    now: new Date(now.getTime() + 5_000),
  });
  assert.equal(ownerChanged.status, "review_required");
  assert.equal(ownerChanged.reviewReason, "owner_identity_changed");
  assert.equal(
    ownerFixture.database.read("booking_followups", ownerFixture.bookingId)
      ?.commissionStatus,
    "pending",
  );
  assert.equal(
    ownerFixture.database.read(
      "booking_commission_payment_attempts",
      ownerFixture.attemptId,
    )?.receiptObjectKey,
    "booking-commission-receipts/a/b.pdf",
  );
});

test("a failed initial commission notice retries promptly without starting the deadline", async () => {
  const database = new FakeFirestore();
  const bookingId = "BOOK-REQ-13383-NOTICE";
  const jobId = `${bookingId}--owner_booking_confirmed`;
  database.seed("booking_followups", bookingId, {
    id: bookingId,
    propertyNumber: "13383",
    isFreeProperty: true,
    commissionStatus: "pending",
    commissionNoticeSentAt: null,
    commissionReminderOffsetsSent: [],
    events: [],
  });
  database.seed("booking_notification_outbox", jobId, {
    id: jobId,
    bookingId,
    kind: "owner_booking_confirmed",
    status: "claimed",
    attempts: 1,
    leaseToken: "lease-1",
    scheduledAt: now.toISOString(),
  });
  const store = new BookingCommissionStore(database as any);

  assert.equal(await store.finishNotificationJob({
    jobId,
    leaseToken: "lease-1",
    success: false,
    error: "provider_unavailable",
    now,
  }), true);
  const retry = database.read("booking_notification_outbox", jobId);
  assert.equal(retry?.status, "pending");
  assert.equal(
    retry?.scheduledAt,
    new Date(now.getTime() + BOOKING_OWNER_NOTICE_RETRY_MS).toISOString(),
  );
  assert.equal(retry?.failedAt, null);
  assert.equal(database.read("booking_followups", bookingId)?.commissionNoticeSentAt, null);

  database.seed("booking_notification_outbox", jobId, {
    ...retry,
    status: "claimed",
    attempts: 3,
    leaseToken: "lease-3",
  });
  assert.equal(await store.finishNotificationJob({
    jobId,
    leaseToken: "lease-3",
    success: false,
    error: "provider_unavailable",
    now,
  }), true);
  assert.equal(database.read("booking_notification_outbox", jobId)?.status, "failed");
});

test("the final send gate cancels stale customer links and changed-owner notifications", async () => {
  const database = new FakeFirestore();
  const workflow = buildWorkflow();
  const customerBookingId = workflow.followUp.id;
  database.seed("booking_followups", customerBookingId, {
    ...workflow.followUp,
    contactRequestId: "CONTACT-CUSTOMER",
  });
  database.seed("booking_notification_outbox", workflow.customerNotification.id, {
    ...workflow.customerNotification,
    status: "claimed",
    leaseToken: "customer-lease",
  });
  const store = new BookingCommissionStore(database as any);
  const expiredAt = new Date(now.getTime() + BOOKING_CUSTOMER_RESPONSE_WINDOW_MS);
  assert.deepEqual(
    await store.prepareNotificationForSend(
      workflow.customerNotification.id,
      "customer-lease",
      expiredAt,
    ),
    { status: "blocked", reason: "customer_response_expired" },
  );
  assert.equal(
    database.read("booking_notification_outbox", workflow.customerNotification.id)?.status,
    "cancelled",
  );

  const ownerBookingId = "BOOK-OWNER-CHANGED";
  database.seed("booking_followups", ownerBookingId, {
    ...workflow.followUp,
    id: ownerBookingId,
    contactRequestId: "CONTACT-OWNER",
    bookingStatus: "confirmed",
    bookingDecision: "yes",
    confirmationFacts: {
      timing: "weekend",
      bookingDate: { value: "2026-08-15", precision: "day" },
      pricePaidHalalas: 100_000,
    },
    confirmedAt: now.toISOString(),
    commissionStatus: "pending",
    commissionAmountHalalas: 10_000,
    commissionDueAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1_000).toISOString(),
  });
  const ownerJobId = `${ownerBookingId}--owner_booking_confirmed`;
  database.seed("booking_notification_outbox", ownerJobId, {
    ...workflow.customerNotification,
    id: ownerJobId,
    bookingId: ownerBookingId,
    recipientRole: "owner",
    recipientPhone: workflow.followUp.ownerPhone,
    kind: "owner_booking_confirmed",
    status: "claimed",
    leaseToken: "owner-lease",
  });
  database.seed("properties", "13383", {
    propertyNumber: "13383",
    whatsappNumber: "0500000099",
  });
  assert.deepEqual(
    await store.prepareNotificationForSend(ownerJobId, "owner-lease", now),
    { status: "blocked", reason: "owner_identity_changed" },
  );
  const ownerReview = database.read("booking_followups", ownerBookingId);
  assert.equal(ownerReview?.disputeStatus, "pending");
  assert.equal(ownerReview?.disputeReason, "owner_identity_changed");
  assert.equal(JSON.stringify(ownerReview).includes("0500000099"), false);
});

test("reminder and pause sends wait for the delivered owner notice at claim and prepare time", async () => {
  const database = new FakeFirestore();
  const base = confirmedObserveOnlyFixture();
  const booking = {
    ...base,
    commissionStatus: "pending" as const,
    commissionAmountHalalas: 10_000,
    commissionDueAt: new Date(now.getTime() + 5 * 86_400_000).toISOString(),
    commissionNoticeSentAt: null,
    disputeStatus: "none" as const,
  };
  const reminderId = `${booking.id}--commission_reminder_3`;
  const pauseId = `${booking.id}--property_paused`;
  database.seed("booking_followups", booking.id, booking);
  database.seed("properties", booking.propertyNumber, {
    propertyNumber: booking.propertyNumber,
    whatsappNumber: "0500000001",
  });
  database.seed("booking_notification_outbox", reminderId, ownerNotificationFixture(
    booking as any,
    {
      id: reminderId,
      kind: "commission_reminder_3",
      reminderOffsetDays: 3,
      status: "pending",
      attempts: 0,
      scheduledAt: now.toISOString(),
      quotaCategory: "transactional",
    },
  ));
  database.seed("booking_notification_outbox", pauseId, ownerNotificationFixture(
    booking as any,
    {
      id: pauseId,
      kind: "property_paused",
      status: "claimed",
      leaseToken: "pause-before-notice",
      scheduledAt: now.toISOString(),
      quotaCategory: "transactional",
    },
  ));
  const store = new BookingCommissionStore(database as any);

  assert.deepEqual(await store.claimDueNotificationJobs(now, 5, {
    followUpNotificationsEnabled: true,
    commissionNotificationsEnabled: true,
  }), []);
  assert.equal(database.read("booking_notification_outbox", reminderId)?.status, "pending");
  assert.equal(
    database.read("booking_notification_outbox", reminderId)?.providerError,
    "awaiting_owner_commission_notice",
  );
  assert.deepEqual(
    await store.prepareNotificationForSend(
      pauseId,
      "pause-before-notice",
      now,
    ),
    { status: "blocked", reason: "notification_state_changed" },
  );
  assert.equal(database.read("booking_notification_outbox", pauseId)?.status, "pending");
  assert.equal(
    database.read("booking_notification_outbox", pauseId)?.scheduledAt,
    new Date(now.getTime() + BOOKING_OWNER_NOTICE_RETRY_MS).toISOString(),
  );
});

test("bank receipt review parks claimed payment prompts and rejection safely resumes them", async () => {
  const database = new FakeFirestore();
  const workflow = buildWorkflow();
  const bookingId = workflow.followUp.id;
  database.seed("booking_followups", bookingId, {
    ...workflow.followUp,
    contactRequestId: "CONTACT-BANK-PROMPT-RACE",
    bookingDecision: "yes",
    questionnaireStartedAt: now.toISOString(),
  });
  database.seed("properties", "13383", {
    propertyNumber: "13383",
    whatsappNumber: "0500000001",
  });
  const store = new BookingCommissionStore(database as any);
  await store.confirmBooking(bookingId, {
    timing: "weekend",
    bookingDate: { value: "2026-08-15", precision: "day" },
    pricePaidHalalas: 100_000,
  }, new Date(now.getTime() + 1_000), true);
  const noticeAt = new Date(now.getTime() - 5 * 86_400_000).toISOString();
  database.update("booking_followups", bookingId, {
    commissionNoticeSentAt: noticeAt,
    commissionDueAt: now.toISOString(),
  });
  const reminderId = `${bookingId}--commission_reminder_5`;
  database.update("booking_notification_outbox", reminderId, {
    status: "claimed",
    leaseToken: "claimed-before-receipt",
    leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
    scheduledAt: now.toISOString(),
  });
  const attemptId = "BCOM-ATT-BANK-PROMPT-RACE";
  await store.reservePaymentAttempt({
    bookingId,
    attemptId,
    merchantAttemptKey: "RWQN-BCOM-BANK-PROMPT-RACE",
    paymentMethod: "bank_transfer",
    now: new Date(now.getTime() + 2_000),
  });
  await store.completeBankTransferAttempt({
    attemptId,
    receiptUrl: "https://receipts.example/prompt-race.pdf",
    receiptObjectKey: "booking-commission-receipts/prompt-race.pdf",
    receiptContentType: "application/pdf",
    receiptSizeBytes: 128,
    now: new Date(now.getTime() + 3_000),
  });

  const parked = database.read("booking_notification_outbox", reminderId);
  assert.equal(parked?.status, "pending");
  assert.equal(parked?.leaseToken, null);
  assert.equal(parked?.providerError, "bank_transfer_under_review");
  assert.deepEqual(
    await store.prepareNotificationForSend(
      reminderId,
      "claimed-before-receipt",
      new Date(now.getTime() + 3_500),
    ),
    { status: "blocked", reason: "claim_invalid" },
  );

  database.update("booking_notification_outbox", reminderId, {
    status: "pending",
    scheduledAt: new Date(now.getTime() + 3_500).toISOString(),
  });
  assert.deepEqual(await store.claimDueNotificationJobs(
    new Date(now.getTime() + 4_000),
    5,
    {
      followUpNotificationsEnabled: true,
      commissionNotificationsEnabled: true,
    },
  ), []);
  assert.equal(
    database.read("booking_notification_outbox", reminderId)?.providerError,
    "bank_transfer_under_review",
  );

  const ownerNoticeId = `${bookingId}--owner_booking_confirmed`;
  database.update("booking_notification_outbox", ownerNoticeId, {
    status: "sent",
    sentAt: new Date(now.getTime() + 4_100).toISOString(),
    leaseToken: null,
    leaseExpiresAt: null,
  });
  await assert.rejects(
    () => store.scheduleManualNotificationResend({
      bookingId,
      sourceJobId: ownerNoticeId,
      idempotencyKey: "bank-review-owner-notice-resend",
      now: new Date(now.getTime() + 4_200),
    }),
    (error: unknown) =>
      error instanceof BookingWorkflowError &&
      error.code === "NOTIFICATION_STATE_CHANGED",
  );

  await store.resolveBankTransferAttempt({
    bookingId,
    attemptId,
    resolution: "reject",
    now: new Date(now.getTime() + 5_000),
  });
  const resumed = database.read("booking_notification_outbox", reminderId);
  assert.equal(resumed?.status, "pending");
  assert.equal(resumed?.leaseToken, null);
  assert.equal(resumed?.providerError, null);
  assert.equal(resumed?.scheduledAt, new Date(now.getTime() + 5_000).toISOString());
});

test("the final send gate blocks answered follow-ups, closed collection prompts, and re-held releases", async () => {
  const customerDb = new FakeFirestore();
  const workflow = buildWorkflow();
  customerDb.seed("booking_followups", workflow.followUp.id, {
    ...workflow.followUp,
    contactRequestId: "CONTACT-ANSWERED-BEFORE-SEND",
    bookingStatus: "declined",
    declinedAt: now.toISOString(),
  });
  customerDb.seed("booking_notification_outbox", workflow.customerNotification.id, {
    ...workflow.customerNotification,
    status: "claimed",
    leaseToken: "answered-customer-lease",
  });
  assert.deepEqual(
    await new BookingCommissionStore(customerDb as any).prepareNotificationForSend(
      workflow.customerNotification.id,
      "answered-customer-lease",
      now,
    ),
    { status: "blocked", reason: "notification_state_changed" },
  );

  for (const state of ["paid", "waived", "disputed"] as const) {
    const database = new FakeFirestore();
    const base = confirmedObserveOnlyFixture();
    const booking = {
      ...base,
      id: `${base.id}-${state}`,
      commissionStatus: state === "paid"
        ? "paid" as const
        : state === "waived"
          ? "waived" as const
          : "pending" as const,
      commissionAmountHalalas: 10_000,
      commissionNoticeSentAt: new Date(now.getTime() - 4 * 86_400_000).toISOString(),
      commissionDueAt: new Date(now.getTime() + 86_400_000).toISOString(),
      disputeStatus: state === "disputed" ? "pending" as const : "none" as const,
    };
    const jobId = `${booking.id}--commission_reminder_3`;
    database.seed("booking_followups", booking.id, booking);
    database.seed("booking_notification_outbox", jobId, ownerNotificationFixture(
      booking as any,
      {
        id: jobId,
        bookingId: booking.id,
        kind: "commission_reminder_3",
        reminderOffsetDays: 3,
        status: "claimed",
        leaseToken: `lease-${state}`,
        quotaCategory: "transactional",
      },
    ));
    database.seed("properties", booking.propertyNumber, {
      propertyNumber: booking.propertyNumber,
      whatsappNumber: "0500000001",
    });
    assert.deepEqual(
      await new BookingCommissionStore(database as any).prepareNotificationForSend(
        jobId,
        `lease-${state}`,
        now,
      ),
      { status: "blocked", reason: "notification_state_changed" },
    );
    assert.equal(
      database.read("booking_notification_outbox", jobId)?.providerError,
      state === "paid"
        ? "commission_paid"
        : state === "waived"
          ? "commission_waived"
          : "commission_disputed",
    );
  }

  const releaseDb = new FakeFirestore();
  const releaseBase = confirmedObserveOnlyFixture();
  const releaseBooking = {
    ...releaseBase,
    id: `${releaseBase.id}-release-reheld`,
    commissionStatus: "paid" as const,
    complianceStatus: "released" as const,
  };
  const releaseJobId = `${releaseBooking.id}--property_released`;
  releaseDb.seed("booking_followups", releaseBooking.id, releaseBooking);
  releaseDb.seed("booking_notification_outbox", releaseJobId, ownerNotificationFixture(
    releaseBooking as any,
    {
      id: releaseJobId,
      bookingId: releaseBooking.id,
      kind: "property_released",
      status: "claimed",
      leaseToken: "release-reheld-lease",
      quotaCategory: "transactional",
    },
  ));
  releaseDb.seed("properties", releaseBooking.propertyNumber, {
    propertyNumber: releaseBooking.propertyNumber,
    whatsappNumber: "0500000001",
    commissionHold: { active: true, obligationIds: ["BOOK-OTHER"] },
  });
  assert.deepEqual(
    await new BookingCommissionStore(releaseDb as any).prepareNotificationForSend(
      releaseJobId,
      "release-reheld-lease",
      now,
    ),
    { status: "blocked", reason: "notification_state_changed" },
  );
});

test("notification claims fail closed before leasing expired customer or changed-owner jobs", async () => {
  const customerDb = new FakeFirestore();
  const workflow = buildWorkflow();
  customerDb.seed("booking_followups", workflow.followUp.id, {
    ...workflow.followUp,
    contactRequestId: "CONTACT-CLAIM-CUSTOMER",
  });
  customerDb.seed(
    "booking_notification_outbox",
    workflow.customerNotification.id,
    { ...workflow.customerNotification, scheduledAt: now.toISOString() },
  );
  const customerStore = new BookingCommissionStore(customerDb as any);
  const expiredAt = new Date(now.getTime() + BOOKING_CUSTOMER_RESPONSE_WINDOW_MS);
  assert.deepEqual(await customerStore.claimDueNotificationJobs(expiredAt, 5, {
    followUpNotificationsEnabled: true,
    commissionNotificationsEnabled: true,
  }), []);
  assert.equal(
    customerDb.read("booking_notification_outbox", workflow.customerNotification.id)?.providerError,
    "customer_response_expired",
  );

  const ownerDb = new FakeFirestore();
  const ownerBookingId = "BOOK-CLAIM-OWNER-CHANGED";
  ownerDb.seed("booking_followups", ownerBookingId, {
    ...workflow.followUp,
    id: ownerBookingId,
    contactRequestId: "CONTACT-CLAIM-OWNER",
    bookingStatus: "confirmed",
    commissionStatus: "pending",
    confirmationFacts: {
      timing: "weekend",
      bookingDate: { value: "2026-08-15", precision: "day" },
      pricePaidHalalas: 100_000,
    },
    confirmedAt: now.toISOString(),
    commissionAmountHalalas: 10_000,
    commissionDueAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1_000).toISOString(),
  });
  const ownerJobId = `${ownerBookingId}--owner_booking_confirmed`;
  ownerDb.seed("booking_notification_outbox", ownerJobId, {
    ...workflow.customerNotification,
    id: ownerJobId,
    bookingId: ownerBookingId,
    recipientRole: "owner",
    recipientPhone: workflow.followUp.ownerPhone,
    recipientQuotaKey: "500000001",
    kind: "owner_booking_confirmed",
    quotaCategory: "transactional",
    scheduledAt: now.toISOString(),
  });
  ownerDb.seed("properties", "13383", {
    propertyNumber: "13383",
    whatsappNumber: "0500000099",
  });
  const ownerStore = new BookingCommissionStore(ownerDb as any);
  assert.deepEqual(await ownerStore.claimDueNotificationJobs(now, 5, {
    followUpNotificationsEnabled: true,
    commissionNotificationsEnabled: true,
  }), []);
  assert.equal(
    ownerDb.read("booking_notification_outbox", ownerJobId)?.providerError,
    "owner_identity_changed",
  );
  assert.equal(ownerDb.read("booking_followups", ownerBookingId)?.disputeStatus, "pending");
});

test("a hold requires the anchored deadline and every owner notice to be delivered", async () => {
  const database = new FakeFirestore();
  const bookingId = "BOOK-REQ-13383-HOLD";
  const noticeSentAt = "2026-08-10T12:00:00.000Z";
  database.seed("booking_followups", bookingId, {
    id: bookingId,
    propertyNumber: "13383",
    ownerPhone: "+966500000001",
    isFreeProperty: true,
    bookingStatus: "confirmed",
    commissionStatus: "pending",
    complianceStatus: "clear",
    disputeStatus: "none",
    commissionNoticeSentAt: noticeSentAt,
    commissionDueAt: "2026-08-15T12:00:00.000Z",
    commissionReminderOffsetsSent: [5],
    enforcementLeaseToken: "hold-lease",
    enforcementLeaseExpiresAt: "2026-08-15T12:36:56.789Z",
    events: [],
  });
  database.seed("properties", "13383", {
    propertyNumber: "13383",
    whatsappNumber: "0500000001",
    commissionHold: { active: false, obligationIds: [] },
  });
  for (const kind of ["commission_reminder_5", "property_paused"] as const) {
    database.seed("booking_notification_outbox", `${bookingId}--${kind}`, {
      bookingId,
      kind,
      status: "sent",
    });
  }
  const store = new BookingCommissionStore(database as any);

  assert.equal(await store.applyCommissionHold(bookingId, now, "hold-lease"), "skipped");
  assert.equal(database.read("properties", "13383")?.commissionHold.active, false);

  database.seed("booking_notification_outbox", `${bookingId}--owner_booking_confirmed`, {
    bookingId,
    kind: "owner_booking_confirmed",
    status: "sent",
  });
  assert.equal(await store.applyCommissionHold(bookingId, now, "hold-lease"), "paused");
  assert.equal(database.read("properties", "13383")?.commissionHold.active, true);

  database.seed("booking_followups", bookingId, {
    ...database.read("booking_followups", bookingId),
    commissionStatus: "pending",
    complianceStatus: "clear",
  });
  database.seed("properties", "13383", {
    ...database.read("properties", "13383"),
    whatsappNumber: "0500000099",
    commissionHold: { active: false, obligationIds: [] },
  });
  assert.equal(
    await store.applyCommissionHold(bookingId, now, "hold-lease"),
    "owner_identity_changed",
  );
  const reviewed = database.read("booking_followups", bookingId);
  assert.equal(reviewed?.disputeStatus, "pending");
  assert.equal(reviewed?.enforcementLastError, "owner_identity_changed");
  assert.equal(database.read("properties", "13383")?.commissionHold.active, false);
});

test("hold application honors the payment attempt identity observed by provider reconciliation", async () => {
  const seedReady = (
    activeAttemptId: string | null,
    attempt?: Record<string, unknown>,
  ) => {
    const database = new FakeFirestore();
    const bookingId = `BOOK-HOLD-${activeAttemptId || "NONE"}`;
    database.seed("booking_followups", bookingId, {
      id: bookingId,
      propertyNumber: "13383",
      ownerPhone: "+966500000001",
      isFreeProperty: true,
      bookingStatus: "confirmed",
      commissionStatus: "pending",
      complianceStatus: "clear",
      disputeStatus: "none",
      commissionNoticeSentAt: "2026-08-10T12:00:00.000Z",
      commissionDueAt: "2026-08-15T12:00:00.000Z",
      commissionReminderOffsetsSent: [5],
      activeAttemptId,
      enforcementLeaseToken: "hold-race-lease",
      enforcementLeaseExpiresAt: "2026-08-15T12:36:56.789Z",
      events: [],
    });
    database.seed("properties", "13383", {
      propertyNumber: "13383",
      whatsappNumber: "0500000001",
      commissionHold: { active: false, obligationIds: [] },
    });
    for (const kind of [
      "owner_booking_confirmed",
      "commission_reminder_5",
      "property_paused",
    ] as const) {
      database.seed("booking_notification_outbox", `${bookingId}--${kind}`, {
        bookingId,
        kind,
        status: "sent",
      });
    }
    if (activeAttemptId && attempt) {
      database.seed("booking_commission_payment_attempts", activeAttemptId, {
        id: activeAttemptId,
        bookingId,
        ...attempt,
      });
    }
    return {
      database,
      bookingId,
      store: new BookingCommissionStore(database as any),
    };
  };

  const verified = seedReady("ATT-VERIFIED-UNPAID", {
    status: "created",
    paymentMethod: "cards",
  });
  assert.equal(await verified.store.applyCommissionHold(
    verified.bookingId,
    now,
    "hold-race-lease",
    "ATT-VERIFIED-UNPAID",
  ), "paused");

  const inserted = seedReady("ATT-INSERTED-AFTER-CHECK", {
    status: "creating",
    paymentMethod: "cards",
  });
  assert.equal(await inserted.store.applyCommissionHold(
    inserted.bookingId,
    now,
    "hold-race-lease",
    null,
  ), "skipped");
  assert.equal(
    inserted.database.read("properties", "13383")?.commissionHold.active,
    false,
  );

  const bankReview = seedReady("ATT-BANK-REVIEW-HOLD", {
    status: "pending_review",
    paymentMethod: "bank_transfer",
  });
  assert.equal(await bankReview.store.applyCommissionHold(
    bankReview.bookingId,
    now,
    "hold-race-lease",
    "ATT-BANK-REVIEW-HOLD",
  ), "skipped");
  assert.equal(
    bankReview.database.read("properties", "13383")?.commissionHold.active,
    false,
  );
});

test("only one worker can claim a booking for commission enforcement", async () => {
  const database = new FakeFirestore();
  const bookingId = "BOOK-REQ-13383-LEASE";
  database.seed("booking_followups", bookingId, {
    id: bookingId,
    propertyNumber: "13383",
    isFreeProperty: true,
    bookingStatus: "confirmed",
    commissionStatus: "pending",
    disputeStatus: "none",
    commissionDueAt: "2026-08-15T12:00:00.000Z",
    enforcementDeferredUntil: null,
    enforcementLeaseToken: null,
    enforcementLeaseExpiresAt: null,
  });
  const store = new BookingCommissionStore(database as any);

  const first = await store.claimCommissionEnforcement(bookingId, now);
  assert.ok(first?.leaseToken);
  assert.equal(await store.claimCommissionEnforcement(bookingId, now), null);
  assert.equal(await store.releaseCommissionEnforcementClaim(bookingId, "wrong-token"), false);
  assert.equal(await store.releaseCommissionEnforcementClaim(bookingId, first.leaseToken), true);
  const second = await store.claimCommissionEnforcement(bookingId, now);
  assert.ok(second?.leaseToken);
  assert.notEqual(second.leaseToken, first.leaseToken);
});

test("only the active enforcement lease can defer a booking", async () => {
  const database = new FakeFirestore();
  const bookingId = "BOOK-REQ-13383-DEFER-LEASE";
  database.seed("booking_followups", bookingId, {
    id: bookingId,
    bookingStatus: "confirmed",
    commissionStatus: "pending",
    disputeStatus: "none",
    commissionDueAt: "2026-08-15T12:00:00.000Z",
    enforcementDeferredUntil: null,
    enforcementLastError: null,
    enforcementLeaseToken: "current-lease",
    enforcementLeaseExpiresAt: "2026-08-15T12:02:00.000Z",
    events: [],
  });
  const store = new BookingCommissionStore(database as any);
  const retryAt = new Date("2026-08-15T12:30:00.000Z");

  assert.equal(
    await store.deferEnforcement(
      bookingId,
      "provider_timeout",
      retryAt,
      now,
      "stale-lease",
    ),
    false,
  );
  assert.equal(database.read("booking_followups", bookingId)?.enforcementDeferredUntil, null);

  assert.equal(
    await store.deferEnforcement(
      bookingId,
      "provider_timeout",
      retryAt,
      now,
      "current-lease",
    ),
    true,
  );
  const deferred = database.read("booking_followups", bookingId);
  assert.equal(deferred?.enforcementDeferredUntil, retryAt.toISOString());
  assert.equal(deferred?.events.length, 1);

  assert.equal(
    await store.deferEnforcement(
      bookingId,
      "provider_timeout",
      retryAt,
      now,
      "current-lease",
    ),
    true,
  );
  assert.equal(
    database.read("booking_followups", bookingId)?.events.length,
    1,
    "an identical future deferral is idempotent",
  );
});
