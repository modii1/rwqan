import { createHash, randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { db as configuredDb } from "../config/firebase";
import {
  BOOKING_ADMIN_CUSTOMER_WHATSAPP_COOLDOWN_MINUTES_DEFAULT,
  BOOKING_CUSTOMER_FOLLOW_UP_LIMIT_SCOPE_DEFAULT,
  BOOKING_CUSTOMER_FOLLOW_UP_MESSAGE_LIMIT_DEFAULT,
  BOOKING_CUSTOMER_FOLLOW_UP_DELAY_MINUTES_DEFAULT,
  BOOKING_OPTIONAL_COMMISSION_REMINDER_DAYS,
  DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
  bookingAdminCustomerWhatsAppTemplateVariantSchema,
  bookingAdminCustomerWhatsAppCooldownMinutesSchema,
  bookingCustomerFollowUpMessageLimitSchema,
  bookingCustomerFollowUpLimitScopeSchema,
  bookingCustomerFollowUpDelayHoursSchema,
  bookingCustomerFollowUpDelayMinutesSchema,
  bookingFreeWorkflowConfigurationSchema,
  bookingFreeWorkflowLimitsSchema,
  bookingOptionalCommissionReminderDaysSchema,
  bookingWhatsAppTemplatesSchema,
  bookingConfirmationFactsSchema,
  bookingFollowUpRecordSchema,
  buildConfirmedBookingFinancials,
  calculateCommissionDueAt,
  calculateCommissionReminderSchedule,
  COMMISSION_PAYMENT_WINDOW_MS,
  type BookingConfirmationFacts,
  type BookingAdminCustomerWhatsAppTemplateVariant,
  type BookingCustomerFollowUpLimitScope,
  type BookingFreeWorkflowConfiguration,
  type BookingFreeWorkflowLimits,
  type BookingFreeWorkflowSettings,
  type BookingFollowUpRecord,
  type BookingWhatsAppTemplateKey,
} from "../../shared/booking";
import type { Subscription } from "../../shared/schema";
import { isActivePremiumSubscription } from "../../shared/subscriptionType";
import { hasActivePropertyHold } from "../../shared/propertyAvailability";
import {
  calculateRemainingDays,
  getEndOfDayRiyadh,
  getStartOfDayRiyadh,
} from "../utils/dateUtils";
import { selectCurrentSubscriptionForProperty } from "../utils/subscriptionSelection";
import {
  normalizeSaudiMobilePhone,
  normalizeWhatsAppDestination,
} from "../../shared/phone";
import type {
  BookingCommissionPaymentAttempt,
  BookingCustomerFollowUpState,
  BookingCommissionWebhookInput,
  BookingEvent,
  BookingFollowUpDocument,
  BookingNotificationJob,
  BookingNotificationKind,
  BookingNotificationProviderStatus,
} from "./BookingCommissionTypes";
import {
  whatsappProviderDeliveryEventKey,
  type WhatsAppProviderDeliveryEvent,
} from "./WhatsAppDeliveryService";

const BOOKINGS_COLLECTION = "booking_followups";
const NOTIFICATIONS_COLLECTION = "booking_notification_outbox";
const ATTEMPTS_COLLECTION = "booking_commission_payment_attempts";
const ORDER_BINDINGS_COLLECTION = "booking_commission_order_bindings";
const TRANSACTION_BINDINGS_COLLECTION = "booking_commission_transaction_bindings";
const REVERSAL_BINDINGS_COLLECTION = "booking_commission_reversal_bindings";
const QUOTAS_COLLECTION = "booking_notification_quotas";
const CUSTOMER_FOLLOW_UP_STATES_COLLECTION =
  "booking_customer_followup_states";
const SETTINGS_COLLECTION = "settings";
const FREE_WORKFLOW_SETTINGS_DOCUMENT = "booking_free_workflow_limits";
const FREE_WORKFLOW_SETTINGS_AUDIT_COLLECTION =
  "booking_free_workflow_limits_audit";
const MANUAL_RESEND_AUDIT_COLLECTION =
  "booking_notification_manual_resend_audit";

const PROVIDER_DELIVERY_STATUS_RANK: Record<
  BookingNotificationProviderStatus,
  number
> = {
  accepted: 1,
  failed: 2,
  delivered: 3,
  read: 4,
};

function buildCommissionHoldAfterRelease(
  property: Record<string, any>,
  remainingHoldIds: string[],
  timestamp: string,
) {
  return remainingHoldIds.length > 0
    ? {
        ...property.commissionHold,
        active: true,
        obligationIds: remainingHoldIds,
        updatedAt: timestamp,
      }
    : {
        active: false,
        obligationIds: [],
        appliedAt: property.commissionHold?.appliedAt,
        releasedAt: timestamp,
        updatedAt: timestamp,
      };
}

function isAvailableAfterCommissionRelease(
  property: Record<string, any>,
  remainingHoldIds: string[],
  timestamp: string,
): boolean {
  return !hasActivePropertyHold({
    ...property,
    commissionHold: buildCommissionHoldAfterRelease(
      property,
      remainingHoldIds,
      timestamp,
    ),
  });
}

export const BOOKING_FOLLOW_UP_DELAY_MS =
  BOOKING_CUSTOMER_FOLLOW_UP_DELAY_MINUTES_DEFAULT * 60 * 1000;
export const BOOKING_CUSTOMER_RESPONSE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const BOOKING_NOTIFICATION_LEASE_MS = 2 * 60 * 1000;
export const BOOKING_OWNER_NOTICE_RETRY_MS = 30 * 60 * 1000;
export const BOOKING_ENFORCEMENT_LEASE_MS = 2 * 60 * 1000;
export const BOOKING_PAYMENT_ATTEMPT_STALE_MS = 15 * 60 * 1000;

export function latestCommissionReminderOffsetDue(
  booking: Pick<BookingFollowUpDocument, "commissionNoticeSentAt" | "confirmedAt">,
  now: Date,
): 3 | 4 | 5 | null {
  const scheduleAnchor = booking.commissionNoticeSentAt || booking.confirmedAt;
  if (!scheduleAnchor) return null;
  const elapsedDays = Math.floor(
    (now.getTime() - Date.parse(scheduleAnchor)) / (24 * 60 * 60 * 1000),
  );
  return elapsedDays >= 5 ? 5 : elapsedDays >= 4 ? 4 : elapsedDays >= 3 ? 3 : null;
}

export class BookingWorkflowError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "BookingWorkflowError";
  }
}

export type InitialBookingWorkflow = {
  followUp: Omit<BookingFollowUpDocument, "contactRequestId">;
  customerNotification: BookingNotificationJob;
  ownerContactLimitNotification: BookingNotificationJob;
};

const DEFAULT_FREE_WORKFLOW_LIMIT = 3;

function environmentLimit(name: string): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return DEFAULT_FREE_WORKFLOW_LIMIT;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1_000
    ? parsed
    : DEFAULT_FREE_WORKFLOW_LIMIT;
}

function environmentCustomerFollowUpDelayMinutes(): number {
  const rawMinutes = process.env.CUSTOMER_BOOKING_FOLLOWUP_DELAY_MINUTES;
  if (rawMinutes !== undefined && rawMinutes.trim() !== "") {
    const validated = bookingCustomerFollowUpDelayMinutesSchema.safeParse(
      Number(rawMinutes),
    );
    return validated.success
      ? validated.data
      : BOOKING_CUSTOMER_FOLLOW_UP_DELAY_MINUTES_DEFAULT;
  }

  const legacyHours = bookingCustomerFollowUpDelayHoursSchema.safeParse(
    Number(process.env.CUSTOMER_BOOKING_FOLLOWUP_DELAY_HOURS),
  );
  return legacyHours.success
    ? legacyHours.data * 60
    : BOOKING_CUSTOMER_FOLLOW_UP_DELAY_MINUTES_DEFAULT;
}

export function getEnvironmentFreeWorkflowLimits(): BookingFreeWorkflowLimits {
  return {
    customerDailyLimit: environmentLimit(
      "CUSTOMER_BOOKING_FOLLOWUP_DAILY_LIMIT",
    ),
    freeOwnerDailyLimit: environmentLimit(
      "FREE_OWNER_BOOKING_NOTIFICATION_DAILY_LIMIT",
    ),
    freePropertyContactDailyLimit: environmentLimit(
      "FREE_PROPERTY_DAILY_CONTACT_LIMIT",
    ),
  };
}

export function getDefaultFreeWorkflowConfiguration(): BookingFreeWorkflowConfiguration {
  return {
    ...getEnvironmentFreeWorkflowLimits(),
    customerFollowUpDelayMinutes: environmentCustomerFollowUpDelayMinutes(),
    customerFollowUpMessageLimit:
      BOOKING_CUSTOMER_FOLLOW_UP_MESSAGE_LIMIT_DEFAULT,
    customerFollowUpLimitScope:
      BOOKING_CUSTOMER_FOLLOW_UP_LIMIT_SCOPE_DEFAULT,
    adminCustomerWhatsAppCooldownMinutes:
      BOOKING_ADMIN_CUSTOMER_WHATSAPP_COOLDOWN_MINUTES_DEFAULT,
    whatsappTemplates: { ...DEFAULT_BOOKING_WHATSAPP_TEMPLATES },
    optionalCommissionReminderDays: [
      ...BOOKING_OPTIONAL_COMMISSION_REMINDER_DAYS,
    ],
  };
}

function storedFreeWorkflowLimits(
  value: unknown,
): BookingFreeWorkflowLimits | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const parsed = bookingFreeWorkflowLimitsSchema.safeParse({
    customerDailyLimit: data.customerDailyLimit,
    freeOwnerDailyLimit: data.freeOwnerDailyLimit,
    freePropertyContactDailyLimit: data.freePropertyContactDailyLimit,
  });
  return parsed.success ? parsed.data : null;
}

function storedFreeWorkflowConfiguration(
  value: unknown,
): BookingFreeWorkflowConfiguration | null {
  const limits = storedFreeWorkflowLimits(value);
  if (!limits || !value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const storedTemplates = data.whatsappTemplates &&
      typeof data.whatsappTemplates === "object" &&
      !Array.isArray(data.whatsappTemplates)
    ? data.whatsappTemplates as Record<string, unknown>
    : {};
  const optionalDays = bookingOptionalCommissionReminderDaysSchema.safeParse(
    data.optionalCommissionReminderDays,
  );
  const defaults = getDefaultFreeWorkflowConfiguration();
  const storedDelayMinutes = bookingCustomerFollowUpDelayMinutesSchema.safeParse(
    data.customerFollowUpDelayMinutes,
  );
  const storedMessageLimit = bookingCustomerFollowUpMessageLimitSchema.safeParse(
    data.customerFollowUpMessageLimit,
  );
  const storedLimitScope = bookingCustomerFollowUpLimitScopeSchema.safeParse(
    data.customerFollowUpLimitScope,
  );
  const storedAdminCooldown =
    bookingAdminCustomerWhatsAppCooldownMinutesSchema.safeParse(
      data.adminCustomerWhatsAppCooldownMinutes,
    );
  const legacyDelayHours = bookingCustomerFollowUpDelayHoursSchema.safeParse(
    data.customerFollowUpDelayHours,
  );
  const templates = Object.fromEntries(
    (Object.keys(defaults.whatsappTemplates) as BookingWhatsAppTemplateKey[])
      .map((key) => {
        const storedTemplate = storedTemplates[key];
        let candidate = typeof storedTemplate === "string"
          ? storedTemplate
          : defaults.whatsappTemplates[key];
        if (key === "owner_booking_facts" || key === "owner_booking_commission") {
          const missingFacts: string[] = [];
          if (!candidate.includes("{{requestCode}}")) {
            missingFacts.push("رقم الطلب: {{requestCode}}");
          }
          if (!candidate.includes("{{customerPhone}}")) {
            missingFacts.push("رقم العميل: {{customerPhone}}");
          }
          if (missingFacts.length > 0) {
            candidate = `${candidate}\n\n${missingFacts.join("\n")}`;
          }
        }
        const parsed = bookingWhatsAppTemplatesSchema.shape[key]
          .safeParse(candidate);
        return [
          key,
          parsed.success ? parsed.data : defaults.whatsappTemplates[key],
        ];
      }),
  );
  return bookingFreeWorkflowConfigurationSchema.parse({
    ...limits,
    customerFollowUpDelayMinutes: storedDelayMinutes.success
      ? storedDelayMinutes.data
      : legacyDelayHours.success
        ? legacyDelayHours.data * 60
        : defaults.customerFollowUpDelayMinutes,
    customerFollowUpMessageLimit: storedMessageLimit.success
      ? storedMessageLimit.data
      : limits.customerDailyLimit,
    customerFollowUpLimitScope: storedLimitScope.success
      ? storedLimitScope.data
      : BOOKING_CUSTOMER_FOLLOW_UP_LIMIT_SCOPE_DEFAULT,
    adminCustomerWhatsAppCooldownMinutes: storedAdminCooldown.success
      ? storedAdminCooldown.data
      : defaults.adminCustomerWhatsAppCooldownMinutes,
    whatsappTemplates: templates,
    optionalCommissionReminderDays: optionalDays.success
      ? optionalDays.data
      : defaults.optionalCommissionReminderDays,
  });
}

function resolvedFreeWorkflowSettings(value: unknown): BookingFreeWorkflowSettings {
  const stored = storedFreeWorkflowConfiguration(value);
  if (!stored) {
    return {
      ...getDefaultFreeWorkflowConfiguration(),
      updatedAt: null,
      updatedBy: "environment",
      source: "environment",
    };
  }
  const data = value as Record<string, unknown>;
  return {
    ...stored,
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : null,
    updatedBy: data.updatedBy === "admin" ? "admin" : "environment",
    source: "firestore",
  };
}

export type ClaimedBookingNotification = BookingNotificationJob & {
  leaseToken: string;
};

function requireFirestore(database?: Firestore | null): Firestore {
  const resolved = database ?? configuredDb;
  if (!resolved) throw new Error("Firebase not initialized");
  return resolved;
}

function appendEvent(
  events: unknown,
  event: BookingEvent,
): BookingEvent[] {
  const current = Array.isArray(events)
    ? events.filter((candidate): candidate is BookingEvent =>
        Boolean(candidate) && typeof candidate === "object" &&
        typeof (candidate as BookingEvent).type === "string" &&
        typeof (candidate as BookingEvent).at === "string")
    : [];
  return [...current.slice(-39), event];
}

function appendEventOnce(events: unknown, event: BookingEvent): BookingEvent[] {
  const current = Array.isArray(events) ? events as BookingEvent[] : [];
  return current.some((candidate) => candidate?.type === event.type)
    ? current
    : appendEvent(current, event);
}

function customerResponseExpired(
  booking: Pick<BookingFollowUpDocument, "createdAt" | "bookingStatus">,
  now: Date,
): boolean {
  if (booking.bookingStatus !== "awaiting_response") return false;
  const createdAt = Date.parse(booking.createdAt);
  return !Number.isFinite(createdAt) ||
    now.getTime() >= createdAt + BOOKING_CUSTOMER_RESPONSE_WINDOW_MS;
}

export function adminCustomerWhatsAppTemplateVariantsForBooking(
  booking: BookingFollowUpDocument,
  now = new Date(),
): BookingAdminCustomerWhatsAppTemplateVariant[] {
  if (
    !Number.isFinite(now.getTime()) ||
    booking.isFreeProperty !== true ||
    Boolean(booking.freeEligibilityRevokedAt) ||
    !normalizeWhatsAppDestination(booking.customerPhone)
  ) return [];

  return booking.bookingStatus === "awaiting_response" &&
      !customerResponseExpired(booking, now)
    ? ["technical_support", "customer_followup"]
    : ["technical_support"];
}

function ownerIdentityMatches(
  booking: Pick<BookingFollowUpDocument, "ownerPhone">,
  property: Record<string, unknown> | null | undefined,
): boolean {
  const expected = normalizeSaudiMobilePhone(booking.ownerPhone);
  const current = normalizeSaudiMobilePhone(property?.whatsappNumber);
  return Boolean(expected && current && expected === current);
}

function currentSubscriptionFromSnapshot(
  snapshot: FirebaseFirestore.QuerySnapshot,
  propertyNumber: string,
): Subscription | undefined {
  return selectCurrentSubscriptionForProperty(
    snapshot.docs.map((document) => ({
      ...document.data(),
      id: String(document.data()?.id || document.id),
    }) as Subscription),
    propertyNumber,
  );
}

function isCurrentSubscriptionActivePremium(
  snapshot: FirebaseFirestore.QuerySnapshot,
  propertyNumber: string,
): boolean {
  const subscription = currentSubscriptionFromSnapshot(snapshot, propertyNumber);
  return Boolean(subscription && isActivePremiumSubscription({
    subscriptionType: subscription.subscriptionType,
    packageType: subscription.packageType,
    status: subscription.status,
    isExpired: calculateRemainingDays(subscription.endDate || null) < 0,
  }));
}

function ownerIdentityReviewUpdates(
  booking: BookingFollowUpDocument,
  at: string,
): Partial<BookingFollowUpDocument> {
  const reviewable = booking.bookingStatus === "confirmed" &&
    (booking.commissionStatus === "pending" || booking.commissionStatus === "overdue");
  return {
    ...(reviewable ? {
      disputeStatus: "pending" as const,
      disputedAt: booking.disputedAt || at,
      disputeReason: "owner_identity_changed",
    } : {}),
    enforcementDeferredUntil: null,
    enforcementLastError: "owner_identity_changed",
    events: appendEventOnce(booking.events, {
      type: "owner_identity_changed",
      at,
      detail: "owner_identity_changed",
    }),
    updatedAt: at,
  };
}

function coreBookingRecord(document: BookingFollowUpDocument): BookingFollowUpRecord {
  return bookingFollowUpRecordSchema.parse({
    id: document.id,
    contactRequestId: document.contactRequestId,
    requestCode: document.requestCode,
    propertyNumber: document.propertyNumber,
    customerSubject: document.customerSubject,
    followUpDueAt: document.followUpDueAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    bookingStatus: document.bookingStatus,
    commissionStatus: document.commissionStatus,
    complianceStatus: document.complianceStatus,
    confirmationFacts: document.confirmationFacts,
    confirmedAt: document.confirmedAt,
    declinedAt: document.declinedAt,
    commissionAmountHalalas: document.commissionAmountHalalas,
    commissionDueAt: document.commissionDueAt,
    commissionNoticeSentAt: document.commissionNoticeSentAt,
    commissionPaidAt: document.commissionPaidAt,
    commissionReminderOffsetsSent: document.commissionReminderOffsetsSent,
  });
}

function notificationId(bookingId: string, kind: BookingNotificationKind): string {
  return `${bookingId}--${kind}`;
}

function customerFollowUpSequenceNotificationId(
  bookingId: string,
  sequenceNumber: number,
): string {
  return sequenceNumber === 1
    ? notificationId(bookingId, "customer_followup")
    : `${bookingId}--customer_followup_${sequenceNumber}`;
}

function isCustomerNotificationKind(
  kind: BookingNotificationKind,
): kind is "customer_followup" | "customer_final_reminder" {
  return kind === "customer_followup" || kind === "customer_final_reminder";
}

function isAutomaticCustomerSequenceJob(
  job: Pick<
    BookingNotificationJob,
    "kind" | "manualResendOfJobId" | "manualResendRequestedAt"
  >,
): boolean {
  return isCustomerNotificationKind(job.kind) &&
    !job.manualResendOfJobId &&
    (
      !job.manualResendRequestedAt ||
      job.kind === "customer_final_reminder"
    );
}

function automaticCustomerSequenceJobIsActive(
  job: Pick<
    BookingNotificationJob,
    "id" | "kind" | "manualResendOfJobId" | "manualResendRequestedAt" |
    "customerFollowUpSequenceNumber"
  >,
  booking: BookingFollowUpDocument,
): boolean {
  if (!isAutomaticCustomerSequenceJob(job)) return true;
  const sequenceNumber = Number(job.customerFollowUpSequenceNumber || 1);
  if (
    Number.isSafeInteger(booking.customerFollowUpMessageLimit) &&
    sequenceNumber > Number(booking.customerFollowUpMessageLimit)
  ) return false;
  if (booking.activeCustomerNotificationJobId) {
    return booking.activeCustomerNotificationJobId === job.id;
  }
  return booking.customerFollowUpMessageLimit === undefined &&
    job.kind === "customer_followup" &&
    (job.customerFollowUpSequenceNumber || 1) === 1;
}

function buildNotificationJob(options: {
  booking: Pick<BookingFollowUpDocument,
    "id" | "propertyNumber" | "ownerPhone" | "customerPhone" |
    "customerSubject" | "isFreeProperty" | "commissionStatus" |
    "customerFollowUpLimitScope">;
  kind: BookingNotificationKind;
  scheduledAt: string;
  now: string;
  customerFollowUpSequenceNumber?: number;
  customerFollowUpSequenceParentJobId?: string | null;
}): BookingNotificationJob {
  const isCustomer = isCustomerNotificationKind(options.kind);
  const isOwnerBookingFact = options.kind === "owner_booking_confirmed";
  const reminderMatch = /^commission_reminder_([345])$/.exec(options.kind);
  const reminderOffsetDays = reminderMatch
    ? Number(reminderMatch[1]) as 3 | 4 | 5
    : null;
  return {
    id: options.kind === "customer_followup"
      ? customerFollowUpSequenceNotificationId(
          options.booking.id,
          options.customerFollowUpSequenceNumber || 1,
        )
      : notificationId(options.booking.id, options.kind),
    bookingId: options.booking.id,
    propertyNumber: options.booking.propertyNumber,
    recipientRole: isCustomer ? "customer" : "owner",
    recipientPhone: isCustomer
      ? options.booking.customerPhone
      : options.booking.ownerPhone,
    recipientQuotaKey: isCustomer
      ? options.booking.customerSubject
      : options.booking.ownerPhone.replace(/\D/g, ""),
    kind: options.kind,
    reminderOffsetDays,
    scheduledAt: options.scheduledAt,
    status: "pending",
    isFreeProperty: options.booking.isFreeProperty,
    quotaCategory: isCustomer
      ? "customer_followup"
      : isOwnerBookingFact &&
          options.booking.isFreeProperty &&
          options.booking.commissionStatus === "not_applicable"
        ? "free_owner_booking"
        : "transactional",
    ...(isCustomer
      ? {
          customerFollowUpSequenceNumber:
            options.customerFollowUpSequenceNumber || 1,
          customerFollowUpSequenceParentJobId:
            options.customerFollowUpSequenceParentJobId || null,
          customerFollowUpLimitScope:
            options.booking.customerFollowUpLimitScope ??
            BOOKING_CUSTOMER_FOLLOW_UP_LIMIT_SCOPE_DEFAULT,
        }
      : {}),
    attempts: 0,
    leaseToken: null,
    leaseExpiresAt: null,
    claimedAt: null,
    sentAt: null,
    failedAt: null,
    suppressedAt: null,
    providerError: null,
    providerMessageId: null,
    providerDeliveryStatus: null,
    providerAcceptedAt: null,
    providerDeliveredAt: null,
    providerReadAt: null,
    providerFailedAt: null,
    providerStatusUpdatedAt: null,
    providerDeliveryError: null,
    providerDeliveryEventKeys: [],
    createdAt: options.now,
    updatedAt: options.now,
  };
}

export function buildInitialBookingWorkflow(options: {
  requestCode: string;
  propertyNumber: string;
  propertyName: string;
  ownerPhone: string;
  customerPhone: string;
  customerSubject: string;
  isFreeProperty: boolean;
  customerFollowUpDelayMinutes?: number;
  customerFollowUpMessageLimit?: number;
  customerFollowUpLimitScope?: BookingCustomerFollowUpLimitScope;
  freePropertyContactDailyLimit?: number;
  listedPriceOptionsHalalas?: number[];
  now?: Date;
}): InitialBookingWorkflow {
  if (options.isFreeProperty !== true) {
    throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
  }
  const now = options.now || new Date();
  if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid booking time");
  const customerFollowUpDelayMinutes = bookingCustomerFollowUpDelayMinutesSchema
    .parse(
      options.customerFollowUpDelayMinutes ??
        BOOKING_CUSTOMER_FOLLOW_UP_DELAY_MINUTES_DEFAULT,
    );
  const customerFollowUpMessageLimit =
    options.customerFollowUpMessageLimit === undefined
      ? undefined
      : bookingFreeWorkflowLimitsSchema.shape.customerDailyLimit.parse(
          options.customerFollowUpMessageLimit,
        );
  const customerFollowUpLimitScope = bookingCustomerFollowUpLimitScopeSchema
    .parse(
      options.customerFollowUpLimitScope ??
        BOOKING_CUSTOMER_FOLLOW_UP_LIMIT_SCOPE_DEFAULT,
    );
  const freePropertyContactDailyLimit =
    bookingFreeWorkflowLimitsSchema.shape.freePropertyContactDailyLimit.parse(
      options.freePropertyContactDailyLimit ?? DEFAULT_FREE_WORKFLOW_LIMIT,
    );
  const createdAt = now.toISOString();
  const followUpDueAt = new Date(
    now.getTime() + customerFollowUpDelayMinutes * 60 * 1_000,
  ).toISOString();
  const id = `BOOK-${options.requestCode}`;
  const initialCustomerNotificationKind: BookingNotificationKind =
    customerFollowUpMessageLimit === 1
      ? "customer_final_reminder"
      : "customer_followup";
  const customerNotificationId = notificationId(
    id,
    initialCustomerNotificationKind,
  );
  const followUp: Omit<BookingFollowUpDocument, "contactRequestId"> = {
    id,
    requestCode: options.requestCode,
    propertyNumber: options.propertyNumber,
    propertyName: String(options.propertyName || "").trim() || "بدون اسم",
    listedPriceOptionsHalalas: options.listedPriceOptionsHalalas || [],
    ownerPhone: options.ownerPhone,
    customerPhone: options.customerPhone,
    customerSubject: options.customerSubject,
    isFreeProperty: options.isFreeProperty,
    freeEligibilityRevokedAt: null,
    followUpDueAt,
    bookingStatus: "awaiting_response",
    commissionStatus: "not_applicable",
    complianceStatus: "clear",
    confirmationFacts: null,
    confirmedAt: null,
    declinedAt: null,
    commissionAmountHalalas: null,
    commissionDueAt: null,
    commissionNoticeSentAt: null,
    commissionPaidAt: null,
    commissionReminderOffsetsSent: [],
    bookingDecision: null,
    questionnaireStartedAt: null,
    activeAttemptId: null,
    paidAttemptId: null,
    disputeStatus: "none",
    disputedAt: null,
    disputeReason: null,
    enforcementDeferredUntil: null,
    enforcementLastError: null,
    enforcementLeaseToken: null,
    enforcementLeaseExpiresAt: null,
    schemaVersion: 1,
    events: [
      { type: "contact_accepted", at: createdAt },
      ...(customerFollowUpMessageLimit === 0
        ? []
        : [{
            type: initialCustomerNotificationKind === "customer_final_reminder"
              ? "customer_final_reminder_scheduled" as const
              : "customer_followup_scheduled" as const,
            at: createdAt,
          }]),
    ],
    ...(customerFollowUpMessageLimit === undefined
      ? {}
      : { customerFollowUpMessageLimit }),
    customerFollowUpDelayMinutes,
    customerFollowUpLimitScope,
    freePropertyContactDailyLimit,
    activeCustomerNotificationJobId:
      customerFollowUpMessageLimit === 0 ? null : customerNotificationId,
    createdAt,
    updatedAt: createdAt,
  };
  const customerNotification = buildNotificationJob({
    booking: followUp,
    kind: initialCustomerNotificationKind,
    scheduledAt: followUpDueAt,
    now: createdAt,
    customerFollowUpSequenceNumber: 1,
  });
  if (customerFollowUpMessageLimit === 0) {
    customerNotification.status = "cancelled";
    customerNotification.providerError = "customer_sequence_disabled";
  }
  const ownerContactLimitNotification = buildNotificationJob({
    booking: followUp,
    kind: "owner_contact_limit_reached",
    scheduledAt: createdAt,
    now: createdAt,
  });
  return { followUp, customerNotification, ownerContactLimitNotification };
}

function quotaLimitFor(
  job: BookingNotificationJob,
  limits: BookingFreeWorkflowLimits,
): number | null {
  if (job.manualResendRequestedAt) return null;
  return job.recipientRole === "customer"
    ? limits.customerDailyLimit
    : limits.freeOwnerDailyLimit;
}

function quotaDocumentId(job: BookingNotificationJob, windowStart: number): string {
  const role = job.recipientRole;
  return `${role}-${job.recipientQuotaKey}-${windowStart}`;
}

function customerFollowUpStateCustomerKey(customerSubject: string): string {
  return createHash("sha256")
    .update(`booking-customer-followup-state:${customerSubject}`)
    .digest("hex");
}

function customerFollowUpStateDocumentId(
  customerSubject: string,
  campaignStartedAt: number,
): string {
  return `${customerFollowUpStateCustomerKey(customerSubject)}-${campaignStartedAt}`;
}

function customerFollowUpLimitScopeFor(
  value: Pick<BookingFollowUpDocument, "customerFollowUpLimitScope"> |
    Pick<BookingNotificationJob, "customerFollowUpLimitScope">,
): BookingCustomerFollowUpLimitScope {
  return bookingCustomerFollowUpLimitScopeSchema.safeParse(
      value.customerFollowUpLimitScope,
    ).success
    ? value.customerFollowUpLimitScope as BookingCustomerFollowUpLimitScope
    : BOOKING_CUSTOMER_FOLLOW_UP_LIMIT_SCOPE_DEFAULT;
}

function customerFollowUpMessageLimitFor(
  booking: Pick<BookingFollowUpDocument, "customerFollowUpMessageLimit">,
): number {
  const parsed = bookingCustomerFollowUpMessageLimitSchema.safeParse(
    booking.customerFollowUpMessageLimit,
  );
  return parsed.success
    ? parsed.data
    : BOOKING_CUSTOMER_FOLLOW_UP_MESSAGE_LIMIT_DEFAULT;
}

function bookingCampaignBounds(
  booking: Pick<BookingFollowUpDocument, "createdAt">,
): { start: number; end: number } {
  const parsed = Date.parse(booking.createdAt);
  const start = Number.isFinite(parsed) ? parsed : 0;
  return {
    start,
    end: start + BOOKING_CUSTOMER_RESPONSE_WINDOW_MS,
  };
}

function bookingCustomerResponseAt(
  booking: BookingFollowUpDocument,
): number | null {
  const candidates = [
    booking.questionnaireStartedAt,
    booking.declinedAt,
    booking.confirmedAt,
  ]
    .map((value) => Date.parse(value || ""))
    .filter(Number.isFinite);
  return candidates.length > 0 ? Math.min(...candidates) : null;
}

function campaignBookingsContaining(
  seed: BookingFollowUpDocument,
  allBookings: BookingFollowUpDocument[],
): BookingFollowUpDocument[] {
  const seedCreatedAt = bookingCampaignBounds(seed).start;
  const responseBoundaries = allBookings
    .map(bookingCustomerResponseAt)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  const priorResponse = responseBoundaries
    .filter((value) => value < seedCreatedAt)
    .at(-1) ?? Number.NEGATIVE_INFINITY;
  const nextResponse = responseBoundaries
    .find((value) => value >= seedCreatedAt) ?? Number.POSITIVE_INFINITY;
  const eligibleBookings = allBookings.filter((booking) => {
    const createdAt = bookingCampaignBounds(booking).start;
    return createdAt > priorResponse && createdAt <= nextResponse;
  });
  let { start, end } = bookingCampaignBounds(seed);
  const selected = new Map<string, BookingFollowUpDocument>([[seed.id, seed]]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const booking of eligibleBookings) {
      if (selected.has(booking.id)) continue;
      const bounds = bookingCampaignBounds(booking);
      if (bounds.start > end || bounds.end < start) continue;
      selected.set(booking.id, booking);
      start = Math.min(start, bounds.start);
      end = Math.max(end, bounds.end);
      changed = true;
    }
  }
  return [...selected.values()];
}

