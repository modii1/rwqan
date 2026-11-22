/**
 * RWQAN — central customer-platform font catalogue.
 *
 * The selected font is stored once in Firestore (`settings/platform_font`) and
 * applied centrally by the root layout. Admin pages always keep Cairo.
 */

export const PLATFORM_FONT_IDS = [
  "tajawal",
  "cairo",
  "ibm-plex-sans-arabic",
  "noto-sans-arabic",
  "alexandria",
] as const;

export type PlatformFontId = (typeof PLATFORM_FONT_IDS)[number];

export interface PlatformFontOption {
  id: PlatformFontId;
  /** Google Fonts family name. */
  family: string;
  /** Human label shown in the admin picker. */
  label: string;
  /** Short Arabic description shown under the label. */
  note: string;
  /** Weights advertised to Google Fonts for this family. */
  weights: string;
}

export const PLATFORM_FONTS: readonly PlatformFontOption[] = [
  {
    id: "tajawal",
    family: "Tajawal",
    label: "Tajawal",
    note: "خط عربي حديث وواضح",
    weights: "400;500;700",
  },
  {
    id: "cairo",
    family: "Cairo",
    label: "Cairo",
    note: "خط المنصة الحالي والافتراضي",
    weights: "400;500;600;700",
  },
  {
    id: "ibm-plex-sans-arabic",
    family: "IBM Plex Sans Arabic",
    label: "IBM Plex Sans Arabic",
    note: "خط عربي محايد مناسب للواجهات",
    weights: "400;500;600;700",
  },
  {
    id: "noto-sans-arabic",
    family: "Noto Sans Arabic",
    label: "Noto Sans Arabic",
    note: "خط عربي عالي الوضوح",
    weights: "400;500;600;700",
  },
  {
    id: "alexandria",
    family: "Alexandria",
    label: "Alexandria",
    note: "خط عربي عصري بحروف عريضة",
    weights: "400;500;600;700",
  },
] as const;

export const DEFAULT_PLATFORM_FONT_ID: PlatformFontId = "cairo";

/** Cairo always remains the admin font, regardless of the customer setting. */
export const ADMIN_FONT_FAMILY_STACK = "'Cairo', system-ui, sans-serif";

export function isPlatformFontId(value: unknown): value is PlatformFontId {
  return (
    typeof value === "string" &&
    (PLATFORM_FONT_IDS as readonly string[]).includes(value)
  );
}

export function normalizePlatformFontId(value: unknown): PlatformFontId {
  return isPlatformFontId(value) ? value : DEFAULT_PLATFORM_FONT_ID;
}

export function getPlatformFontOption(
  id: unknown,
): PlatformFontOption {
  const normalized = normalizePlatformFontId(id);
  return (
    PLATFORM_FONTS.find((font) => font.id === normalized) ??
    PLATFORM_FONTS.find((font) => font.id === DEFAULT_PLATFORM_FONT_ID)!
  );
}

/**
 * Complete CSS font-family stack used for every customer page. The selected
 * family comes first, then the previous default (Cairo) as a graceful fallback
 * if the Google Fonts file cannot be loaded.
 */
export function getPlatformFontFamilyStack(id: unknown): string {
  const font = getPlatformFontOption(id);
  return `'${font.family}', 'Cairo', system-ui, -apple-system, 'Segoe UI', sans-serif`;
}

/**
 * One stylesheet request for every supported family. `display=block` keeps text
 * hidden for the short block period instead of flashing a different font while
 * the selected file downloads, and falls back to Cairo after the block period.
 */
const FONT_QUERY = PLATFORM_FONTS.map(
  (font) => `family=${font.family.replace(/ /g, "+")}:wght@${font.weights}`,
).join("&");

export const PLATFORM_FONT_STYLESHEET_URL = `https://fonts.googleapis.com/css2?${FONT_QUERY}&display=block`;
