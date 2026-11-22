import type { Package } from "./schema";

type PricingPackage = Pick<
  Package,
  "id" | "price" | "pricePerProperty" | "propertyCount" | "maxProperties"
>;

export type SubscriptionPriceBreakdown = {
  basePrice: number;
  includedPropertyCount: number;
  additionalPropertyPrice: number;
  billedPropertyCount: number;
  additionalPropertyCount: number;
  total: number;
};

const LEGACY_VIP_PACKAGE_ID = "pkg-month-2properties";

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function nonNegativeAmount(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * `propertyCount` is the number of properties included in the package base
 * price. The original VIP Firestore document predates that field and stores
 * 25 SAR as a per-property value, while historical two-property payments are
 * 50 SAR. Preserve that legacy meaning until the document is normalized.
 */
export function getIncludedPropertyCount(pkg: PricingPackage): number {
  return positiveInteger(
    pkg.propertyCount,
    pkg.id === LEGACY_VIP_PACKAGE_ID ? 2 : 1,
  );
}

export function getMaximumPropertyCount(pkg: PricingPackage): number {
  return positiveInteger(pkg.maxProperties, getIncludedPropertyCount(pkg));
}

export function getAdditionalPropertyPrice(pkg: PricingPackage): number {
  const configured = nonNegativeAmount(pkg.pricePerProperty, -1);
  if (configured >= 0) return configured;
  return nonNegativeAmount(pkg.price);
}

export function getPackageBasePrice(pkg: PricingPackage): number {
  const configuredPrice = nonNegativeAmount(pkg.price);
  const isUnnormalizedLegacyVip =
    pkg.id === LEGACY_VIP_PACKAGE_ID &&
    !positiveInteger(pkg.propertyCount, 0) &&
    pkg.pricePerProperty === undefined;
  return isUnnormalizedLegacyVip
    ? configuredPrice * getIncludedPropertyCount(pkg)
    : configuredPrice;
}

export function calculateSubscriptionPrice(
  pkg: PricingPackage,
  propertyCount: number,
): SubscriptionPriceBreakdown {
  const includedPropertyCount = getIncludedPropertyCount(pkg);
  const billedPropertyCount = Math.max(
    includedPropertyCount,
    positiveInteger(propertyCount, 1),
  );
  const additionalPropertyCount = Math.max(
    0,
    billedPropertyCount - includedPropertyCount,
  );
  const basePrice = getPackageBasePrice(pkg);
  const additionalPropertyPrice = getAdditionalPropertyPrice(pkg);

  return {
    basePrice,
    includedPropertyCount,
    additionalPropertyPrice,
    billedPropertyCount,
    additionalPropertyCount,
    total: basePrice + additionalPropertyCount * additionalPropertyPrice,
  };
}

// =========================
// خيارات المدة (شهري / ثلاثة أشهر)
// =========================

export type BillingPeriod = "monthly" | "quarterly";

type BillingPackage = PricingPackage &
  Partial<
    Pick<
      Package,
      | "duration"
      | "monthlyPrice"
      | "quarterlyPrice"
      | "monthlyDiscountPercent"
      | "quarterlyDiscountPercent"
      | "monthlyEnabled"
      | "quarterlyEnabled"
      | "quarterlyDurationDays"
      | "discountStartsAt"
      | "discountEndsAt"
    >
  >;

export type PackageBillingOption = {
  period: BillingPeriod;
  enabled: boolean;
  originalPrice: number;
  discountPercent: number;
  discountAmount: number;
  finalPrice: number;
  durationDays: number;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampPercent(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(100, Math.max(0, parsed));
}

/**
 * Optional offer window. Date-only values are interpreted in local time, with
 * the end date inclusive through 23:59:59. Full ISO timestamps are respected.
 * Anything malformed is ignored so an accidental value never hides a price.
 */
function parseOfferBoundary(value: unknown, endOfDay: boolean): number | null {
  if (value === undefined || value === null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.includes("T")
    ? raw
    : `${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`;
  const timestamp = new Date(normalized).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isDiscountWindowActive(pkg: BillingPackage): boolean {
  const now = Date.now();
  const startsAt = parseOfferBoundary(pkg.discountStartsAt, false);
  const endsAt = parseOfferBoundary(pkg.discountEndsAt, true);
  if (startsAt !== null && now < startsAt) return false;
  if (endsAt !== null && now > endsAt) return false;
  return true;
}

/**
 * Returns the authoritative price/duration option for a package period.
 * Monthly falls back to the legacy `price`/`duration` fields, so existing
 * packages keep working unchanged. Quarterly is opt-in: it is enabled only
 * when the admin sets a quarterly price and explicitly enables it.
 */
export function getPackageBillingOption(
  pkg: BillingPackage,
  period: BillingPeriod,
): PackageBillingOption {
  const monthly = period === "monthly";
  // Monthly falls back to the legacy base-price helper so the original VIP
  // two-property document keeps its historical 50 SAR total. An explicit
  // monthlyPrice always wins.
  const originalPrice = monthly
    ? pkg.monthlyPrice !== undefined
      ? nonNegativeAmount(pkg.monthlyPrice)
      : getPackageBasePrice(pkg)
    : nonNegativeAmount(pkg.quarterlyPrice ?? 0);
  const discountPercent = isDiscountWindowActive(pkg)
    ? clampPercent(monthly ? pkg.monthlyDiscountPercent : pkg.quarterlyDiscountPercent)
    : 0;
  const discountAmount = roundMoney((originalPrice * discountPercent) / 100);
  const finalPrice = roundMoney(Math.max(0, originalPrice - discountAmount));
  const durationDays = positiveInteger(
    monthly ? pkg.duration : pkg.quarterlyDurationDays,
    monthly ? 30 : 90,
  );
  const enabled =
    originalPrice > 0 &&
    (monthly ? pkg.monthlyEnabled !== false : pkg.quarterlyEnabled === true);

  return {
    period,
    enabled,
    originalPrice,
    discountPercent,
    discountAmount,
    finalPrice,
    durationDays,
  };
}

export function calculateSubscriptionPriceForPeriod(
  pkg: BillingPackage,
  propertyCount: number,
  period: BillingPeriod,
): SubscriptionPriceBreakdown {
  const base = calculateSubscriptionPrice(pkg, propertyCount);
  const option = getPackageBillingOption(pkg, period);
  if (!option.enabled) {
    return { ...base, basePrice: 0, total: 0 };
  }
  return {
    ...base,
    basePrice: option.finalPrice,
    total: roundMoney(
      option.finalPrice + base.additionalPropertyCount * base.additionalPropertyPrice,
    ),
  };
}
