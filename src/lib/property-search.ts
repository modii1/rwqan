export interface PropertySearchFilters {
  searchQuery: string;
  selectedCity: string;
  selectedDirection: string;
  selectedType: string;
  selectedFacilities: readonly string[];
  maxPrice: number;
  maxPriceCeiling: number;
}

export interface StoredPropertyFilters {
  searchQuery: string;
  selectedCity: string;
  selectedDirection: string;
  selectedType: string;
  selectedFacilities: string[];
  maxPrice?: number;
  visibleCount?: number;
  occasionFilter: string;
  selectedDay: string;
}

export type PropertySearchQueryKey = readonly [
  "/api/search",
  string,
  string,
  string,
  string,
  string,
  number | null,
];

export function normalizePropertyFilterChoice(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized === "all" ? "" : normalized;
}

export function normalizePropertyFacilityFilters(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(
    values
      .map(normalizePropertyFilterChoice)
      .filter(Boolean),
  )];
}

export function parseStoredPropertyFilters(
  serialized: string | null,
): StoredPropertyFilters | null {
  if (!serialized) return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const value = parsed as Record<string, unknown>;
    const finiteNonNegative = (candidate: unknown): number | undefined =>
      typeof candidate === "number"
      && Number.isFinite(candidate)
      && candidate >= 0
        ? candidate
        : undefined;
    const visibleCount = finiteNonNegative(value.visibleCount);

    return {
      searchQuery: typeof value.searchQuery === "string" ? value.searchQuery : "",
      selectedCity: normalizePropertyFilterChoice(value.selectedCity),
      selectedDirection: normalizePropertyFilterChoice(value.selectedDirection),
      selectedType: normalizePropertyFilterChoice(value.selectedType),
      selectedFacilities: normalizePropertyFacilityFilters(value.selectedFacilities),
      maxPrice: finiteNonNegative(value.maxPrice),
      visibleCount: visibleCount !== undefined && visibleCount >= 30
        ? Math.floor(visibleCount)
        : undefined,
      occasionFilter: normalizePropertyFilterChoice(value.occasionFilter),
      selectedDay: normalizePropertyFilterChoice(value.selectedDay),
    };
  } catch {
    return null;
  }
}

function normalizeFacilities(values: readonly string[]): string[] {
  return normalizePropertyFacilityFilters(values).sort();
}

function getEffectiveMaxPrice(filters: PropertySearchFilters): number | null {
  if (!Number.isFinite(filters.maxPrice) || filters.maxPrice < 0) return null;
  if (!Number.isFinite(filters.maxPriceCeiling)) return filters.maxPrice;
  return filters.maxPrice < filters.maxPriceCeiling ? filters.maxPrice : null;
}

export function buildPropertySearchQueryKey(
  filters: PropertySearchFilters,
): PropertySearchQueryKey {
  return [
    "/api/search",
    filters.searchQuery.trim(),
    normalizePropertyFilterChoice(filters.selectedCity),
    normalizePropertyFilterChoice(filters.selectedDirection),
    normalizePropertyFilterChoice(filters.selectedType),
    normalizeFacilities(filters.selectedFacilities).join(","),
    getEffectiveMaxPrice(filters),
  ];
}

export function arePropertySearchQueryKeysEqual(
  left: PropertySearchQueryKey,
  right: PropertySearchQueryKey,
): boolean {
  return left.every((value, index) => value === right[index]);
}

export function buildPropertySearchQueryString(
  filters: PropertySearchFilters,
): string {
  const [, search, city, direction, type, facilities, maxPrice] =
    buildPropertySearchQueryKey(filters);
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (city) params.set("city", city);
  if (direction) params.set("direction", direction);
  if (type) params.set("type", type);
  if (facilities) params.set("facilities", facilities);
  if (maxPrice !== null) params.set("maxPrice", String(maxPrice));
  return params.toString();
}
