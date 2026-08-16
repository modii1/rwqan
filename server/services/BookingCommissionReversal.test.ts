import assert from "node:assert/strict";
import test from "node:test";

import { BookingCommissionStore, BookingWorkflowError } from "./BookingCommissionStore";

type Data = Record<string, any>;

class FakeFirestore {
  private readonly data = new Map<string, Map<string, Data>>();

  collection(name: string) {
    return new FakeCollection(this, name);
  }

  async runTransaction<T>(work: (transaction: FakeTransaction) => Promise<T>) {
    return work(new FakeTransaction(this));
  }

  seed(collection: string, id: string, value: Data) {
    let documents = this.data.get(collection);
    if (!documents) {
      documents = new Map();
      this.data.set(collection, documents);
    }
    documents.set(id, { ...value });
  }

  read(collection: string, id: string) {
    const value = this.data.get(collection)?.get(id);
    return value ? { ...value } : undefined;
  }

  documents(collection: string) {
    return [...(this.data.get(collection)?.entries() || [])];
  }

  update(collection: string, id: string, updates: Data) {
    const current = this.read(collection, id);
    if (!current) throw new Error(`Missing ${collection}/${id}`);
    this.seed(collection, id, { ...current, ...updates });
  }
}

class FakeCollection {
  constructor(readonly database: FakeFirestore, readonly name: string) {}
  doc(id: string) { return new FakeDocumentReference(this.database, this.name, id); }
  where(field: string, _operator: string, value: unknown) {
    return new FakeQuery(this.database, this.name, field, value);
  }
}

class FakeDocumentReference {
  constructor(
    readonly database: FakeFirestore,
    readonly collectionName: string,
    readonly id: string,
  ) {}
}

class FakeDocumentSnapshot {
  constructor(readonly ref: FakeDocumentReference) {}
  get exists() { return Boolean(this.ref.database.read(this.ref.collectionName, this.ref.id)); }
  data() { return this.ref.database.read(this.ref.collectionName, this.ref.id); }
}

class FakeQuery {
  constructor(
    readonly database: FakeFirestore,
    readonly collectionName: string,
    readonly field: string,
    readonly value: unknown,
  ) {}
}

class FakeQuerySnapshot {
  readonly docs: FakeDocumentSnapshot[];
  constructor(query: FakeQuery) {
    this.docs = query.database.documents(query.collectionName)
      .filter(([, value]) => value[query.field] === query.value)
      .map(([id]) => new FakeDocumentSnapshot(
        new FakeDocumentReference(query.database, query.collectionName, id),
      ));
  }
  get empty() { return this.docs.length === 0; }
}

class FakeTransaction {
  constructor(private readonly database: FakeFirestore) {}
  async get(ref: FakeDocumentReference | FakeQuery) {
    return ref instanceof FakeQuery
      ? new FakeQuerySnapshot(ref)
      : new FakeDocumentSnapshot(ref);
  }
  update(ref: FakeDocumentReference, updates: Data) {
    this.database.update(ref.collectionName, ref.id, updates);
  }
  create(ref: FakeDocumentReference, value: Data) {
    if (this.database.read(ref.collectionName, ref.id)) throw new Error("already exists");
    this.database.seed(ref.collectionName, ref.id, value);
  }
  set(ref: FakeDocumentReference, value: Data) {
    this.database.seed(ref.collectionName, ref.id, value);
  }
}

const now = new Date("2026-08-15T12:00:00.000Z");
const bookingId = "BOOK-REVERSAL-1";
const attemptId = "ATTEMPT-REVERSAL-1";
const orderId = "ORDER-REVERSAL-1";
const merchantAttemptKey = "RWQN-BCOM-REVERSAL-1";

