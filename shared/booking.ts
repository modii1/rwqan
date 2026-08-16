import { z } from "zod";

export const BOOKING_COMMISSION_BASIS_POINTS = 1_000 as const;
export const BASIS_POINTS_DENOMINATOR = 10_000 as const;
export const COMMISSION_PAYMENT_WINDOW_MS = 5 * 24 * 60 * 60 * 1_000;
export const COMMISSION_REMINDER_OFFSET_DAYS = [3, 4, 5] as const;

export const bookingStatusSchema = z.enum([
  "awaiting_response",
  "declined",
  "confirmed",
]);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

export const commissionStatusSchema = z.enum([
  "not_applicable",
  "pending",
  "paid",
  "overdue",
  "waived",
]);
export type CommissionStatus = z.infer<typeof commissionStatusSchema>;

export const complianceStatusSchema = z.enum([
  "clear",
  "paused",
  "released",
]);
export type ComplianceStatus = z.infer<typeof complianceStatusSchema>;

export const bookingTimingSchema = z.enum([
  "midweek",
  "weekend",
  "other",
]);
export type BookingTiming = z.infer<typeof bookingTimingSchema>;

export const bookingTokenPurposeSchema = z.enum([
  "customer_response",
  "owner_payment",
]);
export type BookingTokenPurpose = z.infer<typeof bookingTokenPurposeSchema>;

export const bookingDatePrecisionSchema = z.enum(["day", "month"]);
export type BookingDatePrecision = z.infer<typeof bookingDatePrecisionSchema>;

