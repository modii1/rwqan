/**
 * دوال مساعدة للتعامل مع التواريخ في الواجهة الأمامية
 * 
 * القواعد:
 * - لا تحويلات يدوية للتوقيت
 * - استخدام toLocaleString مع timeZone: 'Asia/Riyadh' للعرض
 * - التواريخ تأتي من الخادم كـ epoch milliseconds أو ISO string
 */

/**
 * تنسيق التاريخ للعرض بتوقيت الرياض
 */
export function formatDate(dateInput: string | number | Date, includeTime = false): string {
  if (!dateInput) return '-';
  
  const d = typeof dateInput === 'number' ? new Date(dateInput) : new Date(dateInput);
  if (isNaN(d.getTime())) return '-';
  
  if (!includeTime) {
    return d.toLocaleDateString('en-US', {
      timeZone: 'Asia/Riyadh',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }
  
  return d.toLocaleString('en-US', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * تنسيق التاريخ بتوقيت الرياض (Alias للتوافق)
 */
export function formatDateGMT3(dateStr: string, includeTime = false): string {
  return formatDate(dateStr, includeTime);
}

/**
 * تنسيق التاريخ للعرض المختصر
 */
export function formatDateShort(dateInput: string | number | Date): string {
  if (!dateInput) return '-';
  
  const d = typeof dateInput === 'number' ? new Date(dateInput) : new Date(dateInput);
  if (isNaN(d.getTime())) return '-';
  
  return d.toLocaleDateString('en-US', {
    timeZone: 'Asia/Riyadh',
    month: 'short',
    day: 'numeric'
  });
}

/**
 * تنسيق الوقت فقط بتوقيت الرياض
 */
export function formatTime(dateInput: string | number | Date): string {
  if (!dateInput) return '-';
  
  const d = typeof dateInput === 'number' ? new Date(dateInput) : new Date(dateInput);
  if (isNaN(d.getTime())) return '-';
  
  return d.toLocaleTimeString('en-US', {
    timeZone: 'Asia/Riyadh',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * تنسيق الوقت بتوقيت الرياض (Alias للتوافق)
 */
export function formatTimeGMT3(dateStr: string): string {
  return formatTime(dateStr);
}

/**
 * تنسيق التاريخ الكامل بالإنجليزية
 */
export function formatFullDate(dateInput: string | number | Date): string {
  if (!dateInput) return '-';
  
  const d = typeof dateInput === 'number' ? new Date(dateInput) : new Date(dateInput);
  if (isNaN(d.getTime())) return '-';
  
  return d.toLocaleDateString('en-US', {
    timeZone: 'Asia/Riyadh',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * تنسيق التاريخ والوقت الكامل
 */
export function formatDateTime(dateInput: string | number | Date): string {
  if (!dateInput) return '-';
  
  const d = typeof dateInput === 'number' ? new Date(dateInput) : new Date(dateInput);
  if (isNaN(d.getTime())) return '-';
  
  return d.toLocaleString('en-US', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * تنسيق التاريخ بالعربية
 */
export function formatArabicDate(dateInput: string | number | Date): string {
  if (!dateInput) return '-';
  
  const d = typeof dateInput === 'number' ? new Date(dateInput) : new Date(dateInput);
  if (isNaN(d.getTime())) return '-';
  
  return d.toLocaleDateString('ar-SA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * تنسيق التاريخ والوقت بالعربية
 */
export function formatArabicDateTime(dateInput: string | number | Date): string {
  if (!dateInput) return '-';
  
  const d = typeof dateInput === 'number' ? new Date(dateInput) : new Date(dateInput);
  if (isNaN(d.getTime())) return '-';
  
  return d.toLocaleString('ar-SA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * الحصول على الوقت الحالي بتوقيت الرياض
 */
export function getNowGMT3(): Date {
  return new Date();
}

/**
 * تحويل تاريخ للعرض (Alias للتوافق)
 */
export function toGMT3(dateStr: string): Date {
  return new Date(dateStr);
}

/**
 * الحصول على تاريخ اليوم بتنسيق YYYY-MM-DD (بتوقيت الرياض)
 */
export function getTodayGMT3(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
}
