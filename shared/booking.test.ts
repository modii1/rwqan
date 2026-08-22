import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOKING_WHATSAPP_TEMPLATE_MAX_LENGTH,
  COMMISSION_PAYMENT_WINDOW_MS,
  COMMISSION_REMINDER_OFFSET_DAYS,
  DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
  bookingConfirmationFactsSchema,
  bookingCustomerFollowUpDelayHoursSchema,
  bookingDateSchema,
  bookingFreeWorkflowConfigurationSchema,
  bookingFollowUpRecordSchema,
  bookingOptionalCommissionReminderDaysSchema,
  bookingResponseInputSchema,
  bookingStatusSchema,
  bookingWhatsAppTemplatesSchema,
  buildConfirmedBookingFinancials,
  calculateBookingCommissionHalalas,
  calculateCommissionDueAt,
  calculateCommissionReminderSchedule,
  commissionStatusSchema,
  complianceStatusSchema,
  normalizeBookingListedPriceOptionsHalalas,
  renderBookingWhatsAppTemplate,
  toBookingAdminDto,
  toBookingPublicDto,
  type BookingConfirmationFacts,
} from "./booking";

test("default booking WhatsApp templates render the approved messages byte-for-byte", () => {
  assert.deepEqual(
    bookingWhatsAppTemplatesSchema.parse(DEFAULT_BOOKING_WHATSAPP_TEMPLATES),
    DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
  );

  assert.equal(renderBookingWhatsAppTemplate(
    "customer_followup",
    DEFAULT_BOOKING_WHATSAPP_TEMPLATES.customer_followup,
    {
      propertyLabel: "العقار رقم 13383",
      followUpLink: "https://rwqan.sa/booking/customer-token",
    },
  ), `هل تم الحجز بعد تواصلك مع العقار رقم 13383؟

أكد النتيجة من الرابط التالي:
https://rwqan.sa/booking/customer-token`);

  assert.equal(renderBookingWhatsAppTemplate(
    "owner_booking_facts",
    DEFAULT_BOOKING_WHATSAPP_TEMPLATES.owner_booking_facts,
    {
      propertyName: "الريف المائي",
      propertyNumber: "13383",
      requestCode: "REQ-13383-001",
      customerPhone: "+966500000002",
      timing: "نهاية الأسبوع",
      bookingDate: "20 أغسطس 2026",
      pricePaidSar: "1000",
    },
  ), `تم تسجيل حجز للعقار الريف المائي رقم 13383

رقم الطلب: REQ-13383-001
رقم العميل: +966500000002
وقت الحجز: نهاية الأسبوع
تاريخ الحجز: 20 أغسطس 2026
المبلغ المدفوع: 1000 ريال`);

  assert.equal(renderBookingWhatsAppTemplate(
    "owner_booking_commission",
    DEFAULT_BOOKING_WHATSAPP_TEMPLATES.owner_booking_commission,
    {
      propertyName: "الريف المائي",
      propertyNumber: "13383",
      requestCode: "REQ-13383-001",
      customerPhone: "+966500000002",
      timing: "نهاية الأسبوع",
      bookingDate: "20 أغسطس 2026",
      pricePaidSar: "1000",
      commissionPercent: 10,
      commissionAmountSar: "100",
      paymentWindowDays: 5,
      paymentLink: "https://rwqan.sa/booking-commission/owner-token",
    },
  ), `تم تسجيل حجز للعقار الريف المائي رقم 13383

رقم الطلب: REQ-13383-001
رقم العميل: +966500000002
وقت الحجز: نهاية الأسبوع
تاريخ الحجز: 20 أغسطس 2026
المبلغ المدفوع: 1000 ريال

عمولة روقان (10%): 100 ريال
مهلة السداد: 5 أيام من وقت إرسال هذه الرسالة

رابط الدفع:
https://rwqan.sa/booking-commission/owner-token`);

  assert.equal(renderBookingWhatsAppTemplate(
    "commission_reminder",
    DEFAULT_BOOKING_WHATSAPP_TEMPLATES.commission_reminder,
    {
      reminderDay: 3,
      propertyName: "الريف المائي",
      propertyNumber: "13383",
      commissionAmountSar: "100",
      commissionDueAt: "25 أغسطس 2026",
      paymentLink: "https://rwqan.sa/booking-commission/owner-token",
    },
  ), `تذكير اليوم 3: عمولة حجز العقار الريف المائي رقم 13383 لم تُسدد بعد.

المبلغ المستحق: 100 ريال
آخر موعد للسداد: 25 أغسطس 2026

رابط الدفع:
https://rwqan.sa/booking-commission/owner-token`);

  assert.equal(renderBookingWhatsAppTemplate(
    "property_paused",
    DEFAULT_BOOKING_WHATSAPP_TEMPLATES.property_paused,
    {
      propertyName: "الريف المائي",
      propertyNumber: "13383",
      commissionAmountSar: "100",
      paymentLink: "https://rwqan.sa/booking-commission/owner-token",
    },
  ), `انتهت مهلة سداد عمولة الحجز للعقار الريف المائي رقم 13383.

سيتم إيقاف ظهور العقار إلى أن يتم سداد مبلغ 100 ريال.

رابط الدفع:
https://rwqan.sa/booking-commission/owner-token`);

  assert.equal(renderBookingWhatsAppTemplate(
    "property_released_paid",
    DEFAULT_BOOKING_WHATSAPP_TEMPLATES.property_released_paid,
    { propertyName: "الريف المائي", propertyNumber: "13383" },
  ), "تم استلام عمولة حجز العقار الريف المائي رقم 13383 وإعادة إتاحة العقار.");

  assert.equal(renderBookingWhatsAppTemplate(
    "property_released_waived",
    DEFAULT_BOOKING_WHATSAPP_TEMPLATES.property_released_waived,
    { propertyName: "الريف المائي", propertyNumber: "13383" },
  ), "تم قبول الاعتراض على عمولة حجز العقار الريف المائي رقم 13383 وإعادة إتاحة العقار.");

  assert.equal(renderBookingWhatsAppTemplate(
    "commission_dispute_rejected",
    DEFAULT_BOOKING_WHATSAPP_TEMPLATES.commission_dispute_rejected,
    {
      propertyName: "الريف المائي",
      propertyNumber: "13383",
      commissionAmountSar: "100",
      commissionDueAt: "25 أغسطس 2026",
      paymentLink: "https://rwqan.sa/booking-commission/owner-token",
    },
  ), `تم رفض الاعتراض على عمولة حجز العقار الريف المائي رقم 13383 واستئناف تحصيل العمولة.

المبلغ المستحق: 100 ريال
آخر موعد للسداد: 25 أغسطس 2026

رابط الدفع:
https://rwqan.sa/booking-commission/owner-token`);
});