const calendarDayPattern = /^\d{4}-\d{2}-\d{2}$/;
const calendarMonthPattern = /^\d{4}-\d{2}$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isValidCalendarMonth(value: string): boolean {
  if (!calendarMonthPattern.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

function isValidCalendarDay(value: string): boolean {
  if (!calendarDayPattern.test(value)) return false;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) return false;

  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
}

const dayBookingDateSchema = z.object({
  value: z.string().refine(isValidCalendarDay),
  precision: z.literal("day"),
}).strict();

const monthBookingDateSchema = z.object({
  value: z.string().refine(isValidCalendarMonth),
  precision: z.literal("month"),
}).strict();

export const bookingDateSchema = z.discriminatedUnion("precision", [
  dayBookingDateSchema,
  monthBookingDateSchema,
]);
export type BookingDate = z.infer<typeof bookingDateSchema>;

export const pricePaidHalalasSchema = z.number()
  .int()
  .min(100)
  .max(100_000_000);

const commissionCalculationInputSchema = z.number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

/** The three confirmed facts. Date precision is nested to keep three top-level facts. */
export const bookingConfirmationFactsSchema = z.object({
  timing: bookingTimingSchema,
  bookingDate: bookingDateSchema,
  pricePaidHalalas: pricePaidHalalasSchema,
}).strict();
export type BookingConfirmationFacts = z.infer<typeof bookingConfirmationFactsSchema>;

export const bookingDeclineInputSchema = z.object({
  booked: z.literal(false),
}).strict();

export const bookingConfirmInputSchema = z.object({
  booked: z.literal(true),
  facts: bookingConfirmationFactsSchema,
}).strict();

export const bookingResponseInputSchema = z.discriminatedUnion("booked", [
  bookingDeclineInputSchema,
  bookingConfirmInputSchema,
]);
export type BookingResponseInput = z.infer<typeof bookingResponseInputSchema>;

export type CommissionReminderOffsetDays = typeof COMMISSION_REMINDER_OFFSET_DAYS[number];

export const commissionReminderOffsetSchema = z.union([
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const commissionReminderOffsetsSentSchema = z.array(commissionReminderOffsetSchema)
  .max(COMMISSION_REMINDER_OFFSET_DAYS.length)
  .superRefine((offsets, context) => {
    if (new Set(offsets).size !== offsets.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Commission reminder offsets must be unique",
      });
    }
  });

const boundedIdentifierSchema = z.string().trim().min(1).max(160);
const isoInstantSchema = z.string().datetime({ offset: true });
const nullableIsoInstantSchema = isoInstantSchema.nullable();
const nullableFactsSchema = bookingConfirmationFactsSchema.nullable();

const bookingRecordBase = {
  id: boundedIdentifierSchema,
  contactRequestId: boundedIdentifierSchema,
  requestCode: boundedIdentifierSchema,
  propertyNumber: boundedIdentifierSchema,
  /** Stable, opaque server-side customer subject. Never expose it in public DTOs. */
  customerSubject: boundedIdentifierSchema,
  followUpDueAt: isoInstantSchema,
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
};

const awaitingBookingRecordSchema = z.object({
  ...bookingRecordBase,
  bookingStatus: z.literal("awaiting_response"),
  commissionStatus: z.literal("not_applicable"),
  complianceStatus: z.literal("clear"),
  confirmationFacts: z.null(),
  confirmedAt: z.null(),
  declinedAt: z.null(),
  commissionAmountHalalas: z.null(),
  commissionDueAt: z.null(),
  commissionNoticeSentAt: z.null().optional(),
  commissionPaidAt: z.null(),
  commissionReminderOffsetsSent: z.array(commissionReminderOffsetSchema).length(0),
}).strict();

const declinedBookingRecordSchema = z.object({
  ...bookingRecordBase,
  bookingStatus: z.literal("declined"),
  commissionStatus: z.literal("not_applicable"),
  complianceStatus: z.literal("clear"),
  confirmationFacts: z.null(),
  confirmedAt: z.null(),
  declinedAt: isoInstantSchema,
  commissionAmountHalalas: z.null(),
  commissionDueAt: z.null(),
  commissionNoticeSentAt: z.null().optional(),
  commissionPaidAt: z.null(),
  commissionReminderOffsetsSent: z.array(commissionReminderOffsetSchema).length(0),
}).strict();

const confirmedBookingWithoutCommissionSchema = z.object({
  ...bookingRecordBase,
  bookingStatus: z.literal("confirmed"),
  commissionStatus: z.literal("not_applicable"),
  complianceStatus: z.literal("clear"),
  confirmationFacts: bookingConfirmationFactsSchema,
  confirmedAt: isoInstantSchema,
  declinedAt: z.null(),
  commissionAmountHalalas: z.null(),
  commissionDueAt: z.null(),
  commissionNoticeSentAt: z.null().optional(),
  commissionPaidAt: z.null(),
  commissionReminderOffsetsSent: z.array(commissionReminderOffsetSchema).length(0),
}).strict();

const applicableCommissionStatusSchema = z.enum([
  "pending",
  "paid",
  "overdue",
  "waived",
]);

const confirmedBookingWithCommissionSchema = z.object({
  ...bookingRecordBase,
  bookingStatus: z.literal("confirmed"),
  commissionStatus: applicableCommissionStatusSchema,
  complianceStatus: complianceStatusSchema,
  confirmationFacts: bookingConfirmationFactsSchema,
  confirmedAt: isoInstantSchema,
  declinedAt: z.null(),
  commissionAmountHalalas: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  commissionDueAt: isoInstantSchema,
  commissionNoticeSentAt: nullableIsoInstantSchema.optional(),
  commissionPaidAt: nullableIsoInstantSchema,
  commissionReminderOffsetsSent: commissionReminderOffsetsSentSchema,
}).strict();

const confirmedBookingRecordSchema = z.union([
  confirmedBookingWithoutCommissionSchema,
  confirmedBookingWithCommissionSchema,
]);

export const bookingFollowUpRecordSchema = z.union([
  awaitingBookingRecordSchema,
  declinedBookingRecordSchema,
  confirmedBookingRecordSchema,
]).superRefine((record, context) => {
  if (
    record.bookingStatus !== "confirmed" ||
    record.commissionStatus === "not_applicable"
  ) return;

  const expectedCommission = calculateBookingCommissionHalalas(
    record.confirmationFacts.pricePaidHalalas,
  );
  if (record.commissionAmountHalalas !== expectedCommission) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["commissionAmountHalalas"],
      message: "Commission amount must equal ten percent of the confirmed price",
    });
  }

  const commissionAnchor = record.commissionNoticeSentAt || record.confirmedAt;
  const expectedDueAt = Date.parse(commissionAnchor) + COMMISSION_PAYMENT_WINDOW_MS;
  if (Date.parse(record.commissionDueAt) !== expectedDueAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["commissionDueAt"],
      message: "Commission due time must be exactly five days after confirmation",
    });
  }
  if (
    record.commissionNoticeSentAt &&
    Date.parse(record.commissionNoticeSentAt) < Date.parse(record.confirmedAt)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["commissionNoticeSentAt"],
      message: "Commission notice cannot precede booking confirmation",
    });
  }

  if (record.commissionStatus === "paid" && !record.commissionPaidAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["commissionPaidAt"],
      message: "Paid commission requires a payment timestamp",
    });
  }
  if (record.commissionStatus !== "paid" && record.commissionPaidAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["commissionPaidAt"],
      message: "Unpaid commission cannot have a payment timestamp",
    });
  }
  if (record.complianceStatus === "paused" && record.commissionStatus !== "overdue") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["complianceStatus"],
      message: "Paused compliance requires an overdue commission",
    });
  }
  if (
    record.complianceStatus === "released" &&
    record.commissionStatus !== "paid" &&
    record.commissionStatus !== "waived"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["complianceStatus"],
      message: "Released compliance requires a paid or waived commission",
    });
  }
});
export type BookingFollowUpRecord = z.infer<typeof bookingFollowUpRecordSchema>;

