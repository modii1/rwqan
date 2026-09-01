import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { BookingTokenService } from "./BookingTokenService";
import {
  createCustomerBookingShortCode,
  createOwnerPaymentShortCode,
} from "./BookingShortLinkService";
import { DEFAULT_BOOKING_WHATSAPP_TEMPLATES } from "../../shared/booking";
import type {
  BookingFollowUpDocument,
  BookingNotificationJob,
  BookingNotificationKind,
} from "./BookingCommissionTypes";

const previousSecret = process.env.SESSION_SECRET;
const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;
const previousEnjazatikUrl = process.env.ENJAZATIK_URL;
const previousEnjazatikToken = process.env.ENJAZATIK_TOKEN;
const TOKEN_SECRET = "booking-message-test-secret-value-1234567890";

let buildBookingNotificationMessage: typeof import("./BookingNotificationWorker")["buildBookingNotificationMessage"];
let dispatchDueBookingNotifications: typeof import("./BookingNotificationWorker")["dispatchDueBookingNotifications"];
let shouldStartBookingCommissionWorker: typeof import("./BookingNotificationWorker")["shouldStartBookingCommissionWorker"];
let bookingWorkerIntervalMs: number;
let bookingCommissionStore: typeof import("./BookingCommissionStore")["bookingCommissionStore"];
let bookingCommissionService: typeof import("./BookingCommissionService")["bookingCommissionService"];
type ConfirmedBookingDocument = Exclude<
  Extract<BookingFollowUpDocument, { bookingStatus: "confirmed" }>,
  { commissionStatus: "not_applicable" }
>;

before(async () => {
  process.env.SESSION_SECRET = TOKEN_SECRET;
  process.env.PUBLIC_BASE_URL = "https://booking.example/path-is-discarded";
  process.env.ENJAZATIK_URL = "https://provider.example/send";
  process.env.ENJAZATIK_TOKEN = "provider-test-token";
  ({ bookingCommissionStore } = await import("./BookingCommissionStore"));
  ({ bookingCommissionService } = await import("./BookingCommissionService"));
  ({
    BOOKING_WORKER_INTERVAL_MS: bookingWorkerIntervalMs,
    buildBookingNotificationMessage,
    dispatchDueBookingNotifications,
    shouldStartBookingCommissionWorker,
  } = await import("./BookingNotificationWorker"));
});

