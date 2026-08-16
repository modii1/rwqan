import assert from "node:assert/strict";
import test from "node:test";
import {
  BookingCommissionService,
  selectAdminPaymentAttempt,
} from "./BookingCommissionService";
import {
  BOOKING_CUSTOMER_RESPONSE_WINDOW_MS,
  bookingCommissionStore,
  buildInitialBookingWorkflow,
  BookingWorkflowError,
} from "./BookingCommissionStore";
import type { BookingFollowUpDocument } from "./BookingCommissionTypes";
import { paymobService } from "../integrations/paymob";

type AwaitingBookingDocument = Extract<
  BookingFollowUpDocument,
  { bookingStatus: "awaiting_response" }
>;

function awaitingBookingFixture(options: {
  requestCode: string;
  createdAt: Date;
  customerSubject?: string;
}): AwaitingBookingDocument {
  const { followUp } = buildInitialBookingWorkflow({
    requestCode: options.requestCode,
    propertyNumber: "13383",
    propertyName: "شاليه الريف المائي",
    ownerPhone: "+966500000001",
    customerPhone: "+966500000002",
    customerSubject: options.customerSubject || "customer-subject-hmac",
    isFreeProperty: true,
    now: options.createdAt,
  });
  if (
    followUp.bookingStatus !== "awaiting_response" ||
    followUp.commissionStatus !== "not_applicable" ||
    followUp.complianceStatus !== "clear"
  ) {
    throw new TypeError("Initial booking fixture must be awaiting a response");
  }
  return {
    ...followUp,
    contactRequestId: `CONTACT-${options.requestCode}`,
  } as AwaitingBookingDocument;
}

