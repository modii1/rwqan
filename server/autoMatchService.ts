/**
 * 🔄 Auto-Match Service - محرك المطابقة التلقائية للتحويلات البنكية
 * 
 * يقوم بمطابقة التحويلات البنكية تلقائياً بناءً على:
 * 1. المبلغ
 * 2. رمز المرجع (RWQN-XXXXXX)
 * 3. IBAN المستلم
 * 4. التاريخ (خلال نافذة زمنية محددة)
 */

import { googleSheetsService } from "./googleSheets";
import { extractReceiptData, matchOcrWithPayment } from "./ocrService";
import { sendWhatsAppNotification, notifyOwnerSubscriptionActivated } from "./whatsapp";
import { Payment } from "@shared/schema";
import { getStartOfDayRiyadh, calculateSubscriptionEndDate, calculateExtensionEndDate } from "./dateUtils";

// ثوابت المطابقة
const MATCH_WINDOW_DAYS = 7; // نافذة المطابقة (7 أيام)
const MIN_MATCH_SCORE = 70; // الحد الأدنى للمطابقة

/**
 * تشغيل محرك المطابقة التلقائية
 * يتم استدعاؤه من الـ scheduler أو يدوياً
 */
export async function runAutoMatch(): Promise<{
  processed: number;
  matched: number;
  failed: number;
}> {
  const result = { processed: 0, matched: 0, failed: 0 };

  try {
    // التحقق من تفعيل ميزة المطابقة التلقائية
    const autoMatchEnabled = await googleSheetsService.getFeatureFlag("FEATURE_BANK_AUTO_MATCH");
    if (!autoMatchEnabled) {
      console.log("🔄 [AutoMatch] الميزة غير مفعلة");
      return result;
    }

    console.log("🔄 [AutoMatch] بدء المطابقة التلقائية...");

    // جلب الدفعات المعلقة (تحويل بنكي)
    const payments = await googleSheetsService.getPayments();
    const pendingBankPayments = payments.filter(
      (p) =>
        p.paymentMethod === "تحويل بنكي" &&
        (p.status === "قيد التحقق" || p.status === "قيد المراجعة")
    );

    console.log(`🔄 [AutoMatch] وجدت ${pendingBankPayments.length} دفعة معلقة`);

    for (const payment of pendingBankPayments) {
      result.processed++;

      try {
        const matchResult = await attemptMatch(payment);

        if (matchResult.matched) {
          result.matched++;
          await activatePayment(payment);
          console.log(`✅ [AutoMatch] تم مطابقة وتفعيل الدفع: ${payment.id}`);
        } else {
          console.log(`⏳ [AutoMatch] لم تتم المطابقة: ${payment.id} (${matchResult.reason})`);
        }
      } catch (error) {
        result.failed++;
        console.error(`❌ [AutoMatch] خطأ في معالجة: ${payment.id}`, error);
      }
    }

    console.log(`🔄 [AutoMatch] انتهت المطابقة - معالجة: ${result.processed}, متطابقة: ${result.matched}`);
    return result;
  } catch (error) {
    console.error("❌ [AutoMatch] خطأ عام:", error);
    return result;
  }
}

/**
 * محاولة مطابقة دفعة واحدة
 */
