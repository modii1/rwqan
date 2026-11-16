export type NormalizedSubscriptionType = "مميز" | "عادي";
export type NormalizedSubscriptionStatus =
  | "ساري"
  | "ينتهي قريباً"
  | "منتهي"
  | "نشط مجاني"
  | "قيد المراجعة"
  | "معلق"
  | "موقوف"
  | "موقوف مؤقتاً"
  | "مرفوض"
  | "غير نشط";

const PREMIUM_VALUES = new Set(["مميز", "premium", "trusted"]);
const NORMAL_VALUES = new Set(["عادي", "normal", "free", "مجاني"]);
const ACTIVE_STATUS_VALUES = new Set(["نشط", "ساري", "active"]);
const EXPIRING_STATUS_VALUES = new Set(["ينتهي قريباً", "قريب الانتهاء", "expiring"]);
const EXPIRED_STATUS_VALUES = new Set(["منتهي", "expired"]);
const FREE_STATUS_VALUES = new Set(["نشط مجاني", "free_active"]);
const PENDING_REVIEW_STATUS_VALUES = new Set(["قيد المراجعة", "pending_review"]);
const PENDING_STATUS_VALUES = new Set(["معلق", "pending"]);
const CANCELLED_STATUS_VALUES = new Set(["موقوف", "cancelled"]);
const SUSPENDED_STATUS_VALUES = new Set(["موقوف مؤقتاً", "suspended"]);
const REJECTED_STATUS_VALUES = new Set(["مرفوض", "rejected"]);

export function normalizeSubscriptionType(value?: string | null): NormalizedSubscriptionType {
  const normalized = String(value || "").trim().toLowerCase();
  if (PREMIUM_VALUES.has(normalized)) return "مميز";
  if (NORMAL_VALUES.has(normalized)) return "عادي";
  return "عادي";
}

export function isPremiumSubscriptionType(value?: string | null): boolean {
  return normalizeSubscriptionType(value) === "مميز";
}

export function getSubscriptionTypeLabel(value?: string | null): NormalizedSubscriptionType {
  return normalizeSubscriptionType(value);
}

export function normalizeSubscriptionStatus(
  value?: string | null,
  isExpired?: boolean,
): NormalizedSubscriptionStatus {
  if (isExpired) return "منتهي";

  const normalized = String(value || "").trim().toLowerCase();
  if (ACTIVE_STATUS_VALUES.has(normalized)) return "ساري";
  if (EXPIRING_STATUS_VALUES.has(normalized)) return "ينتهي قريباً";
  if (EXPIRED_STATUS_VALUES.has(normalized)) return "منتهي";
  if (FREE_STATUS_VALUES.has(normalized)) return "نشط مجاني";
  if (PENDING_REVIEW_STATUS_VALUES.has(normalized)) return "قيد المراجعة";
  if (PENDING_STATUS_VALUES.has(normalized)) return "معلق";
  if (CANCELLED_STATUS_VALUES.has(normalized)) return "موقوف";
  if (SUSPENDED_STATUS_VALUES.has(normalized)) return "موقوف مؤقتاً";
  if (REJECTED_STATUS_VALUES.has(normalized)) return "مرفوض";
  return "غير نشط";
}

/**
 * حساب اليوم التقويمي بتوقيت الرياض (UTC+3) كأرقام أيام منذ الميلاد.
 * مستنسخ من المنطق في src/lib/subscription-utils.ts و server/utils/dateUtils.ts
 * ليكون متاحًا في طبقة shared دون اعتماد على كود السيرفر.
 */
function getRiyadhCalendarDay(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
  ) / (24 * 60 * 60 * 1000);
}

/**
 * حساب الأيام المتبقية من تاريخ الانتهاء باستخدام تقويم الرياض.
 * 0 = اليوم الأخير، سالب = منتهي.
 */
export function calculateRemainingDaysFromEndDate(endDate: string | null): number {
  if (!endDate) return -1;
  const end = new Date(endDate);
  if (isNaN(end.getTime())) return -1;
  const todayDay = getRiyadhCalendarDay(new Date());
  const endDay = getRiyadhCalendarDay(end);
  return Math.floor(endDay - todayDay);
}

