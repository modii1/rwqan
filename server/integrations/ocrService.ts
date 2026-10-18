/**
 * 🔍 OCR Service - استخراج البيانات من صور الإيصالات
 * 
 * هذا الملف يحتوي على خدمة OCR لاستخراج البيانات من صور الإيصالات البنكية
 * يستخدم Google Vision API
 */

import { google } from 'googleapis';
import { firebaseService } from "../firebaseService";
import { OcrResult } from "../../shared/schema";

/**
 * استخراج البيانات من صورة الإيصال
 * يحاول استخراج: المبلغ، التاريخ، IBAN، المرجع
 */
export async function extractReceiptData(
  imageUrl: string,
  paymentId: string
): Promise<OcrResult | null> {
  try {
    // OCR always runs now
    // const ocrEnabled = await firebaseService.getFeatureFlag("FEATURE_OCR_ENABLED");
    // if (!ocrEnabled) {
    //   console.log("📷 [OCR] الميزة غير مفعلة");
    //   return null;
    // }

    console.log(`📷 [OCR] محاولة استخراج البيانات من: ${imageUrl}`);

    // جلب الصورة
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.error("📷 [OCR] فشل في جلب الصورة");
      return null;
    }

    const imageBuffer = await response.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString("base64");

    // محاولة استخراج النص باستخدام Tesseract.js أو Google Vision
    const extractedText = await performOCR(base64Image);
    
    if (!extractedText) {
      console.log("📷 [OCR] لم يتم استخراج أي نص");
      return null;
    }

    // تحليل النص المستخرج
    const result = parseReceiptText(extractedText, paymentId);

    // حفظ النتيجة في Google Sheets
    if (result) {
      await firebaseService.saveOcrResult(result);
      console.log(`📷 [OCR] تم حفظ نتيجة OCR للدفع: ${paymentId}`);
    }

    return result;
  } catch (error) {
    console.error("📷 [OCR] خطأ في استخراج البيانات:", error);
    return null;
  }
}

/**
 * الحصول على عميل Google Vision API
 */
async function getVisionClient() {
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  
  if (!serviceAccountKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY غير موجود');
  }

  let credentials;
  try {
    credentials = JSON.parse(serviceAccountKey);
  } catch (error) {
    throw new Error('صيغة GOOGLE_SERVICE_ACCOUNT_KEY غير صالحة');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/cloud-vision'],
  });

  return google.vision({ version: 'v1', auth });
}

/**
 * تنفيذ OCR على الصورة
 * يستخدم Google Vision API
 */
async function performOCR(base64Image: string): Promise<string | null> {
  try {
    // محاولة استخدام Google Vision API
    console.log("📷 [OCR] جاري استخدام Google Vision API...");
    
    const vision = await getVisionClient();
    
    const response = await vision.images.annotate({
      requestBody: {
        requests: [
          {
            image: {
              content: base64Image,
            },
            features: [
              {
                type: 'TEXT_DETECTION',
                maxResults: 1,
              },
            ],
            imageContext: {
              languageHints: ['ar', 'en'],
            },
          },
        ],
      },
    });

    const annotations = response.data.responses?.[0]?.textAnnotations;
    
    if (annotations && annotations.length > 0) {
      const extractedText = annotations[0].description || '';
      console.log(`📷 [OCR] تم استخراج ${extractedText.length} حرف`);
      return extractedText;
    }

    console.log("📷 [OCR] لم يتم العثور على نص في الصورة");
    return null;
  } catch (error: any) {
    // إذا فشل Google Vision، جرب OCR.space كبديل
    console.error("📷 [OCR] خطأ في Google Vision:", error.message);
    
    const OCR_API_KEY = process.env.OCR_API_KEY;
    if (OCR_API_KEY) {
      console.log("📷 [OCR] جاري استخدام OCR.space كبديل...");
      try {
        const formData = new FormData();
        formData.append("base64Image", `data:image/jpeg;base64,${base64Image}`);
        formData.append("language", "ara");
        formData.append("isOverlayRequired", "false");
        formData.append("detectOrientation", "true");

        const response = await fetch("https://api.ocr.space/parse/image", {
          method: "POST",
          headers: { apikey: OCR_API_KEY },
          body: formData,
        });

        if (response.ok) {
          const data = await response.json();
          if (data.ParsedResults && data.ParsedResults.length > 0) {
            return data.ParsedResults[0].ParsedText;
          }
        }
      } catch (fallbackError) {
        console.error("📷 [OCR] خطأ في OCR.space:", fallbackError);
      }
    }

    console.log("📷 [OCR] فشل في استخراج النص من الصورة");
    return null;
  }
}