async function attemptMatch(payment: Payment): Promise<{
  matched: boolean;
  score: number;
  reason: string;
}> {
  // التحقق من وجود رمز مرجعي
  const paymentReference = (payment as any).paymentReference;
  if (!paymentReference) {
    return { matched: false, score: 0, reason: "لا يوجد رمز مرجعي" };
  }

  // التحقق من وجود إيصال
  if (!payment.receiptUrl) {
    return { matched: false, score: 0, reason: "لا يوجد إيصال" };
  }

  // جلب نتائج OCR السابقة أو إجراء OCR جديد
  let ocrResult = await googleSheetsService.getOcrResultByPaymentId(payment.id);
  
  if (!ocrResult) {
    ocrResult = await extractReceiptData(payment.receiptUrl, payment.id);
  }

  if (!ocrResult) {
    return { matched: false, score: 0, reason: "فشل استخراج بيانات الإيصال" };
  }

  // جلب الحساب البنكي المختار
  const selectedBankId = (payment as any).selectedBankAccountId;
  let expectedBankData: {
    bankName?: string;
    beneficiaryName?: string;
    iban?: string;
    accountNumber?: string;
  } | undefined;
  
  if (selectedBankId) {
    const accounts = await googleSheetsService.getBankAccounts();
    const account = accounts.find((a) => a.id === selectedBankId);
    if (account) {
      expectedBankData = {
        bankName: account.bankName,
        beneficiaryName: account.beneficiaryName,
        iban: account.iban,
        accountNumber: account.accountNumber,
      };
    }
  } else {
    // إذا لم يتم اختيار حساب، نستخدم الحساب الافتراضي
    const accounts = await googleSheetsService.getBankAccounts();
    const defaultAccount = accounts.find((a) => a.isDefault && a.isActive);
    if (defaultAccount) {
      expectedBankData = {
        bankName: defaultAccount.bankName,
        beneficiaryName: defaultAccount.beneficiaryName,
        iban: defaultAccount.iban,
        accountNumber: defaultAccount.accountNumber,
      };
    }
  }

  // إجراء المطابقة
  const matchResult = await matchOcrWithPayment(
    ocrResult,
    payment.finalAmount,
    paymentReference,
    expectedBankData
  );

  if (matchResult.matched) {
    return {
      matched: true,
      score: matchResult.score,
      reason: matchResult.reasons.join(", "),
    };
  }

  return {
    matched: false,
    score: matchResult.score,
    reason: matchResult.reasons.filter((r) => r.startsWith("❌")).join(", ") || "لم تتحقق شروط المطابقة",
  };
}

/**
 * تفعيل الدفعة والاشتراك بعد المطابقة الناجحة
 */
async function activatePayment(payment: Payment): Promise<void> {
  try {
    // تحديث حالة الدفع إلى مكتمل
    await googleSheetsService.updatePaymentStatus(payment.id, "مكتمل");

    // جلب بيانات العقار
    const property = await googleSheetsService.getPropertyByNumber(payment.propertyNumber);
    if (!property) {
      console.error(`❌ [AutoMatch] العقار غير موجود: ${payment.propertyNumber}`);
      return;
    }

    // التحقق من حالة التحقق الذكي
    const verificationStatus = property.verificationStatus;
    
    if (verificationStatus === "approved") {
      // العقار موافق عليه - تفعيل الاشتراك فوراً
      await activateSubscription(payment, property);
    } else {
      // العقار لم يتم التحقق منه بعد - سيتم تفعيل الاشتراك عند نجاح التحقق
      console.log(`⏳ [AutoMatch] الدفع مكتمل، ينتظر نجاح التحقق الذكي: ${payment.propertyNumber}`);
      
      // إرسال إشعار للأدمن
      await sendWhatsAppNotification(
        `💳 *تم تأكيد تحويل بنكي*\n\n` +
        `📍 العقار: ${property.name}\n` +
        `🔢 رقم العقار: ${payment.propertyNumber}\n` +
        `💵 المبلغ: ${payment.finalAmount} ر.س\n\n` +
        `⏳ الدفع مكتمل - ينتظر اكتمال التحقق الذكي`
      );
    }
  } catch (error) {
    console.error(`❌ [AutoMatch] خطأ في تفعيل الدفع:`, error);
    throw error;
  }
}

/**
 * تفعيل الاشتراك
 */