after(() => {
  if (previousSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSecret;
  if (previousPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
  if (previousEnjazatikUrl === undefined) delete process.env.ENJAZATIK_URL;
  else process.env.ENJAZATIK_URL = previousEnjazatikUrl;
  if (previousEnjazatikToken === undefined) delete process.env.ENJAZATIK_TOKEN;
  else process.env.ENJAZATIK_TOKEN = previousEnjazatikToken;
});

test("booking worker polls every minute to honor minute-precision delays", () => {
  assert.equal(bookingWorkerIntervalMs, 60 * 1_000);
});

test("booking worker starts automatically only in production", () => {
  assert.equal(shouldStartBookingCommissionWorker({ NODE_ENV: "production" }), true);
  assert.equal(shouldStartBookingCommissionWorker({ NODE_ENV: "development" }), false);
  assert.equal(shouldStartBookingCommissionWorker({ NODE_ENV: "test" }), false);
});

test("booking worker can be explicitly enabled for development", () => {
  assert.equal(
    shouldStartBookingCommissionWorker({
      NODE_ENV: "development",
      ENABLE_SCHEDULERS_IN_DEVELOPMENT: "true",
    }),
    true,
  );
  assert.equal(
    shouldStartBookingCommissionWorker({
      NODE_ENV: "development",
      ENABLE_BOOKING_WORKER_IN_DEVELOPMENT: "true",
    }),
    true,
  );
  assert.equal(
    shouldStartBookingCommissionWorker({
      NODE_ENV: "development",
      ENABLE_BOOKING_WORKER_IN_DEVELOPMENT: "TRUE",
    }),
    false,
  );
  assert.equal(
    shouldStartBookingCommissionWorker({
      NODE_ENV: "test",
      ENABLE_BOOKING_WORKER_IN_DEVELOPMENT: "true",
      ENABLE_SCHEDULERS_IN_DEVELOPMENT: "true",
    }),
    false,
  );
});

function confirmedBooking(
  overrides: Partial<ConfirmedBookingDocument> = {},
): ConfirmedBookingDocument {
  return {
    id: "BOOK-REQ-13383-001",
    contactRequestId: "CONTACT-DOC-1",
    requestCode: "REQ-13383-001",
    propertyNumber: "13383",
    propertyName: "شاليه الريف المائي",
    ownerPhone: "+966500000001",
    customerPhone: "+966500000002",
    customerSubject: "customer-subject-hmac",
    isFreeProperty: true,
    followUpDueAt: "2099-08-16T12:00:00.000Z",
    bookingStatus: "confirmed",
    commissionStatus: "pending",
    complianceStatus: "clear",
    confirmationFacts: {
      timing: "weekend",
      bookingDate: { value: "2099-09", precision: "month" },
      pricePaidHalalas: 125_555,
    },
    confirmedAt: "2099-08-15T12:00:00.000Z",
    declinedAt: null,
    commissionAmountHalalas: 12_556,
    commissionDueAt: "2099-08-20T12:00:00.000Z",
    commissionPaidAt: null,
    commissionReminderOffsetsSent: [],
    bookingDecision: "yes",
    questionnaireStartedAt: "2099-08-15T11:59:00.000Z",
    activeAttemptId: null,
    paidAttemptId: null,
    disputeStatus: "none",
    disputedAt: null,
    disputeReason: null,
    enforcementDeferredUntil: null,
    enforcementLastError: null,
    schemaVersion: 1,
    events: [],
    createdAt: "2099-08-15T10:00:00.000Z",
    updatedAt: "2099-08-15T12:00:00.000Z",
    ...overrides,
  };
}

function observeOnlyBooking(): BookingFollowUpDocument {
  return {
    ...confirmedBooking(),
    commissionStatus: "not_applicable",
    complianceStatus: "clear",
    commissionAmountHalalas: null,
    commissionDueAt: null,
    commissionPaidAt: null,
    commissionNoticeSentAt: null,
    commissionReminderOffsetsSent: [],
  };
}

function notificationJob(
  kind: BookingNotificationKind,
  overrides: Partial<BookingNotificationJob> = {},
): BookingNotificationJob {
  const isCustomer = kind === "customer_followup" ||
    kind === "customer_final_reminder";
  const reminderOffsetDays = kind === "commission_reminder_3"
    ? 3
    : kind === "commission_reminder_4"
      ? 4
      : kind === "commission_reminder_5"
        ? 5
        : null;
  return {
    id: `BOOK-REQ-13383-001--${kind}`,
    bookingId: "BOOK-REQ-13383-001",
    propertyNumber: "13383",
    recipientRole: isCustomer ? "customer" : "owner",
    recipientPhone: isCustomer ? "+966500000002" : "+966500000001",
    recipientQuotaKey: isCustomer ? "customer-subject-hmac" : "966500000001",
    kind,
    reminderOffsetDays,
    scheduledAt: "2099-08-18T12:00:00.000Z",
    status: "pending",
    isFreeProperty: true,
    quotaCategory: "transactional",
    attempts: 0,
    leaseToken: null,
    leaseExpiresAt: null,
    claimedAt: null,
    sentAt: null,
    failedAt: null,
    suppressedAt: null,
    providerError: null,
    createdAt: "2099-08-15T12:00:00.000Z",
    updatedAt: "2099-08-15T12:00:00.000Z",
    ...overrides,
  };
}

function customerShortCodeFromMessage(message: string): string {
  const match = /https:\/\/booking\.example\/b\/([A-Za-z0-9_-]{10})(?:\s|$)/
    .exec(message);
  assert.ok(match, "expected compact customer booking link in message");
  return match[1];
}

function ownerPaymentShortCodeFromMessage(message: string): string {
  const match = /https:\/\/booking\.example\/p\/([A-Za-z0-9_-]{10})(?:\s|$)/
    .exec(message);
  assert.ok(match, "expected compact owner payment link in message");
  return match[1];
}

function assertOwnerPaymentShortLink(
  message: string,
  booking: BookingFollowUpDocument,
): void {
  const token = bookingCommissionService.issueOwnerPaymentToken(booking);
  assert.equal(
    ownerPaymentShortCodeFromMessage(message),
    createOwnerPaymentShortCode(token, TOKEN_SECRET),
  );
  assert.equal(message.includes("/booking-commission/"), false);
}

test("customer follow-up exposes only the intended property label and a purpose-bound link", () => {
  const paidBooking = confirmedBooking();
  const paidMessage = buildBookingNotificationMessage(
    notificationJob("customer_followup"),
    paidBooking,
  );
  assert.ok(paidMessage.startsWith(
    "هل تم الحجز بعد تواصلك مع العقار رقم 13383؟",
  ));
  assert.ok(paidMessage.includes("\n\nأكد النتيجة من الرابط التالي:\n"));

  const shortCode = customerShortCodeFromMessage(paidMessage);
  assert.equal(
    shortCode,
    createCustomerBookingShortCode(paidBooking.id, TOKEN_SECRET),
  );
  assert.equal(paidMessage.includes(paidBooking.id), false);
  assert.equal(paidMessage.includes("/booking/"), false);
  assert.equal(paidMessage.includes("/p/"), false);

  const freeMessage = buildBookingNotificationMessage(
    notificationJob("customer_followup", { isFreeProperty: true }),
    confirmedBooking({ isFreeProperty: true }),
  );
  assert.ok(freeMessage.startsWith("هل تم الحجز بعد تواصلك مع العقار رقم 13383؟"));
  assert.equal(freeMessage.includes("شاليه الريف المائي"), false);
});

test("the final customer reminder preserves the supplied copy and contains no link", () => {
  const message = buildBookingNotificationMessage(
    notificationJob("customer_final_reminder"),
    confirmedBooking({ isFreeProperty: true }),
  );

  assert.equal(message, DEFAULT_BOOKING_WHATSAPP_TEMPLATES.customer_final_reminder);
  assert.equal(message.includes("https://"), false);
  assert.equal(message.includes("/b/"), false);
  assert.equal(message.includes("BOOK-REQ"), false);
});

test("the owner contact-limit alert uses the configured allowance and compact renewal link", () => {
  const message = buildBookingNotificationMessage(
    notificationJob("owner_contact_limit_reached"),
    confirmedBooking({ freePropertyContactDailyLimit: 7 }),
  );

  assert.equal(
    message,
    `تم الوصول إلى الحد اليومي لطلبات التواصل للعقار رقم 13383 ضمن الباقة المجانية (7 من 7).

قم بترقية الباقة لاستقبال طلبات تواصل غير محدودة:
https://booking.example/r`,
  );
});

test("owner confirmation states the three customer facts, price, 10% fee, deadline, and payment link", () => {
  const booking = confirmedBooking();
  const message = buildBookingNotificationMessage(
    notificationJob("owner_booking_confirmed"),
    booking,
  );

  assert.ok(message.includes("وقت الحجز: نهاية الأسبوع"));
  assert.ok(message.includes("رقم الطلب: REQ-13383-001"));
  assert.ok(message.includes("رقم العميل: +966500000002"));
  assert.match(message, /تاريخ الحجز: .+/);
  assert.ok(message.includes("المبلغ المدفوع: 1255.55 ريال"));
  assert.ok(message.includes("عمولة روقان (10%): 125.56 ريال"));
  assert.ok(message.includes("مهلة السداد: 5 أيام من وقت إرسال هذه الرسالة"));

  assertOwnerPaymentShortLink(message, booking);
});

test("owner confirmation preserves numeric exact-day and Hijri-month booking dates", () => {
  const exactDay = confirmedBooking({
    confirmationFacts: {
      timing: "weekend",
      bookingDate: { value: "2026-08-23", precision: "day" },
      pricePaidHalalas: 125_555,
    },
  });
  assert.ok(buildBookingNotificationMessage(
    notificationJob("owner_booking_confirmed"),
    exactDay,
  ).includes("تاريخ الحجز: 2026/8/23"));

  const hijriMonth = confirmedBooking({
    confirmationFacts: {
      timing: "weekend",
      bookingDate: {
        value: "1448-03",
        precision: "month",
        calendar: "hijri",
        startDate: "2026-08-14",
        endDate: "2026-09-11",
      },
      pricePaidHalalas: 125_555,
    },
  });
  assert.ok(buildBookingNotificationMessage(
    notificationJob("owner_booking_confirmed"),
    hijriMonth,
  ).includes("تاريخ الحجز: 1448/03"));
});

test("observe-only owner confirmation states booking facts without a fee or payment link", () => {
  const message = buildBookingNotificationMessage(
    notificationJob("owner_booking_confirmed"),
    observeOnlyBooking(),
  );

  assert.ok(message.startsWith("تم تسجيل حجز للعقار شاليه الريف المائي رقم 13383"));
  assert.ok(message.includes("رقم الطلب: REQ-13383-001"));
  assert.ok(message.includes("رقم العميل: +966500000002"));
  assert.ok(message.includes("وقت الحجز: نهاية الأسبوع"));
  assert.match(message, /تاريخ الحجز: .+/);
  assert.ok(message.includes("المبلغ المدفوع: 1255.55 ريال"));
  assert.equal(message.includes("عمولة روقان"), false);
  assert.equal(message.includes("آخر موعد للسداد"), false);
  assert.equal(message.includes("مهلة السداد"), false);
  assert.equal(message.includes("رابط الدفع"), false);
  assert.equal(message.includes("/booking-commission/"), false);
  assert.equal(message.includes("/p/"), false);
});

test("legacy bookings with a blank property name use a safe display fallback", () => {
  const message = buildBookingNotificationMessage(
    notificationJob("owner_booking_confirmed"),
    confirmedBooking({ propertyName: "" }),
  );
  assert.ok(message.startsWith("تم تسجيل حجز للعقار بدون اسم رقم 13383"));
});

test("day 3, 4, and 5 reminders preserve their offset and transactional payment facts", () => {
  for (const day of [3, 4, 5] as const) {
    const message = buildBookingNotificationMessage(
      notificationJob(`commission_reminder_${day}`),
      confirmedBooking(),
    );
    assert.ok(message.startsWith(`تذكير اليوم ${day}:`));
    assert.ok(message.includes("المبلغ المستحق: 125.56 ريال"));
    assert.match(message, /آخر موعد للسداد: .+/);
    assertOwnerPaymentShortLink(message, confirmedBooking());
  }
});

test("rejected dispute message states collection facts and links back to payment", () => {
  const message = buildBookingNotificationMessage(
    notificationJob("commission_dispute_rejected"),
    confirmedBooking({ disputeStatus: "rejected" }),
  );

  assert.ok(message.startsWith("تم رفض الاعتراض على عمولة حجز العقار"));
  assert.ok(message.includes("المبلغ المستحق: 125.56 ريال"));
  assert.match(message, /آخر موعد للسداد: .+/);
  assertOwnerPaymentShortLink(message, confirmedBooking({ disputeStatus: "rejected" }));
});

test("pause and release messages describe the matching property outcome", () => {
  const booking = confirmedBooking();
  const pauseMessage = buildBookingNotificationMessage(
    notificationJob("property_paused"),
    booking,
  );
  assert.ok(pauseMessage.startsWith("انتهت مهلة سداد عمولة الحجز"));
  assert.ok(pauseMessage.includes("سيتم إيقاف ظهور العقار إلى أن يتم سداد مبلغ 125.56 ريال."));
  assertOwnerPaymentShortLink(pauseMessage, booking);

  const releaseMessage = buildBookingNotificationMessage(
    notificationJob("property_released"),
    confirmedBooking({ commissionStatus: "paid", complianceStatus: "released" }),
  );
  assert.equal(
    releaseMessage,
    "تم استلام عمولة حجز العقار شاليه الريف المائي رقم 13383 وإعادة إتاحة العقار.",
  );

  const waivedMessage = buildBookingNotificationMessage(
    notificationJob("property_released"),
    confirmedBooking({ commissionStatus: "waived", complianceStatus: "released" }),
  );
  assert.equal(
    waivedMessage,
    "تم قبول الاعتراض على عمولة حجز العقار شاليه الريف المائي رقم 13383 وإعادة إتاحة العقار.",
  );
  assert.equal(waivedMessage.includes("تم استلام"), false);
  assert.equal(waivedMessage.includes("رابط الدفع"), false);
});

test("worker message construction uses a validated non-default admin template", () => {
  const templates = {
    ...DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
    property_released_paid:
      "released {{propertyNumber}} / {{propertyName}}",
  };
  assert.equal(
    buildBookingNotificationMessage(
      notificationJob("property_released"),
      confirmedBooking({ commissionStatus: "paid", complianceStatus: "released" }),
      templates,
    ),
    "released 13383 / شاليه الريف المائي",
  );
});

test("an existing pending customer job lazily creates its compact alias before sending once", async () => {
  const store = bookingCommissionStore as any;
  const service = bookingCommissionService as any;
  const originals = {
    recover: store.recoverExpiredNotificationClaims,
    claim: store.claimDueNotificationJobs,
    prepare: store.prepareNotificationForSend,
    settings: store.getFreeWorkflowSettings,
    finish: store.finishNotificationJob,
    followUpFlag: service.isFollowUpEnabled,
    commissionFlag: service.isCommissionEnforcementEnabled,
    fetch: globalThis.fetch,
  };
  const booking = {
    ...confirmedBooking(),
    bookingStatus: "awaiting_response",
    bookingDecision: null,
    questionnaireStartedAt: null,
    confirmationFacts: null,
    confirmedAt: null,
  } as unknown as BookingFollowUpDocument;
  const claimed = {
    ...notificationJob("customer_followup", {
      status: "claimed",
      leaseToken: "customer-short-link-lease",
      quotaCategory: "customer_followup",
    }),
    leaseToken: "customer-short-link-lease",
  };
  const sequence: string[] = [];
  const aliasInputs: Array<{
    bookingId: string;
    token: string;
    expiresAt: Date | string | number;
  }> = [];
  const providerBodies: unknown[] = [];
  const finalizations: unknown[] = [];
  let claimCalls = 0;

  try {
    store.recoverExpiredNotificationClaims = async () => 0;
    store.claimDueNotificationJobs = async () =>
      claimCalls++ === 0 ? [claimed] : [];
    store.prepareNotificationForSend = async () => ({
      status: "ready",
      booking,
    });
    store.getFreeWorkflowSettings = async () => ({
      customerDailyLimit: 3,
      freeOwnerDailyLimit: 3,
      freePropertyContactDailyLimit: 3,
      customerFollowUpDelayMinutes: 1_440,
      whatsappTemplates: DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
      optionalCommissionReminderDays: [3, 4],
      updatedAt: null,
      updatedBy: "environment",
      source: "environment",
    });
    store.finishNotificationJob = async (input: unknown) => {
      finalizations.push(input);
    };
    service.isFollowUpEnabled = async () => true;
    service.isCommissionEnforcementEnabled = async () => true;
    globalThis.fetch = async (_url, init) => {
      sequence.push("provider");
      providerBodies.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    };

    assert.deepEqual(
      await dispatchDueBookingNotifications(
        new Date("2099-08-18T12:00:00.000Z"),
        {
          shortLinkService: {
            ensureCustomerResponseLink: async (input) => {
              sequence.push("alias");
              aliasInputs.push(input);
              return createCustomerBookingShortCode(input.bookingId, TOKEN_SECRET);
            },
            ensureOwnerPaymentLink: async () => {
              throw new Error("owner payment alias must not be provisioned");
            },
          },
        },
      ),
      { claimed: 1, sent: 1 },
    );

    assert.deepEqual(sequence, ["alias", "provider"]);
    assert.equal(aliasInputs.length, 1);
    assert.equal(aliasInputs[0].bookingId, booking.id);
    const verified = new BookingTokenService({ secret: TOKEN_SECRET })
      .verify(aliasInputs[0].token, "customer_response");
    assert.equal(verified.bookingId, booking.id);
    assert.equal(
      aliasInputs[0].expiresAt,
      Date.parse(booking.createdAt) + 90 * 24 * 60 * 60 * 1_000,
    );
    assert.equal(providerBodies.length, 1);
    const providerMessage = String(
      (providerBodies[0] as { message?: unknown }).message || "",
    );
    const code = customerShortCodeFromMessage(providerMessage);
    assert.equal(code.length, 10);
    assert.equal(code, createCustomerBookingShortCode(booking.id, TOKEN_SECRET));
    assert.deepEqual(finalizations, [{
      jobId: claimed.id,
      leaseToken: claimed.leaseToken,
      success: true,
      error: undefined,
    }]);
  } finally {
    store.recoverExpiredNotificationClaims = originals.recover;
    store.claimDueNotificationJobs = originals.claim;
    store.prepareNotificationForSend = originals.prepare;
    store.getFreeWorkflowSettings = originals.settings;
    store.finishNotificationJob = originals.finish;
    service.isFollowUpEnabled = originals.followUpFlag;
    service.isCommissionEnforcementEnabled = originals.commissionFlag;
    globalThis.fetch = originals.fetch;
  }
});

test("worker performs a final prepare after alias creation and skips the provider when it is blocked", async () => {
  const store = bookingCommissionStore as any;
  const service = bookingCommissionService as any;
  const originals = {
    recover: store.recoverExpiredNotificationClaims,
    claim: store.claimDueNotificationJobs,
    prepare: store.prepareNotificationForSend,
    settings: store.getFreeWorkflowSettings,
    finish: store.finishNotificationJob,
    followUpFlag: service.isFollowUpEnabled,
    commissionFlag: service.isCommissionEnforcementEnabled,
    fetch: globalThis.fetch,
  };
  const booking = {
    ...confirmedBooking(),
    bookingStatus: "awaiting_response",
    bookingDecision: null,
    questionnaireStartedAt: null,
    confirmationFacts: null,
    confirmedAt: null,
  } as unknown as BookingFollowUpDocument;
  const claimed = {
    ...notificationJob("customer_followup", {
      status: "claimed",
      leaseToken: "blocked-after-alias-lease",
      quotaCategory: "customer_followup",
    }),
    leaseToken: "blocked-after-alias-lease",
  };
  const sequence: string[] = [];
  const finalizations: unknown[] = [];
  let prepareCalls = 0;
  let providerCalls = 0;

  try {
    store.recoverExpiredNotificationClaims = async () => 0;
    store.claimDueNotificationJobs = async () => [claimed];
    store.prepareNotificationForSend = async () => {
      prepareCalls += 1;
      sequence.push("prepare");
      return prepareCalls === 3
        ? { status: "blocked", reason: "notification_state_changed" }
        : { status: "ready", booking };
    };
    store.getFreeWorkflowSettings = async () => ({
      customerDailyLimit: 0,
      freeOwnerDailyLimit: 0,
      freePropertyContactDailyLimit: 3,
      customerFollowUpDelayMinutes: 1_440,
      whatsappTemplates: DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
      optionalCommissionReminderDays: [3, 4],
      updatedAt: null,
      updatedBy: "environment",
      source: "environment",
    });
    store.finishNotificationJob = async (input: unknown) => {
      finalizations.push(input);
    };
    service.isFollowUpEnabled = async () => true;
    service.isCommissionEnforcementEnabled = async () => true;
    globalThis.fetch = async () => {
      providerCalls += 1;
      sequence.push("provider");
      return new Response("{}", { status: 200 });
    };

    assert.deepEqual(
      await dispatchDueBookingNotifications(
        new Date("2099-08-18T12:00:00.000Z"),
        {
          shortLinkService: {
            ensureCustomerResponseLink: async () => {
              sequence.push("alias");
              return "customer-short-code";
            },
            ensureOwnerPaymentLink: async () => {
              throw new Error("owner payment alias must not be provisioned");
            },
          },
        },
      ),
      { claimed: 1, sent: 0 },
    );

    assert.deepEqual(sequence, [
      "prepare",
      "prepare",
      "alias",
      "prepare",
    ]);
    assert.equal(prepareCalls, 3);
    assert.equal(providerCalls, 0);
    assert.deepEqual(finalizations, []);
  } finally {
    store.recoverExpiredNotificationClaims = originals.recover;
    store.claimDueNotificationJobs = originals.claim;
    store.prepareNotificationForSend = originals.prepare;
    store.getFreeWorkflowSettings = originals.settings;
    store.finishNotificationJob = originals.finish;
    service.isFollowUpEnabled = originals.followUpFlag;
    service.isCommissionEnforcementEnabled = originals.commissionFlag;
    globalThis.fetch = originals.fetch;
  }
});

test("dispatch sends the final customer reminder without provisioning any short link", async () => {
  const store = bookingCommissionStore as any;
  const service = bookingCommissionService as any;
  const originals = {
    recover: store.recoverExpiredNotificationClaims,
    claim: store.claimDueNotificationJobs,
    prepare: store.prepareNotificationForSend,
    settings: store.getFreeWorkflowSettings,
    finish: store.finishNotificationJob,
    followUpFlag: service.isFollowUpEnabled,
    commissionFlag: service.isCommissionEnforcementEnabled,
    fetch: globalThis.fetch,
  };
  const booking = {
    ...confirmedBooking({ isFreeProperty: true }),
    bookingStatus: "awaiting_response",
    bookingDecision: null,
    questionnaireStartedAt: null,
    confirmationFacts: null,
    confirmedAt: null,
  } as unknown as BookingFollowUpDocument;
  const claimed = {
    ...notificationJob("customer_final_reminder", {
      status: "claimed",
      leaseToken: "final-reminder-lease",
      quotaCategory: "customer_followup",
      customerFollowUpSequenceNumber: 4,
    }),
    leaseToken: "final-reminder-lease",
  };
  let claimCalls = 0;
  let aliasCalls = 0;
  const providerMessages: string[] = [];
  const finalizations: unknown[] = [];

  try {
    store.recoverExpiredNotificationClaims = async () => 0;
    store.claimDueNotificationJobs = async () =>
      claimCalls++ === 0 ? [claimed] : [];
    store.prepareNotificationForSend = async () => ({
      status: "ready",
      booking,
    });
    store.getFreeWorkflowSettings = async () => ({
      customerDailyLimit: 3,
      freeOwnerDailyLimit: 3,
      freePropertyContactDailyLimit: 3,
      customerFollowUpDelayMinutes: 1_440,
      whatsappTemplates: DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
      optionalCommissionReminderDays: [3, 4],
      updatedAt: null,
      updatedBy: "environment",
      source: "environment",
    });
    store.finishNotificationJob = async (input: unknown) => {
      finalizations.push(input);
    };
    service.isFollowUpEnabled = async () => true;
    service.isCommissionEnforcementEnabled = async () => true;
    globalThis.fetch = async (_url, init) => {
      providerMessages.push(String(
        (JSON.parse(String(init?.body)) as { message?: unknown }).message || "",
      ));
      return new Response("{}", { status: 200 });
    };

    assert.deepEqual(await dispatchDueBookingNotifications(
      new Date("2099-08-18T12:00:00.000Z"),
      {
        shortLinkService: {
          ensureCustomerResponseLink: async () => {
            aliasCalls += 1;
            return "must-not-be-created";
          },
          ensureOwnerPaymentLink: async () => {
            aliasCalls += 1;
            return "must-not-be-created";
          },
        },
      },
    ), { claimed: 1, sent: 1 });
    assert.equal(aliasCalls, 0);
    assert.deepEqual(providerMessages, [
      DEFAULT_BOOKING_WHATSAPP_TEMPLATES.customer_final_reminder,
    ]);
    assert.deepEqual(finalizations, [{
      jobId: claimed.id,
      leaseToken: claimed.leaseToken,
      success: true,
      error: undefined,
    }]);
  } finally {
    store.recoverExpiredNotificationClaims = originals.recover;
    store.claimDueNotificationJobs = originals.claim;
    store.prepareNotificationForSend = originals.prepare;
    store.getFreeWorkflowSettings = originals.settings;
    store.finishNotificationJob = originals.finish;
    service.isFollowUpEnabled = originals.followUpFlag;
    service.isCommissionEnforcementEnabled = originals.commissionFlag;
    globalThis.fetch = originals.fetch;
  }
});

test("a manual owner payment resend provisions its compact alias before provider delivery", async () => {
  const store = bookingCommissionStore as any;
  const service = bookingCommissionService as any;
  const originals = {
    recover: store.recoverExpiredNotificationClaims,
    claim: store.claimDueNotificationJobs,
    prepare: store.prepareNotificationForSend,
    settings: store.getFreeWorkflowSettings,
    finish: store.finishNotificationJob,
    followUpFlag: service.isFollowUpEnabled,
    commissionFlag: service.isCommissionEnforcementEnabled,
    fetch: globalThis.fetch,
  };
  const booking = confirmedBooking();
  const claimed = {
    ...notificationJob("commission_reminder_3", {
      id: "BOOK-REQ-13383-001--commission_reminder_3--manual-1",
      status: "claimed",
      leaseToken: "owner-short-link-lease",
      manualResendOfJobId: "BOOK-REQ-13383-001--commission_reminder_3",
      manualResendRequestedAt: "2099-08-18T12:00:00.000Z",
    }),
    leaseToken: "owner-short-link-lease",
  };
  const sequence: string[] = [];
  const aliasTokens: string[] = [];
  const providerBodies: unknown[] = [];
  const finalizations: unknown[] = [];
  let claimCalls = 0;

  try {
    store.recoverExpiredNotificationClaims = async () => 0;
    store.claimDueNotificationJobs = async () =>
      claimCalls++ === 0 ? [claimed] : [];
    store.prepareNotificationForSend = async () => {
      sequence.push("prepare");
      return { status: "ready", booking };
    };
    store.getFreeWorkflowSettings = async () => ({
      customerDailyLimit: 3,
      freeOwnerDailyLimit: 3,
      freePropertyContactDailyLimit: 3,
      customerFollowUpDelayMinutes: 1_440,
      whatsappTemplates: DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
      optionalCommissionReminderDays: [3, 4],
      updatedAt: null,
      updatedBy: "environment",
      source: "environment",
    });
    store.finishNotificationJob = async (input: unknown) => {
      finalizations.push(input);
    };
    service.isFollowUpEnabled = async () => true;
    service.isCommissionEnforcementEnabled = async () => true;
    globalThis.fetch = async (_url, init) => {
      sequence.push("provider");
      providerBodies.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    };

    assert.deepEqual(
      await dispatchDueBookingNotifications(
        new Date("2099-08-18T12:00:00.000Z"),
        {
          shortLinkService: {
            ensureCustomerResponseLink: async () => {
              throw new Error("customer alias must not be provisioned");
            },
            ensureOwnerPaymentLink: async ({ token }) => {
              sequence.push("alias");
              aliasTokens.push(token);
              return createOwnerPaymentShortCode(token, TOKEN_SECRET);
            },
          },
        },
      ),
      { claimed: 1, sent: 1 },
    );

    assert.deepEqual(sequence, [
      "prepare",
      "prepare",
      "alias",
      "prepare",
      "provider",
    ]);
    assert.equal(aliasTokens.length, 1);
    const verified = new BookingTokenService({ secret: TOKEN_SECRET })
      .verify(aliasTokens[0], "owner_payment");
    assert.equal(verified.bookingId, booking.id);
    assert.equal(providerBodies.length, 1);
    const providerMessage = String(
      (providerBodies[0] as { message?: unknown }).message || "",
    );
    assert.equal(
      ownerPaymentShortCodeFromMessage(providerMessage),
      createOwnerPaymentShortCode(aliasTokens[0], TOKEN_SECRET),
    );
    assert.equal(providerMessage.includes("/booking-commission/"), false);
    assert.deepEqual(finalizations, [{
      jobId: claimed.id,
      leaseToken: claimed.leaseToken,
      success: true,
      error: undefined,
    }]);
  } finally {
    store.recoverExpiredNotificationClaims = originals.recover;
    store.claimDueNotificationJobs = originals.claim;
    store.prepareNotificationForSend = originals.prepare;
    store.getFreeWorkflowSettings = originals.settings;
    store.finishNotificationJob = originals.finish;
    service.isFollowUpEnabled = originals.followUpFlag;
    service.isCommissionEnforcementEnabled = originals.commissionFlag;
    globalThis.fetch = originals.fetch;
  }
});

test("owner payment alias provisioning failure prevents provider delivery", async () => {
  const store = bookingCommissionStore as any;
  const service = bookingCommissionService as any;
  const originals = {
    recover: store.recoverExpiredNotificationClaims,
    claim: store.claimDueNotificationJobs,
    prepare: store.prepareNotificationForSend,
    settings: store.getFreeWorkflowSettings,
    finish: store.finishNotificationJob,
    followUpFlag: service.isFollowUpEnabled,
    commissionFlag: service.isCommissionEnforcementEnabled,
    fetch: globalThis.fetch,
  };
  const booking = confirmedBooking();
  const claimed = {
    ...notificationJob("owner_booking_confirmed", {
      status: "claimed",
      leaseToken: "owner-alias-failure-lease",
    }),
    leaseToken: "owner-alias-failure-lease",
  };
  const sequence: string[] = [];
  const finalizations: unknown[] = [];
  let providerCalls = 0;

  try {
    store.recoverExpiredNotificationClaims = async () => 0;
    store.claimDueNotificationJobs = async () => [claimed];
    store.prepareNotificationForSend = async () => {
      sequence.push("prepare");
      return { status: "ready", booking };
    };
    store.getFreeWorkflowSettings = async () => ({
      customerDailyLimit: 3,
      freeOwnerDailyLimit: 3,
      freePropertyContactDailyLimit: 3,
      customerFollowUpDelayMinutes: 1_440,
      whatsappTemplates: DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
      optionalCommissionReminderDays: [3, 4],
      updatedAt: null,
      updatedBy: "environment",
      source: "environment",
    });
    store.finishNotificationJob = async (input: unknown) => {
      finalizations.push(input);
    };
    service.isFollowUpEnabled = async () => true;
    service.isCommissionEnforcementEnabled = async () => true;
    globalThis.fetch = async () => {
      providerCalls += 1;
      return new Response("{}", { status: 200 });
    };

    assert.deepEqual(
      await dispatchDueBookingNotifications(
        new Date("2099-08-18T12:00:00.000Z"),
        {
          shortLinkService: {
            ensureCustomerResponseLink: async () => {
              throw new Error("customer alias must not be provisioned");
            },
            ensureOwnerPaymentLink: async () => {
              sequence.push("alias");
              throw new Error("owner alias provisioning failed");
            },
          },
        },
      ),
      { claimed: 1, sent: 0 },
    );

    assert.deepEqual(sequence, ["prepare", "prepare", "alias"]);
    assert.equal(providerCalls, 0);
    assert.deepEqual(finalizations, [{
      jobId: claimed.id,
      leaseToken: claimed.leaseToken,
      success: false,
      error: "owner alias provisioning failed",
    }]);
  } finally {
    store.recoverExpiredNotificationClaims = originals.recover;
    store.claimDueNotificationJobs = originals.claim;
    store.prepareNotificationForSend = originals.prepare;
    store.getFreeWorkflowSettings = originals.settings;
    store.finishNotificationJob = originals.finish;
    service.isFollowUpEnabled = originals.followUpFlag;
    service.isCommissionEnforcementEnabled = originals.commissionFlag;
    globalThis.fetch = originals.fetch;
  }
});

test("dispatch fetches the persisted template, sends its rendered body once, and finalizes the job", async () => {
  const store = bookingCommissionStore as any;
  const service = bookingCommissionService as any;
  const originals = {
    recover: store.recoverExpiredNotificationClaims,
    claim: store.claimDueNotificationJobs,
    prepare: store.prepareNotificationForSend,
    settings: store.getFreeWorkflowSettings,
    finish: store.finishNotificationJob,
    followUpFlag: service.isFollowUpEnabled,
    commissionFlag: service.isCommissionEnforcementEnabled,
    fetch: globalThis.fetch,
  };
  const booking = observeOnlyBooking();
  const claimed = {
    ...notificationJob("owner_booking_confirmed", {
      status: "claimed",
      leaseToken: "dispatch-lease",
    }),
    leaseToken: "dispatch-lease",
  };
  const customTemplates = {
    ...DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
    owner_booking_facts:
      "CUSTOM {{propertyNumber}} | {{propertyName}} | {{requestCode}} | {{customerPhone}} | {{timing}} | {{bookingDate}} | {{pricePaidSar}}",
  };
  const providerRequests: Array<{ url: string; body: unknown }> = [];
  const finalizations: unknown[] = [];
  let claimCalls = 0;
  let settingsReads = 0;

  try {
    store.recoverExpiredNotificationClaims = async () => 0;
    store.claimDueNotificationJobs = async () =>
      claimCalls++ === 0 ? [claimed] : [];
    store.prepareNotificationForSend = async () => ({
      status: "ready",
      booking,
    });
    store.getFreeWorkflowSettings = async () => {
      settingsReads += 1;
      return {
        customerDailyLimit: 3,
        freeOwnerDailyLimit: 3,
        freePropertyContactDailyLimit: 3,
        customerFollowUpDelayMinutes: 1_440,
        whatsappTemplates: customTemplates,
        optionalCommissionReminderDays: [3, 4],
        updatedAt: "2099-08-15T00:00:00.000Z",
        updatedBy: "admin",
        source: "firestore",
      };
    };
    store.finishNotificationJob = async (input: unknown) => {
      finalizations.push(input);
    };
    service.isFollowUpEnabled = async () => true;
    service.isCommissionEnforcementEnabled = async () => true;
    globalThis.fetch = async (url, init) => {
      providerRequests.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
      });
      return new Response("{}", { status: 200 });
    };

    assert.deepEqual(
      await dispatchDueBookingNotifications(new Date("2099-08-15T12:00:00.000Z")),
      { claimed: 1, sent: 1 },
    );
    assert.deepEqual(
      await dispatchDueBookingNotifications(new Date("2099-08-15T12:01:00.000Z")),
      { claimed: 0, sent: 0 },
    );
    assert.equal(settingsReads, 1);
    assert.equal(providerRequests.length, 1);
    assert.equal(providerRequests[0].url, "https://provider.example/send");
    assert.deepEqual(providerRequests[0].body, {
      number: "966500000001",
      message:
        "CUSTOM 13383 | شاليه الريف المائي | REQ-13383-001 | +966500000002 | نهاية الأسبوع | 2099/9 | 1255.55",
    });
    assert.deepEqual(finalizations, [{
      jobId: claimed.id,
      leaseToken: "dispatch-lease",
      success: true,
      error: undefined,
    }]);
  } finally {
    store.recoverExpiredNotificationClaims = originals.recover;
    store.claimDueNotificationJobs = originals.claim;
    store.prepareNotificationForSend = originals.prepare;
    store.getFreeWorkflowSettings = originals.settings;
    store.finishNotificationJob = originals.finish;
    service.isFollowUpEnabled = originals.followUpFlag;
    service.isCommissionEnforcementEnabled = originals.commissionFlag;
    globalThis.fetch = originals.fetch;
  }
});