/**
 * تحليل النص المستخرج واستخراج البيانات المهمة
 * يستخرج: المبلغ، التاريخ، IBAN، رقم الحساب، اسم البنك، اسم المستفيد، المرجع
 */
function parseReceiptText(text: string, paymentId: string): OcrResult {
  const result: OcrResult = {
    paymentId,
    rawText: text,
    confidence: 0,
  };

  // تنظيف النص
  const cleanText = text.replace(/[\r\n]+/g, ' ').trim();

  // ======================================
  // 1. استخراج المبلغ (أرقام متبوعة بـ SAR أو ر.س أو ريال)
  // ======================================
  const amountPatterns = [
    /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:SAR|ر\.س|ريال|SR)/gi,
    /(?:المبلغ|Amount|Total|الإجمالي)[\s:]*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/gi,
    /(\d{2,6}(?:\.\d{2})?)\s*(?:SAR|ر\.س)/gi,
  ];

  for (const pattern of amountPatterns) {
    const match = pattern.exec(cleanText);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ""));
      if (amount > 0 && amount < 100000) {
        result.extractedAmount = amount;
        result.confidence = (result.confidence || 0) + 20;
        console.log(`📷 [OCR] المبلغ المستخرج: ${amount}`);
        break;
      }
    }
  }

  // ======================================
  // 2. استخراج اسم البنك
  // ======================================
  const bankPatterns = [
    /(Al\s*Rajhi\s*Bank|بنك\s*الراجحي|الراجحي)/gi,
    /(Al\s*Ahli\s*Bank|البنك\s*الأهلي|الأهلي)/gi,
    /(Riyad\s*Bank|بنك\s*الرياض)/gi,
    /(SAB|البنك\s*السعودي\s*البريطاني|ساب)/gi,
    /(SAMBA|سامبا)/gi,
    /(Albilad\s*Bank|بنك\s*البلاد)/gi,
    /(Alinma\s*Bank|بنك\s*الإنماء|الإنماء)/gi,
    /(SNB|البنك\s*الوطني|الوطني)/gi,
    /(STC\s*Pay|إس\s*تي\s*سي\s*باي)/gi,
    /(stcpay)/gi,
  ];

  for (const pattern of bankPatterns) {
    const match = pattern.exec(cleanText);
    if (match) {
      // توحيد أسماء البنوك
      const bankName = normalizeBankName(match[0]);
      result.extractedBankName = bankName;
      result.confidence = (result.confidence || 0) + 20;
      console.log(`📷 [OCR] اسم البنك المستخرج: ${bankName}`);
      break;
    }
  }

  // ======================================
  // 3. استخراج اسم المستفيد
  // ======================================
  const beneficiaryPatterns = [
    /(?:إلى|To|المستفيد|Beneficiary|اسم المستفيد)[\s:]*([^\d\n]{5,50})/gi,
    /مؤسسة\s+[^\d\n]{5,50}/gi,
    /شركة\s+[^\d\n]{5,50}/gi,
  ];

  for (const pattern of beneficiaryPatterns) {
    const match = pattern.exec(cleanText);
    if (match) {
      const beneficiary = match[1] ? match[1].trim() : match[0].trim();
      if (beneficiary.length > 4) {
        result.extractedBeneficiaryName = beneficiary;
        result.confidence = (result.confidence || 0) + 20;
        console.log("📷 [OCR] تم استخراج اسم المستفيد");
        break;
      }
    }
  }

  // ======================================
  // 4. استخراج IBAN
  // ======================================
  const ibanPattern = /SA\d{2}[0-9A-Z]{20}/gi;
  const ibanMatch = ibanPattern.exec(cleanText);
  if (ibanMatch) {
    result.extractedIban = ibanMatch[0].toUpperCase();
    result.confidence = (result.confidence || 0) + 10;
    console.log("📷 [OCR] تم استخراج IBAN");
  }

  // ======================================
  // 5. استخراج رقم الحساب (إذا لم يوجد IBAN)
  // ======================================
  if (!result.extractedIban) {
    const accountPatterns = [
      /(?:رقم الحساب|Account|حساب)[\s:]*(\d{10,24})/gi,
      /(\d{22,24})/g, // رقم حساب طويل
    ];

    for (const pattern of accountPatterns) {
      const match = pattern.exec(cleanText);
      if (match) {
        const accountNumber = match[1] || match[0];
        result.extractedAccountNumber = accountNumber;
        result.confidence = (result.confidence || 0) + 10;
        console.log("📷 [OCR] تم استخراج رقم الحساب");
        break;
      }
    }
  }

  // ======================================
  // 6. استخراج رمز المرجع (RWQN-XXXXXX)
  // ======================================
  const refPattern = /RWQN-[A-Z0-9]{6}/gi;
  const refMatch = refPattern.exec(cleanText);
  if (refMatch) {
    result.extractedReference = refMatch[0].toUpperCase();
    result.confidence = (result.confidence || 0) + 30;
    console.log(`📷 [OCR] رمز المرجع المستخرج: ${result.extractedReference}`);
  }

  // ======================================
  // 7. استخراج التاريخ
  // ======================================
  const datePatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/g, // DD/MM/YYYY
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/g, // YYYY-MM-DD
  ];

  for (const pattern of datePatterns) {
    const match = pattern.exec(cleanText);
    if (match) {
      result.extractedDate = match[0];
      break;
    }
  }

  console.log(`📷 [OCR] نسبة الثقة: ${result.confidence}%`);
  return result;
}