function seedPayment(database: FakeFirestore, paid: boolean) {
  database.seed("booking_followups", bookingId, {
    id: bookingId,
    contactRequestId: "CONTACT-REVERSAL-1",
    requestCode: "REQ-REVERSAL-1",
    bookingStatus: "confirmed",
    propertyNumber: "13383",
    propertyName: "Property",
    ownerPhone: "+966500000001",
    customerPhone: "+966500000002",
    customerSubject: "customer-subject",
    isFreeProperty: true,
    followUpDueAt: "2026-08-08T12:00:00.000Z",
    createdAt: "2026-08-07T12:00:00.000Z",
    updatedAt: "2026-08-14T12:00:00.000Z",
    confirmationFacts: {
      timing: "weekend",
      bookingDate: { value: "2026-08-10", precision: "day" },
      pricePaidHalalas: 125_555,
    },
    confirmedAt: "2026-08-09T12:00:00.000Z",
    declinedAt: null,
    commissionAmountHalalas: 12_556,
    commissionStatus: paid ? "paid" : "pending",
    complianceStatus: paid ? "released" : "clear",
    commissionPaidAt: paid ? "2026-08-14T12:00:00.000Z" : null,
    paidAttemptId: paid ? attemptId : null,
    activeAttemptId: attemptId,
    disputeStatus: "none",
    enforcementLastError: null,
    commissionNoticeSentAt: "2026-08-09T12:00:00.000Z",
    commissionDueAt: "2026-08-14T12:00:00.000Z",
    commissionReminderOffsetsSent: [3, 4, 5],
    events: [],
  });
  database.seed("booking_commission_payment_attempts", attemptId, {
    id: attemptId,
    bookingId,
    propertyNumber: "13383",
    paymobOrderId: orderId,
    merchantAttemptKey,
    amountCents: 12_556,
    currency: "SAR",
    status: paid ? "paid" : "created",
    transactionId: paid ? "TX-PAID" : null,
    updatedAt: "2026-08-14T12:00:00.000Z",
  });
  database.seed("booking_commission_order_bindings", orderId, {
    bookingId,
    attemptId,
    merchantAttemptKey,
    amountCents: 12_556,
    currency: "SAR",
  });
  database.seed("properties", "13383", {
    propertyNumber: "13383",
    whatsappNumber: "+966500000001",
    commissionHold: { active: false, obligationIds: [] },
  });
}

function reversalInput(reason: "refunded" | "voided" | "errored" | "authorization_only" | "other_nonpayable", transactionId: string) {
  return { paymobOrderId: orderId, transactionId, amountCents: 12_556, currency: "SAR", reason, now };
}

test("a non-payable callback before settlement closes the attempt and permits retry", async () => {
  const database = new FakeFirestore();
  seedPayment(database, false);
  const store = new BookingCommissionStore(database as any);

  const result = await store.recordCommissionReversal(
    reversalInput("voided", "TX-VOIDED"),
  );
  assert.deepEqual(result, { status: "recorded", bookingId, reviewRequired: false });
  const attempt = database.read("booking_commission_payment_attempts", attemptId);
  assert.equal(attempt?.status, "failed");
  assert.equal(attempt?.nonPayableStatus, "voided");
  assert.equal(attempt?.reversalStatus, undefined);
  assert.equal(database.read("booking_followups", bookingId)?.activeAttemptId, null);
  assert.equal(database.read("booking_followups", bookingId)?.enforcementLastError, null);
});

test("authorization is informational and an exact capture clears legacy authorization review state", async () => {
  const database = new FakeFirestore();
  seedPayment(database, false);
  const store = new BookingCommissionStore(database as any);

  const authorization = await store.recordCommissionReversal(
    reversalInput("authorization_only", "TX-AUTH"),
  );
  assert.deepEqual(authorization, { status: "recorded", bookingId, reviewRequired: false });
  assert.equal(database.read("booking_commission_payment_attempts", attemptId)?.status, "created");
  assert.equal(database.read("booking_commission_payment_attempts", attemptId)?.authorizationTransactionId, "TX-AUTH");
  assert.equal(database.read("booking_followups", bookingId)?.events.at(-1)?.type, "commission_payment_authorized");

  database.update("booking_commission_payment_attempts", attemptId, {
    reversalStatus: "authorization_only",
    reversalTransactionId: "TX-AUTH-LEGACY",
    reversedAt: "2026-08-15T11:00:00.000Z",
  });
  database.update("booking_followups", bookingId, {
    enforcementLastError: "commission_payment_authorization_only_requires_admin_review",
    events: [{
      type: "commission_payment_reversal_reported",
      at: "2026-08-15T11:00:00.000Z",
      detail: "authorization_only",
    }],
  });
  const settlement = await store.settleCommissionCallback({
    paymobOrderId: orderId,
    transactionId: "TX-CAPTURE",
    amountCents: 12_556,
    currency: "SAR",
    success: true,
    exactPaymentMethod: "visa",
    callbackAttemptId: attemptId,
    callbackBookingId: bookingId,
    callbackMerchantAttemptKey: merchantAttemptKey,
    callbackSpecialReference: merchantAttemptKey,
  }, now);
  assert.equal(settlement.status, "paid");
  const paidAttempt = database.read("booking_commission_payment_attempts", attemptId);
  assert.equal(paidAttempt?.reversalStatus, null);
  assert.equal(paidAttempt?.authorizationTransactionId, "TX-AUTH-LEGACY");
  assert.equal(database.read("booking_followups", bookingId)?.enforcementLastError, null);
  assert.deepEqual(
    database.read("booking_followups", bookingId)?.events.map((event: Data) => event.type),
    ["commission_payment_authorized", "commission_paid"],
  );
});

