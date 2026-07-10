export const SUSPENDED_SUBSCRIPTION_STATUS = "موقوف مؤقتاً" as const;
export const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export type SubscriptionLifecycleErrorCode =
  | "NOT_FOUND"
  | "NOT_ACTIVE"
  | "ALREADY_SUSPENDED"
  | "NOT_SUSPENDED"
  | "INVALID_END_DATE"
  | "INVALID_SUSPENSION_STATE";

export class SubscriptionLifecycleError extends Error {
  constructor(
    public readonly code: SubscriptionLifecycleErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SubscriptionLifecycleError";
  }
}

function parseSubscriptionEndTime(endDate: string): number {
  const normalized = String(endDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    // Calendar-only subscriptions remain valid through their final day in Riyadh.
    return new Date(`${normalized}T23:59:59.999+03:00`).getTime();
  }
  return new Date(normalized).getTime();
}

export function calculateRemainingDurationMs(
  endDate: string,
  suspendedAt: Date,
): number {
  const endTime = parseSubscriptionEndTime(endDate);
  const suspendedTime = suspendedAt.getTime();

  if (!Number.isFinite(endTime) || !Number.isFinite(suspendedTime)) {
    throw new SubscriptionLifecycleError(
      "INVALID_END_DATE",
      "تاريخ انتهاء الاشتراك غير صالح.",
    );
  }

  const remainingDurationMs = endTime - suspendedTime;
  if (remainingDurationMs <= 0) {
    throw new SubscriptionLifecycleError(
      "NOT_ACTIVE",
      "لا يمكن إيقاف اشتراك منتهي مؤقتاً.",
    );
  }

  return remainingDurationMs;
}

export function calculateResumedEndDate(
  remainingDurationMs: number,
  resumedAt: Date,
): string {
  const resumedTime = resumedAt.getTime();
  if (
    !Number.isFinite(remainingDurationMs) ||
    remainingDurationMs <= 0 ||
    !Number.isFinite(resumedTime)
  ) {
    throw new SubscriptionLifecycleError(
      "INVALID_SUSPENSION_STATE",
      "بيانات مدة الإيقاف المؤقت غير صالحة.",
    );
  }

  return new Date(resumedTime + remainingDurationMs).toISOString();
}

export function calculateFrozenRemainingDays(remainingDurationMs: number): number {
  if (!Number.isFinite(remainingDurationMs) || remainingDurationMs <= 0) return 0;
  return Math.ceil(remainingDurationMs / MILLISECONDS_PER_DAY);
}
