import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  BOOKING_ADMIN_CUSTOMER_WHATSAPP_COOLDOWN_MINUTES_DEFAULT,
  BOOKING_CUSTOMER_FOLLOW_UP_DELAY_HOURS_MAX,
  BOOKING_CUSTOMER_FOLLOW_UP_DELAY_HOURS_MIN,
  BOOKING_CUSTOMER_FOLLOW_UP_DELAY_MINUTES_MAX,
  BOOKING_CUSTOMER_FOLLOW_UP_DELAY_MINUTES_MIN,
  BOOKING_MANDATORY_COMMISSION_REMINDER_DAYS,
  BOOKING_OPTIONAL_COMMISSION_REMINDER_DAYS,
  BOOKING_WHATSAPP_TEMPLATE_MAX_LENGTH,
  BOOKING_WHATSAPP_TEMPLATE_SYNTAX_VERSION,
  COMMISSION_PAYMENT_WINDOW_MS,
  DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
  bookingAdminCustomerWhatsAppTemplateVariantSchema,
  bookingCalendarSchema,
  bookingConfirmationFactsSchema,
  bookingDateSchema,
  bookingFreeWorkflowSettingsUpdateSchema,
  normalizeBookingListedPriceOptionsHalalas,
  renderBookingWhatsAppTemplate,
  type BookingAdminCustomerWhatsAppTemplateVariant,
  type BookingConfirmationFacts,
  type BookingCustomerFollowUpLimitScope,
  type BookingFreeWorkflowSettings,
  type BookingTokenPurpose,
  type BookingWhatsAppTemplates,
} from "../../shared/booking";
import {
  calendarDateFromCanonicalDay,
  calendarMonthRange,
} from "../../shared/booking-calendar";
import { maskContactPhone } from "./ContactIdentityService";
import {
  BookingTokenError,
  BookingTokenService,
} from "./BookingTokenService";
import {
  adminCustomerWhatsAppTemplateVariantsForBooking,
  bookingCommissionStore,
  buildInitialBookingWorkflow,
  BOOKING_CUSTOMER_RESPONSE_WINDOW_MS,
  BookingWorkflowError,
  type InitialBookingWorkflow,
} from "./BookingCommissionStore";
import {
  createCustomerBookingShortCode,
  getBookingShortLinkService,
  type BookingShortLinkService,
} from "./BookingShortLinkService";
import type {
  BookingAdminNotificationJob,
  BookingAdminPaymentAttempt,
  BookingAdminRow,
  BookingCommissionPaymentAttempt,
  BookingFollowUpDocument,
  BookingNotificationJob,
  BookingPublicRow,
} from "./BookingCommissionTypes";
import { firebaseService } from "../firebaseService";
import {
  normalizeSaudiMobilePhone,
  normalizeWhatsAppDestination,
} from "../../shared/phone";
import { notificationService } from "./NotificationService";
import {
  PaymobIntentionError,
  paymobService,
} from "../integrations/paymob";
import {
  BookingCommissionReceiptError,
  removeBookingCommissionReceipt,
  storeBookingCommissionReceipt,
  type StoredBookingCommissionReceipt,
} from "./BookingCommissionReceiptService";

export const BOOKING_CUSTOMER_SESSION_COOKIE = "rwqan_booking_customer_session";
export const BOOKING_CUSTOMER_TOKEN_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const BOOKING_OWNER_TOKEN_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
export const BOOKING_ADMIN_CUSTOMER_WHATSAPP_TOKEN_MAX_AGE_MS = 2 * 60 * 1000;
export const BOOKING_ADMIN_CUSTOMER_WHATSAPP_MESSAGE =
  DEFAULT_BOOKING_WHATSAPP_TEMPLATES.admin_customer_technical_support;

function isUsableBookingCommissionBankAccount(account: unknown): boolean {
  if (!account || typeof account !== "object") return false;
  const value = account as Record<string, unknown>;
  const iban = String(value.iban || "").replace(/\s+/g, "").toUpperCase();
  return value.isActive === true &&
    Boolean(String(value.bankName || "").trim()) &&
    Boolean(String(value.beneficiaryName || "").trim()) &&
    /^SA\d{22}$/.test(iban);
}

export const bookingDecisionSchema = z.object({
  booked: z.boolean(),
}).strict();

export const bookingQuestionnaireRouteSchema = z.object({
  timing: z.enum(["midweek", "weekend", "other"]),
  bookingDate: z.string(),
  bookingDatePrecision: z.enum(["day", "month"]),
  bookingDateCalendar: bookingCalendarSchema.optional(),
  pricePaidSar: z.union([z.string(), z.number()]),
}).strict().superRefine((input, context) => {
  if (
    input.bookingDatePrecision === "day"
    && input.bookingDateCalendar === "hijri"
    && !calendarDateFromCanonicalDay(input.bookingDate, "hijri")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bookingDate"],
      message: "Booking day is outside the supported Umm al-Qura range",
    });
  }
});

export function normalizeQuestionnaireBookingDate(input: Pick<
  z.infer<typeof bookingQuestionnaireRouteSchema>,
  "bookingDate" | "bookingDatePrecision" | "bookingDateCalendar"
>): BookingConfirmationFacts["bookingDate"] {
  if (input.bookingDatePrecision !== "month" || !input.bookingDateCalendar) {
    const bookingDate = bookingDateSchema.parse({
      value: input.bookingDate,
      precision: input.bookingDatePrecision,
    });
    if (
      input.bookingDatePrecision === "day"
      && input.bookingDateCalendar === "hijri"
      && !calendarDateFromCanonicalDay(input.bookingDate, "hijri")
    ) {
      throw new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: ["bookingDate"],
        message: "Booking day is outside the supported Umm al-Qura range",
      }]);
    }
    return bookingDate;
  }
  const range = calendarMonthRange(input.bookingDate, input.bookingDateCalendar);
  return bookingDateSchema.parse({
    value: input.bookingDate,
    precision: "month",
    calendar: input.bookingDateCalendar,
    startDate: range?.startDate || "",
    endDate: range?.endDate || "",
  });
}

export const bookingCheckoutSchema = z.object({
  paymentMethod: z.enum(["cards", "applepay"]),
}).strict();

export const bookingDisputeSchema = z.object({
  reason: z.string().trim().min(5).max(500),
}).strict();

export const bookingAdminDisputeResolutionSchema = z.object({
  resolution: z.enum(["resume_collection", "cancel_commission"]),
}).strict();

export const bookingAdminReversalResolutionSchema = z.object({
  attemptId: z.string().trim().min(1).max(160),
  reversalTransactionId: z.string().trim().min(1).max(160),
  resolution: z.enum(["resume_collection", "keep_paid"]),
}).strict();

