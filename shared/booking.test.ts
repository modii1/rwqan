import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMISSION_PAYMENT_WINDOW_MS,
  COMMISSION_REMINDER_OFFSET_DAYS,
  bookingConfirmationFactsSchema,
  bookingDateSchema,
  bookingFollowUpRecordSchema,
  bookingResponseInputSchema,
  bookingStatusSchema,
  buildConfirmedBookingFinancials,
  calculateBookingCommissionHalalas,
  calculateCommissionDueAt,
  calculateCommissionReminderSchedule,
  commissionStatusSchema,
  complianceStatusSchema,
  normalizeBookingListedPriceOptionsHalalas,
  toBookingAdminDto,
  toBookingPublicDto,
  type BookingConfirmationFacts,
} from "./booking";

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
