import type {
  BookingAdminCustomerWhatsAppTemplateVariant,
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
  | "customer_final_reminder_scheduled"
  | "customer_final_reminder_sent"
  | "customer_final_reminder_failed"
  | "customer_final_reminder_suppressed"
  | "customer_opened"
  | "admin_customer_whatsapp_opened"
  | "customer_declined"
  | "booking_confirmed"
  | "owner_notification_sent"
  | "owner_notification_failed"
  | "owner_notification_suppressed"
  | "notification_manual_resend_scheduled"
  | "commission_checkout_created"
  | "commission_checkout_failed"
  | "commission_bank_receipt_submitted"
  | "commission_bank_receipt_approved"
  | "commission_bank_receipt_rejected"
  | "commission_bank_receipt_refund_review"
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
  /** Contact-time property price choices. Older records may predate this snapshot. */
  listedPriceOptionsHalalas?: number[];
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
  /** Automatic sequence policy captured when this workflow was created. */
  customerFollowUpMessageLimit?: number;
  customerFollowUpDelayMinutes?: number;
  /** Free-property contact allowance captured when this request was accepted. */
  freePropertyContactDailyLimit?: number;
  /** Current automatic customer-sequence job, if one is still actionable. */
  activeCustomerNotificationJobId?: string | null;
  /** Last successful admin handoff to this customer's WhatsApp. */
  adminCustomerWhatsAppLastOpenedAt?: string | null;
};

export type BookingNotificationKind =
  | "customer_followup"
  | "customer_final_reminder"
  | "owner_contact_limit_reached"
  | "owner_booking_confirmed"
  | "commission_dispute_rejected"
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
  /** Riyadh quota window already reserved by this logical job, if any. */
  quotaReservedWindowStartedAt?: number | null;
  /** One-based position in the automatic follow-up sequence. */
  customerFollowUpSequenceNumber?: number | null;
  /** Previous automatic sequence job which created this job. */
  customerFollowUpSequenceParentJobId?: string | null;
  attempts: number;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  claimedAt: string | null;
  sentAt: string | null;
  failedAt: string | null;
  suppressedAt: string | null;
  providerError: string | null;
  /** Present only on an additional send explicitly requested by an admin. */
  manualResendOfJobId?: string | null;
  manualResendRequestedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BookingCommissionPaymentAttempt = {
  id: string;
  bookingId: string;
  propertyNumber: string;
  amountCents: number;
  currency: "SAR";
  paymentMethod: "cards" | "applepay" | "bank_transfer";
  merchantAttemptKey: string;
  status:
    | "creating"
    | "created"
    | "pending_review"
    | "review_required"
    | "unknown"
    | "failed"
    | "paid"
    | "duplicate_paid";
  intentionId: string | null;
  paymobOrderId: string | null;
  checkoutUrl: string | null;
  transactionId: string | null;
  exactPaymentMethod: string | null;
  providerCreatedAt: string | null;
  paidAt: string | null;
  failureReason: string | null;
  receiptUrl?: string | null;
  /** Internal storage identity. This must never be returned to a browser. */
  receiptObjectKey?: string | null;
  receiptContentType?: "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | null;
  receiptSizeBytes?: number | null;
  receiptSubmittedAt?: string | null;
  bankReviewDecision?: "approved" | "rejected" | "refund_review" | null;
  bankReviewReason?: string | null;
  bankReviewedAt?: string | null;
  bankReviewPropertyReleased?: boolean | null;
  /** Financial evidence was received but must not settle this obligation. */
  financialReviewDecision?: "refund_review" | null;
  financialReviewReason?: string | null;
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
  "checkoutUrl" | "receiptObjectKey"
>;

export type BookingAdminRow = Omit<
  BookingFollowUpDocument,
  | "customerSubject"
  | "customerPhone"
  | "ownerPhone"
  | "adminCustomerWhatsAppLastOpenedAt"
  | "bookingStatus"
  | "enforcementLeaseToken"
  | "enforcementLeaseExpiresAt"
> & {
  bookingStatus: BookingFollowUpDocument["bookingStatus"] | "expired";
  customerPhoneMasked: string | null;
  customerWhatsAppNextAllowedAt: string | null;
  adminCustomerWhatsAppTemplateVariants:
    BookingAdminCustomerWhatsAppTemplateVariant[];
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
  listedPriceOptionsHalalas: number[];
  contactAt: string;
  bookingStatus: BookingFollowUpDocument["bookingStatus"] | "questionnaire_pending" | "expired";
  questionnaire: null | {
    timing: BookingTiming;
    bookingDate: string;
    bookingDatePrecision: "day" | "month";
    bookingDateCalendar?: "gregorian" | "hijri";
    bookingDateStart?: string;
    bookingDateEnd?: string;
    pricePaidHalalas: number;
  };
  answeredAt: string | null;
};
