import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { db as configuredDb } from "../config/firebase";
import {
  bookingFreeWorkflowLimitsSchema,
  bookingConfirmationFactsSchema,
  bookingFollowUpRecordSchema,
  buildConfirmedBookingFinancials,
  calculateCommissionDueAt,
  calculateCommissionReminderSchedule,
  COMMISSION_PAYMENT_WINDOW_MS,
  type BookingConfirmationFacts,
  type BookingFreeWorkflowLimits,
  type BookingFreeWorkflowSettings,
  type BookingFollowUpRecord,
} from "../../shared/booking";
import type { Subscription } from "../../shared/schema";
import { isActivePremiumSubscription } from "../../shared/subscriptionType";
import {
  calculateRemainingDays,
  getEndOfDayRiyadh,
  getStartOfDayRiyadh,
} from "../utils/dateUtils";
import { selectCurrentSubscriptionForProperty } from "../utils/subscriptionSelection";
import { normalizeSaudiMobilePhone } from "../../shared/phone";
import type {
  BookingCommissionPaymentAttempt,
  BookingCommissionWebhookInput,
  BookingEvent,
  BookingFollowUpDocument,
  BookingNotificationJob,
  BookingNotificationKind,
} from "./BookingCommissionTypes";

const BOOKINGS_COLLECTION = "booking_followups";
const NOTIFICATIONS_COLLECTION = "booking_notification_outbox";
const ATTEMPTS_COLLECTION = "booking_commission_payment_attempts";
const ORDER_BINDINGS_COLLECTION = "booking_commission_order_bindings";
const TRANSACTION_BINDINGS_COLLECTION = "booking_commission_transaction_bindings";
const REVERSAL_BINDINGS_COLLECTION = "booking_commission_reversal_bindings";
const QUOTAS_COLLECTION = "booking_notification_quotas";
const SETTINGS_COLLECTION = "settings";
const FREE_WORKFLOW_SETTINGS_DOCUMENT = "booking_free_workflow_limits";
const FREE_WORKFLOW_SETTINGS_AUDIT_COLLECTION =
  "booking_free_workflow_limits_audit";

export const BOOKING_FOLLOW_UP_DELAY_MS = 24 * 60 * 60 * 1000;
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
  ) {
    super(message);
    this.name = "BookingWorkflowError";
  }
}

