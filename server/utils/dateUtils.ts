/**
 * دوال مساعدة للتعامل مع التواريخ
 * 
 * القواعد:
 * - الخادم يعمل بتوقيت UTC
 * - جميع التواريخ تُخزن كـ epoch milliseconds
 * - لا تحويلات يدوية للتوقيت
 */
import { MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS } from "../../shared/core/subscriptions/package-policy";

/**
 * الحصول على الوقت الحالي كـ epoch milliseconds
 */
export function getNow(): number {
  return Date.now();
}

/**
 * الحصول على الوقت الحالي كـ ISO string
 */
export function getNowISO(): string {
  return new Date().toISOString();
}

/**
 * Alias للتوافق مع الكود القديم
 */
export function getNowGMT3(): Date {
  return new Date();
}

/**
 * Alias للتوافق مع الكود القديم
 */
export function getNowInRiyadh(): Date {
  return new Date();
}

/**
 * تحويل تاريخ إلى ISO string
 */
export function toGMT3ISO(date?: Date): string {
  return (date || new Date()).toISOString();
}

/**
 * Alias للتوافق مع الكود القديم
 */
export function toRiyadhISO(date?: Date): string {
  return toGMT3ISO(date);
}

/**
 * الحصول على تاريخ اليوم بتنسيق YYYY-MM-DD (UTC)
 */
export function getTodayDateGMT3(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * الحصول على الوقت الحالي بتنسيق HH:MM AM/PM (توقيت الرياض للعرض)
 */
export function getCurrentTimeGMT3(): string {
  return new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Riyadh',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * تحويل تاريخ إلى نص مقروء بالعربية (للعرض فقط)
 */
export function formatArabicDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Riyadh'
  });
}

/**
 * تحويل تاريخ إلى نص مقروء بالعربية مع الوقت (للعرض فقط)
 */
export function formatArabicDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Riyadh'
  });
}

/**
 * الحصول على بداية اليوم بتوقيت الرياض
 */
export function getStartOfDayRiyadh(date?: Date): Date {
  const d = date || new Date();
  // نحسب بداية اليوم بتوقيت الرياض
  const riyadhStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  return new Date(riyadhStr + 'T00:00:00+03:00');
}

/**
 * الحصول على نهاية اليوم بتوقيت الرياض
 */
export function getEndOfDayRiyadh(date?: Date): Date {
  const d = date || new Date();
  const riyadhStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  return new Date(riyadhStr + 'T23:59:59.999+03:00');
}

/**
 * الحصول على بداية الشهر بتوقيت الرياض
 */
export function getStartOfMonthRiyadh(date?: Date): Date {
  const d = date || new Date();
  const riyadhStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  const [year, month] = riyadhStr.split('-');
  return new Date(`${year}-${month}-01T00:00:00+03:00`);
}

/**
 * الحصول على نهاية الشهر بتوقيت الرياض
 */
export function getEndOfMonthRiyadh(date?: Date): Date {
  const d = date || new Date();
  const riyadhStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
  const [year, month] = riyadhStr.split('-');
  const nextMonth = new Date(`${year}-${month}-01T00:00:00+03:00`);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  nextMonth.setDate(0);
  nextMonth.setHours(23, 59, 59, 999);
  return nextMonth;
}

/**
 * إضافة أيام إلى تاريخ
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * حساب الأيام المتبقية في الاشتراك
 * يُرجع عدد الأيام من اليوم حتى تاريخ الانتهاء
 * 0 = اليوم الأخير (الاشتراك ينتهي نهاية هذا اليوم)
 * سالب = منتهي
 */
