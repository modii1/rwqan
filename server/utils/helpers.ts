/**
 * Shared constants and helpers for routes
 */
import multer from "multer";
import { normalizePhoneDigits, normalizeSaudiMobilePhone } from "../../shared/core/contact/phone";

export const upload = multer({
  storage: multer.memoryStorage(),
});

export const uploadImages = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

// Google Sheet column mapping (legacy, still used for admin property update translations)
export const SHEET_MAP: Record<string, string> = {
  "🏷 رقم العقار": "propertyNumber",
  "🏡 اسم العقار": "name",
  "📞 رقم الجوال": "whatsappNumber",
  "📍 الموقع": "location",
  "📍 المنطقة": "city",
  "🧭 الاتجاه": "direction",
  "🏠 النوع": "type",
  "🔹 المرافق": "facilities",
  "🔗 رابط الصور": "imagesLink",
  "💰 سعر العرض": "priceOffer",
  "💰 سعر وسط الأسبوع": "priceWeekdays",
  "💰 سعر نهاية الأسبوع": "priceWeekend",
  "💰 سعر المبيت": "priceNight",
  "💰 سعر خاص (اختياري)": "priceSpecial",
  "💰 سعر الإجازات": "priceHolidays",
  "نوع الاشتراك": "subscriptionType",
  "تاريخ الاشتراك": "subscriptionDate",
  "الرقم السري": "pin",
};

/**
 * Detect device type from User-Agent
 */
export function detectDeviceType(userAgent: string): 'mobile' | 'desktop' | 'tablet' {
  if (!userAgent) return 'desktop';
  const ua = userAgent.toLowerCase();

  if (/ipad|android(?!.*mobile)|kindle|playbook|silk/.test(ua)) return 'tablet';
  if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini|windows phone/.test(ua)) return 'mobile';
  return 'desktop';
}

/**
 * Parse features string/array
 */
export function parseFeatures(val: any): string[] {
  if (!val) return [];
  try {
    if (String(val).trim().startsWith("[")) return JSON.parse(val);
  } catch { }
  return String(val).split("\n");
}

/**
 * Normalize Saudi phone number
 * - Accepts 9 or 10 digits (with leading 0)
 * - If 10 digits starting with 0, removes the leading 0
 * - Returns 9-digit format (05xxxxxxxx -> 5xxxxxxxx)
 */
export function normalizePhoneNumber(phone: string | undefined | null): string {
  if (!phone) return "";

  const normalized = normalizeSaudiMobilePhone(phone);
  if (normalized) return normalized;

  // Keep the existing detailed validation errors for route consumers.
  const digits = normalizePhoneDigits(phone);
  
  // If starts with 966, remove it
  let cleaned = digits.startsWith("966") ? digits.slice(3) : digits;
  
  // If still starts with 0, remove it (10 digits with leading 0 -> 9 digits)
  if (cleaned.startsWith("0")) {
    cleaned = cleaned.slice(1);
  }
  
  // Validate it's exactly 9 digits
  if (cleaned.length !== 9) {
    throw new Error(`رقم الجوال يجب أن يكون 9 أرقام`);
  }
  
  // Must start with 5 (Saudi mobile)
  if (!cleaned.startsWith("5")) {
    throw new Error(`رقم الجوال يجب أن يبدأ بـ 5`);
  }
  
  return cleaned;
}