/**
 * توحيد أسماء البنوك
 */
function normalizeBankName(rawName: string): string {
  const normalized = rawName.toLowerCase().replace(/\s+/g, '');
  
  if (normalized.includes('rajhi') || normalized.includes('راجحي')) {
    return 'بنك الراجحي';
  }
  if (normalized.includes('ahli') || normalized.includes('أهلي')) {
    return 'البنك الأهلي';
  }
  if (normalized.includes('riyad') || normalized.includes('رياض')) {
    return 'بنك الرياض';
  }
  if (normalized.includes('sab') || normalized.includes('بريطاني') || normalized.includes('ساب')) {
    return 'البنك السعودي البريطاني';
  }
  if (normalized.includes('samba') || normalized.includes('سامبا')) {
    return 'سامبا';
  }
  if (normalized.includes('bilad') || normalized.includes('بلاد')) {
    return 'بنك البلاد';
  }
  if (normalized.includes('inma') || normalized.includes('إنماء')) {
    return 'بنك الإنماء';
  }
  if (normalized.includes('snb') || normalized.includes('وطني')) {
    return 'البنك الوطني';
  }
  if (normalized.includes('stc') || normalized.includes('اس تي سي')) {
    return 'STC Pay';
  }
  
  return rawName;
}

/**
 * بيانات البنك المتوقع للمطابقة
 */
interface ExpectedBankData {
  bankName?: string;
  beneficiaryName?: string;
  iban?: string;
  accountNumber?: string;
}

/**
 * نتيجة المطابقة المفصلة
 */
export interface MatchResult {
  matched: boolean;
  score: number;
  reasons: string[];
  matchDetails: {
    bankMatched: boolean;
    beneficiaryMatched: boolean;
    amountMatched: boolean;
    referenceMatched: boolean;
  };
}

/**
 * مطابقة نتائج OCR مع الدفع
 * يجب أن تتحقق جميع العناصر الأربعة:
 * 1. الحساب البنكي (IBAN أو رقم الحساب)
 * 2. اسم المستفيد
 * 3. المبلغ
 * 4. المعرف المرجعي
 */
