/**
 * 📅 دوال مساعدة لنظام الاشتراكات
 * - معالجة التواريخ من Google Sheets
 * - حساب الأيام المتبقية
 * - تحديد حالة الاشتراك
 */

/**
 * تحويل تاريخ من أي صيغة إلى Date object آمن
 * لا تُنتج Invalid Date أو NaN
 */
export function parseDate(dateInput: any): Date | null {
  if (!dateInput) return null;
  
  // إذا كان Date object
  if (dateInput instanceof Date) {
    return isNaN(dateInput.getTime()) ? null : dateInput;
  }
  
  // إذا كان رقم (timestamp)
  if (typeof dateInput === 'number') {
    const date = new Date(dateInput);
    return isNaN(date.getTime()) ? null : date;
  }
  
  // إذا كان string
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (!trimmed) return null;
    
    // محاولات مختلفة للتحويل
    const formats = [
      trimmed, // YYYY-MM-DD أو ISO
      trimmed.replace(/\//g, '-'), // YYYY/MM/DD → YYYY-MM-DD
      trimmed.split('T')[0], // إزالة الوقت إذا موجود
    ];
    
    for (const format of formats) {
      const date = new Date(format);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }
  }
  
  return null;
}

/**
 * تصفير الوقت للساعة 00:00:00
 */
