import type { Subscription } from "../../shared/schema";

function getSubscriptionSortTime(subscription: Subscription): number {
  const candidate =
    (subscription as Subscription & { updatedAt?: string }).updatedAt ||
    subscription.createdAt ||
    subscription.endDate;
  const timestamp = candidate ? new Date(candidate).getTime() : 0;
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Select the authoritative record when legacy data contains duplicate
 * subscription documents for the same property. New writes use SUB-{property},
 * so that canonical document wins; otherwise the newest record wins.
 */
export function selectCurrentSubscriptionForProperty(
  subscriptions: readonly Subscription[],
  propertyNumber: string,
): Subscription | undefined {
  const matches = subscriptions.filter(
    (subscription) => subscription.propertyNumber === propertyNumber,
  );
  const canonical = matches.find(
    (subscription) => subscription.id === `SUB-${propertyNumber}`,
  );
  if (canonical) return canonical;

  return [...matches].sort(
    (left, right) =>
      getSubscriptionSortTime(right) - getSubscriptionSortTime(left),
  )[0];
}
