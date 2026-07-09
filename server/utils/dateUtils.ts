/**
 * دوال مساعدة للتعامل مع التواريخ
 * 
 * القواعد:
 * - الخادم يعمل بتوقيت UTC
 * - جميع التواريخ تُخزن كـ epoch milliseconds
 * - لا تحويلات يدوية للتوقيت
 */

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

const MAX_SUBSCRIPTION_DAYS = 40;

/**
 * تحديد الحد الأقصى للاشتراك: لا يزيد عن MAX_SUBSCRIPTION_DAYS يوماً من اليوم
 */
export function capAtMaxDays(endDate: Date, maxDays: number = MAX_SUBSCRIPTION_DAYS): Date {
  const today = getStartOfDayRiyadh();
  const maxEnd = new Date(today);
  maxEnd.setDate(maxEnd.getDate() + maxDays);
  maxEnd.setHours(23, 59, 59, 999);
  return endDate > maxEnd ? maxEnd : endDate;
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
  const endDate = new Date(start);
  endDate.setDate(endDate.getDate() + durationDays);
  
  // نهاية اليوم الأخير
  endDate.setHours(23, 59, 59, 999);
  
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
      const newEnd = new Date(currentEnd);
      newEnd.setDate(newEnd.getDate() + durationDays);
      newEnd.setHours(23, 59, 59, 999);
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
