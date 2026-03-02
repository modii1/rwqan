/**
 * نظام البحث الذكي للنص العربي
 * Smart Arabic Text Search System
 * 
 * يدعم:
 * - تطبيع كامل للنص العربي
 * - بحث شامل في جميع الحقول
 * - ترتيب النتائج بالأقرب أولاً
 */

/**
 * تطبيع النص العربي - إزالة التشكيل وتوحيد الأحرف
 * @param text النص المراد تطبيعه
 * @returns النص المطبع
 */
export function normalizeArabicText(text: string | null | undefined): string {
  if (!text) return "";
  
  return text
    .toString()
    .toLowerCase()
    .trim()
    // إزالة التشكيل العربي بالكامل (الفتحة، الضمة، الكسرة، السكون، الشدة، التنوين)
    .replace(/[\u064B-\u0652\u0670\u06D6-\u06ED]/g, "")
    // إزالة التشكيل اللاتيني
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // إزالة المد (التطويل)
    .replace(/\u0640/g, "")
    // توحيد جميع أشكال الألف إلى ألف بسيطة
    .replace(/[إأٱآ]/g, "ا")
    // توحيد الياء المقصورة إلى ياء
    .replace(/ى/g, "ي")
    // تحويل الهمزة على واو إلى واو
    .replace(/ؤ/g, "و")
    // تحويل الهمزة على ياء إلى ي
    .replace(/ئ/g, "ي")
    // إزالة الهمزة المنفردة
    .replace(/ء/g, "")
    // توحيد التاء المربوطة إلى هاء
    .replace(/ة/g, "ه")
    // إزالة المسافات الزائدة
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * حساب درجة التطابق بين نص البحث وقيمة الحقل
 * @param searchTerm نص البحث المطبع
 * @param fieldValue قيمة الحقل المطبعة
 * @param fieldWeight وزن الحقل (1-10)
 * @returns درجة التطابق (0 = لا تطابق)
 */
export function calculateMatchScore(
  searchTerm: string,
  fieldValue: string,
  fieldWeight: number = 1
): number {
  if (!searchTerm || !fieldValue) return 0;
  
  const normalizedSearch = normalizeArabicText(searchTerm);
  const normalizedField = normalizeArabicText(fieldValue);
  
  if (!normalizedSearch || !normalizedField) return 0;
  
  // تطابق كامل
  if (normalizedField === normalizedSearch) {
    return 100 * fieldWeight;
  }
  
  // الحقل يبدأ بنص البحث
  if (normalizedField.startsWith(normalizedSearch)) {
    return 80 * fieldWeight;
  }
  
  // نص البحث موجود كلمة كاملة
  const words = normalizedField.split(" ");
  if (words.some(word => word === normalizedSearch)) {
    return 70 * fieldWeight;
  }
  
  // كلمة تبدأ بنص البحث
  if (words.some(word => word.startsWith(normalizedSearch))) {
    return 60 * fieldWeight;
  }
  
  // الحقل يحتوي على نص البحث
  if (normalizedField.includes(normalizedSearch)) {
    return 50 * fieldWeight;
  }
  
  // البحث بكل كلمة من نص البحث
  const searchWords = normalizedSearch.split(" ").filter(w => w.length > 0);
  if (searchWords.length > 1) {
    let matchedWords = 0;
    for (const word of searchWords) {
      if (normalizedField.includes(word)) {
        matchedWords++;
      }
    }
    if (matchedWords > 0) {
      return (matchedWords / searchWords.length) * 40 * fieldWeight;
    }
  }
  
  return 0;
}

/**
 * واجهة نتيجة البحث
 */
export interface SearchResult<T> {
  item: T;
  score: number;
  matchedFields: string[];
}

/**
 * تعريف حقل قابل للبحث
 */
export interface SearchableField<T> {
  name: string;
  getValue: (item: T) => string | string[] | null | undefined;
  weight: number;
}

/**
 * البحث الذكي الشامل
 * @param items العناصر للبحث فيها
 * @param searchTerm نص البحث
 * @param fields الحقول القابلة للبحث
 * @returns النتائج مرتبة بالأقرب أولاً
 */
export function smartSearch<T>(
  items: T[],
  searchTerm: string,
  fields: SearchableField<T>[]
): SearchResult<T>[] {
  const normalizedSearch = normalizeArabicText(searchTerm);
  
  // إذا كان البحث فارغاً، أعد كل العناصر بدون ترتيب
  if (!normalizedSearch) {
    return items.map(item => ({
      item,
      score: 0,
      matchedFields: []
    }));
  }
  
  const results: SearchResult<T>[] = [];
  
  for (const item of items) {
    let totalScore = 0;
    const matchedFields: string[] = [];
    
    for (const field of fields) {
      const value = field.getValue(item);
      
      if (value === null || value === undefined) continue;
      
      // إذا كانت القيمة مصفوفة (مثل المرافق)
      if (Array.isArray(value)) {
        let fieldScore = 0;
        for (const v of value) {
          const score = calculateMatchScore(normalizedSearch, v, field.weight);
          if (score > fieldScore) {
            fieldScore = score;
          }
        }
        if (fieldScore > 0) {
          totalScore += fieldScore;
          matchedFields.push(field.name);
        }
      } else {
        const score = calculateMatchScore(normalizedSearch, value, field.weight);
        if (score > 0) {
          totalScore += score;
          matchedFields.push(field.name);
        }
      }
    }
    
    if (totalScore > 0) {
      results.push({
        item,
        score: totalScore,
        matchedFields
      });
    }
  }
  
  // ترتيب بالدرجة الأعلى أولاً
  results.sort((a, b) => b.score - a.score);
  
  return results;
}

/**
 * المناطق المدعومة في النظام
 */
export const SUPPORTED_REGIONS = [
  "القصيم",
  "الرياض",
  "مكة المكرمة",
  "المدينة المنورة",
  "الشرقية",
  "عسير",
  "تبوك",
  "حائل",
  "الحدود الشمالية",
  "جازان",
  "نجران",
  "الباحة",
  "الجوف",
  "البدائع",
];

/**
 * المدن المدعومة في منطقة القصيم
 */
export const QASSIM_CITIES = [
  "بريدة",
  "عنيزة",
  "الرس",
  "البكيرية",
  "المذنب",
  "البدائع",
  "الأسياح",
  "رياض الخبراء",
  "عيون الجواء",
  "الشماسية",
  "عقلة الصقور",
  "ضرية",
  "النبهانية",
];
