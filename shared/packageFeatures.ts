export type PackageFeature = {
  text: string;
  icon?: string;
};

/**
 * Normalizes both legacy string features and the new { text, icon } shape.
 * Legacy strings stay fully compatible and simply have no explicit icon.
 */
export function normalizePackageFeature(value: unknown): PackageFeature | null {
  if (typeof value === "string") {
    const text = value.trim();
    return text ? { text } : null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text.trim() : "";
  if (!text) return null;
  const icon = typeof record.icon === "string" ? record.icon.trim() : "";
  return icon ? { text, icon } : { text };
}

export function normalizePackageFeatures(value: unknown): PackageFeature[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizePackageFeature)
    .filter((feature): feature is PackageFeature => feature !== null);
}

export function packageFeatureTexts(value: unknown): string[] {
  return normalizePackageFeatures(value).map((feature) => feature.text);
}
