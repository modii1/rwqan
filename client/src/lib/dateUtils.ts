/**
 * دوال مساعدة للتعامل مع التواريخ في توقيت GMT+3 (الرياض)
 * جميع التواريخ تُعرض بتوقيت الرياض
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
 * تحويل تاريخ مخزن (UTC) إلى توقيت GMT+3 للعرض
 */
export function toGMT3(dateStr: string): Date {
  const d = new Date(dateStr);
  return new Date(d.getTime() + RIYADH_OFFSET_MS);
}

/**
 * تنسيق التاريخ بتوقيت GMT+3
 * @param dateStr - تاريخ ISO string
 * @param includeTime - هل نعرض الوقت أيضاً
 */
export function formatDateGMT3(dateStr: string, includeTime = false): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  
  const gmt3 = new Date(d.getTime() + RIYADH_OFFSET_MS);
  
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[gmt3.getUTCMonth()];
  const day = gmt3.getUTCDate();
  const year = gmt3.getUTCFullYear();
  
  if (!includeTime) {
    return `${month} ${day}, ${year}`;
  }
  
  let hours = gmt3.getUTCHours();
  const minutes = gmt3.getUTCMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  
  return `${month} ${day} at ${hours}:${minutes} ${ampm}`;
}

/**
 * تنسيق التاريخ للعرض المختصر
 */
export function formatDateShort(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  
  const gmt3 = new Date(d.getTime() + RIYADH_OFFSET_MS);
  
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[gmt3.getUTCMonth()]} ${gmt3.getUTCDate()}`;
}

/**
 * تنسيق الوقت فقط بتوقيت GMT+3
 */
export function formatTimeGMT3(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  
  const gmt3 = new Date(d.getTime() + RIYADH_OFFSET_MS);
  
  let hours = gmt3.getUTCHours();
  const minutes = gmt3.getUTCMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  
  return `${hours}:${minutes} ${ampm}`;
}

/**
 * تنسيق التاريخ الكامل بالإنجليزية
 */
export function formatFullDate(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '-';
  
  const gmt3 = new Date(d.getTime() + RIYADH_OFFSET_MS);
  
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  
  return `${days[gmt3.getUTCDay()]}, ${months[gmt3.getUTCMonth()]} ${gmt3.getUTCDate()}, ${gmt3.getUTCFullYear()}`;
}

/**
 * الحصول على تاريخ اليوم بتنسيق YYYY-MM-DD
 */
export function getTodayGMT3(): string {
  const now = getNowGMT3();
  const year = now.getUTCFullYear();
  const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = now.getUTCDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}
