/**
 * Smart verification system for property data completeness
 */
import { dbProxy } from "../config/dbConfig";

// Sensitive fields that require re-verification
const SENSITIVE_FIELDS = ['location', 'city', 'type', 'imagesLink', 'images'];

export interface PropertyDataCheckResult {
  isComplete: boolean;
  missingFields: string[];
  warnings: string[];
  completionScore: number;
}

export async function checkPropertyDataComplete(property: any): Promise<PropertyDataCheckResult> {
  const missingFields: string[] = [];
  const warnings: string[] = [];
  let score = 0;
  const maxScore = 100;

  // 1. الحقول الأساسية المطلوبة (40 نقطة)
  if (!property.name || property.name.trim() === '') {
    missingFields.push('اسم العقار');
  } else {
    score += 10;
  }

  if (!property.location || property.location.trim() === '') {
    missingFields.push('الموقع');
  } else {
    score += 10;
  }

  if (!property.city || property.city.trim() === '') {
    missingFields.push('المنطقة/المدينة');
  } else {
    score += 10;
  }

  if (!property.type || property.type.trim() === '') {
    missingFields.push('نوع العقار');
  } else {
    score += 10;
  }

  // 2. المرافق (20 نقطة)
  const facilities = property.facilities || [];
  if (!facilities || facilities.length === 0) {
    missingFields.push('المرافق');
  } else {
    score += 20;
  }

  // 3. الصور (30 نقطة) - على الأقل 3 صور
  let imageCount = 0;
  if (property.imagesLink) {
    if (property.images && Array.isArray(property.images)) {
      imageCount = property.images.length;
    } else if (property.localImages && Array.isArray(property.localImages)) {
      imageCount = property.localImages.length;
    } else {
      imageCount = 3;
    }
  }

  if (imageCount < 3) {
    missingFields.push(`الصور (${imageCount}/3 كحد أدنى)`);
  } else {
    score += 30;
  }

  // 4. الأسعار (10 نقاط) - تحذير فقط
  const prices = property.prices || {};
  const hasAnyPrice = prices.weekday || prices.weekend || prices.overnight ||
    property.priceWeekdays || property.priceWeekend || property.priceNight;
  if (!hasAnyPrice) {
    warnings.push('لم يتم تحديد أي سعر');
  } else {
    score += 10;
  }

  if (!property.direction || property.direction.trim() === '') {
    warnings.push('الاتجاه غير محدد');
  }

  return {
    isComplete: missingFields.length === 0,
    missingFields,
    warnings,
    completionScore: Math.round((score / maxScore) * 100)
  };
}

// Smart verification types
export interface SmartVerificationResult {
  verificationStatus: "draft" | "incomplete" | "pending" | "verified" | "approved" | "rejected";
  paymentStatus: "قيد المراجعة" | "قيد التحقق" | "مكتمل" | "مرفوض" | "غير مطلوب";
  subscriptionStatus: "نشط" | "نشط مجاني" | "منتهي" | "غير مفعل";
  aiConfidence: number;
  adminRequired: boolean;
  notes: string[];
  canAutoActivate: boolean;
}

export interface SmartVerificationContext {
  property: any;
  paymentRecord?: any;
  isFirstProperty?: boolean;
  isSensitiveUpdate?: boolean;
  previousVerificationStatus?: string;
  ocrResult?: { confidence: number; matched: boolean };
  secondProperty?: any;
}

export function detectSensitiveChanges(oldProperty: any, newData: any): string[] {
  const changes: string[] = [];
  for (const field of SENSITIVE_FIELDS) {
    const oldValue = oldProperty[field];
    const newValue = newData[field];
    if (newValue !== undefined && JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes.push(field);
    }
  }
  return changes;
}

