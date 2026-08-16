import assert from "node:assert/strict";
import test from "node:test";
import { bookingFollowUpRecordSchema } from "../../shared/booking";
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

  update(collection: string, id: string, updates: FakeData): void {
    const current = this.read(collection, id);
    if (!current) throw new Error(`Missing fake document ${collection}/${id}`);
    this.seed(collection, id, { ...current, ...updates });
  }
}

class FakeQuery {
  private readonly filters: Array<{ field: string; operator: string; value: unknown }> = [];
  private max = Number.POSITIVE_INFINITY;

  constructor(
    private readonly database: FakeFirestore,
    private readonly collectionName: string,
  ) {}

  where(field: string, operator: string, value: unknown): FakeQuery {
    this.filters.push({ field, operator, value });
    return this;
  }

  orderBy(): FakeQuery {
    return this;
  }

  limit(value: number): FakeQuery {
    this.max = value;
    return this;
  }

  async get() {
    const documents = (this.database as any).collections.get(this.collectionName) as
      | Map<string, FakeData>
      | undefined;
    const docs = [...(documents?.keys() || [])]
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