function automaticCustomerJob(
  job: BookingNotificationJob,
): boolean {
  return isAutomaticCustomerSequenceJob(job);
}

type CustomerFollowUpCampaignContext = {
  stateRef: FirebaseFirestore.DocumentReference;
  state: BookingCustomerFollowUpState;
  bookings: BookingFollowUpDocument[];
  jobs: BookingNotificationJob[];
  effectiveLimitScope: BookingCustomerFollowUpLimitScope;
  ordinaryMessageBudget: number;
  sharedOrdinaryMessagesSent: number;
  propertyOrdinaryMessageBudgets: Map<string, number>;
  propertyOrdinaryMessagesSent: Map<string, number>;
  customerResponded: boolean;
  canonicalFinalJobId: string;
};

async function readCustomerFollowUpCampaignContext(options: {
  db: Firestore;
  transaction: FirebaseFirestore.Transaction;
  booking: BookingFollowUpDocument;
  now: Date;
}): Promise<CustomerFollowUpCampaignContext> {
  const { db, transaction, booking, now } = options;
  const bookingsQuery = db.collection(BOOKINGS_COLLECTION)
    .where("customerSubject", "==", booking.customerSubject);
  const bookingsSnapshot = await transaction.get(bookingsQuery);
  const allBookings = (bookingsSnapshot as FirebaseFirestore.QuerySnapshot).docs
    .map((snapshot) => snapshot.data() as BookingFollowUpDocument);
  if (!allBookings.some((candidate) => candidate.id === booking.id)) {
    allBookings.push(booking);
  }
  const campaignBookings = campaignBookingsContaining(booking, allBookings);
  const campaignBookingIds = new Set(campaignBookings.map(({ id }) => id));
  const campaignStart = Math.min(
    ...campaignBookings.map((candidate) => bookingCampaignBounds(candidate).start),
  );
  const campaignEnd = Math.max(
    ...campaignBookings.map((candidate) => bookingCampaignBounds(candidate).end),
  );
  const stateId = customerFollowUpStateDocumentId(
    booking.customerSubject,
    campaignStart,
  );
  const stateRef = db.collection(CUSTOMER_FOLLOW_UP_STATES_COLLECTION)
    .doc(stateId);
  const jobsQuery = db.collection(NOTIFICATIONS_COLLECTION)
    .where("recipientQuotaKey", "==", booking.customerSubject);
  const [stateSnapshot, jobsSnapshot] = await Promise.all([
    transaction.get(stateRef),
    transaction.get(jobsQuery),
  ]);
  const campaignJobs = (jobsSnapshot as FirebaseFirestore.QuerySnapshot).docs
    .map((snapshot) => snapshot.data() as BookingNotificationJob)
    .filter((job) => campaignBookingIds.has(job.bookingId));
  // A mixed legacy/new campaign is intentionally fail-safe: one customer-scoped
  // booking makes the whole overlapping campaign customer-scoped.
  const effectiveLimitScope: BookingCustomerFollowUpLimitScope =
    campaignBookings.every((candidate) =>
      customerFollowUpLimitScopeFor(candidate) === "property")
      ? "property"
      : "customer";
  const ordinaryMessageBudget = Math.max(
    0,
    Math.min(...campaignBookings.map(customerFollowUpMessageLimitFor)) - 1,
  );
  const customerResponded = campaignBookings.some((candidate) =>
    candidate.bookingStatus !== "awaiting_response" ||
    candidate.bookingDecision !== null ||
    candidate.questionnaireStartedAt !== null
  );
  const reservedOrdinaryJobs = campaignJobs.filter((job) =>
    automaticCustomerJob(job) &&
    job.kind === "customer_followup" &&
    (
      job.status === "sent" ||
      job.status === "claimed" ||
      (
        job.status === "pending" &&
        Boolean(job.customerSharedSequenceSlotReservedAt)
      )
    )
  );
  const observedReservedOrdinary = reservedOrdinaryJobs.length;
  const sharedOrdinaryMessagesSent = campaignJobs.filter((job) =>
    automaticCustomerJob(job) &&
    job.kind === "customer_followup" &&
    job.status === "sent"
  ).length;
  const propertyOrdinaryMessageBudgets = new Map<string, number>();
  const campaignJobById = new Map(campaignJobs.map((job) => [job.id, job]));
  const eligiblePropertyOrdinaryMessageBudgets = new Map<string, number>();
  const propertiesWithActiveOrdinary = new Set<string>();
  for (const candidate of campaignBookings) {
    const budget = Math.max(0, customerFollowUpMessageLimitFor(candidate) - 1);
    if (
      candidate.isFreeProperty !== true ||
      Boolean(candidate.freeEligibilityRevokedAt) ||
      candidate.bookingStatus !== "awaiting_response" ||
      candidate.bookingDecision !== null ||
      candidate.questionnaireStartedAt !== null ||
      customerResponseExpired(candidate, now) ||
      budget <= 0
    ) continue;
    const current = eligiblePropertyOrdinaryMessageBudgets.get(
      candidate.propertyNumber,
    );
    eligiblePropertyOrdinaryMessageBudgets.set(
      candidate.propertyNumber,
      current === undefined ? budget : Math.min(current, budget),
    );
    const activeOrdinaryJob = candidate.activeCustomerNotificationJobId
      ? campaignJobById.get(candidate.activeCustomerNotificationJobId)
      : null;
    if (
      activeOrdinaryJob?.kind === "customer_followup" &&
      automaticCustomerJob(activeOrdinaryJob) &&
      (activeOrdinaryJob.status === "pending" ||
        activeOrdinaryJob.status === "claimed")
    ) {
      propertiesWithActiveOrdinary.add(candidate.propertyNumber);
    }
  }
  for (const propertyNumber of propertiesWithActiveOrdinary) {
    const budget = eligiblePropertyOrdinaryMessageBudgets.get(propertyNumber);
    if (budget !== undefined) {
      propertyOrdinaryMessageBudgets.set(propertyNumber, budget);
    }
  }
  const observedPropertyReservations: Record<string, number> = {};
  const propertyOrdinaryMessagesSent = new Map<string, number>();
  for (const reservedJob of reservedOrdinaryJobs) {
    observedPropertyReservations[reservedJob.propertyNumber] =
      (observedPropertyReservations[reservedJob.propertyNumber] || 0) + 1;
    if (reservedJob.status === "sent") {
      propertyOrdinaryMessagesSent.set(
        reservedJob.propertyNumber,
        (propertyOrdinaryMessagesSent.get(reservedJob.propertyNumber) || 0) + 1,
      );
    }
  }
  const sentFinal = campaignJobs
    .filter((job) =>
      automaticCustomerJob(job) &&
      job.kind === "customer_final_reminder" &&
      job.status === "sent"
    )
    .sort((left, right) =>
      String(left.sentAt || left.updatedAt).localeCompare(
        String(right.sentAt || right.updatedAt),
      ))[0];
  const activeFinal = campaignJobs
    .filter((job) =>
      automaticCustomerJob(job) &&
      job.kind === "customer_final_reminder" &&
      (job.status === "pending" || job.status === "claimed")
    )
    .sort((left, right) =>
      String(left.scheduledAt).localeCompare(String(right.scheduledAt)) ||
      left.id.localeCompare(right.id)
    )[0];
  const campaignId = stateId;
  const canonicalFinalJobId =
    `CUSTOMER-${stateId}--customer_final_reminder`;
  const stored = stateSnapshot.exists
    ? stateSnapshot.data() as Partial<BookingCustomerFollowUpState>
    : null;
  const storedMatchesCampaign = stored?.campaignId === campaignId;
  const storedFinalJob = storedMatchesCampaign && stored?.finalReminderJobId
    ? campaignJobs.find((job) => job.id === stored.finalReminderJobId)
    : null;
  const storedFinalStillReserved = Boolean(
    storedFinalJob &&
    (storedFinalJob.status === "pending" ||
      storedFinalJob.status === "claimed" ||
      storedFinalJob.status === "sent"),
  );
  const timestamp = now.toISOString();
  const storedPropertyReservations = storedMatchesCampaign &&
      stored?.propertyOrdinarySlotsReserved &&
      typeof stored.propertyOrdinarySlotsReserved === "object"
    ? stored.propertyOrdinarySlotsReserved
    : {};
  const propertyOrdinarySlotsReserved = Object.fromEntries(
    [...new Set([
      ...Object.keys(storedPropertyReservations),
      ...Object.keys(observedPropertyReservations),
    ])].map((propertyNumber) => [
      propertyNumber,
      Math.max(
        Number.isSafeInteger(storedPropertyReservations[propertyNumber])
          ? Number(storedPropertyReservations[propertyNumber])
          : 0,
        observedPropertyReservations[propertyNumber] || 0,
      ),
    ]),
  );
  const state: BookingCustomerFollowUpState = {
    schemaVersion: 2,
    customerSubject: booking.customerSubject,
    campaignId,
    campaignStartedAt: new Date(campaignStart).toISOString(),
    campaignEndsAt: new Date(campaignEnd).toISOString(),
    effectiveLimitScope,
    sharedOrdinarySlotsReserved: Math.max(
      observedReservedOrdinary,
      storedMatchesCampaign && Number.isSafeInteger(
          stored?.sharedOrdinarySlotsReserved,
        )
        ? Number(stored!.sharedOrdinarySlotsReserved)
        : 0,
    ),
    propertyOrdinarySlotsReserved,
    finalReminderJobId: sentFinal?.id ||
      (storedFinalStillReserved ? String(stored?.finalReminderJobId || "") : "") ||
      activeFinal?.id ||
      null,
    finalReminderSentAt: sentFinal?.sentAt ||
      (storedMatchesCampaign ? stored?.finalReminderSentAt || null : null),
    createdAt: storedMatchesCampaign && stored?.createdAt
      ? stored.createdAt
      : timestamp,
    updatedAt: timestamp,
  };
  return {
    stateRef,
    state,
    bookings: campaignBookings,
    jobs: campaignJobs,
    effectiveLimitScope,
    ordinaryMessageBudget,
    sharedOrdinaryMessagesSent,
    propertyOrdinaryMessageBudgets,
    propertyOrdinaryMessagesSent,
    customerResponded,
    canonicalFinalJobId,
  };
}

function buildCanonicalCustomerFinalReminder(options: {
  campaign: CustomerFollowUpCampaignContext;
  booking: BookingFollowUpDocument;
  scheduledAt: string;
  now: string;
  sequenceNumber: number;
  parentJobId?: string | null;
}): BookingNotificationJob {
  return {
    ...buildNotificationJob({
      booking: options.booking,
      kind: "customer_final_reminder",
      scheduledAt: options.scheduledAt,
      now: options.now,
      customerFollowUpSequenceNumber: options.sequenceNumber,
      customerFollowUpSequenceParentJobId: options.parentJobId || null,
    }),
    id: options.campaign.canonicalFinalJobId,
    customerFollowUpLimitScope: options.campaign.effectiveLimitScope,
  };
}

type NotificationStateCheck =
  | { status: "valid" }
  | { status: "invalid"; retryAt?: string };

/**
 * Booking-state gate shared by normal sends and manual resends. A job may be
 * claimed before the booking changes, so this must also run immediately before
 * the provider call rather than only while claiming the outbox record.
 */
function notificationMatchesCurrentState(
  job: Pick<BookingNotificationJob, "kind">,
  booking: BookingFollowUpDocument,
  now: Date,
): NotificationStateCheck {
  if (job.kind === "owner_contact_limit_reached") {
    return booking.isFreeProperty && !booking.freeEligibilityRevokedAt
      ? { status: "valid" }
      : { status: "invalid" };
  }
  if (isCustomerNotificationKind(job.kind)) {
    return booking.bookingStatus === "awaiting_response" &&
      booking.bookingDecision === null &&
      booking.questionnaireStartedAt === null &&
      !customerResponseExpired(booking, now)
      ? { status: "valid" }
      : { status: "invalid" };
  }
  if (booking.bookingStatus !== "confirmed") return { status: "invalid" };
  if (job.kind === "property_released") {
    return (
      booking.commissionStatus === "paid" ||
      booking.commissionStatus === "waived"
    ) && (
      booking.complianceStatus === "released" ||
      booking.complianceStatus === "clear"
    )
      ? { status: "valid" }
      : { status: "invalid" };
  }
  if (job.kind === "owner_booking_confirmed") {
    return booking.commissionStatus === "not_applicable" ||
      (
        (booking.commissionStatus === "pending" ||
          booking.commissionStatus === "overdue") &&
        booking.disputeStatus !== "pending"
      )
      ? { status: "valid" }
      : { status: "invalid" };
  }
  if (job.kind === "commission_dispute_rejected") {
    return booking.disputeStatus === "rejected" &&
      (booking.commissionStatus === "pending" ||
        booking.commissionStatus === "overdue")
      ? { status: "valid" }
      : { status: "invalid" };
  }
  if (
    job.kind.startsWith("commission_reminder_") ||
    job.kind === "property_paused"
  ) {
    const payable = booking.disputeStatus !== "pending" &&
      (booking.commissionStatus === "pending" ||
        booking.commissionStatus === "overdue");
    if (!payable) return { status: "invalid" };
    if (!booking.commissionNoticeSentAt) {
      return {
        status: "invalid",
        retryAt: new Date(
          now.getTime() + BOOKING_OWNER_NOTICE_RETRY_MS,
        ).toISOString(),
      };
    }
    if (job.kind === "property_paused") {
      const dueAt = Date.parse(booking.commissionDueAt || "");
      if (!Number.isFinite(dueAt)) return { status: "invalid" };
      if (dueAt > now.getTime()) {
        return {
          status: "invalid",
          retryAt: new Date(dueAt).toISOString(),
        };
      }
      if (
        booking.complianceStatus !== "clear" &&
        booking.complianceStatus !== "paused"
      ) return { status: "invalid" };
    }
    return { status: "valid" };
  }
  return { status: "invalid" };
}

function notificationStateChangedError(
  job: Pick<BookingNotificationJob, "kind">,
  booking: BookingFollowUpDocument,
): string {
  if (job.kind === "commission_dispute_rejected") {
    return "notification_state_changed";
  }
  const commissionControlled =
    job.kind.startsWith("commission_reminder_") ||
    job.kind === "property_paused" ||
    (
      job.kind === "owner_booking_confirmed" &&
      booking.commissionStatus !== "not_applicable"
    );
  if (!commissionControlled) return "notification_state_changed";
  if (booking.commissionStatus === "paid") return "commission_paid";
  if (booking.commissionStatus === "waived") return "commission_waived";
  if (booking.disputeStatus === "pending") return "commission_disputed";
  return "notification_state_changed";
}

function isCommissionCollectionNotification(
  job: Pick<BookingNotificationJob, "kind">,
): boolean {
  return job.kind.startsWith("commission_reminder_") ||
    job.kind === "property_paused";
}

function isCommissionPaymentPromptNotification(
  job: Pick<BookingNotificationJob, "kind">,
  booking: BookingFollowUpDocument,
): boolean {
  return isCommissionCollectionNotification(job) ||
    job.kind === "commission_dispute_rejected" ||
    (
      job.kind === "owner_booking_confirmed" &&
      booking.commissionStatus !== "not_applicable"
    );
}

function bankAttemptPausesCollection(
  attempt: BookingCommissionPaymentAttempt | null,
): boolean {
  return Boolean(
    attempt &&
    attempt.paymentMethod === "bank_transfer" &&
    [
      "creating",
      "unknown",
      "pending_review",
      "review_required",
    ].includes(attempt.status),
  );
}

export class BookingCommissionStore {
  private get db(): Firestore {
    return requireFirestore(this.database);
  }

  constructor(private readonly database?: Firestore | null) {}

  private async readCustomerCampaignForResponse(
    transaction: FirebaseFirestore.Transaction,
    booking: BookingFollowUpDocument,
    now: Date,
  ): Promise<CustomerFollowUpCampaignContext> {
    return readCustomerFollowUpCampaignContext({
      db: this.db,
      transaction,
      booking,
      now,
    });
  }

  private cancelCustomerCampaignForResponse(
    transaction: FirebaseFirestore.Transaction,
    campaign: CustomerFollowUpCampaignContext,
    respondingBookingId: string,
    timestamp: string,
  ): void {
    const cancelledJobIds = new Set<string>();
    for (const job of campaign.jobs) {
      if (
        !automaticCustomerJob(job) ||
        (job.status !== "pending" && job.status !== "claimed")
      ) continue;
      cancelledJobIds.add(job.id);
      transaction.update(
        this.db.collection(NOTIFICATIONS_COLLECTION).doc(job.id),
        {
          status: "cancelled",
          leaseToken: null,
          leaseExpiresAt: null,
          providerError: "customer_campaign_responded",
          updatedAt: timestamp,
        },
      );
    }
    transaction.set(campaign.stateRef, {
      ...campaign.state,
      updatedAt: timestamp,
    });
    for (const booking of campaign.bookings) {
      if (
        booking.id === respondingBookingId ||
        !booking.activeCustomerNotificationJobId ||
        !cancelledJobIds.has(booking.activeCustomerNotificationJobId)
      ) continue;
      transaction.update(
        this.db.collection(BOOKINGS_COLLECTION).doc(booking.id),
        {
          activeCustomerNotificationJobId: null,
          updatedAt: timestamp,
        },
      );
    }
  }

  private reanchorCustomerFinalAfterEligibilityLoss(
    transaction: FirebaseFirestore.Transaction,
    campaign: CustomerFollowUpCampaignContext,
    job: BookingNotificationJob,
    ineligibleBooking: BookingFollowUpDocument,
    now: Date,
  ): boolean {
    if (
      job.kind !== "customer_final_reminder" ||
      !automaticCustomerJob(job) ||
      campaign.customerResponded ||
      campaign.state.finalReminderSentAt
    ) return false;
    const competingFinal = campaign.jobs.find((candidateJob) =>
      candidateJob.id !== job.id &&
      candidateJob.kind === "customer_final_reminder" &&
      automaticCustomerJob(candidateJob) &&
      (candidateJob.status === "pending" || candidateJob.status === "claimed")
    );
    const replacementBooking = campaign.bookings.find((candidateBooking) =>
      candidateBooking.id !== ineligibleBooking.id &&
      candidateBooking.propertyNumber !== ineligibleBooking.propertyNumber &&
      candidateBooking.isFreeProperty === true &&
      !candidateBooking.freeEligibilityRevokedAt &&
      customerFollowUpMessageLimitFor(candidateBooking) > 0 &&
      candidateBooking.bookingStatus === "awaiting_response" &&
      candidateBooking.bookingDecision === null &&
      candidateBooking.questionnaireStartedAt === null &&
      !customerResponseExpired(candidateBooking, now) &&
      !campaign.jobs.some((candidateJob) =>
        candidateJob.id === candidateBooking.activeCustomerNotificationJobId &&
        candidateJob.kind === "customer_followup" &&
        automaticCustomerJob(candidateJob) &&
        (candidateJob.status === "pending" || candidateJob.status === "claimed")
      )
    );
    if (competingFinal || !replacementBooking) return false;
    const timestamp = now.toISOString();
    const replacementParentJobId = job.id === campaign.canonicalFinalJobId
      ? job.customerFollowUpSequenceParentJobId === job.id
        ? null
        : job.customerFollowUpSequenceParentJobId
      : job.id;
    const replacement = {
      ...buildCanonicalCustomerFinalReminder({
        campaign,
        booking: replacementBooking,
        scheduledAt: timestamp,
        now: timestamp,
        sequenceNumber: customerFollowUpMessageLimitFor(replacementBooking),
        parentJobId: replacementParentJobId,
      }),
      createdAt: job.createdAt,
      ...(job.quotaReservedWindowStartedAt === undefined
        ? {}
        : {
            quotaReservedWindowStartedAt:
              job.quotaReservedWindowStartedAt,
          }),
      ...(job.manualResendRequestedAt === undefined
        ? {}
        : { manualResendRequestedAt: job.manualResendRequestedAt }),
    };
    campaign.state.finalReminderJobId = replacement.id;
    transaction.set(
      this.db.collection(NOTIFICATIONS_COLLECTION).doc(replacement.id),
      replacement,
    );
    transaction.update(
      this.db.collection(BOOKINGS_COLLECTION).doc(replacementBooking.id),
      {
        activeCustomerNotificationJobId: replacement.id,
        events: appendEvent(replacementBooking.events, {
          type: "customer_final_reminder_scheduled",
          at: timestamp,
          detail: String(replacement.customerFollowUpSequenceNumber || ""),
        }),
        updatedAt: timestamp,
      },
    );
    transaction.set(campaign.stateRef, {
      ...campaign.state,
      updatedAt: timestamp,
    });
    return true;
  }

  private schedulePropertyCampaignFinalAfterTerminalOrdinary(
    transaction: FirebaseFirestore.Transaction,
    campaign: CustomerFollowUpCampaignContext,
    terminalJob: BookingNotificationJob,
    now: Date,
    excludedPropertyNumber?: string,
  ): BookingNotificationJob | null {
    if (
      campaign.effectiveLimitScope !== "property" ||
      terminalJob.kind !== "customer_followup" ||
      !automaticCustomerJob(terminalJob) ||
      campaign.customerResponded ||
      campaign.state.finalReminderSentAt ||
      campaign.state.finalReminderJobId
    ) return null;
    const bookingById = new Map(
      campaign.bookings.map((candidate) => [candidate.id, candidate]),
    );
    const actionableBooking = (candidate: BookingFollowUpDocument) =>
      candidate.propertyNumber !== excludedPropertyNumber &&
      candidate.isFreeProperty === true &&
      !candidate.freeEligibilityRevokedAt &&
      customerFollowUpMessageLimitFor(candidate) > 0 &&
      candidate.bookingStatus === "awaiting_response" &&
      candidate.bookingDecision === null &&
      candidate.questionnaireStartedAt === null &&
      !customerResponseExpired(candidate, now);
    const unfinishedOrdinary = campaign.jobs.some((candidateJob) => {
      if (
        candidateJob.id === terminalJob.id ||
        candidateJob.kind !== "customer_followup" ||
        !automaticCustomerJob(candidateJob) ||
        (candidateJob.status !== "pending" && candidateJob.status !== "claimed")
      ) return false;
      const candidateBooking = bookingById.get(candidateJob.bookingId);
      return Boolean(
        candidateBooking &&
        actionableBooking(candidateBooking) &&
        candidateBooking.activeCustomerNotificationJobId === candidateJob.id,
      );
    });
    if (unfinishedOrdinary) return null;
    const anchor = campaign.bookings.find(actionableBooking);
    if (!anchor) return null;
    const existingCanonical = campaign.jobs.find(
      (candidateJob) => candidateJob.id === campaign.canonicalFinalJobId,
    );
    if (
      existingCanonical &&
      (existingCanonical.status === "pending" ||
        existingCanonical.status === "claimed" ||
        existingCanonical.status === "sent")
    ) return null;
    const timestamp = now.toISOString();
    const finalJob = buildCanonicalCustomerFinalReminder({
      campaign,
      booking: anchor,
      scheduledAt: new Date(
        now.getTime() + bookingCustomerFollowUpDelayMinutesSchema.parse(
          anchor.customerFollowUpDelayMinutes ??
            BOOKING_CUSTOMER_FOLLOW_UP_DELAY_MINUTES_DEFAULT,
        ) * 60_000,
      ).toISOString(),
      now: timestamp,
      sequenceNumber: customerFollowUpMessageLimitFor(anchor),
      parentJobId: terminalJob.id,
    });
    campaign.state.finalReminderJobId = finalJob.id;
    transaction.set(
      this.db.collection(NOTIFICATIONS_COLLECTION).doc(finalJob.id),
      finalJob,
    );
    transaction.update(
      this.db.collection(BOOKINGS_COLLECTION).doc(anchor.id),
      {
        activeCustomerNotificationJobId: finalJob.id,
        events: appendEvent(anchor.events, {
          type: "customer_final_reminder_scheduled",
          at: timestamp,
          detail: String(finalJob.customerFollowUpSequenceNumber || ""),
        }),
        updatedAt: timestamp,
      },
    );
    transaction.set(campaign.stateRef, {
      ...campaign.state,
      updatedAt: timestamp,
    });
    return finalJob;
  }

  async getFreeWorkflowSettings(): Promise<BookingFreeWorkflowSettings> {
    try {
      const snapshot = await this.db.collection(SETTINGS_COLLECTION)
        .doc(FREE_WORKFLOW_SETTINGS_DOCUMENT)
        .get();
      return resolvedFreeWorkflowSettings(snapshot.exists ? snapshot.data() : null);
    } catch (error) {
      console.error(
        "Booking free-workflow settings lookup failed; using environment defaults:",
        error,
      );
      return resolvedFreeWorkflowSettings(null);
    }
  }

