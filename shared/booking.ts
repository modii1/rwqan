import { z } from "zod";
import { calendarMonthRange } from "./booking-calendar";

export const BOOKING_COMMISSION_BASIS_POINTS = 1_000 as const;
export const BASIS_POINTS_DENOMINATOR = 10_000 as const;
export const COMMISSION_PAYMENT_WINDOW_MS = 5 * 24 * 60 * 60 * 1_000;
export const COMMISSION_REMINDER_OFFSET_DAYS = [3, 4, 5] as const;
export const BOOKING_FREE_WORKFLOW_LIMIT_MAX = 1_000 as const;
/** Minute precision keeps follow-ups non-immediate while capping delay at five days. */
export const BOOKING_CUSTOMER_FOLLOW_UP_DELAY_MINUTES_MIN = 1 as const;
export const BOOKING_CUSTOMER_FOLLOW_UP_DELAY_MINUTES_MAX = 7_200 as const;
export const BOOKING_CUSTOMER_FOLLOW_UP_DELAY_MINUTES_DEFAULT = 1_440 as const;
/** Deprecated compatibility bounds for schema-v4 settings and cached admin clients. */
export const BOOKING_CUSTOMER_FOLLOW_UP_DELAY_HOURS_MIN = 1 as const;
export const BOOKING_CUSTOMER_FOLLOW_UP_DELAY_HOURS_MAX = 120 as const;
export const BOOKING_CUSTOMER_FOLLOW_UP_MESSAGE_LIMIT_DEFAULT = 3 as const;
export const BOOKING_CUSTOMER_RESPONSE_WINDOW_MINUTES =
  7 * 24 * 60;
export const BOOKING_CUSTOMER_FOLLOW_UP_LIMIT_SCOPES = [
  "customer",
  "property",
] as const;
export const BOOKING_CUSTOMER_FOLLOW_UP_LIMIT_SCOPE_DEFAULT =
  "customer" as const;
export const BOOKING_ADMIN_CUSTOMER_WHATSAPP_COOLDOWN_MINUTES_DEFAULT = 30 as const;
export const BOOKING_ADMIN_CUSTOMER_WHATSAPP_COOLDOWN_MINUTES_MAX =
  10_080 as const;
/** Deprecated compatibility constant for callers that still use the default. */
export const BOOKING_ADMIN_CUSTOMER_WHATSAPP_COOLDOWN_MS =
  BOOKING_ADMIN_CUSTOMER_WHATSAPP_COOLDOWN_MINUTES_DEFAULT * 60 * 1_000;
export const BOOKING_WHATSAPP_TEMPLATE_MAX_LENGTH = 2_000 as const;
export const BOOKING_WHATSAPP_TEMPLATE_SYNTAX_VERSION = 1 as const;
export const BOOKING_OPTIONAL_COMMISSION_REMINDER_DAYS = [3, 4] as const;
export const BOOKING_MANDATORY_COMMISSION_REMINDER_DAYS = [5] as const;

const bookingFreeWorkflowLimitSchema = z.number()
  .int()
  .min(0)
  .max(BOOKING_FREE_WORKFLOW_LIMIT_MAX);

export const bookingFreeWorkflowLimitsSchema = z.object({
  customerDailyLimit: bookingFreeWorkflowLimitSchema,
  freeOwnerDailyLimit: bookingFreeWorkflowLimitSchema,
  freePropertyContactDailyLimit: bookingFreeWorkflowLimitSchema,
}).strict();
export type BookingFreeWorkflowLimits = z.infer<typeof bookingFreeWorkflowLimitsSchema>;

export const bookingCustomerFollowUpMessageLimitSchema =
  bookingFreeWorkflowLimitSchema;

export const bookingCustomerFollowUpLimitScopeSchema = z.enum(
  BOOKING_CUSTOMER_FOLLOW_UP_LIMIT_SCOPES,
);
export type BookingCustomerFollowUpLimitScope = z.infer<
  typeof bookingCustomerFollowUpLimitScopeSchema
>;

export const bookingAdminCustomerWhatsAppCooldownMinutesSchema = z.number()
  .int()
  .min(0)
  .max(BOOKING_ADMIN_CUSTOMER_WHATSAPP_COOLDOWN_MINUTES_MAX);

