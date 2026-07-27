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
