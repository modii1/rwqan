import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOKING_ADMIN_CUSTOMER_WHATSAPP_MESSAGE,
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
import { DEFAULT_BOOKING_WHATSAPP_TEMPLATES } from "../../shared/booking";
import { firebaseService } from "../firebaseService";

const usableBankAccount = {
  id: "BANK-DEFAULT",
  bankName: "Bank",
  beneficiaryName: "Rwqan",
  iban: "SA0000000000000000000000",
  isActive: true,
  isDefault: true,
};

type AwaitingBookingDocument = Extract<
  BookingFollowUpDocument,
  { bookingStatus: "awaiting_response" }
>;

function awaitingBookingFixture(options: {
  requestCode: string;
  createdAt: Date;
  customerSubject?: string;
  listedPriceOptionsHalalas?: number[];
}): AwaitingBookingDocument {
  const { followUp } = buildInitialBookingWorkflow({
    requestCode: options.requestCode,
    propertyNumber: "13383",
    propertyName: "شاليه الريف المائي",
    ownerPhone: "+966500000001",
    customerPhone: "+966500000002",
    customerSubject: options.customerSubject || "customer-subject-hmac",
    isFreeProperty: true,
    listedPriceOptionsHalalas: options.listedPriceOptionsHalalas || [75_000, 125_050],
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

test("admin customer WhatsApp handoff uses only a normalized snapshotted phone", async () => {
  const originalGetBooking = bookingCommissionStore.getBookingForCurrentOwner;
  const booking = awaitingBookingFixture({
    requestCode: "ADMIN-CUSTOMER-WHATSAPP",
    createdAt: new Date(),
  });
  const service = new BookingCommissionService();

  try {
    (bookingCommissionStore as any).getBookingForCurrentOwner = async (id: string) =>
      id === booking.id
        ? { ...booking, customerPhone: "+966 (50) 000-0002" }
        : null;

    const redirectUrl = await service.getAdminCustomerWhatsAppUrl(booking.id);
    const parsed = new URL(redirectUrl);
    assert.equal(parsed.origin, "https://wa.me");
    assert.equal(parsed.pathname, "/966500000002");
    assert.equal(
      parsed.searchParams.get("text"),
      "مرحباً، معك الفريق التقني لمنصة روقان.",
    );
    assert.equal(
      parsed.searchParams.get("text"),
      BOOKING_ADMIN_CUSTOMER_WHATSAPP_MESSAGE,
    );

    await assert.rejects(
      () => service.getAdminCustomerWhatsAppUrl("BOOK-MISSING"),
      (error: unknown) =>
        error instanceof BookingWorkflowError &&
        error.code === "BOOKING_NOT_FOUND" &&
        error.status === 404,
    );

    (bookingCommissionStore as any).getBookingForCurrentOwner = async () => ({
      ...booking,
      customerPhone: "not-a-phone",
    });
    await assert.rejects(
      () => service.getAdminCustomerWhatsAppUrl(booking.id),
      (error: unknown) =>
        error instanceof BookingWorkflowError &&
        error.code === "INVALID_CUSTOMER_PHONE" &&
        error.status === 400,
    );
  } finally {
    (bookingCommissionStore as any).getBookingForCurrentOwner = originalGetBooking;
  }
});

test("admin customer WhatsApp handoff fails closed after free eligibility is lost", async () => {
  const original = bookingCommissionStore.getBookingForCurrentOwner;
  const service = new BookingCommissionService();
  try {
    (bookingCommissionStore as any).getBookingForCurrentOwner = async () => null;
    await assert.rejects(
      () => service.getAdminCustomerWhatsAppUrl("BOOK-UPGRADED"),
      (error: unknown) =>
        error instanceof BookingWorkflowError &&
        error.code === "BOOKING_NOT_FOUND" &&
        error.status === 404,
    );
  } finally {
    (bookingCommissionStore as any).getBookingForCurrentOwner = original;
  }
});

test("owner commission DTO exposes only sanitized active electronic state for safe resume UI", async () => {
  const store = bookingCommissionStore as any;
  const service = new BookingCommissionService();
  const originals = {
    getBooking: store.getBookingForCurrentOwner,
    getAttempt: store.getPaymentAttempt,
    verifyOwnerToken: service.verifyOwnerToken,
  };
  const base = awaitingBookingFixture({
    requestCode: "OWNER-ELECTRONIC-STATE",
    createdAt: new Date(),
  });
  const booking = {
    ...base,
    bookingStatus: "confirmed",
    bookingDecision: "yes",
    confirmationFacts: {
      timing: "weekend",
      bookingDate: { value: "2026-08-15", precision: "day" },
      pricePaidHalalas: 100_000,
    },
    confirmedAt: new Date().toISOString(),
    commissionStatus: "pending",
    commissionAmountHalalas: 10_000,
    commissionDueAt: new Date(Date.now() + 86_400_000).toISOString(),
    activeAttemptId: "ATT-ELECTRONIC-STATE",
    disputeStatus: "none",
  } as BookingFollowUpDocument;
  let status: "created" | "creating" = "created";
  try {
    (service as any).verifyOwnerToken = () => ({ bookingId: booking.id });
    store.getBookingForCurrentOwner = async () => booking;
    store.getPaymentAttempt = async () => ({
      id: "ATT-ELECTRONIC-STATE",
      bookingId: booking.id,
      paymentMethod: "cards",
      status,
      checkoutUrl: "SECRET-PAYMOB-CHECKOUT",
      receiptObjectKey: "SECRET-OBJECT-KEY",
    });

    const resumable = await service.getOwnerCommission("owner-token");
    assert.equal(resumable.checkoutAvailable, true);
    assert.deepEqual(resumable.paymentAttempt, {
      paymentMethod: "cards",
      status: "created",
      receiptSubmittedAt: null,
      bankReviewDecision: null,
      bankReviewReason: null,
      bankReviewedAt: null,
    });
    assert.equal(JSON.stringify(resumable).includes("SECRET-PAYMOB"), false);

    status = "creating";
    const processing = await service.getOwnerCommission("owner-token");
    assert.equal(processing.checkoutAvailable, false);
    assert.equal(processing.paymentAttempt?.status, "creating");
  } finally {
    (service as any).verifyOwnerToken = originals.verifyOwnerToken;
    store.getBookingForCurrentOwner = originals.getBooking;
    store.getPaymentAttempt = originals.getAttempt;
  }
});

test("admin manual resend validates idempotency input and never returns recipient secrets", async () => {
  const store = bookingCommissionStore as any;
  const original = store.scheduleManualNotificationResend;
  const captured: unknown[] = [];
  try {
    store.scheduleManualNotificationResend = async (input: unknown) => {
      captured.push(input);
      return {
        replayed: false,
        job: {
          id: "BOOK-1--owner_booking_confirmed--manual-safe",
          bookingId: "BOOK-1",
          propertyNumber: "13383",
          recipientRole: "owner",
          recipientPhone: "SECRET-OWNER-PHONE",
          recipientQuotaKey: "SECRET-OWNER-QUOTA",
          kind: "owner_booking_confirmed",
          reminderOffsetDays: null,
          scheduledAt: "2026-08-22T10:00:00.000Z",
          status: "pending",
          isFreeProperty: true,
          quotaCategory: "free_owner_booking",
          attempts: 0,
          leaseToken: "SECRET-LEASE",
          leaseExpiresAt: null,
          claimedAt: null,
          sentAt: null,
          failedAt: null,
          suppressedAt: null,
          providerError: null,
          manualResendOfJobId: "BOOK-1--owner_booking_confirmed",
          manualResendRequestedAt: "2026-08-22T10:00:00.000Z",
          createdAt: "2026-08-22T10:00:00.000Z",
          updatedAt: "2026-08-22T10:00:00.000Z",
        },
      };
    };

    const response = await new BookingCommissionService()
      .resendAdminNotification("BOOK-1", {
        sourceJobId: "BOOK-1--owner_booking_confirmed",
        idempotencyKey: "admin-resend-service-key-001",
      });
    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0], {
      bookingId: "BOOK-1",
      sourceJobId: "BOOK-1--owner_booking_confirmed",
      idempotencyKey: "admin-resend-service-key-001",
    });
    assert.equal(response.notification.manualResendOfJobId, "BOOK-1--owner_booking_confirmed");
    const serialized = JSON.stringify(response);
    for (const secret of [
      "SECRET-OWNER-PHONE",
      "SECRET-OWNER-QUOTA",
      "SECRET-LEASE",
    ]) {
      assert.equal(serialized.includes(secret), false);
    }

    await assert.rejects(() => new BookingCommissionService()
      .resendAdminNotification("BOOK-1", {
        sourceJobId: "BOOK-1--owner_booking_confirmed",
        idempotencyKey: "too short",
      }));
    assert.equal(captured.length, 1);
  } finally {
    store.scheduleManualNotificationResend = original;
  }
});

test("admin free-workflow settings preserve the strict service response contract", async () => {
  const store = bookingCommissionStore as any;
  const originals = {
    getSettings: store.getFreeWorkflowSettings,
    updateSettings: store.updateFreeWorkflowSettings,
  };
  const configuration = {
    customerDailyLimit: 4,
    freeOwnerDailyLimit: 5,
    freePropertyContactDailyLimit: 6,
    customerFollowUpDelayHours: 36,
    whatsappTemplates: { ...DEFAULT_BOOKING_WHATSAPP_TEMPLATES },
    optionalCommissionReminderDays: [3] as Array<3 | 4>,
  };
  const persisted = {
    ...configuration,
    updatedAt: "2026-08-18T10:00:00.000Z",
    updatedBy: "admin" as const,
    source: "firestore" as const,
  };
  const updates: unknown[] = [];
  const environmentNames = [
    "ENJAZATIK_URL",
    "ENJAZATIK_TOKEN",
    "BOOKING_WORKER_SECRET",
    "PUBLIC_BASE_URL",
    "NEXT_PUBLIC_BASE_URL",
    "NODE_ENV",
  ] as const;
  const previousEnvironment = Object.fromEntries(
    environmentNames.map((name) => [name, process.env[name]]),
  );
  const mutableEnvironment = process.env as Record<string, string | undefined>;

  try {
    process.env.ENJAZATIK_URL = "https://provider.example/send";
    process.env.ENJAZATIK_TOKEN = "provider-token";
    process.env.BOOKING_WORKER_SECRET = "w".repeat(32);
    process.env.PUBLIC_BASE_URL = "https://booking.example/path";
    mutableEnvironment.NODE_ENV = "production";
    store.getFreeWorkflowSettings = async () => persisted;
    store.updateFreeWorkflowSettings = async (settings: unknown) => {
      updates.push(settings);
      return persisted;
    };

    const service = new BookingCommissionService();
    const expectedResponse = {
      settings: persisted,
      fixedPolicy: {
        customerFollowUpDelayMinHours: 1,
        customerFollowUpDelayMaxHours: 120,
        commissionPaymentWindowDays: 5,
        mandatoryCommissionReminderDays: [5],
        allowedOptionalCommissionReminderDays: [3, 4],
        templateSyntaxVersion: 1,
        templateMaxLength: 2_000,
      },
      operationalHealth: {
        whatsappProviderConfigured: true,
        workerSecretConfigured: true,
        publicBaseUrlConfigured: true,
        publicBaseUrlValid: true,
      },
    };
    assert.deepEqual(
      await service.getAdminFreeWorkflowSettings(),
      expectedResponse,
    );
    assert.deepEqual(await service.updateAdminFreeWorkflowSettings({
      settings: configuration,
    }), expectedResponse);
    assert.deepEqual(updates, [configuration]);

    delete process.env.ENJAZATIK_TOKEN;
    process.env.BOOKING_WORKER_SECRET = "w".repeat(31);
    process.env.PUBLIC_BASE_URL = "http://127.0.0.1:3000/path";
    mutableEnvironment.NODE_ENV = "development";
    assert.deepEqual(
      (await service.getAdminFreeWorkflowSettings()).operationalHealth,
      {
        whatsappProviderConfigured: false,
        workerSecretConfigured: false,
        publicBaseUrlConfigured: true,
        publicBaseUrlValid: true,
      },
    );
    mutableEnvironment.NODE_ENV = "production";
    assert.equal(
      (await service.getAdminFreeWorkflowSettings()).operationalHealth
        .publicBaseUrlValid,
      false,
    );

    for (const input of [
      {},
      { settings: { ...configuration, customerDailyLimit: -1 } },
      { settings: { ...configuration, customerDailyLimit: 4.5 } },
      { settings: { ...configuration, freePropertyContactDailyLimit: 1_001 } },
      { settings: { ...configuration, customerFollowUpDelayHours: 0 } },
      { settings: { ...configuration, customerFollowUpDelayHours: 1.5 } },
      { settings: { ...configuration, customerFollowUpDelayHours: 121 } },
      { settings: { ...configuration, whatsappTemplates: {} } },
      { settings: { ...configuration, optionalCommissionReminderDays: [5] } },
      {
        settings: {
          ...configuration,
          extra: true,
        },
      },
      {
        settings: {
          ...configuration,
        },
        extra: true,
      },
    ]) {
      await assert.rejects(() => service.updateAdminFreeWorkflowSettings(input));
    }
    assert.equal(updates.length, 1, "invalid bodies never reach persistence");
  } finally {
    store.getFreeWorkflowSettings = originals.getSettings;
    store.updateFreeWorkflowSettings = originals.updateSettings;
    for (const name of environmentNames) {
      const value = previousEnvironment[name];
      if (value === undefined) delete mutableEnvironment[name];
      else mutableEnvironment[name] = value;
    }
  }
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
    assert.equal(expiredProfileRow.propertyName, "شاليه الريف المائي");
    assert.deepEqual(expiredProfileRow.listedPriceOptionsHalalas, [75_000, 125_050]);
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
      receiptUrl: "https://receipts.example/review.pdf",
      receiptObjectKey: "SECRET-RECEIPT-OBJECT-KEY",
      receiptContentType: "application/pdf",
      receiptSizeBytes: 2048,
      receiptSubmittedAt: "2026-08-15T11:55:00.000Z",
      bankReviewDecision: "refund_review",
      bankReviewReason: "owner_identity_changed",
      bankReviewedAt: "2026-08-15T12:01:00.000Z",
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
    assert.equal("customerPhone" in row, false);
    assert.equal("checkoutUrl" in row.paymentAttempt!, false);
    assert.equal("receiptObjectKey" in row.paymentAttempt!, false);
    assert.equal(
      row.paymentAttempt?.receiptUrl,
      "https://receipts.example/review.pdf",
    );
    assert.equal(row.paymentAttempt?.receiptContentType, "application/pdf");
    assert.equal(row.paymentAttempt?.receiptSizeBytes, 2048);
    assert.equal(
      row.paymentAttempt?.receiptSubmittedAt,
      "2026-08-15T11:55:00.000Z",
    );
    assert.equal(row.paymentAttempt?.bankReviewDecision, "refund_review");
    assert.equal(row.paymentAttempt?.bankReviewReason, "owner_identity_changed");
    assert.equal(
      row.paymentAttempts.some((attempt) => "checkoutUrl" in attempt),
      false,
    );
    assert.equal(
      row.paymentAttempts.some((attempt) => "receiptObjectKey" in attempt),
      false,
    );
    const serialized = JSON.stringify(row);
    for (const secret of [
      "SECRET-RECIPIENT-0",
      "SECRET-QUOTA-0",
      "SECRET-LEASE-0",
      "SECRET-CHECKOUT-LATEST",
      "SECRET-CHECKOUT-REVIEW",
      "SECRET-RECEIPT-OBJECT-KEY",
      anchor.customerPhone,
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

test("bank receipt orchestration cleans up only a known-unpersisted upload", async () => {
  const store = bookingCommissionStore as any;
  const originals = {
    reserve: store.reservePaymentAttempt,
    complete: store.completeBankTransferAttempt,
    getAttempt: store.getPaymentAttempt,
    markFailure: store.markPaymentAttemptCreationFailure,
    getDefaultBankAccount: firebaseService.getDefaultBankAccount,
  };
  const service = new BookingCommissionService();
  const originalVerify = service.verifyOwnerToken;
  const booking = awaitingBookingFixture({
    requestCode: "BANK-RECEIPT-CLEANUP",
    createdAt: new Date(),
  });
  const attempt = {
    id: "ATT-BANK-CLEANUP",
    bookingId: booking.id,
    propertyNumber: booking.propertyNumber,
    amountCents: 10_000,
    currency: "SAR",
    paymentMethod: "bank_transfer",
    merchantAttemptKey: "KEY-BANK-CLEANUP",
    status: "creating",
    updatedAt: new Date().toISOString(),
  } as any;
  const receipt = {
    url: "https://receipts.example/cleanup.pdf",
    objectKey: "booking-commission-receipts/cleanup.pdf",
    contentType: "application/pdf" as const,
    sizeBytes: 512,
  };
  const removed: string[] = [];
  const failures: any[] = [];

  try {
    (service as any).verifyOwnerToken = () => ({ bookingId: booking.id });
    (firebaseService as any).getDefaultBankAccount = async () => usableBankAccount;
    store.reservePaymentAttempt = async () => ({
      status: "reserved",
      booking,
      attempt,
    });
    store.completeBankTransferAttempt = async () => {
      throw new Error("firestore finalize failed");
    };
    store.getPaymentAttempt = async () => ({ ...attempt });
    store.markPaymentAttemptCreationFailure = async (input: unknown) => {
      failures.push(input);
    };

    await assert.rejects(
      () => service.submitBankTransfer("owner-token", {} as Express.Multer.File, {
        store: async () => receipt,
        remove: async (objectKey) => {
          removed.push(objectKey);
          return true;
        },
      }),
      /firestore finalize failed/,
    );
    assert.deepEqual(removed, [receipt.objectKey]);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].attemptId, attempt.id);
    assert.equal(failures[0].certainty, "rejected");
  } finally {
    (service as any).verifyOwnerToken = originalVerify;
    store.reservePaymentAttempt = originals.reserve;
    store.completeBankTransferAttempt = originals.complete;
    store.getPaymentAttempt = originals.getAttempt;
    store.markPaymentAttemptCreationFailure = originals.markFailure;
    (firebaseService as any).getDefaultBankAccount = originals.getDefaultBankAccount;
  }
});

test("bank receipt upload requires a current active and complete bank account before reservation", async () => {
  const store = bookingCommissionStore as any;
  const service = new BookingCommissionService();
  const originals = {
    reserve: store.reservePaymentAttempt,
    getDefaultBankAccount: firebaseService.getDefaultBankAccount,
    verifyOwnerToken: service.verifyOwnerToken,
  };
  let reservations = 0;
  try {
    (service as any).verifyOwnerToken = () => ({ bookingId: "BOOK-BANK-GATE" });
    store.reservePaymentAttempt = async () => {
      reservations += 1;
      throw new Error("reservation must not be reached");
    };
    for (const account of [
      null,
      { ...usableBankAccount, isActive: false },
      { ...usableBankAccount, beneficiaryName: "" },
      { ...usableBankAccount, iban: "SA123" },
    ]) {
      (firebaseService as any).getDefaultBankAccount = async () => account;
      await assert.rejects(
        () => service.submitBankTransfer(
          "owner-token",
          {} as Express.Multer.File,
        ),
        (error: unknown) =>
          error instanceof BookingWorkflowError &&
          error.code === "BANK_ACCOUNT_UNAVAILABLE" &&
          error.status === 503 &&
          !error.message.includes("SA123"),
      );
    }
    assert.equal(reservations, 0);
  } finally {
    (service as any).verifyOwnerToken = originals.verifyOwnerToken;
    store.reservePaymentAttempt = originals.reserve;
    (firebaseService as any).getDefaultBankAccount = originals.getDefaultBankAccount;
  }
});

test("bank receipt orchestration never deletes evidence after a successful or recovered finalize", async (t) => {
  const store = bookingCommissionStore as any;
  const originals = {
    reserve: store.reservePaymentAttempt,
    complete: store.completeBankTransferAttempt,
    getAttempt: store.getPaymentAttempt,
    markFailure: store.markPaymentAttemptCreationFailure,
    getDefaultBankAccount: firebaseService.getDefaultBankAccount,
  };
  const service = new BookingCommissionService();
  const originalVerify = service.verifyOwnerToken;
  const booking = awaitingBookingFixture({
    requestCode: "BANK-RECEIPT-PRESERVE",
    createdAt: new Date(),
  });
  const receipt = {
    url: "https://receipts.example/preserve.pdf",
    objectKey: "booking-commission-receipts/preserve.pdf",
    contentType: "application/pdf" as const,
    sizeBytes: 512,
  };
  let sequence = 0;
  let removeCalls = 0;
  let failureCalls = 0;

  try {
    (service as any).verifyOwnerToken = () => ({ bookingId: booking.id });
    (firebaseService as any).getDefaultBankAccount = async () => usableBankAccount;
    store.reservePaymentAttempt = async () => {
      sequence += 1;
      return {
        status: "reserved",
        booking,
        attempt: {
          id: `ATT-BANK-PRESERVE-${sequence}`,
          bookingId: booking.id,
          propertyNumber: booking.propertyNumber,
          amountCents: 10_000,
          currency: "SAR",
          paymentMethod: "bank_transfer",
          merchantAttemptKey: `KEY-BANK-PRESERVE-${sequence}`,
          status: "creating",
        },
      };
    };
    store.markPaymentAttemptCreationFailure = async () => {
      failureCalls += 1;
    };
    const persistence = {
      store: async () => receipt,
      remove: async () => {
        removeCalls += 1;
        return true;
      },
    };

    await t.test("normal finalize", async () => {
      store.completeBankTransferAttempt = async (input: any) => ({
        status: "pending_review",
        attempt: {
          id: input.attemptId,
          status: "pending_review",
          receiptSubmittedAt: "2026-08-22T12:00:00.000Z",
        },
      });
      const result = await service.submitBankTransfer(
        "owner-token",
        {} as Express.Multer.File,
        persistence,
      );
      assert.equal(result.status, "pending_review");
      assert.equal(removeCalls, 0);
    });

    await t.test("transaction committed but response failed", async () => {
      let committedAttemptId = "";
      store.completeBankTransferAttempt = async (input: any) => {
        committedAttemptId = input.attemptId;
        throw new Error("connection dropped after commit");
      };
      store.getPaymentAttempt = async () => ({
        id: committedAttemptId,
        status: "pending_review",
        receiptUrl: receipt.url,
        receiptObjectKey: receipt.objectKey,
        receiptSubmittedAt: "2026-08-22T12:00:00.000Z",
      });
      const result = await service.submitBankTransfer(
        "owner-token",
        {} as Express.Multer.File,
        persistence,
      );
      assert.equal(result.status, "pending_review");
      assert.equal(removeCalls, 0);
    });

    assert.equal(failureCalls, 0);
  } finally {
    (service as any).verifyOwnerToken = originalVerify;
    store.reservePaymentAttempt = originals.reserve;
    store.completeBankTransferAttempt = originals.complete;
    store.getPaymentAttempt = originals.getAttempt;
    store.markPaymentAttemptCreationFailure = originals.markFailure;
    (firebaseService as any).getDefaultBankAccount = originals.getDefaultBankAccount;
  }
});
