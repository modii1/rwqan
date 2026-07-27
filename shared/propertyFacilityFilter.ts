type FilterableProperty = {
  facilities?: unknown;
  prices?: { overnight?: unknown } | null;
};

const SMART_FACILITY_KEYWORDS: Record<string, readonly string[]> = {
  "مبيت": ["غرف نوم", "غرفة نوم", "نوم", "مبيت"],
  "شتاء": ["خيمة", "مشب", "تدفئة", "شتاء", "شتوية"],
  "صيف": ["مسبح", "ألعاب مائية", "مكيف", "صيف", "صيفية"],
  "مناسبات": ["قاعة", "مناسبات", "حفلات", "كوشة", "منسق حفلات"],
  "واي فاي": ["wi-fi", "wifi", "انترنت", "إنترنت"],
};

function normalizeFacilityText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/\u0640/g, "")
    .replace(/[إأٱآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");
}

export function parsePropertyFacilities(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(parsePropertyFacilities);
  }
  if (typeof value !== "string" || !value.trim()) return [];

  const trimmed = value.trim();
  if (
    trimmed.startsWith("[")
    || ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed !== value) return parsePropertyFacilities(parsed);
    } catch {
      // Fall through to the legacy comma-separated format.
    }
  }
  return trimmed
    .split(",")
    .map((facility) => facility.trim().replace(/^[\s'"\[\]]+|[\s'"\[\]]+$/g, ""))
    .filter(Boolean);
}

function isNoPoolFacility(normalizedFacility: string): boolean {
  return normalizedFacility.includes(normalizeFacilityText("بدون مسبح"));
}

function isPoolFacility(normalizedFacility: string): boolean {
  return normalizedFacility.includes(normalizeFacilityText("\u0645\u0633\u0628\u062d"))
    && !isNoPoolFacility(normalizedFacility);
}

export function normalizePropertyFacilitySelection(value: unknown): string[] {
  const facilities = [...new Set(
    parsePropertyFacilities(value).map((facility) => facility.trim()).filter(Boolean),
  )];
  const hasPositivePool = facilities.some((facility) =>
    isPoolFacility(normalizeFacilityText(facility))
  );
  return hasPositivePool
    ? facilities.filter((facility) => !isNoPoolFacility(normalizeFacilityText(facility)))
    : facilities;
}

export function togglePropertyFacilitySelection(
  currentValues: readonly string[],
  selectedValue: string,
): string[] {
  const selected = selectedValue.trim();
  if (!selected) return [...new Set(currentValues.map((value) => value.trim()).filter(Boolean))];

  const normalizedSelected = normalizeFacilityText(selected);
  const current = normalizePropertyFacilitySelection(currentValues);
  if (current.some((value) => normalizeFacilityText(value) === normalizedSelected)) {
    return current.filter((value) => normalizeFacilityText(value) !== normalizedSelected);
  }

  const compatible = current.filter((value) => {
    const normalizedValue = normalizeFacilityText(value);
    if (isNoPoolFacility(normalizedSelected)) return !isPoolFacility(normalizedValue);
    if (isPoolFacility(normalizedSelected)) return !isNoPoolFacility(normalizedValue);
    return true;
  });
  return [...compatible, selected];
}

function matchesKeyword(normalizedFacility: string, keyword: string): boolean {
  const normalizedKeyword = normalizeFacilityText(keyword);
  if (normalizedKeyword === normalizeFacilityText("مسبح") && isNoPoolFacility(normalizedFacility)) {
    return false;
  }
  return normalizedFacility.includes(normalizedKeyword);
}

export function propertyMatchesFacilityFilter(
  property: FilterableProperty,
  selectedFacility: string,
): boolean {
  const normalizedSelected = normalizeFacilityText(selectedFacility);
  if (!normalizedSelected) return true;

  const facilities = parsePropertyFacilities(property.facilities);
  const normalizedFacilities = facilities.map(normalizeFacilityText);

  if (normalizedSelected === normalizeFacilityText("مسبح")) {
    return normalizedFacilities.some(
      (facility) => facility.startsWith(normalizedSelected) && !isNoPoolFacility(facility),
    );
  }

  if (normalizedSelected === normalizeFacilityText("بدون مسبح")) {
    return normalizedFacilities.some(isNoPoolFacility);
  }

  if (normalizedSelected === normalizeFacilityText("مبيت")) {
    const overnight = Number(property.prices?.overnight || 0);
    if (Number.isFinite(overnight) && overnight > 0) return true;
  }

  if (normalizedFacilities.some(
    (facility) => facility.includes(normalizedSelected),
  )) {
    return true;
  }

  const smartKeywords = SMART_FACILITY_KEYWORDS[selectedFacility]
    || SMART_FACILITY_KEYWORDS[
      Object.keys(SMART_FACILITY_KEYWORDS).find(
        (key) => normalizeFacilityText(key) === normalizedSelected,
      ) || ""
    ];
  if (!smartKeywords) return false;

  return normalizedFacilities.some((facility) =>
    smartKeywords.some((keyword) => matchesKeyword(facility, keyword))
  );
}

export function propertyMatchesAllFacilityFilters(
  property: FilterableProperty,
  selectedFacilities: readonly string[],
): boolean {
  const normalizedSelectedFacilities = selectedFacilities.map(normalizeFacilityText);
  const hasPool = normalizedSelectedFacilities.includes(normalizeFacilityText("\u0645\u0633\u0628\u062d"));
  const hasNoPool = normalizedSelectedFacilities.includes(
    normalizeFacilityText("\u0628\u062f\u0648\u0646 \u0645\u0633\u0628\u062d"),
  );
  if (hasPool && hasNoPool) return false;

  return selectedFacilities.every((facility) =>
    propertyMatchesFacilityFilter(property, facility)
  );
}
