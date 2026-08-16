import type { ReactNode } from "react";
import {
  AlertCircle,
  Bell,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  CreditCard,
  MessageCircle,
  PauseCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type BookingTiming = "midweek" | "weekend" | "other";
export type BookingDatePrecision = "day" | "month";

export interface BookingQuestionnaire {
  timing?: BookingTiming | string | null;
  bookingTiming?: BookingTiming | string | null;
  bookingDate?: string | { value?: string | null; precision?: BookingDatePrecision | string | null } | null;
  date?: string | null;
  bookingDatePrecision?: BookingDatePrecision | string | null;
  pricePaidSar?: string | number | null;
  pricePaidHalalas?: number | null;
  [key: string]: unknown;
}

export interface NotificationSummary {
  sent?: number;
  delivered?: number;
  failed?: number;
  suppressed?: number;
  suppressedQuota?: number;
  pending?: number;
  queued?: number;
  total?: number;
  [key: string]: unknown;
}

export interface BookingTimelineEntry {
  id?: string;
  type?: string;
  label?: string;
  title?: string;
  description?: string;
  detail?: string;
  status?: string;
  at?: string;
  timestamp?: string;
  createdAt?: string;
}

export interface BookingAdminNotificationJob {
  id: string;
  bookingId?: string;
  propertyNumber?: string;
  recipientRole?: "customer" | "owner" | string;
  kind?: string;
  reminderOffsetDays?: number | null;
  scheduledAt?: string | null;
  status?: string;
  isFreeProperty?: boolean;
  quotaCategory?: string;
  attempts?: number;
  leaseExpiresAt?: string | null;
  claimedAt?: string | null;
  sentAt?: string | null;
  failedAt?: string | null;
  suppressedAt?: string | null;
  providerError?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface BookingAdminPaymentAttempt {
  id?: string;
  bookingId?: string;
  propertyNumber?: string;
  amountCents?: number;
  currency?: string;
  paymentMethod?: string;
  merchantAttemptKey?: string;
  status?: string;
  intentionId?: string | null;
  paymobOrderId?: string | null;
  transactionId?: string | null;
  failureReason?: string | null;
  exactPaymentMethod?: string | null;
  providerCreatedAt?: string | null;
  paidAt?: string | null;
  authorizationTransactionId?: string | null;
  authorizedAt?: string | null;
  nonPayableStatus?: "refunded" | "voided" | "errored" | "other_nonpayable" | string | null;
  nonPayableTransactionId?: string | null;
  nonPayableAt?: string | null;
  reversalStatus?: "refunded" | "voided" | "errored" | "authorization_only" | "other_nonpayable" | string | null;
  reversalTransactionId?: string | null;
  reversedAt?: string | null;
  reversalResolution?: "resume_collection" | "keep_paid" | string | null;
  reversalResolvedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface BookingDisplayRow {
  id: string;
  propertyNumber: string;
  propertyName?: string | null;
  requestCode?: string | null;
  contactAt?: string | null;
  bookingStatus?: string | null;
  questionnaire?: BookingQuestionnaire | null;
  confirmationFacts?: BookingQuestionnaire | null;
  answeredAt?: string | null;
  confirmedAt?: string | null;
  declinedAt?: string | null;
  followUpDueAt?: string | null;
  commissionStatus?: string | null;
  commissionAmountHalalas?: number | null;
  commissionNoticeSentAt?: string | null;
  commissionPaidAt?: string | null;
  commissionReminderOffsetsSent?: number[] | null;
  activeAttemptId?: string | null;
  paidAttemptId?: string | null;
  dueAt?: string | null;
  complianceStatus?: string | null;
  customerPhoneMasked?: string | null;
  isFreeProperty?: boolean;
  disputeStatus?: string | null;
  disputedAt?: string | null;
  disputeReason?: string | null;
  enforcementDeferredUntil?: string | null;
  enforcementLastError?: string | null;
  notificationJobs?: BookingAdminNotificationJob[] | null;
  paymentAttempt?: BookingAdminPaymentAttempt | null;
  paymentAttempts?: BookingAdminPaymentAttempt[] | null;
  notificationSummary?: NotificationSummary | null;
  timeline?: BookingTimelineEntry[] | null;
  events?: BookingTimelineEntry[] | null;
  [key: string]: unknown;
}

type StatusTone = "green" | "amber" | "red" | "blue" | "slate" | "violet";

const toneClasses: Record<StatusTone, string> = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  red: "border-red-200 bg-red-50 text-red-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  slate: "border-slate-200 bg-slate-50 text-slate-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
};

function normalizeStatus(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function fallbackStatusLabel(value: unknown): string {
  const label = String(value || "").trim();
  return label || "غير محدد";
}

export function getBookingStatusMeta(value: unknown): { label: string; tone: StatusTone } {
  const status = normalizeStatus(value);
  if (status === "expired") {
    return { label: "انتهت مهلة الرد", tone: "red" };
  }
  if (["awaiting_response", "scheduled", "sent", "pending", "بانتظار_الرد"].includes(status)) {
    return { label: "بانتظار رد العميل", tone: "amber" };
  }
  if (["declined", "not_booked", "no_booking", "لم_يتم_الحجز"].includes(status)) {
    return { label: "لم يتم الحجز", tone: "slate" };
  }
  if (["booked", "questionnaire_pending", "awaiting_questionnaire"].includes(status)) {
    return { label: "بانتظار تفاصيل الحجز", tone: "blue" };
  }
  if (["confirmed", "completed", "reported", "booking_confirmed", "تم_التأكيد"].includes(status)) {
    return { label: "تم توثيق الحجز", tone: "green" };
  }
  if (["failed", "cancelled"].includes(status)) {
    return { label: fallbackStatusLabel(value), tone: "red" };
  }
  return { label: fallbackStatusLabel(value), tone: "slate" };
}

export function getCommissionStatusMeta(value: unknown): { label: string; tone: StatusTone } {
  const status = normalizeStatus(value);
  if (!status || ["none", "not_applicable", "waived"].includes(status)) {
    return { label: "لا توجد عمولة مستحقة", tone: "slate" };
  }
  if (["paid", "completed", "settled", "مسددة"].includes(status)) {
    return { label: "تم سداد العمولة", tone: "green" };
  }
  if (["overdue", "late", "متأخرة"].includes(status)) {
    return { label: "العمولة متأخرة", tone: "red" };
  }
  if (["disputed", "under_dispute", "اعتراض"].includes(status)) {
    return { label: "العمولة محل اعتراض", tone: "violet" };
  }
  if (["pending", "due", "awaiting_payment", "payment_pending", "قيد_الدفع"].includes(status)) {
    return { label: "بانتظار سداد العمولة", tone: "amber" };
  }
  return { label: fallbackStatusLabel(value), tone: "slate" };
}

export function getComplianceStatusMeta(value: unknown): { label: string; tone: StatusTone } {
  const status = normalizeStatus(value);
  if (!status || ["active", "compliant", "ok", "clear", "نشط"].includes(status)) {
    return { label: "العقار نشط", tone: "green" };
  }
  if (["released", "resumed"].includes(status)) {
    return { label: "تم رفع الإيقاف", tone: "green" };
  }
  if (["paused", "suspended", "property_paused", "موقوف"].includes(status)) {
    return { label: "العقار موقوف", tone: "red" };
  }
  if (["warning", "grace_period", "due", "payment_window"].includes(status)) {
    return { label: "ضمن مهلة السداد", tone: "amber" };
  }
  if (["disputed", "under_review"].includes(status)) {
    return { label: "قيد المراجعة", tone: "violet" };
  }
  return { label: fallbackStatusLabel(value), tone: "slate" };
}

export function StatusBadge({
  label,
  tone,
  className = "",
}: {
  label: string;
  tone: StatusTone;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={`whitespace-nowrap font-semibold ${toneClasses[tone]} ${className}`}
    >
      {label}
    </Badge>
  );
}

export function formatSarFromHalalas(value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === "") return "—";
  const halalas = Number(value);
  if (!Number.isFinite(halalas)) return "—";
  return new Intl.NumberFormat("ar-SA", {
    style: "currency",
    currency: "SAR",
    minimumFractionDigits: halalas % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(halalas / 100);
}

export function formatSar(value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === "") return "—";
  const amount = Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat("ar-SA", {
    style: "currency",
    currency: "SAR",
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDateTime(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function bookingTimingLabel(value: unknown): string {
  const timing = normalizeStatus(value);
  if (timing === "midweek") return "وسط الأسبوع";
  if (timing === "weekend") return "نهاية الأسبوع";
  if (timing === "other") return "وقت آخر";
  return fallbackStatusLabel(value);
}

export function formatBookingDate(questionnaire?: BookingQuestionnaire | null): string {
  const nestedDate = questionnaire?.bookingDate && typeof questionnaire.bookingDate === "object"
    ? questionnaire.bookingDate
    : null;
  const value = String(
    typeof questionnaire?.bookingDate === "string"
      ? questionnaire.bookingDate
      : nestedDate?.value || questionnaire?.date || "",
  ).trim();
  if (!value) return "—";
  const precision = String(questionnaire?.bookingDatePrecision || nestedDate?.precision || "day");
  const date = precision === "month"
    ? new Date(`${value.slice(0, 7)}-01T12:00:00.000Z`)
    : new Date(`${value.slice(0, 10)}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ar-SA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "long",
    ...(precision === "month" ? {} : { day: "numeric" }),
  });
}

export function getQuestionnairePrice(questionnaire?: BookingQuestionnaire | null): string {
  if (
    questionnaire?.pricePaidHalalas !== null
    && questionnaire?.pricePaidHalalas !== undefined
    && Number.isFinite(Number(questionnaire.pricePaidHalalas))
  ) {
    return formatSarFromHalalas(questionnaire?.pricePaidHalalas);
  }
  return formatSar(questionnaire?.pricePaidSar);
}

export function getPropertyLabel(row: Pick<BookingDisplayRow, "propertyName" | "propertyNumber">): string {
  return String(row.propertyName || "").trim() || `عقار رقم ${row.propertyNumber}`;
}

export function QuestionnaireFacts({ questionnaire }: { questionnaire?: BookingQuestionnaire | null }) {
  if (!questionnaire) {
    return <p className="text-sm text-muted-foreground">لم تُسجل تفاصيل الحجز بعد.</p>;
  }

  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      <Fact label="وقت الحجز" value={bookingTimingLabel(questionnaire.timing || questionnaire.bookingTiming)} />
      <Fact label="تاريخ الحجز" value={formatBookingDate(questionnaire)} />
      <Fact label="المبلغ المدفوع" value={getQuestionnairePrice(questionnaire)} />
    </dl>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-muted/25 p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-bold text-foreground">{value}</dd>
    </div>
  );
}

function readCount(summary: NotificationSummary | null | undefined, keys: string[]): number {
  for (const key of keys) {
    const value = Number(summary?.[key]);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}

export function NotificationSummaryView({ summary }: { summary?: NotificationSummary | null }) {
  const sent = readCount(summary, ["sent", "delivered"]);
  const failed = readCount(summary, ["failed"]);
  const suppressed = readCount(summary, ["suppressed", "suppressedQuota"]);
  const queued = readCount(summary, ["pending", "queued"]);

  if (!summary || sent + failed + suppressed + queued === 0) {
    return <span className="text-xs text-muted-foreground">لا توجد رسائل مسجلة.</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5 text-xs">
      {sent > 0 && <span className="rounded-full bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">مرسلة: {sent}</span>}
      {queued > 0 && <span className="rounded-full bg-blue-50 px-2 py-1 font-semibold text-blue-700">مجدولة: {queued}</span>}
      {failed > 0 && <span className="rounded-full bg-red-50 px-2 py-1 font-semibold text-red-700">فشلت: {failed}</span>}
      {suppressed > 0 && <span className="rounded-full bg-amber-50 px-2 py-1 font-semibold text-amber-700">محدودة: {suppressed}</span>}
    </div>
  );
}

function timelineIcon(type: string) {
  const normalized = normalizeStatus(type);
  if ([
    "commission_payment_reversal_collection_resumed",
    "commission_payment_reversal_kept_paid",
  ].includes(normalized)) return CheckCircle2;
  if (normalized === "commission_payment_authorized") return CreditCard;
  if (["owner_identity_changed", "customer_followup_expired"].includes(normalized)) return AlertCircle;
  if (normalized.includes("contact")) return MessageCircle;
  if (normalized.includes("notification") || normalized.includes("reminder")) return Bell;
  if (normalized.includes("duplicate") || normalized.includes("reversal") || normalized.includes("fail") || normalized.includes("overdue")) return AlertCircle;
  if (normalized.includes("pause") || normalized.includes("suspend")) return PauseCircle;
  if (normalized.includes("release") || normalized.includes("resume")) return CheckCircle2;
  if (normalized.includes("complete") || normalized.includes("paid") || normalized.includes("confirm")) return CheckCircle2;
  if (normalized.includes("payment") || normalized.includes("commission")) return CreditCard;
  return CircleDashed;
}

export function getBookingEventLabel(value: unknown): string {
  const type = normalizeStatus(value);
  const labels: Record<string, string> = {
    contact_accepted: "تم قبول طلب التواصل",
    customer_followup_scheduled: "تمت جدولة متابعة العميل",
    customer_followup_sent: "تم إرسال متابعة العميل",
    customer_followup_failed: "فشل إرسال متابعة العميل",
    customer_followup_suppressed: "تم تقييد متابعة العميل",
    customer_followup_expired: "انتهت مهلة رد العميل",
    customer_opened: "فتح العميل رابط المتابعة",
    customer_declined: "أكد العميل أن الحجز لم يتم",
    booking_confirmed: "أكد العميل بيانات الحجز",
    owner_notification_sent: "تم إرسال بيانات الحجز للمالك",
    owner_notification_failed: "فشل إرسال بيانات الحجز للمالك",
    owner_notification_suppressed: "تم تقييد إشعار المالك",
    commission_checkout_created: "تم إنشاء رابط دفع العمولة",
    commission_checkout_failed: "فشل إنشاء رابط دفع العمولة",
    commission_payment_failed: "فشلت عملية دفع العمولة",
    commission_paid: "تم سداد العمولة",
    commission_duplicate_payment: "تم رصد دفعة عمولة مكررة",
    commission_payment_authorized: "تم تسجيل تفويض عملية الدفع",
    commission_payment_reversal_reported: "تم الإبلاغ عن عكس دفعة العمولة",
    commission_payment_reversal_collection_resumed: "تمت معالجة العكس واستئناف التحصيل",
    commission_payment_reversal_kept_paid: "تمت معالجة العكس مع إبقاء العمولة مدفوعة",
    commission_reminder_sent: "تم إرسال تذكير العمولة",
    commission_reminder_failed: "فشل إرسال تذكير العمولة",
    commission_disputed: "اعترض المالك على العمولة",
    commission_dispute_rejected: "تم رفض الاعتراض واستئناف التحصيل",
    commission_dispute_accepted: "تم قبول الاعتراض وإلغاء العمولة",
    commission_enforcement_deferred: "تم تأجيل إجراء الإيقاف",
    booking_free_eligibility_lost: "تم إغلاق متابعة الحجز بعد تفعيل اشتراك مميز للعقار",
    owner_identity_changed: "تم رصد تغير هوية مالك العقار",
    property_paused: "تم إيقاف العقار",
    property_released: "تم رفع إيقاف العقار",
  };
  return labels[type] || fallbackStatusLabel(value);
}

export function getPaymentReversalStatusLabel(value: unknown): string {
  const status = normalizeStatus(value);
  if (status === "refunded") return "تم استرداد الدفعة";
  if (status === "voided") return "تم إلغاء الدفعة";
  if (status === "errored") return "أبلغ مزود الدفع عن خطأ في العملية";
  if (status === "authorization_only") return "تفويض دفع فقط دون تحصيل";
  if (status === "other_nonpayable") return "حالة لا تُحتسب كدفعة مكتملة";
  return fallbackStatusLabel(value);
}

export function getBookingEventDetail(typeValue: unknown, detailValue: unknown): string {
  const type = normalizeStatus(typeValue);
  const detail = String(detailValue || "").trim();
  if (!detail) return "";
  if (type === "commission_duplicate_payment") return `رقم محاولة الدفع: ${detail}`;
  if (type === "commission_payment_authorized") {
    return `رقم عملية التفويض: ${detail}`;
  }
  if (type === "commission_payment_reversal_reported") {
    return getPaymentReversalStatusLabel(detail);
  }
  if (
    type === "commission_payment_reversal_collection_resumed"
    || type === "commission_payment_reversal_kept_paid"
  ) {
    return `رقم عملية العكس: ${detail}`;
  }
  if (type === "owner_identity_changed") {
    return "تغير رقم مالك العقار منذ إنشاء طلب التواصل وتوقفت الإجراءات لحين المراجعة.";
  }
  if (type === "booking_free_eligibility_lost") {
    return detail === "active_premium_subscription"
      ? "توقف مسار المتابعة والعمولة لأن العقار أصبح ضمن اشتراك مميز فعال."
      : "أُغلق المسار لأنه لم ينشأ لعقار مجاني مؤهل.";
  }
  if (type === "customer_followup_expired" && detail === "customer_response_expired") {
    return "انتهت المهلة قبل تسجيل إجابة العميل.";
  }
  if (type === "commission_payment_failed" && [
    "refunded",
    "voided",
    "errored",
    "authorization_only",
    "other_nonpayable",
  ].includes(normalizeStatus(detail))) {
    return getPaymentReversalStatusLabel(detail);
  }
  if (type === "commission_paid" && detail === "dispute_resolved_by_payment") {
    return "تم إنهاء الاعتراض تلقائياً بعد تأكيد الدفع.";
  }
  if (type === "commission_checkout_failed" && detail === "unknown") {
    return "حالة إنشاء رابط الدفع غير مؤكدة وتحتاج مراجعة.";
  }
  if (type === "commission_checkout_failed" && detail === "rejected") {
    return "رفض مزود الدفع إنشاء الرابط.";
  }
  if (type === "commission_dispute_accepted" && detail.startsWith("closed_rejected_attempts:")) {
    return `تم إغلاق محاولات الدفع المرفوضة: ${detail.slice("closed_rejected_attempts:".length)}`;
  }
  return detail;
}

function derivedTimeline(row: BookingDisplayRow): BookingTimelineEntry[] {
  const booking = getBookingStatusMeta(row.bookingStatus);
  const commission = getCommissionStatusMeta(row.commissionStatus);
  const compliance = getComplianceStatusMeta(row.complianceStatus);
  const sent = readCount(row.notificationSummary, ["sent", "delivered"]);
  const failed = readCount(row.notificationSummary, ["failed"]);
  const suppressed = readCount(row.notificationSummary, ["suppressed", "suppressedQuota"]);

  return [
    {
      id: `${row.id}-contact`,
      type: "contact",
      title: "طلب التواصل",
      description: row.requestCode ? `تم تسجيل الطلب ${row.requestCode}.` : "تم تسجيل طلب التواصل.",
      at: row.contactAt || undefined,
    },
    {
      id: `${row.id}-booking`,
      type: normalizeStatus(row.bookingStatus),
      title: "نتيجة الحجز",
      description: booking.label,
      at: row.answeredAt || undefined,
    },
    {
      id: `${row.id}-notification`,
      type: failed > 0 ? "notification_failed" : suppressed > 0 ? "notification_suppressed" : "notification",
      title: "إشعارات واتساب",
      description: sent > 0
        ? `تم إرسال ${sent} إشعار.`
        : failed > 0
          ? `فشل إرسال ${failed} إشعار.`
          : suppressed > 0
            ? `تم تقييد ${suppressed} إشعار حسب حد الرسائل.`
            : "لم يُسجل إرسال إشعار حتى الآن.",
    },
    {
      id: `${row.id}-commission`,
      type: normalizeStatus(row.commissionStatus),
      title: "العمولة",
      description: commission.label,
      at: row.dueAt || undefined,
    },
    {
      id: `${row.id}-compliance`,
      type: normalizeStatus(row.complianceStatus),
      title: "حالة العقار",
      description: compliance.label,
    },
  ];
}

export function BookingTimeline({ row }: { row: BookingDisplayRow }) {
  const entries = row.timeline?.length
    ? row.timeline
    : row.events?.length
      ? row.events
      : derivedTimeline(row);

  return (
    <ol className="space-y-0" aria-label="تسلسل إجراءات الحجز">
      {entries.map((entry, index) => {
        const Icon = timelineIcon(entry.type || entry.status || "");
        const timestamp = entry.at || entry.timestamp || entry.createdAt;
        return (
          <li key={entry.id || `${entry.type || "event"}-${index}`} className="relative flex gap-3 pb-5 last:pb-0">
            {index < entries.length - 1 && <span className="absolute right-[17px] top-9 h-[calc(100%-1.5rem)] w-px bg-border" aria-hidden="true" />}
            <span className="relative z-10 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm font-bold text-foreground">{entry.title || entry.label || getBookingEventLabel(entry.type || entry.status)}</p>
              {(entry.description || entry.detail) && <p className="mt-0.5 break-words text-xs leading-5 text-muted-foreground">{entry.description || getBookingEventDetail(entry.type || entry.status, entry.detail)}</p>}
              {timestamp && <time className="mt-1 block text-[11px] text-muted-foreground">{formatDateTime(timestamp)}</time>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function BookingPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-70px)] bg-[#faf8f1] px-4 py-8 sm:py-12" dir="rtl">
      <div className="mx-auto w-full max-w-3xl">{children}</div>
    </div>
  );
}

export function BookingPageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-6 text-center sm:mb-8">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f2e8cd] text-[#8b6b25]">
        <CalendarDays className="h-7 w-7" aria-hidden="true" />
      </div>
      <p className="text-xs font-bold text-[#8b6b25]">{eyebrow}</p>
      <h1 className="mt-2 text-2xl font-bold text-[#34332f] sm:text-3xl">{title}</h1>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}