test("customer subject is stable across phone formatting and secret-bound", () => {
  const previousSecret = process.env.SESSION_SECRET;
  try {
    process.env.SESSION_SECRET = "customer-subject-test-secret-value-123456789";
    const service = new BookingCommissionService();
    const compact = service.createCustomerSubject("966501234567");

    assert.equal(
      service.createCustomerSubject("+966 (50) 123-4567"),
      compact,
    );
    assert.equal(
      service.createCustomerSubject("966 50 123 45 67"),
      compact,
    );
    assert.match(compact, /^[a-f0-9]{64}$/);
    assert.equal(compact.includes("966501234567"), false);
    assert.notEqual(service.createCustomerSubject("966501234568"), compact);

    process.env.SESSION_SECRET = "different-customer-subject-secret-1234567890";
    assert.notEqual(service.createCustomerSubject("966501234567"), compact);

    assert.throws(
      () => service.createCustomerSubject("123"),
      (error: unknown) =>
        error instanceof BookingWorkflowError &&
        error.code === "INVALID_CUSTOMER_PHONE" &&
        error.status === 400,
    );
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("admin payment details prioritize an attempt requiring financial review", () => {
  const booking = {
    id: "BOOK-1",
    activeAttemptId: "ATT-PAID",
    paidAttemptId: "ATT-PAID",
  };
  const selected = selectAdminPaymentAttempt(booking as any, [
    {
      id: "ATT-DUPLICATE",
      bookingId: "BOOK-1",
      status: "duplicate_paid",
      updatedAt: "2026-08-15T12:00:00.000Z",
    },
    {
      id: "ATT-PAID",
      bookingId: "BOOK-1",
      status: "paid",
      updatedAt: "2026-08-15T13:00:00.000Z",
    },
  ] as any);

  assert.equal(selected?.id, "ATT-DUPLICATE");
});

test("seven-day expiry is derived for admin and customer views without persisting a mutation", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  const originals = {
    getBooking: bookingCommissionStore.getBooking,
    requireEligibility: bookingCommissionStore.requireCurrentFreeEligibility,
    isEligible: bookingCommissionStore.isBookingCurrentlyFreeEligible,
    listCustomer: bookingCommissionStore.listBookingsForCustomer,
    listAll: bookingCommissionStore.listAllBookings,
    listJobs: bookingCommissionStore.listAllNotificationJobs,
    listAttempts: bookingCommissionStore.listPaymentAttempts,
    markOpened: bookingCommissionStore.markCustomerOpened,
  };
  const nowMs = Date.now();
  const expired = awaitingBookingFixture({
    requestCode: "EXPIRED",
    createdAt: new Date(nowMs - BOOKING_CUSTOMER_RESPONSE_WINDOW_MS - 24 * 60 * 60 * 1_000),
  });
  const fresh = awaitingBookingFixture({
    requestCode: "FRESH",
    createdAt: new Date(nowMs - BOOKING_CUSTOMER_RESPONSE_WINDOW_MS + 24 * 60 * 60 * 1_000),
    customerSubject: expired.customerSubject,
  });
  const expiredBeforeRead = structuredClone(expired);
  let customerAnchorReads = 0;
  let customerListReads = 0;
  let markOpenedCalls = 0;

  try {
    process.env.SESSION_SECRET = "derived-expiry-test-secret-value-1234567890";
    (bookingCommissionStore as any).requireCurrentFreeEligibility = async (id: string) => {
      customerAnchorReads += 1;
      if (id === expired.id) return expired;
      throw new Error("unexpected booking id");
    };
    (bookingCommissionStore as any).isBookingCurrentlyFreeEligible = async () => true;
    (bookingCommissionStore as any).listBookingsForCustomer = async (
      customerSubject: string,
    ) => {
      customerListReads += 1;
      assert.equal(customerSubject, expired.customerSubject);
      return [expired, fresh];
    };
    (bookingCommissionStore as any).listAllBookings = async () => [expired, fresh];
    (bookingCommissionStore as any).listAllNotificationJobs = async () => [];
    (bookingCommissionStore as any).listPaymentAttempts = async () => [];
    (bookingCommissionStore as any).markCustomerOpened = async () => {
      markOpenedCalls += 1;
      throw new Error("profile rendering must not persist an expiry event");
    };

    const service = new BookingCommissionService();
    const dashboard = await service.getAdminDashboard();
    assert.equal(dashboard.summary.total, 2);
    assert.equal(dashboard.summary.awaitingResponse, 1);
    assert.equal(dashboard.summary.expired, 1);

    const expiredAdminRow = dashboard.bookings.find((row) => row.id === expired.id);
    const freshAdminRow = dashboard.bookings.find((row) => row.id === fresh.id);
    assert.ok(expiredAdminRow);
    assert.ok(freshAdminRow);
    assert.equal(expiredAdminRow.bookingStatus, "expired");
    assert.equal(freshAdminRow.bookingStatus, "awaiting_response");
    assert.equal(
      expiredAdminRow.events.some((event) => event.type === "customer_followup_expired"),
      false,
      "the stored event list remains unchanged in the admin row",
    );
    assert.deepEqual(
      expiredAdminRow.timeline.at(-1),
      {
        type: "customer_followup_expired",
        at: new Date(
          Date.parse(expired.createdAt) + BOOKING_CUSTOMER_RESPONSE_WINDOW_MS,
        ).toISOString(),
        detail: "customer_response_expired",
      },
    );
    assert.equal(
      freshAdminRow.timeline.some((event) => event.type === "customer_followup_expired"),
      false,
    );

    const customerToken = service.issueCustomerResponseToken(expired);
    const profile = await service.getCustomerBookingsFromSession(customerToken);
    const expiredProfileRow = profile.bookings.find((row) => row.id === expired.id);
    const freshProfileRow = profile.bookings.find((row) => row.id === fresh.id);
    assert.ok(expiredProfileRow);
    assert.ok(freshProfileRow);
    assert.equal(expiredProfileRow.bookingStatus, "expired");
    assert.equal(freshProfileRow.bookingStatus, "awaiting_response");
    assert.equal(customerAnchorReads, 1);
    assert.equal(customerListReads, 1);
    assert.equal(markOpenedCalls, 0);
    assert.deepEqual(expired, expiredBeforeRead);
  } finally {
    (bookingCommissionStore as any).getBooking = originals.getBooking;
    (bookingCommissionStore as any).requireCurrentFreeEligibility = originals.requireEligibility;
    (bookingCommissionStore as any).isBookingCurrentlyFreeEligible = originals.isEligible;
    (bookingCommissionStore as any).listBookingsForCustomer = originals.listCustomer;
    (bookingCommissionStore as any).listAllBookings = originals.listAll;
    (bookingCommissionStore as any).listAllNotificationJobs = originals.listJobs;
    (bookingCommissionStore as any).listPaymentAttempts = originals.listAttempts;
    (bookingCommissionStore as any).markCustomerOpened = originals.markOpened;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("admin dashboard totals and per-booking audit histories are complete and sanitized", async () => {
  const originals = {
    listAll: bookingCommissionStore.listAllBookings,
    listJobs: bookingCommissionStore.listAllNotificationJobs,
    listAttempts: bookingCommissionStore.listPaymentAttempts,
  };
  const createdAt = new Date();
  const bookings = Array.from({ length: 501 }, (_, index) =>
    awaitingBookingFixture({
      requestCode: `AUDIT-${index}`,
      createdAt,
      customerSubject: `customer-subject-${index}`,
    }));
  const anchor = bookings[0];
  const jobs = Array.from({ length: 5_001 }, (_, index) => ({
    id: `JOB-AUDIT-${index}`,
    bookingId: anchor.id,
    propertyNumber: anchor.propertyNumber,
    recipientRole: "owner",
    recipientPhone: `SECRET-RECIPIENT-${index}`,
    recipientQuotaKey: `SECRET-QUOTA-${index}`,
    kind: "owner_booking_confirmed",
    reminderOffsetDays: null,
    scheduledAt: new Date(createdAt.getTime() + index).toISOString(),
    status: "suppressed_quota",
    isFreeProperty: true,
    quotaCategory: "free_owner_booking",
    attempts: 1,
    leaseToken: `SECRET-LEASE-${index}`,
    leaseExpiresAt: null,
    claimedAt: null,
    sentAt: null,
    failedAt: null,
    suppressedAt: createdAt.toISOString(),
    providerError: "daily_notification_quota",
    createdAt: new Date(createdAt.getTime() + index).toISOString(),
    updatedAt: new Date(createdAt.getTime() + index).toISOString(),
  }));
  const attempts = [
    {
      id: "ATT-LATEST",
      bookingId: anchor.id,
      status: "failed",
      checkoutUrl: "SECRET-CHECKOUT-LATEST",
      updatedAt: "2026-08-15T13:00:00.000Z",
    },
    {
      id: "ATT-REVIEW",
      bookingId: anchor.id,
      status: "duplicate_paid",
      checkoutUrl: "SECRET-CHECKOUT-REVIEW",
      updatedAt: "2026-08-15T12:00:00.000Z",
    },
  ];

  try {
    (bookingCommissionStore as any).listAllBookings = async () => bookings;
    (bookingCommissionStore as any).listAllNotificationJobs = async () => jobs;
    (bookingCommissionStore as any).listPaymentAttempts = async () => attempts;

    const dashboard = await new BookingCommissionService().getAdminDashboard();
    assert.equal(dashboard.summary.total, 501);
    assert.equal(dashboard.summary.notificationSuppressed, 5_001);
    assert.equal(dashboard.bookings.length, 501);

    const row = dashboard.bookings.find((candidate) => candidate.id === anchor.id);
    assert.ok(row);
    assert.equal(row.notificationSummary.suppressed, 5_001);
    assert.equal(row.notificationJobs.length, 5_001);
    assert.equal(row.paymentAttempt?.id, "ATT-REVIEW");
    assert.deepEqual(
      row.paymentAttempts.map((attempt) => attempt.id),
      ["ATT-LATEST", "ATT-REVIEW"],
    );
    assert.equal("recipientPhone" in row.notificationJobs[0], false);
    assert.equal("recipientQuotaKey" in row.notificationJobs[0], false);
    assert.equal("leaseToken" in row.notificationJobs[0], false);
    assert.equal("checkoutUrl" in row.paymentAttempt!, false);
    assert.equal(
      row.paymentAttempts.some((attempt) => "checkoutUrl" in attempt),
      false,
    );
    const serialized = JSON.stringify(row);
    for (const secret of [
      "SECRET-RECIPIENT-0",
      "SECRET-QUOTA-0",
      "SECRET-LEASE-0",
      "SECRET-CHECKOUT-LATEST",
      "SECRET-CHECKOUT-REVIEW",
    ]) {
      assert.equal(serialized.includes(secret), false, secret);
    }
  } finally {
    (bookingCommissionStore as any).listAllBookings = originals.listAll;
    (bookingCommissionStore as any).listAllNotificationJobs = originals.listJobs;
    (bookingCommissionStore as any).listPaymentAttempts = originals.listAttempts;
  }
});

test("checkout rechecks free eligibility before creating a provider intention", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  const originals = {
    reserve: bookingCommissionStore.reservePaymentAttempt,
    requireEligibility: bookingCommissionStore.requireCurrentFreeEligibility,
    markFailure: bookingCommissionStore.markPaymentAttemptCreationFailure,
    createIntention: paymobService.createBookingCommissionIntention,
  };
  const service = new BookingCommissionService();
  const base = awaitingBookingFixture({ requestCode: "CHECKOUT-TIER-RACE", createdAt: new Date() });
  const booking = {
    ...base,
    bookingStatus: "confirmed" as const,
    bookingDecision: "yes" as const,
    confirmedAt: new Date().toISOString(),
    commissionStatus: "pending" as const,
    confirmationFacts: {
      timing: "weekend" as const,
      bookingDate: { value: "2026-08-16", precision: "day" as const },
      pricePaidHalalas: 100_000,
    },
    commissionAmountHalalas: 10_000,
    commissionDueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1_000).toISOString(),
  } as BookingFollowUpDocument;
  const attempt = {
    id: "ATT-CHECKOUT-TIER-RACE",
    bookingId: booking.id,
    propertyNumber: booking.propertyNumber,
    amountCents: 10_000,
    currency: "SAR",
    paymentMethod: "cards",
    merchantAttemptKey: "KEY-CHECKOUT-TIER-RACE",
    status: "creating",
  } as any;
  let providerCalls = 0;
  let rejectedAttemptId: string | null = null;

  try {
    process.env.SESSION_SECRET = "checkout-tier-race-secret-value-1234567890";
    (bookingCommissionStore as any).reservePaymentAttempt = async () => ({
      status: "reserved",
      booking,
      attempt,
    });
    (bookingCommissionStore as any).requireCurrentFreeEligibility = async () => {
      throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
    };
    (bookingCommissionStore as any).markPaymentAttemptCreationFailure = async (input: any) => {
      rejectedAttemptId = input.attemptId;
      assert.equal(input.certainty, "rejected");
    };
    (paymobService as any).createBookingCommissionIntention = async () => {
      providerCalls++;
      throw new Error("provider must not be called");
    };

    const token = service.issueOwnerPaymentToken(booking);
    await assert.rejects(
      () => service.createCheckout(token, { paymentMethod: "cards" }),
      (error: unknown) =>
        error instanceof BookingWorkflowError &&
        error.code === "BOOKING_NOT_FOUND",
    );
    assert.equal(providerCalls, 0);
    assert.equal(rejectedAttemptId, attempt.id);
  } finally {
    (bookingCommissionStore as any).reservePaymentAttempt = originals.reserve;
    (bookingCommissionStore as any).requireCurrentFreeEligibility = originals.requireEligibility;
    (bookingCommissionStore as any).markPaymentAttemptCreationFailure = originals.markFailure;
    (paymobService as any).createBookingCommissionIntention = originals.createIntention;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});
