/**
 * 🔬 AI Receipt Scanner - فحص الإيصالات بالذكاء الاصطناعي
 * 
 * نظام فحص متقدم يشبه الأشعة فوق البنفسجية
 * يستخرج كل التفاصيل الدقيقة من الإيصالات البنكية
 * 
 * يدعم: PNG, JPG, JPEG, PDF
 */

import OpenAI from "openai";
import { googleSheetsService } from "./googleSheets";
import { pdfToPng } from "pdf-to-png-converter";

/**
 * تحميل الملف من URL وتحويله إلى Base64
 * يدعم الصور وملفات PDF
 */
async function fetchFileAsBase64(fileUrl: string): Promise<{ base64: string; mimeType: string; isPdf: boolean } | null> {
  try {
    console.log(`📥 [AI Scanner] تحميل الملف: ${fileUrl}`);

    const response = await fetch(fileUrl);
    if (!response.ok) {
      console.error(`❌ [AI Scanner] فشل تحميل الملف: ${response.status}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');

    // تحديد نوع الملف
    let mimeType = contentType.split(';')[0].trim();
    const isPdf = mimeType === 'application/pdf' || fileUrl.toLowerCase().endsWith('.pdf');

    // تصحيح نوع MIME إذا لزم الأمر
    if (isPdf) {
      mimeType = 'application/pdf';
    } else if (!mimeType.startsWith('image/')) {
      // محاولة تحديد النوع من امتداد الملف
      if (fileUrl.toLowerCase().endsWith('.png')) {
        mimeType = 'image/png';
      } else if (fileUrl.toLowerCase().endsWith('.jpg') || fileUrl.toLowerCase().endsWith('.jpeg')) {
        mimeType = 'image/jpeg';
      } else {
        mimeType = 'image/png'; // افتراضي
      }
    }

    console.log(`📄 [AI Scanner] نوع الملف: ${mimeType}, PDF: ${isPdf}, الحجم: ${buffer.length} bytes`);

    return { base64, mimeType, isPdf };
  } catch (error) {
    console.error(`❌ [AI Scanner] خطأ في تحميل الملف:`, error);
    return null;
  }
}

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export interface AIScanResult {
  paymentId: string;
  scanDate: string;

  // البيانات المستخرجة
  extractedData: {
    amount: number | null;
    currency: string | null;
    date: string | null;
    time: string | null;
    senderName: string | null;
    senderBank: string | null;
    senderIban: string | null;
    senderAccountNumber: string | null;
    receiverName: string | null;
    receiverBank: string | null;
    receiverIban: string | null;
    receiverAccountNumber: string | null;
    referenceNumber: string | null;
    transactionId: string | null;
    paymentReference: string | null; // RWQN-XXXXXX
  };

  // تحليل الأصالة
  authenticityAnalysis: {
    overallScore: number; // 0-100
    isLikelyAuthentic: boolean;
    concerns: string[];
    positiveIndicators: string[];
  };

  // تحليل جودة الصورة
  imageQuality: {
    clarity: 'ممتازة' | 'جيدة' | 'متوسطة' | 'ضعيفة';
    isComplete: boolean;
    hasWatermarks: boolean;
    isScreenshot: boolean;
  };

  // التطابق مع متطلباتنا
  matchAnalysis: {
    amountMatch: boolean;
    referenceMatch: boolean;
    ibanMatch: boolean;
    beneficiaryMatch: boolean;
    dateMatch: boolean; // تطابق تاريخ العملية
    matchScore: number;
    matchDetails: string;
  };

  // ملخص الفحص
  summary: string;
  recommendation: 'تفعيل_تلقائي' | 'مراجعة_يدوية' | 'رفض';

  // البيانات الخام
  rawAnalysis: string;
  confidence: number;
}

/**
 * فحص الإيصال بالذكاء الاصطناعي - مثل الأشعة فوق البنفسجية
 */
export async function scanReceiptWithAI(
  imageUrl: string,
  paymentId: string,
  expectedAmount?: number,
  expectedReference?: string,
  expectedIban?: string,
  expectedBeneficiary?: string
): Promise<AIScanResult | null> {
  try {
    // التحقق من تفعيل ميزة OCR
    const ocrEnabled = await googleSheetsService.getFeatureFlag("FEATURE_OCR_ENABLED");
    if (!ocrEnabled) {
      console.log("🔬 [AI Scanner] الميزة غير مفعلة");
      return null;
    }

    console.log(`🔬 [AI Scanner] بدء فحص الإيصال: ${paymentId}`);
    console.log(`🔬 [AI Scanner] رابط الصورة: ${imageUrl}`);

    // جلب الحساب البنكي الافتراضي للمقارنة
    const bankAccounts = await googleSheetsService.getBankAccounts();
    const defaultAccount = bankAccounts.find(a => a.isDefault) || bankAccounts[0];

    // تاريخ اليوم بتوقيت السعودية
    const today = new Date();
    const saudiDate = today.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }); // YYYY-MM-DD

    const systemPrompt = `أنت خبير في تحليل الإيصالات البنكية السعودية. مهمتك هي فحص صورة الإيصال بدقة عالية مثل جهاز الأشعة فوق البنفسجية لكشف التفاصيل.

تاريخ اليوم الحالي: ${saudiDate} (بتوقيت السعودية)

يجب عليك:
1. استخراج كل البيانات المرئية في الإيصال
2. تحليل أصالة الإيصال (هل يبدو حقيقي أم معدل)
3. تقييم جودة الصورة
4. مقارنة البيانات مع المتوقع

البيانات المتوقعة للمقارنة:
- المبلغ المتوقع: ${expectedAmount || 'غير محدد'} ريال
- الرمز المرجعي المتوقع: ${expectedReference || 'غير محدد'}
- IBAN المستفيد المتوقع: ${expectedIban || defaultAccount?.iban || 'غير محدد'}
- اسم المستفيد المتوقع: ${expectedBeneficiary || defaultAccount?.beneficiaryName || 'غير محدد'}

أجب بصيغة JSON فقط بالهيكل التالي:
{
  "extractedData": {
    "amount": رقم أو null,
    "currency": "SAR" أو "ريال" أو null,
    "date": "YYYY-MM-DD" أو null,
    "time": "HH:MM" أو null,
    "senderName": "اسم المرسل" أو null,
    "senderBank": "اسم بنك المرسل" أو null,
    "senderIban": "IBAN المرسل" أو null,
    "senderAccountNumber": "رقم حساب المرسل" أو null,
    "receiverName": "اسم المستفيد" أو null,
    "receiverBank": "اسم بنك المستفيد" أو null,
    "receiverIban": "IBAN المستفيد" أو null,
    "receiverAccountNumber": "رقم حساب المستفيد" أو null,
    "referenceNumber": "رقم مرجعي البنك" أو null,
    "transactionId": "رقم العملية" أو null,
    "paymentReference": "RWQN-XXXXXX إذا وجد" أو null
  },
  "authenticityAnalysis": {
    "overallScore": رقم من 0 إلى 100,
    "isLikelyAuthentic": true أو false,
    "concerns": ["قائمة المخاوف إن وجدت"],
    "positiveIndicators": ["مؤشرات إيجابية"]
  },
  "imageQuality": {
    "clarity": "ممتازة" أو "جيدة" أو "متوسطة" أو "ضعيفة",
    "isComplete": true أو false,
    "hasWatermarks": true أو false,
    "isScreenshot": true أو false
  },
  "matchAnalysis": {
    "amountMatch": true أو false,
    "referenceMatch": true أو false,
    "ibanMatch": true أو false,
    "beneficiaryMatch": true أو false,
    "dateMatch": true إذا كان تاريخ الإيصال ضمن آخر 7 أيام,
    "matchScore": رقم من 0 إلى 100,
    "matchDetails": "تفاصيل المطابقة"
  },
  "summary": "ملخص شامل للفحص",
  "confidence": رقم من 0 إلى 100
}

ملاحظات مهمة:
- تقبل dateMatch إذا كان التاريخ ضمن آخر 7 أيام من اليوم
- referenceMatch و ibanMatch اختياريان ومؤشر إضافي فقط
- ⚠️ المبلغ (amountMatch) شرط أساسي للتفعيل التلقائي`;

    // التحقق من نوع الملف
    const isPdf = imageUrl.toLowerCase().endsWith('.pdf');
    let imageDataUrl: string;

    if (isPdf) {
      // تحويل PDF إلى صورة
      console.log(`📄 [AI Scanner] تحويل PDF إلى صورة...`);
      try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          console.error(`❌ [AI Scanner] فشل تحميل PDF: ${response.status}`);
          return null;
        }
        const arrayBuffer = await response.arrayBuffer();

        // تحويل أول صفحة من PDF إلى صورة PNG
        const pngPages = await pdfToPng(arrayBuffer, {
          viewportScale: 2.0, // جودة عالية
          pagesToProcess: [1], // أول صفحة فقط
        });

        if (!pngPages || pngPages.length === 0 || !pngPages[0].content) {
          console.error(`❌ [AI Scanner] فشل تحويل PDF إلى صورة أو المحتوى فارغ`);
          return null;
        }

        const base64Image = pngPages[0].content.toString('base64');
        imageDataUrl = `data:image/png;base64,${base64Image}`;
        console.log(`✅ [AI Scanner] تم تحويل PDF إلى صورة بنجاح`);
      } catch (pdfError) {
        console.error(`❌ [AI Scanner] خطأ في تحويل PDF:`, pdfError);
        return null;
      }
    } else {
      // صورة: URL مباشر
      imageDataUrl = imageUrl;
    }

    console.log(`🖼️ [AI Scanner] إرسال ${isPdf ? 'صورة من PDF' : 'صورة'} للفحص`);
    const messageContent: Array<{ type: "text", text: string } | { type: "image_url", image_url: { url: string, detail: "high" } }> = [
      {
        type: "text" as const,
        text: "قم بفحص هذا الإيصال البنكي واستخرج كل البيانات المرئية. حلل أصالته وجودته وقارنه بالبيانات المتوقعة.",
      },
      {
        type: "image_url" as const,
        image_url: {
          url: imageDataUrl,
          detail: "high" as const,
        },
      },
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: messageContent,
        },
      ],
      max_tokens: 2000,
      temperature: 0.1,
    });

    const rawAnalysis = response.choices[0]?.message?.content || "";
    console.log(`🔬 [AI Scanner] نتيجة التحليل الخام:`, rawAnalysis);

    // تحليل النتيجة JSON
    let analysisData;
    try {
      // استخراج JSON من النص
      const jsonMatch = rawAnalysis.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("لم يتم العثور على JSON في الرد");
      }
    } catch (parseError) {
      console.error("🔬 [AI Scanner] خطأ في تحليل JSON:", parseError);
      // إنشاء نتيجة افتراضية
      analysisData = {
        extractedData: {},
        authenticityAnalysis: {
          overallScore: 50,
          isLikelyAuthentic: false,
          concerns: ["فشل في تحليل الإيصال"],
          positiveIndicators: [],
        },
        imageQuality: {
          clarity: "ضعيفة",
          isComplete: false,
          hasWatermarks: false,
          isScreenshot: false,
        },
        matchAnalysis: {
          amountMatch: false,
          referenceMatch: false,
          ibanMatch: false,
          beneficiaryMatch: false,
          matchScore: 0,
          matchDetails: "فشل في استخراج البيانات للمقارنة",
        },
        summary: "لم يتمكن النظام من تحليل الإيصال بشكل صحيح",
        recommendation: "مراجعة_يدوية",
        confidence: 20,
      };
    }

    const result: AIScanResult = {
      paymentId,
      scanDate: new Date().toISOString(),
      extractedData: {
        amount: analysisData.extractedData?.amount || null,
        currency: analysisData.extractedData?.currency || null,
        date: analysisData.extractedData?.date || null,
        time: analysisData.extractedData?.time || null,
        senderName: analysisData.extractedData?.senderName || null,
        senderBank: analysisData.extractedData?.senderBank || null,
        senderIban: analysisData.extractedData?.senderIban || null,
        senderAccountNumber: analysisData.extractedData?.senderAccountNumber || null,
        receiverName: analysisData.extractedData?.receiverName || null,
        receiverBank: analysisData.extractedData?.receiverBank || null,
        receiverIban: analysisData.extractedData?.receiverIban || null,
        receiverAccountNumber: analysisData.extractedData?.receiverAccountNumber || null,
        referenceNumber: analysisData.extractedData?.referenceNumber || null,
        transactionId: analysisData.extractedData?.transactionId || null,
        paymentReference: analysisData.extractedData?.paymentReference || null,
      },
      authenticityAnalysis: {
        overallScore: analysisData.authenticityAnalysis?.overallScore || 0,
        isLikelyAuthentic: analysisData.authenticityAnalysis?.isLikelyAuthentic || false,
        concerns: analysisData.authenticityAnalysis?.concerns || [],
        positiveIndicators: analysisData.authenticityAnalysis?.positiveIndicators || [],
      },
      imageQuality: {
        clarity: analysisData.imageQuality?.clarity || "ضعيفة",
        isComplete: analysisData.imageQuality?.isComplete || false,
        hasWatermarks: analysisData.imageQuality?.hasWatermarks || false,
        isScreenshot: analysisData.imageQuality?.isScreenshot || false,
      },
      matchAnalysis: {
        amountMatch: analysisData.matchAnalysis?.amountMatch || false,
        referenceMatch: analysisData.matchAnalysis?.referenceMatch || false,
        ibanMatch: analysisData.matchAnalysis?.ibanMatch || false,
        beneficiaryMatch: analysisData.matchAnalysis?.beneficiaryMatch || false,
        dateMatch: analysisData.matchAnalysis?.dateMatch || false,
        matchScore: analysisData.matchAnalysis?.matchScore || 0,
        matchDetails: analysisData.matchAnalysis?.matchDetails || "",
      },
      summary: analysisData.summary || "لا يوجد ملخص",
      recommendation: "مراجعة_يدوية", // سيتم تحديده بناءً على المعايير
      rawAnalysis,
      confidence: analysisData.confidence || 0,
    };

    // 🎯 تطبيق معايير القبول الجديدة
    // ⚠️ المبلغ شرط أساسي + (اسم المؤسسة أو التاريخ) + ثقة > 80% + جودة ممتازة أو جيدة
    const matchCriteria = {
      beneficiaryMatch: result.matchAnalysis.beneficiaryMatch,
      amountMatch: result.matchAnalysis.amountMatch, // ⚠️ شرط أساسي
      dateMatch: result.matchAnalysis.dateMatch,
    };

    // المبلغ شرط أساسي
    const amountOk = matchCriteria.amountMatch;
    // واحد على الأقل من: اسم المؤسسة أو التاريخ
    const secondaryMatch = matchCriteria.beneficiaryMatch || matchCriteria.dateMatch;
    const matchCount = Object.values(matchCriteria).filter(Boolean).length;
    const confidenceOk = result.confidence >= 80;
    const qualityOk = result.imageQuality.clarity === 'ممتازة' || result.imageQuality.clarity === 'جيدة';

    console.log(`🔬 [AI Scanner] معايير القبول:`);
    console.log(`   - 💰 المبلغ (أساسي): ${matchCriteria.amountMatch ? '✅' : '❌'}`);
    console.log(`   - 🏢 اسم المؤسسة: ${matchCriteria.beneficiaryMatch ? '✅' : '❌'}`);
    console.log(`   - 📅 التاريخ: ${matchCriteria.dateMatch ? '✅' : '❌'}`);
    console.log(`   - عدد المطابقات: ${matchCount}/3`);
    console.log(`   - مؤشر الثقة: ${result.confidence}% ${confidenceOk ? '✅' : '❌'}`);
    console.log(`   - جودة الصورة: ${result.imageQuality.clarity} ${qualityOk ? '✅' : '❌'}`);

    // القرار النهائي - المبلغ شرط أساسي
    if (amountOk && secondaryMatch && confidenceOk && qualityOk) {
      result.recommendation = 'تفعيل_تلقائي';
      console.log(`🎉 [AI Scanner] ✅ تفعيل تلقائي - المبلغ مطابق + شرط ثانوي + جودة عالية`);
    } else if (amountOk && (secondaryMatch || result.confidence >= 60)) {
      result.recommendation = 'مراجعة_يدوية';
      console.log(`⚠️ [AI Scanner] يحتاج مراجعة يدوية - المبلغ مطابق لكن لم يستوف باقي المعايير`);
    } else if (!amountOk) {
      result.recommendation = 'مراجعة_يدوية';
      console.log(`⚠️ [AI Scanner] يحتاج مراجعة يدوية - المبلغ غير مطابق`);
    } else {
      result.recommendation = 'رفض';
      console.log(`❌ [AI Scanner] مرفوض - لا يستوفي الحد الأدنى من المعايير`);
    }

    // تحديث matchScore بناءً على المعايير الجديدة
    let bonusScore = 0;
    if (result.matchAnalysis.referenceMatch) bonusScore += 10; // مكافأة الرمز المرجعي
    if (result.matchAnalysis.ibanMatch) bonusScore += 10; // مكافأة IBAN
    result.matchAnalysis.matchScore = Math.min(100, (matchCount * 30) + bonusScore);

    // حفظ نتيجة الفحص
    await saveAIScanResult(result);

    console.log(`🔬 [AI Scanner] اكتمل الفحص - التوصية: ${result.recommendation}, الثقة: ${result.confidence}%`);

    return result;
  } catch (error: any) {
    console.error("🔬 [AI Scanner] خطأ في الفحص:", error.message);
    return null;
  }
}

/**
 * حفظ نتيجة فحص AI في Google Sheets
 */
async function saveAIScanResult(result: AIScanResult): Promise<void> {
  try {
    await googleSheetsService.saveOcrResult({
      paymentId: result.paymentId,
      extractedAmount: result.extractedData.amount || undefined,
      extractedDate: result.extractedData.date || undefined,
      extractedIban: result.extractedData.receiverIban || undefined,
      extractedReference: result.extractedData.paymentReference || undefined,
      extractedBankName: result.extractedData.receiverBank || undefined,
      extractedBeneficiaryName: result.extractedData.receiverName || undefined,
      extractedAccountNumber: result.extractedData.receiverAccountNumber || undefined,
      confidence: result.confidence,
      rawText: result.summary,
    });
    console.log(`🔬 [AI Scanner] تم حفظ نتيجة الفحص للدفعة: ${result.paymentId}`);
  } catch (error) {
    console.error("🔬 [AI Scanner] خطأ في حفظ النتيجة:", error);
  }
}

/**
 * تصدير الدالة للاستخدام في routes
 */
export { scanReceiptWithAI as analyzeReceiptWithAI };