export interface SubscriptionStatusInput {
  status?: string | null;
  endDate?: string | null;
  startDate?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  suspendedAt?: string | null;
  remainingDurationMs?: number | null;
}

/**
 * حساب حالة الاشتراك الموحد من حقول الوثيقة الكاملة.
 * القاعدة:
 * 1. التعليق الحالي (suspendedAt مع remainingDurationMs صالح) يسبق كل شيء.
 * 2. الإلغاء الصريح (cancelledAt) يُحترم unless تم إعادة تفعيل (startDate > cancelledAt).
 * 3. انتهاء تاريخ الصلاحية (endDate في الماضي) يُعتبر منتهي.
 * 4. التاريخ في المستقبل لا يُعتبر منتهيًا لمجرد أن status المخزنة تقول "منتهي".
 * 5. بدون تاريخ نهاية صالح → غير نشط (إلا إذا كان مجانياً).
 *
 * لا تعتمد على الحالة المخزنة وحدها أبدًا.
 */
export function computeSubscriptionStatus(input: SubscriptionStatusInput): NormalizedSubscriptionStatus {
  // 1. التعليق الحالي: suspendedAt موجود مع remainingDurationMs صالح
  if (
    input.suspendedAt &&
    input.remainingDurationMs !== null &&
    input.remainingDurationMs !== undefined
  ) {
    return "موقوف مؤقتاً";
  }

  // 2. الإلغاء الصريح: cancelledAt موجود
  if (input.cancelledAt) {
    // إذا كان هناك startDate وبعد وقت الإلغاء → أعيد تفعيل، لا يعتبر منتهي
    if (input.startDate) {
      const start = new Date(input.startDate);
      const cancelled = new Date(input.cancelledAt);
      if (
        !isNaN(start.getTime()) &&
        !isNaN(cancelled.getTime()) &&
        start > cancelled
      ) {
        // أعيد تفعيل — أكمل للتحقق من التاريخ أدناه
      } else {
        return "منتهي";
      }
    } else {
      return "منتهي";
    }
  }

  // 3. انتهاء تاريخ الصلاحية
  let remainingDays: number | null = null;
  if (input.endDate) {
    remainingDays = calculateRemainingDaysFromEndDate(input.endDate);
    if (remainingDays < 0) return "منتهي";
  }

  // 4. اشتراك مجاني (نشط مجاني): يبقى نشطاً مجانياً طالما لم يُلغَ أو يُعَلَّق أو انتهى.
  //    مع تاريخ نهاية مستقبلي يبقى «نشط مجاني» وليس «ساري».
  if (input.status === "نشط مجاني" || input.status === "free_active") {
    return "نشط مجاني";
  }

  // 5. بدون تاريخ نهاية صالح → غير نشط
  if (remainingDays === null) {
    return "غير نشط";
  }

  // 6. انتهى خلال 7 أيام → ينتهي قريباً، وإلا → ساري
  if (remainingDays <= 7) return "ينتهي قريباً";
  return "ساري";
}

export function isSubscriptionStatusActive(status?: string | null, isExpired?: boolean): boolean {
  const normalizedStatus = normalizeSubscriptionStatus(status, isExpired);
  return normalizedStatus === "ساري" || normalizedStatus === "ينتهي قريباً" || normalizedStatus === "نشط مجاني";
}

export function isSubscriptionStatusSuspended(status?: string | null): boolean {
  return normalizeSubscriptionStatus(status) === "موقوف مؤقتاً";
}

export function isActivePremiumSubscription(params: {
  subscriptionType?: string | null;
  packageType?: string | null;
  status?: string | null;
  isExpired?: boolean;
}): boolean {
  const type = normalizeSubscriptionType(params.subscriptionType || params.packageType);
  return type === "مميز" && isSubscriptionStatusActive(params.status, params.isExpired);
}

export function getEffectiveSubscriptionType(params: {
  subscriptionType?: string | null;
  packageType?: string | null;
  status?: string | null;
  isExpired?: boolean;
  price?: number | string | null;
}): NormalizedSubscriptionType {
  const explicitType = params.subscriptionType || params.packageType;
  if (explicitType) return normalizeSubscriptionType(explicitType);

  const price = Number(params.price ?? 0);
  if (Number.isFinite(price) && price > 0) return "مميز";

  return "عادي";
}
