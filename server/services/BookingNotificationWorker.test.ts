import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { BookingTokenService } from "./BookingTokenService";
import type {
  BookingFollowUpDocument,
  BookingNotificationJob,
  BookingNotificationKind,
} from "./BookingCommissionTypes";

const previousSecret = process.env.SESSION_SECRET;
const previousPublicBaseUrl = process.env.PUBLIC_BASE_URL;
const TOKEN_SECRET = "booking-message-test-secret-value-1234567890";

let buildBookingNotificationMessage: typeof import("./BookingNotificationWorker")["buildBookingNotificationMessage"];
type ConfirmedBookingDocument = Exclude<
  Extract<BookingFollowUpDocument, { bookingStatus: "confirmed" }>,
  { commissionStatus: "not_applicable" }
>;

before(async () => {
  process.env.SESSION_SECRET = TOKEN_SECRET;
  process.env.PUBLIC_BASE_URL = "https://booking.example/path-is-discarded";
  ({ buildBookingNotificationMessage } = await import("./BookingNotificationWorker"));
});

after(() => {
  if (previousSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSecret;
  if (previousPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = previousPublicBaseUrl;
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
    recipientRole: kind === "customer_followup" ? "customer" : "owner",
    recipientPhone: kind === "customer_followup" ? "+966500000002" : "+966500000001",
    recipientQuotaKey: kind === "customer_followup" ? "customer-subject-hmac" : "966500000001",
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

function tokenFromMessage(message: string, route: "booking" | "booking-commission"): string {
  const match = new RegExp(`https://booking\\.example/${route}/([^\\s]+)`).exec(message);
  assert.ok(match, `expected ${route} link in message`);
  return decodeURIComponent(match[1]);
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

  const tokenService = new BookingTokenService({ secret: TOKEN_SECRET });
  const token = tokenFromMessage(paidMessage, "booking");
  assert.equal(tokenService.verify(token, "customer_response").bookingId, paidBooking.id);
  assert.throws(() => tokenService.verify(token, "owner_payment"));

  const freeMessage = buildBookingNotificationMessage(
    notificationJob("customer_followup", { isFreeProperty: true }),
    confirmedBooking({ isFreeProperty: true }),
  );
  assert.ok(freeMessage.startsWith("هل تم الحجز بعد تواصلك مع العقار رقم 13383؟"));
  assert.equal(freeMessage.includes("شاليه الريف المائي"), false);
});

test("owner confirmation states the three customer facts, price, 10% fee, deadline, and payment link", () => {
  const booking = confirmedBooking();
  const message = buildBookingNotificationMessage(
    notificationJob("owner_booking_confirmed"),
    booking,
  );

  assert.ok(message.includes("وقت الحجز: نهاية الأسبوع"));
  assert.match(message, /تاريخ الحجز: .+/);
  assert.ok(message.includes("المبلغ المدفوع: 1255.55 ريال"));
  assert.ok(message.includes("عمولة روقان (10%): 125.56 ريال"));
  assert.ok(message.includes("مهلة السداد: 5 أيام من وقت إرسال هذه الرسالة"));

  const tokenService = new BookingTokenService({ secret: TOKEN_SECRET });
  const token = tokenFromMessage(message, "booking-commission");
  assert.equal(tokenService.verify(token, "owner_payment").bookingId, booking.id);
  assert.throws(() => tokenService.verify(token, "customer_response"));
});

test("observe-only owner confirmation states booking facts without a fee or payment link", () => {
  const message = buildBookingNotificationMessage(
    notificationJob("owner_booking_confirmed"),
    observeOnlyBooking(),
  );

  assert.ok(message.startsWith("تم تسجيل حجز للعقار شاليه الريف المائي رقم 13383"));
  assert.ok(message.includes("وقت الحجز: نهاية الأسبوع"));
  assert.match(message, /تاريخ الحجز: .+/);
  assert.ok(message.includes("المبلغ المدفوع: 1255.55 ريال"));
  assert.equal(message.includes("عمولة روقان"), false);
  assert.equal(message.includes("آخر موعد للسداد"), false);
  assert.equal(message.includes("مهلة السداد"), false);
  assert.equal(message.includes("رابط الدفع"), false);
  assert.equal(message.includes("/booking-commission/"), false);
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
    tokenFromMessage(message, "booking-commission");
  }
});

test("pause and release messages describe the matching property outcome", () => {
  const booking = confirmedBooking();
  const pauseMessage = buildBookingNotificationMessage(
    notificationJob("property_paused"),
    booking,
  );
  assert.ok(pauseMessage.startsWith("انتهت مهلة سداد عمولة الحجز"));
  assert.ok(pauseMessage.includes("سيتم إيقاف ظهور العقار إلى أن يتم سداد مبلغ 125.56 ريال."));
  tokenFromMessage(pauseMessage, "booking-commission");

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