export const bookingCustomerFollowUpDelayMinutesSchema = z.number()
  .int()
  .min(BOOKING_CUSTOMER_FOLLOW_UP_DELAY_MINUTES_MIN)
  .max(BOOKING_CUSTOMER_FOLLOW_UP_DELAY_MINUTES_MAX);

/** Deprecated input validator used only while migrating whole-hour settings. */
export const bookingCustomerFollowUpDelayHoursSchema = z.number()
  .int()
  .min(BOOKING_CUSTOMER_FOLLOW_UP_DELAY_HOURS_MIN)
  .max(BOOKING_CUSTOMER_FOLLOW_UP_DELAY_HOURS_MAX);

export function bookingCustomerFollowUpScheduleFitsResponseWindow(
  delayMinutes: number,
  messageLimit: number,
): boolean {
  return messageLimit === 0 ||
    delayMinutes * messageLimit < BOOKING_CUSTOMER_RESPONSE_WINDOW_MINUTES;
}

export const BOOKING_WHATSAPP_TEMPLATE_PLACEHOLDERS = {
  admin_customer_technical_support: [],
  customer_followup: ["propertyLabel", "followUpLink"],
  customer_final_reminder: [],
  owner_contact_limit_reached: [
    "propertyNumber",
    "dailyLimit",
    "renewalLink",
  ],
  owner_booking_facts: [
    "propertyName",
    "propertyNumber",
    "requestCode",
    "customerPhone",
    "timing",
    "bookingDate",
    "pricePaidSar",
  ],
  owner_booking_commission: [
    "propertyName",
    "propertyNumber",
    "requestCode",
    "customerPhone",
    "timing",
    "bookingDate",
    "pricePaidSar",
    "commissionPercent",
    "commissionAmountSar",
    "paymentWindowDays",
    "paymentLink",
  ],
  commission_reminder: [
    "reminderDay",
    "propertyName",
    "propertyNumber",
    "commissionAmountSar",
    "commissionDueAt",
    "paymentLink",
  ],
  property_paused: [
    "propertyName",
    "propertyNumber",
    "commissionAmountSar",
    "paymentLink",
  ],
  property_released_paid: ["propertyName", "propertyNumber"],
  property_released_waived: ["propertyName", "propertyNumber"],
  commission_dispute_rejected: [
    "propertyName",
    "propertyNumber",
    "commissionAmountSar",
    "commissionDueAt",
    "paymentLink",
  ],
} as const;

export type BookingWhatsAppTemplateKey =
  keyof typeof BOOKING_WHATSAPP_TEMPLATE_PLACEHOLDERS;

export const BOOKING_ADMIN_CUSTOMER_WHATSAPP_TEMPLATE_VARIANTS = [
  "technical_support",
  "customer_followup",
] as const;

export const bookingAdminCustomerWhatsAppTemplateVariantSchema = z.enum(
  BOOKING_ADMIN_CUSTOMER_WHATSAPP_TEMPLATE_VARIANTS,
);

export type BookingAdminCustomerWhatsAppTemplateVariant = z.infer<
  typeof bookingAdminCustomerWhatsAppTemplateVariantSchema
>;

