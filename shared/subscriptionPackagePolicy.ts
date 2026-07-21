export const MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS = 40;

export type SubscriptionPackagePolicyInput = {
  duration?: unknown;
  durationDays?: unknown;
  isActive?: unknown;
};

/** Returns a positive whole-day duration, or null when the value is invalid. */
export function normalizeSubscriptionPackageDuration(value: unknown): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return null;
  }

  const duration = Number(value);
  return Number.isInteger(duration) && duration > 0 ? duration : null;
}

/** Inactive packages may be archived with a duration above the purchase limit. */
export function isSubscriptionPackageDurationAllowed(
  value: unknown,
  isActive: boolean,
): boolean {
  const duration = normalizeSubscriptionPackageDuration(value);
  return (
    duration !== null &&
    (!isActive || duration <= MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS)
  );
}

/** Only active packages with a valid duration up to the subscription limit can be purchased. */
export function isPurchasableSubscriptionPackage(
  subscriptionPackage: SubscriptionPackagePolicyInput,
): boolean {
  const duration =
    subscriptionPackage.duration ?? subscriptionPackage.durationDays;

  return (
    subscriptionPackage.isActive === true &&
    isSubscriptionPackageDurationAllowed(duration, true)
  );
}
