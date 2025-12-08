/**
 * دوال مساعدة للتعامل مع التواريخ في توقيت الرياض (UTC+3)
 */

const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3 بالميلي ثانية

/**
 * الحصول على التاريخ والوقت الحالي في الرياض
 */
export function getNowInRiyadh(): Date {
  const now = new Date();
  const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utcTime + RIYADH_OFFSET_MS);
}

/**
 * تحويل تاريخ إلى ISO string بتوقيت الرياض
 */
export function toRiyadhISO(date?: Date): string {
  const d = date || getNowInRiyadh();
  return d.toISOString();
}

/**
 * تحويل تاريخ إلى نص مقروء بالعربية
 */
export function formatArabicDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const riyadhDate = new Date(d.getTime() + RIYADH_OFFSET_MS);
  
  return riyadhDate.toLocaleDateString('ar-SA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Riyadh'
  });
}

/**
 * تحويل تاريخ إلى نص مقروب بالعربية مع الوقت
 */
export function formatArabicDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const riyadhDate = new Date(d.getTime() + RIYADH_OFFSET_MS);
  
  return riyadhDate.toLocaleString('ar-SA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Riyadh'
  });
}

/**
 * الحصول على بداية اليوم في الرياض
 */
export function getStartOfDayRiyadh(date?: Date): Date {
  const d = date || getNowInRiyadh();
  const riyadhDate = new Date(d.getTime() + RIYADH_OFFSET_MS);
  riyadhDate.setHours(0, 0, 0, 0);
  return riyadhDate;
}

/**
 * الحصول على نهاية اليوم في الرياض
 */
export function getEndOfDayRiyadh(date?: Date): Date {
  const d = date || getNowInRiyadh();
  const riyadhDate = new Date(d.getTime() + RIYADH_OFFSET_MS);
  riyadhDate.setHours(23, 59, 59, 999);
  return riyadhDate;
}

/**
 * الحصول على بداية الشهر في الرياض
 */
export function getStartOfMonthRiyadh(date?: Date): Date {
  const d = date || getNowInRiyadh();
  const riyadhDate = new Date(d.getTime() + RIYADH_OFFSET_MS);
  riyadhDate.setDate(1);
  riyadhDate.setHours(0, 0, 0, 0);
  return riyadhDate;
}

/**
 * الحصول على نهاية الشهر في الرياض
 */
export function getEndOfMonthRiyadh(date?: Date): Date {
  const d = date || getNowInRiyadh();
  const riyadhDate = new Date(d.getTime() + RIYADH_OFFSET_MS);
  riyadhDate.setMonth(riyadhDate.getMonth() + 1, 0);
  riyadhDate.setHours(23, 59, 59, 999);
  return riyadhDate;
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
