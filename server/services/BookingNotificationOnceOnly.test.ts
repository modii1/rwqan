import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import { CUSTOMER_SESSION_REVISION_HEADER } from "../../shared/customer";
import adminBookingRoutes from "../routes/admin/bookings";
import bookingRoutes from "../routes/bookings";
import { bookingCommissionService } from "./BookingCommissionService";
import {
  CONTACT_IDENTITY_COOKIE_NAME,
  contactIdentityService,
} from "./ContactIdentityService";
import {
  BOOKING_OWNER_NOTICE_RETRY_MS,
  BookingCommissionStore,
  bookingCommissionStore,
  buildInitialBookingWorkflow,
} from "./BookingCommissionStore";
import type {
  BookingFollowUpDocument,
  BookingNotificationJob,
} from "./BookingCommissionTypes";

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

  async runTransaction<T>(
    operation: (transaction: FakeTransaction) => Promise<T>,
  ): Promise<T> {
    return operation(new FakeTransaction(this));
  }

  seed(collection: string, id: string, data: FakeData): void {
    let documents = this.collections.get(collection);
    if (!documents) {
      documents = new Map();
      this.collections.set(collection, documents);
    }
    documents.set(id, structuredClone(data));
  }

  read(collection: string, id: string): FakeData | undefined {
    const value = this.collections.get(collection)?.get(id);
    return value ? structuredClone(value) : undefined;
  }

  entries(collection: string): Array<[string, FakeData]> {
    return [...(this.collections.get(collection)?.entries() || [])]
      .map(([id, value]) => [id, structuredClone(value)]);
  }

  update(collection: string, id: string, updates: FakeData): void {
    const current = this.read(collection, id);
    if (!current) throw new Error(`Missing fake document ${collection}/${id}`);
    this.seed(collection, id, { ...current, ...updates });
  }
}

class FakeQuery {
  private readonly filters: Array<{
    field: string;
    operator: string;
    value: unknown;
  }> = [];
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
    const docs = this.database.entries(this.collectionName)
      .map(([id]) => new FakeSnapshot(
        new FakeDocumentReference(this.database, this.collectionName, id),
      ))
      .filter((snapshot) => this.filters.every(({ field, operator, value }) => {
        const actual = snapshot.data()?.[field];
        if (operator === "==") return actual === value;
        if (operator === "<=") return String(actual) <= String(value);
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

  async get(
    ref: FakeDocumentReference | FakeQuery,
  ): Promise<FakeSnapshot | Awaited<ReturnType<FakeQuery["get"]>>> {
    if (ref instanceof FakeQuery) return ref.get();
    return new FakeSnapshot(ref);
  }

  update(ref: FakeDocumentReference, updates: FakeData): void {
    this.database.update(ref.collectionName, ref.id, updates);
  }

  set(ref: FakeDocumentReference, data: FakeData): void {
    this.database.seed(ref.collectionName, ref.id, data);
  }

  create(ref: FakeDocumentReference, data: FakeData): void {
    if (this.database.read(ref.collectionName, ref.id)) {
      throw new Error(`Existing fake document ${ref.collectionName}/${ref.id}`);
    }
    this.database.seed(ref.collectionName, ref.id, data);
  }
}

function awaitingWorkflow(now: Date) {
  const workflow = buildInitialBookingWorkflow({
    requestCode: "REQ-ONCE-ONLY",
    propertyNumber: "13383",
    propertyName: "شاليه الريف المائي",
    ownerPhone: "+966500000001",
    customerPhone: "+966500000002",
    customerSubject: "customer-subject-once-only",
    isFreeProperty: true,
    now,
  });
  return {
    booking: {
      ...workflow.followUp,
      contactRequestId: "CONTACT-ONCE-ONLY",
    } as unknown as BookingFollowUpDocument,
    customerNotification: workflow.customerNotification,
  };
}

function confirmedOwnerWorkflow(now: Date): {
  booking: BookingFollowUpDocument;
  job: BookingNotificationJob;
} {
  const { booking, customerNotification } = awaitingWorkflow(
    new Date(now.getTime() - 60_000),
  );
  const bookingId = "BOOK-OWNER-NOTICE-ONCE";
  return {
    booking: {
      ...booking,
      id: bookingId,
      requestCode: "REQ-OWNER-NOTICE-ONCE",
      bookingStatus: "confirmed",
      bookingDecision: "yes",
      questionnaireStartedAt: now.toISOString(),
      confirmationFacts: {
        timing: "weekend",
        bookingDate: { value: "2026-08", precision: "month" },
        pricePaidHalalas: 100_000,
      },
      confirmedAt: now.toISOString(),
      commissionStatus: "pending",
      commissionAmountHalalas: 10_000,
      commissionDueAt: null,
      commissionNoticeSentAt: null,
    } as unknown as BookingFollowUpDocument,
    job: {
      ...customerNotification,
      id: `${bookingId}--owner_booking_confirmed`,
      bookingId,
      recipientRole: "owner",
      recipientPhone: booking.ownerPhone,
      recipientQuotaKey: "966500000001",
      kind: "owner_booking_confirmed",
      quotaCategory: "transactional",
      scheduledAt: now.toISOString(),
      status: "pending",
      attempts: 0,
    },
  };
}

async function withBookingReadServer(
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    (req as any).session = {};
    next();
  });
  app.use(bookingRoutes);
  app.use(adminBookingRoutes);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => (error ? reject(error) : resolve()));
    });
  }
}