export interface CommissionReminderScheduleEntry {
  offsetDays: CommissionReminderOffsetDays;
  scheduledAt: string;
}

function parseInstant(value: Date | string | number): number {
  const timestamp = value instanceof Date
    ? value.getTime()
    : typeof value === "number"
      ? value
      : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new RangeError("Invalid instant");
  return timestamp;
}

/** Calculates exactly 10%, rounding half a halala upward to the nearest halala. */
export function calculateBookingCommissionHalalas(pricePaidHalalas: number): number {
  const price = commissionCalculationInputSchema.parse(pricePaidHalalas);
  const wholeHalalas = Math.floor(price / 10);
  return wholeHalalas + (price % 10 >= 5 ? 1 : 0);
}

export function calculateCommissionDueAt(confirmedAt: Date | string | number): string {
  return new Date(parseInstant(confirmedAt) + COMMISSION_PAYMENT_WINDOW_MS).toISOString();
}

export function calculateCommissionReminderSchedule(
  confirmedAt: Date | string | number,
): CommissionReminderScheduleEntry[] {
  const confirmedAtMs = parseInstant(confirmedAt);
  return COMMISSION_REMINDER_OFFSET_DAYS.map((offsetDays) => ({
    offsetDays,
    scheduledAt: new Date(confirmedAtMs + offsetDays * 24 * 60 * 60 * 1_000).toISOString(),
  }));
}

export interface BookingPublicDto {
  id: string;
  propertyNumber: string;
  bookingStatus: BookingStatus;
  confirmationFacts: BookingConfirmationFacts | null;
  followUpDueAt: string;
  confirmedAt: string | null;
  declinedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, Extract<keyof T, K>>
  : never;

/** Operational DTO excludes the stable internal customer subject. */
export type BookingAdminDto = DistributiveOmit<BookingFollowUpRecord, "customerSubject">;

export function toBookingPublicDto(record: BookingFollowUpRecord): BookingPublicDto {
  return {
    id: record.id,
    propertyNumber: record.propertyNumber,
    bookingStatus: record.bookingStatus,
    confirmationFacts: record.confirmationFacts,
    followUpDueAt: record.followUpDueAt,
    confirmedAt: record.confirmedAt,
    declinedAt: record.declinedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function toBookingAdminDto(record: BookingFollowUpRecord): BookingAdminDto {
  const { customerSubject: _customerSubject, ...dto } = record;
  return dto as BookingAdminDto;
}

/** Useful for constructing confirmed records without duplicating financial rules. */
export function buildConfirmedBookingFinancials(
  facts: BookingConfirmationFacts,
  confirmedAt: Date | string | number,
) {
  const parsedFacts = bookingConfirmationFactsSchema.parse(facts);
  return {
    confirmationFacts: parsedFacts,
    commissionAmountHalalas: calculateBookingCommissionHalalas(parsedFacts.pricePaidHalalas),
    commissionDueAt: calculateCommissionDueAt(confirmedAt),
    commissionReminderSchedule: calculateCommissionReminderSchedule(confirmedAt),
  } as const;
}

// Exported for DTO composition without allowing a fourth confirmation fact.
export const nullableBookingConfirmationFactsSchema = nullableFactsSchema;
