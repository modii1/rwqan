/**
 * Shared constants and helpers for routes
 */
import multer from "multer";

export const upload = multer({ storage: multer.memoryStorage() });

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
