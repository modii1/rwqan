// نظام التحقق الذكي من البيانات

// تنظيف رقم الجوال - يجب أن يبدأ بـ 5 فقط (بدون صفر في البداية)
export function cleanPhoneNumber(value: string): string {
  // إزالة جميع الأحرف والرموز والمسافات - فقط الأرقام
  const numbersOnly = value.replace(/[^\d]/g, '');
  
  // إذا كان فارغاً، نرجع فارغ
  if (numbersOnly.length === 0) return '';
  
  // يجب أن يبدأ بـ 5 فقط (أرقام الجوال السعودية بدون 0)
  if (numbersOnly[0] !== '5') {
    return '';
  }
  
  // الحد الأقصى 9 أرقام (5XXXXXXXX)
  return numbersOnly.slice(0, 9);
}

// تنظيف رقم العقار - 5 أرقام فقط
export function cleanPropertyNumber(value: string): string {
  // إزالة كل شيء عدا الأرقام
  const numbersOnly = value.replace(/[^\d]/g, '');
  // الحد الأقصى 5 أرقام
  return numbersOnly.slice(0, 5);
}

// التحقق من صحة رقم الجوال السعودي (صيغة 5XXXXXXXX - 9 أرقام)
export function validatePhoneNumber(value: string): { valid: boolean; error?: string; cleaned: string } {
  const cleaned = cleanPhoneNumber(value);
  
  if (cleaned.length === 0) {
    return { valid: false, error: 'رقم الجوال مطلوب', cleaned };
  }
  
  // يجب أن يبدأ بـ 5
  if (!cleaned.startsWith('5')) {
    return { valid: false, error: 'رقم الجوال يجب أن يبدأ بـ 5', cleaned };
  }
  
  // يجب أن يكون 9 أرقام بالضبط (5XXXXXXXX)
  if (cleaned.length !== 9) {
    return { valid: false, error: 'رقم الجوال يجب أن يكون 9 أرقام (مثال: 5XXXXXXXX)', cleaned };
  }
  
  return { valid: true, cleaned };
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

// ═══════════════════════════════════════════════════════════════
// طبقة التحقق الصارم من المدخلات (للإستخدام في onChange)
// ═══════════════════════════════════════════════════════════════

// التحقق من المدخلات النصية (姓名، الموقع) -不允许 أرقام
export function validateTextInput(value: string): string {
  return value.replace(/[0-9]/g, '');
}

// التحقق من المدخلات الرقمية (رقم العقار، الرقم السري، الأسعار) -不允许 نص
export function validateNumericInput(value: string): string {
  return value.replace(/[^\d]/g, '');
}

// التحقق من رقم الواتساب مع رسالة خطأ تفصيلية
export function validateWhatsAppInput(value: string): { 
  cleaned: string; 
  error?: string; 
  isValid: boolean;
} {
  // إزالة جميع الأحرف والرموز والمسافات
  const numbersOnly = value.replace(/[^\d]/g, '');
  
  // إذا كان فارغاً
  if (numbersOnly.length === 0) {
    return { cleaned: '', isValid: false };
  }
  
  // يجب أن يبدأ بـ 5
  if (numbersOnly[0] !== '5') {
    return {
      cleaned: '',
      error: 'يجب أن يبدأ بـ 5',
      isValid: false
    };
  }

  // إذا كان أقل من 9 أرقام - نظهر تحذير
  if (numbersOnly.length < 9) {
    return { 
      cleaned: numbersOnly.slice(0, 9), 
      error: `رقم غير مكتمل (${numbersOnly.length}/9 أرقام)`,
      isValid: false 
    };
  }
  
  // إذا كان أكثر من 9 - نقطع إلى 9
  const cleaned = numbersOnly.slice(0, 9);
  
  return { cleaned, isValid: true };
}

// التحقق من رقم العقار (5 أرقام بالضبط)
export function validatePropertyNumberInput(value: string): { 
  cleaned: string; 
  error?: string;
  isValid: boolean;
} {
  const numbersOnly = value.replace(/[^\d]/g, '').slice(0, 5);
  
  if (numbersOnly.length === 0) {
    return { cleaned: '', isValid: false };
  }
  
  if (numbersOnly.length < 5) {
    return { 
      cleaned: numbersOnly, 
      error: `رقم العقار ناقص (${numbersOnly.length}/5)`,
      isValid: false 
    };
  }
  
  return { cleaned: numbersOnly, isValid: true };
}

// التحقق من الرقم السري (PIN)
export function validatePinInput(value: string): { 
  cleaned: string; 
  error?: string;
  isValid: boolean;
} {
  const numbersOnly = value.replace(/[^\d]/g, '');
  
  if (numbersOnly.length === 0) {
    return { cleaned: '', isValid: false };
  }
  
  if (numbersOnly.length < 4) {
    return { 
      cleaned: numbersOnly, 
      error: `رقم سري ناقص (${numbersOnly.length}/4 على الأقل)`,
      isValid: false 
    };
  }
  
  return { cleaned: numbersOnly, isValid: true };
}