test("booking WhatsApp templates require each safe placeholder exactly once", () => {
  for (const customerFollowup of [
    "{{propertyLabel}}",
    "{{propertyLabel}} {{followUpLink}} {{unknown}}",
    "{{propertyLabel}} {{followUpLink}} {{followUpLink}}",
    "{{propertyLabel}} {{follow-up-link}}",
    `{{propertyLabel}} {{followUpLink}} ${"x".repeat(BOOKING_WHATSAPP_TEMPLATE_MAX_LENGTH)}`,
  ]) {
    assert.equal(bookingWhatsAppTemplatesSchema.safeParse({
      ...DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
      customer_followup: customerFollowup,
    }).success, false, customerFollowup.slice(0, 80));
  }

  assert.equal(bookingWhatsAppTemplatesSchema.safeParse({
    ...DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
    extra_template: "unexpected",
  }).success, false);
});

test("only optional commission reminders on days three and four are configurable", () => {
  assert.deepEqual(bookingOptionalCommissionReminderDaysSchema.parse([4, 3]), [3, 4]);
  assert.deepEqual(bookingOptionalCommissionReminderDaysSchema.parse([]), []);
  for (const invalid of [[3, 3], [5], [2], [3, 4, 5]]) {
    assert.equal(
      bookingOptionalCommissionReminderDaysSchema.safeParse(invalid).success,
      false,
    );
  }

  assert.equal(bookingFreeWorkflowConfigurationSchema.safeParse({
    customerDailyLimit: 3,
    freeOwnerDailyLimit: 3,
    freePropertyContactDailyLimit: 3,
    customerFollowUpDelayHours: 24,
    whatsappTemplates: DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
    optionalCommissionReminderDays: [3, 4],
  }).success, true);
});

