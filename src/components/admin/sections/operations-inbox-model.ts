import type {
  AdminOperationCategory,
  AdminOperationMetadata,
  AdminOperationPriority,
  AdminOperationSnapshot,
} from "../../../../shared/adminOperations";

export type OperationCategory = AdminOperationCategory;

export type OperationPriority = AdminOperationPriority;

export interface OperationItem {
  id: string;
  category: OperationCategory;
  priority: OperationPriority;
  title: string;
  description: string;
  reference: string;
  propertyNumber?: string | null;
  propertyName?: string | null;
  occurredAt?: string | null;
  statusLabel: string;
  href: string;
  actionLabel: string;
}

export interface ManagedOperationItem extends OperationItem {
  workflow: AdminOperationMetadata;
}

interface PropertyRecord {
  propertyNumber?: string | null;
  name?: string | null;
  verificationStatus?: string | null;
  pendingApprovalFrom?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

interface AdditionalPropertyRequest {
  propertyNumber?: string | null;
  name?: string | null;
  city?: string | null;
  pendingApprovalFrom?: string | null;
  mainPropertyName?: string | null;
  requestedAt?: string | null;
}

interface AdditionalPropertyPayload {
  pendingRequests?: AdditionalPropertyRequest[] | null;
}

interface NotificationJob {
  id?: string | null;
  status?: string | null;
  providerError?: string | null;
  providerDeliveryStatus?: string | null;
  providerDeliveryError?: string | null;
  recipientRole?: string | null;
  failedAt?: string | null;
  providerFailedAt?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
}

interface PaymentAttempt {
  id?: string | null;
  paymentMethod?: string | null;
  status?: string | null;
  receiptUrl?: string | null;
  receiptSubmittedAt?: string | null;
  bankReviewDecision?: string | null;
  reversalStatus?: string | null;
  reversalResolution?: string | null;
  reversedAt?: string | null;
  updatedAt?: string | null;
}

interface BookingRecord {
  id?: string | null;
  propertyNumber?: string | null;
  propertyName?: string | null;
  requestCode?: string | null;
  contactAt?: string | null;
  commissionStatus?: string | null;
  dueAt?: string | null;
  disputeStatus?: string | null;
  disputedAt?: string | null;
  disputeReason?: string | null;
  customerOwnerNoResponseReportedAt?: string | null;
  notificationJobs?: NotificationJob[] | null;
  paymentAttempt?: PaymentAttempt | null;
  paymentAttempts?: PaymentAttempt[] | null;
}

interface BookingDashboardPayload {
  bookings?: BookingRecord[] | null;
}

interface WhatsAppLog {
  id?: string | null;
  type?: string | null;
  status?: string | null;
  response?: string | null;
  createdAt?: string | null;
  propertyNumber?: string | null;
  propertyName?: string | null;
  providerDeliveryStatus?: string | null;
  providerDeliveryError?: string | null;
  providerFailedAt?: string | null;
}

interface SubscriptionPayment {
  id?: string | null;
  propertyNumber?: string | null;
  propertyName?: string | null;
  paymentMethod?: string | null;
  status?: string | null;
  receiptUrl?: string | null;
  createdAt?: string | null;
}

interface PropertyHold {
  propertyNumber?: string | null;
  name?: string | null;
  kind?: string | null;
  suspendedAt?: string | null;
  manualHold?: boolean;
  commissionHold?: boolean;
  commissionObligationCount?: number;
}

interface PropertyAvailabilityPayload {
  holds?: PropertyHold[] | null;
}

interface SubscriptionRecord {
  id?: string | null;
  propertyNumber?: string | null;
  name?: string | null;
  status?: string | null;
  remainingDays?: number | null;
  endDate?: string | null;
}

export interface OperationsInboxSources {
  properties?: PropertyRecord[] | null;
  additionalProperties?: AdditionalPropertyPayload | null;
  whatsappLogs?: WhatsAppLog[] | null;
  bookingDashboard?: BookingDashboardPayload | null;
  payments?: SubscriptionPayment[] | null;
  availability?: PropertyAvailabilityPayload | null;
  subscriptions?: SubscriptionRecord[] | null;
}

const priorityRank: Record<OperationPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
};