export const DEFAULT_BOOKING_WHATSAPP_TEMPLATES = {
  admin_customer_technical_support:
    "مرحباً، معك الفريق التقني لمنصة روقان.",
  customer_followup: `هل تم الحجز بعد تواصلك مع {{propertyLabel}}؟

أكد النتيجة من الرابط التالي:
{{followUpLink}}`,
  customer_final_reminder: `مرحبًا عميلنا العزيز 👋

نأمل أن تكون تجربتك مع روقان كانت موفقة 🌿

هذه آخر متابعة منا، ونحب نعرف فقط:
هل تم الحجز من خلال منصة روقان؟

نشكرك على وقتك وتعاونك 🤍`,
  owner_contact_limit_reached: `تم الوصول إلى الحد اليومي لطلبات التواصل للعقار رقم {{propertyNumber}} ضمن الباقة المجانية ({{dailyLimit}} من {{dailyLimit}}).

قم بترقية الباقة لاستقبال طلبات تواصل غير محدودة:
{{renewalLink}}`,
  owner_booking_facts: `تم تسجيل حجز للعقار {{propertyName}} رقم {{propertyNumber}}

رقم الطلب: {{requestCode}}
رقم العميل: {{customerPhone}}
وقت الحجز: {{timing}}
تاريخ الحجز: {{bookingDate}}
المبلغ المدفوع: {{pricePaidSar}} ريال`,
  owner_booking_commission: `تم تسجيل حجز للعقار {{propertyName}} رقم {{propertyNumber}}

رقم الطلب: {{requestCode}}
رقم العميل: {{customerPhone}}
وقت الحجز: {{timing}}
تاريخ الحجز: {{bookingDate}}
المبلغ المدفوع: {{pricePaidSar}} ريال

عمولة روقان ({{commissionPercent}}%): {{commissionAmountSar}} ريال
مهلة السداد: {{paymentWindowDays}} أيام من وقت إرسال هذه الرسالة

رابط الدفع:
{{paymentLink}}`,
  commission_reminder: `تذكير اليوم {{reminderDay}}: عمولة حجز العقار {{propertyName}} رقم {{propertyNumber}} لم تُسدد بعد.

المبلغ المستحق: {{commissionAmountSar}} ريال
آخر موعد للسداد: {{commissionDueAt}}

رابط الدفع:
{{paymentLink}}`,
  property_paused: `انتهت مهلة سداد عمولة الحجز للعقار {{propertyName}} رقم {{propertyNumber}}.

سيتم إيقاف ظهور العقار إلى أن يتم سداد مبلغ {{commissionAmountSar}} ريال.

رابط الدفع:
{{paymentLink}}`,
  property_released_paid:
    "تم استلام عمولة حجز العقار {{propertyName}} رقم {{propertyNumber}} وإعادة إتاحة العقار.",
  property_released_waived:
    "تم قبول الاعتراض على عمولة حجز العقار {{propertyName}} رقم {{propertyNumber}} وإعادة إتاحة العقار.",
  commission_dispute_rejected: `تم رفض الاعتراض على عمولة حجز العقار {{propertyName}} رقم {{propertyNumber}} واستئناف تحصيل العمولة.

المبلغ المستحق: {{commissionAmountSar}} ريال
آخر موعد للسداد: {{commissionDueAt}}

رابط الدفع:
{{paymentLink}}`,
} as const;

