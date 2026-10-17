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