export async function smartVerification(context: SmartVerificationContext): Promise<SmartVerificationResult> {
  const { property, paymentRecord, ocrResult, secondProperty } = context;
  const notes: string[] = [];
  let adminRequired = false;
  let canAutoActivate = false;

  const dataCheck = await checkPropertyDataComplete(property);
  const subscriptionType = property.subscriptionType || 'عادي';
  const isPremium = subscriptionType === 'مميز' || subscriptionType === 'موثوق';

  let aiConfidence = dataCheck.completionScore;
  if (ocrResult) {
    aiConfidence = Math.round((aiConfidence + ocrResult.confidence) / 2);
  }

  let verificationStatus: SmartVerificationResult['verificationStatus'] = 'pending';
  let paymentStatus: SmartVerificationResult['paymentStatus'] = 'غير مطلوب';
  let subscriptionStatus: SmartVerificationResult['subscriptionStatus'] = 'غير مفعل';

  if (!dataCheck.isComplete) {
    verificationStatus = 'incomplete';
    paymentStatus = 'مرفوض';
    notes.push(`حقول ناقصة: ${dataCheck.missingFields.join('، ')}`);
    canAutoActivate = false;
  } else if (paymentRecord?.paymentMethod === 'bank_transfer' && ocrResult) {
    if (ocrResult.confidence >= 90 && ocrResult.matched) {
      verificationStatus = 'approved';
      paymentStatus = 'مكتمل';
      subscriptionStatus = 'نشط';
      notes.push(`تم التحقق تلقائياً - نسبة الثقة: ${ocrResult.confidence}%`);
      canAutoActivate = true;
    } else {
      verificationStatus = 'rejected';
      paymentStatus = 'مرفوض';
      notes.push(`نسبة الثقة منخفضة: ${ocrResult.confidence}% - تم الرفض`);
      canAutoActivate = false;
    }
  } else if (paymentRecord?.status === 'completed' || paymentRecord?.status === 'مكتمل') {
    if (dataCheck.isComplete) {
      verificationStatus = 'approved';
      paymentStatus = 'مكتمل';
      subscriptionStatus = isPremium ? 'نشط' : 'نشط مجاني';
      notes.push('الدفع مكتمل والبيانات كاملة - تفعيل تلقائي');
      canAutoActivate = true;
    }
  } else if (context.isSensitiveUpdate && context.previousVerificationStatus === 'approved') {
    if (dataCheck.isComplete && dataCheck.completionScore >= 80) {
      verificationStatus = 'verified';
      notes.push('تعديل حساس - تم قبوله تلقائياً لأن البيانات مكتملة');
      canAutoActivate = true;
    } else {
      verificationStatus = 'rejected';
      notes.push('تعديل حساس - البيانات غير مكتملة - تم الرفض');
      canAutoActivate = false;
    }
  } else if (secondProperty) {
    const secondDataCheck = await checkPropertyDataComplete(secondProperty);
    if (dataCheck.isComplete && secondDataCheck.isComplete) {
      verificationStatus = 'approved';
      notes.push('باقة العقارين - كلا العقارين مكتملين - تفعيل تلقائي');
      canAutoActivate = true;
    } else {
      verificationStatus = 'incomplete';
      if (!dataCheck.isComplete) notes.push(`العقار الأول: ${dataCheck.missingFields.join('، ')}`);
      if (!secondDataCheck.isComplete) notes.push(`العقار الثاني: ${secondDataCheck.missingFields.join('، ')}`);
      canAutoActivate = false;
    }
  } else if (dataCheck.isComplete && dataCheck.completionScore === 100) {
    verificationStatus = 'verified';
    notes.push('البيانات مكتملة 100% - جاهز للتفعيل');
    canAutoActivate = true;
  } else {
    verificationStatus = 'rejected';
    notes.push('البيانات غير مكتملة - تم الرفض');
    canAutoActivate = false;
  }

  if (dataCheck.warnings.length > 0) {
    notes.push(`تحذيرات: ${dataCheck.warnings.join('، ')}`);
  }

  return {
    verificationStatus,
    paymentStatus,
    subscriptionStatus,
    aiConfidence,
    adminRequired,
    notes,
    canAutoActivate
  };
}