export function calculateRemainingDays(endDate: Date | string | null): number {
  if (!endDate) return -1;
  const end = typeof endDate === 'string' ? new Date(endDate) : endDate;
  if (isNaN(end.getTime())) return -1;
  const today = getStartOfDayRiyadh();
  const endMidnight = getStartOfDayRiyadh(end);
  const diffTime = endMidnight.getTime() - today.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

export const MAX_SUBSCRIPTION_DAYS = MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS;
export const RENEWAL_WINDOW_DAYS = 10;
export const SUBSCRIPTION_MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
export const MAX_SUBSCRIPTION_DURATION_MS =
  MAX_SUBSCRIPTION_DAYS * SUBSCRIPTION_MILLISECONDS_PER_DAY;

/**
 * The final allowed instant for a subscription, measured from the Riyadh
 * calendar day that contains `referenceDate`.
 */
export function getMaxSubscriptionEndDate(
  referenceDate: Date = new Date(),
  maxDays: number = MAX_SUBSCRIPTION_DAYS,
): Date {
  if (!Number.isFinite(referenceDate.getTime())) {
    throw new RangeError("Invalid subscription reference date");
  }
  if (!Number.isFinite(maxDays) || maxDays < 0) {
    throw new RangeError("Invalid maximum subscription duration");
  }

  // Riyadh has no daylight-saving transition. Advancing the Riyadh day by
  // whole 24-hour blocks keeps the business-day boundary deterministic even
  // when the Node process itself runs in another timezone.
  const referenceStart = getStartOfDayRiyadh(referenceDate);
  const maxDay = new Date(
    referenceStart.getTime() + Math.floor(maxDays) * SUBSCRIPTION_MILLISECONDS_PER_DAY,
  );
  const maxDayString = maxDay.toLocaleDateString("en-CA", {
    timeZone: "Asia/Riyadh",
  });
  return new Date(`${maxDayString}T23:59:59.999+03:00`);
}

export function isSubscriptionEndDateWithinMaxDays(
  endDate: Date | string,
  referenceDate: Date = new Date(),
  maxDays: number = MAX_SUBSCRIPTION_DAYS,
): boolean {
  const parsedEndDate = endDate instanceof Date ? endDate : new Date(endDate);
  if (!Number.isFinite(parsedEndDate.getTime())) return false;
  return parsedEndDate.getTime() <= getMaxSubscriptionEndDate(referenceDate, maxDays).getTime();
}

export function capSubscriptionDurationMs(remainingDurationMs: number): number {
  if (!Number.isFinite(remainingDurationMs) || remainingDurationMs < 0) {
    throw new RangeError("Invalid remaining subscription duration");
  }
  return Math.min(remainingDurationMs, MAX_SUBSCRIPTION_DURATION_MS);
}

/**
 * تحديد الحد الأقصى للاشتراك: لا يزيد عن MAX_SUBSCRIPTION_DAYS يوماً من اليوم
 */
export function capAtMaxDays(
  endDate: Date,
  maxDays: number = MAX_SUBSCRIPTION_DAYS,
  referenceDate: Date = new Date(),
): Date {
  if (!Number.isFinite(endDate.getTime())) {
    throw new RangeError("Invalid subscription end date");
  }
  const maxEnd = getMaxSubscriptionEndDate(referenceDate, maxDays);
  return endDate.getTime() > maxEnd.getTime() ? maxEnd : new Date(endDate);
}

/**
 * حساب تاريخ انتهاء الاشتراك بشكل موحد
 * القاعدة: الاشتراك يبدأ من بداية اليوم وينتهي في نهاية اليوم الأخير (23:59:59)
 * مثال: 30 يوم اشتراك = اليوم + 30 يوم كاملة
 * 
 * @param startDate تاريخ البداية (إذا لم يحدد، يبدأ من اليوم)
 * @param durationDays عدد الأيام (مثلاً 30)
 * @returns تاريخ الانتهاء في نهاية اليوم الأخير (محدد بـ MAX_SUBSCRIPTION_DAYS من اليوم)
 */
export function calculateSubscriptionEndDate(startDate: Date | null, durationDays: number): Date {
  // بداية اليوم بتوقيت الرياض
  const start = startDate ? getStartOfDayRiyadh(startDate) : getStartOfDayRiyadh();
  
  // إضافة عدد الأيام (مثلاً 30)
  // القاعدة: يوم البداية يُحسب كيوم كامل
  // مثال: 30 يوم بدءاً من 7 يناير = ينتهي نهاية 5 فبراير
  // لكن لعرض 30 يوم في الواجهة، نضيف durationDays مباشرة
  const endDay = new Date(
    start.getTime() + durationDays * SUBSCRIPTION_MILLISECONDS_PER_DAY,
  );

  // نهاية اليوم الأخير بتوقيت الرياض، بغض النظر عن توقيت الخادم.
  const endDate = getEndOfDayRiyadh(endDay);
  
  return capAtMaxDays(endDate);
}

/**
 * حساب تاريخ انتهاء الاشتراك للتمديد
 * القاعدة: إذا كان الاشتراك الحالي نشط، يضاف من تاريخ انتهائه
 * وإلا يبدأ من اليوم
 * ملاحظة: النتيجة محددة بـ MAX_SUBSCRIPTION_DAYS من اليوم
 */
export function calculateExtensionEndDate(currentEndDate: Date | null, durationDays: number): Date {
  if (currentEndDate) {
    const currentEnd = new Date(currentEndDate);
    // إذا كان الاشتراك الحالي لم ينتهي بعد، نضيف من تاريخ انتهائه
    if (calculateRemainingDays(currentEnd) >= 0) {
      const currentEndDay = getStartOfDayRiyadh(currentEnd);
      const extendedDay = new Date(
        currentEndDay.getTime() + durationDays * SUBSCRIPTION_MILLISECONDS_PER_DAY,
      );
      const newEnd = getEndOfDayRiyadh(extendedDay);
      return capAtMaxDays(newEnd);
    }
  }
  
  // إذا انتهى أو لا يوجد اشتراك، نبدأ من اليوم
  return calculateSubscriptionEndDate(null, durationDays);
}

/**
 * إضافة أشهر إلى تاريخ
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * حساب الفرق بين تاريخين بالأيام
 */
export function daysBetween(date1: Date | string, date2: Date | string): number {
  const d1 = typeof date1 === 'string' ? new Date(date1) : date1;
  const d2 = typeof date2 === 'string' ? new Date(date2) : date2;
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * تحويل الأرقام العربية إلى إنجليزية
 * مثال: "٢٩‏/١٢‏/٢٠٢٥" -> "29/12/2025"
 */
export function arabicToEnglishNumbers(str: string): string {
  if (!str) return str;
  const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let result = str;
  for (let i = 0; i < 10; i++) {
    result = result.replace(new RegExp(arabicNumerals[i], 'g'), String(i));
  }
  // إزالة أي أحرف تحكم غير مرئية
  result = result.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
  return result;
}

/**
 * تحويل تاريخ (قد يكون بالأرقام العربية) إلى كائن Date
 * يدعم الصيغ: "٢٩‏/١٢‏/٢٠٢٥", "29/12/2025", "2025-12-29", ISO string
 */
/**
 * تنسيق التاريخ بالتوقيت السعودي (YYYY-MM-DD)
 * هذه الدالة تضمن أن التاريخ يُحفظ بالتوقيت السعودي وليس UTC
 */
export function formatDateRiyadh(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
}

export function parseArabicDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  
  // تحويل الأرقام العربية إلى إنجليزية
  const cleanStr = arabicToEnglishNumbers(dateStr.trim());
  
  // محاولة تحليل التاريخ مباشرة (ISO format)
  let date = new Date(cleanStr);
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  // محاولة صيغة DD/MM/YYYY
  const ddmmyyyy = cleanStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  
  // محاولة صيغة MM/DD/YYYY (احتياطي)
  const mmddyyyy = cleanStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mmddyyyy) {
    const [, month, day, year] = mmddyyyy;
    date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(date.getTime())) {
      return date;
    }
  }
  
  return null;
}