export function resetToMidnight(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * حساب الأيام المتبقية من تاريخ الانتهاء
 * القاعدة: الاشتراك يبقى فعال طوال يوم الانتهاء (حتى 23:59:59)
 * - إذا اليوم = تاريخ الانتهاء ← 0 (اليوم الأخير، لكن الاشتراك فعال)
 * - إذا تاريخ الانتهاء > اليوم ← عدد الأيام المتبقية
 * - إذا تاريخ الانتهاء < اليوم ← -1 (منتهي)
 */
export function calculateRemainingDays(endDate: any): number {
  const end = parseDate(endDate);
  if (!end) return -1;
  
  const today = resetToMidnight(new Date());
  const endMidnight = resetToMidnight(end);
  
  const diffTime = endMidnight.getTime() - today.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  // إذا كان الفرق سالب ← الاشتراك منتهي
  // إذا = 0 ← اليوم الأخير (الاشتراك فعال)
  // إذا > 0 ← الأيام المتبقية
  return diffDays;
}

/**
 * التحقق من انتهاء الاشتراك
 * الاشتراك يعتبر منتهي فقط إذا كان تاريخ الانتهاء قبل اليوم
 */
export function isSubscriptionExpired(endDate: any): boolean {
  return calculateRemainingDays(endDate) < 0;
}

/**
 * التحقق إذا كان اليوم هو اليوم الأخير
 */
export function isLastDay(endDate: any): boolean {
  return calculateRemainingDays(endDate) === 0;
}

/**
 * حساب مدة الاشتراك (من البداية للنهاية)
 */
export function calculateSubscriptionDuration(startDate: any, endDate: any): number {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  
  if (!start || !end) return 0;
  
  const diffTime = end.getTime() - start.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return Math.max(0, diffDays);
}

/**
 * حالات الاشتراك المدعومة
 */
export type SubscriptionStatus = 
  | 'active'      // مفعل - الاشتراك نشط
  | 'expiring'    // ينتهي قريباً - ≤ 5 أيام
  | 'expired'     // منتهي - الأيام = 0
  | 'cancelled'   // موقوف - ألغاه الإدارة
  | 'pending';    // قيد المراجعة - في انتظار التحقق

/**
 * تحديد حالة الاشتراك بناءً على الأيام المتبقية والحالة المخزنة
 * القاعدة: الاشتراك يبقى فعال طوال يوم الانتهاء
 */
export function getSubscriptionStatus(
  endDate: any, 
  storedStatus?: string
): SubscriptionStatus {
  // إذا كانت الحالة موقوف أو قيد المراجعة، نرجعها مباشرة
  if (storedStatus === 'موقوف' || storedStatus === 'cancelled') return 'cancelled';
  if (storedStatus === 'قيد المراجعة' || storedStatus === 'معلق' || storedStatus === 'pending') return 'pending';
  
  const remainingDays = calculateRemainingDays(endDate);
  
  // الاشتراك منتهي فقط إذا كان تاريخ الانتهاء قبل اليوم (سالب)
  if (remainingDays < 0) return 'expired';
  // اليوم الأخير أو باقي 5 أيام أو أقل ← ينتهي قريباً
  if (remainingDays <= 5) return 'expiring';
  return 'active';
}

/**
 * معلومات حالة الاشتراك للعرض
 */
export interface StatusInfo {
  status: SubscriptionStatus;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: string;
}

/**
 * الحصول على معلومات العرض لحالة الاشتراك
 */
export function getStatusInfo(status: SubscriptionStatus): StatusInfo {
  const statusMap: Record<SubscriptionStatus, StatusInfo> = {
    active: {
      status: 'active',
      label: 'مفعل',
      color: 'text-green-600',
      bgColor: 'bg-green-500',
      borderColor: 'border-green-500',
      icon: '✓',
    },
    expiring: {
      status: 'expiring',
      label: 'ينتهي قريباً',
      color: 'text-orange-600',
      bgColor: 'bg-orange-500',
      borderColor: 'border-orange-500',
      icon: '⚠',
    },
    expired: {
      status: 'expired',
      label: 'منتهي',
      color: 'text-red-600',
      bgColor: 'bg-red-500',
      borderColor: 'border-red-500',
      icon: '✗',
    },
    cancelled: {
      status: 'cancelled',
      label: 'موقوف',
      color: 'text-gray-600',
      bgColor: 'bg-gray-500',
      borderColor: 'border-gray-500',
      icon: '⊘',
    },
    pending: {
      status: 'pending',
      label: 'قيد المراجعة',
      color: 'text-blue-600',
      bgColor: 'bg-blue-500',
      borderColor: 'border-blue-500',
      icon: '⏳',
    },
  };
  
  return statusMap[status];
}

/**
 * هل يمكن التمديد؟
 * القاعدة: فقط إذا الأيام المتبقية ≤ 10
 */
export function canExtendSubscription(endDate: any, status?: SubscriptionStatus): boolean {
  const effectiveStatus = status || getSubscriptionStatus(endDate);
  if (effectiveStatus === 'cancelled' || effectiveStatus === 'pending') return false;
  
  const remainingDays = calculateRemainingDays(endDate);
  return remainingDays <= 10;
}

/**
 * هل يمكن الترقية؟
 * القاعدة: فقط إذا الاشتراك نشط (غير موقوف أو قيد المراجعة)
 */
export function canUpgradeSubscription(status: SubscriptionStatus): boolean {
  return status !== 'cancelled' && status !== 'pending';
}

/**
 * تنسيق التاريخ للعرض
 * الصيغة: 2025/12/17
 */
export function formatDate(dateInput: any): string {
  const date = parseDate(dateInput);
  if (!date) return 'غير محدد';
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${year}/${month}/${day}`;
}

/**
 * حساب تاريخ الانتهاء الجديد للتمديد
 * القاعدة: الأيام الجديدة تُضاف إلى تاريخ الانتهاء الحالي
 */
export function calculateExtendedEndDate(currentEndDate: any, daysToAdd: number): Date {
  const end = parseDate(currentEndDate) || new Date();
  const result = new Date(end);
  
  // إذا كان الاشتراك منتهي، نبدأ من اليوم
  const today = resetToMidnight(new Date());
  if (end < today) {
    result.setTime(today.getTime());
  }
  
  result.setDate(result.getDate() + daysToAdd);
  return result;
}

/**
 * حساب تاريخ الانتهاء الجديد للترقية
 * القاعدة: يبدأ من اليوم (تصفير العداد)
 */
export function calculateUpgradedEndDate(daysToAdd: number): Date {
  const today = resetToMidnight(new Date());
  today.setDate(today.getDate() + daysToAdd);
  return today;
}
