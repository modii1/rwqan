import type { Package } from "../../shared/schema";
import {
  calculateSubscriptionPrice,
  getIncludedPropertyCount,
  getMaximumPropertyCount,
} from "../../shared/subscriptionPricing";

export class OwnerSubscriptionPaymentPlanError extends Error {
  readonly status = 400;

  constructor(
    message: string,
    readonly code:
      | "PACKAGE_MINIMUM_PROPERTIES_REQUIRED"
      | "PACKAGE_PROPERTY_LIMIT_EXCEEDED",
  ) {
    super(message);
    this.name = "OwnerSubscriptionPaymentPlanError";
  }
}

function uniquePropertyNumbers(values: unknown[]): string[] {
  return Array.from(new Set(
    values.map((value) => String(value || "").trim()).filter(Boolean),
  ));
}

export function createOwnerSubscriptionPaymentPlan(params: {
  action: unknown;
  mainPropertyNumber: string;
  existingLinkedPropertyNumbers: string[];
  requestedPropertyNumbers: string[];
  pkg: Package;
}) {
  const {
    action,
    mainPropertyNumber,
    existingLinkedPropertyNumbers,
    requestedPropertyNumbers,
    pkg,
  } = params;
  const existing = uniquePropertyNumbers(existingLinkedPropertyNumbers)
    .filter((propertyNumber) => propertyNumber !== mainPropertyNumber);
  const existingSet = new Set(existing);
  const requested = uniquePropertyNumbers(requestedPropertyNumbers)
    .filter(
      (propertyNumber) =>
        propertyNumber !== mainPropertyNumber && !existingSet.has(propertyNumber),
    );
  const linkedPropertyNumbers = [...existing, ...requested];
  const maximumPropertyCount = getMaximumPropertyCount(pkg);
  const totalPropertyCount = linkedPropertyNumbers.length + 1;

  // Existing groups may be downgraded and atomically trimmed at fulfillment,
  // but a checkout must never accept newly requested members over the limit.
  if (requested.length > 0 && totalPropertyCount > maximumPropertyCount) {
    throw new OwnerSubscriptionPaymentPlanError(
      `هذه الباقة تدعم ${maximumPropertyCount} عقار كحد أقصى`,
      "PACKAGE_PROPERTY_LIMIT_EXCEEDED",
    );
  }

  const retainedPropertyCount = Math.min(
    totalPropertyCount,
    maximumPropertyCount,
  );
  const includedPropertyCount = getIncludedPropertyCount(pkg);
  if (action !== "extend" && retainedPropertyCount < includedPropertyCount) {
    const missing = includedPropertyCount - retainedPropertyCount;
    throw new OwnerSubscriptionPaymentPlanError(
      `يجب إضافة ${missing === 1 ? "عقار إضافي واحد" : `${missing} عقارات إضافية`} لهذه الباقة`,
      "PACKAGE_MINIMUM_PROPERTIES_REQUIRED",
    );
  }

  return {
    mainPropertyNumber,
    existingLinkedPropertyNumbers: existing,
    requestedPropertyNumbers: requested,
    linkedPropertyNumbers,
    totalPropertyCount,
    retainedPropertyCount,
    maximumPropertyCount,
    willAutoUnlink: Math.max(0, totalPropertyCount - maximumPropertyCount),
    pricing: calculateSubscriptionPrice(pkg, retainedPropertyCount),
  };
}