export const bookingAdminBankTransferResolutionSchema = z.object({
  attemptId: z.string().trim().min(1).max(160),
  resolution: z.enum(["approve", "reject"]),
}).strict();

export const bookingAdminNotificationResendSchema = z.object({
  sourceJobId: z.string().trim().min(1).max(240),
  idempotencyKey: z.string()
    .trim()
    .min(16)
    .max(160)
    .regex(/^[A-Za-z0-9_-]+$/),
}).strict();

export const bookingAdminCustomerWhatsAppHandoffSchema = z.object({
  templateVariant:
    bookingAdminCustomerWhatsAppTemplateVariantSchema
      .default("technical_support"),
}).strict();

const ADMIN_CUSTOMER_WHATSAPP_TOKEN_PURPOSE = {
  technical_support: "admin_customer_whatsapp",
  customer_followup: "admin_customer_whatsapp_customer_followup",
} as const satisfies Record<
  BookingAdminCustomerWhatsAppTemplateVariant,
  BookingTokenPurpose
>;

export type BookingCommissionReceiptPersistence = {
  store(input: {
    bookingId: string;
    attemptId: string;
    file: Express.Multer.File;
  }): Promise<StoredBookingCommissionReceipt>;
  remove(objectKey: string): Promise<boolean>;
};

const defaultBookingCommissionReceiptPersistence:
BookingCommissionReceiptPersistence = {
  store: (input) => storeBookingCommissionReceipt(input),
  remove: (objectKey) => removeBookingCommissionReceipt(objectKey),
};

function bookingSecret(): string {
  const secret = process.env.SESSION_SECRET || "";
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must be at least 32 bytes for booking workflows");
  }
  return secret;
}

function tokenService(): BookingTokenService {
  return new BookingTokenService({ secret: bookingSecret() });
}

function parseSarToHalalas(value: string | number): number {
  const normalized = String(value)
    .trim()
    .replace(/,/g, "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(normalized)) {
    throw new BookingWorkflowError("INVALID_BOOKING_PRICE", "Invalid booking price", 400);
  }
  const [whole, fraction = ""] = normalized.split(".");
  const halalas = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(halalas) || halalas <= 0) {
    throw new BookingWorkflowError("INVALID_BOOKING_PRICE", "Invalid booking price", 400);
  }
  return halalas;
}

function questionnaire(document: BookingFollowUpDocument) {
  if (!document.confirmationFacts) return null;
  const bookingDate = document.confirmationFacts.bookingDate;
  return {
    timing: document.confirmationFacts.timing,
    bookingDate: bookingDate.value,
    bookingDatePrecision: bookingDate.precision,
    ...(
      bookingDate.precision === "month" && "calendar" in bookingDate
        ? {
            bookingDateCalendar: bookingDate.calendar,
            bookingDateStart: bookingDate.startDate,
            bookingDateEnd: bookingDate.endDate,
          }
        : {}
    ),
    pricePaidHalalas: document.confirmationFacts.pricePaidHalalas,
  };
}

function isUnansweredBookingExpired(
  booking: Pick<BookingFollowUpDocument, "bookingStatus" | "createdAt">,
  nowMs = Date.now(),
): boolean {
  const createdAt = Date.parse(booking.createdAt);
  return booking.bookingStatus === "awaiting_response" &&
    (!Number.isFinite(createdAt) ||
      nowMs >= createdAt + BOOKING_CUSTOMER_RESPONSE_WINDOW_MS);
}

function summarizeNotifications(jobs: BookingNotificationJob[]) {
  return jobs.reduce((summary, job) => {
    if (job.status === "sent") summary.sent++;
    else if (job.status === "failed") summary.failed++;
    else if (job.status === "suppressed_quota") summary.suppressed++;
    else if (job.status !== "cancelled") summary.pending++;
    return summary;
  }, { sent: 0, failed: 0, pending: 0, suppressed: 0 });
}

function publicBaseUrlHealth(): {
  publicBaseUrlConfigured: boolean;
  publicBaseUrlValid: boolean;
} {
  const configured = String(
    process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "",
  ).trim();
  if (!configured) {
    return { publicBaseUrlConfigured: false, publicBaseUrlValid: false };
  }
  try {
    const parsed = new URL(configured);
    return {
      publicBaseUrlConfigured: true,
      publicBaseUrlValid:
        (
          parsed.protocol === "https:" ||
          (process.env.NODE_ENV !== "production" && parsed.protocol === "http:")
        ) &&
        Boolean(parsed.hostname) &&
        !parsed.username &&
        !parsed.password,
    };
  } catch {
    return { publicBaseUrlConfigured: true, publicBaseUrlValid: false };
  }
}

function bookingPublicBaseUrl(): string {
  const configured = String(
    process.env.PUBLIC_BASE_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      "https://rwqan.sa",
  ).trim();
  try {
    const parsed = new URL(configured);
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      return "https://rwqan.sa";
    }
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) return "https://rwqan.sa";
    return parsed.origin;
  } catch {
    return "https://rwqan.sa";
  }
}

function adminFreeWorkflowSettingsResponse(
  settings: BookingFreeWorkflowSettings,
) {
  const publicUrlHealth = publicBaseUrlHealth();
  return {
    settings: {
      ...settings,
      /**
       * Deprecated response alias for admin tabs loaded before schema v5.
       * A fractional value intentionally fails the old whole-hour UI validator,
       * preventing that cached UI from overwriting a minute-precision setting.
       */
      customerFollowUpDelayHours: settings.customerFollowUpDelayMinutes / 60,
    },
    fixedPolicy: {
      customerFollowUpDelayMinMinutes:
        BOOKING_CUSTOMER_FOLLOW_UP_DELAY_MINUTES_MIN,
      customerFollowUpDelayMaxMinutes:
        BOOKING_CUSTOMER_FOLLOW_UP_DELAY_MINUTES_MAX,
      /** Deprecated response aliases for admin tabs loaded before schema v5. */
      customerFollowUpDelayMinHours:
        BOOKING_CUSTOMER_FOLLOW_UP_DELAY_HOURS_MIN,
      customerFollowUpDelayMaxHours:
        BOOKING_CUSTOMER_FOLLOW_UP_DELAY_HOURS_MAX,
      commissionPaymentWindowDays:
        COMMISSION_PAYMENT_WINDOW_MS / (24 * 60 * 60 * 1_000),
      mandatoryCommissionReminderDays: [
        ...BOOKING_MANDATORY_COMMISSION_REMINDER_DAYS,
      ],
      allowedOptionalCommissionReminderDays: [
        ...BOOKING_OPTIONAL_COMMISSION_REMINDER_DAYS,
      ],
      templateSyntaxVersion: BOOKING_WHATSAPP_TEMPLATE_SYNTAX_VERSION,
      templateMaxLength: BOOKING_WHATSAPP_TEMPLATE_MAX_LENGTH,
    },
    operationalHealth: {
      whatsappProviderConfigured:
        Boolean(String(process.env.ENJAZATIK_URL || "").trim()) &&
        Boolean(String(process.env.ENJAZATIK_TOKEN || "").trim()),
      workerSecretConfigured:
        Buffer.byteLength(
          String(process.env.BOOKING_WORKER_SECRET || ""),
          "utf8",
        ) >= 32,
      ...publicUrlHealth,
    },
  };
}

