/**
 * دوال مساعدة للتعامل مع التواريخ في الواجهة الأمامية
 * 
 * القواعد الحرجة (CRITICAL):
 * - الخادم يرسل epoch milliseconds فقط
 * - لا تحويلات يدوية للتوقيت (+3 / -3)
 * - استخدام toLocaleString مع timeZone: 'Asia/Riyadh' للعرض
 * - الوقت المعروض يجب أن يطابق الساعة في السعودية بالضبط
 */

/**
 * ============================================
 * الدالة الرئيسية - LIVE SAUDI TIME
 * ============================================
 * استخدم هذه الدالة في كل مكان لعرض الوقت الحي
 */
export function formatLiveSaudiTime(ms: number | string | Date): string {
  if (!ms) return '-';
  
  const timestamp = typeof ms === 'number' ? ms : new Date(ms).getTime();
  if (isNaN(timestamp)) return '-';
  
  return new Date(timestamp).toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

/**
 * عرض التاريخ فقط بتوقيت السعودية
 */
export function formatLiveSaudiDate(ms: number | string | Date): string {
  if (!ms) return '-';
  
  const timestamp = typeof ms === 'number' ? ms : new Date(ms).getTime();
  if (isNaN(timestamp)) return '-';
  
  return new Date(timestamp).toLocaleDateString("ar-SA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

/**
 * عرض الوقت فقط بتوقيت السعودية
 */
export function formatLiveSaudiTimeOnly(ms: number | string | Date): string {
  if (!ms) return '-';
  
  const timestamp = typeof ms === 'number' ? ms : new Date(ms).getTime();
  if (isNaN(timestamp)) return '-';
  
  return new Date(timestamp).toLocaleTimeString("ar-SA", {
    timeZone: "Asia/Riyadh",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

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
 * تنسيق التاريخ للطلبات - بدون timezone لأن البيانات محفوظة بتوقيت الرياض أصلاً
 */
export function formatRequestDate(dateInput: string | number | Date, includeTime = false): string {
  if (!dateInput) return '-';
  
  const d = typeof dateInput === 'number' ? new Date(dateInput) : new Date(dateInput);
  if (isNaN(d.getTime())) return '-';
  
  if (!includeTime) {
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }
  
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
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