test("customer follow-up delay accepts only whole hours from one through 120", () => {
  for (const value of [1, 24, 120]) {
    assert.equal(bookingCustomerFollowUpDelayHoursSchema.parse(value), value);
  }
  for (const value of [0, 1.5, 121, "24", null]) {
    assert.equal(
      bookingCustomerFollowUpDelayHoursSchema.safeParse(value).success,
      false,
    );
  }
});

const confirmedAt = "2026-08-15T12:30:00.000Z";
const facts: BookingConfirmationFacts = {
  timing: "weekend",
  bookingDate: { value: "2026-09", precision: "month" },
  pricePaidHalalas: 125_555,
};

const commonRecord = {
  id: "BOOK-1",
  contactRequestId: "REQ-DOC-1",
  requestCode: "REQ-CODE-1",
  propertyNumber: "13383",
  customerSubject: "customer-subject-hash",
  followUpDueAt: "2026-08-17T12:30:00.000Z",
  createdAt: "2026-08-15T12:00:00.000Z",
  updatedAt: "2026-08-15T12:30:00.000Z",
};

function confirmedRecord(overrides: Record<string, unknown> = {}) {
  return {
    ...commonRecord,
    bookingStatus: "confirmed",
    commissionStatus: "pending",
    complianceStatus: "clear",
    confirmationFacts: facts,
    confirmedAt,
    declinedAt: null,
    commissionAmountHalalas: calculateBookingCommissionHalalas(facts.pricePaidHalalas),
    commissionDueAt: calculateCommissionDueAt(confirmedAt),
    commissionPaidAt: null,
    commissionReminderOffsetsSent: [],
    ...overrides,
  };
}

test("booking, commission, and compliance states remain independent enums", () => {
  assert.deepEqual(bookingStatusSchema.options, ["awaiting_response", "declined", "confirmed"]);
  assert.deepEqual(
    commissionStatusSchema.options,
    ["not_applicable", "pending", "paid", "overdue", "waived"],
  );
  assert.deepEqual(complianceStatusSchema.options, ["clear", "paused", "released"]);
});

test("confirmation has exactly three strict facts", () => {
  const parsed = bookingConfirmationFactsSchema.parse(facts);
  assert.deepEqual(Object.keys(parsed), ["timing", "bookingDate", "pricePaidHalalas"]);

  assert.equal(bookingConfirmationFactsSchema.safeParse({
    ...facts,
    additionalAnswer: "unexpected",
  }).success, false);
  assert.equal(bookingConfirmationFactsSchema.safeParse({
    timing: "weekend",
    bookingDate: facts.bookingDate,
  }).success, false);
  assert.equal(bookingConfirmationFactsSchema.safeParse({
    ...facts,
    timing: "holiday",
  }).success, false);
  assert.equal(bookingConfirmationFactsSchema.safeParse({
    ...facts,
    pricePaidHalalas: 0,
  }).success, false);
  assert.equal(bookingConfirmationFactsSchema.safeParse({
    ...facts,
    pricePaidHalalas: 100.5,
  }).success, false);
});

test("confirmed price facts stay between 1 and 1,000,000 SAR inclusive", () => {
  for (const pricePaidHalalas of [100, 100_000_000]) {
    assert.equal(bookingConfirmationFactsSchema.safeParse({
      ...facts,
      pricePaidHalalas,
    }).success, true);
  }

  for (const pricePaidHalalas of [99, 100_000_001]) {
    assert.equal(bookingConfirmationFactsSchema.safeParse({
      ...facts,
      pricePaidHalalas,
    }).success, false);
  }
});

test("listed property prices normalize to unique sorted halala options", () => {
  assert.deepEqual(normalizeBookingListedPriceOptionsHalalas({
    weekday: "750",
    weekend: "١٬٢٥٠٫٥٠",
    overnight: "750.00",
    holidays: "1000000",
    special: "0.99",
    display: "not-a-price",
    ignored: "500",
  }), [75_000, 125_050, 100_000_000]);

  assert.deepEqual(normalizeBookingListedPriceOptionsHalalas(null), []);
  assert.deepEqual(normalizeBookingListedPriceOptionsHalalas([]), []);
});