test("follow-up, customer profile, and admin dashboard reads never dispatch or mutate outbox jobs", async () => {
  const customerSessionRevision = "c".repeat(64);
  const previousSecret = process.env.SESSION_SECRET;
  const originalResolveContactIdentity = contactIdentityService.resolve;
  const store = bookingCommissionStore as any;
  const originals = {
    markCustomerOpened: store.markCustomerOpened,
    requireCurrentFreeEligibility: store.requireCurrentFreeEligibility,
    listBookingsForCustomer: store.listBookingsForCustomer,
    isBookingCurrentlyFreeEligible: store.isBookingCurrentlyFreeEligible,
    listAllBookings: store.listAllBookings,
    listAllNotificationJobs: store.listAllNotificationJobs,
    listPaymentAttempts: store.listPaymentAttempts,
    claimDueNotificationJobs: store.claimDueNotificationJobs,
    finishNotificationJob: store.finishNotificationJob,
    confirmBooking: store.confirmBooking,
    startQuestionnaire: store.startQuestionnaire,
    declineBooking: store.declineBooking,
  };
  const now = new Date(Date.now() - 60_000);
  const { booking, customerNotification } = awaitingWorkflow(now);
  const outbox = [{
    ...customerNotification,
    status: "sent" as const,
    attempts: 1,
    sentAt: new Date(now.getTime() + 30_000).toISOString(),
  }];
  const outboxBefore = structuredClone(outbox);
  const reads = {
    opened: 0,
    customer: 0,
    admin: 0,
  };
  let notificationMutationCalls = 0;
  const rejectNotificationMutation = async () => {
    notificationMutationCalls += 1;
    throw new Error("a read attempted to mutate or dispatch a notification");
  };

  try {
    process.env.SESSION_SECRET = "once-only-read-test-secret-value-123456789";
    (contactIdentityService as any).resolve = async (token: unknown) => token === "verified-profile-token"
      ? {
          clientPhone: booking.customerPhone,
          sessionId: customerSessionRevision,
          visitorId: "verified-profile-visitor",
          verifiedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 60_000).toISOString(),
        }
      : null;
    store.markCustomerOpened = async () => {
      reads.opened += 1;
      return booking;
    };
    store.requireCurrentFreeEligibility = async () => booking;
    store.listBookingsForCustomer = async () => {
      reads.customer += 1;
      return [booking];
    };
    store.isBookingCurrentlyFreeEligible = async () => true;
    store.listAllBookings = async () => {
      reads.admin += 1;
      return [booking];
    };
    store.listAllNotificationJobs = async () => outbox;
    store.listPaymentAttempts = async () => [];
    store.claimDueNotificationJobs = rejectNotificationMutation;
    store.finishNotificationJob = rejectNotificationMutation;
    store.confirmBooking = rejectNotificationMutation;
    store.startQuestionnaire = rejectNotificationMutation;
    store.declineBooking = rejectNotificationMutation;

    const token = bookingCommissionService.issueCustomerResponseToken(booking);
    await withBookingReadServer(async (baseUrl) => {
      for (let refresh = 0; refresh < 2; refresh += 1) {
        const followUpResponse = await fetch(
          `${baseUrl}/api/booking-followups/${encodeURIComponent(token)}`,
        );
        assert.equal(followUpResponse.status, 200);

        const profileResponse = await fetch(`${baseUrl}/api/customer/bookings`, {
          headers: {
            cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=verified-profile-token`,
            [CUSTOMER_SESSION_REVISION_HEADER]: customerSessionRevision,
          },
        });
        assert.equal(profileResponse.status, 200);

        const adminResponse = await fetch(
          `${baseUrl}/api/admin/booking-commissions`,
        );
        assert.equal(adminResponse.status, 200);
      }
    });

    assert.deepEqual(reads, { opened: 2, customer: 2, admin: 2 });
    assert.equal(notificationMutationCalls, 0);
    assert.deepEqual(outbox, outboxBefore);
  } finally {
    for (const [name, original] of Object.entries(originals)) {
      store[name] = original;
    }
    contactIdentityService.resolve = originalResolveContactIdentity;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("reopening a follow-up records customer_opened once without touching its sent outbox job", async () => {
  const database = new FakeFirestore();
  const createdAt = new Date("2026-08-20T10:00:00.000Z");
  const { booking, customerNotification } = awaitingWorkflow(createdAt);
  const sentJob = {
    ...customerNotification,
    status: "sent",
    attempts: 1,
    sentAt: "2026-08-20T10:30:00.000Z",
  };
  database.seed("booking_followups", booking.id, booking);
  database.seed("booking_notification_outbox", sentJob.id, sentJob);
  const outboxBefore = database.entries("booking_notification_outbox");
  const store = new BookingCommissionStore(database as any);

  await store.markCustomerOpened(
    booking.id,
    new Date("2026-08-20T11:00:00.000Z"),
  );
  await store.markCustomerOpened(
    booking.id,
    new Date("2026-08-20T12:00:00.000Z"),
  );

  const opened = database.read("booking_followups", booking.id);
  assert.equal(
    opened?.events.filter((event: { type: string }) =>
      event.type === "customer_opened").length,
    1,
  );
  assert.equal(opened?.updatedAt, "2026-08-20T11:00:00.000Z");
  assert.deepEqual(database.entries("booking_notification_outbox"), outboxBefore);
});

test("a provider-accepted sent job is terminal and cannot be reclaimed or requeued by a stale failure", async () => {
  const database = new FakeFirestore();
  const now = new Date("2026-08-20T10:00:00.000Z");
  const { booking, job } = confirmedOwnerWorkflow(now);
  database.seed("booking_followups", booking.id, booking);
  database.seed("booking_notification_outbox", job.id, job);
  database.seed("properties", booking.propertyNumber, {
    propertyNumber: booking.propertyNumber,
    whatsappNumber: "0500000001",
  });
  const store = new BookingCommissionStore(database as any);

  const claims = await store.claimDueNotificationJobs(now, 5, {
    followUpNotificationsEnabled: true,
    commissionNotificationsEnabled: true,
  });
  assert.equal(claims.length, 1);
  assert.equal(await store.finishNotificationJob({
    jobId: job.id,
    leaseToken: claims[0].leaseToken,
    success: true,
    now,
  }), true);
  const sent = database.read("booking_notification_outbox", job.id);
  assert.equal(sent?.status, "sent");
  assert.equal(sent?.attempts, 1);
  assert.equal(sent?.sentAt, now.toISOString());

  assert.equal(await store.finishNotificationJob({
    jobId: job.id,
    leaseToken: claims[0].leaseToken,
    success: false,
    error: "late provider timeout",
    now: new Date(now.getTime() + 1_000),
  }), false);
  assert.deepEqual(database.read("booking_notification_outbox", job.id), sent);
  assert.deepEqual(await store.claimDueNotificationJobs(
    new Date(now.getTime() + 24 * 60 * 60 * 1_000),
    5,
    {
      followUpNotificationsEnabled: true,
      commissionNotificationsEnabled: true,
    },
  ), []);
});

test("owner notice failures retry only three claimed attempts before becoming terminal", async () => {
  const database = new FakeFirestore();
  let attemptAt = new Date("2026-08-20T10:00:00.000Z");
  const { booking, job } = confirmedOwnerWorkflow(attemptAt);
  database.seed("booking_followups", booking.id, booking);
  database.seed("booking_notification_outbox", job.id, job);
  database.seed("properties", booking.propertyNumber, {
    propertyNumber: booking.propertyNumber,
    whatsappNumber: "0500000001",
  });
  const store = new BookingCommissionStore(database as any);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const claims = await store.claimDueNotificationJobs(attemptAt, 5, {
      followUpNotificationsEnabled: true,
      commissionNotificationsEnabled: true,
    });
    assert.equal(claims.length, 1);
    assert.equal(claims[0].attempts, attempt);
    assert.equal(await store.finishNotificationJob({
      jobId: job.id,
      leaseToken: claims[0].leaseToken,
      success: false,
      error: `provider rejected attempt ${attempt}`,
      now: attemptAt,
    }), true);

    const stored = database.read("booking_notification_outbox", job.id);
    assert.equal(stored?.attempts, attempt);
    if (attempt < 3) {
      assert.equal(stored?.status, "pending");
      assert.equal(
        stored?.scheduledAt,
        new Date(attemptAt.getTime() + BOOKING_OWNER_NOTICE_RETRY_MS)
          .toISOString(),
      );
      attemptAt = new Date(stored!.scheduledAt);
    } else {
      assert.equal(stored?.status, "failed");
      assert.equal(stored?.failedAt, attemptAt.toISOString());
    }
  }

  assert.deepEqual(await store.claimDueNotificationJobs(
    new Date(attemptAt.getTime() + 24 * 60 * 60 * 1_000),
    5,
    {
      followUpNotificationsEnabled: true,
      commissionNotificationsEnabled: true,
    },
  ), []);
  assert.equal(
    database.read("booking_notification_outbox", job.id)?.attempts,
    3,
  );
});