export async function matchOcrWithPayment(
  ocrResult: OcrResult,
  expectedAmount: number,
  expectedReference: string,
  expectedBankData?: ExpectedBankData
): Promise<MatchResult> {
  const reasons: string[] = [];
  let score = 0;
  
  const matchDetails = {
    bankMatched: false,
    beneficiaryMatched: false,
    amountMatched: false,
    referenceMatched: false,
  };

  console.log(`🔍 [Match] بدء المطابقة للمرجع: ${expectedReference}`);
  console.log(`🔍 [Match] البيانات المستخرجة:`, {
    amount: ocrResult.extractedAmount,
    reference: ocrResult.extractedReference,
    bankName: ocrResult.extractedBankName,
    hasBeneficiary: Boolean(ocrResult.extractedBeneficiaryName),
    hasIban: Boolean(ocrResult.extractedIban),
    hasAccountNumber: Boolean(ocrResult.extractedAccountNumber),
  });

  // ======================================
  // 1. مطابقة الحساب البنكي (IBAN أو رقم الحساب)
  // ======================================
  if (expectedBankData?.iban || expectedBankData?.accountNumber) {
    const expectedIban = expectedBankData.iban?.replace(/\s/g, "").toUpperCase();
    const expectedAccount = expectedBankData.accountNumber?.replace(/\s/g, "");
    
    const extractedIban = ocrResult.extractedIban?.replace(/\s/g, "").toUpperCase();
    const extractedAccount = ocrResult.extractedAccountNumber?.replace(/\s/g, "");
    
    if (extractedIban && expectedIban && extractedIban === expectedIban) {
      matchDetails.bankMatched = true;
      score += 25;
      reasons.push("✅ IBAN متطابق");
    } else if (extractedAccount && expectedAccount && extractedAccount.includes(expectedAccount)) {
      matchDetails.bankMatched = true;
      score += 25;
      reasons.push("✅ رقم الحساب متطابق");
    } else if (extractedIban || extractedAccount) {
      reasons.push(`❌ الحساب غير متطابق (${extractedIban || extractedAccount})`);
    } else {
      reasons.push("❌ لم يتم استخراج رقم الحساب/IBAN");
    }
  }

  // ======================================
  // 2. مطابقة اسم المستفيد
  // ======================================
  if (expectedBankData?.beneficiaryName) {
    const expectedBeneficiary = expectedBankData.beneficiaryName.toLowerCase().replace(/\s+/g, '');
    const extractedBeneficiary = ocrResult.extractedBeneficiaryName?.toLowerCase().replace(/\s+/g, '') || '';
    
    // مطابقة جزئية - إذا كان أحدهما يحتوي على الآخر
    if (extractedBeneficiary && (
      extractedBeneficiary.includes(expectedBeneficiary.substring(0, 10)) ||
      expectedBeneficiary.includes(extractedBeneficiary.substring(0, 10)) ||
      similarityScore(extractedBeneficiary, expectedBeneficiary) > 0.6
    )) {
      matchDetails.beneficiaryMatched = true;
      score += 25;
      reasons.push("✅ اسم المستفيد متطابق");
    } else if (ocrResult.extractedBeneficiaryName) {
      reasons.push(`❌ اسم المستفيد غير متطابق (${ocrResult.extractedBeneficiaryName})`);
    } else {
      reasons.push("❌ لم يتم استخراج اسم المستفيد");
    }
  }

  // ======================================
  // 3. مطابقة المبلغ (±2%)
  // ======================================
  if (ocrResult.extractedAmount) {
    const tolerance = expectedAmount * 0.02; // 2% tolerance
    if (Math.abs(ocrResult.extractedAmount - expectedAmount) <= tolerance) {
      matchDetails.amountMatched = true;
      score += 25;
      reasons.push("✅ المبلغ متطابق");
    } else {
      reasons.push(`❌ المبلغ غير متطابق (${ocrResult.extractedAmount} ≠ ${expectedAmount})`);
    }
  } else {
    reasons.push("❌ لم يتم استخراج المبلغ");
  }

  // ======================================
  // 4. مطابقة رمز المرجع (RWQN-XXXXXX)
  // ======================================
  if (ocrResult.extractedReference) {
    if (ocrResult.extractedReference.toUpperCase() === expectedReference.toUpperCase()) {
      matchDetails.referenceMatched = true;
      score += 25;
      reasons.push("✅ رمز المرجع متطابق");
    } else {
      reasons.push(`❌ رمز المرجع غير متطابق (${ocrResult.extractedReference} ≠ ${expectedReference})`);
    }
  } else {
    reasons.push("❌ لم يتم استخراج رمز المرجع");
  }

  // ======================================
  // التحقق النهائي - يجب تطابق جميع العناصر الأربعة
  // ======================================
  const allMatched = 
    matchDetails.bankMatched &&
    matchDetails.beneficiaryMatched &&
    matchDetails.amountMatched &&
    matchDetails.referenceMatched;

  console.log(`🔍 [Match] نتيجة المطابقة:`, {
    score,
    allMatched,
    matchDetails,
  });

  return {
    matched: allMatched, // يجب تطابق كل العناصر الأربعة
    score,
    reasons,
    matchDetails,
  };
}

/**
 * حساب نسبة التشابه بين نصين (Levenshtein-based)
 */
function similarityScore(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * حساب مسافة Levenshtein
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  
  return dp[m][n];
}

export default {
  extractReceiptData,
  matchOcrWithPayment,
};