test("admin reversal resolution is exact, idempotent, and can restart collection without pausing", async () => {
  const database = new FakeFirestore();
  seedPayment(database, true);
  for (const kind of [
    "owner_booking_confirmed",
    "commission_reminder_3",
    "commission_reminder_4",
    "commission_reminder_5",
    "property_paused",
  ]) {
    database.seed("booking_notification_outbox", `${bookingId}--${kind}`, {
      id: `${bookingId}--${kind}`,
      bookingId,
      kind,
      status: "sent",
      attempts: 1,
      createdAt: "2026-08-09T12:00:00.000Z",
    });
  }
  const store = new BookingCommissionStore(database as any);
  const reversal = await store.recordCommissionReversal(
    reversalInput("refunded", "TX-REFUND"),
  );
  assert.deepEqual(reversal, { status: "recorded", bookingId, reviewRequired: true });

  const input = {
    bookingId,
    attemptId,
    reversalTransactionId: "TX-REFUND",
    resolution: "resume_collection" as const,
    now,
  };
  const resolved = await store.resolveCommissionReversal(input);
  assert.equal(resolved.booking.commissionStatus, "pending");
  assert.equal(resolved.booking.complianceStatus, "clear");
  assert.equal(resolved.booking.commissionPaidAt, null);
  assert.equal(resolved.booking.activeAttemptId, null);
  assert.equal(resolved.booking.paidAttemptId, null);
  assert.equal(resolved.booking.commissionDueAt, "2026-08-14T12:00:00.000Z");
  assert.equal(resolved.attempt.reversalResolution, "resume_collection");
  assert.equal(database.read("properties", "13383")?.commissionHold.active, false);
  assert.equal(database.read("booking_notification_outbox", `${bookingId}--owner_booking_confirmed`)?.status, "pending");
  assert.equal(database.read("booking_notification_outbox", `${bookingId}--owner_booking_confirmed`)?.attempts, 0);
  assert.equal(database.read("booking_notification_outbox", `${bookingId}--commission_reminder_5`)?.attempts, 0);
  assert.equal(database.read("booking_notification_outbox", `${bookingId}--property_paused`)?.attempts, 0);
  assert.equal(database.read("booking_notification_outbox", `${bookingId}--property_paused`)?.scheduledAt, "2026-08-20T12:00:00.000Z");

  const eventCount = database.read("booking_followups", bookingId)?.events.length;
  const replay = await store.resolveCommissionReversal(input);
  assert.equal(replay.resolution, "resume_collection");
  assert.equal(database.read("booking_followups", bookingId)?.events.length, eventCount);
  await assert.rejects(
    store.resolveCommissionReversal({ ...input, resolution: "keep_paid" }),
    (error: unknown) => error instanceof BookingWorkflowError &&
      error.code === "COMMISSION_REVERSAL_ALREADY_RESOLVED",
  );
});

test("admin can keep a reviewed canonical reversal paid without reopening collection", async () => {
  const database = new FakeFirestore();
  seedPayment(database, true);
  const store = new BookingCommissionStore(database as any);
  await store.recordCommissionReversal(
    reversalInput("voided", "TX-VOID-PAID"),
  );

  const resolved = await store.resolveCommissionReversal({
    bookingId,
    attemptId,
    reversalTransactionId: "TX-VOID-PAID",
    resolution: "keep_paid",
    now,
  });

  assert.equal(resolved.booking.commissionStatus, "paid");
  assert.equal(resolved.booking.complianceStatus, "released");
  assert.equal(resolved.booking.enforcementLastError, null);
  assert.equal(resolved.attempt.reversalResolution, "keep_paid");
  assert.equal(resolved.attempt.reversalResolvedAt, now.toISOString());
  assert.equal(
    database.read("booking_notification_outbox", `${bookingId}--owner_booking_confirmed`),
    undefined,
  );
});

test("admin can waive a disputed commission after every provider-bound attempt is failed", async () => {
  const database = new FakeFirestore();
  seedPayment(database, false);
  database.update("booking_followups", bookingId, {
    disputeStatus: "pending",
    disputedAt: now.toISOString(),
    disputeReason: "owner dispute",
    activeAttemptId: null,
  });
  database.update("booking_commission_payment_attempts", attemptId, {
    status: "failed",
    intentionId: "INTENTION-1",
    checkoutUrl: "https://ksa.paymob.com/unifiedcheckout/?clientSecret=x",
    transactionId: "TX-DECLINED",
  });
  const store = new BookingCommissionStore(database as any);

  const result = await store.resolveCommissionDispute(
    bookingId,
    "cancel_commission",
    now,
  );
  assert.equal(result.booking.commissionStatus, "waived");
  assert.equal(result.booking.disputeStatus, "accepted");
  assert.match(result.booking.events.at(-1)?.detail || "", new RegExp(attemptId));
});
