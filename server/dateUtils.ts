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
  return d.toLocaleDateString('ar-SA', {
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
  return d.toLocaleString('ar-SA', {
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