function adminNotificationJob(
  job: BookingNotificationJob,
): BookingAdminNotificationJob {
  const {
    recipientPhone: _recipientPhone,
    recipientQuotaKey: _recipientQuotaKey,
    leaseToken: _leaseToken,
    ...safeJob
  } = job;
  return safeJob;
}

function adminPaymentAttempt(
  attempt: BookingCommissionPaymentAttempt,
): BookingAdminPaymentAttempt {
  const {
    checkoutUrl: _checkoutUrl,
    receiptObjectKey: _receiptObjectKey,
    ...safeAttempt
  } = attempt;
  return safeAttempt;
}

function publicRow(
  booking: BookingFollowUpDocument,
): BookingPublicRow {
  const responseExpired = isUnansweredBookingExpired(booking);
  return {
    id: booking.id,
    requestCode: booking.requestCode,
    propertyNumber: booking.propertyNumber,
    propertyName: booking.propertyName,
    listedPriceOptionsHalalas: booking.listedPriceOptionsHalalas || [],
    contactAt: booking.createdAt,
    bookingStatus: responseExpired
      ? "expired"
      : booking.bookingDecision === "yes" && booking.bookingStatus === "awaiting_response"
        ? "questionnaire_pending"
        : booking.bookingStatus,
    questionnaire: questionnaire(booking),
    answeredAt: booking.confirmedAt || booking.declinedAt,
  };
}