test("booking dates validate the declared day or month precision", () => {
  assert.deepEqual(
    bookingDateSchema.parse({ value: "2028-02-29", precision: "day" }),
    { value: "2028-02-29", precision: "day" },
  );
  assert.deepEqual(
    bookingDateSchema.parse({ value: "2026-12", precision: "month" }),
    { value: "2026-12", precision: "month" },
  );

  for (const invalid of [
    { value: "2026-02-29", precision: "day" },
    { value: "2026-04-31", precision: "day" },
    { value: "2026-00", precision: "month" },
    { value: "2026-13", precision: "month" },
    { value: "2026-08", precision: "day" },
    { value: "2026-08-15", precision: "month" },
  ]) {
    assert.equal(bookingDateSchema.safeParse(invalid).success, false);
  }
});

test("ten-percent commission rounds to the nearest halala without float drift", () => {
  const cases: Array<[number, number]> = [
    [1, 0],
    [4, 0],
    [5, 1],
    [14, 1],
    [15, 2],
    [100, 10],
    [1_001, 100],
    [125_555, 12_556],
    [Number.MAX_SAFE_INTEGER, 900_719_925_474_099],
  ];
  for (const [price, commission] of cases) {
    assert.equal(calculateBookingCommissionHalalas(price), commission);
  }

  assert.throws(() => calculateBookingCommissionHalalas(0));
  assert.throws(() => calculateBookingCommissionHalalas(-1));
  assert.throws(() => calculateBookingCommissionHalalas(1.5));
});

test("commission is due after exactly five 24-hour periods with reminders on days 3, 4, and 5", () => {
  const confirmedAtMs = Date.parse(confirmedAt);
  const dueAt = calculateCommissionDueAt(confirmedAt);
  assert.equal(Date.parse(dueAt) - confirmedAtMs, COMMISSION_PAYMENT_WINDOW_MS);

  const schedule = calculateCommissionReminderSchedule(confirmedAt);
  assert.deepEqual(schedule.map(({ offsetDays }) => offsetDays), [...COMMISSION_REMINDER_OFFSET_DAYS]);
  assert.deepEqual(
    schedule.map(({ scheduledAt }) => (Date.parse(scheduledAt) - confirmedAtMs) / (24 * 60 * 60 * 1_000)),
    [3, 4, 5],
  );

  const financials = buildConfirmedBookingFinancials(facts, confirmedAt);
  assert.equal(financials.commissionAmountHalalas, 12_556);
  assert.equal(financials.commissionDueAt, dueAt);
  assert.deepEqual(financials.commissionReminderSchedule, schedule);
});

test("response input treats the yes/no gate separately from the three facts", () => {
  assert.deepEqual(bookingResponseInputSchema.parse({ booked: false }), { booked: false });
  assert.deepEqual(
    bookingResponseInputSchema.parse({ booked: true, facts }),
    { booked: true, facts },
  );
  assert.equal(bookingResponseInputSchema.safeParse({ booked: true }).success, false);
  assert.equal(bookingResponseInputSchema.safeParse({ booked: false, facts }).success, false);
});