const bookingWhatsAppPlaceholderPattern = /\{\{([a-z][A-Za-z0-9]*)\}\}/g;
const disallowedBookingWhatsAppControlPattern =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function bookingWhatsAppTemplateSchemaFor(
  key: BookingWhatsAppTemplateKey,
) {
  const required = BOOKING_WHATSAPP_TEMPLATE_PLACEHOLDERS[key] as readonly string[];
  const allowed = new Set(required);
  return z.string()
    .min(1)
    .max(BOOKING_WHATSAPP_TEMPLATE_MAX_LENGTH)
    .superRefine((template, context) => {
      if (!template.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "WhatsApp template cannot be blank",
        });
      }
      if (disallowedBookingWhatsAppControlPattern.test(template)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "WhatsApp template contains unsupported control characters",
        });
      }
      const placeholders = Array.from(
        template.matchAll(bookingWhatsAppPlaceholderPattern),
        (match) => match[1],
      );
      if (/[{}]/.test(template.replace(bookingWhatsAppPlaceholderPattern, ""))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "WhatsApp template contains malformed placeholder syntax",
        });
      }
      for (const placeholder of placeholders) {
        if (!allowed.has(placeholder)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Placeholder {{${placeholder}}} is not allowed for ${key}`,
          });
        }
      }
      for (const placeholder of required) {
        const occurrences = placeholders.filter((value) => value === placeholder).length;
        const occurrenceIsValid =
          key === "owner_contact_limit_reached" && placeholder === "dailyLimit"
            ? occurrences === 1 || occurrences === 2
            : occurrences === 1;
        if (!occurrenceIsValid) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              key === "owner_contact_limit_reached" && placeholder === "dailyLimit"
                ? `Placeholder {{${placeholder}}} must appear once or twice for ${key}`
                : `Placeholder {{${placeholder}}} must appear exactly once for ${key}`,
          });
        }
      }
    });
}

export const bookingWhatsAppTemplatesSchema = z.object({
  admin_customer_technical_support: bookingWhatsAppTemplateSchemaFor(
    "admin_customer_technical_support",
  ),
  customer_followup: bookingWhatsAppTemplateSchemaFor("customer_followup"),
  customer_final_reminder: bookingWhatsAppTemplateSchemaFor(
    "customer_final_reminder",
  ),
  owner_contact_limit_reached: bookingWhatsAppTemplateSchemaFor(
    "owner_contact_limit_reached",
  ),
  owner_booking_facts: bookingWhatsAppTemplateSchemaFor("owner_booking_facts"),
  owner_booking_commission: bookingWhatsAppTemplateSchemaFor(
    "owner_booking_commission",
  ),
  commission_reminder: bookingWhatsAppTemplateSchemaFor("commission_reminder"),
  property_paused: bookingWhatsAppTemplateSchemaFor("property_paused"),
  property_released_paid: bookingWhatsAppTemplateSchemaFor(
    "property_released_paid",
  ),
  property_released_waived: bookingWhatsAppTemplateSchemaFor(
    "property_released_waived",
  ),
  commission_dispute_rejected: bookingWhatsAppTemplateSchemaFor(
    "commission_dispute_rejected",
  ),
}).strict();

export type BookingWhatsAppTemplates = z.infer<
  typeof bookingWhatsAppTemplatesSchema
>;

export const bookingOptionalCommissionReminderDaysSchema = z.array(
  z.union([z.literal(3), z.literal(4)]),
)
  .max(BOOKING_OPTIONAL_COMMISSION_REMINDER_DAYS.length)
  .superRefine((days, context) => {
    if (new Set(days).size !== days.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Optional commission reminder days must be unique",
      });
    }
  })
  .transform((days) => [...days].sort((left, right) => left - right));

export type BookingOptionalCommissionReminderDay =
  typeof BOOKING_OPTIONAL_COMMISSION_REMINDER_DAYS[number];

export const bookingFreeWorkflowConfigurationSchema =
  bookingFreeWorkflowLimitsSchema.extend({
    customerFollowUpDelayMinutes: bookingCustomerFollowUpDelayMinutesSchema,
    customerFollowUpMessageLimit: bookingCustomerFollowUpMessageLimitSchema,
    customerFollowUpLimitScope: bookingCustomerFollowUpLimitScopeSchema.default(
      BOOKING_CUSTOMER_FOLLOW_UP_LIMIT_SCOPE_DEFAULT,
    ),
    adminCustomerWhatsAppCooldownMinutes:
      bookingAdminCustomerWhatsAppCooldownMinutesSchema,
    whatsappTemplates: bookingWhatsAppTemplatesSchema,
    optionalCommissionReminderDays:
      bookingOptionalCommissionReminderDaysSchema,
  }).strict();

export type BookingFreeWorkflowConfiguration = z.infer<
  typeof bookingFreeWorkflowConfigurationSchema
>;

const bookingFreeWorkflowSettingsCompatibleUpdateSchema =
  bookingFreeWorkflowLimitsSchema.extend({
    customerFollowUpDelayMinutes:
      bookingCustomerFollowUpDelayMinutesSchema.optional(),
    customerFollowUpDelayHours:
      bookingCustomerFollowUpDelayHoursSchema.optional(),
    customerFollowUpMessageLimit: bookingCustomerFollowUpMessageLimitSchema,
    customerFollowUpLimitScope:
      bookingCustomerFollowUpLimitScopeSchema.optional(),
    adminCustomerWhatsAppCooldownMinutes:
      bookingAdminCustomerWhatsAppCooldownMinutesSchema,
    whatsappTemplates: bookingWhatsAppTemplatesSchema,
    optionalCommissionReminderDays:
      bookingOptionalCommissionReminderDaysSchema,
  })
    .strict()
    .superRefine((settings, context) => {
      const minutes = settings.customerFollowUpDelayMinutes;
      const legacyHours = settings.customerFollowUpDelayHours;
      if (minutes === undefined && legacyHours === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Customer follow-up delay is required",
          path: ["customerFollowUpDelayMinutes"],
        });
      }
      if (
        minutes !== undefined &&
        legacyHours !== undefined &&
        minutes !== legacyHours * 60
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Customer follow-up delay fields conflict",
          path: ["customerFollowUpDelayMinutes"],
        });
      }
      const effectiveMinutes = minutes ??
        (legacyHours === undefined ? undefined : legacyHours * 60);
      if (
        effectiveMinutes !== undefined &&
        !bookingCustomerFollowUpScheduleFitsResponseWindow(
          effectiveMinutes,
          settings.customerFollowUpMessageLimit,
        )
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Customer follow-up schedule exceeds the response window",
          path: ["customerFollowUpMessageLimit"],
        });
      }
    })
    .transform((settings): BookingFreeWorkflowConfiguration => {
      const {
        customerFollowUpDelayHours,
        customerFollowUpDelayMinutes,
        ...configuration
      } = settings;
      return {
        ...configuration,
        customerFollowUpLimitScope:
          configuration.customerFollowUpLimitScope ??
          BOOKING_CUSTOMER_FOLLOW_UP_LIMIT_SCOPE_DEFAULT,
        customerFollowUpDelayMinutes:
          customerFollowUpDelayMinutes ?? customerFollowUpDelayHours! * 60,
      };
    });

export const bookingFreeWorkflowSettingsUpdateSchema = z.object({
  settings: bookingFreeWorkflowSettingsCompatibleUpdateSchema,
}).strict();

export type BookingFreeWorkflowSettings = BookingFreeWorkflowConfiguration & {
  updatedAt: string | null;
  updatedBy: "admin" | "environment";
  source: "firestore" | "environment";
};

type BookingWhatsAppTemplateValues = {
  [Key in BookingWhatsAppTemplateKey]: Record<
    typeof BOOKING_WHATSAPP_TEMPLATE_PLACEHOLDERS[Key][number],
    string | number
  >;
};

/** Plain-text replacement only: templates are never evaluated as code or HTML. */
export function renderBookingWhatsAppTemplate<Key extends BookingWhatsAppTemplateKey>(
  key: Key,
  rawTemplate: string,
  values: BookingWhatsAppTemplateValues[Key],
): string {
  const template = bookingWhatsAppTemplatesSchema.shape[key].parse(rawTemplate);
  return template.replace(
    bookingWhatsAppPlaceholderPattern,
    (_placeholder, name: string) => {
      if (!Object.prototype.hasOwnProperty.call(values, name)) {
        throw new RangeError(`Missing WhatsApp template value: ${name}`);
      }
      return String((values as Record<string, string | number>)[name]);
    },
  );
}

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
  "admin_customer_whatsapp",
  "admin_customer_whatsapp_customer_followup",
]);
export type BookingTokenPurpose = z.infer<typeof bookingTokenPurposeSchema>;

export const bookingDatePrecisionSchema = z.enum(["day", "month"]);
export type BookingDatePrecision = z.infer<typeof bookingDatePrecisionSchema>;

export const bookingCalendarSchema = z.enum(["gregorian", "hijri"]);
export type BookingCalendar = z.infer<typeof bookingCalendarSchema>;

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

const calendarMonthBookingDateSchema = z.object({
  value: z.string(),
  precision: z.literal("month"),
  calendar: bookingCalendarSchema,
  startDate: z.string().refine(isValidCalendarDay),
  endDate: z.string().refine(isValidCalendarDay),
}).strict().superRefine((value, context) => {
  const expected = calendarMonthRange(value.value, value.calendar);
  if (!expected) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["value"],
      message: "Invalid booking calendar month",
    });
    return;
  }
  if (value.startDate !== expected.startDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["startDate"],
      message: "Booking month start does not match the selected calendar month",
    });
  }
  if (value.endDate !== expected.endDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "Booking month end does not match the selected calendar month",
    });
  }
});

export const bookingDateSchema = z.union([
  dayBookingDateSchema,
  monthBookingDateSchema,
  calendarMonthBookingDateSchema,
]);
export type BookingDate = z.infer<typeof bookingDateSchema>;

export const pricePaidHalalasSchema = z.number()
  .int()
  .min(100)
  .max(100_000_000);

const bookingListedPriceKeys = [
  "weekday",
  "weekend",
  "overnight",
  "holidays",
  "special",
  "display",
] as const;

function listedPriceToHalalas(value: unknown): number | null {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/٫/g, ".")
    .replace(/[٬,]/g, "");
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const halalas = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return pricePaidHalalasSchema.safeParse(halalas).success ? halalas : null;
}

/** Stable, deduplicated SAR price choices captured from a property's listed prices. */
export function normalizeBookingListedPriceOptionsHalalas(prices: unknown): number[] {
  if (!prices || typeof prices !== "object" || Array.isArray(prices)) return [];
  const priceRecord = prices as Record<string, unknown>;
  return Array.from(new Set(
    bookingListedPriceKeys
      .map((key) => listedPriceToHalalas(priceRecord[key]))
      .filter((value): value is number => value !== null),
  )).sort((left, right) => left - right);
}

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