  async updateFreeWorkflowSettings(
    rawSettings: BookingFreeWorkflowConfiguration,
    now = new Date(),
  ): Promise<BookingFreeWorkflowSettings> {
    const settings = bookingFreeWorkflowConfigurationSchema.parse(rawSettings);
    if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid settings time");
    const settingsRef = this.db.collection(SETTINGS_COLLECTION)
      .doc(FREE_WORKFLOW_SETTINGS_DOCUMENT);
    const auditId = `BOOKING-LIMITS-${now.getTime()}-${randomBytes(6).toString("hex")}`;
    const auditRef = this.db.collection(FREE_WORKFLOW_SETTINGS_AUDIT_COLLECTION)
      .doc(auditId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(settingsRef);
      const currentData = snapshot.exists ? snapshot.data() : null;
      const currentStored = storedFreeWorkflowConfiguration(currentData);
      const currentSchemaVersion = currentData && typeof currentData === "object"
        ? Number((currentData as Record<string, unknown>).schemaVersion)
        : null;
      const currentDelayIsPersisted = currentData && typeof currentData === "object"
        ? bookingCustomerFollowUpDelayMinutesSchema.safeParse(
            (currentData as Record<string, unknown>)
              .customerFollowUpDelayMinutes,
          ).success
        : false;
      if (
        currentSchemaVersion === 7 &&
        currentDelayIsPersisted &&
        currentStored &&
        JSON.stringify(currentStored) === JSON.stringify(settings)
      ) {
        return resolvedFreeWorkflowSettings(currentData);
      }

      const updatedAt = now.toISOString();
      const storedSettings = {
        schemaVersion: 7,
        ...settings,
        updatedAt,
        updatedBy: "admin" as const,
      };
      const previous = resolvedFreeWorkflowSettings(currentData);
      transaction.set(settingsRef, storedSettings);
      transaction.create(auditRef, {
        id: auditId,
        type: "booking_free_workflow_settings_updated",
        previous,
        next: settings,
        updatedAt,
        updatedBy: "admin",
      });
      return {
        ...settings,
        updatedAt,
        updatedBy: "admin",
        source: "firestore",
      };
    });
  }

  private currentSubscriptionQuery(propertyNumber: string) {
    return this.db.collection("subscriptions")
      .where("propertyNumber", "==", propertyNumber);
  }

  /**
   * This is the authoritative side-effect gate for the booking workflow.  The
   * snapshot captured when the contact was made is intentionally immutable:
   * a workflow which did not originate on the free tier can never become
   * eligible later.  Once a free workflow observes an active premium
   * subscription it is durably closed, so a later downgrade cannot revive it.
   */
  private async ensureFreeBookingEligibility(
    transaction: FirebaseFirestore.Transaction,
    bookingRef: FirebaseFirestore.DocumentReference,
    booking: BookingFollowUpDocument,
    now: Date,
  ): Promise<boolean> {
    let activePremium = false;
    if (booking.isFreeProperty === true && !booking.freeEligibilityRevokedAt) {
      const subscriptionSnapshot = await transaction.get(
        this.currentSubscriptionQuery(booking.propertyNumber),
      );
      activePremium = isCurrentSubscriptionActivePremium(
        subscriptionSnapshot,
        booking.propertyNumber,
      );
      if (!activePremium) return true;
    }

    const propertyRef = this.db.collection("properties").doc(booking.propertyNumber);
    const jobsQuery = this.db.collection(NOTIFICATIONS_COLLECTION)
      .where("bookingId", "==", booking.id);
    const activeAttemptRef = booking.activeAttemptId
      ? this.db.collection(ATTEMPTS_COLLECTION).doc(booking.activeAttemptId)
      : null;
    const [propertySnapshot, jobsSnapshot, activeAttemptSnapshot] = await Promise.all([
      transaction.get(propertyRef),
      transaction.get(jobsQuery),
      activeAttemptRef ? transaction.get(activeAttemptRef) : Promise.resolve(null),
    ]);
    const timestamp = now.toISOString();
    const property = propertySnapshot.data() || {};
    const activeHoldIds = Array.isArray(property.commissionHold?.obligationIds)
      ? property.commissionHold.obligationIds.map(String)
      : [];
    const remainingHoldIds = activeHoldIds.filter(
      (obligationId: string) => obligationId !== booking.id,
    );
    const obligationReleased =
      booking.complianceStatus === "paused" || activeHoldIds.includes(booking.id);
    const unpaidCommission =
      booking.commissionStatus === "pending" || booking.commissionStatus === "overdue";
    const updates: Partial<BookingFollowUpDocument> = {
      freeEligibilityRevokedAt: booking.freeEligibilityRevokedAt || timestamp,
      ...(unpaidCommission ? { commissionStatus: "waived" as const } : {}),
      ...(booking.commissionStatus !== "paid" ? { activeAttemptId: null } : {}),
      complianceStatus: obligationReleased ? "released" :
        booking.complianceStatus === "paused" ? "released" : "clear",
      enforcementDeferredUntil: null,
      enforcementLastError: null,
      enforcementLeaseToken: null,
      enforcementLeaseExpiresAt: null,
      activeCustomerNotificationJobId: null,
      events: appendEventOnce(booking.events, {
        type: "booking_free_eligibility_lost",
        at: timestamp,
        detail: activePremium ? "active_premium_subscription" : "non_free_origin",
      }),
      updatedAt: timestamp,
    };
    transaction.update(bookingRef, updates);
    if (activeAttemptRef && activeAttemptSnapshot?.exists) {
      const activeAttempt = activeAttemptSnapshot.data() as BookingCommissionPaymentAttempt;
      if (
        activeAttempt.paymentMethod === "bank_transfer" &&
        (activeAttempt.status === "creating" || activeAttempt.status === "pending_review")
      ) {
        transaction.update(activeAttemptRef, {
          status: "review_required",
          bankReviewDecision: "refund_review",
          bankReviewReason: "booking_free_eligibility_lost",
          failureReason: "bank_transfer_refund_review_required",
          updatedAt: timestamp,
        });
      }
    }
    for (const jobSnapshot of jobsSnapshot.docs) {
      const job = jobSnapshot.data() as BookingNotificationJob;
      if (job.status !== "pending" && job.status !== "claimed") continue;
      transaction.update(jobSnapshot.ref, {
        status: "cancelled",
        leaseToken: null,
        leaseExpiresAt: null,
        providerError: "booking_free_eligibility_lost",
        updatedAt: timestamp,
      });
    }
    if (propertySnapshot.exists && activeHoldIds.includes(booking.id)) {
      transaction.update(propertyRef, {
        commissionHold: remainingHoldIds.length > 0
          ? {
              ...property.commissionHold,
              active: true,
              obligationIds: remainingHoldIds,
              updatedAt: timestamp,
            }
          : {
              active: false,
              obligationIds: [],
              appliedAt: property.commissionHold?.appliedAt,
              releasedAt: timestamp,
              updatedAt: timestamp,
            },
        updatedAt: timestamp,
      });
    }
    return false;
  }

  async requireCurrentFreeEligibility(
    id: string,
    now = new Date(),
  ): Promise<BookingFollowUpDocument> {
    const bookingRef = this.db.collection(BOOKINGS_COLLECTION).doc(id);
    const result = await this.db.runTransaction(async (transaction) => {
      const bookingSnapshot = await transaction.get(bookingRef);
      if (!bookingSnapshot.exists) return null;
      const booking = bookingSnapshot.data() as BookingFollowUpDocument;
      return await this.ensureFreeBookingEligibility(
        transaction,
        bookingRef,
        booking,
        now,
      ) ? booking : null;
    });
    if (!result) {
      throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
    }
    return result;
  }

  async isBookingCurrentlyFreeEligible(
    booking: BookingFollowUpDocument,
  ): Promise<boolean> {
    if (booking.isFreeProperty !== true || booking.freeEligibilityRevokedAt) return false;
    const subscriptionSnapshot = await this.currentSubscriptionQuery(
      booking.propertyNumber,
    ).get();
    return !isCurrentSubscriptionActivePremium(
      subscriptionSnapshot,
      booking.propertyNumber,
    );
  }

  async reconcilePausedFreeEligibility(
    now = new Date(),
    limit = 50,
  ): Promise<number> {
    const snapshot = await this.db.collection(BOOKINGS_COLLECTION)
      .where("complianceStatus", "==", "paused")
      .limit(Math.min(Math.max(1, limit), 100))
      .get();
    let released = 0;
    for (const document of snapshot.docs) {
      const bookingRef = document.ref;
      const changed = await this.db.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(bookingRef);
        if (!currentSnapshot.exists) return false;
        const booking = currentSnapshot.data() as BookingFollowUpDocument;
        const eligible = await this.ensureFreeBookingEligibility(
          transaction,
          bookingRef,
          booking,
          now,
        );
        return !eligible;
      });
      if (changed) released++;
    }
    return released;
  }

  async getBooking(id: string): Promise<BookingFollowUpDocument | null> {
    const snapshot = await this.db.collection(BOOKINGS_COLLECTION).doc(id).get();
    if (!snapshot.exists) return null;
    return snapshot.data() as BookingFollowUpDocument;
  }

  async getBookingForCurrentOwner(
    id: string,
  ): Promise<BookingFollowUpDocument | null> {
    const bookingRef = this.db.collection(BOOKINGS_COLLECTION).doc(id);
    return this.db.runTransaction(async (transaction) => {
      const bookingSnapshot = await transaction.get(bookingRef);
      if (!bookingSnapshot.exists) return null;
      const booking = bookingSnapshot.data() as BookingFollowUpDocument;
      if (!await this.ensureFreeBookingEligibility(
        transaction,
        bookingRef,
        booking,
        new Date(),
      )) return null;
      const propertySnapshot = await transaction.get(
        this.db.collection("properties").doc(booking.propertyNumber),
      );
      if (
        !propertySnapshot.exists ||
        !ownerIdentityMatches(booking, propertySnapshot.data() || null)
      ) {
        throw new BookingWorkflowError(
          "OWNER_IDENTITY_CHANGED",
          "Property owner identity still differs from the booking owner",
          423,
        );
      }
      return booking;
    });
  }

  async claimAdminCustomerWhatsAppContact(
    id: string,
    now = new Date(),
    templateVariant: BookingAdminCustomerWhatsAppTemplateVariant =
      "technical_support",
    cooldownMinutes: number =
      BOOKING_ADMIN_CUSTOMER_WHATSAPP_COOLDOWN_MINUTES_DEFAULT,
  ): Promise<BookingFollowUpDocument | null> {
    const selectedVariant = bookingAdminCustomerWhatsAppTemplateVariantSchema
      .parse(templateVariant);
    const validatedCooldownMinutes =
      bookingAdminCustomerWhatsAppCooldownMinutesSchema.parse(cooldownMinutes);
    if (!Number.isFinite(now.getTime())) {
      throw new RangeError("Invalid admin customer contact time");
    }
    const bookingRef = this.db.collection(BOOKINGS_COLLECTION).doc(id);
    return this.db.runTransaction(async (transaction) => {
      const bookingSnapshot = await transaction.get(bookingRef);
      if (!bookingSnapshot.exists) return null;
      const booking = bookingSnapshot.data() as BookingFollowUpDocument;
      if (!await this.ensureFreeBookingEligibility(
        transaction,
        bookingRef,
        booking,
        now,
      )) return null;

      const propertySnapshot = await transaction.get(
        this.db.collection("properties").doc(booking.propertyNumber),
      );
      if (
        !propertySnapshot.exists ||
        !ownerIdentityMatches(booking, propertySnapshot.data() || null)
      ) {
        throw new BookingWorkflowError(
          "OWNER_IDENTITY_CHANGED",
          "Property owner identity still differs from the booking owner",
          423,
        );
      }
      if (!normalizeWhatsAppDestination(booking.customerPhone)) {
        throw new BookingWorkflowError(
          "INVALID_CUSTOMER_PHONE",
          "Invalid customer phone",
          400,
        );
      }
      if (
        !adminCustomerWhatsAppTemplateVariantsForBooking(booking, now)
          .includes(selectedVariant)
      ) {
        throw new BookingWorkflowError(
          "ADMIN_CUSTOMER_WHATSAPP_TEMPLATE_UNAVAILABLE",
          "Selected WhatsApp template is unavailable for this booking",
          409,
        );
      }

      if (validatedCooldownMinutes > 0) {
        const customerBookingsSnapshot = await transaction.get(
          this.db.collection(BOOKINGS_COLLECTION)
            .where("customerSubject", "==", booking.customerSubject),
        );
        const latestOpenedAtMs = customerBookingsSnapshot.docs.reduce(
          (latest, document) => {
            const openedAt = Date.parse(String(
              (document.data() as BookingFollowUpDocument)
                .adminCustomerWhatsAppLastOpenedAt || "",
            ));
            return Number.isFinite(openedAt) && openedAt > latest
              ? openedAt
              : latest;
          },
          Number.NEGATIVE_INFINITY,
        );
        const nextAllowedAtMs = latestOpenedAtMs +
          validatedCooldownMinutes * 60 * 1_000;
        if (Number.isFinite(nextAllowedAtMs) && now.getTime() < nextAllowedAtMs) {
          throw new BookingWorkflowError(
            "ADMIN_CUSTOMER_WHATSAPP_RATE_LIMITED",
            validatedCooldownMinutes === 30
              ? "يمكن التواصل مع العميل مرة واحدة كل 30 دقيقة."
              : `يمكن التواصل مع العميل مرة واحدة كل ${validatedCooldownMinutes} دقيقة.`,
            429,
            Math.max(1, Math.ceil((nextAllowedAtMs - now.getTime()) / 1_000)),
          );
        }
      }

      const timestamp = now.toISOString();
      const updatedBooking = {
        ...booking,
        adminCustomerWhatsAppLastOpenedAt: timestamp,
        events: appendEvent(booking.events, {
          type: "admin_customer_whatsapp_opened",
          at: timestamp,
          detail: selectedVariant,
        }),
      };
      transaction.update(bookingRef, {
        adminCustomerWhatsAppLastOpenedAt: timestamp,
        events: updatedBooking.events,
      });
      return updatedBooking;
    });
  }

  async listBookingsForCustomer(customerSubject: string): Promise<BookingFollowUpDocument[]> {
    const snapshot = await this.db.collection(BOOKINGS_COLLECTION)
      .where("customerSubject", "==", customerSubject)
      .get();
    return snapshot.docs
      .map((document) => document.data() as BookingFollowUpDocument)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  async listBookingsForProperty(propertyNumber: string): Promise<BookingFollowUpDocument[]> {
    const snapshot = await this.db.collection(BOOKINGS_COLLECTION)
      .where("propertyNumber", "==", propertyNumber)
      .get();
    return snapshot.docs
      .map((document) => document.data() as BookingFollowUpDocument)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  async listAllBookings(): Promise<BookingFollowUpDocument[]> {
    const snapshot = await this.db.collection(BOOKINGS_COLLECTION)
      .orderBy("createdAt", "desc")
      .get();
    return snapshot.docs.map((document) => document.data() as BookingFollowUpDocument);
  }

  async listAllNotificationJobs(): Promise<BookingNotificationJob[]> {
    const snapshot = await this.db.collection(NOTIFICATIONS_COLLECTION)
      .orderBy("createdAt", "desc")
      .get();
    return snapshot.docs.map((document) => document.data() as BookingNotificationJob);
  }

  async recordProviderDeliveryEvent(
    event: WhatsAppProviderDeliveryEvent,
    now = new Date(),
  ): Promise<{
    result: "updated" | "duplicate" | "stale" | "not_found" | "conflict";
    jobId?: string;
  }> {
    if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid delivery update time");
    const providerMessageId = String(event.providerMessageId || "").trim();
    if (!providerMessageId || providerMessageId.length > 512) {
      return { result: "not_found" };
    }
    const candidates = await this.db.collection(NOTIFICATIONS_COLLECTION)
      .where("providerMessageId", "==", providerMessageId)
      .limit(2)
      .get();
    if (candidates.empty) return { result: "not_found" };
    if (candidates.size !== 1) return { result: "conflict" };
    const jobRef = candidates.docs[0].ref;
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(jobRef);
      if (!snapshot.exists) return { result: "not_found" } as const;
      const job = snapshot.data() as BookingNotificationJob;
      if (job.providerMessageId !== providerMessageId) {
        return { result: "not_found" } as const;
      }

      const key = whatsappProviderDeliveryEventKey(event);
      const priorKeys = Array.isArray(job.providerDeliveryEventKeys)
        ? job.providerDeliveryEventKeys.filter((value) => typeof value === "string")
        : [];
      if (priorKeys.includes(key) || job.providerDeliveryStatus === event.status) {
        return { result: "duplicate", jobId: job.id } as const;
      }
      const currentRank = job.providerDeliveryStatus
        ? PROVIDER_DELIVERY_STATUS_RANK[job.providerDeliveryStatus]
        : 0;
      if (PROVIDER_DELIVERY_STATUS_RANK[event.status] < currentRank) {
        return { result: "stale", jobId: job.id } as const;
      }

      const receivedAt = now.toISOString();
      const occurredAt = Number.isFinite(Date.parse(event.occurredAt))
        ? new Date(event.occurredAt).toISOString()
        : receivedAt;
      const timestampField = event.status === "accepted"
        ? { providerAcceptedAt: occurredAt }
        : event.status === "delivered"
          ? { providerDeliveredAt: occurredAt }
          : event.status === "read"
            ? { providerReadAt: occurredAt }
            : { providerFailedAt: occurredAt };
      transaction.update(jobRef, {
        providerDeliveryStatus: event.status,
        providerStatusUpdatedAt: occurredAt,
        providerDeliveryError: event.status === "failed"
          ? String(event.error || "provider_failed").slice(0, 500)
          : null,
        providerDeliveryEventKeys: [...priorKeys.slice(-19), key],
        ...timestampField,
        updatedAt: receivedAt,
      });
      return { result: "updated", jobId: job.id } as const;
    });
  }

  async scheduleManualNotificationResend(options: {
    bookingId: string;
    sourceJobId: string;
    idempotencyKey: string;
    now?: Date;
  }): Promise<{
    job: BookingNotificationJob;
    replayed: boolean;
  }> {
    const now = options.now || new Date();
    if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid resend time");
    const timestamp = now.toISOString();
    const digest = createHash("sha256")
      .update(`${options.bookingId}\0${options.sourceJobId}\0${options.idempotencyKey}`)
      .digest("hex")
      .slice(0, 32);
    const auditId = `BOOKING-RESEND-${digest}`;
    const bookingRef = this.db.collection(BOOKINGS_COLLECTION)
      .doc(options.bookingId);
    const sourceJobRef = this.db.collection(NOTIFICATIONS_COLLECTION)
      .doc(options.sourceJobId);
    const auditRef = this.db.collection(MANUAL_RESEND_AUDIT_COLLECTION)
      .doc(auditId);

    const result = await this.db.runTransaction(async (transaction) => {
      const [bookingSnapshot, sourceJobSnapshot, auditSnapshot] =
        await Promise.all([
          transaction.get(bookingRef),
          transaction.get(sourceJobRef),
          transaction.get(auditRef),
        ]);
      if (!bookingSnapshot.exists) {
        throw new BookingWorkflowError(
          "BOOKING_NOT_FOUND",
          "Booking not found",
          404,
        );
      }
      if (!sourceJobSnapshot.exists) {
        throw new BookingWorkflowError(
          "NOTIFICATION_NOT_FOUND",
          "Notification not found",
          404,
        );
      }
      const booking = bookingSnapshot.data() as BookingFollowUpDocument;
      const sourceJob = sourceJobSnapshot.data() as BookingNotificationJob;
      if (sourceJob.bookingId !== booking.id) {
        throw new BookingWorkflowError(
          "NOTIFICATION_NOT_FOUND",
          "Notification not found",
          404,
        );
      }

      if (auditSnapshot.exists) {
        const resendJobId = String(auditSnapshot.data()?.resendJobId || "");
        const resendJobSnapshot = await transaction.get(
          this.db.collection(NOTIFICATIONS_COLLECTION).doc(resendJobId),
        );
        if (!resendJobSnapshot.exists) {
          throw new BookingWorkflowError(
            "NOTIFICATION_RESEND_INCONSISTENT",
            "Notification resend record is incomplete",
          );
        }
        return {
          status: "ready" as const,
          job: resendJobSnapshot.data() as BookingNotificationJob,
          replayed: true,
        };
      }

      if (sourceJob.status === "claimed") {
        throw new BookingWorkflowError(
          "NOTIFICATION_SEND_IN_PROGRESS",
          "Notification is currently being sent",
        );
      }
      if (![
        "pending",
        "sent",
        "failed",
        "cancelled",
        "suppressed_quota",
      ].includes(sourceJob.status)) {
        throw new BookingWorkflowError(
          "NOTIFICATION_NOT_RESENDABLE",
          "Only completed notification records can be resent",
        );
      }
      let earlierReminderSnapshots: FirebaseFirestore.DocumentSnapshot[] = [];
      let laterReminderSnapshots: FirebaseFirestore.DocumentSnapshot[] = [];
      if (sourceJob.reminderOffsetDays) {
        const siblingReminderSnapshots = await Promise.all(
          ([3, 4, 5] as const)
            .filter((offset) => offset !== sourceJob.reminderOffsetDays)
            .map(async (offset) => ({
              offset,
              snapshot: await transaction.get(
                this.db.collection(NOTIFICATIONS_COLLECTION).doc(
                  notificationId(booking.id, `commission_reminder_${offset}`),
                ),
              ),
            })),
        );
        if (sourceJob.status === "pending") {
          earlierReminderSnapshots = siblingReminderSnapshots
            .filter(({ offset }) => offset < sourceJob.reminderOffsetDays!)
            .map(({ snapshot }) => snapshot);
        }
        laterReminderSnapshots = siblingReminderSnapshots
          .filter(({ offset }) => offset > sourceJob.reminderOffsetDays!)
          .map(({ snapshot }) => snapshot);
      }
      if (sourceJob.reminderOffsetDays) {
        const latestDueOffset = latestCommissionReminderOffsetDue(booking, now);
        const laterReminderDeliveredOrSending =
          (booking.commissionReminderOffsetsSent || [])
            .some((offset) => offset > sourceJob.reminderOffsetDays!) ||
          laterReminderSnapshots.some((snapshot) => {
            if (!snapshot.exists) return false;
            return ["claimed", "sent"].includes(
              (snapshot.data() as BookingNotificationJob).status,
            );
          });
        if (
          laterReminderDeliveredOrSending ||
          (latestDueOffset && sourceJob.reminderOffsetDays < latestDueOffset)
        ) {
          throw new BookingWorkflowError(
            "NOTIFICATION_REMINDER_SUPERSEDED",
            "A newer commission reminder is already due",
          );
        }
        if (
          sourceJob.status !== "pending" &&
          latestDueOffset !== sourceJob.reminderOffsetDays
        ) {
          throw new BookingWorkflowError(
            "NOTIFICATION_STATE_CHANGED",
            "Notification no longer matches the booking state",
          );
        }
        if (earlierReminderSnapshots.some((snapshot) =>
          snapshot.exists &&
          (snapshot.data() as BookingNotificationJob).status === "claimed"
        )) {
          throw new BookingWorkflowError(
            "NOTIFICATION_SEND_IN_PROGRESS",
            "Notification is currently being sent",
          );
        }
      }
      if (notificationMatchesCurrentState(sourceJob, booking, now).status !== "valid") {
        throw new BookingWorkflowError(
          "NOTIFICATION_STATE_CHANGED",
          "Notification no longer matches the booking state",
        );
      }

      let propertySnapshot: FirebaseFirestore.DocumentSnapshot | null = null;
      if (sourceJob.recipientRole === "owner") {
        propertySnapshot = await transaction.get(
          this.db.collection("properties").doc(booking.propertyNumber),
        );
      }
      if (!await this.ensureFreeBookingEligibility(
        transaction,
        bookingRef,
        booking,
        now,
      )) {
        return { status: "ineligible" as const };
      }
      if (
        isCommissionPaymentPromptNotification(sourceJob, booking) &&
        booking.activeAttemptId
      ) {
        const activeAttemptSnapshot = await transaction.get(
          this.db.collection(ATTEMPTS_COLLECTION).doc(
            booking.activeAttemptId,
          ),
        );
        const activeAttempt = activeAttemptSnapshot.exists
          ? activeAttemptSnapshot.data() as BookingCommissionPaymentAttempt
          : null;
        if (bankAttemptPausesCollection(activeAttempt)) {
          throw new BookingWorkflowError(
            "NOTIFICATION_STATE_CHANGED",
            "Notification no longer matches the booking state",
          );
        }
      }
      if (
        sourceJob.recipientRole === "owner" &&
        (
          !propertySnapshot?.exists ||
          !ownerIdentityMatches(booking, propertySnapshot.data() || null)
        )
      ) {
        throw new BookingWorkflowError(
          "OWNER_IDENTITY_CHANGED",
          "Property owner identity still differs from the booking owner",
          423,
        );
      }
      if (
        sourceJob.kind === "property_released" &&
        hasActivePropertyHold(propertySnapshot?.data())
      ) {
        throw new BookingWorkflowError(
          "NOTIFICATION_STATE_CHANGED",
          "Notification no longer matches the property state",
        );
      }

      // A manual send of a pending automatic customer step is an audited copy.
      // The original keeps its timer and remains the only job allowed to advance
      // the automatic sequence after provider acceptance.
      const acceleratePending = sourceJob.status === "pending" &&
        !(
          sourceJob.kind === "customer_followup" &&
          isAutomaticCustomerSequenceJob(sourceJob)
        );
      const resendJobId = acceleratePending
        ? sourceJob.id
        : `${notificationId(booking.id, sourceJob.kind)}--manual-${digest}`;
      const resendJobRef = this.db.collection(NOTIFICATIONS_COLLECTION)
        .doc(resendJobId);
      const resendJob: BookingNotificationJob = acceleratePending
        ? {
            ...sourceJob,
            scheduledAt: timestamp,
            providerError: null,
            manualResendRequestedAt: timestamp,
            updatedAt: timestamp,
          }
        : {
            ...buildNotificationJob({
              booking,
              kind: sourceJob.kind,
              scheduledAt: timestamp,
              now: timestamp,
            }),
            id: resendJobId,
            ...(isCustomerNotificationKind(sourceJob.kind)
              ? {
                  customerFollowUpSequenceNumber:
                    sourceJob.customerFollowUpSequenceNumber || 1,
                  customerFollowUpSequenceParentJobId:
                    sourceJob.customerFollowUpSequenceParentJobId || null,
                }
              : {}),
            manualResendOfJobId: sourceJob.id,
            manualResendRequestedAt: timestamp,
          };
      if (acceleratePending) {
        transaction.update(sourceJobRef, {
          scheduledAt: timestamp,
          providerError: null,
          manualResendRequestedAt: timestamp,
          updatedAt: timestamp,
        });
        for (const snapshot of earlierReminderSnapshots) {
          if (!snapshot.exists) continue;
          const earlierJob = snapshot.data() as BookingNotificationJob;
          if (earlierJob.status !== "pending") continue;
          transaction.update(snapshot.ref, {
            status: "cancelled",
            providerError: "superseded_reminder",
            updatedAt: timestamp,
          });
        }
      } else {
        transaction.create(resendJobRef, resendJob);
      }
      transaction.create(auditRef, {
        id: auditId,
        schemaVersion: 1,
        type: "booking_notification_manual_resend_requested",
        bookingId: booking.id,
        sourceJobId: sourceJob.id,
        resendJobId,
        notificationKind: sourceJob.kind,
        requestedAt: timestamp,
        requestedBy: "admin",
      });
      transaction.update(bookingRef, {
        events: appendEvent(booking.events, {
          type: "notification_manual_resend_scheduled",
          at: timestamp,
          detail: `${sourceJob.id}:${resendJobId}`,
        }),
        updatedAt: timestamp,
      });
      return { status: "ready" as const, job: resendJob, replayed: false };
    });

    if (result.status === "ineligible") {
      throw new BookingWorkflowError(
        "BOOKING_NOT_FOUND",
        "Booking not found",
        404,
      );
    }
    return { job: result.job, replayed: result.replayed };
  }

  async listPaymentAttempts(): Promise<BookingCommissionPaymentAttempt[]> {
    const snapshot = await this.db.collection(ATTEMPTS_COLLECTION).get();
    return snapshot.docs.map((document) => document.data() as BookingCommissionPaymentAttempt);
  }

  async getPaymentAttempt(id: string): Promise<BookingCommissionPaymentAttempt | null> {
    const snapshot = await this.db.collection(ATTEMPTS_COLLECTION).doc(id).get();
    return snapshot.exists
      ? snapshot.data() as BookingCommissionPaymentAttempt
      : null;
  }

  async markCustomerOpened(id: string, now = new Date()): Promise<BookingFollowUpDocument> {
    const ref = this.db.collection(BOOKINGS_COLLECTION).doc(id);
    const result = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
      const booking = snapshot.data() as BookingFollowUpDocument;
      if (!await this.ensureFreeBookingEligibility(transaction, ref, booking, now)) return null;
      if (customerResponseExpired(booking, now)) {
        throw new BookingWorkflowError(
          "BOOKING_RESPONSE_EXPIRED",
          "Booking response window expired",
          410,
        );
      }
      if (!booking.events.some((event) => event.type === "customer_opened")) {
        const at = now.toISOString();
        const updates = {
          events: appendEvent(booking.events, { type: "customer_opened", at }),
          updatedAt: at,
        };
        transaction.update(ref, updates);
        return { ...booking, ...updates };
      }
      return booking;
    });
    if (!result) throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
    return result;
  }

  async startQuestionnaire(id: string, now = new Date()): Promise<BookingFollowUpDocument> {
    const ref = this.db.collection(BOOKINGS_COLLECTION).doc(id);
    const result = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
      const booking = snapshot.data() as BookingFollowUpDocument;
      if (!await this.ensureFreeBookingEligibility(transaction, ref, booking, now)) return null;
      coreBookingRecord(booking);
      if (booking.bookingStatus === "declined") {
        throw new BookingWorkflowError("BOOKING_ALREADY_DECLINED", "Booking was already declined");
      }
      if (booking.bookingStatus === "confirmed") return booking;
      if (booking.bookingDecision === "yes") return booking;
      if (customerResponseExpired(booking, now)) {
        throw new BookingWorkflowError(
          "BOOKING_RESPONSE_EXPIRED",
          "Booking response window expired",
          410,
        );
      }
      const customerCampaign = await this.readCustomerCampaignForResponse(
        transaction,
        booking,
        now,
      );
      const at = now.toISOString();
      const updates = {
        bookingDecision: "yes" as const,
        questionnaireStartedAt: at,
        activeCustomerNotificationJobId: null,
        updatedAt: at,
      };
      transaction.update(ref, updates);
      this.cancelCustomerCampaignForResponse(
        transaction,
        customerCampaign,
        booking.id,
        at,
      );
      return { ...booking, ...updates };
    });
    if (!result) throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
    return result;
  }

  async declineBooking(id: string, now = new Date()): Promise<BookingFollowUpDocument> {
    const ref = this.db.collection(BOOKINGS_COLLECTION).doc(id);
    const result = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
      const booking = snapshot.data() as BookingFollowUpDocument;
      if (!await this.ensureFreeBookingEligibility(transaction, ref, booking, now)) return null;
      coreBookingRecord(booking);
      if (booking.bookingStatus === "declined") return booking;
      if (booking.bookingStatus === "confirmed") {
        throw new BookingWorkflowError("BOOKING_ALREADY_CONFIRMED", "Booking was already confirmed");
      }
      if (customerResponseExpired(booking, now)) {
        throw new BookingWorkflowError(
          "BOOKING_RESPONSE_EXPIRED",
          "Booking response window expired",
          410,
        );
      }
      const customerCampaign = await this.readCustomerCampaignForResponse(
        transaction,
        booking,
        now,
      );
      const at = now.toISOString();
      const updates = {
        bookingStatus: "declined" as const,
        declinedAt: at,
        bookingDecision: null,
        questionnaireStartedAt: null,
        activeCustomerNotificationJobId: null,
        updatedAt: at,
        events: appendEvent(booking.events, { type: "customer_declined", at }),
      };
      transaction.update(ref, updates);
      this.cancelCustomerCampaignForResponse(
        transaction,
        customerCampaign,
        booking.id,
        at,
      );
      return { ...booking, ...updates } as BookingFollowUpDocument;
    });
    if (!result) throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
    return result;
  }

  async reportOwnerNoResponse(
    id: string,
    customerSubject: string,
    now = new Date(),
  ): Promise<BookingFollowUpDocument> {
    const ref = this.db.collection(BOOKINGS_COLLECTION).doc(id);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) {
        throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
      }
      const booking = snapshot.data() as BookingFollowUpDocument;
      coreBookingRecord(booking);
      if (booking.customerSubject !== customerSubject) {
        throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
      }
      if (booking.bookingStatus !== "awaiting_response") {
        throw new BookingWorkflowError(
          "BOOKING_NOT_ACTIONABLE",
          "Booking is no longer awaiting a response",
        );
      }
      if (customerResponseExpired(booking, now)) {
        throw new BookingWorkflowError(
          "BOOKING_RESPONSE_EXPIRED",
          "Booking response window expired",
          410,
        );
      }
      if (booking.customerOwnerNoResponseReportedAt) return booking;

      const at = now.toISOString();
      const updates = {
        customerOwnerNoResponseReportedAt: at,
        updatedAt: at,
        events: appendEvent(booking.events, {
          type: "customer_reported_owner_no_response" as const,
          at,
        }),
      };
      transaction.update(ref, updates);
      return { ...booking, ...updates };
    });
  }

  async confirmBooking(
    id: string,
    rawFacts: BookingConfirmationFacts,
    now = new Date(),
    commissionEnabled = false,
  ): Promise<BookingFollowUpDocument> {
    const facts = bookingConfirmationFactsSchema.parse(rawFacts);
    const configuredReminderDays = new Set<number>(
      commissionEnabled
        ? [
            ...(await this.getFreeWorkflowSettings())
              .optionalCommissionReminderDays,
            5,
          ]
        : [],
    );
    const ref = this.db.collection(BOOKINGS_COLLECTION).doc(id);
    const result = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
      const booking = snapshot.data() as BookingFollowUpDocument;
      if (!await this.ensureFreeBookingEligibility(transaction, ref, booking, now)) return null;
      coreBookingRecord(booking);
      if (booking.bookingStatus === "declined") {
        throw new BookingWorkflowError("BOOKING_ALREADY_DECLINED", "Booking was already declined");
      }
      if (booking.bookingStatus === "confirmed") {
        if (JSON.stringify(booking.confirmationFacts) === JSON.stringify(facts)) return booking;
        throw new BookingWorkflowError("BOOKING_CONFIRMATION_CONFLICT", "Booking was confirmed with different facts");
      }
      if (customerResponseExpired(booking, now)) {
        throw new BookingWorkflowError(
          "BOOKING_RESPONSE_EXPIRED",
          "Booking response window expired",
          410,
        );
      }
      if (booking.bookingDecision !== "yes") {
        throw new BookingWorkflowError("BOOKING_YES_REQUIRED", "Confirm booking before submitting facts", 400);
      }

      const propertyRef = this.db.collection("properties").doc(booking.propertyNumber);
      const [propertySnapshot, customerCampaign] = await Promise.all([
        transaction.get(propertyRef),
        this.readCustomerCampaignForResponse(transaction, booking, now),
      ]);
      const confirmedAt = now.toISOString();
      const financials = buildConfirmedBookingFinancials(facts, now);
      if (
        !propertySnapshot.exists ||
        !ownerIdentityMatches(booking, propertySnapshot.data() || null)
      ) {
        const updates = {
          bookingStatus: "confirmed" as const,
          commissionStatus: "not_applicable" as const,
          confirmationFacts: financials.confirmationFacts,
          confirmedAt,
          commissionAmountHalalas: null,
          commissionDueAt: null,
          commissionNoticeSentAt: null,
          activeCustomerNotificationJobId: null,
          ...ownerIdentityReviewUpdates(booking, confirmedAt),
          events: appendEventOnce(
            appendEvent(booking.events, { type: "booking_confirmed", at: confirmedAt }),
            { type: "owner_identity_changed", at: confirmedAt, detail: "owner_identity_changed" },
          ),
        };
        transaction.update(ref, updates);
        this.cancelCustomerCampaignForResponse(
          transaction,
          customerCampaign,
          booking.id,
          confirmedAt,
        );
        return { ...booking, ...updates } as BookingFollowUpDocument;
      }
      const updates = {
        bookingStatus: "confirmed" as const,
        commissionStatus: commissionEnabled
          ? "pending" as const
          : "not_applicable" as const,
        confirmationFacts: financials.confirmationFacts,
        confirmedAt,
        commissionAmountHalalas: commissionEnabled
          ? financials.commissionAmountHalalas
          : null,
        commissionDueAt: commissionEnabled
          ? financials.commissionDueAt
          : null,
        commissionNoticeSentAt: null,
        activeCustomerNotificationJobId: null,
        updatedAt: confirmedAt,
        events: appendEvent(booking.events, { type: "booking_confirmed", at: confirmedAt }),
      };
      const confirmedBooking = { ...booking, ...updates } as BookingFollowUpDocument;
      coreBookingRecord(confirmedBooking);

      const jobs = [
        buildNotificationJob({
          booking: confirmedBooking,
          kind: "owner_booking_confirmed",
          scheduledAt: confirmedAt,
          now: confirmedAt,
        }),
        ...(commissionEnabled
          ? financials.commissionReminderSchedule
            .filter((reminder) =>
              configuredReminderDays.has(reminder.offsetDays))
            .map((reminder) =>
              buildNotificationJob({
                booking: confirmedBooking,
                kind: `commission_reminder_${reminder.offsetDays}` as BookingNotificationKind,
                scheduledAt: reminder.scheduledAt,
                now: confirmedAt,
              }))
          : []),
      ];

      transaction.update(ref, updates);
      this.cancelCustomerCampaignForResponse(
        transaction,
        customerCampaign,
        booking.id,
        confirmedAt,
      );
      for (const job of jobs) {
        transaction.create(this.db.collection(NOTIFICATIONS_COLLECTION).doc(job.id), job);
      }
      return confirmedBooking;
    });
    if (!result) throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
    return result;
  }

  async disputeCommission(
    id: string,
    reason: string,
    now = new Date(),
  ): Promise<BookingFollowUpDocument> {
    const normalizedReason = String(reason || "").trim();
    if (normalizedReason.length < 5 || normalizedReason.length > 500) {
      throw new BookingWorkflowError("INVALID_DISPUTE_REASON", "Invalid dispute reason", 400);
    }
    const ref = this.db.collection(BOOKINGS_COLLECTION).doc(id);
    const result = await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
      const booking = snapshot.data() as BookingFollowUpDocument;
      if (!await this.ensureFreeBookingEligibility(transaction, ref, booking, now)) return null;
      const [propertySnapshot, activeAttemptSnapshot] = await Promise.all([
        transaction.get(
          this.db.collection("properties").doc(booking.propertyNumber),
        ),
        booking.activeAttemptId
          ? transaction.get(
              this.db.collection(ATTEMPTS_COLLECTION).doc(booking.activeAttemptId),
            )
          : Promise.resolve(null),
      ]);
      if (
        !propertySnapshot.exists ||
        !ownerIdentityMatches(booking, propertySnapshot.data() || null)
      ) {
        throw new BookingWorkflowError(
          "OWNER_IDENTITY_CHANGED",
          "Property owner identity still differs from the booking owner",
          423,
        );
      }
      if (booking.bookingStatus !== "confirmed") {
        throw new BookingWorkflowError("COMMISSION_NOT_APPLICABLE", "Commission is not applicable");
      }
      if (booking.commissionStatus === "paid" || booking.commissionStatus === "waived") {
        throw new BookingWorkflowError("COMMISSION_ALREADY_CLOSED", "Commission is already closed");
      }
      if (activeAttemptSnapshot?.exists) {
        const activeAttempt = activeAttemptSnapshot.data() as BookingCommissionPaymentAttempt;
        if (
          activeAttempt.paymentMethod === "bank_transfer" &&
          [
            "creating",
            "pending_review",
            "review_required",
            "unknown",
          ].includes(activeAttempt.status)
        ) {
          throw new BookingWorkflowError(
            "COMMISSION_BANK_TRANSFER_UNDER_REVIEW",
            "Bank transfer receipt is under review",
            409,
          );
        }
      }
      if (booking.disputeStatus === "pending") return booking;
      if (booking.disputeStatus !== "none") {
        throw new BookingWorkflowError(
          "COMMISSION_DISPUTE_ALREADY_RESOLVED",
          "Commission dispute was already resolved",
        );
      }
      const at = now.toISOString();
      const updates = {
        disputeStatus: "pending" as const,
        disputedAt: at,
        disputeReason: normalizedReason,
        updatedAt: at,
        events: appendEvent(booking.events, { type: "commission_disputed", at }),
      };
      transaction.update(ref, updates);
      return { ...booking, ...updates };
    });
    if (!result) throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
    return result;
  }

  async resolveCommissionDispute(
    id: string,
    resolution: "resume_collection" | "cancel_commission",
    now = new Date(),
  ): Promise<{
    booking: BookingFollowUpDocument;
    propertyReleased: boolean;
    ownerNotificationScheduled: boolean;
  }> {
    const configuredReminderDays = new Set<number>(
      resolution === "resume_collection"
        ? [
            ...(await this.getFreeWorkflowSettings())
              .optionalCommissionReminderDays,
            5,
          ]
        : [],
    );
    const bookingRef = this.db.collection(BOOKINGS_COLLECTION).doc(id);
    const reminderKinds = [3, 4, 5] as const;
    const reminderRefs = reminderKinds.map((offset) =>
      this.db.collection(NOTIFICATIONS_COLLECTION).doc(
        notificationId(id, `commission_reminder_${offset}`),
      ));
    const pauseJobRef = this.db.collection(NOTIFICATIONS_COLLECTION).doc(
      notificationId(id, "property_paused"),
    );
    const ownerNoticeRef = this.db.collection(NOTIFICATIONS_COLLECTION).doc(
      notificationId(id, "owner_booking_confirmed"),
    );
    const releaseJobRef = this.db.collection(NOTIFICATIONS_COLLECTION).doc(
      notificationId(id, "property_released"),
    );
    const disputeRejectedJobRef = this.db.collection(NOTIFICATIONS_COLLECTION)
      .doc(notificationId(id, "commission_dispute_rejected"));

    const result = await this.db.runTransaction(async (transaction) => {
      const bookingSnapshot = await transaction.get(bookingRef);
      if (!bookingSnapshot.exists) {
        throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
      }
      const booking = bookingSnapshot.data() as BookingFollowUpDocument;
      if (
        resolution === "resume_collection" &&
        !await this.ensureFreeBookingEligibility(
          transaction,
          bookingRef,
          booking,
          now,
        )
      ) return null;
      if (booking.bookingStatus !== "confirmed") {
        throw new BookingWorkflowError("COMMISSION_NOT_APPLICABLE", "Commission is not applicable");
      }
      if (booking.disputeStatus !== "pending") {
        if (resolution === "resume_collection" && booking.disputeStatus === "rejected") {
          return {
            booking,
            propertyReleased: false,
            ownerNotificationScheduled: false,
          };
        }
        if (resolution === "cancel_commission" && booking.disputeStatus === "accepted") {
          const [releaseJobSnapshot, currentPropertySnapshot] = await Promise.all([
            transaction.get(releaseJobRef),
            transaction.get(
              this.db.collection("properties").doc(booking.propertyNumber),
            ),
          ]);
          const ownerNotificationScheduled =
            booking.isFreeProperty === true &&
            !booking.freeEligibilityRevokedAt &&
            currentPropertySnapshot.exists &&
            !hasActivePropertyHold(currentPropertySnapshot.data()) &&
            !releaseJobSnapshot.exists;
          if (ownerNotificationScheduled) {
            transaction.create(releaseJobRef, buildNotificationJob({
              booking,
              kind: "property_released",
              scheduledAt: now.toISOString(),
              now: now.toISOString(),
            }));
          }
          return {
            booking,
            propertyReleased: false,
            ownerNotificationScheduled,
          };
        }
        throw new BookingWorkflowError(
          "COMMISSION_DISPUTE_NOT_PENDING",
          "Commission dispute is not pending",
        );
      }

      const propertyRef = this.db.collection("properties").doc(booking.propertyNumber);
      const attemptsQuery = this.db.collection(ATTEMPTS_COLLECTION)
        .where("bookingId", "==", booking.id);
      const [
        propertySnapshot,
        attemptsSnapshot,
        ownerNoticeSnapshot,
        pauseJobSnapshot,
        releaseJobSnapshot,
        disputeRejectedJobSnapshot,
        ...reminderSnapshots
      ] = await Promise.all([
        transaction.get(propertyRef),
        transaction.get(attemptsQuery),
        transaction.get(ownerNoticeRef),
        transaction.get(pauseJobRef),
        transaction.get(releaseJobRef),
        transaction.get(disputeRejectedJobRef),
        ...reminderRefs.map((ref) => transaction.get(ref)),
      ]);

      const timestamp = now.toISOString();
      if (resolution === "resume_collection") {
        const ownerIdentityRecovery =
          booking.disputeReason === "owner_identity_changed";
        if (
          ownerIdentityRecovery &&
          !ownerIdentityMatches(booking, propertySnapshot.data() || null)
        ) {
          throw new BookingWorkflowError(
            "OWNER_IDENTITY_CHANGED",
            "Property owner identity still differs from the booking owner",
            423,
          );
        }
        const updates = {
          disputeStatus: "rejected" as const,
          enforcementDeferredUntil: null,
          enforcementLastError: null,
          updatedAt: timestamp,
          events: appendEvent(booking.events, {
            type: "commission_dispute_rejected",
            at: timestamp,
          }),
        };

        if (booking.commissionStatus === "pending" && booking.confirmedAt) {
          const schedule = calculateCommissionReminderSchedule(
            booking.commissionNoticeSentAt || booking.confirmedAt,
          );
          const resettable = reminderSnapshots
            .map((snapshot, index) => ({ snapshot, index }))
            .filter(({ snapshot, index }) =>
              configuredReminderDays.has(reminderKinds[index]) &&
              snapshot.exists &&
              (snapshot.data() as BookingNotificationJob).status === "cancelled" &&
              (
                (snapshot.data() as BookingNotificationJob).providerError === "commission_disputed" ||
                (
                  ownerIdentityRecovery &&
                  (snapshot.data() as BookingNotificationJob).providerError === "owner_identity_changed"
                )
              ));
          const future = resettable.filter(({ index }) =>
            Date.parse(schedule[index].scheduledAt) >= now.getTime());
          const selected = future.length > 0
            ? future
            : resettable.filter(({ index }) => reminderKinds[index] === 5);
          for (const { snapshot, index } of selected) {
            transaction.update(snapshot.ref, {
              status: "pending",
              scheduledAt: future.length > 0
                ? schedule[index].scheduledAt
                : timestamp,
              leaseToken: null,
              leaseExpiresAt: null,
              claimedAt: null,
              sentAt: null,
              failedAt: null,
              suppressedAt: null,
              providerError: null,
              updatedAt: timestamp,
            });
          }
          if (ownerIdentityRecovery) {
            const ownerNotice = ownerNoticeSnapshot.exists
              ? ownerNoticeSnapshot.data() as BookingNotificationJob
              : null;
            if (
              ownerNotice &&
              ownerNotice.providerError === "owner_identity_changed" &&
              ownerNotice.status === "cancelled"
            ) {
              transaction.update(ownerNoticeSnapshot.ref, {
                status: "pending",
                scheduledAt: timestamp,
                leaseToken: null,
                leaseExpiresAt: null,
                claimedAt: null,
                sentAt: null,
                failedAt: null,
                suppressedAt: null,
                providerError: null,
                updatedAt: timestamp,
              });
            }
            const pauseJob = pauseJobSnapshot.exists
              ? pauseJobSnapshot.data() as BookingNotificationJob
              : null;
            if (
              pauseJob &&
              pauseJob.providerError === "owner_identity_changed" &&
              pauseJob.status === "cancelled"
            ) {
              transaction.update(pauseJobSnapshot.ref, {
                status: "pending",
                scheduledAt: Date.parse(booking.commissionDueAt || "") > now.getTime()
                  ? booking.commissionDueAt
                  : timestamp,
                leaseToken: null,
                leaseExpiresAt: null,
                claimedAt: null,
                sentAt: null,
                failedAt: null,
                suppressedAt: null,
                providerError: null,
                updatedAt: timestamp,
              });
            }
          }
        }

        const ownerNotificationScheduled =
          !ownerIdentityRecovery && !disputeRejectedJobSnapshot.exists;
        if (ownerNotificationScheduled) {
          transaction.create(disputeRejectedJobRef, buildNotificationJob({
            booking: { ...booking, ...updates },
            kind: "commission_dispute_rejected",
            scheduledAt: timestamp,
            now: timestamp,
          }));
        }

        transaction.update(bookingRef, updates);
        return {
          booking: { ...booking, ...updates },
          propertyReleased: false,
          ownerNotificationScheduled,
        };
      }

      const attempts = attemptsSnapshot.docs.map((document) =>
        document.data() as BookingCommissionPaymentAttempt);
      const financiallyUnresolvedAttempts = attempts.filter((attempt) =>
        (
          attempt.status !== "failed" &&
          attempt.bankReviewDecision !== "refund_review"
        ) || Boolean(attempt.reversalStatus && !attempt.reversalResolution));
      if (financiallyUnresolvedAttempts.length > 0) {
        throw new BookingWorkflowError(
          "COMMISSION_PAYMENT_ATTEMPT_EXISTS",
          "A payment attempt exists and must be reviewed before cancelling the commission",
        );
      }

      const property = propertySnapshot.data() || {};
      const activeHoldIds = Array.isArray(property.commissionHold?.obligationIds)
        ? property.commissionHold.obligationIds.map(String)
        : [];
      const remainingHoldIds = activeHoldIds.filter((value: string) => value !== booking.id);
      const obligationReleased =
        booking.complianceStatus === "paused" || activeHoldIds.includes(booking.id);
      const propertyAvailableAfterResolution =
        propertySnapshot.exists &&
        isAvailableAfterCommissionRelease(property, remainingHoldIds, timestamp);
      const propertyReleased =
        obligationReleased && propertyAvailableAfterResolution;
      const updates = {
        commissionStatus: "waived" as const,
        complianceStatus: obligationReleased ? "released" as const : "clear" as const,
        activeAttemptId: null,
        disputeStatus: "accepted" as const,
        enforcementDeferredUntil: null,
        enforcementLastError: null,
        updatedAt: timestamp,
        events: appendEvent(booking.events, {
          type: "commission_dispute_accepted",
          at: timestamp,
          ...(attempts.length > 0
            ? { detail: `closed_rejected_attempts:${attempts.map((attempt) => attempt.id).join(",")}` }
            : {}),
        }),
      };

      for (const snapshot of [
        ...reminderSnapshots,
        pauseJobSnapshot,
        disputeRejectedJobSnapshot,
      ]) {
        if (!snapshot.exists) continue;
        const job = snapshot.data() as BookingNotificationJob;
        if (job.status !== "pending" && job.status !== "claimed") continue;
        transaction.update(snapshot.ref, {
          status: "cancelled",
          leaseToken: null,
          leaseExpiresAt: null,
          providerError: "commission_waived",
          updatedAt: timestamp,
        });
      }
      if (propertySnapshot.exists && obligationReleased) {
        transaction.update(propertyRef, {
          commissionHold: buildCommissionHoldAfterRelease(
            property,
            remainingHoldIds,
            timestamp,
          ),
          updatedAt: timestamp,
        });
      }
      const resolvedBooking = { ...booking, ...updates } as BookingFollowUpDocument;
      const ownerNotificationScheduled =
        booking.isFreeProperty === true &&
        !booking.freeEligibilityRevokedAt &&
        propertySnapshot.exists &&
        !releaseJobSnapshot.exists &&
        propertyAvailableAfterResolution;
      if (ownerNotificationScheduled) {
        transaction.create(releaseJobRef, buildNotificationJob({
          booking: resolvedBooking,
          kind: "property_released",
          scheduledAt: timestamp,
          now: timestamp,
        }));
      }
      transaction.update(bookingRef, updates);
      coreBookingRecord(resolvedBooking);
      return {
        booking: resolvedBooking,
        propertyReleased,
        ownerNotificationScheduled,
      };
    });
    if (!result) {
      throw new BookingWorkflowError(
        "COMMISSION_NOT_APPLICABLE",
        "Commission is not applicable",
      );
    }
    return result;
  }

  async reservePaymentAttempt(options: {
    bookingId: string;
    attemptId: string;
    merchantAttemptKey: string;
    paymentMethod: "cards" | "applepay" | "bank_transfer";
    now?: Date;
  }): Promise<
    | { status: "reserved"; booking: BookingFollowUpDocument; attempt: BookingCommissionPaymentAttempt }
    | { status: "reused"; booking: BookingFollowUpDocument; attempt: BookingCommissionPaymentAttempt }
  > {
    const now = options.now || new Date();
    const bookingRef = this.db.collection(BOOKINGS_COLLECTION).doc(options.bookingId);
    const newAttemptRef = this.db.collection(ATTEMPTS_COLLECTION).doc(options.attemptId);
    const result = await this.db.runTransaction(async (transaction) => {
      const bookingSnapshot = await transaction.get(bookingRef);
      if (!bookingSnapshot.exists) throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
      const booking = bookingSnapshot.data() as BookingFollowUpDocument;
      if (!await this.ensureFreeBookingEligibility(
        transaction,
        bookingRef,
        booking,
        now,
      )) return null;
      const propertySnapshot = await transaction.get(
        this.db.collection("properties").doc(booking.propertyNumber),
      );
      if (
        !propertySnapshot.exists ||
        !ownerIdentityMatches(booking, propertySnapshot.data() || null)
      ) {
        throw new BookingWorkflowError(
          "OWNER_IDENTITY_CHANGED",
          "Property owner identity still differs from the booking owner",
          423,
        );
      }
      if (booking.bookingStatus !== "confirmed" || booking.commissionAmountHalalas === null) {
        throw new BookingWorkflowError("COMMISSION_NOT_APPLICABLE", "Commission is not applicable");
      }
      if (booking.commissionStatus === "paid" || booking.commissionStatus === "waived") {
        throw new BookingWorkflowError("COMMISSION_ALREADY_PAID", "Commission is already paid");
      }
      if (booking.disputeStatus === "pending") {
        throw new BookingWorkflowError("COMMISSION_DISPUTED", "Commission is under review", 423);
      }

      let activeAttempt: BookingCommissionPaymentAttempt | null = null;
      let activeAttemptRef: FirebaseFirestore.DocumentReference | null = null;
      if (booking.activeAttemptId) {
        activeAttemptRef = this.db.collection(ATTEMPTS_COLLECTION).doc(booking.activeAttemptId);
        const activeAttemptSnapshot = await transaction.get(
          activeAttemptRef,
        );
        if (activeAttemptSnapshot.exists) {
          activeAttempt = activeAttemptSnapshot.data() as BookingCommissionPaymentAttempt;
        }
      }
      if (activeAttempt?.status === "created") {
        if (
          activeAttempt.paymentMethod === options.paymentMethod &&
          activeAttempt.checkoutUrl
        ) {
          return { status: "reused", booking, attempt: activeAttempt } as const;
        }
        throw new BookingWorkflowError(
          "PAYMENT_ATTEMPT_RECONCILIATION_REQUIRED",
          "The active payment attempt requires reconciliation",
        );
      }
      if (activeAttempt?.status === "pending_review") {
        if (
          activeAttempt.paymentMethod === "bank_transfer" &&
          options.paymentMethod === "bank_transfer"
        ) {
          return { status: "reused", booking, attempt: activeAttempt } as const;
        }
        throw new BookingWorkflowError(
          "PAYMENT_ATTEMPT_IN_PROGRESS",
          "A commission payment attempt is already in progress",
        );
      }
      if (activeAttempt?.status === "review_required") {
        throw new BookingWorkflowError(
          "PAYMENT_ATTEMPT_RECONCILIATION_REQUIRED",
          "The active payment attempt requires reconciliation",
        );
      }
      if (activeAttempt && (activeAttempt.status === "creating" || activeAttempt.status === "unknown")) {
        const updatedAt = Date.parse(activeAttempt.updatedAt);
        const isStale = Number.isFinite(updatedAt) &&
          now.getTime() - updatedAt >= BOOKING_PAYMENT_ATTEMPT_STALE_MS;
        if (!isStale || !activeAttemptRef) {
          throw new BookingWorkflowError(
            "PAYMENT_ATTEMPT_IN_PROGRESS",
            "A commission payment attempt is already in progress",
          );
        }
        transaction.update(activeAttemptRef, {
          status: "failed",
          failureReason: "stale_unreturned_payment_attempt",
          updatedAt: now.toISOString(),
        });
      }

      const timestamp = now.toISOString();
      const attempt: BookingCommissionPaymentAttempt = {
        id: options.attemptId,
        bookingId: booking.id,
        propertyNumber: booking.propertyNumber,
        amountCents: booking.commissionAmountHalalas,
        currency: "SAR",
        paymentMethod: options.paymentMethod,
        merchantAttemptKey: options.merchantAttemptKey,
        status: "creating",
        intentionId: null,
        paymobOrderId: null,
        checkoutUrl: null,
        transactionId: null,
        exactPaymentMethod: null,
        providerCreatedAt: null,
        paidAt: null,
        failureReason: null,
        receiptUrl: null,
        receiptObjectKey: null,
        receiptContentType: null,
        receiptSizeBytes: null,
        receiptSubmittedAt: null,
        bankReviewDecision: null,
        bankReviewReason: null,
        bankReviewedAt: null,
        bankReviewPropertyReleased: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      transaction.create(newAttemptRef, attempt);
      transaction.update(bookingRef, {
        activeAttemptId: attempt.id,
        enforcementLeaseToken: null,
        enforcementLeaseExpiresAt: null,
        updatedAt: timestamp,
      });
      return {
        status: "reserved",
        booking: {
          ...booking,
          activeAttemptId: attempt.id,
          enforcementLeaseToken: null,
          enforcementLeaseExpiresAt: null,
          updatedAt: timestamp,
        },
        attempt,
      } as const;
    });
    if (!result) throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
    return result;
  }

  async completePaymentAttemptCreation(options: {
    attemptId: string;
    intentionId: string;
    paymobOrderId: string;
    checkoutUrl: string;
    now?: Date;
  }): Promise<BookingCommissionPaymentAttempt> {
    const attemptRef = this.db.collection(ATTEMPTS_COLLECTION).doc(options.attemptId);
    const orderRef = this.db.collection(ORDER_BINDINGS_COLLECTION).doc(options.paymobOrderId);
    const now = options.now || new Date();
    const result = await this.db.runTransaction(async (transaction) => {
      const [attemptSnapshot, orderSnapshot] = await Promise.all([
        transaction.get(attemptRef),
        transaction.get(orderRef),
      ]);
      if (!attemptSnapshot.exists) throw new BookingWorkflowError("PAYMENT_ATTEMPT_NOT_FOUND", "Payment attempt not found", 404);
      const attempt = attemptSnapshot.data() as BookingCommissionPaymentAttempt;
      const sameProviderIdentity =
        attempt.intentionId === options.intentionId &&
        attempt.paymobOrderId === options.paymobOrderId &&
        attempt.checkoutUrl === options.checkoutUrl;
      if (attempt.status === "created" && !sameProviderIdentity) {
        throw new BookingWorkflowError("PAYMENT_ATTEMPT_IDENTITY_CONFLICT", "Payment identity conflict");
      }
      if (
        attempt.status !== "creating" &&
        attempt.status !== "unknown" &&
        attempt.status !== "created"
      ) {
        throw new BookingWorkflowError("PAYMENT_ATTEMPT_NOT_CREATABLE", "Payment attempt cannot be completed");
      }
      if (orderSnapshot.exists && orderSnapshot.data()?.attemptId !== attempt.id) {
        throw new BookingWorkflowError("PAYMOB_ORDER_CONFLICT", "Paymob order is already bound");
      }
      const bookingRef = this.db.collection(BOOKINGS_COLLECTION).doc(attempt.bookingId);
      const bookingSnapshot = await transaction.get(bookingRef);
      if (!bookingSnapshot.exists) {
        throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
      }
      const booking = bookingSnapshot.data() as BookingFollowUpDocument;
      const updatedAt = now.toISOString();
      const bindProviderIdentity = (
        status: "created" | "unknown",
        failureReason: string | null,
      ) => {
        const updates = {
          status,
          intentionId: options.intentionId,
          paymobOrderId: options.paymobOrderId,
          checkoutUrl: options.checkoutUrl,
          failureReason,
          updatedAt,
        };
        transaction.set(orderRef, {
          paymobOrderId: options.paymobOrderId,
          bookingId: attempt.bookingId,
          attemptId: attempt.id,
          merchantAttemptKey: attempt.merchantAttemptKey,
          amountCents: attempt.amountCents,
          currency: attempt.currency,
          intentionId: options.intentionId,
          createdAt: updatedAt,
        });
        transaction.update(attemptRef, updates);
        return { ...attempt, ...updates };
      };

      if (!await this.ensureFreeBookingEligibility(
        transaction,
        bookingRef,
        booking,
        now,
      )) {
        return {
          attempt: bindProviderIdentity(
            "unknown",
            "checkout_booking_free_eligibility_lost",
          ),
          reconciliationReason: "booking_free_eligibility_lost",
        };
      }

      const propertySnapshot = await transaction.get(
        this.db.collection("properties").doc(booking.propertyNumber),
      );
      const ownerStillCurrent = propertySnapshot.exists &&
        ownerIdentityMatches(booking, propertySnapshot.data() || null);
      const stateStillPayable =
        booking.bookingStatus === "confirmed" &&
        (booking.commissionStatus === "pending" ||
          booking.commissionStatus === "overdue") &&
        booking.commissionAmountHalalas === attempt.amountCents &&
        booking.activeAttemptId === attempt.id &&
        booking.disputeStatus !== "pending";
      if (!ownerStillCurrent || !stateStillPayable) {
        const reconciliationReason = !ownerStillCurrent
          ? "owner_identity_changed"
          : booking.disputeStatus === "pending"
            ? "commission_disputed_during_checkout_creation"
            : booking.activeAttemptId !== attempt.id
              ? "payment_attempt_superseded"
              : "commission_no_longer_payable";
        const reconciledAttempt = bindProviderIdentity(
          "unknown",
          `checkout_${reconciliationReason}`,
        );
        transaction.update(bookingRef, {
          enforcementLeaseToken: null,
          enforcementLeaseExpiresAt: null,
          updatedAt,
          events: appendEvent(booking.events, {
            type: "commission_checkout_failed",
            at: updatedAt,
            detail: reconciliationReason,
          }),
        });
        return {
          attempt: reconciledAttempt,
          reconciliationReason,
        };
      }

      if (attempt.status === "created" && sameProviderIdentity) {
        return { attempt, reconciliationReason: null };
      }
      const updates = {
        status: "created" as const,
        intentionId: options.intentionId,
        paymobOrderId: options.paymobOrderId,
        checkoutUrl: options.checkoutUrl,
        failureReason: null,
        updatedAt,
      };
      const createdAttempt = bindProviderIdentity("created", null);
      transaction.update(bookingRef, {
        updatedAt,
        events: appendEvent(
          booking.events,
          { type: "commission_checkout_created", at: updatedAt },
        ),
      });
      return {
        attempt: { ...createdAttempt, ...updates },
        reconciliationReason: null,
      };
    });
    if (result.reconciliationReason) {
      throw new BookingWorkflowError(
        "PAYMENT_ATTEMPT_RECONCILIATION_REQUIRED",
        "The payment attempt requires reconciliation",
      );
    }
    return result.attempt;
  }

  async completeBankTransferAttempt(options: {
    attemptId: string;
    receiptUrl: string;
    receiptObjectKey: string;
    receiptContentType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
    receiptSizeBytes: number;
    now?: Date;
  }): Promise<{
    status: "pending_review" | "review_required";
    attempt: BookingCommissionPaymentAttempt;
  }> {
    const now = options.now || new Date();
    const timestamp = now.toISOString();
    const attemptRef = this.db.collection(ATTEMPTS_COLLECTION)
      .doc(options.attemptId);
    return this.db.runTransaction(async (transaction) => {
      const attemptSnapshot = await transaction.get(attemptRef);
      if (!attemptSnapshot.exists) {
        throw new BookingWorkflowError(
          "PAYMENT_ATTEMPT_NOT_FOUND",
          "Payment attempt not found",
          404,
        );
      }
      const attempt = attemptSnapshot.data() as BookingCommissionPaymentAttempt;
      if (attempt.paymentMethod !== "bank_transfer") {
        throw new BookingWorkflowError(
          "PAYMENT_ATTEMPT_IDENTITY_CONFLICT",
          "Payment identity conflict",
        );
      }
      const samePersistedReceipt =
        attempt.receiptUrl === options.receiptUrl &&
        attempt.receiptObjectKey === options.receiptObjectKey &&
        attempt.receiptContentType === options.receiptContentType &&
        attempt.receiptSizeBytes === options.receiptSizeBytes;
      if (
        samePersistedReceipt &&
        (attempt.status === "pending_review" || attempt.status === "review_required")
      ) {
        return { status: attempt.status, attempt };
      }
      const receiptNotYetPersisted =
        !attempt.receiptUrl &&
        !attempt.receiptObjectKey &&
        !attempt.receiptContentType &&
        !attempt.receiptSizeBytes &&
        !attempt.receiptSubmittedAt;
      if (
        attempt.status === "review_required" &&
        attempt.bankReviewDecision === "refund_review" &&
        receiptNotYetPersisted
      ) {
        const receiptUpdates = {
          receiptUrl: options.receiptUrl,
          receiptObjectKey: options.receiptObjectKey,
          receiptContentType: options.receiptContentType,
          receiptSizeBytes: options.receiptSizeBytes,
          receiptSubmittedAt: timestamp,
          updatedAt: timestamp,
        };
        transaction.update(attemptRef, receiptUpdates);
        return {
          status: "review_required" as const,
          attempt: { ...attempt, ...receiptUpdates },
        };
      }
      if (attempt.status !== "creating") {
        throw new BookingWorkflowError(
          "PAYMENT_ATTEMPT_NOT_CREATABLE",
          "Payment attempt cannot be completed",
        );
      }

      const bookingRef = this.db.collection(BOOKINGS_COLLECTION)
        .doc(attempt.bookingId);
      const bookingSnapshot = await transaction.get(bookingRef);
      if (!bookingSnapshot.exists) {
        throw new BookingWorkflowError(
          "BOOKING_NOT_FOUND",
          "Booking not found",
          404,
        );
      }
      const booking = bookingSnapshot.data() as BookingFollowUpDocument;
      const receiptFields = {
        receiptUrl: options.receiptUrl,
        receiptObjectKey: options.receiptObjectKey,
        receiptContentType: options.receiptContentType,
        receiptSizeBytes: options.receiptSizeBytes,
        receiptSubmittedAt: timestamp,
        updatedAt: timestamp,
      };

      if (!await this.ensureFreeBookingEligibility(
        transaction,
        bookingRef,
        booking,
        now,
      )) {
        const updates = {
          ...receiptFields,
          status: "review_required" as const,
          bankReviewDecision: "refund_review" as const,
          bankReviewReason: "booking_free_eligibility_lost",
          failureReason: "bank_transfer_refund_review_required",
        };
        transaction.update(attemptRef, updates);
        return { status: "review_required" as const, attempt: { ...attempt, ...updates } };
      }

      const collectionJobRefs = [
        ...([3, 4, 5] as const).map((offset) =>
          this.db.collection(NOTIFICATIONS_COLLECTION).doc(
            notificationId(booking.id, `commission_reminder_${offset}`),
          )),
        this.db.collection(NOTIFICATIONS_COLLECTION).doc(
          notificationId(booking.id, "property_paused"),
        ),
        this.db.collection(NOTIFICATIONS_COLLECTION).doc(
          notificationId(booking.id, "commission_dispute_rejected"),
        ),
        this.db.collection(NOTIFICATIONS_COLLECTION).doc(
          notificationId(booking.id, "owner_booking_confirmed"),
        ),
      ];
      const [propertySnapshot, ...collectionJobSnapshots] = await Promise.all([
        transaction.get(
          this.db.collection("properties").doc(booking.propertyNumber),
        ),
        ...collectionJobRefs.map((ref) => transaction.get(ref)),
      ]);
      const ownerStillCurrent = propertySnapshot.exists &&
        ownerIdentityMatches(booking, propertySnapshot.data() || null);
      const stateStillPayable =
        booking.bookingStatus === "confirmed" &&
        (booking.commissionStatus === "pending" || booking.commissionStatus === "overdue") &&
        booking.commissionAmountHalalas === attempt.amountCents &&
        booking.activeAttemptId === attempt.id &&
        booking.disputeStatus !== "pending";
      if (!ownerStillCurrent || !stateStillPayable) {
        const reason = !ownerStillCurrent
          ? "owner_identity_changed"
          : booking.disputeStatus === "pending"
            ? "commission_disputed_during_receipt_upload"
            : "commission_no_longer_payable";
        const updates = {
          ...receiptFields,
          status: "review_required" as const,
          bankReviewDecision: "refund_review" as const,
          bankReviewReason: reason,
          failureReason: "bank_transfer_refund_review_required",
        };
        transaction.update(attemptRef, updates);
        transaction.update(bookingRef, {
          enforcementLeaseToken: null,
          enforcementLeaseExpiresAt: null,
          events: appendEvent(booking.events, {
            type: "commission_bank_receipt_refund_review",
            at: timestamp,
            detail: reason,
          }),
          updatedAt: timestamp,
        });
        return { status: "review_required" as const, attempt: { ...attempt, ...updates } };
      }

      const updates = {
        ...receiptFields,
        status: "pending_review" as const,
        failureReason: null,
        bankReviewDecision: null,
        bankReviewReason: null,
        bankReviewedAt: null,
        bankReviewPropertyReleased: null,
      };
      transaction.update(attemptRef, updates);
      transaction.update(bookingRef, {
        enforcementLeaseToken: null,
        enforcementLeaseExpiresAt: null,
        events: appendEvent(booking.events, {
          type: "commission_bank_receipt_submitted",
          at: timestamp,
          detail: attempt.id,
        }),
        updatedAt: timestamp,
      });
      for (const snapshot of collectionJobSnapshots) {
        if (!snapshot.exists) continue;
        const job = snapshot.data() as BookingNotificationJob;
        if (job.status !== "pending" && job.status !== "claimed") continue;
        transaction.update(snapshot.ref, {
          status: "pending",
          scheduledAt: new Date(
            now.getTime() + BOOKING_OWNER_NOTICE_RETRY_MS,
          ).toISOString(),
          leaseToken: null,
          leaseExpiresAt: null,
          providerError: "bank_transfer_under_review",
          updatedAt: timestamp,
        });
      }
      return { status: "pending_review" as const, attempt: { ...attempt, ...updates } };
    });
  }

  async resolveBankTransferAttempt(options: {
    bookingId: string;
    attemptId: string;
    resolution: "approve" | "reject";
    now?: Date;
  }): Promise<{
    status: "approved" | "rejected" | "review_required";
    bookingId: string;
    attemptId: string;
    propertyReleased: boolean;
    reviewReason: string | null;
  }> {
    const now = options.now || new Date();
    const timestamp = now.toISOString();
    const bookingRef = this.db.collection(BOOKINGS_COLLECTION)
      .doc(options.bookingId);
    const attemptRef = this.db.collection(ATTEMPTS_COLLECTION)
      .doc(options.attemptId);
    return this.db.runTransaction(async (transaction) => {
      const [bookingSnapshot, attemptSnapshot] = await Promise.all([
        transaction.get(bookingRef),
        transaction.get(attemptRef),
      ]);
      if (!bookingSnapshot.exists) {
        throw new BookingWorkflowError(
          "BOOKING_NOT_FOUND",
          "Booking not found",
          404,
        );
      }
      if (!attemptSnapshot.exists) {
        throw new BookingWorkflowError(
          "PAYMENT_ATTEMPT_NOT_FOUND",
          "Payment attempt not found",
          404,
        );
      }
      const booking = bookingSnapshot.data() as BookingFollowUpDocument;
      const attempt = attemptSnapshot.data() as BookingCommissionPaymentAttempt;
      if (
        attempt.bookingId !== booking.id ||
        attempt.paymentMethod !== "bank_transfer"
      ) {
        throw new BookingWorkflowError(
          "PAYMENT_ATTEMPT_IDENTITY_CONFLICT",
          "Payment identity conflict",
        );
      }

      if (
        attempt.status === "paid" &&
        attempt.bankReviewDecision === "approved" &&
        booking.commissionStatus === "paid" &&
        booking.paidAttemptId === attempt.id
      ) {
        if (options.resolution !== "approve") {
          throw new BookingWorkflowError(
            "BANK_TRANSFER_REVIEW_CONFLICT",
            "Bank transfer was already approved",
            409,
          );
        }
        return {
          status: "approved" as const,
          bookingId: booking.id,
          attemptId: attempt.id,
          propertyReleased: attempt.bankReviewPropertyReleased === true,
          reviewReason: null,
        };
      }
      if (
        attempt.status === "failed" &&
        attempt.bankReviewDecision === "rejected"
      ) {
        if (options.resolution !== "reject") {
          throw new BookingWorkflowError(
            "BANK_TRANSFER_REVIEW_CONFLICT",
            "Bank transfer was already rejected",
            409,
          );
        }
        return {
          status: "rejected" as const,
          bookingId: booking.id,
          attemptId: attempt.id,
          propertyReleased: false,
          reviewReason: attempt.bankReviewReason || null,
        };
      }
      if (
        attempt.status === "review_required" ||
        attempt.bankReviewDecision === "refund_review"
      ) {
        return {
          status: "review_required" as const,
          bookingId: booking.id,
          attemptId: attempt.id,
          propertyReleased: false,
          reviewReason: attempt.bankReviewReason || "manual_refund_review_required",
        };
      }
      if (
        attempt.status !== "pending_review" ||
        !attempt.receiptUrl ||
        !attempt.receiptObjectKey ||
        !attempt.receiptSubmittedAt
      ) {
        throw new BookingWorkflowError(
          "PAYMENT_ATTEMPT_NOT_REVIEWABLE",
          "Payment attempt is not ready for review",
        );
      }

      if (!await this.ensureFreeBookingEligibility(
        transaction,
        bookingRef,
        booking,
        now,
      )) {
        transaction.update(attemptRef, {
          status: "review_required",
          bankReviewDecision: "refund_review",
          bankReviewReason: "booking_free_eligibility_lost",
          failureReason: "bank_transfer_refund_review_required",
          updatedAt: timestamp,
        });
        return {
          status: "review_required" as const,
          bookingId: booking.id,
          attemptId: attempt.id,
          propertyReleased: false,
          reviewReason: "booking_free_eligibility_lost",
        };
      }

      const propertyRef = this.db.collection("properties")
        .doc(booking.propertyNumber);
      const releaseJobRef = this.db.collection(NOTIFICATIONS_COLLECTION).doc(
        notificationId(booking.id, "property_released"),
      );
      const staleCollectionJobRefs = [
        ...([3, 4, 5] as const).map((offset) =>
          this.db.collection(NOTIFICATIONS_COLLECTION).doc(
            notificationId(booking.id, `commission_reminder_${offset}`),
          )),
        this.db.collection(NOTIFICATIONS_COLLECTION).doc(
          notificationId(booking.id, "property_paused"),
        ),
        this.db.collection(NOTIFICATIONS_COLLECTION).doc(
          notificationId(booking.id, "commission_dispute_rejected"),
        ),
        this.db.collection(NOTIFICATIONS_COLLECTION).doc(
          notificationId(booking.id, "owner_booking_confirmed"),
        ),
      ];
      const [
        propertySnapshot,
        releaseJobSnapshot,
        ...staleCollectionJobSnapshots
      ] = await Promise.all([
        transaction.get(propertyRef),
        transaction.get(releaseJobRef),
        ...staleCollectionJobRefs.map((ref) => transaction.get(ref)),
      ]);
      const ownerStillCurrent = propertySnapshot.exists &&
        ownerIdentityMatches(booking, propertySnapshot.data() || null);
      const stateStillPayable =
        booking.bookingStatus === "confirmed" &&
        (booking.commissionStatus === "pending" || booking.commissionStatus === "overdue") &&
        booking.commissionAmountHalalas === attempt.amountCents &&
        booking.activeAttemptId === attempt.id;
      if (!ownerStillCurrent || !stateStillPayable) {
        const reason = ownerStillCurrent
          ? "commission_no_longer_payable"
          : "owner_identity_changed";
        transaction.update(attemptRef, {
          status: "review_required",
          bankReviewDecision: "refund_review",
          bankReviewReason: reason,
          bankReviewedAt: timestamp,
          failureReason: "bank_transfer_refund_review_required",
          updatedAt: timestamp,
        });
        transaction.update(bookingRef, {
          events: appendEvent(booking.events, {
            type: "commission_bank_receipt_refund_review",
            at: timestamp,
            detail: reason,
          }),
          updatedAt: timestamp,
        });
        return {
          status: "review_required" as const,
          bookingId: booking.id,
          attemptId: attempt.id,
          propertyReleased: false,
          reviewReason: reason,
        };
      }
      if (booking.disputeStatus === "pending") {
        throw new BookingWorkflowError(
          "COMMISSION_DISPUTED",
          "Commission is under review",
          423,
        );
      }

      if (options.resolution === "reject") {
        const noticeAnchor = booking.commissionNoticeSentAt;
        const reminderSchedule = noticeAnchor
          ? calculateCommissionReminderSchedule(noticeAnchor)
          : null;
        const fallbackRetryAt = new Date(
          now.getTime() + BOOKING_OWNER_NOTICE_RETRY_MS,
        ).toISOString();
        for (let index = 0; index < staleCollectionJobSnapshots.length; index++) {
          const snapshot = staleCollectionJobSnapshots[index];
          if (!snapshot?.exists) continue;
          const job = snapshot.data() as BookingNotificationJob;
          if (job.status !== "pending" && job.status !== "claimed") continue;
          const desiredAt = index < 3
            ? reminderSchedule?.[index]?.scheduledAt || fallbackRetryAt
            : index === 3
              ? booking.commissionDueAt || fallbackRetryAt
              : timestamp;
          const desiredAtMs = Date.parse(desiredAt);
          transaction.update(snapshot.ref, {
            status: "pending",
            scheduledAt: Number.isFinite(desiredAtMs) && desiredAtMs > now.getTime()
              ? new Date(desiredAtMs).toISOString()
              : timestamp,
            leaseToken: null,
            leaseExpiresAt: null,
            claimedAt: null,
            providerError: !noticeAnchor && index < 4
              ? "awaiting_owner_commission_notice"
              : null,
            updatedAt: timestamp,
          });
        }
        transaction.update(attemptRef, {
          status: "failed",
          bankReviewDecision: "rejected",
          bankReviewReason: "receipt_rejected_by_admin",
          bankReviewedAt: timestamp,
          bankReviewPropertyReleased: false,
          failureReason: "bank_transfer_rejected",
          updatedAt: timestamp,
        });
        transaction.update(bookingRef, {
          activeAttemptId: null,
          enforcementLeaseToken: null,
          enforcementLeaseExpiresAt: null,
          enforcementDeferredUntil: null,
          enforcementLastError: null,
          events: appendEvent(booking.events, {
            type: "commission_bank_receipt_rejected",
            at: timestamp,
            detail: attempt.id,
          }),
          updatedAt: timestamp,
        });
        return {
          status: "rejected" as const,
          bookingId: booking.id,
          attemptId: attempt.id,
          propertyReleased: false,
          reviewReason: "receipt_rejected_by_admin",
        };
      }

      const property = propertySnapshot.data() || {};
      const activeHoldIds = Array.isArray(property.commissionHold?.obligationIds)
        ? property.commissionHold.obligationIds.map(String)
        : [];
      const remainingHoldIds = activeHoldIds.filter(
        (value: string) => value !== booking.id,
      );
      const obligationReleased =
        booking.complianceStatus === "paused" ||
        activeHoldIds.includes(booking.id);
      const propertyReleased =
        propertySnapshot.exists &&
        obligationReleased &&
        isAvailableAfterCommissionRelease(
          property,
          remainingHoldIds,
          timestamp,
        );
      transaction.update(attemptRef, {
        status: "paid",
        transactionId: `BANK-${attempt.id}`,
        exactPaymentMethod: "bank_transfer",
        paidAt: timestamp,
        bankReviewDecision: "approved",
        bankReviewReason: null,
        bankReviewedAt: timestamp,
        bankReviewPropertyReleased: propertyReleased,
        failureReason: null,
        updatedAt: timestamp,
      });
      transaction.update(bookingRef, {
        commissionStatus: "paid",
        complianceStatus: obligationReleased ? "released" : "clear",
        commissionPaidAt: timestamp,
        paidAttemptId: attempt.id,
        activeAttemptId: attempt.id,
        enforcementDeferredUntil: null,
        enforcementLastError: null,
        enforcementLeaseToken: null,
        enforcementLeaseExpiresAt: null,
        events: appendEvent(
          appendEvent(booking.events, {
            type: "commission_bank_receipt_approved",
            at: timestamp,
            detail: attempt.id,
          }),
          { type: "commission_paid", at: timestamp },
        ),
        updatedAt: timestamp,
      });
      for (const snapshot of staleCollectionJobSnapshots) {
        if (!snapshot.exists) continue;
        const job = snapshot.data() as BookingNotificationJob;
        if (job.status !== "pending" && job.status !== "claimed") continue;
        transaction.update(snapshot.ref, {
          status: "cancelled",
          leaseToken: null,
          leaseExpiresAt: null,
          providerError: "commission_paid",
          updatedAt: timestamp,
        });
      }
      if (propertySnapshot.exists && obligationReleased) {
        transaction.update(propertyRef, {
          commissionHold: buildCommissionHoldAfterRelease(
            property,
            remainingHoldIds,
            timestamp,
          ),
          updatedAt: timestamp,
        });
      }
      if (propertyReleased && !releaseJobSnapshot.exists) {
        transaction.create(releaseJobRef, buildNotificationJob({
          booking,
          kind: "property_released",
          scheduledAt: timestamp,
          now: timestamp,
        }));
      }
      return {
        status: "approved" as const,
        bookingId: booking.id,
        attemptId: attempt.id,
        propertyReleased,
        reviewReason: null,
      };
    });
  }

  async markPaymentAttemptCreationFailure(options: {
    attemptId: string;
    certainty: "rejected" | "unknown";
    reason: string;
    createdIntention?: {
      intentionId: string;
      checkoutUrl: string;
      paymobOrderId?: string;
    };
    now?: Date;
  }): Promise<void> {
    const attemptRef = this.db.collection(ATTEMPTS_COLLECTION).doc(options.attemptId);
    await this.db.runTransaction(async (transaction) => {
      const attemptSnapshot = await transaction.get(attemptRef);
      if (!attemptSnapshot.exists) return;
      const attempt = attemptSnapshot.data() as BookingCommissionPaymentAttempt;
      if (attempt.status !== "creating") return;
      const updatedAt = (options.now || new Date()).toISOString();
      const bookingRef = this.db.collection(BOOKINGS_COLLECTION).doc(attempt.bookingId);
      const bookingSnapshot = await transaction.get(bookingRef);
      transaction.update(attemptRef, {
        status: options.certainty === "rejected" ? "failed" : "unknown",
        ...(options.createdIntention
          ? {
              intentionId: options.createdIntention.intentionId,
              checkoutUrl: options.createdIntention.checkoutUrl,
              paymobOrderId: options.createdIntention.paymobOrderId || null,
            }
          : {}),
        failureReason: options.reason.slice(0, 500),
        updatedAt,
      });
      if (bookingSnapshot.exists) {
        const booking = bookingSnapshot.data() as BookingFollowUpDocument;
        transaction.update(bookingRef, {
          ...(options.certainty === "rejected" ? { activeAttemptId: null } : {}),
          updatedAt,
          events: appendEvent(booking.events, {
            type: "commission_checkout_failed",
            at: updatedAt,
            detail: options.certainty,
          }),
        });
      }
    });
  }

  async expireStaleUnreturnedPaymentAttempt(
    bookingId: string,
    now = new Date(),
  ): Promise<boolean> {
    const bookingRef = this.db.collection(BOOKINGS_COLLECTION).doc(bookingId);
    return this.db.runTransaction(async (transaction) => {
      const bookingSnapshot = await transaction.get(bookingRef);
      if (!bookingSnapshot.exists) return false;
      const booking = bookingSnapshot.data() as BookingFollowUpDocument;
      if (!booking.activeAttemptId) return false;
      const attemptRef = this.db.collection(ATTEMPTS_COLLECTION).doc(booking.activeAttemptId);
      const attemptSnapshot = await transaction.get(attemptRef);
      if (!attemptSnapshot.exists) return false;
      const attempt = attemptSnapshot.data() as BookingCommissionPaymentAttempt;
      if (attempt.status !== "creating" && attempt.status !== "unknown") return false;
      const updatedAt = Date.parse(attempt.updatedAt);
      if (
        !Number.isFinite(updatedAt) ||
        now.getTime() - updatedAt < BOOKING_PAYMENT_ATTEMPT_STALE_MS
      ) return false;
      const timestamp = now.toISOString();
      transaction.update(attemptRef, {
        status: "failed",
        failureReason: "stale_unreturned_payment_attempt",
        updatedAt: timestamp,
      });
      transaction.update(bookingRef, {
        activeAttemptId: null,
        updatedAt: timestamp,
        events: appendEvent(booking.events, {
          type: "commission_checkout_failed",
          at: timestamp,
          detail: "stale_unreturned_payment_attempt",
        }),
      });
      return true;
    });
  }

  async settleCommissionCallback(
    input: BookingCommissionWebhookInput,
    now = new Date(),
  ): Promise<
    | { status: "paid" | "duplicate_paid" | "failure_recorded" | "already_processed"; bookingId: string; released: boolean }
    | { status: "rejected"; reason: string }
  > {
    const orderRef = this.db.collection(ORDER_BINDINGS_COLLECTION).doc(input.paymobOrderId);
    return this.db.runTransaction(async (transaction) => {
      const orderSnapshot = await transaction.get(orderRef);
      if (!orderSnapshot.exists) return { status: "rejected", reason: "order_not_found" } as const;
      const binding = orderSnapshot.data()!;
      const attemptRef = this.db.collection(ATTEMPTS_COLLECTION).doc(String(binding.attemptId));
      const bookingRef = this.db.collection(BOOKINGS_COLLECTION).doc(String(binding.bookingId));
      const transactionRef = this.db.collection(TRANSACTION_BINDINGS_COLLECTION).doc(input.transactionId);
      const [attemptSnapshot, bookingSnapshot, transactionSnapshot] = await Promise.all([
        transaction.get(attemptRef),
        transaction.get(bookingRef),
        transaction.get(transactionRef),
      ]);
      if (!attemptSnapshot.exists || !bookingSnapshot.exists) {
        return { status: "rejected", reason: "local_identity_missing" } as const;
      }
      const attempt = attemptSnapshot.data() as BookingCommissionPaymentAttempt;
      const booking = bookingSnapshot.data() as BookingFollowUpDocument;
      const conflicts = [
        attempt.paymobOrderId !== input.paymobOrderId,
        attempt.bookingId !== booking.id,
        attempt.amountCents !== input.amountCents,
        input.currency.trim().toUpperCase() !== "SAR",
        input.callbackAttemptId && input.callbackAttemptId !== attempt.id,
        input.callbackBookingId && input.callbackBookingId !== booking.id,
        input.callbackMerchantAttemptKey && input.callbackMerchantAttemptKey !== attempt.merchantAttemptKey,
        input.callbackSpecialReference && input.callbackSpecialReference !== attempt.merchantAttemptKey,
        binding.merchantAttemptKey !== attempt.merchantAttemptKey,
        Number(binding.amountCents) !== attempt.amountCents,
        String(binding.currency || "").toUpperCase() !== "SAR",
      ].some(Boolean);
      if (conflicts) return { status: "rejected", reason: "identity_mismatch" } as const;
      if (transactionSnapshot.exists) {
        const transactionBinding = transactionSnapshot.data() || {};
        if (
          transactionBinding.bookingId !== booking.id ||
          transactionBinding.attemptId !== attempt.id
        ) {
          return { status: "rejected", reason: "transaction_conflict" } as const;
        }
        if (!(input.success && transactionBinding.success === false)) {
          return {
            status: "already_processed",
            bookingId: booking.id,
            released: booking.complianceStatus === "released",
          } as const;
        }
      }
      if (
        (attempt.status === "paid" || attempt.status === "duplicate_paid") &&
        !input.success
      ) {
        return { status: "already_processed", bookingId: booking.id, released: booking.complianceStatus === "released" } as const;
      }

      const timestamp = now.toISOString();
      if (!input.success) {
        transaction.update(attemptRef, {
          status: "failed",
          transactionId: input.transactionId,
          failureReason: "provider_callback_failure",
          providerCreatedAt: input.providerCreatedAt || null,
          updatedAt: timestamp,
        });
        transaction.update(bookingRef, {
          ...(booking.activeAttemptId === attempt.id ? { activeAttemptId: null } : {}),
          updatedAt: timestamp,
          events: appendEvent(booking.events, { type: "commission_payment_failed", at: timestamp }),
        });
        transaction.create(transactionRef, {
          transactionId: input.transactionId,
          bookingId: booking.id,
          attemptId: attempt.id,
          success: false,
          createdAt: timestamp,
        });
        return { status: "failure_recorded", bookingId: booking.id, released: false } as const;
      }
      if (!input.exactPaymentMethod) {
        return { status: "rejected", reason: "payment_method_missing" } as const;
      }

      if (attempt.status === "paid" || attempt.status === "duplicate_paid") {
        transaction.update(attemptRef, {
          status: "duplicate_paid",
          failureReason: "duplicate_financial_success",
          updatedAt: timestamp,
        });
        transaction.create(transactionRef, {
          transactionId: input.transactionId,
          bookingId: booking.id,
          attemptId: attempt.id,
          success: true,
          duplicate: true,
          createdAt: timestamp,
        });
        transaction.update(bookingRef, {
          updatedAt: timestamp,
          events: appendEvent(booking.events, {
            type: "commission_duplicate_payment",
            at: timestamp,
            detail: attempt.id,
          }),
        });
        return {
          status: "duplicate_paid",
          bookingId: booking.id,
          released: booking.complianceStatus === "released",
        } as const;
      }

      if (booking.commissionStatus === "paid" || booking.commissionStatus === "waived") {
        transaction.update(attemptRef, {
          status: "duplicate_paid",
          transactionId: input.transactionId,
          exactPaymentMethod: input.exactPaymentMethod,
          providerCreatedAt: input.providerCreatedAt || null,
          paidAt: timestamp,
          failureReason: "duplicate_financial_success",
          financialReviewDecision: "refund_review",
          financialReviewReason: "commission_already_closed",
          updatedAt: timestamp,
        });
        transaction.set(transactionRef, {
          transactionId: input.transactionId,
          bookingId: booking.id,
          attemptId: attempt.id,
          success: true,
          duplicate: true,
          createdAt: timestamp,
        });
        transaction.update(bookingRef, {
          updatedAt: timestamp,
          events: appendEvent(booking.events, {
            type: "commission_duplicate_payment",
            at: timestamp,
            detail: attempt.id,
          }),
        });
        return {
          status: "duplicate_paid",
          bookingId: booking.id,
          released: booking.complianceStatus === "released",
        } as const;
      }

      const recordRefundReview = (
        reason: string,
        appendBookingEvent: boolean,
      ) => {
        transaction.update(attemptRef, {
          status: "duplicate_paid",
          transactionId: input.transactionId,
          exactPaymentMethod: input.exactPaymentMethod!,
          providerCreatedAt: input.providerCreatedAt || null,
          paidAt: timestamp,
          failureReason: "duplicate_financial_success",
          financialReviewDecision: "refund_review",
          financialReviewReason: reason,
          updatedAt: timestamp,
        });
        transaction.set(transactionRef, {
          transactionId: input.transactionId,
          bookingId: booking.id,
          attemptId: attempt.id,
          success: true,
          duplicate: true,
          refundReview: true,
          reviewReason: reason,
          createdAt: timestamp,
        });
        if (appendBookingEvent) {
          transaction.update(bookingRef, {
            updatedAt: timestamp,
            events: appendEvent(booking.events, {
              type: "commission_duplicate_payment",
              at: timestamp,
              detail: `refund_review:${reason}:${attempt.id}`,
            }),
          });
        }
      };

      if (!await this.ensureFreeBookingEligibility(
        transaction,
        bookingRef,
        booking,
        now,
      )) {
        // ensureFreeBookingEligibility already wrote the canonical booking
        // transition and cancelled its jobs. Do not overwrite those writes
        // using the stale booking snapshot; retain only the financial record.
        recordRefundReview("booking_free_eligibility_lost", false);
        return {
          status: "duplicate_paid",
          bookingId: booking.id,
          released: false,
        } as const;
      }

      const propertyRef = this.db.collection("properties").doc(booking.propertyNumber);
      const staleCollectionJobRefs = [
        ...([3, 4, 5] as const).map((offset) =>
          this.db.collection(NOTIFICATIONS_COLLECTION).doc(
            notificationId(booking.id, `commission_reminder_${offset}`),
          )),
        this.db.collection(NOTIFICATIONS_COLLECTION).doc(
          notificationId(booking.id, "property_paused"),
        ),
        this.db.collection(NOTIFICATIONS_COLLECTION).doc(
          notificationId(booking.id, "commission_dispute_rejected"),
        ),
        this.db.collection(NOTIFICATIONS_COLLECTION).doc(
          notificationId(booking.id, "owner_booking_confirmed"),
        ),
      ];
      const [propertySnapshot, ...staleCollectionJobSnapshots] =
        await Promise.all([
          transaction.get(propertyRef),
          ...staleCollectionJobRefs.map((ref) => transaction.get(ref)),
        ]);
      const property = propertySnapshot.data() || {};
      const ownerStillCurrent = propertySnapshot.exists &&
        ownerIdentityMatches(booking, property);
      const stateStillPayable =
        booking.bookingStatus === "confirmed" &&
        (booking.commissionStatus === "pending" ||
          booking.commissionStatus === "overdue") &&
        booking.commissionAmountHalalas === attempt.amountCents &&
        booking.activeAttemptId === attempt.id;
      if (!ownerStillCurrent || !stateStillPayable) {
        const reason = !ownerStillCurrent
          ? "owner_identity_changed"
          : booking.activeAttemptId !== attempt.id
              ? "payment_attempt_superseded"
              : "commission_no_longer_payable";
        recordRefundReview(reason, true);
        return {
          status: "duplicate_paid",
          bookingId: booking.id,
          released: false,
        } as const;
      }
      const activeHoldIds = Array.isArray(property.commissionHold?.obligationIds)
        ? property.commissionHold.obligationIds.map(String)
        : [];
      const remainingHoldIds = activeHoldIds.filter((value: string) => value !== booking.id);
      const wasPaused = booking.complianceStatus === "paused" || activeHoldIds.includes(booking.id);
      const obligationReleased = wasPaused;
      const propertyReleased =
        propertySnapshot.exists &&
        wasPaused &&
        isAvailableAfterCommissionRelease(
          property,
          remainingHoldIds,
          timestamp,
        );
      const resolvesAuthorizationOnly =
        attempt.reversalStatus === "authorization_only";
      const paymentEvents = resolvesAuthorizationOnly
        ? booking.events.map((event) =>
            event.type === "commission_payment_reversal_reported" &&
              event.detail === "authorization_only"
              ? {
                  ...event,
                  type: "commission_payment_authorized" as const,
                }
              : event)
        : booking.events;

      transaction.update(attemptRef, {
        status: "paid",
        transactionId: input.transactionId,
        exactPaymentMethod: input.exactPaymentMethod,
        providerCreatedAt: input.providerCreatedAt || null,
        paidAt: timestamp,
        failureReason: null,
        ...(resolvesAuthorizationOnly
          ? {
              authorizationTransactionId:
                attempt.reversalTransactionId || null,
              authorizedAt: attempt.reversedAt || null,
              reversalStatus: null,
              reversalTransactionId: null,
              reversedAt: null,
              reversalResolution: null,
              reversalResolvedAt: null,
            }
          : {}),
        updatedAt: timestamp,
      });
      transaction.update(bookingRef, {
        commissionStatus: "paid",
        complianceStatus: obligationReleased ? "released" : "clear",
        commissionPaidAt: timestamp,
        paidAttemptId: attempt.id,
        activeAttemptId: attempt.id,
        ...(booking.disputeStatus === "pending"
          ? { disputeStatus: "rejected" as const }
          : {}),
        ...(resolvesAuthorizationOnly &&
            booking.enforcementLastError ===
              "commission_payment_authorization_only_requires_admin_review"
          ? { enforcementLastError: null }
          : {}),
        updatedAt: timestamp,
        events: appendEvent(paymentEvents, {
          type: "commission_paid",
          at: timestamp,
          ...(booking.disputeStatus === "pending"
            ? { detail: "dispute_resolved_by_payment" }
            : {}),
        }),
      });
      for (const snapshot of staleCollectionJobSnapshots) {
        if (!snapshot.exists) continue;
        const job = snapshot.data() as BookingNotificationJob;
        if (job.status !== "pending" && job.status !== "claimed") continue;
        transaction.update(snapshot.ref, {
          status: "cancelled",
          leaseToken: null,
          leaseExpiresAt: null,
          providerError: "commission_paid",
          updatedAt: timestamp,
        });
      }
      transaction.set(transactionRef, {
        transactionId: input.transactionId,
        bookingId: booking.id,
        attemptId: attempt.id,
        success: true,
        createdAt: timestamp,
      });
      if (propertySnapshot.exists && wasPaused) {
        transaction.update(propertyRef, {
          commissionHold: buildCommissionHoldAfterRelease(
            property,
            remainingHoldIds,
            timestamp,
          ),
          updatedAt: timestamp,
        });
      }
      if (propertyReleased) {
        const releaseJob = buildNotificationJob({
          booking,
          kind: "property_released",
          scheduledAt: timestamp,
          now: timestamp,
        });
        transaction.set(this.db.collection(NOTIFICATIONS_COLLECTION).doc(releaseJob.id), releaseJob);
      }
      return { status: "paid", bookingId: booking.id, released: propertyReleased } as const;
    });
  }

  async recordCommissionReversal(options: {
    paymobOrderId: string;
    transactionId: string;
    amountCents: number;
    currency: string;
    reason: "refunded" | "voided" | "errored" | "authorization_only" | "other_nonpayable";
    now?: Date;
  }): Promise<
    | { status: "recorded"; bookingId: string; reviewRequired: boolean }
    | { status: "already_processed"; bookingId: string }
    | { status: "rejected"; reason: string }
  > {
    const orderRef = this.db.collection(ORDER_BINDINGS_COLLECTION).doc(options.paymobOrderId);
    const reversalRef = this.db.collection(REVERSAL_BINDINGS_COLLECTION).doc(options.transactionId);
    return this.db.runTransaction(async (transaction) => {
      const [orderSnapshot, reversalSnapshot] = await Promise.all([
        transaction.get(orderRef),
        transaction.get(reversalRef),
      ]);
      if (!orderSnapshot.exists) return { status: "rejected", reason: "order_not_found" } as const;
      const binding = orderSnapshot.data() || {};
      const attemptRef = this.db.collection(ATTEMPTS_COLLECTION).doc(String(binding.attemptId || ""));
      const bookingRef = this.db.collection(BOOKINGS_COLLECTION).doc(String(binding.bookingId || ""));
      const [attemptSnapshot, bookingSnapshot] = await Promise.all([
        transaction.get(attemptRef),
        transaction.get(bookingRef),
      ]);
      if (!attemptSnapshot.exists || !bookingSnapshot.exists) {
        return { status: "rejected", reason: "local_identity_missing" } as const;
      }
      const attempt = attemptSnapshot.data() as BookingCommissionPaymentAttempt;
      const booking = bookingSnapshot.data() as BookingFollowUpDocument;
      if (
        attempt.paymobOrderId !== options.paymobOrderId ||
        attempt.bookingId !== booking.id ||
        attempt.amountCents !== options.amountCents ||
        options.currency.trim().toUpperCase() !== "SAR" ||
        Number(binding.amountCents) !== attempt.amountCents ||
        String(binding.currency || "").toUpperCase() !== "SAR"
      ) {
        return { status: "rejected", reason: "identity_mismatch" } as const;
      }
      if (reversalSnapshot.exists) {
        const previous = reversalSnapshot.data() || {};
        if (
          previous.bookingId !== booking.id ||
          previous.attemptId !== attempt.id ||
          previous.paymobOrderId !== options.paymobOrderId ||
          previous.reason !== options.reason ||
          (
            previous.amountCents !== undefined &&
            Number(previous.amountCents) !== options.amountCents
          ) ||
          (
            previous.currency !== undefined &&
            String(previous.currency).toUpperCase() !== "SAR"
          )
        ) {
          return { status: "rejected", reason: "transaction_conflict" } as const;
        }
        return { status: "already_processed", bookingId: booking.id } as const;
      }
      const timestamp = (options.now || new Date()).toISOString();
      const canonicalPaidAttempt =
        booking.commissionStatus === "paid" &&
        booking.paidAttemptId === attempt.id &&
        (attempt.status === "paid" || attempt.status === "duplicate_paid");
      transaction.create(reversalRef, {
        transactionId: options.transactionId,
        paymobOrderId: options.paymobOrderId,
        bookingId: booking.id,
        attemptId: attempt.id,
        reason: options.reason,
        amountCents: options.amountCents,
        currency: "SAR",
        createdAt: timestamp,
      });
      if (options.reason === "authorization_only") {
        transaction.update(attemptRef, {
          authorizationTransactionId: options.transactionId,
          authorizedAt: timestamp,
          updatedAt: timestamp,
        });
        transaction.update(bookingRef, {
          updatedAt: timestamp,
          events: appendEvent(booking.events, {
            type: "commission_payment_authorized",
            at: timestamp,
          }),
        });
      } else if (!canonicalPaidAttempt) {
        transaction.update(attemptRef, {
          status: "failed",
          failureReason: `provider_${options.reason}`,
          nonPayableStatus: options.reason,
          nonPayableTransactionId: options.transactionId,
          nonPayableAt: timestamp,
          updatedAt: timestamp,
        });
        transaction.update(bookingRef, {
          ...(booking.activeAttemptId === attempt.id
            ? { activeAttemptId: null }
            : {}),
          updatedAt: timestamp,
          events: appendEvent(booking.events, {
            type: "commission_payment_failed",
            at: timestamp,
            detail: options.reason,
          }),
        });
      } else {
        transaction.update(attemptRef, {
          reversalStatus: options.reason,
          reversalTransactionId: options.transactionId,
          reversedAt: timestamp,
          reversalResolution: null,
          reversalResolvedAt: null,
          updatedAt: timestamp,
        });
        transaction.update(bookingRef, {
          enforcementLastError: `commission_payment_${options.reason}_requires_admin_review`,
          updatedAt: timestamp,
          events: appendEvent(booking.events, {
            type: "commission_payment_reversal_reported",
            at: timestamp,
            detail: options.reason,
          }),
        });
      }
      return {
        status: "recorded",
        bookingId: booking.id,
        reviewRequired: canonicalPaidAttempt &&
          options.reason !== "authorization_only",
      } as const;
    });
  }

  async resolveCommissionReversal(options: {
    bookingId: string;
    attemptId: string;
    reversalTransactionId: string;
    resolution: "resume_collection" | "keep_paid";
    now?: Date;
  }): Promise<{
    booking: BookingFollowUpDocument;
    attempt: BookingCommissionPaymentAttempt;
    resolution: "resume_collection" | "keep_paid";
  }> {
    const configuredReminderDays = new Set<number>(
      options.resolution === "resume_collection"
        ? [
            ...(await this.getFreeWorkflowSettings())
              .optionalCommissionReminderDays,
            5,
          ]
        : [],
    );
    const bookingRef = this.db.collection(BOOKINGS_COLLECTION).doc(options.bookingId);
    const attemptRef = this.db.collection(ATTEMPTS_COLLECTION).doc(options.attemptId);
    const reversalRef = this.db.collection(REVERSAL_BINDINGS_COLLECTION)
      .doc(options.reversalTransactionId);
    const ownerNoticeRef = this.db.collection(NOTIFICATIONS_COLLECTION).doc(
      notificationId(options.bookingId, "owner_booking_confirmed"),
    );
    const reminderKinds = [3, 4, 5] as const;
    const reminderRefs = reminderKinds.map((offset) =>
      this.db.collection(NOTIFICATIONS_COLLECTION).doc(
        notificationId(options.bookingId, `commission_reminder_${offset}`),
      ));
    const pauseJobRef = this.db.collection(NOTIFICATIONS_COLLECTION).doc(
      notificationId(options.bookingId, "property_paused"),
    );

    const result = await this.db.runTransaction(async (transaction) => {
      const [bookingSnapshot, attemptSnapshot, reversalSnapshot] =
        await Promise.all([
          transaction.get(bookingRef),
          transaction.get(attemptRef),
          transaction.get(reversalRef),
        ]);
      if (!bookingSnapshot.exists) {
        throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
      }
      if (!attemptSnapshot.exists || !reversalSnapshot.exists) {
        throw new BookingWorkflowError(
          "COMMISSION_REVERSAL_NOT_FOUND",
          "Commission reversal was not found",
          404,
        );
      }
      const booking = bookingSnapshot.data() as BookingFollowUpDocument;
      const attempt = attemptSnapshot.data() as BookingCommissionPaymentAttempt;
      const reversal = reversalSnapshot.data() || {};
      if (
        booking.bookingStatus !== "confirmed" ||
        attempt.bookingId !== booking.id ||
        attempt.id !== options.attemptId ||
        attempt.paymobOrderId !== reversal.paymobOrderId ||
        attempt.reversalTransactionId !== options.reversalTransactionId ||
        attempt.reversalStatus !== reversal.reason ||
        reversal.bookingId !== booking.id ||
        reversal.attemptId !== attempt.id ||
        reversal.transactionId !== options.reversalTransactionId
      ) {
        throw new BookingWorkflowError(
          "COMMISSION_REVERSAL_IDENTITY_MISMATCH",
          "Commission reversal identity does not match",
        );
      }
      if (
        options.resolution === "resume_collection" &&
        !await this.ensureFreeBookingEligibility(
          transaction,
          bookingRef,
          booking,
          options.now || new Date(),
        )
      ) return null;
      if (attempt.reversalResolution) {
        if (attempt.reversalResolution !== options.resolution) {
          throw new BookingWorkflowError(
            "COMMISSION_REVERSAL_ALREADY_RESOLVED",
            "Commission reversal was already resolved differently",
          );
        }
        return { booking, attempt, resolution: options.resolution };
      }
      if (
        booking.commissionStatus !== "paid" ||
        booking.paidAttemptId !== attempt.id ||
        (attempt.status !== "paid" && attempt.status !== "duplicate_paid") ||
        !attempt.transactionId
      ) {
        throw new BookingWorkflowError(
          "COMMISSION_REVERSAL_NOT_CANONICAL",
          "Commission reversal is not bound to the canonical paid attempt",
        );
      }

      const timestamp = (options.now || new Date()).toISOString();
      const resolutionUpdates = {
        reversalResolution: options.resolution,
        reversalResolvedAt: timestamp,
        updatedAt: timestamp,
      };
      const reviewError =
        `commission_payment_${attempt.reversalStatus}_requires_admin_review`;
      if (options.resolution === "keep_paid") {
        const bookingUpdates = {
          ...(booking.enforcementLastError === reviewError
            ? { enforcementLastError: null }
            : {}),
          updatedAt: timestamp,
          events: appendEvent(booking.events, {
            type: "commission_payment_reversal_kept_paid",
            at: timestamp,
            detail: options.reversalTransactionId,
          }),
        };
        transaction.update(attemptRef, resolutionUpdates);
        transaction.update(bookingRef, bookingUpdates);
        return {
          booking: { ...booking, ...bookingUpdates },
          attempt: { ...attempt, ...resolutionUpdates },
          resolution: options.resolution,
        };
      }

      if (
        attempt.status === "duplicate_paid" ||
        attempt.reversalStatus === "authorization_only"
      ) {
        throw new BookingWorkflowError(
          "COMMISSION_REVERSAL_RECOLLECTION_UNSAFE",
          "Commission reversal requires manual financial reconciliation",
        );
      }

      const propertyRef = this.db.collection("properties").doc(booking.propertyNumber);
      const [
        propertySnapshot,
        ownerNoticeSnapshot,
        pauseJobSnapshot,
        ...reminderSnapshots
      ] = await Promise.all([
        transaction.get(propertyRef),
        transaction.get(ownerNoticeRef),
        transaction.get(pauseJobRef),
        ...reminderRefs.map((ref) => transaction.get(ref)),
      ]);
      const property = propertySnapshot.data() || {};
      const activeHoldIds = Array.isArray(property.commissionHold?.obligationIds)
        ? property.commissionHold.obligationIds.map(String)
        : [];
      const remainingHoldIds = activeHoldIds.filter(
        (value: string) => value !== booking.id,
      );
      if (propertySnapshot.exists && activeHoldIds.includes(booking.id)) {
        transaction.update(propertyRef, {
          commissionHold: remainingHoldIds.length > 0
            ? {
                ...property.commissionHold,
                active: true,
                obligationIds: remainingHoldIds,
                updatedAt: timestamp,
              }
            : {
                active: false,
                obligationIds: [],
                appliedAt: property.commissionHold?.appliedAt,
                releasedAt: timestamp,
                updatedAt: timestamp,
              },
          updatedAt: timestamp,
        });
      }

      const reminderSchedule = calculateCommissionReminderSchedule(timestamp);
      const dueAt = calculateCommissionDueAt(timestamp);
      const provisionalDueAt = calculateCommissionDueAt(
        booking.confirmedAt || timestamp,
      );
      const resetJob = (
        ref: FirebaseFirestore.DocumentReference,
        snapshot: FirebaseFirestore.DocumentSnapshot,
        job: BookingNotificationJob,
      ) => {
        if (snapshot.exists) {
          const previous = snapshot.data() as BookingNotificationJob;
          transaction.update(ref, {
            ...job,
            attempts: 0,
            createdAt: previous.createdAt || job.createdAt,
          });
        } else {
          transaction.create(ref, job);
        }
      };
      resetJob(ownerNoticeRef, ownerNoticeSnapshot, buildNotificationJob({
        booking,
        kind: "owner_booking_confirmed",
        scheduledAt: timestamp,
        now: timestamp,
      }));
      for (let index = 0; index < reminderRefs.length; index++) {
        if (!configuredReminderDays.has(reminderKinds[index])) continue;
        resetJob(
          reminderRefs[index],
          reminderSnapshots[index],
          buildNotificationJob({
            booking,
            kind: `commission_reminder_${reminderKinds[index]}`,
            scheduledAt: reminderSchedule[index].scheduledAt,
            now: timestamp,
          }),
        );
      }
      resetJob(pauseJobRef, pauseJobSnapshot, buildNotificationJob({
        booking,
        kind: "property_paused",
        scheduledAt: dueAt,
        now: timestamp,
      }));

      const bookingUpdates = {
        commissionStatus: "pending" as const,
        complianceStatus: "clear" as const,
        commissionNoticeSentAt: null,
        // Keep the confirmed-booking invariant valid until the replacement
        // notice is actually sent. finishNotificationJob will atomically move
        // the deadline to five days after successful notice delivery.
        commissionDueAt: provisionalDueAt,
        commissionPaidAt: null,
        commissionReminderOffsetsSent: [],
        paidAttemptId: null,
        activeAttemptId: null,
        enforcementDeferredUntil: null,
        enforcementLastError: null,
        enforcementLeaseToken: null,
        enforcementLeaseExpiresAt: null,
        updatedAt: timestamp,
        events: appendEvent(booking.events, {
          type: "commission_payment_reversal_collection_resumed",
          at: timestamp,
          detail: options.reversalTransactionId,
        }),
      };
      transaction.update(attemptRef, resolutionUpdates);
      transaction.update(bookingRef, bookingUpdates);
      return {
        booking: { ...booking, ...bookingUpdates } as BookingFollowUpDocument,
        attempt: { ...attempt, ...resolutionUpdates },
        resolution: options.resolution,
      };
    });
    if (!result) {
      throw new BookingWorkflowError(
        "COMMISSION_NOT_APPLICABLE",
        "Commission is not applicable",
      );
    }
    return result;
  }

  async recoverExpiredNotificationClaims(now = new Date()): Promise<number> {
    const nowIso = now.toISOString();
    let recovered = 0;
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    while (recovered < 100) {
      let query = this.db.collection(NOTIFICATIONS_COLLECTION)
        .where("leaseExpiresAt", "<=", nowIso)
        .orderBy("leaseExpiresAt", "asc")
        .limit(100);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      for (const document of snapshot.docs) {
        const didRecover = await this.db.runTransaction(async (transaction) => {
          const currentSnapshot = await transaction.get(document.ref);
          if (!currentSnapshot.exists) return false;
          const current = currentSnapshot.data() as BookingNotificationJob;
          const leaseExpiresAt = Date.parse(current.leaseExpiresAt || "");
          if (
            current.status !== "claimed" ||
            !Number.isFinite(leaseExpiresAt) ||
            leaseExpiresAt > now.getTime()
          ) return false;
          transaction.update(document.ref, {
            status: "pending",
            leaseToken: null,
            leaseExpiresAt: null,
            updatedAt: nowIso,
          });
          return true;
        });
        if (didRecover) recovered++;
        if (recovered >= 100) break;
      }
      cursor = snapshot.docs.at(-1);
      if (snapshot.size < 100) break;
    }
    return recovered;
  }

  async claimDueNotificationJobs(
    now = new Date(),
    maxJobs = 50,
    options: {
      commissionNotificationsEnabled?: boolean;
      followUpNotificationsEnabled?: boolean;
  } = {},
  ): Promise<ClaimedBookingNotification[]> {
    const nowIso = now.toISOString();
    const claims: ClaimedBookingNotification[] = [];
    const claimLimit = Math.min(Math.max(1, maxJobs), 100);
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    while (claims.length < claimLimit) {
      let query = this.db.collection(NOTIFICATIONS_COLLECTION)
        .where("scheduledAt", "<=", nowIso)
        .orderBy("scheduledAt", "asc")
        .limit(100);
      if (cursor) query = query.startAfter(cursor);
      const dueSnapshot = await query.get();
      if (dueSnapshot.empty) break;
      for (const candidate of dueSnapshot.docs) {
        if (claims.length >= claimLimit) break;
        const claimed = await this.db.runTransaction(async (transaction) => {
        const jobSnapshot = await transaction.get(candidate.ref);
        if (!jobSnapshot.exists) return null;
        const job = jobSnapshot.data() as BookingNotificationJob;
        if (job.status !== "pending" || Date.parse(job.scheduledAt) > now.getTime()) return null;
        const settingsSnapshot = await transaction.get(
          this.db.collection(SETTINGS_COLLECTION)
            .doc(FREE_WORKFLOW_SETTINGS_DOCUMENT),
        );
        const freeWorkflowLimits = resolvedFreeWorkflowSettings(
          settingsSnapshot.exists ? settingsSnapshot.data() : null,
        );
        const bookingRef = this.db.collection(BOOKINGS_COLLECTION).doc(job.bookingId);
        const bookingSnapshot = await transaction.get(bookingRef);
        if (!bookingSnapshot.exists) {
          transaction.update(candidate.ref, {
            status: "failed",
            failedAt: nowIso,
            providerError: "booking_not_found",
            updatedAt: nowIso,
          });
          return null;
        }
        const booking = bookingSnapshot.data() as BookingFollowUpDocument;
        const customerCampaign = isAutomaticCustomerSequenceJob(job)
          ? await readCustomerFollowUpCampaignContext({
              db: this.db,
              transaction,
              booking,
              now,
            })
          : null;
        if (!await this.ensureFreeBookingEligibility(
          transaction,
          bookingRef,
          booking,
          now,
        )) {
          if (customerCampaign) {
            this.reanchorCustomerFinalAfterEligibilityLoss(
              transaction,
              customerCampaign,
              job,
              booking,
              now,
            );
            this.schedulePropertyCampaignFinalAfterTerminalOrdinary(
              transaction,
              customerCampaign,
              job,
              now,
              booking.propertyNumber,
            );
          }
          return null;
        }
        if (
          isCustomerNotificationKind(job.kind) &&
          customerResponseExpired(booking, now)
        ) {
          if (customerCampaign) {
            this.schedulePropertyCampaignFinalAfterTerminalOrdinary(
              transaction,
              customerCampaign,
              job,
              now,
            );
          }
          transaction.update(candidate.ref, {
            status: "cancelled",
            leaseToken: null,
            leaseExpiresAt: null,
            providerError: "customer_response_expired",
            updatedAt: nowIso,
          });
          transaction.update(bookingRef, {
            events: appendEventOnce(booking.events, {
              type: "customer_followup_expired",
              at: nowIso,
              detail: "customer_response_expired",
            }),
            ...(booking.activeCustomerNotificationJobId === job.id
              ? { activeCustomerNotificationJobId: null }
              : {}),
            updatedAt: nowIso,
          });
          return null;
        }
        let customerSharedSlotUpdate:
          | Pick<BookingNotificationJob, "customerSharedSequenceSlotReservedAt">
          | Record<string, never> = {};
        if (customerCampaign) {
          const cancelForCampaign = (reason: string) => {
            transaction.set(
              customerCampaign.stateRef,
              { ...customerCampaign.state, updatedAt: nowIso },
            );
            transaction.update(candidate.ref, {
              status: "cancelled",
              leaseToken: null,
              leaseExpiresAt: null,
              providerError: reason,
              updatedAt: nowIso,
            });
            transaction.update(bookingRef, {
              ...(booking.activeCustomerNotificationJobId === job.id
                ? { activeCustomerNotificationJobId: null }
                : {}),
              events: appendEvent(booking.events, {
                type: job.kind === "customer_final_reminder"
                  ? "customer_final_reminder_suppressed"
                  : "customer_followup_suppressed",
                at: nowIso,
                detail: reason,
              }),
              updatedAt: nowIso,
            });
          };
          if (customerCampaign.customerResponded) {
            cancelForCampaign("customer_campaign_responded");
            return null;
          }
          if (job.kind === "customer_final_reminder") {
            if (customerCampaign.state.finalReminderSentAt) {
              cancelForCampaign("customer_final_reminder_already_sent");
              return null;
            }
            if (
              customerCampaign.state.finalReminderJobId &&
              customerCampaign.state.finalReminderJobId !== job.id
            ) {
              cancelForCampaign("customer_final_reminder_already_scheduled");
              return null;
            }
            customerCampaign.state.finalReminderJobId = job.id;
            const bookingById = new Map(
              customerCampaign.bookings.map((candidate) => [candidate.id, candidate]),
            );
            const unfinishedOrdinary = customerCampaign.jobs.filter((candidateJob) => {
              if (
                candidateJob.id === job.id ||
                candidateJob.kind !== "customer_followup" ||
                !automaticCustomerJob(candidateJob) ||
                (candidateJob.status !== "pending" &&
                  candidateJob.status !== "claimed")
              ) return false;
              const candidateBooking = bookingById.get(candidateJob.bookingId);
              if (
                !candidateBooking ||
                candidateBooking.activeCustomerNotificationJobId !== candidateJob.id
              ) return false;
              if (customerCampaign.effectiveLimitScope === "property") return true;
              return Boolean(candidateJob.customerSharedSequenceSlotReservedAt) ||
                candidateJob.status === "claimed";
            });
            if (unfinishedOrdinary.length > 0) {
              const retryMinutes = Math.max(
                1,
                ...unfinishedOrdinary.map((candidateJob) => {
                  const candidateBooking = bookingById.get(candidateJob.bookingId);
                  const parsed = bookingCustomerFollowUpDelayMinutesSchema.safeParse(
                    candidateBooking?.customerFollowUpDelayMinutes,
                  );
                  return parsed.success ? parsed.data : 1;
                }),
              );
              transaction.set(customerCampaign.stateRef, {
                ...customerCampaign.state,
                updatedAt: nowIso,
              });
              transaction.update(candidate.ref, {
                scheduledAt: new Date(
                  now.getTime() + retryMinutes * 60 * 1_000,
                ).toISOString(),
                providerError: "customer_campaign_ordinary_messages_pending",
                updatedAt: nowIso,
              });
              return null;
            }
          } else {
            if (
              customerCampaign.state.finalReminderSentAt ||
              (
                customerCampaign.effectiveLimitScope === "customer" &&
                customerCampaign.state.finalReminderJobId
              )
            ) {
              cancelForCampaign("customer_campaign_finalized");
              return null;
            }
            if (!job.customerSharedSequenceSlotReservedAt) {
              const propertyNumber = job.propertyNumber;
              const propertyScope =
                customerCampaign.effectiveLimitScope === "property";
              const messageBudget = propertyScope
                ? customerCampaign.propertyOrdinaryMessageBudgets.get(
                    propertyNumber,
                  ) || 0
                : customerCampaign.ordinaryMessageBudget;
              const reserved = propertyScope
                ? customerCampaign.state.propertyOrdinarySlotsReserved[
                    propertyNumber
                  ] || 0
                : customerCampaign.state.sharedOrdinarySlotsReserved;
              const sent = propertyScope
                ? customerCampaign.propertyOrdinaryMessagesSent.get(
                    propertyNumber,
                  ) || 0
                : customerCampaign.sharedOrdinaryMessagesSent;
              if (reserved >= messageBudget) {
                if (sent < messageBudget) {
                  transaction.update(candidate.ref, {
                    scheduledAt: new Date(now.getTime() + 60_000).toISOString(),
                    providerError: "customer_sequence_slots_in_flight",
                    updatedAt: nowIso,
                  });
                } else {
                  transaction.update(candidate.ref, {
                    status: "cancelled",
                    leaseToken: null,
                    leaseExpiresAt: null,
                    providerError: "customer_sequence_limit_reached",
                    updatedAt: nowIso,
                  });
                }
                transaction.set(customerCampaign.stateRef, {
                  ...customerCampaign.state,
                  updatedAt: nowIso,
                });
                return null;
              }
              if (propertyScope) {
                customerCampaign.state.propertyOrdinarySlotsReserved[
                  propertyNumber
                ] = reserved + 1;
              } else {
                customerCampaign.state.sharedOrdinarySlotsReserved = reserved + 1;
              }
              customerSharedSlotUpdate = {
                customerSharedSequenceSlotReservedAt: nowIso,
              };
            }
          }
        }
        if (
          isAutomaticCustomerSequenceJob(job) &&
          (
            booking.customerFollowUpMessageLimit === 0 ||
            !automaticCustomerSequenceJobIsActive(job, booking)
          )
        ) {
          transaction.update(candidate.ref, {
            status: "cancelled",
            leaseToken: null,
            leaseExpiresAt: null,
            providerError: booking.customerFollowUpMessageLimit === 0
              ? "customer_sequence_disabled"
              : "notification_state_changed",
            updatedAt: nowIso,
          });
          transaction.update(bookingRef, {
            ...(booking.activeCustomerNotificationJobId === job.id
              ? { activeCustomerNotificationJobId: null }
              : {}),
            events: appendEvent(booking.events, {
              type: job.kind === "customer_final_reminder"
                ? "customer_final_reminder_suppressed"
                : "customer_followup_suppressed",
              at: nowIso,
              detail: booking.customerFollowUpMessageLimit === 0
                ? "customer_sequence_disabled"
                : "notification_state_changed",
            }),
            updatedAt: nowIso,
          });
          return null;
        }
        if (
          isCommissionPaymentPromptNotification(job, booking) &&
          booking.activeAttemptId
        ) {
          const activeAttemptSnapshot = await transaction.get(
            this.db.collection(ATTEMPTS_COLLECTION).doc(
              booking.activeAttemptId,
            ),
          );
          const activeAttempt = activeAttemptSnapshot.exists
            ? activeAttemptSnapshot.data() as BookingCommissionPaymentAttempt
            : null;
          if (bankAttemptPausesCollection(activeAttempt)) {
            transaction.update(candidate.ref, {
              status: "pending",
              scheduledAt: new Date(
                now.getTime() + BOOKING_OWNER_NOTICE_RETRY_MS,
              ).toISOString(),
              leaseToken: null,
              leaseExpiresAt: null,
              providerError: "bank_transfer_under_review",
              updatedAt: nowIso,
            });
            return null;
          }
        }
        const stateCheck = notificationMatchesCurrentState(job, booking, now);
        if (stateCheck.status !== "valid") {
          if (stateCheck.retryAt) {
            transaction.update(candidate.ref, {
              scheduledAt: stateCheck.retryAt,
              leaseToken: null,
              leaseExpiresAt: null,
              providerError:
                isCommissionCollectionNotification(job) &&
                !booking.commissionNoticeSentAt
                  ? "awaiting_owner_commission_notice"
                  : "notification_state_changed",
              updatedAt: nowIso,
            });
            return null;
          }
          transaction.update(candidate.ref, {
            status: "cancelled",
            leaseToken: null,
            leaseExpiresAt: null,
            providerError: notificationStateChangedError(job, booking),
            updatedAt: nowIso,
          });
          if (booking.activeCustomerNotificationJobId === job.id) {
            transaction.update(bookingRef, {
              activeCustomerNotificationJobId: null,
              updatedAt: nowIso,
            });
          }
          return null;
        }
        if (job.recipientRole === "owner") {
          const propertySnapshot = await transaction.get(
            this.db.collection("properties").doc(booking.propertyNumber),
          );
          if (
            !propertySnapshot.exists ||
            !ownerIdentityMatches(booking, propertySnapshot.data() || null)
          ) {
            transaction.update(candidate.ref, {
              status: "cancelled",
              leaseToken: null,
              leaseExpiresAt: null,
              providerError: "owner_identity_changed",
              updatedAt: nowIso,
            });
            transaction.update(
              bookingRef,
              ownerIdentityReviewUpdates(booking, nowIso),
            );
            return null;
          }
          if (
            job.kind === "property_released" &&
            hasActivePropertyHold(propertySnapshot.data())
          ) {
            transaction.update(candidate.ref, {
              status: "cancelled",
              leaseToken: null,
              leaseExpiresAt: null,
              providerError: "notification_state_changed",
              updatedAt: nowIso,
            });
            return null;
          }
        }
        const commissionControlled =
          job.kind.startsWith("commission_reminder_") ||
          job.kind === "property_paused" ||
          job.kind === "commission_dispute_rejected" ||
          (
            job.kind === "owner_booking_confirmed" &&
            booking.commissionStatus !== "not_applicable"
          );
        const followUpControlled =
          isCustomerNotificationKind(job.kind) ||
          job.kind === "owner_contact_limit_reached" ||
          (
            job.kind === "owner_booking_confirmed" &&
            booking.commissionStatus === "not_applicable"
          );
        if (
          followUpControlled &&
          options.followUpNotificationsEnabled === false
        ) {
          transaction.update(candidate.ref, {
            scheduledAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
            providerError: "booking_followup_feature_disabled",
            updatedAt: nowIso,
          });
          return null;
        }
        if (
          commissionControlled &&
          options.commissionNotificationsEnabled === false
        ) {
          transaction.update(candidate.ref, {
            scheduledAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
            providerError: "commission_feature_disabled",
            updatedAt: nowIso,
          });
          return null;
        }
        if (
          (
            job.kind.startsWith("commission_reminder_") ||
            job.kind === "property_paused"
          ) &&
          booking.commissionStatus === "pending" &&
          !booking.commissionNoticeSentAt
        ) {
          transaction.update(candidate.ref, {
            scheduledAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
            providerError: "awaiting_owner_commission_notice",
            updatedAt: nowIso,
          });
          return null;
        }
        if (
          commissionControlled &&
          (
            booking.commissionStatus === "paid" ||
            booking.commissionStatus === "waived" ||
            booking.disputeStatus === "pending"
          )
        ) {
          transaction.update(candidate.ref, {
            status: "cancelled",
            suppressedAt: null,
            providerError: booking.commissionStatus === "paid"
              ? "commission_paid"
              : booking.commissionStatus === "waived"
                ? "commission_waived"
                : "commission_disputed",
            updatedAt: nowIso,
          });
          return null;
        }
        if (job.reminderOffsetDays) {
          const latestDueOffset = latestCommissionReminderOffsetDue(booking, now);
          if (latestDueOffset && job.reminderOffsetDays < latestDueOffset) {
            transaction.update(candidate.ref, {
              status: "cancelled",
              providerError: "superseded_reminder",
              updatedAt: nowIso,
            });
            return null;
          }
        }

        const quotaLimit = quotaLimitFor(job, freeWorkflowLimits);
        let quotaReservationUpdate: Pick<
          BookingNotificationJob,
          "quotaReservedWindowStartedAt"
        > | Record<string, never> = {};
        if (quotaLimit !== null) {
          const windowStart = getStartOfDayRiyadh(now).getTime();
          const windowEnd = getEndOfDayRiyadh(now).getTime() + 1;
          if (job.quotaReservedWindowStartedAt !== windowStart) {
            const quotaRef = this.db.collection(QUOTAS_COLLECTION)
              .doc(quotaDocumentId(job, windowStart));
            const quotaSnapshot = await transaction.get(quotaRef);
            const currentCount = quotaSnapshot.exists
              ? Number(quotaSnapshot.data()?.count || 0)
              : 0;
            if (currentCount >= quotaLimit) {
              if (quotaLimit === 0) {
                const eventType = job.recipientRole === "customer"
                  ? "customer_followup_suppressed"
                  : "owner_notification_suppressed";
                transaction.update(candidate.ref, {
                  status: "suppressed_quota",
                  suppressedAt: nowIso,
                  providerError: "daily_notification_quota",
                  updatedAt: nowIso,
                });
                transaction.update(bookingRef, {
                  ...(job.recipientRole === "customer" &&
                      booking.activeCustomerNotificationJobId === job.id
                    ? { activeCustomerNotificationJobId: null }
                    : {}),
                  events: appendEvent(booking.events, {
                    type: eventType,
                    at: nowIso,
                  }),
                  updatedAt: nowIso,
                });
              } else {
                transaction.update(candidate.ref, {
                  status: "pending",
                  scheduledAt: new Date(windowEnd).toISOString(),
                  suppressedAt: null,
                  providerError: "daily_notification_quota_deferred",
                  updatedAt: nowIso,
                });
              }
              return null;
            }
            transaction.set(quotaRef, {
              recipientRole: job.recipientRole,
              recipientQuotaKey: job.recipientQuotaKey,
              category: job.quotaCategory,
              windowStartedAt: windowStart,
              windowEndsAt: windowEnd,
              count: currentCount + 1,
              updatedAt: nowIso,
              expiresAtTtl: new Date(windowEnd + 24 * 60 * 60 * 1000),
            });
            quotaReservationUpdate = {
              quotaReservedWindowStartedAt: windowStart,
            };
          }
        }

        const leaseToken = randomBytes(18).toString("base64url");
        const claimedJob: ClaimedBookingNotification = {
          ...job,
          status: "claimed",
          attempts: job.attempts + 1,
          ...quotaReservationUpdate,
          ...customerSharedSlotUpdate,
          leaseToken,
          leaseExpiresAt: new Date(now.getTime() + BOOKING_NOTIFICATION_LEASE_MS).toISOString(),
          claimedAt: nowIso,
          updatedAt: nowIso,
        };
        transaction.update(candidate.ref, claimedJob);
        if (customerCampaign) {
          transaction.set(customerCampaign.stateRef, {
            ...customerCampaign.state,
            updatedAt: nowIso,
          });
        }
        return claimedJob;
        });
        if (claimed) claims.push(claimed);
      }
      cursor = dueSnapshot.docs.at(-1);
      if (dueSnapshot.size < 100) break;
    }
    return claims;
  }

  async prepareNotificationForSend(
    jobId: string,
    leaseToken: string,
    now = new Date(),
  ): Promise<
    | { status: "ready"; booking: BookingFollowUpDocument }
    | { status: "blocked"; reason: "claim_invalid" | "booking_not_found" | "customer_response_expired" | "owner_identity_changed" | "booking_ineligible" | "notification_state_changed" }
  > {
    const jobRef = this.db.collection(NOTIFICATIONS_COLLECTION).doc(jobId);
    return this.db.runTransaction(async (transaction) => {
      const jobSnapshot = await transaction.get(jobRef);
      if (!jobSnapshot.exists) return { status: "blocked", reason: "claim_invalid" } as const;
      const job = jobSnapshot.data() as BookingNotificationJob;
      if (job.status !== "claimed" || job.leaseToken !== leaseToken) {
        return { status: "blocked", reason: "claim_invalid" } as const;
      }
      const timestamp = now.toISOString();
      const bookingRef = this.db.collection(BOOKINGS_COLLECTION).doc(job.bookingId);
      const bookingSnapshot = await transaction.get(bookingRef);
      if (!bookingSnapshot.exists) {
        transaction.update(jobRef, {
          status: "failed",
          failedAt: now.toISOString(),
          leaseToken: null,
          leaseExpiresAt: null,
          providerError: "booking_not_found",
          updatedAt: now.toISOString(),
        });
        return { status: "blocked", reason: "booking_not_found" } as const;
      }
      const booking = bookingSnapshot.data() as BookingFollowUpDocument;
      const customerCampaign = isCustomerNotificationKind(job.kind)
        ? await readCustomerFollowUpCampaignContext({
            db: this.db,
            transaction,
            booking,
            now,
          })
        : null;
      if (!await this.ensureFreeBookingEligibility(
        transaction,
        bookingRef,
        booking,
        now,
      )) {
        if (customerCampaign) {
          this.reanchorCustomerFinalAfterEligibilityLoss(
            transaction,
            customerCampaign,
            job,
            booking,
            now,
          );
          this.schedulePropertyCampaignFinalAfterTerminalOrdinary(
            transaction,
            customerCampaign,
            job,
            now,
            booking.propertyNumber,
          );
        }
        return { status: "blocked", reason: "booking_ineligible" } as const;
      }
      if (customerCampaign && isAutomaticCustomerSequenceJob(job)) {
        const blockForCampaign = (reason: string) => {
          transaction.set(customerCampaign.stateRef, {
            ...customerCampaign.state,
            updatedAt: timestamp,
          });
          transaction.update(jobRef, {
            status: "cancelled",
            leaseToken: null,
            leaseExpiresAt: null,
            providerError: reason,
            updatedAt: timestamp,
          });
          transaction.update(bookingRef, {
            ...(booking.activeCustomerNotificationJobId === job.id
              ? { activeCustomerNotificationJobId: null }
              : {}),
            events: appendEvent(booking.events, {
              type: job.kind === "customer_final_reminder"
                ? "customer_final_reminder_suppressed"
                : "customer_followup_suppressed",
              at: timestamp,
              detail: reason,
            }),
            updatedAt: timestamp,
          });
        };
        if (customerCampaign.customerResponded) {
          blockForCampaign("customer_campaign_responded");
          return { status: "blocked", reason: "notification_state_changed" } as const;
        }
        if (job.kind === "customer_final_reminder") {
          if (
            customerCampaign.state.finalReminderSentAt ||
            (
              customerCampaign.state.finalReminderJobId &&
              customerCampaign.state.finalReminderJobId !== job.id
            )
          ) {
            blockForCampaign(
              customerCampaign.state.finalReminderSentAt
                ? "customer_final_reminder_already_sent"
                : "customer_final_reminder_already_scheduled",
            );
            return { status: "blocked", reason: "notification_state_changed" } as const;
          }
          const bookingsById = new Map(
            customerCampaign.bookings.map((candidate) => [candidate.id, candidate]),
          );
          const unfinishedOrdinary = customerCampaign.jobs.filter((candidateJob) => {
            if (
              candidateJob.kind !== "customer_followup" ||
              !automaticCustomerJob(candidateJob) ||
              (candidateJob.status !== "pending" &&
                candidateJob.status !== "claimed")
            ) return false;
            const candidateBooking = bookingsById.get(candidateJob.bookingId);
            if (
              !candidateBooking ||
              candidateBooking.activeCustomerNotificationJobId !== candidateJob.id
            ) return false;
            if (customerCampaign.effectiveLimitScope === "property") return true;
            return Boolean(candidateJob.customerSharedSequenceSlotReservedAt) ||
              candidateJob.status === "claimed";
          });
          if (unfinishedOrdinary.length > 0) {
            const retryMinutes = Math.max(
              1,
              ...unfinishedOrdinary.map((candidateJob) => {
                const pendingBooking = bookingsById.get(candidateJob.bookingId);
                const parsed = bookingCustomerFollowUpDelayMinutesSchema.safeParse(
                  pendingBooking?.customerFollowUpDelayMinutes,
                );
                return parsed.success ? parsed.data : 1;
              }),
            );
            customerCampaign.state.finalReminderJobId = job.id;
            transaction.set(customerCampaign.stateRef, {
              ...customerCampaign.state,
              updatedAt: timestamp,
            });
            transaction.update(jobRef, {
              status: "pending",
              scheduledAt: new Date(
                now.getTime() + retryMinutes * 60 * 1_000,
              ).toISOString(),
              leaseToken: null,
              leaseExpiresAt: null,
              providerError: "customer_campaign_ordinary_messages_pending",
              updatedAt: timestamp,
            });
            return { status: "blocked", reason: "notification_state_changed" } as const;
          }
        } else if (
          customerCampaign.state.finalReminderSentAt ||
          (
            customerCampaign.effectiveLimitScope === "customer" &&
            customerCampaign.state.finalReminderJobId
          )
        ) {
          blockForCampaign("customer_campaign_finalized");
          return { status: "blocked", reason: "notification_state_changed" } as const;
        }
      }
      if (
        isCustomerNotificationKind(job.kind) &&
        customerResponseExpired(booking, now)
      ) {
        if (customerCampaign) {
          this.schedulePropertyCampaignFinalAfterTerminalOrdinary(
            transaction,
            customerCampaign,
            job,
            now,
          );
        }
        transaction.update(jobRef, {
          status: "cancelled",
          leaseToken: null,
          leaseExpiresAt: null,
          providerError: "customer_response_expired",
          updatedAt: timestamp,
        });
        transaction.update(bookingRef, {
          events: appendEventOnce(booking.events, {
            type: "customer_followup_expired",
            at: timestamp,
            detail: "customer_response_expired",
          }),
          ...(booking.activeCustomerNotificationJobId === job.id
            ? { activeCustomerNotificationJobId: null }
            : {}),
          updatedAt: timestamp,
        });
        return { status: "blocked", reason: "customer_response_expired" } as const;
      }
      if (
        isAutomaticCustomerSequenceJob(job) &&
        (
          booking.customerFollowUpMessageLimit === 0 ||
          !automaticCustomerSequenceJobIsActive(job, booking)
        )
      ) {
        transaction.update(jobRef, {
          status: "cancelled",
          leaseToken: null,
          leaseExpiresAt: null,
          providerError: booking.customerFollowUpMessageLimit === 0
            ? "customer_sequence_disabled"
            : "notification_state_changed",
          updatedAt: timestamp,
        });
        transaction.update(bookingRef, {
          ...(booking.activeCustomerNotificationJobId === job.id
            ? { activeCustomerNotificationJobId: null }
            : {}),
          events: appendEvent(booking.events, {
            type: job.kind === "customer_final_reminder"
              ? "customer_final_reminder_suppressed"
              : "customer_followup_suppressed",
            at: timestamp,
            detail: booking.customerFollowUpMessageLimit === 0
              ? "customer_sequence_disabled"
              : "notification_state_changed",
          }),
          updatedAt: timestamp,
        });
        return { status: "blocked", reason: "notification_state_changed" } as const;
      }
      if (
        isCommissionPaymentPromptNotification(job, booking) &&
        booking.activeAttemptId
      ) {
        const activeAttemptSnapshot = await transaction.get(
          this.db.collection(ATTEMPTS_COLLECTION).doc(
            booking.activeAttemptId,
          ),
        );
        const activeAttempt = activeAttemptSnapshot.exists
          ? activeAttemptSnapshot.data() as BookingCommissionPaymentAttempt
          : null;
        if (bankAttemptPausesCollection(activeAttempt)) {
          transaction.update(jobRef, {
            status: "pending",
            scheduledAt: new Date(
              now.getTime() + BOOKING_OWNER_NOTICE_RETRY_MS,
            ).toISOString(),
            leaseToken: null,
            leaseExpiresAt: null,
            providerError: "bank_transfer_under_review",
            updatedAt: timestamp,
          });
          return { status: "blocked", reason: "notification_state_changed" } as const;
        }
      }
      const stateCheck = notificationMatchesCurrentState(job, booking, now);
      if (stateCheck.status !== "valid") {
        if (stateCheck.retryAt) {
          transaction.update(jobRef, {
            status: "pending",
            scheduledAt: stateCheck.retryAt,
            leaseToken: null,
            leaseExpiresAt: null,
            providerError:
              isCommissionCollectionNotification(job) &&
              !booking.commissionNoticeSentAt
                ? "awaiting_owner_commission_notice"
                : "notification_state_changed",
            updatedAt: timestamp,
          });
          return { status: "blocked", reason: "notification_state_changed" } as const;
        }
        transaction.update(jobRef, {
          status: "cancelled",
          leaseToken: null,
          leaseExpiresAt: null,
          providerError: notificationStateChangedError(job, booking),
          updatedAt: timestamp,
        });
        if (booking.activeCustomerNotificationJobId === job.id) {
          transaction.update(bookingRef, {
            activeCustomerNotificationJobId: null,
            updatedAt: timestamp,
          });
        }
        return { status: "blocked", reason: "notification_state_changed" } as const;
      }
      if (job.recipientRole === "owner") {
        const propertySnapshot = await transaction.get(
          this.db.collection("properties").doc(booking.propertyNumber),
        );
        if (
          !propertySnapshot.exists ||
          !ownerIdentityMatches(booking, propertySnapshot.data() || null)
        ) {
          transaction.update(jobRef, {
            status: "cancelled",
            leaseToken: null,
            leaseExpiresAt: null,
            providerError: "owner_identity_changed",
            updatedAt: timestamp,
          });
          transaction.update(
            bookingRef,
            ownerIdentityReviewUpdates(booking, timestamp),
          );
          return { status: "blocked", reason: "owner_identity_changed" } as const;
        }
        if (
          job.kind === "property_released" &&
          hasActivePropertyHold(propertySnapshot.data())
        ) {
          transaction.update(jobRef, {
            status: "cancelled",
            leaseToken: null,
            leaseExpiresAt: null,
            providerError: "notification_state_changed",
            updatedAt: timestamp,
          });
          return { status: "blocked", reason: "notification_state_changed" } as const;
        }
      }
      transaction.update(jobRef, {
        leaseExpiresAt: new Date(
          now.getTime() + BOOKING_NOTIFICATION_LEASE_MS,
        ).toISOString(),
        updatedAt: timestamp,
      });
      return { status: "ready", booking } as const;
    });
  }

  async finishNotificationJob(options: {
    jobId: string;
    leaseToken: string;
    success: boolean;
    error?: string;
    providerMessageId?: string;
    now?: Date;
  }): Promise<boolean> {
    const now = options.now || new Date();
    const timestamp = now.toISOString();
    const providerMessageId = String(options.providerMessageId || "").trim();
    const storedProviderMessageId = providerMessageId.length <= 512
      ? providerMessageId
      : "";
    const providerAcceptanceUpdates = options.success
      ? {
          providerMessageId: storedProviderMessageId || null,
          providerDeliveryStatus: "accepted" as const,
          providerAcceptedAt: timestamp,
          providerDeliveredAt: null,
          providerReadAt: null,
          providerFailedAt: null,
          providerStatusUpdatedAt: timestamp,
          providerDeliveryError: null,
          providerDeliveryEventKeys: [],
        }
      : {};
    const jobRef = this.db.collection(NOTIFICATIONS_COLLECTION).doc(options.jobId);
    return this.db.runTransaction(async (transaction) => {
      const jobSnapshot = await transaction.get(jobRef);
      if (!jobSnapshot.exists) return false;
      const job = jobSnapshot.data() as BookingNotificationJob;
      if (job.status !== "claimed" || job.leaseToken !== options.leaseToken) return false;
      const bookingRef = this.db.collection(BOOKINGS_COLLECTION).doc(job.bookingId);
      const bookingSnapshot = await transaction.get(bookingRef);
      const booking = bookingSnapshot.exists
        ? bookingSnapshot.data() as BookingFollowUpDocument
        : null;
      const customerCampaign = booking && isCustomerNotificationKind(job.kind)
        ? await readCustomerFollowUpCampaignContext({
            db: this.db,
            transaction,
            booking,
            now,
          })
        : null;
      if (
        booking &&
        !await this.ensureFreeBookingEligibility(
          transaction,
          bookingRef,
          booking,
          now,
        )
      ) {
        if (
          options.success &&
          job.kind === "customer_final_reminder" &&
          customerCampaign
        ) {
          customerCampaign.state.finalReminderJobId = job.id;
          customerCampaign.state.finalReminderSentAt = timestamp;
          transaction.update(jobRef, {
            status: "sent",
            sentAt: timestamp,
            failedAt: null,
            providerError: null,
            ...providerAcceptanceUpdates,
            leaseToken: null,
            leaseExpiresAt: null,
            updatedAt: timestamp,
          });
          transaction.set(customerCampaign.stateRef, {
            ...customerCampaign.state,
            updatedAt: timestamp,
          });
          const cancelledJobIds = new Set<string>();
          for (const candidateJob of customerCampaign.jobs) {
            if (
              candidateJob.id === job.id ||
              !automaticCustomerJob(candidateJob) ||
              (candidateJob.status !== "pending" &&
                candidateJob.status !== "claimed")
            ) continue;
            cancelledJobIds.add(candidateJob.id);
            transaction.update(
              this.db.collection(NOTIFICATIONS_COLLECTION).doc(candidateJob.id),
              {
                status: "cancelled",
                leaseToken: null,
                leaseExpiresAt: null,
                providerError: "customer_campaign_finalized",
                updatedAt: timestamp,
              },
            );
          }
          for (const campaignBooking of customerCampaign.bookings) {
            if (
              campaignBooking.id === booking.id ||
              !campaignBooking.activeCustomerNotificationJobId ||
              !cancelledJobIds.has(
                campaignBooking.activeCustomerNotificationJobId,
              )
            ) continue;
            transaction.update(
              this.db.collection(BOOKINGS_COLLECTION).doc(campaignBooking.id),
              {
                activeCustomerNotificationJobId: null,
                updatedAt: timestamp,
              },
            );
          }
        }
        if (
          customerCampaign &&
          job.kind === "customer_followup" &&
          isAutomaticCustomerSequenceJob(job)
        ) {
          this.schedulePropertyCampaignFinalAfterTerminalOrdinary(
            transaction,
            customerCampaign,
            job,
            now,
            booking.propertyNumber,
          );
        }
        return true;
      }
      let reminderSnapshots: FirebaseFirestore.DocumentSnapshot[] = [];
      if (
        booking &&
        options.success &&
        job.kind === "owner_booking_confirmed" &&
        booking.commissionStatus === "pending" &&
        !booking.commissionNoticeSentAt
      ) {
        reminderSnapshots = await Promise.all([
          ...([3, 4, 5] as const).map((offset) =>
            transaction.get(
              this.db.collection(NOTIFICATIONS_COLLECTION).doc(
                notificationId(booking.id, `commission_reminder_${offset}`),
              ),
            )),
          transaction.get(
            this.db.collection(NOTIFICATIONS_COLLECTION).doc(
              notificationId(booking.id, "property_paused"),
            ),
          ),
        ]);
      }
      const successEvent = job.kind === "customer_followup"
        ? "customer_followup_sent"
        : job.kind === "customer_final_reminder"
          ? "customer_final_reminder_sent"
          : job.kind === "owner_booking_confirmed"
            ? "owner_notification_sent"
            : job.kind.startsWith("commission_reminder_")
              ? "commission_reminder_sent"
              : job.kind === "property_released"
                ? "property_released"
                : "owner_notification_sent";
      const failureEvent = job.kind === "customer_followup"
        ? "customer_followup_failed"
        : job.kind === "customer_final_reminder"
          ? "customer_final_reminder_failed"
          : job.kind.startsWith("commission_reminder_")
            ? "commission_reminder_failed"
            : "owner_notification_failed";
      const retryOwnerCommissionNotice = Boolean(
        booking &&
        !options.success &&
        job.kind === "owner_booking_confirmed" &&
        booking.commissionStatus === "pending" &&
        !booking.commissionNoticeSentAt &&
        job.attempts < 3,
      );
      let nextCustomerJob: BookingNotificationJob | null = null;
      let terminalPropertyFinal: BookingNotificationJob | null = null;
      if (
        booking &&
        options.success &&
        job.kind === "customer_followup" &&
        isAutomaticCustomerSequenceJob(job) &&
        automaticCustomerSequenceJobIsActive(job, booking) &&
        notificationMatchesCurrentState(job, booking, now).status === "valid" &&
        customerCampaign &&
        !customerCampaign.customerResponded
      ) {
        const messageLimit = booking.customerFollowUpMessageLimit;
        const delay = bookingCustomerFollowUpDelayMinutesSchema.safeParse(
          booking.customerFollowUpDelayMinutes,
        );
        const sequenceNumber = Number.isSafeInteger(
          job.customerFollowUpSequenceNumber,
        ) && Number(job.customerFollowUpSequenceNumber) > 0
          ? Number(job.customerFollowUpSequenceNumber)
          : 1;
        // Missing snapshots identify legacy workflows. They may finish their
        // already-created first send, but must not acquire a new sequence.
        if (
          Number.isSafeInteger(messageLimit) &&
          Number(messageLimit) > 0 &&
          delay.success
        ) {
          const nextSequenceNumber = sequenceNumber + 1;
          const propertyScope =
            customerCampaign.effectiveLimitScope === "property";
          const otherInFlightOrdinary = customerCampaign.jobs.some(
            (candidateJob) =>
              candidateJob.id !== job.id &&
              candidateJob.kind === "customer_followup" &&
              automaticCustomerJob(candidateJob) &&
              (
                candidateJob.status === "claimed" ||
                (
                  candidateJob.status === "pending" &&
                  Boolean(candidateJob.customerSharedSequenceSlotReservedAt)
                )
              ),
          );
          const sharedSentAfter =
            customerCampaign.sharedOrdinaryMessagesSent + 1;
          const propertySentAfter =
            (customerCampaign.propertyOrdinaryMessagesSent.get(
              job.propertyNumber,
            ) || 0) + 1;
          const everyPropertyBudgetCompleted =
            [...customerCampaign.propertyOrdinaryMessageBudgets.entries()]
              .every(([propertyNumber, budget]) => {
                const sent = propertyNumber === job.propertyNumber
                  ? propertySentAfter
                  : customerCampaign.propertyOrdinaryMessagesSent.get(
                      propertyNumber,
                    ) || 0;
                return sent >= budget;
              });
          const shouldScheduleFinal =
            !otherInFlightOrdinary &&
            (propertyScope
              ? everyPropertyBudgetCompleted
              : sharedSentAfter >= customerCampaign.ordinaryMessageBudget);
          const existingCanonicalFinal = customerCampaign.jobs.find(
            (candidate) =>
              candidate.id === customerCampaign.canonicalFinalJobId,
          );
          const canonicalFinalIsInactive = Boolean(
            existingCanonicalFinal &&
            existingCanonicalFinal.status !== "pending" &&
            existingCanonicalFinal.status !== "claimed" &&
            existingCanonicalFinal.status !== "sent",
          );
          if (
            shouldScheduleFinal &&
            !customerCampaign.state.finalReminderSentAt &&
            !customerCampaign.state.finalReminderJobId &&
            (!existingCanonicalFinal || canonicalFinalIsInactive)
          ) {
            nextCustomerJob = buildCanonicalCustomerFinalReminder({
              campaign: customerCampaign,
              booking,
              scheduledAt: new Date(
                now.getTime() + delay.data * 60 * 1_000,
              ).toISOString(),
              now: timestamp,
              sequenceNumber: Number(messageLimit),
              parentJobId: job.id,
            });
            customerCampaign.state.finalReminderJobId = nextCustomerJob.id;
          } else if (
            !shouldScheduleFinal &&
            nextSequenceNumber < Number(messageLimit) &&
            (
              propertyScope
                ? propertySentAfter <
                  (customerCampaign.propertyOrdinaryMessageBudgets.get(
                    job.propertyNumber,
                  ) || 0)
                : sharedSentAfter < customerCampaign.ordinaryMessageBudget
            )
          ) {
            nextCustomerJob = buildNotificationJob({
              booking,
              kind: "customer_followup",
              scheduledAt: new Date(
                now.getTime() + delay.data * 60 * 1_000,
              ).toISOString(),
              now: timestamp,
              customerFollowUpSequenceNumber: nextSequenceNumber,
              customerFollowUpSequenceParentJobId: job.id,
            });
          }
        }
      }
      if (customerCampaign && job.kind === "customer_final_reminder") {
        if (options.success) {
          if (!customerCampaign.state.finalReminderSentAt) {
            customerCampaign.state.finalReminderJobId = job.id;
            customerCampaign.state.finalReminderSentAt = timestamp;
          }
        } else if (
          customerCampaign.state.finalReminderJobId === job.id &&
          !customerCampaign.state.finalReminderSentAt
        ) {
          customerCampaign.state.finalReminderJobId = null;
        }
      }
      if (
        customerCampaign &&
        !options.success &&
        job.kind === "customer_followup" &&
        isAutomaticCustomerSequenceJob(job) &&
        Boolean(job.customerSharedSequenceSlotReservedAt)
      ) {
        if (customerCampaign.effectiveLimitScope === "property") {
          const reserved =
            customerCampaign.state.propertyOrdinarySlotsReserved[
              job.propertyNumber
            ] || 0;
          customerCampaign.state.propertyOrdinarySlotsReserved[
            job.propertyNumber
          ] = Math.max(0, reserved - 1);
        } else {
          customerCampaign.state.sharedOrdinarySlotsReserved = Math.max(
            0,
            customerCampaign.state.sharedOrdinarySlotsReserved - 1,
          );
        }
        terminalPropertyFinal = this.schedulePropertyCampaignFinalAfterTerminalOrdinary(
          transaction,
          customerCampaign,
          job,
          now,
        );
      }
      if (
        customerCampaign &&
        booking &&
        options.success &&
        job.kind === "customer_followup" &&
        isAutomaticCustomerSequenceJob(job) &&
        !nextCustomerJob &&
        notificationMatchesCurrentState(job, booking, now).status !== "valid"
      ) {
        terminalPropertyFinal = this.schedulePropertyCampaignFinalAfterTerminalOrdinary(
          transaction,
          customerCampaign,
          job,
          now,
        );
      }
      const customerJobsToCancel = customerCampaign
        ? customerCampaign.jobs.filter((candidate) => {
            if (
              candidate.id === job.id ||
              !automaticCustomerJob(candidate) ||
              (candidate.status !== "pending" && candidate.status !== "claimed")
            ) return false;
            if (
              customerCampaign.customerResponded ||
              (options.success && job.kind === "customer_final_reminder")
            ) return true;
            if (
              candidate.kind !== "customer_followup" ||
              candidate.status !== "pending" ||
              candidate.customerSharedSequenceSlotReservedAt
            ) return false;
            if (nextCustomerJob?.kind === "customer_final_reminder") return true;
            return customerCampaign.effectiveLimitScope === "property" &&
              options.success &&
              job.kind === "customer_followup" &&
              candidate.propertyNumber === job.propertyNumber &&
              (
                customerCampaign.propertyOrdinaryMessagesSent.get(
                  job.propertyNumber,
                ) || 0
              ) + 1 >=
                (customerCampaign.propertyOrdinaryMessageBudgets.get(
                  job.propertyNumber,
                ) || 0);
          })
        : [];
      const cancelledCustomerJobIds = new Set(
        customerJobsToCancel.map(({ id }) => id),
      );
      transaction.update(jobRef, {
        status: options.success
          ? "sent"
          : retryOwnerCommissionNotice
            ? "pending"
            : "failed",
        ...(retryOwnerCommissionNotice
          ? {
              scheduledAt: new Date(
                now.getTime() + BOOKING_OWNER_NOTICE_RETRY_MS,
              ).toISOString(),
            }
          : {}),
        sentAt: options.success ? timestamp : null,
        failedAt: options.success || retryOwnerCommissionNotice ? null : timestamp,
        providerError: options.success ? null : String(options.error || "send_failed").slice(0, 500),
        ...providerAcceptanceUpdates,
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: timestamp,
      });
      for (const customerJob of customerJobsToCancel) {
        transaction.update(
          this.db.collection(NOTIFICATIONS_COLLECTION).doc(customerJob.id),
          {
            status: "cancelled",
            leaseToken: null,
            leaseExpiresAt: null,
            providerError: customerCampaign?.customerResponded
              ? "customer_campaign_responded"
              : "customer_campaign_finalized",
            updatedAt: timestamp,
          },
        );
      }
      if (customerCampaign) {
        transaction.set(customerCampaign.stateRef, {
          ...customerCampaign.state,
          updatedAt: timestamp,
        });
        for (const campaignBooking of customerCampaign.bookings) {
          if (
            campaignBooking.id === booking?.id ||
            !campaignBooking.activeCustomerNotificationJobId ||
            !cancelledCustomerJobIds.has(
              campaignBooking.activeCustomerNotificationJobId,
            )
          ) continue;
          transaction.update(
            this.db.collection(BOOKINGS_COLLECTION).doc(campaignBooking.id),
            {
              activeCustomerNotificationJobId: null,
              updatedAt: timestamp,
            },
          );
        }
      }
      if (booking) {
        const reminderOffsets = job.reminderOffsetDays && options.success
          ? Array.from(new Set([
              ...booking.commissionReminderOffsetsSent,
              job.reminderOffsetDays,
            ])).sort()
          : booking.commissionReminderOffsetsSent;
        const commissionNoticeUpdates =
          options.success &&
          job.kind === "owner_booking_confirmed" &&
          booking.commissionStatus === "pending" &&
          !booking.commissionNoticeSentAt
            ? {
                commissionNoticeSentAt: timestamp,
                commissionDueAt: calculateCommissionDueAt(timestamp),
              }
            : {};
        let nextEvents = appendEvent(booking.events, {
          type: options.success ? successEvent : failureEvent,
          at: timestamp,
          ...(!options.success && options.error ? { detail: options.error.slice(0, 200) } : {}),
        });
        if (nextCustomerJob) {
          nextEvents = appendEvent(nextEvents, {
            type: nextCustomerJob.kind === "customer_final_reminder"
              ? "customer_final_reminder_scheduled"
              : "customer_followup_scheduled",
            at: timestamp,
            detail: String(nextCustomerJob.customerFollowUpSequenceNumber || ""),
          });
        }
        const activeCustomerNotificationUpdate =
          nextCustomerJob
            ? { activeCustomerNotificationJobId: nextCustomerJob.id }
            : terminalPropertyFinal?.bookingId === booking.id
              ? { activeCustomerNotificationJobId: terminalPropertyFinal.id }
            : booking.activeCustomerNotificationJobId === job.id &&
                isCustomerNotificationKind(job.kind)
              ? { activeCustomerNotificationJobId: null }
              : {};
        transaction.update(bookingRef, {
          commissionReminderOffsetsSent: reminderOffsets,
          ...commissionNoticeUpdates,
          ...activeCustomerNotificationUpdate,
          events: nextEvents,
          updatedAt: timestamp,
        });
        if (nextCustomerJob) {
          const nextJobRef = this.db.collection(NOTIFICATIONS_COLLECTION).doc(
            nextCustomerJob.id,
          );
          const replaceInactiveCanonical =
            nextCustomerJob.kind === "customer_final_reminder" &&
            customerCampaign?.jobs.some((candidate) =>
              candidate.id === nextCustomerJob!.id &&
              candidate.status !== "pending" &&
              candidate.status !== "claimed" &&
              candidate.status !== "sent"
            );
          if (replaceInactiveCanonical) {
            transaction.set(nextJobRef, nextCustomerJob);
          } else {
            transaction.create(nextJobRef, nextCustomerJob);
          }
        }
        if (Object.keys(commissionNoticeUpdates).length > 0) {
          const schedule = calculateCommissionReminderSchedule(timestamp);
          for (let index = 0; index < 3; index++) {
            const snapshot = reminderSnapshots[index];
            if (!snapshot.exists) continue;
            const reminder = snapshot.data() as BookingNotificationJob;
            if (reminder.status !== "pending") continue;
            transaction.update(snapshot.ref, {
              scheduledAt: schedule[index].scheduledAt,
              providerError: null,
              updatedAt: timestamp,
            });
          }
          const pauseSnapshot = reminderSnapshots[3];
          if (pauseSnapshot?.exists) {
            const pauseJob = pauseSnapshot.data() as BookingNotificationJob;
            if (pauseJob.status === "pending") {
              transaction.update(pauseSnapshot.ref, {
                scheduledAt: calculateCommissionDueAt(timestamp),
                providerError: null,
                updatedAt: timestamp,
              });
            }
          }
        }
      }
      return true;
    });
  }

  async listCommissionEnforcementCandidates(
    now = new Date(),
    limit = 100,
  ): Promise<BookingFollowUpDocument[]> {
    const candidateLimit = Math.min(Math.max(1, limit), 200);
    const candidates: BookingFollowUpDocument[] = [];
    let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    while (candidates.length < candidateLimit) {
      let query = this.db.collection(BOOKINGS_COLLECTION)
        .where("commissionDueAt", "<=", now.toISOString())
        .orderBy("commissionDueAt", "asc")
        .limit(200);
      if (cursor) query = query.startAfter(cursor);
      const snapshot = await query.get();
      if (snapshot.empty) break;
      for (const document of snapshot.docs) {
        const booking = document.data() as BookingFollowUpDocument;
        if (
          booking.isFreeProperty === true &&
          !booking.freeEligibilityRevokedAt &&
          booking.bookingStatus === "confirmed" &&
          booking.commissionStatus === "pending" &&
          booking.disputeStatus !== "pending" &&
          (
            !booking.enforcementDeferredUntil ||
            Date.parse(booking.enforcementDeferredUntil) <= now.getTime()
          )
        ) {
          candidates.push(booking);
          if (candidates.length >= candidateLimit) break;
        }
      }
      cursor = snapshot.docs.at(-1);
      if (snapshot.size < 200) break;
    }
    return candidates;
  }

  async claimCommissionEnforcement(
    id: string,
    now = new Date(),
  ): Promise<{
    leaseToken: string;
    booking: BookingFollowUpDocument;
  } | null> {
    const bookingRef = this.db.collection(BOOKINGS_COLLECTION).doc(id);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(bookingRef);
      if (!snapshot.exists) return null;
      const booking = snapshot.data() as BookingFollowUpDocument;
      if (!await this.ensureFreeBookingEligibility(
        transaction,
        bookingRef,
        booking,
        now,
      )) return null;
      const nowMs = now.getTime();
      const dueAt = Date.parse(booking.commissionDueAt || "");
      const deferredUntil = Date.parse(booking.enforcementDeferredUntil || "");
      const leaseExpiresAt = Date.parse(booking.enforcementLeaseExpiresAt || "");
      if (
        booking.bookingStatus !== "confirmed" ||
        booking.commissionStatus !== "pending" ||
        booking.disputeStatus === "pending" ||
        !Number.isFinite(dueAt) ||
        dueAt > nowMs ||
        (
          Number.isFinite(deferredUntil) &&
          deferredUntil > nowMs
        ) ||
        (
          Number.isFinite(leaseExpiresAt) &&
          leaseExpiresAt > nowMs
        )
      ) return null;
      const leaseToken = randomBytes(18).toString("base64url");
      transaction.update(bookingRef, {
        enforcementLeaseToken: leaseToken,
        enforcementLeaseExpiresAt: new Date(
          nowMs + BOOKING_ENFORCEMENT_LEASE_MS,
        ).toISOString(),
      });
      return {
        leaseToken,
        booking: {
          ...booking,
          enforcementLeaseToken: leaseToken,
          enforcementLeaseExpiresAt: new Date(
            nowMs + BOOKING_ENFORCEMENT_LEASE_MS,
          ).toISOString(),
        },
      };
    });
  }

  async releaseCommissionEnforcementClaim(
    id: string,
    leaseToken: string,
  ): Promise<boolean> {
    const bookingRef = this.db.collection(BOOKINGS_COLLECTION).doc(id);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(bookingRef);
      if (!snapshot.exists) return false;
      const booking = snapshot.data() as BookingFollowUpDocument;
      if (booking.enforcementLeaseToken !== leaseToken) return false;
      transaction.update(bookingRef, {
        enforcementLeaseToken: null,
        enforcementLeaseExpiresAt: null,
      });
      return true;
    });
  }

  async ensurePauseNotice(
    id: string,
    now = new Date(),
    enforcementLeaseToken?: string,
  ): Promise<"scheduled" | "ready" | "blocked" | "terminal"> {
    const bookingRef = this.db.collection(BOOKINGS_COLLECTION).doc(id);
    const jobRef = this.db.collection(NOTIFICATIONS_COLLECTION).doc(
      notificationId(id, "property_paused"),
    );
    const ownerNoticeRef = this.db.collection(NOTIFICATIONS_COLLECTION).doc(
      notificationId(id, "owner_booking_confirmed"),
    );
    const reminderFiveRef = this.db.collection(NOTIFICATIONS_COLLECTION).doc(
      notificationId(id, "commission_reminder_5"),
    );
    return this.db.runTransaction(async (transaction) => {
      const [
        bookingSnapshot,
        jobSnapshot,
        ownerNoticeSnapshot,
        reminderFiveSnapshot,
      ] = await Promise.all([
        transaction.get(bookingRef),
        transaction.get(jobRef),
        transaction.get(ownerNoticeRef),
        transaction.get(reminderFiveRef),
      ]);
      if (!bookingSnapshot.exists) throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
      const booking = bookingSnapshot.data() as BookingFollowUpDocument;
      if (!await this.ensureFreeBookingEligibility(
        transaction,
        bookingRef,
        booking,
        now,
      )) return "terminal" as const;
      if (
        enforcementLeaseToken &&
        booking.enforcementLeaseToken !== enforcementLeaseToken
      ) return "terminal" as const;
      if (booking.commissionStatus !== "pending" || booking.disputeStatus === "pending") {
        return "terminal" as const;
      }
      const timestamp = now.toISOString();
      const retryFailedNotice = (
        snapshot: FirebaseFirestore.DocumentSnapshot,
      ): "sent" | "waiting" | "blocked" => {
        if (!snapshot.exists) return "blocked";
        const notification = snapshot.data() as BookingNotificationJob;
        if (notification.status === "sent") return "sent";
        if (notification.status === "pending" || notification.status === "claimed") {
          return "waiting";
        }
        if (notification.status === "failed" && notification.attempts < 3) {
          transaction.update(snapshot.ref, {
            status: "pending",
            scheduledAt: timestamp,
            leaseToken: null,
            leaseExpiresAt: null,
            claimedAt: null,
            failedAt: null,
            providerError: null,
            updatedAt: timestamp,
          });
          return "waiting";
        }
        return "blocked";
      };

      if (!ownerNoticeSnapshot.exists) {
        transaction.create(ownerNoticeRef, buildNotificationJob({
          booking,
          kind: "owner_booking_confirmed",
          scheduledAt: timestamp,
          now: timestamp,
        }));
        return "scheduled" as const;
      }
      const ownerNoticeState = retryFailedNotice(ownerNoticeSnapshot);
      if (ownerNoticeState === "waiting") return "scheduled" as const;
      if (ownerNoticeState === "blocked") return "blocked" as const;

      if (!reminderFiveSnapshot.exists) {
        transaction.create(reminderFiveRef, buildNotificationJob({
          booking,
          kind: "commission_reminder_5",
          scheduledAt: timestamp,
          now: timestamp,
        }));
        return "scheduled" as const;
      }
      const reminderFiveState = retryFailedNotice(reminderFiveSnapshot);
      if (reminderFiveState === "waiting") return "scheduled" as const;
      if (reminderFiveState === "blocked") return "blocked" as const;

      if (jobSnapshot.exists) {
        const pauseNoticeState = retryFailedNotice(jobSnapshot);
        if (pauseNoticeState === "sent") return "ready" as const;
        return pauseNoticeState === "waiting"
          ? "scheduled" as const
          : "blocked" as const;
      }
      transaction.create(jobRef, buildNotificationJob({
        booking,
        kind: "property_paused",
        scheduledAt: timestamp,
        now: timestamp,
      }));
      return "scheduled" as const;
    });
  }

  async applyCommissionHold(
    id: string,
    now = new Date(),
    enforcementLeaseToken?: string,
    observedActiveAttemptId?: string | null,
  ): Promise<"paused" | "skipped" | "owner_identity_changed"> {
    const bookingRef = this.db.collection(BOOKINGS_COLLECTION).doc(id);
    const ownerNoticeRef = this.db.collection(NOTIFICATIONS_COLLECTION).doc(
      notificationId(id, "owner_booking_confirmed"),
    );
    const reminderFiveRef = this.db.collection(NOTIFICATIONS_COLLECTION).doc(
      notificationId(id, "commission_reminder_5"),
    );
    const pauseJobRef = this.db.collection(NOTIFICATIONS_COLLECTION).doc(
      notificationId(id, "property_paused"),
    );
    return this.db.runTransaction(async (transaction) => {
      const [
        bookingSnapshot,
        ownerNoticeSnapshot,
        reminderFiveSnapshot,
        pauseJobSnapshot,
      ] = await Promise.all([
        transaction.get(bookingRef),
        transaction.get(ownerNoticeRef),
        transaction.get(reminderFiveRef),
        transaction.get(pauseJobRef),
      ]);
      if (!bookingSnapshot.exists) return "skipped" as const;
      const booking = bookingSnapshot.data() as BookingFollowUpDocument;
      if (!await this.ensureFreeBookingEligibility(
        transaction,
        bookingRef,
        booking,
        now,
      )) return "skipped" as const;
      if (
        observedActiveAttemptId !== undefined &&
        (booking.activeAttemptId || null) !== observedActiveAttemptId
      ) return "skipped" as const;
      if (booking.activeAttemptId) {
        const activeAttemptSnapshot = await transaction.get(
          this.db.collection(ATTEMPTS_COLLECTION).doc(
            booking.activeAttemptId,
          ),
        );
        const activeAttempt = activeAttemptSnapshot.exists
          ? activeAttemptSnapshot.data() as BookingCommissionPaymentAttempt
          : null;
        if (
          activeAttempt &&
          (
            [
              "creating",
              "unknown",
              "pending_review",
              "review_required",
            ].includes(activeAttempt.status) ||
            (
              activeAttempt.status === "created" &&
              (
                activeAttempt.paymentMethod === "bank_transfer" ||
                observedActiveAttemptId !== activeAttempt.id
              )
            )
          )
        ) return "skipped" as const;
      }
      const noticeSentAt = Date.parse(booking.commissionNoticeSentAt || "");
      const dueAt = Date.parse(booking.commissionDueAt || "");
      if (
        booking.commissionStatus !== "pending" ||
        booking.disputeStatus === "pending" ||
        (
          enforcementLeaseToken &&
          booking.enforcementLeaseToken !== enforcementLeaseToken
        ) ||
        !Number.isFinite(noticeSentAt) ||
        !Number.isFinite(dueAt) ||
        dueAt !== noticeSentAt + COMMISSION_PAYMENT_WINDOW_MS ||
        dueAt > now.getTime() ||
        !booking.commissionReminderOffsetsSent.includes(5)
      ) return "skipped" as const;
      const ownerNotice = ownerNoticeSnapshot.exists
        ? ownerNoticeSnapshot.data() as BookingNotificationJob
        : null;
      const reminderFive = reminderFiveSnapshot.exists
        ? reminderFiveSnapshot.data() as BookingNotificationJob
        : null;
      const pauseJob = pauseJobSnapshot.exists
        ? pauseJobSnapshot.data() as BookingNotificationJob
        : null;
      if (
        !ownerNotice || ownerNotice.status !== "sent" ||
        !reminderFive || reminderFive.status !== "sent" ||
        !pauseJob || pauseJob.status !== "sent"
      ) {
        return "skipped" as const;
      }
      const propertyRef = this.db.collection("properties").doc(booking.propertyNumber);
      const propertySnapshot = await transaction.get(propertyRef);
      if (!propertySnapshot.exists) {
        const timestamp = now.toISOString();
        transaction.update(
          bookingRef,
          ownerIdentityReviewUpdates(booking, timestamp),
        );
        return "owner_identity_changed" as const;
      }
      const property = propertySnapshot.data() || {};
      if (!ownerIdentityMatches(booking, property)) {
        const timestamp = now.toISOString();
        transaction.update(
          bookingRef,
          ownerIdentityReviewUpdates(booking, timestamp),
        );
        return "owner_identity_changed" as const;
      }
      const currentIds = Array.isArray(property.commissionHold?.obligationIds)
        ? property.commissionHold.obligationIds.map(String)
        : [];
      const obligationIds = Array.from(new Set([...currentIds, booking.id]));
      const timestamp = now.toISOString();
      const overriddenIds = Array.isArray(
        property.commissionHoldOverride?.obligationIds,
      )
        ? property.commissionHoldOverride.obligationIds.map(String)
        : [];
      // Reaching this point means the booking is pending and is entering a new
      // overdue enforcement cycle. An administrator may have overridden an
      // earlier cycle while leaving its raw obligation ID recorded for audit;
      // that old override must not make this new hold ineffective.
      const nextOverriddenIds = overriddenIds.filter(
        (id: string) => id !== booking.id,
      );
      transaction.update(propertyRef, {
        commissionHold: {
          active: true,
          obligationIds,
          appliedAt: property.commissionHold?.appliedAt || timestamp,
          updatedAt: timestamp,
        },
        ...(nextOverriddenIds.length !== overriddenIds.length
          ? {
              commissionHoldOverride: {
                ...property.commissionHoldOverride,
                obligationIds: nextOverriddenIds,
                updatedAt: timestamp,
              },
            }
          : {}),
        updatedAt: timestamp,
      });
      transaction.update(bookingRef, {
        commissionStatus: "overdue",
        complianceStatus: "paused",
        updatedAt: timestamp,
        events: appendEvent(booking.events, { type: "property_paused", at: timestamp }),
      });
      return "paused" as const;
    });
  }

  async deferEnforcement(
    id: string,
    reason: string,
    retryAt: Date,
    now = new Date(),
    enforcementLeaseToken?: string,
  ): Promise<boolean> {
    const ref = this.db.collection(BOOKINGS_COLLECTION).doc(id);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return false;
      const booking = snapshot.data() as BookingFollowUpDocument;
      if (
        booking.commissionStatus !== "pending" ||
        (
          enforcementLeaseToken &&
          booking.enforcementLeaseToken !== enforcementLeaseToken
        )
      ) return false;
      const existingDeferredUntil = Date.parse(
        booking.enforcementDeferredUntil || "",
      );
      if (
        Number.isFinite(existingDeferredUntil) &&
        existingDeferredUntil >= retryAt.getTime() &&
        booking.enforcementLastError === reason.slice(0, 500)
      ) return true;
      const timestamp = now.toISOString();
      transaction.update(ref, {
        enforcementDeferredUntil: retryAt.toISOString(),
        enforcementLastError: reason.slice(0, 500),
        updatedAt: timestamp,
        events: appendEvent(booking.events, {
          type: "commission_enforcement_deferred",
          at: timestamp,
          detail: reason.slice(0, 200),
        }),
      });
      return true;
    });
  }
}

export const bookingCommissionStore = new BookingCommissionStore();