const EXPIRING_SUBSCRIPTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const riyadhCalendarDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Riyadh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const operationCategoryLabels: Record<OperationCategory, string> = {
  property_approval: "اعتماد العقارات",
  whatsapp_failure: "رسائل واتساب فاشلة",
  bank_receipt: "إيصالات بنكية",
  dispute: "اعتراضات ومراجعات",
  overdue_commission: "عمولات متأخرة",
  suspended_property: "عقارات موقوفة",
  expiring_subscription: "اشتراكات قاربت على الانتهاء",
};

function normalized(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function safeIdentifier(value: unknown, fallback: string): string {
  const identifier = String(value || "").trim();
  return identifier || fallback;
}

function routeWithSearch(path: string, key: string, value: unknown): string {
  const normalizedValue = String(value || "").trim();
  return normalizedValue
    ? `${path}?${key}=${encodeURIComponent(normalizedValue)}`
    : path;
}

function isPendingPropertyVerification(value: unknown): boolean {
  return ["pending", "under_review", "review_required", "needs_review"]
    .includes(normalized(value));
}

function isFailedStatus(value: unknown): boolean {
  return ["failed", "error", "rejected", "undelivered"]
    .includes(normalized(value));
}

function isPendingBankReview(attempt: PaymentAttempt): boolean {
  const status = normalized(attempt.status);
  const decision = normalized(attempt.bankReviewDecision);
  return normalized(attempt.paymentMethod) === "bank_transfer"
    && Boolean(attempt.receiptUrl)
    && !["approved", "rejected"].includes(decision)
    && ["pending", "pending_review", "review_required", "unknown", "created"]
      .includes(status);
}

function isPendingSubscriptionBankReview(payment: SubscriptionPayment): boolean {
  const method = normalized(payment.paymentMethod);
  const status = normalized(payment.status);
  return Boolean(payment.receiptUrl)
    && (method.includes("bank") || method.includes("تحويل"))
    && [
      "pending",
      "pending_review",
      "review_required",
      "processing",
      "قيد_التحقق",
      "قيد_المراجعة",
    ]
      .includes(status);
}

function isPendingReversal(attempt: PaymentAttempt): boolean {
  return Boolean(normalized(attempt.reversalStatus))
    && !normalized(attempt.reversalResolution);
}

function latestTimestamp(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (value && Number.isFinite(new Date(value).getTime())) return value;
  }
  return null;
}

function expiringSubscriptionOccurrenceAt(
  endDate: string | null | undefined,
): string | null {
  const end = new Date(endDate || "");
  if (!Number.isFinite(end.getTime())) return null;
  const endDayParts = riyadhCalendarDateFormatter.formatToParts(end);
  const endDay = Object.fromEntries(
    endDayParts.map((part) => [part.type, part.value]),
  );
  const endDayStart = Date.parse(
    `${endDay.year}-${endDay.month}-${endDay.day}T00:00:00+03:00`,
  );
  if (!Number.isFinite(endDayStart)) return null;
  return new Date(endDayStart - EXPIRING_SUBSCRIPTION_WINDOW_MS).toISOString();
}

function sortOperations(items: OperationItem[]): OperationItem[] {
  return items.sort((left, right) => {
    const priorityDifference = priorityRank[left.priority] - priorityRank[right.priority];
    if (priorityDifference !== 0) return priorityDifference;
    const leftTime = new Date(left.occurredAt || 0).getTime();
    const rightTime = new Date(right.occurredAt || 0).getTime();
    return leftTime - rightTime;
  });
}

