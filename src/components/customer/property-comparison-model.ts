import type { Property } from "@shared/schema";

export const MAX_PROPERTY_COMPARISON_ITEMS = 3;

export type PropertyComparisonPriceKey = keyof Property["prices"];

export const PROPERTY_COMPARISON_PRICE_ROWS: ReadonlyArray<{
  key: PropertyComparisonPriceKey;
  label: string;
  optional: boolean;
}> = [
  { key: "display", label: "سعر العرض", optional: true },
  { key: "weekday", label: "وسط الأسبوع", optional: false },
  { key: "weekend", label: "نهاية الأسبوع", optional: false },
  { key: "overnight", label: "مبيت", optional: false },
  { key: "special", label: "سعر خاص", optional: true },
  { key: "holidays", label: "إجازات", optional: false },
];

export function togglePropertyComparison(
  current: readonly string[],
  propertyNumber: string,
): { propertyNumbers: string[]; limitReached: boolean } {
  if (current.includes(propertyNumber)) {
    return {
      propertyNumbers: current.filter((candidate) => candidate !== propertyNumber),
      limitReached: false,
    };
  }

  if (current.length >= MAX_PROPERTY_COMPARISON_ITEMS) {
    return { propertyNumbers: [...current], limitReached: true };
  }

  return {
    propertyNumbers: [...current, propertyNumber],
    limitReached: false,
  };
}

export function keepAvailableComparisonProperties(
  current: readonly string[],
  availablePropertyNumbers: readonly string[],
): string[] {
  const available = new Set(availablePropertyNumbers);
  return current.filter((propertyNumber) => available.has(propertyNumber));
}

export function comparisonPriceRowsForProperties(
  properties: readonly Property[],
) {
  return PROPERTY_COMPARISON_PRICE_ROWS.filter((row) =>
    !row.optional || properties.some((property) =>
      String(property.prices?.[row.key] || "").trim().length > 0),
  );
}

export function uniquePropertyFacilities(property: Property): string[] {
  return Array.from(new Set(
    (property.facilities || [])
      .map((facility) => facility.trim())
      .filter(Boolean),
  ));
}