export type InitialBookingWorkflow = {
  followUp: Omit<BookingFollowUpDocument, "contactRequestId">;
  customerNotification: BookingNotificationJob;
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

function resolvedFreeWorkflowSettings(value: unknown): BookingFreeWorkflowSettings {
  const stored = storedFreeWorkflowLimits(value);
  if (!stored) {
    return {
      ...getEnvironmentFreeWorkflowLimits(),
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

function buildNotificationJob(options: {
  booking: Pick<BookingFollowUpDocument,
    "id" | "propertyNumber" | "ownerPhone" | "customerPhone" |
    "customerSubject" | "isFreeProperty" | "commissionStatus">;
  kind: BookingNotificationKind;
  scheduledAt: string;
  now: string;
}): BookingNotificationJob {
  const isCustomer = options.kind === "customer_followup";
  const isOwnerBookingFact = options.kind === "owner_booking_confirmed";
  const reminderMatch = /^commission_reminder_([345])$/.exec(options.kind);
  const reminderOffsetDays = reminderMatch
    ? Number(reminderMatch[1]) as 3 | 4 | 5
    : null;
  return {
    id: notificationId(options.booking.id, options.kind),
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
    attempts: 0,
    leaseToken: null,
    leaseExpiresAt: null,
    claimedAt: null,
    sentAt: null,
    failedAt: null,
    suppressedAt: null,
    providerError: null,
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
  listedPriceOptionsHalalas?: number[];
  now?: Date;
}): InitialBookingWorkflow {
  if (options.isFreeProperty !== true) {
    throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
  }
  const now = options.now || new Date();
  if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid booking time");
  const createdAt = now.toISOString();
  const followUpDueAt = new Date(now.getTime() + BOOKING_FOLLOW_UP_DELAY_MS).toISOString();
  const id = `BOOK-${options.requestCode}`;
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
      { type: "customer_followup_scheduled", at: createdAt },
    ],
    createdAt,
    updatedAt: createdAt,
  };
  const customerNotification = buildNotificationJob({
    booking: followUp,
    kind: "customer_followup",
    scheduledAt: followUpDueAt,
    now: createdAt,
  });
  return { followUp, customerNotification };
}

function quotaLimitFor(
  job: BookingNotificationJob,
  limits: BookingFreeWorkflowLimits,
): number | null {
  if (job.quotaCategory === "transactional") return null;
  return job.quotaCategory === "customer_followup"
    ? limits.customerDailyLimit
    : limits.freeOwnerDailyLimit;
}

function quotaDocumentId(job: BookingNotificationJob, windowStart: number): string {
  const role = job.quotaCategory === "customer_followup" ? "customer" : "owner";
  return `${role}-${job.recipientQuotaKey}-${windowStart}`;
}

export class BookingCommissionStore {
  private get db(): Firestore {
    return requireFirestore(this.database);
  }

  constructor(private readonly database?: Firestore | null) {}

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
    rawLimits: BookingFreeWorkflowLimits,
    now = new Date(),
  ): Promise<BookingFreeWorkflowSettings> {
    const limits = bookingFreeWorkflowLimitsSchema.parse(rawLimits);
    if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid settings time");
    const settingsRef = this.db.collection(SETTINGS_COLLECTION)
      .doc(FREE_WORKFLOW_SETTINGS_DOCUMENT);
    const auditId = `BOOKING-LIMITS-${now.getTime()}-${randomBytes(6).toString("hex")}`;
    const auditRef = this.db.collection(FREE_WORKFLOW_SETTINGS_AUDIT_COLLECTION)
      .doc(auditId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(settingsRef);
      const currentData = snapshot.exists ? snapshot.data() : null;
      const currentStored = storedFreeWorkflowLimits(currentData);
      if (
        currentStored &&
        currentStored.customerDailyLimit === limits.customerDailyLimit &&
        currentStored.freeOwnerDailyLimit === limits.freeOwnerDailyLimit &&
        currentStored.freePropertyContactDailyLimit ===
          limits.freePropertyContactDailyLimit
      ) {
        return resolvedFreeWorkflowSettings(currentData);
      }

      const updatedAt = now.toISOString();
      const storedSettings = {
        schemaVersion: 1,
        ...limits,
        updatedAt,
        updatedBy: "admin" as const,
      };
      const previous = resolvedFreeWorkflowSettings(currentData);
      transaction.set(settingsRef, storedSettings);
      transaction.create(auditRef, {
        id: auditId,
        type: "booking_free_workflow_limits_updated",
        previous,
        next: limits,
        updatedAt,
        updatedBy: "admin",
      });
      return {
        ...limits,
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
    const [propertySnapshot, jobsSnapshot] = await Promise.all([
      transaction.get(propertyRef),
      transaction.get(jobsQuery),
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
      events: appendEventOnce(booking.events, {
        type: "booking_free_eligibility_lost",
        at: timestamp,
        detail: activePremium ? "active_premium_subscription" : "non_free_origin",
      }),
      updatedAt: timestamp,
    };
    transaction.update(bookingRef, updates);
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

  async listBookingsForCustomer(customerSubject: string): Promise<BookingFollowUpDocument[]> {
    const snapshot = await this.db.collection(BOOKINGS_COLLECTION)
      .where("customerSubject", "==", customerSubject)
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
      const at = now.toISOString();
      const updates = {
        bookingDecision: "yes" as const,
        questionnaireStartedAt: at,
        updatedAt: at,
      };
      transaction.update(ref, updates);
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
      const at = now.toISOString();
      const updates = {
        bookingStatus: "declined" as const,
        declinedAt: at,
        bookingDecision: null,
        questionnaireStartedAt: null,
        updatedAt: at,
        events: appendEvent(booking.events, { type: "customer_declined", at }),
      };
      transaction.update(ref, updates);
      return { ...booking, ...updates } as BookingFollowUpDocument;
    });
    if (!result) throw new BookingWorkflowError("BOOKING_NOT_FOUND", "Booking not found", 404);
    return result;
  }

  async confirmBooking(
    id: string,
    rawFacts: BookingConfirmationFacts,
    now = new Date(),
    commissionEnabled = false,
  ): Promise<BookingFollowUpDocument> {
    const facts = bookingConfirmationFactsSchema.parse(rawFacts);
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
      const propertySnapshot = await transaction.get(propertyRef);
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
          ...ownerIdentityReviewUpdates(booking, confirmedAt),
          events: appendEventOnce(
            appendEvent(booking.events, { type: "booking_confirmed", at: confirmedAt }),
            { type: "owner_identity_changed", at: confirmedAt, detail: "owner_identity_changed" },
          ),
        };
        transaction.update(ref, updates);
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
          ? financials.commissionReminderSchedule.map((reminder) =>
              buildNotificationJob({
                booking: confirmedBooking,
                kind: `commission_reminder_${reminder.offsetDays}` as BookingNotificationKind,
                scheduledAt: reminder.scheduledAt,
                now: confirmedAt,
              }))
          : []),
      ];

      transaction.update(ref, updates);
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
      if (booking.bookingStatus !== "confirmed") {
        throw new BookingWorkflowError("COMMISSION_NOT_APPLICABLE", "Commission is not applicable");
      }
      if (booking.commissionStatus === "paid" || booking.commissionStatus === "waived") {
        throw new BookingWorkflowError("COMMISSION_ALREADY_CLOSED", "Commission is already closed");
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
  ): Promise<{ booking: BookingFollowUpDocument; propertyReleased: boolean }> {
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
        if (
          (resolution === "resume_collection" && booking.disputeStatus === "rejected") ||
          (resolution === "cancel_commission" && booking.disputeStatus === "accepted")
        ) {
          return { booking, propertyReleased: false };
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
        ...reminderSnapshots
      ] = await Promise.all([
        transaction.get(propertyRef),
        transaction.get(attemptsQuery),
        transaction.get(ownerNoticeRef),
        transaction.get(pauseJobRef),
        transaction.get(releaseJobRef),
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
            .filter(({ snapshot }) =>
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

        transaction.update(bookingRef, updates);
        return {
          booking: { ...booking, ...updates },
          propertyReleased: false,
        };
      }

      const attempts = attemptsSnapshot.docs.map((document) =>
        document.data() as BookingCommissionPaymentAttempt);
      const financiallyUnresolvedAttempts = attempts.filter((attempt) =>
        attempt.status !== "failed" ||
        Boolean(attempt.reversalStatus && !attempt.reversalResolution));
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
      const propertyReleased =
        propertySnapshot.exists && obligationReleased && remainingHoldIds.length === 0;
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

      for (const snapshot of [...reminderSnapshots, pauseJobSnapshot]) {
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
      if (propertyReleased && !releaseJobSnapshot.exists) {
        transaction.create(releaseJobRef, buildNotificationJob({
          booking,
          kind: "property_released",
          scheduledAt: timestamp,
          now: timestamp,
        }));
      }
      transaction.update(bookingRef, updates);
      const resolvedBooking = { ...booking, ...updates } as BookingFollowUpDocument;
      coreBookingRecord(resolvedBooking);
      return { booking: resolvedBooking, propertyReleased };
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
    paymentMethod: "cards" | "applepay";
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
        if (activeAttempt.checkoutUrl) {
          return { status: "reused", booking, attempt: activeAttempt } as const;
        }
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
    return this.db.runTransaction(async (transaction) => {
      const [attemptSnapshot, orderSnapshot] = await Promise.all([
        transaction.get(attemptRef),
        transaction.get(orderRef),
      ]);
      if (!attemptSnapshot.exists) throw new BookingWorkflowError("PAYMENT_ATTEMPT_NOT_FOUND", "Payment attempt not found", 404);
      const attempt = attemptSnapshot.data() as BookingCommissionPaymentAttempt;
      if (attempt.status === "created") {
        if (
          attempt.intentionId === options.intentionId &&
          attempt.paymobOrderId === options.paymobOrderId &&
          attempt.checkoutUrl === options.checkoutUrl
        ) return attempt;
        throw new BookingWorkflowError("PAYMENT_ATTEMPT_IDENTITY_CONFLICT", "Payment identity conflict");
      }
      if (attempt.status !== "creating" && attempt.status !== "unknown") {
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
      const updatedAt = (options.now || new Date()).toISOString();
      const updates = {
        status: "created" as const,
        intentionId: options.intentionId,
        paymobOrderId: options.paymobOrderId,
        checkoutUrl: options.checkoutUrl,
        failureReason: null,
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
      if (bookingSnapshot.exists) {
        transaction.update(bookingRef, {
          updatedAt,
          events: appendEvent(
            bookingSnapshot.data()?.events,
            { type: "commission_checkout_created", at: updatedAt },
          ),
        });
      }
      return { ...attempt, ...updates };
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

      const propertyRef = this.db.collection("properties").doc(booking.propertyNumber);
      const propertySnapshot = await transaction.get(propertyRef);
      const property = propertySnapshot.data() || {};
      const activeHoldIds = Array.isArray(property.commissionHold?.obligationIds)
        ? property.commissionHold.obligationIds.map(String)
        : [];
      const remainingHoldIds = activeHoldIds.filter((value: string) => value !== booking.id);
      const wasPaused = booking.complianceStatus === "paused" || activeHoldIds.includes(booking.id);
      const obligationReleased = wasPaused;
      const propertyReleased =
        propertySnapshot.exists && wasPaused && remainingHoldIds.length === 0;
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
      transaction.set(transactionRef, {
        transactionId: input.transactionId,
        bookingId: booking.id,
        attemptId: attempt.id,
        success: true,
        createdAt: timestamp,
      });
      if (propertySnapshot.exists && wasPaused) {
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
    const snapshot = await this.db.collection(NOTIFICATIONS_COLLECTION)
      .where("status", "==", "claimed")
      .where("leaseExpiresAt", "<=", nowIso)
      .limit(100)
      .get();
    if (snapshot.empty) return 0;
    const batch = this.db.batch();
    for (const document of snapshot.docs) {
      batch.update(document.ref, {
        status: "pending",
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: nowIso,
      });
    }
    await batch.commit();
    return snapshot.size;
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
    const freeWorkflowLimits = await this.getFreeWorkflowSettings();
    const dueSnapshot = await this.db.collection(NOTIFICATIONS_COLLECTION)
      .where("status", "==", "pending")
      .where("scheduledAt", "<=", nowIso)
      .orderBy("scheduledAt", "asc")
      .limit(Math.min(Math.max(1, maxJobs), 100))
      .get();
    const claims: ClaimedBookingNotification[] = [];

    for (const candidate of dueSnapshot.docs) {
      const claimed = await this.db.runTransaction(async (transaction) => {
        const jobSnapshot = await transaction.get(candidate.ref);
        if (!jobSnapshot.exists) return null;
        const job = jobSnapshot.data() as BookingNotificationJob;
        if (job.status !== "pending" || Date.parse(job.scheduledAt) > now.getTime()) return null;
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
        if (!await this.ensureFreeBookingEligibility(
          transaction,
          bookingRef,
          booking,
          now,
        )) return null;
        if (job.kind === "customer_followup" && customerResponseExpired(booking, now)) {
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
            updatedAt: nowIso,
          });
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
        }
        const commissionControlled =
          job.kind.startsWith("commission_reminder_") ||
          job.kind === "property_paused" ||
          (
            job.kind === "owner_booking_confirmed" &&
            booking.commissionStatus !== "not_applicable"
          );
        const followUpControlled =
          job.kind === "customer_followup" ||
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
        if (quotaLimit !== null) {
          const windowStart = getStartOfDayRiyadh(now).getTime();
          const windowEnd = getEndOfDayRiyadh(now).getTime() + 1;
          const quotaRef = this.db.collection(QUOTAS_COLLECTION)
            .doc(quotaDocumentId(job, windowStart));
          const quotaSnapshot = await transaction.get(quotaRef);
          const currentCount = quotaSnapshot.exists
            ? Number(quotaSnapshot.data()?.count || 0)
            : 0;
          if (currentCount >= quotaLimit) {
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
              events: appendEvent(booking.events, { type: eventType, at: nowIso }),
              updatedAt: nowIso,
            });
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
        }

        const leaseToken = randomBytes(18).toString("base64url");
        const claimedJob: ClaimedBookingNotification = {
          ...job,
          status: "claimed",
          attempts: job.attempts + 1,
          leaseToken,
          leaseExpiresAt: new Date(now.getTime() + BOOKING_NOTIFICATION_LEASE_MS).toISOString(),
          claimedAt: nowIso,
          updatedAt: nowIso,
        };
        transaction.update(candidate.ref, claimedJob);
        return claimedJob;
      });
      if (claimed) claims.push(claimed);
    }
    return claims;
  }

  async prepareNotificationForSend(
    jobId: string,
    leaseToken: string,
    now = new Date(),
  ): Promise<
    | { status: "ready"; booking: BookingFollowUpDocument }
    | { status: "blocked"; reason: "claim_invalid" | "booking_not_found" | "customer_response_expired" | "owner_identity_changed" | "booking_ineligible" }
  > {
    const jobRef = this.db.collection(NOTIFICATIONS_COLLECTION).doc(jobId);
    return this.db.runTransaction(async (transaction) => {
      const jobSnapshot = await transaction.get(jobRef);
      if (!jobSnapshot.exists) return { status: "blocked", reason: "claim_invalid" } as const;
      const job = jobSnapshot.data() as BookingNotificationJob;
      if (job.status !== "claimed" || job.leaseToken !== leaseToken) {
        return { status: "blocked", reason: "claim_invalid" } as const;
      }
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
      const timestamp = now.toISOString();
      if (!await this.ensureFreeBookingEligibility(
        transaction,
        bookingRef,
        booking,
        now,
      )) return { status: "blocked", reason: "booking_ineligible" } as const;
      if (job.kind === "customer_followup" && customerResponseExpired(booking, now)) {
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
          updatedAt: timestamp,
        });
        return { status: "blocked", reason: "customer_response_expired" } as const;
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
      }
      return { status: "ready", booking } as const;
    });
  }

  async finishNotificationJob(options: {
    jobId: string;
    leaseToken: string;
    success: boolean;
    error?: string;
    now?: Date;
  }): Promise<boolean> {
    const now = options.now || new Date();
    const timestamp = now.toISOString();
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
      if (
        booking &&
        !await this.ensureFreeBookingEligibility(
          transaction,
          bookingRef,
          booking,
          now,
        )
      ) return true;
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
        : job.kind === "owner_booking_confirmed"
          ? "owner_notification_sent"
          : job.kind.startsWith("commission_reminder_")
            ? "commission_reminder_sent"
            : job.kind === "property_released"
              ? "property_released"
              : "owner_notification_sent";
      const failureEvent = job.kind === "customer_followup"
        ? "customer_followup_failed"
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
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: timestamp,
      });
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
        transaction.update(bookingRef, {
          commissionReminderOffsetsSent: reminderOffsets,
          ...commissionNoticeUpdates,
          events: appendEvent(booking.events, {
            type: options.success ? successEvent : failureEvent,
            at: timestamp,
            ...(!options.success && options.error ? { detail: options.error.slice(0, 200) } : {}),
          }),
          updatedAt: timestamp,
        });
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
    const snapshot = await this.db.collection(BOOKINGS_COLLECTION)
      .where("commissionStatus", "==", "pending")
      .where("commissionDueAt", "<=", now.toISOString())
      .limit(Math.min(Math.max(1, limit), 200))
      .get();
    return snapshot.docs
      .map((document) => document.data() as BookingFollowUpDocument)
      .filter((booking) =>
        booking.isFreeProperty === true &&
        !booking.freeEligibilityRevokedAt &&
        booking.bookingStatus === "confirmed" &&
        booking.disputeStatus !== "pending" &&
        (!booking.enforcementDeferredUntil || Date.parse(booking.enforcementDeferredUntil) <= now.getTime()));
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
      transaction.update(propertyRef, {
        commissionHold: {
          active: true,
          obligationIds,
          appliedAt: property.commissionHold?.appliedAt || timestamp,
          updatedAt: timestamp,
        },
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