async function activateSubscription(payment: Payment, property: any): Promise<void> {
  try {
    // جلب الباقة
    const pkg = await googleSheetsService.getPackageById(payment.packageId);
    if (!pkg) {
      console.error(`❌ [AutoMatch] الباقة غير موجودة: ${payment.packageId}`);
      return;
    }

    // حساب تواريخ الاشتراك بالتوقيت السعودي
    const todayRiyadh = getStartOfDayRiyadh();
    const currentSubscription = await googleSheetsService.getSubscriptionByPropertyNumber(payment.propertyNumber);

    let startDate: Date;
    let endDate: Date;

    // التحقق من نوع العملية (تمديد أو جديد)
    if (currentSubscription && currentSubscription.endDate) {
      const currentEndDate = new Date(currentSubscription.endDate);
      // إذا كان الاشتراك الحالي لم ينتهي بعد - تمديد
      if (currentEndDate > todayRiyadh) {
        startDate = currentEndDate;
        endDate = calculateExtensionEndDate(currentEndDate, pkg.duration);
        console.log(`📅 [AutoMatch] تمديد - يبدأ من: ${startDate.toISOString()}, ينتهي: ${endDate.toISOString()}`);
      } else {
        // الاشتراك منتهي - نبدأ من اليوم
        startDate = todayRiyadh;
        endDate = calculateSubscriptionEndDate(null, pkg.duration);
        console.log(`📅 [AutoMatch] اشتراك جديد (منتهي سابقاً) - يبدأ من: ${startDate.toISOString()}, ينتهي: ${endDate.toISOString()}`);
      }
    } else {
      // لا يوجد اشتراك سابق - جديد
      startDate = todayRiyadh;
      endDate = calculateSubscriptionEndDate(null, pkg.duration);
      console.log(`📅 [AutoMatch] اشتراك جديد - يبدأ من: ${startDate.toISOString()}, ينتهي: ${endDate.toISOString()}`);
    }

    // تنسيق التواريخ بالتوقيت السعودي (YYYY-MM-DD)
    const formatDateRiyadh = (date: Date): string => {
      return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
    };

    // حساب السعر (نصف السعر إذا كانت باقة عقارين)
    const isMultiProperty = !!(payment as any).secondPropertyNumber;
    const pricePerProperty = isMultiProperty ? payment.finalAmount / 2 : payment.finalAmount;

    // تحديد نوع الاشتراك (مميز إذا مدفوع)
    const isPremiumAutoMatch = pkg.type === "موثوق" || pkg.type === "مميز" || pricePerProperty > 0;

    const subscriptionData = {
      packageId: pkg.id,
      price: pricePerProperty,
      subscriptionType: isPremiumAutoMatch ? "مميز" : "عادي",
      packageType: isPremiumAutoMatch ? "مميز" : "عادي",
      startDate: formatDateRiyadh(startDate),
      endDate: formatDateRiyadh(endDate),
      paymentId: payment.id,
      linkedProperty: isMultiProperty ? (payment as any).secondPropertyNumber : undefined,
    };

    console.log(`📦 [AutoMatch] Package: ${pkg.name}, type: ${pkg.type}, isPremium: ${isPremiumAutoMatch}, finalType: ${subscriptionData.subscriptionType}`);

    // إضافة الاشتراك
    await googleSheetsService.addSubscriptionToSheet(
      payment.propertyNumber,
      subscriptionData,
      property,
      payment.receiptUrl || ""
    );

    // إضافة اشتراك العقار الثاني إذا وجد
    if ((payment as any).secondPropertyNumber) {
      const secondProperty = await googleSheetsService.getPropertyByNumber((payment as any).secondPropertyNumber);
      if (secondProperty) {
        const secondSubscriptionData = {
          ...subscriptionData,
          linkedProperty: payment.propertyNumber,
        };
        await googleSheetsService.addSubscriptionToSheet(
          (payment as any).secondPropertyNumber,
          secondSubscriptionData,
          secondProperty,
          payment.receiptUrl || ""
        );
      }
    }

    // إرسال إشعار للأدمن
    await sendWhatsAppNotification(
      `🎉 *تم تفعيل الاشتراك تلقائياً*\n\n` +
      `📍 العقار: ${property.name}\n` +
      `🔢 رقم العقار: ${payment.propertyNumber}\n` +
      `📦 الباقة: ${pkg.name}\n` +
      `💵 المبلغ: ${payment.finalAmount} ر.س\n` +
      `📅 من: ${subscriptionData.startDate}\n` +
      `📅 إلى: ${subscriptionData.endDate}\n\n` +
      `✅ تمت المطابقة التلقائية للتحويل البنكي`
    );

    // إرسال إشعار للمالك
    if (property.whatsappNumber) {
      await notifyOwnerSubscriptionActivated({
        ownerPhone: property.whatsappNumber,
        propertyNumber: payment.propertyNumber,
        propertyName: property.name || "",
        endDate: subscriptionData.endDate,
      });
    }

    console.log(`✅ [AutoMatch] تم تفعيل الاشتراك: ${payment.propertyNumber}`);
  } catch (error) {
    console.error(`❌ [AutoMatch] خطأ في تفعيل الاشتراك:`, error);
    throw error;
  }
}

export default {
  runAutoMatch,
};
