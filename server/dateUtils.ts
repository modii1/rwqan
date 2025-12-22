/**
 * دوال مساعدة للتعامل مع التواريخ في توقيت الرياض (GMT+3)
 * جميع التواريخ تُخزن وتُعرض بتوقيت الرياض
 */

const RIYADH_OFFSET_HOURS = 3;
const RIYADH_OFFSET_MS = RIYADH_OFFSET_HOURS * 60 * 60 * 1000;

/**
 * الحصول على التاريخ والوقت الحالي بتوقيت GMT+3 (الرياض)
 */
export function getNowGMT3(): Date {
  const now = new Date();
  return new Date(now.getTime() + now.getTimezoneOffset() * 60000 + RIYADH_OFFSET_MS);
}

/**
 * Alias للتوافق مع الكود القديم
 */
export function getNowInRiyadh(): Date {
  return getNowGMT3();
}

/**
 * تحويل تاريخ إلى ISO string بتوقيت GMT+3
 */
export function toGMT3ISO(date?: Date): string {
  const d = date || getNowGMT3();
  return d.toISOString();
}

/**
 * Alias للتوافق مع الكود القديم
 */
export function toRiyadhISO(date?: Date): string {
  return toGMT3ISO(date);
}

/**
 * الحصول على تاريخ اليوم بتنسيق YYYY-MM-DD بتوقيت GMT+3
 */
export function getTodayDateGMT3(): string {
  const now = getNowGMT3();
  return now.toISOString().split('T')[0];
}

/**
 * الحصول على الوقت الحالي بتنسيق HH:MM AM/PM بتوقيت GMT+3
 */
export function getCurrentTimeGMT3(): string {
  const now = getNowGMT3();
  let hours = now.getUTCHours();
  const minutes = now.getUTCMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${hours}:${minutes} ${ampm}`;
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
