// نظام التحقق الذكي من البيانات

// تنظيف رقم الجوال - إزالة كل شيء عدا الأرقام
export function cleanPhoneNumber(value: string): string {
  // إزالة جميع الأحرف والرموز والمسافات - فقط الأرقام
  return value.replace(/[^\d]/g, '');
}

// تنظيف رقم العقار - 5 أرقام فقط
export function cleanPropertyNumber(value: string): string {
  // إزالة كل شيء عدا الأرقام
  const numbersOnly = value.replace(/[^\d]/g, '');
  // الحد الأقصى 5 أرقام
  return numbersOnly.slice(0, 5);
}

// التحقق من صحة رقم الجوال السعودي
export function validatePhoneNumber(value: string): { valid: boolean; error?: string; cleaned: string } {
  const cleaned = cleanPhoneNumber(value);
  
  if (cleaned.length === 0) {
    return { valid: false, error: 'رقم الجوال مطلوب', cleaned };
  }
  
  // يجب أن يبدأ بـ 05 أو 5
  if (!cleaned.startsWith('05') && !cleaned.startsWith('5')) {
    return { valid: false, error: 'رقم الجوال يجب أن يبدأ بـ 05', cleaned };
  }
  
  // إذا بدأ بـ 5 فقط، نضيف 0 في البداية
  const normalized = cleaned.startsWith('5') && !cleaned.startsWith('05') 
    ? '0' + cleaned 
    : cleaned;
  
  // يجب أن يكون 10 أرقام
  if (normalized.length !== 10) {
    return { valid: false, error: 'رقم الجوال يجب أن يكون 10 أرقام', cleaned: normalized };
  }
  
  return { valid: true, cleaned: normalized };
}

// التحقق من صحة رقم العقار
export function validatePropertyNumber(value: string): { valid: boolean; error?: string; cleaned: string } {
  const cleaned = cleanPropertyNumber(value);
  
  if (cleaned.length === 0) {
    return { valid: false, error: 'رقم العقار مطلوب', cleaned };
  }
  
  if (cleaned.length !== 5) {
    return { valid: false, error: 'رقم العقار يجب أن يكون 5 أرقام بالضبط', cleaned };
  }
  
  return { valid: true, cleaned };
}

// التحقق من صحة الرقم السري (PIN)
export function validatePin(value: string): { valid: boolean; error?: string; cleaned: string } {
  const cleaned = value.replace(/[^\d]/g, '');
  
  if (cleaned.length === 0) {
    return { valid: false, error: 'الرقم السري مطلوب', cleaned };
  }
  
  if (cleaned.length < 4) {
    return { valid: false, error: 'الرقم السري يجب أن يكون 4 أرقام على الأقل', cleaned };
  }
  
  return { valid: true, cleaned };
}

// التحقق من صحة السعر
export function validatePrice(value: string): { valid: boolean; cleaned: string } {
  const cleaned = value.replace(/[^\d.]/g, '');
  return { valid: true, cleaned };
}

// التحقق من صحة الاسم - بدون أرقام أو رموز خاصة
export function cleanName(value: string): string {
  // السماح بالحروف العربية والإنجليزية والمسافات فقط
  return value.replace(/[^\u0600-\u06FF\u0750-\u077Fa-zA-Z\s]/g, '').trim();
}
