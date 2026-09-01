import { isActivePremiumSubscription } from "@shared/subscriptionType";

interface PublicSubscriptionState {
  subscriptionType?: string | null;
  status?: string | null;
  endDate?: string | null;
  isExpired?: boolean;
}

interface PublicPropertySubscriptionState {
  propertyNumber?: string | null;
  name?: string | null;
  subscriptionType?: string | null;
  subscriptionStatus?: string | null;
  subscriptionEndDate?: string | null;
  isSubscriptionExpired?: boolean;
  freePropertyContactDailyLimit?: number | null;
}

function parseSubscriptionEndDate(value?: string | null): Date | null {
  const normalized = String(value || "").trim();
  if (!normalized) return null;

  // Subscription dates are calendar dates and remain valid through their final day.
  const calendarDate = normalized.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (calendarDate) {
    const [, year, month, day] = calendarDate;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day));
    if (
      parsed.getFullYear() !== Number(year)
      || parsed.getMonth() !== Number(month) - 1
      || parsed.getDate() !== Number(day)
    ) {
      return null;
    }
    return parsed;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

export function hasValidPremiumSubscription(
  subscription: PublicSubscriptionState,
  now = new Date(),
): boolean {
  if (!isActivePremiumSubscription({
    subscriptionType: subscription.subscriptionType,
    status: subscription.status,
    isExpired: subscription.isExpired,
  })) {
    return false;
  }

  const endDate = parseSubscriptionEndDate(subscription.endDate);
  if (!endDate) return false;

  return startOfDay(endDate) >= startOfDay(now);
}

export function isPublicPropertyPremium(
  property: PublicPropertySubscriptionState,
  now = new Date(),
): boolean {
  return hasValidPremiumSubscription({
    subscriptionType: property.subscriptionType,
    status: property.subscriptionStatus,
    endDate: property.subscriptionEndDate,
    isExpired: property.isSubscriptionExpired,
  }, now);
}

export function getPublicPropertyDisplayName(
  property: PublicPropertySubscriptionState,
  now = new Date(),
): string {
  if (!isPublicPropertyPremium(property, now)) return "";
  return String(property.name || "").trim();
}

export function getPublicPropertyLabel(
  property: PublicPropertySubscriptionState,
  now = new Date(),
): string {
  const premiumName = getPublicPropertyDisplayName(property, now);
  if (premiumName) return premiumName;
  return `عقار رقم ${String(property.propertyNumber || "").trim()}`.trim();
}

export function getPublicPropertyContactPolicyMessage(
  property: PublicPropertySubscriptionState,
  now = new Date(),
): string {
  return isPublicPropertyPremium(property, now)
    ? "العقار المميز يتيح للعملاء تواصلاً غير محدود عبر واتساب."
    : property.freePropertyContactDailyLimit === undefined ||
        property.freePropertyContactDailyLimit === null ||
        property.freePropertyContactDailyLimit === 3
      ? "العقار المجاني يتيح 3 محاولات تواصل عبر واتساب يومياً."
      : `العقار المجاني يتيح ${property.freePropertyContactDailyLimit} محاولات تواصل عبر واتساب يومياً.`;
}