function adminRow(
  booking: BookingFollowUpDocument,
  jobs: BookingNotificationJob[],
  attempts: BookingCommissionPaymentAttempt[],
  customerWhatsAppLastOpenedAt: string | null,
  now = new Date(),
  adminCustomerWhatsAppCooldownMinutes: number =
    BOOKING_ADMIN_CUSTOMER_WHATSAPP_COOLDOWN_MINUTES_DEFAULT,
): BookingAdminRow & {
  questionnaire: ReturnType<typeof questionnaire>;
  dueAt: string | null;
  contactAt: string;
  timeline: BookingFollowUpDocument["events"];
} {
  const {
    customerSubject: _customerSubject,
    customerPhone: _customerPhone,
    ownerPhone: _ownerPhone,
    adminCustomerWhatsAppLastOpenedAt: _adminCustomerWhatsAppLastOpenedAt,
    enforcementLeaseToken: _enforcementLeaseToken,
    enforcementLeaseExpiresAt: _enforcementLeaseExpiresAt,
    ...safeBooking
  } = booking;
  const orderedJobs = [...jobs].sort((left, right) =>
    Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const orderedAttempts = [...attempts].sort((left, right) =>
    Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  const selectedAttempt = selectAdminPaymentAttempt(booking, orderedAttempts);
  const responseExpired = isUnansweredBookingExpired(booking, now.getTime());
  const createdAtMs = Date.parse(booking.createdAt);
  const expiryAt = Number.isFinite(createdAtMs)
    ? new Date(createdAtMs + BOOKING_CUSTOMER_RESPONSE_WINDOW_MS).toISOString()
    : booking.updatedAt;
  const timeline = responseExpired &&
      !booking.events.some((event) => event.type === "customer_followup_expired")
    ? [...booking.events, {
        type: "customer_followup_expired" as const,
        at: expiryAt,
        detail: "customer_response_expired",
      }]
    : booking.events;
  return {
    ...safeBooking,
    bookingStatus: responseExpired ? "expired" as const : safeBooking.bookingStatus,
    customerPhoneMasked: maskContactPhone(booking.customerPhone),
    customerWhatsAppNextAllowedAt: customerWhatsAppLastOpenedAt
      && adminCustomerWhatsAppCooldownMinutes > 0
      ? new Date(
          Date.parse(customerWhatsAppLastOpenedAt) +
            adminCustomerWhatsAppCooldownMinutes * 60 * 1_000,
        ).toISOString()
      : null,
    adminCustomerWhatsAppTemplateVariants:
      adminCustomerWhatsAppTemplateVariantsForBooking(booking, now),
    questionnaire: questionnaire(booking),
    dueAt: booking.commissionDueAt,
    contactAt: booking.createdAt,
    notificationSummary: summarizeNotifications(jobs),
    notificationJobs: orderedJobs.map(adminNotificationJob),
    paymentAttempt: selectedAttempt
      ? adminPaymentAttempt(selectedAttempt)
      : null,
    paymentAttempts: orderedAttempts.map(adminPaymentAttempt),
    timeline,
  };
}

export function selectAdminPaymentAttempt(
  booking: Pick<BookingFollowUpDocument, "id" | "activeAttemptId" | "paidAttemptId">,
  attempts: BookingCommissionPaymentAttempt[],
): BookingCommissionPaymentAttempt | null {
  const bookingAttempts = attempts
    .filter((attempt) => attempt.bookingId === booking.id)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  const financialReviewAttempt = bookingAttempts.find((attempt) =>
    attempt.status === "duplicate_paid" ||
    attempt.status === "review_required" ||
    attempt.status === "pending_review" ||
    attempt.bankReviewDecision === "refund_review" ||
    Boolean(attempt.reversalStatus && !attempt.reversalResolution));
  if (financialReviewAttempt) return financialReviewAttempt;
  return bookingAttempts.find((attempt) => attempt.id === booking.activeAttemptId) ||
    bookingAttempts.find((attempt) => attempt.id === booking.paidAttemptId) ||
    bookingAttempts[0] ||
    null;
}

export class BookingCommissionService {
  constructor(
    private readonly adminCustomerShortLinkService?: Pick<
      BookingShortLinkService,
      "ensureCustomerResponseLink"
    >,
  ) {}

  async isFollowUpEnabled(): Promise<boolean> {
    return firebaseService.getFeatureFlag("FEATURE_BOOKING_FOLLOWUP");
  }

  async isCommissionEnforcementEnabled(): Promise<boolean> {
    return firebaseService.getFeatureFlag("FEATURE_BOOKING_COMMISSION_ENFORCEMENT");
  }

  createCustomerSubject(customerPhone: string): string {
    const normalizedPhone = String(customerPhone || "").replace(/\D/g, "");
    if (normalizedPhone.length < 9 || normalizedPhone.length > 15) {
      throw new BookingWorkflowError(
        "INVALID_CUSTOMER_PHONE",
        "Invalid customer phone",
        400,
      );
    }
    return createHmac("sha256", bookingSecret())
      .update(`booking-customer-phone:${normalizedPhone}`)
      .digest("hex");
  }

  buildContactWorkflow(options: {
    requestCode: string;
    propertyNumber: string;
    propertyName: string;
    ownerPhone: string;
    customerPhone: string;
    isFreeProperty: boolean;
    customerFollowUpDelayMinutes: number;
    customerFollowUpMessageLimit: number;
    customerFollowUpLimitScope: BookingCustomerFollowUpLimitScope;
    freePropertyContactDailyLimit?: number;
    propertyPrices?: unknown;
    now?: Date;
  }): InitialBookingWorkflow {
    const { propertyPrices, ...workflowOptions } = options;
    return buildInitialBookingWorkflow({
      ...workflowOptions,
      listedPriceOptionsHalalas:
        normalizeBookingListedPriceOptionsHalalas(propertyPrices),
      customerSubject: this.createCustomerSubject(options.customerPhone),
    });
  }

  issueCustomerResponseToken(booking: BookingFollowUpDocument): string {
    return tokenService().issue({
      bookingId: booking.id,
      purpose: "customer_response",
      expiresAt: Date.parse(booking.createdAt) + BOOKING_CUSTOMER_TOKEN_MAX_AGE_MS,
    });
  }

  issueOwnerPaymentToken(booking: BookingFollowUpDocument): string {
    const anchor = booking.commissionDueAt || booking.createdAt;
    return tokenService().issue({
      bookingId: booking.id,
      purpose: "owner_payment",
      expiresAt: Date.parse(anchor) + BOOKING_OWNER_TOKEN_MAX_AGE_MS,
    });
  }

  verifyCustomerToken(token: string) {
    return tokenService().verify(token, "customer_response");
  }

  verifyOwnerToken(token: string) {
    return tokenService().verify(token, "owner_payment");
  }

  async getCustomerFollowUp(token: string) {
    const verified = this.verifyCustomerToken(token);
    const booking = await bookingCommissionStore.markCustomerOpened(verified.bookingId);
    return {
      id: booking.id,
      propertyNumber: booking.propertyNumber,
      propertyName: booking.propertyName,
      listedPriceOptionsHalalas: booking.listedPriceOptionsHalalas || [],
      bookingStatus: booking.bookingDecision === "yes" && booking.bookingStatus === "awaiting_response"
        ? "questionnaire_pending"
        : booking.bookingStatus,
      questionnaire: questionnaire(booking),
      answeredAt: booking.confirmedAt || booking.declinedAt,
    };
  }

  async submitDecision(token: string, booked: boolean) {
    const verified = this.verifyCustomerToken(token);
    const booking = booked
      ? await bookingCommissionStore.startQuestionnaire(verified.bookingId)
      : await bookingCommissionStore.declineBooking(verified.bookingId);
    return {
      id: booking.id,
      propertyNumber: booking.propertyNumber,
      propertyName: booking.propertyName,
      listedPriceOptionsHalalas: booking.listedPriceOptionsHalalas || [],
      bookingStatus: booked && booking.bookingStatus === "awaiting_response"
        ? "questionnaire_pending"
        : booking.bookingStatus,
      questionnaire: questionnaire(booking),
      answeredAt: booking.confirmedAt || booking.declinedAt,
    };
  }

  async submitQuestionnaire(token: string, routeInput: unknown) {
    const verified = this.verifyCustomerToken(token);
    const input = bookingQuestionnaireRouteSchema.parse(routeInput);
    const facts: BookingConfirmationFacts = bookingConfirmationFactsSchema.parse({
      timing: input.timing,
      bookingDate: normalizeQuestionnaireBookingDate(input),
      pricePaidHalalas: parseSarToHalalas(input.pricePaidSar),
    });
    let commissionEnabled = false;
    try {
      commissionEnabled = await this.isCommissionEnforcementEnabled();
    } catch (error) {
      console.error(
        "Booking commission flag lookup failed; confirmation will remain observe-only:",
        error,
      );
    }
    const submissionAt = new Date();
    const booking = await bookingCommissionStore.confirmBooking(
      verified.bookingId,
      facts,
      submissionAt,
      commissionEnabled,
    );
    if (
      booking.enforcementLastError === "owner_identity_changed" &&
      booking.confirmedAt === submissionAt.toISOString()
    ) {
      notificationService.sendAdmin(
        `تم تسجيل الحجز ${booking.id} دون إنشاء عمولة لأن هوية مالك العقار ${booking.propertyNumber} تغيرت. يلزم مراجعة إدارية.`,
      ).catch((error) => console.error("Owner identity confirmation alert failed:", error));
    }
    return {
      id: booking.id,
      propertyNumber: booking.propertyNumber,
      propertyName: booking.propertyName,
      listedPriceOptionsHalalas: booking.listedPriceOptionsHalalas || [],
      bookingStatus: booking.bookingStatus,
      questionnaire: questionnaire(booking),
      answeredAt: booking.confirmedAt,
    };
  }

  async getCustomerBookingsFromSession(
    token: string,
    expectedCustomerPhone?: string,
  ) {
    const verified = this.verifyCustomerToken(token);
    const anchor = await bookingCommissionStore.requireCurrentFreeEligibility(
      verified.bookingId,
    );
    if (
      expectedCustomerPhone &&
      this.createCustomerSubject(expectedCustomerPhone) !== anchor.customerSubject
    ) {
      throw new BookingWorkflowError(
        "CUSTOMER_BOOKING_SESSION_REQUIRED",
        "افتح رابط المتابعة المرسل إلى واتساب لعرض الحجوزات",
        401,
      );
    }
    return this.getCustomerBookingsForSubject(
      anchor.customerSubject,
      anchor.customerPhone,
    );
  }

  async getCustomerBookingsForVerifiedPhone(customerPhone: string) {
    const normalizedPhone = normalizeSaudiMobilePhone(customerPhone);
    if (!normalizedPhone) {
      throw new BookingWorkflowError(
        "CUSTOMER_BOOKING_SESSION_REQUIRED",
        "افتح رابط المتابعة المرسل إلى واتساب لعرض الحجوزات",
        401,
      );
    }
    return this.getCustomerBookingsForSubject(
      this.createCustomerSubject(normalizedPhone),
      normalizedPhone,
    );
  }

  private async getCustomerBookingsForSubject(
    customerSubject: string,
    customerPhone: string,
  ) {
    const bookings = await bookingCommissionStore.listBookingsForCustomer(
      customerSubject,
    );
    const eligibility = await Promise.all(
      bookings.map((booking) =>
        bookingCommissionStore.isBookingCurrentlyFreeEligible(booking)),
    );
    return {
      identity: { maskedPhone: maskContactPhone(customerPhone) },
      bookings: bookings
        .filter((_, index) => eligibility[index])
        .map(publicRow),
    };
  }

  async getOwnerCommission(token: string) {
    const verified = this.verifyOwnerToken(token);
    const booking = await bookingCommissionStore.getBookingForCurrentOwner(
      verified.bookingId,
    );
    if (
      !booking ||
      booking.bookingStatus !== "confirmed" ||
      booking.commissionStatus === "not_applicable" ||
      booking.commissionAmountHalalas === null
    ) {
      throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
    }
    const activeAttempt = booking.activeAttemptId
      ? await bookingCommissionStore.getPaymentAttempt(booking.activeAttemptId)
      : null;
    const bankTransferUnderReview = Boolean(
      activeAttempt &&
      activeAttempt.bookingId === booking.id &&
      activeAttempt.paymentMethod === "bank_transfer" &&
      (
        activeAttempt.status === "creating" ||
        activeAttempt.status === "unknown" ||
        activeAttempt.status === "pending_review" ||
        activeAttempt.status === "review_required"
      ),
    );
    const electronicAttemptInProgress = Boolean(
      activeAttempt &&
      activeAttempt.bookingId === booking.id &&
      activeAttempt.paymentMethod !== "bank_transfer" &&
      (
        activeAttempt.status === "creating" ||
        activeAttempt.status === "unknown"
      ),
    );
    return {
      id: booking.id,
      propertyNumber: booking.propertyNumber,
      propertyName: booking.propertyName,
      questionnaire: questionnaire(booking),
      commissionAmountHalalas: booking.commissionAmountHalalas,
      dueAt: booking.commissionDueAt,
      commissionStatus: booking.commissionStatus === "paid"
        ? "paid"
        : booking.disputeStatus === "pending"
          ? "disputed"
          : booking.commissionStatus,
      complianceStatus: booking.commissionStatus === "paid"
        ? booking.complianceStatus
        : booking.disputeStatus === "pending"
          ? "under_review"
          : booking.complianceStatus,
      checkoutAvailable:
        booking.commissionStatus !== "paid" &&
        booking.commissionStatus !== "waived" &&
        booking.disputeStatus !== "pending" &&
        !bankTransferUnderReview &&
        !electronicAttemptInProgress,
      disputeStatus: booking.disputeStatus,
      disputedAt: booking.disputedAt,
      paymentAttempt: activeAttempt && activeAttempt.bookingId === booking.id
        ? {
            paymentMethod: activeAttempt.paymentMethod,
            status: activeAttempt.status,
            receiptSubmittedAt: activeAttempt.receiptSubmittedAt || null,
            bankReviewDecision: activeAttempt.bankReviewDecision || null,
            bankReviewReason: activeAttempt.bankReviewReason || null,
            bankReviewedAt: activeAttempt.bankReviewedAt || null,
          }
        : null,
    };
  }

  async disputeOwnerCommission(token: string, rawInput: unknown) {
    const verified = this.verifyOwnerToken(token);
    const input = bookingDisputeSchema.parse(rawInput);
    const booking = await bookingCommissionStore.disputeCommission(
      verified.bookingId,
      input.reason,
    );
    return { disputedAt: booking.disputedAt, status: booking.disputeStatus };
  }

  async resolveAdminDispute(bookingId: string, rawInput: unknown) {
    const input = bookingAdminDisputeResolutionSchema.parse(rawInput);
    const result = await bookingCommissionStore.resolveCommissionDispute(
      bookingId,
      input.resolution,
    );
    return {
      id: result.booking.id,
      disputeStatus: result.booking.disputeStatus,
      commissionStatus: result.booking.commissionStatus,
      complianceStatus: result.booking.complianceStatus,
      propertyReleased: result.propertyReleased,
      ownerNotificationScheduled: result.ownerNotificationScheduled,
    };
  }

  async resendAdminNotification(bookingId: string, rawInput: unknown) {
    const input = bookingAdminNotificationResendSchema.parse(rawInput);
    const result = await bookingCommissionStore.scheduleManualNotificationResend({
      bookingId,
      sourceJobId: input.sourceJobId,
      idempotencyKey: input.idempotencyKey,
    });
    return {
      bookingId,
      replayed: result.replayed,
      notification: adminNotificationJob(result.job),
    };
  }

  async resolveAdminReversal(bookingId: string, rawInput: unknown) {
    const input = bookingAdminReversalResolutionSchema.parse(rawInput);
    const result = await bookingCommissionStore.resolveCommissionReversal({
      bookingId,
      attemptId: input.attemptId,
      reversalTransactionId: input.reversalTransactionId,
      resolution: input.resolution,
    });
    return {
      id: result.booking.id,
      attemptId: result.attempt.id,
      reversalTransactionId: input.reversalTransactionId,
      resolution: result.resolution,
      commissionStatus: result.booking.commissionStatus,
      complianceStatus: result.booking.complianceStatus,
      collectionNoticeScheduled: result.resolution === "resume_collection",
      resolvedAt: result.attempt.reversalResolvedAt || null,
    };
  }

  async getFreeWorkflowSettings() {
    return bookingCommissionStore.getFreeWorkflowSettings();
  }

  async getAdminFreeWorkflowSettings() {
    return adminFreeWorkflowSettingsResponse(
      await this.getFreeWorkflowSettings(),
    );
  }

  async updateAdminFreeWorkflowSettings(rawInput: unknown) {
    const current = await this.getFreeWorkflowSettings();
    let compatibleInput = rawInput;
    if (
      rawInput &&
      typeof rawInput === "object" &&
      !Array.isArray(rawInput)
    ) {
      const root = rawInput as Record<string, unknown>;
      const rawSettings = root.settings;
      if (
        rawSettings &&
        typeof rawSettings === "object" &&
        !Array.isArray(rawSettings)
      ) {
        const settings = rawSettings as Record<string, unknown>;
        const rawTemplates = settings.whatsappTemplates;
        const rawTemplateRecord = rawTemplates &&
            typeof rawTemplates === "object" &&
            !Array.isArray(rawTemplates)
          ? rawTemplates as Record<string, unknown>
          : null;
        const legacyTemplateShape = rawTemplateRecord &&
          Object.keys(current.whatsappTemplates)
            .filter((key) => !(key in rawTemplateRecord))
            .every((key) =>
              key === "admin_customer_technical_support" ||
              key === "owner_contact_limit_reached"
            );
        compatibleInput = {
          ...root,
          settings: {
            ...settings,
            customerFollowUpMessageLimit:
              settings.customerFollowUpMessageLimit ??
              current.customerFollowUpMessageLimit,
            customerFollowUpLimitScope:
              settings.customerFollowUpLimitScope ??
              current.customerFollowUpLimitScope,
            adminCustomerWhatsAppCooldownMinutes:
              settings.adminCustomerWhatsAppCooldownMinutes ??
              current.adminCustomerWhatsAppCooldownMinutes,
            whatsappTemplates:
              rawTemplateRecord && legacyTemplateShape
                ? {
                    ...current.whatsappTemplates,
                    ...rawTemplateRecord,
                  }
                : rawTemplates,
          },
        };
      }
    }
    const input = bookingFreeWorkflowSettingsUpdateSchema.parse(compatibleInput);
    return adminFreeWorkflowSettingsResponse(
      await bookingCommissionStore.updateFreeWorkflowSettings(input.settings),
    );
  }

  private requireAdminCustomerDestination(
    booking: BookingFollowUpDocument,
  ): string {
    const destination = normalizeWhatsAppDestination(booking.customerPhone);
    if (!destination) {
      throw new BookingWorkflowError(
        "INVALID_CUSTOMER_PHONE",
        "Invalid customer phone",
        400,
      );
    }
    return destination;
  }

  private requireAdminCustomerTemplateAvailable(
    booking: BookingFollowUpDocument,
    templateVariant: BookingAdminCustomerWhatsAppTemplateVariant,
    now = new Date(),
  ): void {
    if (
      !adminCustomerWhatsAppTemplateVariantsForBooking(booking, now)
        .includes(templateVariant)
    ) {
      throw new BookingWorkflowError(
        "ADMIN_CUSTOMER_WHATSAPP_TEMPLATE_UNAVAILABLE",
        "Selected WhatsApp template is unavailable for this booking",
        409,
      );
    }
  }

  private async renderAdminCustomerWhatsAppMessage(
    booking: BookingFollowUpDocument,
    templateVariant: BookingAdminCustomerWhatsAppTemplateVariant,
    templates?: BookingWhatsAppTemplates,
    now = new Date(),
    ensureCustomerShortLink = true,
  ): Promise<string> {
    this.requireAdminCustomerDestination(booking);
    this.requireAdminCustomerTemplateAvailable(booking, templateVariant, now);
    const configuredTemplates = templates || DEFAULT_BOOKING_WHATSAPP_TEMPLATES;
    if (templateVariant === "technical_support") {
      return renderBookingWhatsAppTemplate(
        "admin_customer_technical_support",
        configuredTemplates.admin_customer_technical_support,
        {},
      );
    }

    const propertyName = String(booking.propertyName || "").trim() ||
      "بدون اسم";
    if (templateVariant === "customer_followup") {
      const expiresAt =
        Date.parse(booking.createdAt) + BOOKING_CUSTOMER_TOKEN_MAX_AGE_MS;
      const customerToken = this.issueCustomerResponseToken(booking);
      const shortCode = ensureCustomerShortLink
        ? await (
          this.adminCustomerShortLinkService || getBookingShortLinkService()
        ).ensureCustomerResponseLink({
          bookingId: booking.id,
          token: customerToken,
          expiresAt,
        })
        : createCustomerBookingShortCode(booking.id);
      const propertyLabel = booking.isFreeProperty || !booking.propertyName
        ? `العقار رقم ${booking.propertyNumber}`
        : `${propertyName} رقم ${booking.propertyNumber}`;
      return renderBookingWhatsAppTemplate(
        "customer_followup",
        configuredTemplates.customer_followup,
        {
          propertyLabel,
          followUpLink: `${bookingPublicBaseUrl()}/b/${shortCode}`,
        },
      );
    }

    throw new BookingWorkflowError(
      "ADMIN_CUSTOMER_WHATSAPP_TEMPLATE_UNAVAILABLE",
      "Selected WhatsApp template is unavailable for this booking",
      409,
    );
  }

  async issueAdminCustomerWhatsAppHandoff(
    bookingId: string,
    rawInput: unknown = {},
  ): Promise<{ handoffUrl: string; nextAllowedAt: string | null }> {
    const input = bookingAdminCustomerWhatsAppHandoffSchema.parse(
      rawInput ?? {},
    );
    const now = new Date();
    const handoffTokens = tokenService();
    const preflightBooking = await bookingCommissionStore
      .getBookingForCurrentOwner(bookingId);
    if (!preflightBooking) {
      throw new BookingWorkflowError(
        "BOOKING_NOT_FOUND",
        "Booking not found",
        404,
      );
    }
    const freeWorkflowSettings = await this.getFreeWorkflowSettings();
    const templates = freeWorkflowSettings.whatsappTemplates;
    await this.renderAdminCustomerWhatsAppMessage(
      preflightBooking,
      input.templateVariant,
      templates,
      now,
    );
    const token = handoffTokens.issue({
      bookingId: preflightBooking.id,
      purpose: ADMIN_CUSTOMER_WHATSAPP_TOKEN_PURPOSE[input.templateVariant],
      expiresAt: Date.now() +
        BOOKING_ADMIN_CUSTOMER_WHATSAPP_TOKEN_MAX_AGE_MS,
    });

    const booking = await bookingCommissionStore.claimAdminCustomerWhatsAppContact(
      bookingId,
      now,
      input.templateVariant,
      freeWorkflowSettings.adminCustomerWhatsAppCooldownMinutes,
    );
    if (!booking) {
      throw new BookingWorkflowError(
        "BOOKING_NOT_FOUND",
        "Booking not found",
        404,
      );
    }
    this.requireAdminCustomerDestination(booking);
    this.requireAdminCustomerTemplateAvailable(
      booking,
      input.templateVariant,
      now,
    );
    return {
      handoffUrl: `/api/admin/booking-commissions/${encodeURIComponent(booking.id)}/customer-whatsapp/open?token=${encodeURIComponent(token)}&templateVariant=${encodeURIComponent(input.templateVariant)}`,
      nextAllowedAt:
        freeWorkflowSettings.adminCustomerWhatsAppCooldownMinutes > 0
          ? new Date(
              now.getTime() +
                freeWorkflowSettings.adminCustomerWhatsAppCooldownMinutes *
                  60 * 1_000,
            ).toISOString()
          : null,
    };
  }

  async resolveAdminCustomerWhatsAppHandoff(
    bookingId: string,
    token: unknown,
    rawTemplateVariant: unknown = "technical_support",
  ): Promise<string> {
    const templateVariant =
      bookingAdminCustomerWhatsAppTemplateVariantSchema.parse(
        rawTemplateVariant ?? "technical_support",
      );
    const verified = tokenService().verify(
      token,
      ADMIN_CUSTOMER_WHATSAPP_TOKEN_PURPOSE[templateVariant],
    );
    if (verified.bookingId !== bookingId) {
      throw new BookingWorkflowError(
        "BOOKING_NOT_FOUND",
        "Booking not found",
        404,
      );
    }
    const booking = await bookingCommissionStore.getBookingForCurrentOwner(
      verified.bookingId,
    );
    if (!booking) {
      throw new BookingWorkflowError(
        "BOOKING_NOT_FOUND",
        "Booking not found",
        404,
      );
    }
    const destination = this.requireAdminCustomerDestination(booking);
    const templates = (await this.getFreeWorkflowSettings()).whatsappTemplates;
    const message = await this.renderAdminCustomerWhatsAppMessage(
      booking,
      templateVariant,
      templates,
      new Date(),
      false,
    );
    return `https://wa.me/${destination}?text=${encodeURIComponent(message)}`;
  }

  async submitBankTransfer(
    token: string,
    file: Express.Multer.File | undefined,
    receiptPersistence: BookingCommissionReceiptPersistence =
      defaultBookingCommissionReceiptPersistence,
  ) {
    const verified = this.verifyOwnerToken(token);
    if (!file) {
      throw new BookingCommissionReceiptError(
        "RECEIPT_REQUIRED",
        "الإيصال مطلوب.",
        400,
      );
    }
    const bankAccount = await firebaseService.getDefaultBankAccount();
    if (!isUsableBookingCommissionBankAccount(bankAccount)) {
      throw new BookingWorkflowError(
        "BANK_ACCOUNT_UNAVAILABLE",
        "بيانات الحساب البنكي غير متاحة أو غير مكتملة.",
        503,
      );
    }
    const attemptId = `BCOM-ATT-${Date.now()}-${randomBytes(5).toString("hex")}`;
    const merchantAttemptKey = `RWQN-BCOM-${Date.now()}-${randomBytes(8).toString("hex")}`;
    const reservation = await bookingCommissionStore.reservePaymentAttempt({
      bookingId: verified.bookingId,
      attemptId,
      merchantAttemptKey,
      paymentMethod: "bank_transfer",
    });
    if (reservation.status === "reused") {
      await bookingCommissionStore.requireCurrentFreeEligibility(
        reservation.booking.id,
      );
      return {
        status: reservation.attempt.status,
        attemptId: reservation.attempt.id,
        receiptSubmittedAt: reservation.attempt.receiptSubmittedAt || null,
      };
    }

    let storedReceipt: StoredBookingCommissionReceipt;
    try {
      storedReceipt = await receiptPersistence.store({
        bookingId: reservation.booking.id,
        attemptId: reservation.attempt.id,
        file,
      });
    } catch (error) {
      await bookingCommissionStore.markPaymentAttemptCreationFailure({
        attemptId: reservation.attempt.id,
        certainty: error instanceof BookingCommissionReceiptError
          ? "rejected"
          : "unknown",
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    try {
      const result = await bookingCommissionStore.completeBankTransferAttempt({
        attemptId: reservation.attempt.id,
        receiptUrl: storedReceipt.url,
        receiptObjectKey: storedReceipt.objectKey,
        receiptContentType: storedReceipt.contentType,
        receiptSizeBytes: storedReceipt.sizeBytes,
      });
      return {
        status: result.status,
        attemptId: result.attempt.id,
        receiptSubmittedAt: result.attempt.receiptSubmittedAt || null,
      };
    } catch (error) {
      let persistedAttempt: BookingCommissionPaymentAttempt | null = null;
      let persistenceKnown = false;
      try {
        persistedAttempt = await bookingCommissionStore.getPaymentAttempt(
          reservation.attempt.id,
        );
        persistenceKnown = true;
      } catch {
        // If Firestore is unavailable after the transaction, deleting the
        // object could destroy evidence referenced by a committed write.
      }
      if (
        persistedAttempt &&
        persistedAttempt.receiptObjectKey === storedReceipt.objectKey &&
        persistedAttempt.receiptUrl === storedReceipt.url &&
        (persistedAttempt.status === "pending_review" ||
          persistedAttempt.status === "review_required")
      ) {
        return {
          status: persistedAttempt.status,
          attemptId: persistedAttempt.id,
          receiptSubmittedAt: persistedAttempt.receiptSubmittedAt || null,
        };
      }

      let removed = false;
      if (persistenceKnown) {
        try {
          removed = await receiptPersistence.remove(storedReceipt.objectKey);
        } catch {
          removed = false;
        }
      }
      await bookingCommissionStore.markPaymentAttemptCreationFailure({
        attemptId: reservation.attempt.id,
        certainty: removed ? "rejected" : "unknown",
        reason: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
      throw error;
    }
  }

  async resolveAdminBankTransfer(bookingId: string, rawInput: unknown) {
    const input = bookingAdminBankTransferResolutionSchema.parse(rawInput);
    return bookingCommissionStore.resolveBankTransferAttempt({
      bookingId,
      attemptId: input.attemptId,
      resolution: input.resolution,
    });
  }

  async createCheckout(token: string, rawInput: unknown) {
    const verified = this.verifyOwnerToken(token);
    const input = bookingCheckoutSchema.parse(rawInput);
    const attemptId = `BCOM-ATT-${Date.now()}-${randomBytes(5).toString("hex")}`;
    const merchantAttemptKey = `RWQN-BCOM-${Date.now()}-${randomBytes(8).toString("hex")}`;
    const reservation = await bookingCommissionStore.reservePaymentAttempt({
      bookingId: verified.bookingId,
      attemptId,
      merchantAttemptKey,
      paymentMethod: input.paymentMethod,
    });
    if (reservation.status === "reused") {
      await bookingCommissionStore.requireCurrentFreeEligibility(
        reservation.booking.id,
      );
      return { checkoutUrl: reservation.attempt.checkoutUrl! };
    }

    try {
      await bookingCommissionStore.requireCurrentFreeEligibility(
        reservation.booking.id,
      );
    } catch (error) {
      await bookingCommissionStore.markPaymentAttemptCreationFailure({
        attemptId: reservation.attempt.id,
        certainty: "rejected",
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    let createdProvider: {
      intentionId: string;
      orderId: string;
      checkoutUrl: string;
    } | null = null;
    try {
      createdProvider = await paymobService.createBookingCommissionIntention({
        amountCents: reservation.attempt.amountCents,
        bookingId: reservation.booking.id,
        attemptId: reservation.attempt.id,
        merchantAttemptKey: reservation.attempt.merchantAttemptKey,
        propertyNumber: reservation.booking.propertyNumber,
        propertyName: reservation.booking.propertyName,
        ownerPhone: reservation.booking.ownerPhone,
        paymentMethod: input.paymentMethod,
      });
      const attempt = await bookingCommissionStore.completePaymentAttemptCreation({
        attemptId: reservation.attempt.id,
        intentionId: createdProvider.intentionId,
        paymobOrderId: createdProvider.orderId,
        checkoutUrl: createdProvider.checkoutUrl,
      });
      await bookingCommissionStore.requireCurrentFreeEligibility(
        reservation.booking.id,
      );
      return { checkoutUrl: attempt.checkoutUrl! };
    } catch (error) {
      const certainty = error instanceof PaymobIntentionError
        ? error.certainty
        : "unknown";
      await bookingCommissionStore.markPaymentAttemptCreationFailure({
        attemptId: reservation.attempt.id,
        certainty,
        reason: error instanceof Error ? error.message : String(error),
        ...(error instanceof PaymobIntentionError && error.createdIntention
          ? { createdIntention: error.createdIntention }
          : createdProvider
            ? {
                createdIntention: {
                  intentionId: createdProvider.intentionId,
                  checkoutUrl: createdProvider.checkoutUrl,
                  paymobOrderId: createdProvider.orderId,
                },
              }
            : {}),
      });
      throw error;
    }
  }

  async getAdminDashboard() {
    const [bookings, jobs, attempts, freeWorkflowSettings] = await Promise.all([
      bookingCommissionStore.listAllBookings(),
      bookingCommissionStore.listAllNotificationJobs(),
      bookingCommissionStore.listPaymentAttempts(),
      this.getFreeWorkflowSettings(),
    ]);
    const jobsByBooking = new Map<string, BookingNotificationJob[]>();
    for (const job of jobs) {
      const list = jobsByBooking.get(job.bookingId) || [];
      list.push(job);
      jobsByBooking.set(job.bookingId, list);
    }
    const attemptsByBooking = new Map<string, BookingCommissionPaymentAttempt[]>();
    for (const attempt of attempts) {
      const list = attemptsByBooking.get(attempt.bookingId) || [];
      list.push(attempt);
      attemptsByBooking.set(attempt.bookingId, list);
    }
    const dashboardNow = Date.now();
    const latestCustomerWhatsAppContact = new Map<string, string>();
    for (const booking of bookings) {
      const candidate = booking.adminCustomerWhatsAppLastOpenedAt;
      if (!candidate || !Number.isFinite(Date.parse(candidate))) continue;
      const current = latestCustomerWhatsAppContact.get(booking.customerSubject);
      if (!current || Date.parse(candidate) > Date.parse(current)) {
        latestCustomerWhatsAppContact.set(booking.customerSubject, candidate);
      }
    }
    const expired = bookings.filter((booking) =>
      isUnansweredBookingExpired(booking, dashboardNow));
    const rows = bookings.map((booking) =>
      adminRow(
        booking,
        jobsByBooking.get(booking.id) || [],
        attemptsByBooking.get(booking.id) || [],
        latestCustomerWhatsAppContact.get(booking.customerSubject) || null,
        new Date(dashboardNow),
        freeWorkflowSettings.adminCustomerWhatsAppCooldownMinutes,
      ));
    const confirmed = bookings.filter((booking) => booking.bookingStatus === "confirmed");
    return {
      summary: {
        total: bookings.length,
        awaitingResponse: bookings.filter((booking) =>
          booking.bookingStatus === "awaiting_response" &&
          !isUnansweredBookingExpired(booking, dashboardNow)).length,
        expired: expired.length,
        declined: bookings.filter((booking) => booking.bookingStatus === "declined").length,
        confirmed: confirmed.length,
        pending: confirmed.filter((booking) => booking.commissionStatus === "pending").length,
        paid: confirmed.filter((booking) => booking.commissionStatus === "paid").length,
        overdue: confirmed.filter((booking) => booking.commissionStatus === "overdue").length,
        paused: confirmed.filter((booking) => booking.complianceStatus === "paused").length,
        reportedValueHalalas: confirmed.reduce(
          (sum, booking) => sum + (booking.confirmationFacts?.pricePaidHalalas || 0),
          0,
        ),
        commissionDueHalalas: confirmed
          .filter((booking) =>
            booking.commissionStatus === "pending" ||
            booking.commissionStatus === "overdue")
          .reduce((sum, booking) => sum + (booking.commissionAmountHalalas || 0), 0),
        commissionPaidHalalas: confirmed
          .filter((booking) => booking.commissionStatus === "paid")
          .reduce((sum, booking) => sum + (booking.commissionAmountHalalas || 0), 0),
        notificationSuppressed: jobs.filter((job) => job.status === "suppressed_quota").length,
      },
      bookings: rows,
    };
  }
}

export function bookingRouteError(error: unknown): {
  status: number;
  body: { code: string; error: string };
} {
  if (error instanceof BookingTokenError) {
    return {
      status: error.code === "TOKEN_EXPIRED" ? 410 : 404,
      body: { code: error.code, error: "رابط المتابعة غير صالح أو منتهي" },
    };
  }
  if (error instanceof BookingWorkflowError) {
    if (error.code === "BOOKING_RESPONSE_EXPIRED") {
      return {
        status: 410,
        body: {
          code: error.code,
          error: "انتهت مهلة تأكيد نتيجة الحجز لهذا الطلب",
        },
      };
    }
    return {
      status: error.status,
      body: { code: error.code, error: error.message },
    };
  }
  if (error instanceof z.ZodError) {
    return {
      status: 400,
      body: { code: "INVALID_BOOKING_INPUT", error: "بيانات الحجز غير مكتملة أو غير صحيحة" },
    };
  }
  if (error instanceof PaymobIntentionError) {
    return {
      status: error.certainty === "rejected" ? 409 : 503,
      body: { code: "COMMISSION_PAYMENT_UNAVAILABLE", error: "تعذر إنشاء رابط الدفع حالياً" },
    };
  }
  if (error instanceof BookingCommissionReceiptError) {
    return {
      status: error.status,
      body: { code: error.code, error: error.message },
    };
  }
  console.error("Booking workflow error:", error);
  return {
    status: 500,
    body: { code: "BOOKING_WORKFLOW_ERROR", error: "تعذر إكمال العملية حالياً" },
  };
}

export const bookingCommissionService = new BookingCommissionService();