export function buildOperationsInbox(
  sources: OperationsInboxSources,
): OperationItem[] {
  const items: OperationItem[] = [];
  const additionalPropertyNumbers = new Set<string>();

  for (const request of sources.additionalProperties?.pendingRequests || []) {
    const propertyNumber = safeIdentifier(request.propertyNumber, "unknown");
    additionalPropertyNumbers.add(propertyNumber);
    items.push({
      id: `additional-property-${propertyNumber}`,
      category: "property_approval",
      priority: "high",
      title: request.name || `عقار ${propertyNumber}`,
      description: request.mainPropertyName
        ? `طلب إضافة إلى ${request.mainPropertyName}`
        : "طلب إضافة عقار يحتاج مراجعة",
      reference: propertyNumber,
      propertyNumber,
      propertyName: request.name,
      occurredAt: request.requestedAt,
      statusLabel: "بانتظار الاعتماد",
      href: routeWithSearch("/admin/properties", "property", propertyNumber),
      actionLabel: "مراجعة الطلب",
    });
  }

  for (const property of sources.properties || []) {
    const propertyNumber = safeIdentifier(property.propertyNumber, "unknown");
    if (
      additionalPropertyNumbers.has(propertyNumber)
      || !isPendingPropertyVerification(property.verificationStatus)
    ) continue;
    items.push({
      id: `property-verification-${propertyNumber}`,
      category: "property_approval",
      priority: "high",
      title: property.name || `عقار ${propertyNumber}`,
      description: "بيانات العقار تحتاج مراجعة واعتماد",
      reference: propertyNumber,
      propertyNumber,
      propertyName: property.name,
      occurredAt: latestTimestamp(property.updatedAt, property.createdAt),
      statusLabel: "قيد المراجعة",
      href: routeWithSearch("/admin/verification", "property", propertyNumber),
      actionLabel: "فتح التحقق",
    });
  }

  for (const log of sources.whatsappLogs || []) {
    const transportFailed = isFailedStatus(log.status);
    const deliveryFailed = normalized(log.providerDeliveryStatus) === "failed";
    if (!transportFailed && !deliveryFailed) continue;
    const logId = safeIdentifier(log.id, `${log.createdAt || "unknown"}`);
    items.push({
      id: `whatsapp-log-${logId}`,
      category: "whatsapp_failure",
      priority: "critical",
      title: log.propertyName || log.type || "رسالة واتساب",
      description: deliveryFailed
        ? "قبل مزود واتساب الرسالة ثم أبلغ بفشل تسليمها"
        : log.type
          ? `تعذر إرسال ${log.type}`
          : "تعذر إرسال رسالة واتساب",
      reference: logId,
      propertyNumber: log.propertyNumber,
      propertyName: log.propertyName,
      occurredAt: latestTimestamp(log.providerFailedAt, log.createdAt),
      statusLabel: deliveryFailed ? "فشل التسليم" : "فشل الإرسال",
      href: `/admin/whatsapp?tab=activity&log=${encodeURIComponent(logId)}`,
      actionLabel: "فتح سجل الواتساب",
    });
  }

  for (const booking of sources.bookingDashboard?.bookings || []) {
    const bookingId = safeIdentifier(booking.id, booking.requestCode || "unknown");
    const propertyNumber = String(booking.propertyNumber || "").trim() || null;
    const bookingHref = routeWithSearch(
      "/admin/booking-commissions",
      "booking",
      bookingId,
    );

    if (booking.customerOwnerNoResponseReportedAt) {
      items.push({
        id: `booking-owner-no-response-${bookingId}`,
        category: "dispute",
        priority: "high",
        title: booking.propertyName || `عقار ${propertyNumber || "—"}`,
        description: "أبلغ العميل بأن المعلن لم يرد",
        reference: booking.requestCode || bookingId,
        propertyNumber,
        propertyName: booking.propertyName,
        occurredAt: booking.customerOwnerNoResponseReportedAt,
        statusLabel: "بلاغ عدم رد",
        href: bookingHref,
        actionLabel: "مراجعة الطلب",
      });
    }

    for (const job of booking.notificationJobs || []) {
      const transportFailed = normalized(job.status) === "failed";
      const deliveryFailed = normalized(job.providerDeliveryStatus) === "failed";
      if (!transportFailed && !deliveryFailed) continue;
      const jobId = safeIdentifier(job.id, `${bookingId}-notification`);
      items.push({
        id: `booking-notification-${jobId}`,
        category: "whatsapp_failure",
        priority: "critical",
        title: booking.propertyName || `عقار ${propertyNumber || "—"}`,
        description: deliveryFailed
          ? "قبل مزود واتساب الرسالة ثم أبلغ بفشل تسليمها"
          : "تعذر إرسال رسالة المتابعة",
        reference: jobId,
        propertyNumber,
        propertyName: booking.propertyName,
        occurredAt: latestTimestamp(
          job.providerFailedAt,
          job.failedAt,
          job.updatedAt,
          job.createdAt,
        ),
        statusLabel: job.recipientRole === "owner"
          ? "فشل إرسال رسالة المالك"
          : "فشل إرسال رسالة العميل",
        href: bookingHref,
        actionLabel: "فتح سجل الرسائل",
      });
    }

    const attempts = booking.paymentAttempts?.length
      ? booking.paymentAttempts
      : booking.paymentAttempt
        ? [booking.paymentAttempt]
        : [];
    const seenAttemptIds = new Set<string>();
    for (const attempt of attempts) {
      const attemptId = safeIdentifier(attempt.id, `${bookingId}-payment`);
      if (seenAttemptIds.has(attemptId)) continue;
      seenAttemptIds.add(attemptId);

      if (isPendingBankReview(attempt)) {
        items.push({
          id: `booking-bank-receipt-${attemptId}`,
          category: "bank_receipt",
          priority: "high",
          title: booking.propertyName || `عقار ${propertyNumber || "—"}`,
          description: "إيصال عمولة الحجز بانتظار المراجعة",
          reference: attemptId,
          propertyNumber,
          propertyName: booking.propertyName,
          occurredAt: latestTimestamp(attempt.receiptSubmittedAt, attempt.updatedAt),
          statusLabel: "إيصال جديد",
          href: bookingHref,
          actionLabel: "مراجعة الإيصال",
        });
      }

      if (isPendingReversal(attempt)) {
        items.push({
          id: `booking-reversal-${attemptId}`,
          category: "dispute",
          priority: "critical",
          title: booking.propertyName || `عقار ${propertyNumber || "—"}`,
          description: "عكس دفعة يحتاج قرار الإدارة",
          reference: attemptId,
          propertyNumber,
          propertyName: booking.propertyName,
          occurredAt: latestTimestamp(attempt.reversedAt, attempt.updatedAt),
          statusLabel: "مراجعة مالية مطلوبة",
          href: bookingHref,
          actionLabel: "حسم المراجعة",
        });
      }
    }

    if (normalized(booking.disputeStatus) === "pending") {
      items.push({
        id: `booking-dispute-${bookingId}`,
        category: "dispute",
        priority: "critical",
        title: booking.propertyName || `عقار ${propertyNumber || "—"}`,
        description: booking.disputeReason || "اعتراض عمولة يحتاج قرار الإدارة",
        reference: booking.requestCode || bookingId,
        propertyNumber,
        propertyName: booking.propertyName,
        occurredAt: latestTimestamp(booking.disputedAt, booking.contactAt),
        statusLabel: "اعتراض معلق",
        href: bookingHref,
        actionLabel: "مراجعة الاعتراض",
      });
    }

    if (["overdue", "late"].includes(normalized(booking.commissionStatus))) {
      items.push({
        id: `overdue-commission-${bookingId}`,
        category: "overdue_commission",
        priority: "critical",
        title: booking.propertyName || `عقار ${propertyNumber || "—"}`,
        description: "انتهت مهلة سداد عمولة الحجز",
        reference: booking.requestCode || bookingId,
        propertyNumber,
        propertyName: booking.propertyName,
        occurredAt: latestTimestamp(booking.dueAt, booking.contactAt),
        statusLabel: "متأخرة",
        href: bookingHref,
        actionLabel: "فتح العمولة",
      });
    }
  }

  for (const payment of sources.payments || []) {
    if (!isPendingSubscriptionBankReview(payment)) continue;
    const paymentId = safeIdentifier(payment.id, `${payment.propertyNumber || "unknown"}-payment`);
    items.push({
      id: `subscription-bank-receipt-${paymentId}`,
      category: "bank_receipt",
      priority: "high",
      title: payment.propertyName || `عقار ${payment.propertyNumber || "—"}`,
      description: "إيصال اشتراك بانتظار المراجعة",
      reference: paymentId,
      propertyNumber: payment.propertyNumber,
      propertyName: payment.propertyName,
      occurredAt: payment.createdAt,
      statusLabel: "دفعة معلقة",
      href: routeWithSearch("/admin/payments", "payment", paymentId),
      actionLabel: "مراجعة الدفعة",
    });
  }

  for (const hold of sources.availability?.holds || []) {
    const propertyNumber = safeIdentifier(hold.propertyNumber, "unknown");
    items.push({
      id: `property-hold-${propertyNumber}`,
      category: "suspended_property",
      priority: hold.commissionHold ? "high" : "medium",
      title: hold.name || `عقار ${propertyNumber}`,
      description: hold.commissionHold
        ? `إيقاف بسبب العمولة (${hold.commissionObligationCount || 0})`
        : "إيقاف إداري للعقار",
      reference: propertyNumber,
      propertyNumber,
      propertyName: hold.name,
      occurredAt: hold.suspendedAt,
      statusLabel: hold.manualHold && hold.commissionHold
        ? "إيقاف إداري وعمولة"
        : hold.commissionHold
          ? "موقوف بسبب العمولة"
          : "موقوف إدارياً",
      href: routeWithSearch(
        "/admin/suspended-subscriptions",
        "property",
        propertyNumber,
      ),
      actionLabel: "إدارة الإيقاف",
    });
  }

  for (const subscription of sources.subscriptions || []) {
    const remainingDays = Number(subscription.remainingDays);
    if (
      normalized(subscription.status) !== normalized("قريب الانتهاء")
      || !Number.isFinite(remainingDays)
      || remainingDays < 0
      || remainingDays > 7
    ) continue;
    const propertyNumber = safeIdentifier(subscription.propertyNumber, "unknown");
    const subscriptionId = safeIdentifier(subscription.id, propertyNumber);
    items.push({
      id: `expiring-subscription-${subscriptionId}`,
      category: "expiring_subscription",
      priority: remainingDays <= 2 ? "high" : "medium",
      title: subscription.name || `عقار ${propertyNumber}`,
      description: remainingDays === 0
        ? "ينتهي الاشتراك اليوم"
        : `متبقي ${remainingDays} يوم على انتهاء الاشتراك`,
      reference: propertyNumber,
      propertyNumber,
      propertyName: subscription.name,
      occurredAt: expiringSubscriptionOccurrenceAt(subscription.endDate),
      statusLabel: "قريب الانتهاء",
      href: routeWithSearch("/admin/subscriptions", "property", propertyNumber),
      actionLabel: "فتح الاشتراك",
    });
  }

  return sortOperations(items);
}