test("follow-up records enforce status-specific facts and financial invariants", () => {
  const awaiting = bookingFollowUpRecordSchema.parse({
    ...commonRecord,
    bookingStatus: "awaiting_response",
    commissionStatus: "not_applicable",
    complianceStatus: "clear",
    confirmationFacts: null,
    confirmedAt: null,
    declinedAt: null,
    commissionAmountHalalas: null,
    commissionDueAt: null,
    commissionPaidAt: null,
    commissionReminderOffsetsSent: [],
  });
  assert.equal(awaiting.bookingStatus, "awaiting_response");

  const declined = bookingFollowUpRecordSchema.parse({
    ...commonRecord,
    bookingStatus: "declined",
    commissionStatus: "not_applicable",
    complianceStatus: "clear",
    confirmationFacts: null,
    confirmedAt: null,
    declinedAt: "2026-08-16T09:00:00.000Z",
    commissionAmountHalalas: null,
    commissionDueAt: null,
    commissionPaidAt: null,
    commissionReminderOffsetsSent: [],
  });
  assert.equal(declined.bookingStatus, "declined");

  assert.equal(bookingFollowUpRecordSchema.safeParse(confirmedRecord()).success, true);
  assert.equal(bookingFollowUpRecordSchema.safeParse(confirmedRecord({
    commissionAmountHalalas: 12_555,
  })).success, false);
  assert.equal(bookingFollowUpRecordSchema.safeParse(confirmedRecord({
    commissionDueAt: "2026-08-20T12:29:59.999Z",
  })).success, false);
  assert.equal(bookingFollowUpRecordSchema.safeParse(confirmedRecord({
    commissionStatus: "paid",
    commissionPaidAt: null,
  })).success, false);
  assert.equal(bookingFollowUpRecordSchema.safeParse(confirmedRecord({
    commissionStatus: "pending",
    complianceStatus: "paused",
  })).success, false);
  assert.equal(bookingFollowUpRecordSchema.safeParse(confirmedRecord({
    commissionStatus: "overdue",
    complianceStatus: "paused",
  })).success, true);
  assert.equal(bookingFollowUpRecordSchema.safeParse(confirmedRecord({
    commissionStatus: "paid",
    complianceStatus: "released",
    commissionPaidAt: "2026-08-19T08:00:00.000Z",
  })).success, true);
  assert.equal(bookingFollowUpRecordSchema.safeParse(confirmedRecord({
    commissionReminderOffsetsSent: [3, 3],
  })).success, false);
});

test("observe-only confirmations retain facts without creating a commission obligation", () => {
  const observeOnly = {
    ...commonRecord,
    bookingStatus: "confirmed",
    commissionStatus: "not_applicable",
    complianceStatus: "clear",
    confirmationFacts: facts,
    confirmedAt,
    declinedAt: null,
    commissionAmountHalalas: null,
    commissionDueAt: null,
    commissionPaidAt: null,
    commissionReminderOffsetsSent: [],
  };
  assert.equal(bookingFollowUpRecordSchema.safeParse(observeOnly).success, true);

  assert.equal(bookingFollowUpRecordSchema.safeParse({
    ...observeOnly,
    commissionAmountHalalas: 12_556,
  }).success, false);
  assert.equal(bookingFollowUpRecordSchema.safeParse({
    ...observeOnly,
    commissionDueAt: calculateCommissionDueAt(confirmedAt),
  }).success, false);
  assert.equal(bookingFollowUpRecordSchema.safeParse({
    ...observeOnly,
    complianceStatus: "released",
  }).success, false);
});

test("paid and waived outcomes enforce payment and release invariants", () => {
  assert.equal(bookingFollowUpRecordSchema.safeParse(confirmedRecord({
    commissionStatus: "paid",
    complianceStatus: "released",
    commissionPaidAt: "2026-08-19T08:00:00.000Z",
  })).success, true);
  assert.equal(bookingFollowUpRecordSchema.safeParse(confirmedRecord({
    commissionStatus: "paid",
    complianceStatus: "released",
    commissionPaidAt: null,
  })).success, false);
  assert.equal(bookingFollowUpRecordSchema.safeParse(confirmedRecord({
    commissionStatus: "paid",
    complianceStatus: "paused",
    commissionPaidAt: "2026-08-19T08:00:00.000Z",
  })).success, false);

  assert.equal(bookingFollowUpRecordSchema.safeParse(confirmedRecord({
    commissionStatus: "waived",
    complianceStatus: "released",
    commissionPaidAt: null,
  })).success, true);
  assert.equal(bookingFollowUpRecordSchema.safeParse(confirmedRecord({
    commissionStatus: "waived",
    complianceStatus: "released",
    commissionPaidAt: "2026-08-19T08:00:00.000Z",
  })).success, false);
  assert.equal(bookingFollowUpRecordSchema.safeParse(confirmedRecord({
    commissionStatus: "waived",
    complianceStatus: "paused",
    commissionPaidAt: null,
  })).success, false);
});

test("public and admin DTO helpers do not expose the internal customer subject", () => {
  const record = bookingFollowUpRecordSchema.parse(confirmedRecord());
  const publicDto = toBookingPublicDto(record);
  const adminDto = toBookingAdminDto(record);

  assert.equal("customerSubject" in publicDto, false);
  assert.equal("commissionAmountHalalas" in publicDto, false);
  assert.equal("customerSubject" in adminDto, false);
  assert.equal(adminDto.commissionAmountHalalas, 12_556);
});
