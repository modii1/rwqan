import assert from "node:assert/strict";
import test from "node:test";
import {
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
    "FREE_OWNER_BOOKING_NOTIFICATION_DAILY_LIMIT",
    "FREE_PROPERTY_DAILY_CONTACT_LIMIT",
  ] as const;
  const previousEnvironment = Object.fromEntries(
    envNames.map((name) => [name, process.env[name]]),
  );
  const database = new FakeFirestore();
  const store = new BookingCommissionStore(database as any);
  const updatedAt = new Date("2026-08-18T10:00:00.000Z");

  try {
    process.env.CUSTOMER_BOOKING_FOLLOWUP_DAILY_LIMIT = "7";
    process.env.FREE_OWNER_BOOKING_NOTIFICATION_DAILY_LIMIT = "8";
    process.env.FREE_PROPERTY_DAILY_CONTACT_LIMIT = "9";

    const environmentSettings = {
      customerDailyLimit: 7,
      freeOwnerDailyLimit: 8,
      freePropertyContactDailyLimit: 9,
      whatsappTemplates: DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
      optionalCommissionReminderDays: [3, 4],
      updatedAt: null,
      updatedBy: "environment" as const,
      source: "environment" as const,
    };
    assert.deepEqual(await store.getFreeWorkflowSettings(), environmentSettings);

    const configuration = {
      customerDailyLimit: 4,
      freeOwnerDailyLimit: 5,
      freePropertyContactDailyLimit: 6,
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
    assert.deepEqual(database.read("settings", "booking_free_workflow_limits"), {
      schemaVersion: 2,
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

test("a stale owner link cannot read, dispute, or reserve checkout, while its signed provider callback remains valid", async () => {
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
  assert.equal(settlement.status, "paid");
  assert.equal(database.read("booking_followups", bookingId)?.commissionStatus, "paid");
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
