import type {
  BookingFollowUpRecord,
  BookingTiming,
  CommissionReminderOffsetDays,
} from "../../shared/booking";

export type BookingEventType =
  | "contact_accepted"
  | "customer_followup_scheduled"
  | "customer_followup_sent"
  | "customer_followup_failed"
  | "customer_followup_suppressed"
  | "customer_followup_expired"
  | "customer_opened"
  | "customer_declined"
  | "booking_confirmed"
  | "owner_notification_sent"
  | "owner_notification_failed"
  | "owner_notification_suppressed"
  | "commission_checkout_created"
  | "commission_checkout_failed"
  | "commission_payment_failed"
  | "commission_paid"
  | "commission_duplicate_payment"
  | "commission_payment_authorized"
  | "commission_payment_reversal_reported"
  | "commission_payment_reversal_collection_resumed"
  | "commission_payment_reversal_kept_paid"
  | "commission_dispute_accepted"
  | "commission_dispute_rejected"
  | "commission_reminder_sent"
  | "commission_reminder_failed"
  | "commission_disputed"
  | "commission_enforcement_deferred"
  | "booking_free_eligibility_lost"
  | "owner_identity_changed"
  | "property_paused"
  | "property_released";

export type BookingEvent = {
  type: BookingEventType;
  at: string;
  detail?: string;
};

export type BookingFollowUpDocument = BookingFollowUpRecord & {
  schemaVersion: 1;
  propertyName: string;
  ownerPhone: string;
  customerPhone: string;
  isFreeProperty: boolean;
  freeEligibilityRevokedAt?: string | null;
  bookingDecision: "yes" | null;
  questionnaireStartedAt: string | null;
  activeAttemptId: string | null;
  paidAttemptId: string | null;
  disputeStatus: "none" | "pending" | "accepted" | "rejected";
  disputedAt: string | null;
  disputeReason: string | null;
  enforcementDeferredUntil: string | null;
  enforcementLastError: string | null;
  enforcementLeaseToken?: string | null;
  enforcementLeaseExpiresAt?: string | null;
  events: BookingEvent[];
};

export type BookingNotificationKind =
  | "customer_followup"
  | "owner_booking_confirmed"
  | "commission_reminder_3"
  | "commission_reminder_4"
  | "commission_reminder_5"
  | "property_paused"
  | "property_released";

export type BookingNotificationStatus =
  | "pending"
  | "claimed"
  | "sent"
  | "failed"
  | "cancelled"
  | "suppressed_quota";

export type BookingNotificationJob = {
  id: string;
  bookingId: string;
  propertyNumber: string;
  recipientRole: "customer" | "owner";
  recipientPhone: string;
  recipientQuotaKey: string;
  kind: BookingNotificationKind;
  reminderOffsetDays: CommissionReminderOffsetDays | null;
  scheduledAt: string;
  status: BookingNotificationStatus;
  isFreeProperty: boolean;
  quotaCategory: "customer_followup" | "free_owner_booking" | "transactional";
  attempts: number;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  claimedAt: string | null;
  sentAt: string | null;
  failedAt: string | null;
  suppressedAt: string | null;
  providerError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BookingCommissionPaymentAttempt = {
  id: string;
  bookingId: string;
  propertyNumber: string;
  amountCents: number;
  currency: "SAR";
  paymentMethod: "cards" | "applepay";
  merchantAttemptKey: string;
  status: "creating" | "created" | "unknown" | "failed" | "paid" | "duplicate_paid";
  intentionId: string | null;
  paymobOrderId: string | null;
  checkoutUrl: string | null;
  transactionId: string | null;
  exactPaymentMethod: string | null;
  providerCreatedAt: string | null;
  paidAt: string | null;
  failureReason: string | null;
  authorizationTransactionId?: string | null;
  authorizedAt?: string | null;
  nonPayableStatus?: "refunded" | "voided" | "errored" | "other_nonpayable" | null;
  nonPayableTransactionId?: string | null;
  nonPayableAt?: string | null;
  reversalStatus?: "refunded" | "voided" | "errored" | "authorization_only" | "other_nonpayable" | null;
  reversalTransactionId?: string | null;
  reversedAt?: string | null;
  reversalResolution?: "resume_collection" | "keep_paid" | null;
  reversalResolvedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BookingCommissionWebhookInput = {
  paymobOrderId: string;
  transactionId: string;
  amountCents: number;
  currency: string;
  success: boolean;
  exactPaymentMethod?: string;
  providerCreatedAt?: string;
  callbackAttemptId?: string;
  callbackBookingId?: string;
  callbackMerchantAttemptKey?: string;
  callbackSpecialReference?: string;
};

export type BookingAdminNotificationJob = Omit<
  BookingNotificationJob,
  "recipientPhone" | "recipientQuotaKey" | "leaseToken"
>;

export type BookingAdminPaymentAttempt = Omit<
  BookingCommissionPaymentAttempt,
  "checkoutUrl"
>;

export type BookingAdminRow = Omit<
  BookingFollowUpDocument,
  | "customerSubject"
  | "customerPhone"
  | "ownerPhone"
  | "bookingStatus"
  | "enforcementLeaseToken"
  | "enforcementLeaseExpiresAt"
> & {
  bookingStatus: BookingFollowUpDocument["bookingStatus"] | "expired";
  customerPhoneMasked: string | null;
  notificationSummary: {
    sent: number;
    failed: number;
    pending: number;
    suppressed: number;
  };
  notificationJobs: BookingAdminNotificationJob[];
  paymentAttempt: BookingAdminPaymentAttempt | null;
  paymentAttempts: BookingAdminPaymentAttempt[];
};

export type BookingPublicRow = {
  id: string;
  requestCode: string;
  propertyNumber: string;
  propertyName: string;
  contactAt: string;
  bookingStatus: BookingFollowUpDocument["bookingStatus"] | "questionnaire_pending" | "expired";
  questionnaire: null | {
    timing: BookingTiming;
    bookingDate: string;
    bookingDatePrecision: "day" | "month";
    pricePaidHalalas: number;
  };
  answeredAt: string | null;
};