export function countOperationsByCategory(
  items: Array<Pick<OperationItem, "category">>,
): Partial<Record<OperationCategory, number>> {
  return items.reduce<Partial<Record<OperationCategory, number>>>((counts, item) => {
    counts[item.category] = (counts[item.category] || 0) + 1;
    return counts;
  }, {});
}

export function emptyOperationMetadata(
  operationId: string,
): AdminOperationMetadata {
  return {
    operationId,
    state: "open",
    assignee: null,
    createdAt: "",
    updatedAt: "",
    resolvedAt: null,
    resolvedBy: null,
    notes: [],
    audit: [],
  };
}

export function operationSnapshot(item: OperationItem): AdminOperationSnapshot {
  return {
    category: item.category,
    priority: item.priority,
    title: item.title,
    description: item.description,
    reference: item.reference,
    propertyNumber: item.propertyNumber ?? null,
    propertyName: item.propertyName ?? null,
    occurredAt: item.occurredAt ?? null,
    statusLabel: item.statusLabel,
    href: item.href,
    actionLabel: item.actionLabel,
  };
}

function operationFromSnapshot(
  operationId: string,
  snapshot: AdminOperationSnapshot,
): OperationItem {
  return {
    id: operationId,
    ...snapshot,
  };
}

function workflowForOccurrence(
  item: OperationItem,
  workflow: AdminOperationMetadata,
): AdminOperationMetadata {
  const occurredAt = Date.parse(item.occurredAt || "");
  const resolvedAt = Date.parse(workflow.resolvedAt || "");
  if (
    workflow.state === "resolved"
    && Number.isFinite(occurredAt)
    && Number.isFinite(resolvedAt)
    && occurredAt > resolvedAt
  ) {
    return {
      ...workflow,
      state: "open",
      resolvedAt: null,
      resolvedBy: null,
    };
  }
  return workflow;
}

export function mergeOperationsMetadata(
  items: OperationItem[],
  metadata: AdminOperationMetadata[] | null | undefined,
): ManagedOperationItem[] {
  const metadataByOperationId = new Map(
    (metadata || []).map((entry) => [entry.operationId, entry]),
  );
  const currentIds = new Set(items.map((item) => item.id));
  const currentItems = items.map((item) => ({
    ...item,
    workflow: workflowForOccurrence(
      item,
      metadataByOperationId.get(item.id) || emptyOperationMetadata(item.id),
    ),
  }));
  const retainedItems = (metadata || [])
    .filter((entry) =>
      !currentIds.has(entry.operationId) &&
      entry.state === "resolved" &&
      entry.snapshot
    )
    .map((entry) => ({
      ...operationFromSnapshot(entry.operationId, entry.snapshot!),
      workflow: entry,
    }));
  return [...currentItems, ...retainedItems];
}
