import { Router } from "express";
import { requireOwner } from "./middleware";
import { propertyService, subscriptionService, paymentService, addOnService, discountService, contentService, analyticsService, occasionService } from "../services";
import { firebaseService } from "../firebaseService";
import { r2, R2_BUCKET, R2_PUBLIC_URL, countR2Images } from "../utils/r2";
import { upload, uploadImages, detectDeviceType, SHEET_MAP, normalizePhoneNumber } from "../utils/helpers";
import multer from "multer";
import { checkPropertyDataComplete } from "../utils/verification";
import { PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { calculateSubscriptionEndDate, calculateExtensionEndDate, calculateRemainingDays, getStartOfDayRiyadh, formatDateRiyadh } from "../utils/dateUtils";
import { storage } from "../storage";
import {
  notifyPropertyUpdate,
  sendWhatsAppNotification,
  sendOwnerWhatsApp,
  notifyOwnerSubscriptionActivated,
  notifyReceiptUpload,
  notifyNewPayment,
} from "../integrations/whatsapp";
import { paymobService } from "../integrations/paymob";
import { scanReceiptWithAI } from "../integrations/aiReceiptScanner";
import {
  activateVerifiedPaymentSubscription,
  calculateActionDates,
  hasPriorSubscription,
  isActiveSubscription,
  isLegacyPaymentFulfillment,
  normalizeLinkedPropertyNumbers,
  queueVerifiedNewPropertyForAdminApproval,
  syncMultiPropertyRecord,
  validatePaymentSubscriptionAction,
  validateSubscriptionAction,
} from "../services/payments/paymentScenarioFlow";
import {
  getEffectiveSubscriptionType,
  getSubscriptionTypeLabel,
  isActivePremiumSubscription,
  isPremiumSubscriptionType,
} from "../../shared/core/subscriptions/type";

const router = Router();

const ACTIVE_LINKED_SUBSCRIPTION_STATUSES = new Set([
  "نشط",
  "ساري",
  "نشط مجاني",
  "ينتهي قريباً",
  "قريب الانتهاء",
  "active",
  "free_active",
  "expiring",
]);
const OWNER_PAYMENT_ATTENTION_STATUSES = new Set(["قيد المراجعة", "معلق", "قيد التحقق", "نجح - قيد التحقق", "pending"]);
const manualVerificationInFlight = new Set<string>();

function isLinkedSubscriptionActive(status?: string | null): boolean {
  return ACTIVE_LINKED_SUBSCRIPTION_STATUSES.has(String(status || "").trim());
}

function getPaymentTime(value: any): number {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1_000_000);
  if (typeof value._seconds === "number") return value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1_000_000);
  return 0;
}

function sortPaymentsNewestFirst<T extends { createdAt?: any; completedAt?: any; id?: string }>(payments: T[]): T[] {
  return [...payments].sort((a, b) => {
    const byTime =
      getPaymentTime(b.createdAt || b.completedAt) -
      getPaymentTime(a.createdAt || a.completedAt);
    if (byTime !== 0) return byTime;
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
}

// ======================================================
// 🏠 GET /api/owner/property - Get owner's property data
// ======================================================
router.get("/api/owner/property", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    if (!propertyNumber) {
      return res.status(400).json({ error: "Property not found in session" });
    }

    const property = await propertyService.getByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    const subscription = await subscriptionService.getByProperty(propertyNumber);
    const isSubscriptionExpired = !subscription || calculateRemainingDays(subscription.endDate) < 0;
    const effectiveSubscriptionType = subscription
      ? getEffectiveSubscriptionType({
          subscriptionType: subscription.subscriptionType,
          packageType: subscription.packageType,
          price: (subscription as any).price,
        })
      : "عادي";
    const isPremiumActive = isActivePremiumSubscription({
      subscriptionType: effectiveSubscriptionType,
      status: subscription?.status,
      isExpired: isSubscriptionExpired,
    });

    res.json({
      ...property,
      subscriptionType: isPremiumActive ? "مميز" : "عادي",
      subscriptionStatus: subscription?.status || "غير نشط",
      subscriptionEndDate: subscription?.endDate || null,
      isSubscriptionExpired,
      isPremiumActive,
    });
  } catch (err: any) {
    console.error("Get property error:", err?.message);
    res.status(500).json({ error: "Failed to load property" });
  }
});

// ======================================================
// 🔄 PUT /api/owner/property - Update owner property
// ======================================================
router.put("/api/owner/property", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    if (!propertyNumber) {
      return res.status(400).json({ error: "Property not found in session" });
    }

    const updates = req.body;

    // Log property name for debugging
    console.log(`[PROPERTY_UPDATE] Property: ${propertyNumber}, Name: "${updates.name}", Length: ${updates.name?.length || 0}`);

    // Validate name length
    if (updates.name && updates.name.length > 30) {
      console.log(`[PROPERTY_UPDATE] Validation failed: name too long (${updates.name.length} chars)`);
      return res.status(400).json({ error: "اسم العقار يجب ألا يتجاوز 30 حرف" });
    }

    // Validate and normalize phone number
    if (updates.whatsappNumber) {
      try {
        updates.whatsappNumber = normalizePhoneNumber(updates.whatsappNumber);
        console.log(`[PROPERTY_UPDATE] Phone normalized to: ${updates.whatsappNumber}`);
      } catch (err: any) {
        console.log(`[PROPERTY_UPDATE] Phone validation failed: ${err.message}`);
        return res.status(400).json({ error: err.message });
      }
    }

    // جلب البيانات الحالية للمقارنة
    const currentProperty = await propertyService.getByNumber(propertyNumber);
    if (!currentProperty) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    // تتبع التغييرات الفعلية
    const changes: string[] = [];

    // مقارنة الاسم
    if (updates.name && updates.name !== currentProperty.name) {
      changes.push('تغيير الاسم');
    }

    // مقارنة الموقع
    if (updates.location && updates.location !== currentProperty.location) {
      changes.push('تحديث الموقع');
    }

    // مقارنة المدينة
    if (updates.city && updates.city !== currentProperty.city) {
      changes.push('تغيير المدينة');
    }

    // مقارنة الاتجاه
    if (updates.direction && updates.direction !== currentProperty.direction) {
      changes.push('تغيير الاتجاه');
    }

    // مقارنة النوع
    if (updates.type && updates.type !== currentProperty.type) {
      changes.push('تغيير النوع');
    }

    // مقارنة رقم الجوال
    if (updates.whatsappNumber && updates.whatsappNumber !== currentProperty.whatsappNumber) {
      changes.push('تحديث رقم الجوال');
    }

    // مقارنة المرافق
    if (updates.facilities) {
      const oldFacilities = currentProperty.facilities || [];
      const newFacilities = Array.isArray(updates.facilities) ? updates.facilities : [];
      const added = newFacilities.filter((f: string) => !oldFacilities.includes(f));
      const removed = oldFacilities.filter((f: string) => !newFacilities.includes(f));
      if (added.length > 0) changes.push(`إضافة ${added.length} مرفق`);
      if (removed.length > 0) changes.push(`حذف ${removed.length} مرفق`);
    }

    // مقارنة الأسعار
    if (updates.prices) {
      const priceChanges: string[] = [];
      if (updates.prices.weekday && updates.prices.weekday !== currentProperty.prices?.weekday) {
        priceChanges.push('وسط الأسبوع');
      }
      if (updates.prices.weekend && updates.prices.weekend !== currentProperty.prices?.weekend) {
        priceChanges.push('نهاية الأسبوع');
      }
      if (updates.prices.overnight && updates.prices.overnight !== currentProperty.prices?.overnight) {
        priceChanges.push('المبيت');
      }
      if (updates.prices.holidays && updates.prices.holidays !== currentProperty.prices?.holidays) {
        priceChanges.push('الإجازات');
      }
      if (priceChanges.length > 0) {
        changes.push(`تحديث أسعار: ${priceChanges.join('، ')}`);
      }
    }

    // إذا لم توجد تغييرات فعلية
    const changesSummary = changes.length > 0 ? changes.slice(0, 3).join(' | ') : 'تحديث عام';
    updates.lastChanges = changesSummary;

    const updated = await propertyService.update(propertyNumber, updates, { skipVerification: true });

    // === العقار الجديد: تشغيل Smart Verify تلقائياً بعد حفظ البيانات ===
    // إذا كان العقار جديد (لا اشتراك سابق) وحالة التحقق "pending" (لم يتحقق من قبل)
    // يتم تشغيل الفحص تلقائياً دون ضغط المالك على أي زر
    try {
      const currentSub = await subscriptionService.getByProperty(propertyNumber);
      const isNewProperty = !hasPriorSubscription(currentSub);
      const hasPassedVerification =
        updated.verificationStatus === "approved" ||
        updated.verificationStatus === "verified" ||
        (updated as any).smartVerificationPassed === true;

      if (isNewProperty && !hasPassedVerification) {
        const r2ImgCount = await countR2Images(propertyNumber);
        const verificationResult = await checkPropertyDataComplete(updated, r2ImgCount);

        if (verificationResult.isComplete) {
          await firebaseService.updateProperty(propertyNumber, {
            verificationStatus: "pending",
            smartVerificationPassed: true,
            smartVerificationPassedAt: new Date().toISOString(),
            smartVerificationSource: "owner_save",
          } as any);
          console.log(`✅ [Auto Verify] العقار الجديد ${propertyNumber} - البيانات مكتملة وينتظر اعتماد الإدارة`);
        } else {
          if (updated.verificationStatus !== "pending") {
            await firebaseService.updateVerificationStatus(propertyNumber, "pending");
          }
          console.log(`⏳ [Auto Verify] العقار الجديد ${propertyNumber} - بيانات ناقصة: ${verificationResult.missingFields.join(', ')}`);
        }
      }
    } catch (verifyErr) {
      console.error("Auto-verify after property update failed (non-blocking):", verifyErr);
    }

    // إرسال إشعار واتساب
    if (changes.length > 0) {
      notifyPropertyUpdate({
        propertyNumber,
        propertyName: updated.name || '',
        changes: changes.join('\n'),
      }).catch(err => console.error("WhatsApp notify error:", err));
    }

    res.json(updated);
  } catch (err: any) {
    console.error("Update property error:", err?.message);
    res.status(500).json({ error: err?.message || "فشل في تحديث البيانات" });
  }
});

// ======================================================
// 📊 GET /api/owner/analytics - Owner analytics (full)
// ======================================================
router.get("/api/owner/analytics", async (req, res) => {
  try {
    const propertyNumber = req.session.propertyNumber;
    if (!propertyNumber) {
      return res.status(401).json({ error: "NOT_LOGGED_IN" });
    }

    // 1) جلب الطلبات الحقيقية للعقار
    const requests = await analyticsService.getAllRequests();
    const propertyRequests = requests.filter(
      (r) => r.propertyNumber === propertyNumber
    );

    // 2) جلب إحصائيات الزوار الفريدة
    const analytics = await analyticsService.getAnalytics();

    const visitors = analytics?.visitors || 0;
    const mobile = analytics?.mobile || 0;
    const desktop = analytics?.desktop || 0;
    const tablet = analytics?.tablet || 0;
    const cities = analytics?.cities || "لا توجد بيانات";

    // 3) إجمالي الطلبات
    const totalRequests = propertyRequests.length;

    // 4) أعلى يوم طلب (Top Day)
    let topDay = "لا يوجد";
    if (propertyRequests.length > 0) {
      const counter: Record<string, number> = {};
      for (const r of propertyRequests) {
        const day = r.dayOfWeek || "غير معروف";
        counter[day] = (counter[day] || 0) + 1;
      }
      topDay = Object.entries(counter).sort((a, b) => b[1] - a[1])[0][0];
    }

    // 5) تحليل آخر 7 أيام لحساب النمو
    const now = new Date();
    const last7 = now.getTime() - 7 * 86400000;
    const last14 = now.getTime() - 14 * 86400000;

    const weekData = { thisWeek: 0, lastWeek: 0 };

    for (const r of propertyRequests) {
      const t = new Date(r.timestamp).getTime();
      if (t >= last7) weekData.thisWeek++;
      else if (t >= last14) weekData.lastWeek++;
    }

    const growth =
      weekData.lastWeek === 0
        ? 100
        : Math.round(
            ((weekData.thisWeek - weekData.lastWeek) / weekData.lastWeek) * 100,
          );

    // 6) حساب نسبة التفاعل
    const engagement =
      visitors === 0 ? 0 : Math.min(100, Math.round((totalRequests / visitors) * 100));

    // 7) الرد النهائي
    return res.json({
      visitors,
      mobile,
      desktop,
      tablet,
      cities,
      totalRequests,
      topDay,
      growth,
      engagement,
      lastUpdated: analytics?.lastUpdated || "",
    });
  } catch (error) {
    console.error("❌ Owner analytics error:", error);
    return res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// ======================================================
// 📋 GET /api/owner/requests - Owner's property requests
// ======================================================
router.get("/api/owner/requests", requireOwner, async (req: any, res) => {
  try {
    const propertyNumber = req.propertyNumber;
    const allRequests = await analyticsService.getAllRequests();
    const propertyRequests = allRequests
      .filter(r => r.propertyNumber === propertyNumber)
      .map(({ clientPhone: _clientPhone, ...request }) => request);
    res.json(propertyRequests);
  } catch (err) {
    res.status(500).json({ error: "فشل في جلب الطلبات" });
  }
});

// ======================================================
// 🗑️ DELETE /api/owner/requests/:id - Delete a request
// ======================================================
router.delete("/api/owner/requests/:id", requireOwner, async (req: any, res) => {
  try {
    const propertyNumber = req.propertyNumber;
    const requestId = req.params.id;
    
    await analyticsService.deleteRequest(propertyNumber, requestId);
    res.json({ success: true, message: "تم حذف الطلب بنجاح" });
  } catch (err) {
    console.error("Delete request error:", err);
    res.status(500).json({ error: "فشل في حذف الطلب" });
  }
});

// ======================================================
// 📦 GET /api/owner/current-subscription - Owner's current subscription
// ======================================================
router.get("/api/owner/current-subscription", requireOwner, async (req, res) => {
  try {
    const propertyNumber =
      req.cookies?.ownerPropertyNumber ||
      (req.session as any)?.propertyNumber;

    if (!propertyNumber) {
      return res.status(401).json({ error: "NOT_AUTHENTICATED" });
    }

    let subscription = null;
    try {
      subscription = await subscriptionService.getByProperty(propertyNumber);
    } catch (subErr: any) {
      console.error("Subscription lookup error (returning default):", subErr?.message);
    }

    if (!subscription) {
      const defaultSub = {
        id: `SUB-${propertyNumber}`,
        propertyNumber,
        packageId: "pkg-free",
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        status: "غير نشط",
        isPlaceholder: true,
      };
      return res.json(defaultSub);
    }

    let linkedToMain = null;
    if (subscription.linkedProperty) {
      const mainProperty = await firebaseService.getPropertyByNumber(subscription.linkedProperty);
      const mainSubscription = await firebaseService.getSubscriptionByPropertyNumber(subscription.linkedProperty);
      linkedToMain = {
        propertyNumber: subscription.linkedProperty,
        name: mainProperty?.name || subscription.linkedProperty,
        city: mainProperty?.city,
        subscriptionStatus: mainSubscription?.status || 'غير نشط'
      };
    }

    res.json({
      ...subscription,
      linkedToMain
    });
  } catch (err: any) {
    console.error("Get subscription error:", err?.message);
    const propertyNumber =
      req.cookies?.ownerPropertyNumber ||
      (req.session as any)?.propertyNumber || "unknown";
    res.json({
      id: `SUB-${propertyNumber}`,
      propertyNumber,
      packageId: "pkg-free",
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      status: "غير نشط",
      isPlaceholder: true,
    });
  }
});

// ======================================================
// 💰 GET /api/owner/payments - Owner's payments history
// ======================================================
router.get("/api/owner/payments", requireOwner, async (req, res) => {
  try {
    // اقرأ رقم العقار من الكوكي وليس السيشن
    const propertyNumber =
      req.cookies?.ownerPropertyNumber ||
      (req.session as any)?.propertyNumber;

    if (!propertyNumber) {
      return res.status(401).json({ error: "NOT_AUTHENTICATED" });
    }

    const payments = await paymentService.getByProperty(propertyNumber);

    res.json(payments);
  } catch (err: any) {
    console.error("Get owner payments error:", err?.message);
    res.status(500).json({ error: "Failed to load payments" });
  }
});

// ======================================================
// 📝 GET /api/owner/seo - Get SEO data
// ======================================================
router.get("/api/owner/seo", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    if (!propertyNumber) {
      return res.status(400).json({ error: "Property not found in session" });
    }

    const seo = await contentService.getPropertySeo(propertyNumber);
    res.json(seo || { propertyNumber, seoDescription: "", metaTitle: "", keywords: [] });
  } catch (err: any) {
    console.error("Get owner SEO error:", err?.message);
    res.status(500).json({ error: err?.message || "فشل في جلب بيانات SEO" });
  }
});

// ======================================================
// 📝 PUT /api/owner/seo - Update SEO data
// ======================================================
router.put("/api/owner/seo", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    if (!propertyNumber) {
      return res.status(400).json({ error: "Property not found in session" });
    }

    const { seoDescription, metaTitle, keywords } = req.body;

    // جلب بيانات العقار للتحقق من نوع الاشتراك
    const property = await propertyService.getByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    const subscription = await subscriptionService.getByProperty(propertyNumber);
    const isSubscriptionExpired = !subscription || calculateRemainingDays(subscription.endDate) < 0;
    const effectiveSubscriptionType = subscription
      ? getEffectiveSubscriptionType({
          subscriptionType: subscription.subscriptionType,
          packageType: subscription.packageType,
          price: (subscription as any).price,
        })
      : "عادي";
    const isPremium = isActivePremiumSubscription({
      subscriptionType: effectiveSubscriptionType,
      status: subscription?.status,
      isExpired: isSubscriptionExpired,
    });

    if (!isPremium && seoDescription && property.name) {
      const propertyNameNormalized = property.name.toLowerCase().trim();
      const descriptionNormalized = seoDescription.toLowerCase().trim();

      // تحقق إذا كان اسم العقار موجود في الوصف
      if (descriptionNormalized.includes(propertyNameNormalized)) {
        return res.status(400).json({
          error: "ممنوع كتابة اسم العقار في وصف SEO للاشتراكات العادية. قم بترقية اشتراكك للاستفادة من هذه الميزة.",
          code: "NAME_NOT_ALLOWED"
        });
      }
    }

    await contentService.updatePropertySeo(propertyNumber, {
      seoDescription,
      metaTitle,
      keywords,
    });

    res.json({ success: true, message: "تم تحديث وصف SEO بنجاح" });
  } catch (err: any) {
    console.error("Update owner SEO error:", err?.message);
    res.status(500).json({ error: err?.message || "فشل في تحديث وصف SEO" });
  }
});

// ======================================================
// 🔬 POST /api/owner/payment/:paymentId/rescan - Re-scan receipt with AI
// Allows both owners (for their own payments) and admins
// ======================================================
router.post("/api/owner/payment/:paymentId/rescan", async (req, res) => {
  try {
    const { paymentId } = req.params;
    const isAdmin = !!(req.session as any)?.isAdmin;
    const propertyNumber = (req.session as any)?.propertyNumber;

    // Allow admins or authenticated owners
    if (!isAdmin && !propertyNumber) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    // For owners, verify they own this payment
    let payment;
    if (!isAdmin && propertyNumber) {
      const payments = await paymentService.getByProperty(propertyNumber);
      payment = payments.find(p => p.id === paymentId);
    } else {
      // For admins, can scan any payment
      payment = await paymentService.getById(paymentId);
    }

    if (!payment) {
      return res.status(404).json({ error: "الدفعة غير موجودة" });
    }

    if (!payment.receiptUrl) {
      return res.status(400).json({ error: "لا يوجد إيصال مرفوع" });
    }

    console.log(`🔬 [AI Scanner] طلب إعادة فحص الإيصال: ${paymentId}`);

    const { scanReceiptWithAI } = await import("../integrations/aiReceiptScanner");
    const aiScanResult = await scanReceiptWithAI(
      payment.receiptUrl,
      paymentId,
      payment.finalAmount,
      payment.paymentReference
    );

    if (!aiScanResult) {
      return res.status(500).json({ error: "فشل في فحص الإيصال - تأكد من تفعيل ميزة OCR" });
    }

    console.log(`🔬 [AI Scanner] نتيجة الفحص: ${aiScanResult.recommendation}, الثقة: ${aiScanResult.confidence}%`);

    res.json({
      success: true,
      scan: {
        recommendation: aiScanResult.recommendation,
        confidence: aiScanResult.confidence,
        summary: aiScanResult.summary,
        matchScore: aiScanResult.matchAnalysis.matchScore,
        authenticityScore: aiScanResult.authenticityAnalysis.overallScore,
        extractedAmount: aiScanResult.extractedData.amount,
        extractedDate: aiScanResult.extractedData.date,
        extractedReference: aiScanResult.extractedData.paymentReference,
        extractedReceiverBank: aiScanResult.extractedData.receiverBank,
        extractedReceiverIban: aiScanResult.extractedData.receiverIban,
        imageQuality: aiScanResult.imageQuality.clarity,
        isLikelyAuthentic: aiScanResult.authenticityAnalysis.isLikelyAuthentic,
        concerns: aiScanResult.authenticityAnalysis.concerns,
        positiveIndicators: aiScanResult.authenticityAnalysis.positiveIndicators,
      }
    });
  } catch (err: any) {
    console.error("AI Scanner error:", err);
    res.status(500).json({ error: err.message || "خطأ في فحص الإيصال" });
  }
});

// ======================================================
// 💰 GET /api/owner/payment/check-pending - Check for pending payment
// ======================================================
router.get("/api/owner/payment/check-pending", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    if (!propertyNumber) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const payments = sortPaymentsNewestFirst(await paymentService.getByProperty(propertyNumber));
    const latestPayment = payments[0];

    if (!latestPayment || !OWNER_PAYMENT_ATTENTION_STATUSES.has(latestPayment.status)) {
      if (latestPayment?.status === "مرفوض") {
        return res.json({
          hasPending: false,
          payment: latestPayment,
          errorMessage: latestPayment.notes || "تم رفض الدفع. يرجى مراجعة السبب وإعادة المحاولة.",
          nextAction: latestPayment.notes?.includes("بيانات العقار")
            ? "أكمل بيانات العقار ثم أعد محاولة الدفع."
            : "ارفع إيصال تحويل صحيح وواضح.",
          nextUrl: latestPayment.notes?.includes("بيانات العقار")
            ? "/owner/update-property"
            : "/owner/subscription",
          actionLabel: latestPayment.notes?.includes("بيانات العقار")
            ? "تعديل بيانات العقار"
            : "رفع إيصال جديد",
        });
      }
      return res.json({ hasPending: false });
    }

    const pendingPayment = latestPayment;

    // Auto-check for issues
    const issues: string[] = [];

    if (pendingPayment.paymentMethod === "تحويل بنكي" && !pendingPayment.receiptUrl) {
      issues.push("لم يتم رفع إيصال التحويل");
    }

    if (!pendingPayment.finalAmount || pendingPayment.finalAmount <= 0) {
      issues.push("المبلغ غير صحيح");
    }

    if (!pendingPayment.packageId) {
      issues.push("لم يتم تحديد الباقة");
    }

    const paymentDate = new Date(pendingPayment.createdAt || "");
    const daysSincePayment = Math.floor((Date.now() - paymentDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSincePayment > 7) {
      issues.push(`الدفع معلق منذ ${daysSincePayment} يوم - قد تحتاج المتابعة`);
    }

    return res.json({
      hasPending: true,
      payment: pendingPayment,
      autoCheckPassed: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
      nextAction: pendingPayment.notes?.includes("بيانات العقار")
        ? "أكمل بيانات العقار ثم شغّل التحقق من صفحة الاشتراك."
        : undefined,
      nextUrl: pendingPayment.notes?.includes("بيانات العقار")
        ? "/owner/update-property"
        : undefined,
      actionLabel: pendingPayment.notes?.includes("بيانات العقار")
        ? "تعديل بيانات العقار"
        : undefined,
    });
  } catch (err: any) {
    console.error("Check pending payment error:", err);
    res.status(500).json({ error: "خطأ في التحقق من الدفع" });
  }
});

// ======================================================
// 💰 POST /api/owner/payment/bank-transfer - Submit bank transfer with receipt
// ======================================================
router.post("/api/owner/payment/bank-transfer", upload.single("receipt"), async (req, res) => {
  try {
    const { propertyNumber, packageId, discountCode, action, secondPropertyNumber, additionalProperties } = req.body;
    const isAddon = action === "addon";

    if (!propertyNumber) {
      return res.status(400).json({ error: "رقم العقار مطلوب" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "الإيصال مطلوب" });
    }

    // Get package and property
    const pkg = await firebaseService.getPurchasablePackageById(packageId);
    if (!pkg) return res.status(404).json({ error: "الباقة غير موجودة" });

    const property = await firebaseService.getPropertyByNumber(propertyNumber);
    if (!property) return res.status(404).json({ error: "العقار غير موجود" });

    const currentSubscriptionForAction = await subscriptionService.getByProperty(propertyNumber);
    if (!isAddon) {
      const actionValidation = validatePaymentSubscriptionAction(action, currentSubscriptionForAction);
      if (!actionValidation.ok) {
        return res.status(actionValidation.status).json({
          error: actionValidation.error,
          nextAction: actionValidation.nextAction,
          nextUrl: actionValidation.nextUrl,
          actionLabel: actionValidation.actionLabel,
        });
      }
    }

    // Handle multiple additional properties
    let allAdditionalProps: string[] = [];
    
    // Parse additionalProperties if it's a string (JSON stringified from frontend)
    if (additionalProperties) {
      if (typeof additionalProperties === 'string') {
        try {
          allAdditionalProps = JSON.parse(additionalProperties);
        } catch (e) {
          console.log("[BANK_TRANSFER] Failed to parse additionalProperties:", additionalProperties);
          allAdditionalProps = [];
        }
      } else if (Array.isArray(additionalProperties)) {
        allAdditionalProps = additionalProperties;
      }
    }
    
    // Parse secondPropertyNumber if it's a string
    let parsedSecondPropertyNumber = secondPropertyNumber;
    if (typeof secondPropertyNumber === 'string') {
      try {
        parsedSecondPropertyNumber = JSON.parse(secondPropertyNumber);
      } catch (e) {
        // Keep as is
      }
    }
    
    allAdditionalProps = normalizeLinkedPropertyNumbers(
      { additionalProperties: allAdditionalProps, secondPropertyNumber: parsedSecondPropertyNumber },
      propertyNumber,
    );
    
    // Calculate final price based on number of properties
    // Pricing model: 50 SAR for main property + 25 SAR for each additional property
    const basePrice = pkg.price || 0;
    const additionalPropertyCount = allAdditionalProps.length;
    
    let finalAmount;
    if (additionalPropertyCount > 0) {
      // Formula: pkg-price + (addedPropertyCount * propertyPrice)
      const propertyPrice = basePrice || 25;
      finalAmount = basePrice + (additionalPropertyCount * propertyPrice);
    } else if (pkg.pricePerProperty && pkg.pricePerProperty > 0) {
      // For multi-property packages without additional props selected
      finalAmount = pkg.pricePerProperty;
    } else {
      // Regular package price (just the first property)
      finalAmount = basePrice;
    }
    
    // Apply discount
    if (discountCode) {
      const discount = await firebaseService.getDiscountCodeByCode(discountCode);
      if (discount && discount.isActive) {
        if (discount.type === "نسبة") {
          finalAmount -= (finalAmount * discount.value) / 100;
        } else {
          finalAmount -= discount.value;
        }
      }
    }

    // Upload receipt to R2
    let receiptUrl = "";
    if (req.file && R2_BUCKET && r2) {
      const isPdf = req.file.mimetype === 'application/pdf';
      const ext = isPdf ? 'pdf' : 'jpg';
      const contentType = isPdf ? 'application/pdf' : 'image/jpeg';
      const receiptKey = `receipts/${propertyNumber}-${Date.now()}.${ext}`;
      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: receiptKey,
          Body: req.file.buffer,
          ContentType: contentType,
        })
      );
      receiptUrl = `${R2_PUBLIC_URL}/${receiptKey}`;
    }

    // Generate payment reference
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let paymentReference = 'RWQN-';
    for (let i = 0; i < 6; i++) {
      paymentReference += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    // Create payment record
    // Status: "قيد المراجعة" — بانتظار فحص AI للإيصال، وليس بانتظار مراجعة يدوية
    console.log(`[BANK_TRANSFER] Creating payment for propertyNumber: "${propertyNumber}", packageId: "${packageId}"`);
    const payment = await paymentService.create({
      propertyNumber,
      packageId,
      amount: finalAmount,
      discountCode: discountCode || "",
      discountAmount: 0,
      finalAmount,
      status: "قيد المراجعة",
      paymentMethod: "تحويل بنكي",
      receiptUrl,
      action: (action as any) || "new",
      secondPropertyNumber: parsedSecondPropertyNumber || undefined,
      additionalProperties: allAdditionalProps.length > 0 ? allAdditionalProps : undefined,
      linkedProperties: allAdditionalProps.length > 0 ? allAdditionalProps : undefined,
      paymentReference,
    } as any);
    console.log(`[BANK_TRANSFER] ✅ Payment created: ${payment.id} for property: ${propertyNumber}, package: ${packageId}`);


    // Handle add-on purchase
    if (isAddon) {
      await addOnService.purchase({
        propertyNumber,
        addOnPackageId: packageId,
        status: "pending",
        paymentId: payment.id,
        source: "bank_transfer",
      });

      await addOnService.logHistory({
        propertyNumber,
        addOnPackageId: packageId,
        action: "purchased",
        notes: "تحويل بنكي - بانتظار المراجعة",
        timestamp: new Date().toISOString(),
        createdBy: "owner",
      });

      return res.json({ ok: true, paymentId: payment.id });
    }

    // Send notification for new subscription
    if (!action || action === 'new') {
      try {
        await notifyNewPayment({
          propertyNumber,
          propertyName: property.name || "",
          amount: finalAmount,
          paymentMethod: "تحويل بنكي",
          transactionId: payment.id,
        });
      } catch (notifyErr) {
        console.error("Failed to send payment notification:", notifyErr);
      }
    }

    // Handle extension/upgrade - save pending subscription data
    if (!isAddon && (action === 'extend' || action === 'upgrade')) {
      const { startDate: bankStartDate, endDate: bankEndDate } = calculateActionDates(
        action,
        currentSubscriptionForAction,
        pkg.duration,
      );

      await paymentService.update(payment.id, {
        action: action,
        pendingStartDate: formatDateRiyadh(bankStartDate),
        pendingEndDate: formatDateRiyadh(bankEndDate),
      });


      // Send WhatsApp notification for receipt upload
      notifyReceiptUpload({
        propertyNumber,
        propertyName: property.name || "",
        ownerPhone: property.whatsappNumber || "",
        receiptUrl,
      }).catch(err => console.error("WhatsApp notify error:", err));
    }

    // AI Receipt Scanning — تأكيد الدفع فقط، ثم التحقق الإجباري من بيانات العقار
    let aiScanResult: Awaited<ReturnType<typeof scanReceiptWithAI>> | null = null;
    let autoActivated = false;
    let verificationMissingFields: string[] = [];
    let pendingManualReview = false;
    let paymentRejected = false;
    let pendingAdminApproval = false;
    let responseMessage = "تم استلام إيصال التحويل وسيتم تحديث حالة الدفع بعد التحقق.";
    let nextAction: string | undefined;
    let nextUrl: string | undefined;
    let actionLabel: string | undefined;
    let unlinkedProperties: string[] = [];
    try {
      aiScanResult = await scanReceiptWithAI(
        receiptUrl,
        payment.id,
        finalAmount,
        paymentReference
      );

      if (aiScanResult?.recommendation === "تفعيل_تلقائي") {
        await paymentService.setStatus(payment.id, "نجح - قيد التحقق");
        const r2ImgCount = await countR2Images(propertyNumber);
        const propertyComplete = await checkPropertyDataComplete(property, r2ImgCount);

        if (propertyComplete.isComplete) {
          const currentSubscription = currentSubscriptionForAction || await subscriptionService.getByProperty(propertyNumber);
          const activationDates = calculateActionDates(action, currentSubscription, pkg.duration);
          const paymentForActivation = {
            ...payment,
            action: (action as any) || "new",
            additionalProperties: allAdditionalProps.length > 0 ? allAdditionalProps : undefined,
            secondPropertyNumber: parsedSecondPropertyNumber || undefined,
          } as any;

          if (!hasPriorSubscription(currentSubscription)) {
            const queued = await queueVerifiedNewPropertyForAdminApproval({
              payment: paymentForActivation,
              property,
              pkg,
              startDate: activationDates.startDate,
              endDate: activationDates.endDate,
              finalAmount,
            });
            unlinkedProperties = queued.unlinkedProperties;
            pendingAdminApproval = true;
            responseMessage = "تم التحقق من الإيصال وبيانات العقار. بما أن العقار جديد، سيبقى الطلب بانتظار اعتماد الإدارة قبل تفعيل الاشتراك.";
            nextAction = "لا يلزمك إجراء إضافي الآن. ستصلك رسالة بعد اعتماد الإدارة وتفعيل الاشتراك.";
            nextUrl = "/owner/dashboard";
            actionLabel = "متابعة الحالة";

            let adminNotification =
              `🆕 *عقار جديد مدفوع - بانتظار اعتماد الإدارة*\n\n` +
              `📍 العقار: ${property.name}\n` +
              `🔢 رقم العقار: ${propertyNumber}\n` +
              `📦 الباقة: ${pkg.name}\n` +
              `💵 المبلغ: ${finalAmount} ر.س\n` +
              `📅 من: ${queued.startDate}\n` +
              `📅 إلى: ${queued.endDate}\n` +
              `🔬 نسبة التطابق: ${aiScanResult.matchAnalysis.matchScore}%\n` +
              `📊 Smart Verify: ✅ البيانات مكتملة\n\n` +
              `⏳ المطلوب: اعتماد العقار من لوحة الإدارة ليتم تفعيل الاشتراك.`;

            if (queued.linkedProperties.length > 0) {
              adminNotification += `\n🏠 العقارات المرتبطة عند الاعتماد: ${queued.linkedProperties.join("، ")}\n`;
            }
            if (queued.unlinkedProperties.length > 0) {
              adminNotification += `\n⚠️ تم فصل عقارات لا تدعمها الباقة الجديدة: ${queued.unlinkedProperties.join("، ")}\n`;
            }

            await sendWhatsAppNotification(adminNotification).catch(err => console.error("WhatsApp notify error:", err));

            if (property.whatsappNumber) {
              await sendOwnerWhatsApp(
                property.whatsappNumber,
                `تم التحقق من إيصال التحويل وبيانات العقار ${property.name || propertyNumber} بنجاح.\n\nلأن العقار جديد، سيبقى الطلب بانتظار اعتماد الإدارة قبل تفعيل الاشتراك.\n\nالخطوة التالية: لا يلزمك إجراء إضافي الآن، وسنبلغك عند الاعتماد.`,
              ).catch(err => console.error("Owner pending approval notification error:", err));
            }
          } else {
            const activation = await activateVerifiedPaymentSubscription({
              payment: paymentForActivation,
              property,
              pkg,
              receiptUrl,
              startDate: activationDates.startDate,
              endDate: activationDates.endDate,
              finalAmount,
            });
            unlinkedProperties = activation.unlinkedProperties;
            await paymentService.setStatus(payment.id, "مكتمل");
            autoActivated = true;
            responseMessage = "تم التحقق من الإيصال وبيانات العقار وتفعيل الاشتراك تلقائياً.";

            let adminNotification =
              `🤖 *تفعيل تلقائي - تحويل بنكي*\n\n` +
              `📍 العقار: ${property.name}\n` +
              `🔢 رقم العقار: ${propertyNumber}\n` +
              `📦 الباقة: ${pkg.name}\n` +
              `💵 المبلغ: ${finalAmount} ر.س\n` +
              `📅 من: ${activation.startDate}\n` +
              `📅 إلى: ${activation.endDate}\n` +
              `🔬 نسبة التطابق: ${aiScanResult.matchAnalysis.matchScore}%\n` +
              `📊 حالة التحقق: ✅ معتمد\n`;

            if (activation.linkedProperties.length > 0) {
              adminNotification += `\n🏠 العقارات المرتبطة: ${activation.linkedProperties.join("، ")}\n`;
            }
            if (activation.unlinkedProperties.length > 0) {
              adminNotification += `\n⚠️ تم فصل عقارات لا تدعمها الباقة الجديدة: ${activation.unlinkedProperties.join("، ")}\n`;
            }

            adminNotification += `\n✅ تم التحقق من بيانات العقار وتفعيل الاشتراك`;

            await sendWhatsAppNotification(adminNotification).catch(err => console.error("WhatsApp notify error:", err));

            if (property.whatsappNumber) {
              try {
                await notifyOwnerSubscriptionActivated({
                  ownerPhone: property.whatsappNumber,
                  propertyNumber: propertyNumber,
                  propertyName: property.name || "",
                  endDate: activation.endDate,
                });
              } catch (ownerErr) {
                console.error("Owner notification error:", ownerErr);
              }
            }
          }
        } else {
          verificationMissingFields = propertyComplete.missingFields;
          pendingManualReview = true;
          responseMessage = `بيانات العقار غير مكتملة: ${propertyComplete.missingFields.join("، ")}`;
          nextAction = "أكمل بيانات العقار والصور. ستراجع الإدارة الطلب، ويمكنك إعادة تشغيل التحقق بعد التعديل.";
          nextUrl = "/owner/update-property";
          actionLabel = "تعديل بيانات العقار";
          await paymentService.update(payment.id, {
            status: "قيد المراجعة" as any,
            notes: `بيانات العقار غير مكتملة: ${propertyComplete.missingFields.join('، ')}`
          });
          await firebaseService.updateVerificationStatus(propertyNumber, "pending");

          await sendWhatsAppNotification(
            `⚠️ *تحويل بنكي - Smart Verify يحتاج مراجعة*\n\n` +
            `📍 العقار: ${property.name}\n` +
            `🔢 رقم العقار: ${propertyNumber}\n` +
            `📦 الباقة: ${pkg.name}\n` +
            `💵 المبلغ: ${finalAmount} ر.س\n` +
            `🧾 رقم المرجع: ${paymentReference}\n` +
            `🔬 نسبة التطابق: ${aiScanResult?.matchAnalysis?.matchScore || 0}%\n` +
            `📋 سبب المراجعة: بيانات العقار غير مكتملة\n` +
            `📌 الحقول الناقصة: ${propertyComplete.missingFields.join("، ")}\n\n` +
            `⚠️ يرجى مراجعة الطلب بعد تعديل بيانات العقار`
          ).catch(err => console.error("WhatsApp notify error:", err));

          if (property.whatsappNumber) {
            await sendOwnerWhatsApp(
              property.whatsappNumber,
              `تعذر إكمال التحقق لعقارك ${property.name || propertyNumber} لأن البيانات غير مكتملة.\n\nالحقول المطلوبة: ${propertyComplete.missingFields.join("، ")}\n\nالخطوة التالية: افتح صفحة تعديل بيانات العقار وأكمل البيانات والصور. الدفعة لم تُرفض، وستبقى بانتظار المراجعة بعد التعديل.`,
            ).catch(err => console.error("Owner rejection notification error:", err));
          }
        }
      } else if (aiScanResult?.recommendation === "رفض") {
        pendingManualReview = true;
        responseMessage = "إيصال التحويل يحتاج مراجعة يدوية لأنه غير واضح أو غير مطابق لبيانات الدفع المطلوبة.";
        nextAction = "ارفع إيصال تحويل صحيح يظهر المبلغ والجهة المستفيدة بوضوح.";
        nextUrl = "/owner/subscription";
        actionLabel = "رفع إيصال جديد";
        await paymentService.update(payment.id, {
          status: "قيد المراجعة" as any,
          notes: aiScanResult.summary || "إيصال التحويل غير واضح أو غير مطابق - يحتاج مراجعة يدوية",
        });

        await sendWhatsAppNotification(
          `⚠️ *تحويل بنكي - إيصال يحتاج مراجعة يدوية*\n\n` +
          `📍 العقار: ${property.name}\n` +
          `🔢 رقم العقار: ${propertyNumber}\n` +
          `📦 الباقة: ${pkg.name}\n` +
          `💵 المبلغ: ${finalAmount} ر.س\n` +
          `🧾 رقم المرجع: ${paymentReference}\n` +
          `📋 السبب: ${aiScanResult.summary || "الإيصال غير مطابق لبيانات الدفع"}`
        ).catch(err => console.error("WhatsApp notify error:", err));

        if (property.whatsappNumber) {
          await sendOwnerWhatsApp(
            property.whatsappNumber,
            `إيصال التحويل للعقار ${property.name || propertyNumber} يحتاج مراجعة لأنه غير واضح أو غير مطابق لبيانات الدفع المطلوبة.\n\nالخطوة التالية: يمكنك رفع إيصال تحويل صحيح وواضح من صفحة الاشتراك لتسريع المراجعة.`,
          ).catch(err => console.error("Owner receipt rejection notification error:", err));
        }
      } else {
        pendingManualReview = true;
        responseMessage = "تعذر التحقق من الإيصال تلقائياً، وسيتم تحويله للمراجعة اليدوية.";
        nextAction = "انتظر مراجعة الإدارة أو ارفع إيصالاً أوضح إذا كان الإيصال الحالي غير واضح.";
        nextUrl = "/owner/subscription";
        actionLabel = "رفع إيصال جديد";
        await paymentService.update(payment.id, {
          status: "قيد المراجعة" as any,
          notes: aiScanResult?.summary || "فشل فحص الإيصال - يحتاج مراجعة يدوية"
        });

        await sendWhatsAppNotification(
          `⚠️ *تحويل بنكي - يحتاج مراجعة يدوية*\n\n` +
          `📍 العقار: ${property.name}\n` +
          `🔢 رقم العقار: ${propertyNumber}\n` +
          `📦 الباقة: ${pkg.name}\n` +
          `💵 المبلغ: ${finalAmount} ر.س\n` +
          `🧾 رقم المرجع: ${paymentReference}\n\n` +
          `⚠️ تعذر التحقق من الإيصال تلقائياً — يرجى المراجعة اليدوية`
        ).catch(err => console.error("WhatsApp notify error:", err));
      }
    } catch (aiErr) {
      console.error("AI Scanner error:", aiErr);
      pendingManualReview = true;
      responseMessage = "حدث خطأ أثناء فحص الإيصال، وسيتم تحويله للمراجعة اليدوية.";
      nextAction = "انتظر مراجعة الإدارة أو أعد رفع إيصال أوضح من صفحة الاشتراك.";
      nextUrl = "/owner/subscription";
      actionLabel = "رفع إيصال جديد";
      await paymentService.update(payment.id, {
        status: "قيد المراجعة" as any,
        notes: "خطأ في فحص الإيصال - يحتاج مراجعة يدوية"
      });

      await sendWhatsAppNotification(
        `⚠️ *تحويل بنكي - خطأ في فحص الإيصال*\n\n` +
        `📍 العقار: ${property.name}\n` +
        `🔢 رقم العقار: ${propertyNumber}\n` +
        `📦 الباقة: ${pkg.name}\n` +
        `💵 المبلغ: ${finalAmount} ر.س\n` +
        `🧾 رقم المرجع: ${paymentReference}\n\n` +
        `⚠️ حدث خطأ أثناء فحص الإيصال — يرجى المراجعة اليدوية`
      ).catch(err => console.error("WhatsApp notify error:", err));
    }

    res.json({
      ok: true,
      paymentId: payment.id,
      autoActivated: autoActivated,
      verificationFailed: !autoActivated && verificationMissingFields.length > 0,
      paymentRejected,
      message: responseMessage,
      missingFields: verificationMissingFields.length > 0 ? verificationMissingFields : undefined,
      pendingManualReview,
      pendingAdminApproval,
      nextAction,
      nextUrl,
      actionLabel,
      unlinkedProperties: unlinkedProperties.length > 0 ? unlinkedProperties : undefined,
      aiScan: aiScanResult ? {
        recommendation: aiScanResult.recommendation,
        confidence: aiScanResult.confidence,
        summary: aiScanResult.summary,
        matchScore: aiScanResult.matchAnalysis.matchScore,
        authenticityScore: aiScanResult.authenticityAnalysis.overallScore,
      } : null
    });
  } catch (err: any) {
    console.error("Bank transfer error:", err);
    res.status(500).json({ error: "خطأ في معالجة التحويل البنكي" });
  }
});


router.get("/api/owner/r2-images", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber;

    if (!r2 || !propertyNumber || !R2_BUCKET) {
      console.error("❌ [FETCH] Missing propertyNumber or R2_BUCKET");
      return res.json({ images: [] });
    }

    if (!r2) return res.json({ images: [] });
    const list = await r2.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: `${propertyNumber}/`,
        MaxKeys: 100,
      })
    );

    const count = list.Contents?.length || 0;

    let images =
      list.Contents?.map(obj => `${R2_PUBLIC_URL}/${obj.Key}`) || [];

    images.sort((a, b) => {
      const aParts = a.split("/").pop() || "";
      const bParts = b.split("/").pop() || "";
      const na = parseInt(aParts.replace(".jpg", "")) || 0;
      const nb = parseInt(bParts.replace(".jpg", "")) || 0;
      return na - nb;
    });

    res.json({ images });

  } catch (err: any) {
    res.json({ images: [] });
  }
});

// ======================================================
// 📸 POST /api/owner/images - Upload property images to R2
// ======================================================
router.post("/api/owner/images", requireOwner, uploadImages.array("images"), async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber || "";


    if (!propertyNumber) {
      return res.status(400).json({ error: "Property number not found in session" });
    }

    if (!r2 || !R2_BUCKET) {
      return res.status(500).json({ error: "R2 bucket not configured" });
    }

    const files = (req.files as any) || [];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "لا توجد صور تم رفعها" });
    }

    const uploadedKeys: string[] = [];
    const timestamp = Date.now();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const key = `${propertyNumber}/${timestamp}-${i}.jpg`;

      if (r2) {
        await r2.send(
          new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
            Body: file.buffer,
            ContentType: "image/jpeg",
            ACL: "public-read",
          })
        );
      }
      uploadedKeys.push(key);
    }

    const uploadedUrls = uploadedKeys.map(key => `${R2_PUBLIC_URL}/${key}`);

    const changeNote = `إضافة ${files.length} صورة جديدة`;
    await storage.updateProperty(propertyNumber, { lastChanges: changeNote });

    const property = await storage.getPropertyByNumber(propertyNumber);
    notifyPropertyUpdate({
      propertyNumber,
      propertyName: property?.name || '',
      changes: changeNote,
    }).catch(err => console.error("WhatsApp notify error:", err));

    res.json({ ok: true, count: files.length, uploaded: uploadedKeys, urls: uploadedUrls });

  } catch (err: any) {
    let errorMsg = err?.message || "تعذر رفع الصور";
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        errorMsg = "حجم الصورة كبير جداً. الحجم الأقصى المسموح به هو 2 ميجابايت لكل صورة";
      } else {
        errorMsg = "حدث خطأ أثناء رفع الملف. يرجى التحقق من الملف والمحاولة مرة أخرى";
      }
    } else if (errorMsg.includes("File too large")) {
      errorMsg = "حجم الصورة كبير جداً. الحجم الأقصى المسموح به هو 2 ميجابايت لكل صورة";
    }
    res.status(500).json({ error: errorMsg });
  }
});

// ======================================================
// 🗑️ POST /api/owner/images/delete - Delete property image from R2
// ======================================================
router.post("/api/owner/images/delete", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber || "";
    const { url, imageUrl } = req.body;
    const imageUrlToDelete = url || imageUrl;

    if (!imageUrlToDelete) {
      return res.status(400).json({ error: "URL مطلوبة" });
    }

    const key = `${propertyNumber}/${imageUrlToDelete.split("/").pop()}`;

    if (r2) {
      await r2.send(
        new DeleteObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
        })
      );
    }

    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "حدث خطأ أثناء حذف الصورة. يرجى المحاولة مرة أخرى" });
  }
});

router.post("/api/owner/property/activate", requireOwner, async (req, res) => {
  let fulfillmentClaim: { paymentId: string; token: string } | null = null;
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    if (!propertyNumber) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const requestedStatus = req.body.status || 'approved';
    const property = await propertyService.getByNumber(propertyNumber);
    
    if (!property) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    // Owner requesting rejection sets to pending - admin decides final status
    if (requestedStatus === 'rejected') {
      await firebaseService.updateVerificationStatus(propertyNumber, "pending");

      return res.json({
        success: true,
        message: "تم تحديث حالة العقار إلى قيد المراجعة",
        status: 'pending'
      });
    }

    const payments = await paymentService.getByProperty(propertyNumber);

    const completedPayment = payments.find(p => p.status === "مكتمل");
    const bankTransferPayment = payments.find(p => p.status === "قيد التحقق" && p.paymentMethod === "تحويل بنكي");
    const cardPendingPayment = payments.find(p => p.status === "قيد المراجعة" && (p.paymentMethod === "بطاقة" || p.paymentMethod === "Apple Pay"));

    let pendingPayment = completedPayment || bankTransferPayment;
    let isBankTransfer = !!bankTransferPayment && !completedPayment;

    if (!pendingPayment) {
      const currentSubscription = await subscriptionService.getByProperty(propertyNumber);
      const isNewProperty = !hasPriorSubscription(currentSubscription);
      const freePkg = await firebaseService.getPurchasablePackageById("pkg-free");

      const currentStatus = property.verificationStatus || "pending";

      if (currentStatus === "approved") {
        return res.json({
          success: true,
          message: "تم التحقق من بيانات العقار - العقار معتمد مسبقاً",
          alreadyApproved: true,
          verificationOnly: true
        });
      }

      if (currentStatus === "pending") {
        return res.json({
          success: true,
          message: "عقارك قيد المراجعة مسبقاً",
          alreadyPending: true,
          verificationOnly: true
        });
      }

      if (!freePkg) {
        await firebaseService.updateVerificationStatus(propertyNumber, "approved");
        return res.json({
          success: true,
          message: "تم التحقق من بيانات العقار بنجاح",
          verificationOnly: true
        });
      }

      if (isNewProperty) {
        await firebaseService.updateVerificationStatus(propertyNumber, "pending");

        await sendWhatsAppNotification(
          `🆕 *طلب عقار جديد - اشتراك مجاني*\n\n` +
          `📍 العقار: ${property.name}\n` +
          `🔢 رقم العقار: ${propertyNumber}\n` +
          `📦 الباقة: ${freePkg.name}\n` +
          `🏷️ نوع الاشتراك: عادي (مجاني)\n\n` +
          `⏳ يحتاج موافقة الإدارة لتفعيل الاشتراك`
        );

        return res.json({
          success: true,
          message: "عقارك قيد المراجعة",
          pendingAdminApproval: true,
          subscriptionActivated: false,
          isNewFreeProperty: true
        });
      }

      await firebaseService.updateVerificationStatus(propertyNumber, "approved");
      
      return res.json({
        success: true,
        message: "تم التحقق من بيانات العقار بنجاح",
        verificationOnly: true,
        paymentPending: false
      });
    }

    const pkg = await storage.getPackageById(pendingPayment.packageId);
    const paymentStatus = pendingPayment.status;
    const currentSubscriptionForActivation = await subscriptionService.getByProperty(propertyNumber);
    const isNewPropertyForActivation = !hasPriorSubscription(currentSubscriptionForActivation);
    const isPartialFulfillment =
      !pendingPayment.fulfilledAt &&
      currentSubscriptionForActivation?.paymentId === pendingPayment.id;

    if (pendingPayment.fulfilledAt) {
      if (property.verificationStatus !== "approved") {
        await firebaseService.updateVerificationStatus(propertyNumber, "approved");
      }
      return res.json({
        success: true,
        message: "تم تفعيل هذه الدفعة مسبقاً",
        alreadyActivated: true,
        subscriptionActivated: true,
        endDate: currentSubscriptionForActivation?.endDate || null,
      });
    }

    if (isLegacyPaymentFulfillment(pendingPayment, currentSubscriptionForActivation)) {
      const claimResult = await firebaseService.claimPaymentFulfillment(pendingPayment.id);
      if (claimResult.status === "processing") {
        return res.status(409).json({ error: "تفعيل هذه الدفعة قيد التنفيذ بالفعل" });
      }
      if (claimResult.status === "fulfilled") {
        if (property.verificationStatus !== "approved") {
          await firebaseService.updateVerificationStatus(propertyNumber, "approved");
        }
        return res.json({
          success: true,
          message: "تم تفعيل هذه الدفعة مسبقاً",
          alreadyActivated: true,
          subscriptionActivated: true,
          endDate: currentSubscriptionForActivation?.endDate || null,
        });
      }

      fulfillmentClaim = { paymentId: pendingPayment.id, token: claimResult.token };
      const hasLinkedGroup = Boolean((pendingPayment as any).secondPropertyNumber) ||
        normalizeLinkedPropertyNumbers(pendingPayment as any, propertyNumber).length > 0 ||
        (currentSubscriptionForActivation?.linkedProperties?.length || 0) > 0;
      if (claimResult.previousState === undefined && !hasLinkedGroup) {
        await firebaseService.completePaymentFulfillment(
          pendingPayment.id,
          claimResult.token,
          currentSubscriptionForActivation?.id || `SUB-${propertyNumber}`,
        );
        fulfillmentClaim = null;
        if (property.verificationStatus !== "approved") {
          await firebaseService.updateVerificationStatus(propertyNumber, "approved");
        }
        return res.json({
          success: true,
          message: "تم تفعيل هذه الدفعة مسبقاً",
          alreadyActivated: true,
          subscriptionActivated: true,
          endDate: currentSubscriptionForActivation?.endDate || null,
        });
      }

      await firebaseService.releasePaymentFulfillment(
        pendingPayment.id,
        claimResult.token,
      );
      fulfillmentClaim = null;
    }

    const pendingAction = pendingPayment.action || "new";
    if (!["new", "extend", "upgrade"].includes(pendingAction)) {
      return res.status(400).json({ error: "إجراء الدفعة غير صالح" });
    }
    if (isActiveSubscription(currentSubscriptionForActivation) && !isPartialFulfillment) {
      const actionValidation = validatePaymentSubscriptionAction(
        pendingAction,
        currentSubscriptionForActivation,
      );
      if (!actionValidation.ok) {
        return res.status(actionValidation.status).json({
          error: actionValidation.error,
          nextAction: actionValidation.nextAction,
          nextUrl: actionValidation.nextUrl,
          actionLabel: actionValidation.actionLabel,
        });
      }
    }

    const canAutoActivate = !isBankTransfer && !isNewPropertyForActivation && (
      paymentStatus === "مكتمل" ||
      paymentStatus === "completed"
    );

    if (canAutoActivate) {

      if (!pkg) {
        return res.status(404).json({ error: "الباقة غير موجودة" });
      }

      const claimResult = await firebaseService.claimPaymentFulfillment(pendingPayment.id);
      if (claimResult.status === "fulfilled") {
        return res.json({
          success: true,
          message: "تم تفعيل هذه الدفعة مسبقاً",
          alreadyActivated: true,
          subscriptionActivated: true,
        });
      }
      if (claimResult.status === "processing") {
        return res.status(409).json({ error: "تفعيل هذه الدفعة قيد التنفيذ بالفعل" });
      }
      fulfillmentClaim = { paymentId: pendingPayment.id, token: claimResult.token };

      const calculatedDates = calculateActionDates(
        pendingPayment.action,
        currentSubscriptionForActivation,
        pkg.duration,
      );
      const pendingStartDate = pendingPayment.pendingStartDate
        ? new Date(pendingPayment.pendingStartDate)
        : null;
      const pendingEndDate = pendingPayment.pendingEndDate
        ? new Date(pendingPayment.pendingEndDate)
        : null;
      const startDate = pendingStartDate && Number.isFinite(pendingStartDate.getTime())
        ? pendingStartDate
        : calculatedDates.startDate;
      const endDate = pendingEndDate && Number.isFinite(pendingEndDate.getTime())
        ? pendingEndDate
        : calculatedDates.endDate;

      const isPremiumApproval = isPremiumSubscriptionType(pkg.type) || pendingPayment.finalAmount > 0;

      const subscriptionData = {
        packageId: pkg.id,
        price: pendingPayment.finalAmount,
        subscriptionType: isPremiumApproval ? "مميز" : "عادي",
        packageType: isPremiumApproval ? "مميز" : "عادي",
        startDate: formatDateRiyadh(startDate),
        endDate: formatDateRiyadh(endDate),
        paymentId: pendingPayment.id,
      };

      await firebaseService.addSubscriptionToSheet(
        propertyNumber,
        subscriptionData,
        property,
        pendingPayment.receiptUrl || ""
      );

      if ((pendingPayment as any).secondPropertyNumber) {
        const secondProperty = await firebaseService.getPropertyByNumber((pendingPayment as any).secondPropertyNumber);
        if (secondProperty) {
          const pricePerProperty = pendingPayment.finalAmount / 2;
          const secondSubscriptionData = {
            ...subscriptionData,
            price: pricePerProperty,
            linkedProperty: propertyNumber,
          };
          await firebaseService.addSubscriptionToSheet(
            (pendingPayment as any).secondPropertyNumber,
            secondSubscriptionData,
            secondProperty,
            pendingPayment.receiptUrl || ""
          );

          await syncMultiPropertyRecord({
            mainPropertyNumber: propertyNumber,
            linkedProperties: [(pendingPayment as any).secondPropertyNumber],
            packageId: pkg.id,
            startDate: formatDateRiyadh(startDate),
            endDate: formatDateRiyadh(endDate),
            paymentId: pendingPayment.id,
          });
        }
      }

      await firebaseService.updateVerificationStatus(propertyNumber, "approved");
      if ((pendingPayment as any).secondPropertyNumber) {
        await firebaseService.updateVerificationStatus((pendingPayment as any).secondPropertyNumber, "approved");
      }

      await firebaseService.completePaymentFulfillment(
        pendingPayment.id,
        fulfillmentClaim.token,
        `SUB-${propertyNumber}`,
      );
      fulfillmentClaim = null;

      await sendWhatsAppNotification(
        `🎉 *تم تفعيل الاشتراك بنجاح*\n\n` +
        `📍 العقار: ${property.name}\n` +
        `🔢 رقم العقار: ${propertyNumber}\n` +
        `📦 الباقة: ${pkg.name}\n` +
        `💵 المبلغ: ${pendingPayment.finalAmount} ر.س\n` +
        `📅 من: ${subscriptionData.startDate}\n` +
        `📅 إلى: ${subscriptionData.endDate}\n` +
        `🏷️ نوع الاشتراك: ${pkg.type}\n\n` +
        `✅ تم التحقق من البيانات وتفعيل الاشتراك`
      );

      if (property.whatsappNumber) {
        try {
          await notifyOwnerSubscriptionActivated({
            ownerPhone: property.whatsappNumber,
            propertyNumber: propertyNumber,
            propertyName: property.name || "",
            endDate: subscriptionData.endDate,
          });
        } catch (ownerErr) {
          console.error(`❌ Failed to send owner notification: ${propertyNumber}`, ownerErr);
        }
      }

      return res.json({
        success: true,
        message: "تم تفعيل الاشتراك بنجاح",
        isBankTransfer: isBankTransfer,
        pendingAdminApproval: false,
        subscriptionActivated: true
      });
    }

    await firebaseService.updateVerificationStatus(propertyNumber, "pending");

    await sendWhatsAppNotification(
      `⏳ *طلب اشتراك - قيد التحقق التلقائي*\n\n` +
      `📍 العقار: ${property.name}\n` +
      `🔢 رقم العقار: ${propertyNumber}\n` +
      `📦 الباقة: ${pkg?.name || pendingPayment.packageId}\n` +
      `💳 طريقة الدفع: ${pendingPayment.paymentMethod}\n` +
      `💵 المبلغ: ${pendingPayment.finalAmount} ر.س\n` +
      `📊 حالة الدفع: ${paymentStatus}\n` +
      `🧾 الإيصال: ${pendingPayment.receiptUrl ? 'مرفق' : 'غير مرفق'}\n\n` +
      `🔄 يتم التحقق التلقائي من بيانات العقار`
    );

    return res.json({
      success: true,
      message: isNewPropertyForActivation
        ? "عقارك الجديد قيد اعتماد الإدارة - سيتم تفعيل الاشتراك بعد الاعتماد"
        : "عقارك قيد التحقق التلقائي - سيتم تفعيل الاشتراك بعد اكتمال البيانات",
      isBankTransfer: isBankTransfer,
      pendingAdminApproval: isNewPropertyForActivation,
      subscriptionActivated: false,
      paymentStatus: paymentStatus
    });
  } catch (err: any) {
    if (fulfillmentClaim) {
      await firebaseService.releasePaymentFulfillment(
        fulfillmentClaim.paymentId,
        fulfillmentClaim.token,
      ).catch((releaseError) => console.error("Failed to release payment fulfillment claim:", releaseError));
    }
    console.error("Property activation error:", err);
    res.status(500).json({
      success: false,
      error: `خطأ في تفعيل الاشتراك: ${err.message || 'خطأ غير معروف'}`
    });
  }
});


// ======================================================
// 🔍 POST /api/owner/property/run-verification - Owner self-service smart verification
// ======================================================
router.post("/api/owner/property/run-verification", requireOwner, async (req, res) => {
  let lockedPropertyNumber: string | null = null;
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    if (!propertyNumber) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const property = await propertyService.getByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    const isAlreadyApproved =
      property.verificationStatus === "approved" ||
      property.verificationStatus === "verified";
    if (isAlreadyApproved || (property as any).smartVerificationPassed === true) {
      return res.json({
        success: true,
        verified: true,
        alreadyVerified: true,
        notificationRequired: false,
        pendingAdminApproval: !isAlreadyApproved,
        subscriptionActivated: false,
        message: isAlreadyApproved
          ? "بيانات العقار معتمدة ولا تحتاج إلى فحص جديد"
          : "تم فحص بيانات العقار مسبقاً والطلب بانتظار اعتماد الإدارة",
      });
    }

    if (manualVerificationInFlight.has(propertyNumber)) {
      return res.status(409).json({
        success: false,
        verified: false,
        notificationRequired: false,
        code: "VERIFICATION_IN_PROGRESS",
        message: "التحقق الذكي قيد التنفيذ بالفعل.",
      });
    }
    manualVerificationInFlight.add(propertyNumber);
    lockedPropertyNumber = propertyNumber;

    const r2ImgCount = await countR2Images(propertyNumber);
    const verificationResult = await checkPropertyDataComplete(property, r2ImgCount);

    console.log(`🔍 [Owner Self-Verify] العقار ${propertyNumber} - النتيجة: ${verificationResult.isComplete ? 'مكتمل' : 'ناقص'} (${verificationResult.completionScore}%)`);

    if (!verificationResult.isComplete) {
      return res.json({
        success: false,
        verified: false,
        completionScore: verificationResult.completionScore,
        missingFields: verificationResult.missingFields,
        warnings: verificationResult.warnings,
        message: `بيانات العقار غير مكتملة - يرجى إكمال الحقول التالية`,
      });
    }

    const currentSubscription = await subscriptionService.getByProperty(propertyNumber);
    const isNewProperty = !hasPriorSubscription(currentSubscription);

    if (isNewProperty) {
      await firebaseService.updateProperty(propertyNumber, {
        verificationStatus: "pending",
        smartVerificationPassed: true,
        smartVerificationPassedAt: new Date().toISOString(),
        smartVerificationSource: "owner_run_verification",
      } as any);
      console.log(`✅ [Owner Self-Verify] العقار الجديد ${propertyNumber} - البيانات مكتملة وينتظر اعتماد الإدارة`);
    } else {
      await firebaseService.updateVerificationStatus(propertyNumber, "approved");
      console.log(`✅ [Owner Self-Verify] العقار القديم ${propertyNumber} - تم التحقق بنجاح`);
    }

    // فحص: هل يوجد دفعة معلقة مكتملة لكن غير مفعّلة (عقار جديد دفع لكن انتظار يدوياً)
    const payments = await paymentService.getByProperty(propertyNumber);
    const pendingActivationPayment = payments
      .filter((p) => p.status === ("نجح - قيد التحقق" as any))
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];

    let subscriptionActivated = false;
    let pendingAdminApproval = isNewProperty;

    if (pendingActivationPayment) {
      const pkg = await storage.getPackageById(pendingActivationPayment.packageId);
      if (pkg) {
        const activationDates = calculateActionDates(pendingActivationPayment.action, currentSubscription, pkg.duration);

        if (isNewProperty) {
          await queueVerifiedNewPropertyForAdminApproval({
            payment: pendingActivationPayment,
            property,
            pkg,
            startDate: pendingActivationPayment.pendingStartDate || activationDates.startDate,
            endDate: pendingActivationPayment.pendingEndDate || activationDates.endDate,
            finalAmount: pendingActivationPayment.pendingPrice || pendingActivationPayment.finalAmount,
          });
          pendingAdminApproval = true;
          console.log(`🆕 [Owner Self-Verify] دفعة العقار الجديد ${propertyNumber} جاهزة وتنتظر اعتماد الإدارة`);
        } else {
          const activation = await activateVerifiedPaymentSubscription({
            payment: pendingActivationPayment,
            property,
            pkg,
            receiptUrl: pendingActivationPayment.receiptUrl || "",
            startDate: pendingActivationPayment.pendingStartDate || activationDates.startDate,
            endDate: pendingActivationPayment.pendingEndDate || activationDates.endDate,
            finalAmount: pendingActivationPayment.pendingPrice || pendingActivationPayment.finalAmount,
          });

          await paymentService.update(pendingActivationPayment.id, {
            status: "مكتمل" as any,
            completedAt: new Date().toISOString(),
          });

          subscriptionActivated = true;
          console.log(`🎉 [Owner Self-Verify] تم تفعيل الاشتراك للعقار ${propertyNumber}`);

          if (property.whatsappNumber) {
            try {
              await notifyOwnerSubscriptionActivated({
                ownerPhone: property.whatsappNumber,
                propertyNumber: propertyNumber,
                propertyName: property.name || "",
                endDate: activation.endDate,
              });
            } catch (err) {
              console.error(`❌ Failed to send owner notification:`, err);
            }
          }
        }
      }
    }

    return res.json({
      success: true,
      verified: true,
      notificationRequired: true,
      completionScore: verificationResult.completionScore,
      subscriptionActivated,
      pendingAdminApproval,
      message: subscriptionActivated
        ? "تم التحقق من بيانات العقار وتفعيل الاشتراك بنجاح"
        : pendingAdminApproval
          ? "تم التحقق من بيانات العقار بنجاح - بانتظار اعتماد الإدارة"
          : "تم التحقق من بيانات العقار بنجاح - العقار معتمد",
      nextUrl: pendingAdminApproval ? "/owner/dashboard" : undefined,
      actionLabel: pendingAdminApproval ? "متابعة الحالة" : undefined,
    });
  } catch (err: any) {
    console.error("Owner self-verification error:", err);
    res.status(500).json({
      success: false,
      error: `خطأ في التحقق: ${err.message || 'خطأ غير معروف'}`,
    });
  } finally {
    if (lockedPropertyNumber) {
      manualVerificationInFlight.delete(lockedPropertyNumber);
    }
  }
});


router.post("/api/owner/payment/initiate", async (req, res) => {
  try {
    const { propertyNumber: bodyPropertyNumber, packageId, discountCode, action, secondPropertyNumber, additionalProperties } = req.body;
    const sessionPropertyNumber = (req.session as any).propertyNumber;
    const propertyNumber = bodyPropertyNumber || sessionPropertyNumber;

    if (!propertyNumber) {
      return res.status(400).json({ error: "رقم العقار مطلوب" });
    }

    const property = await firebaseService.getPropertyByNumber(propertyNumber);
    if (!property && action !== 'new') {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    const pkg = await firebaseService.getPurchasablePackageById(packageId);
    if (!pkg) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    // Handle multiple additional properties
    let allAdditionalProps: string[] = [];
    
    // Parse additionalProperties if it's a string (JSON stringified from frontend)
    if (additionalProperties) {
      if (typeof additionalProperties === 'string') {
        try {
          allAdditionalProps = JSON.parse(additionalProperties);
        } catch (e) {
          console.log("[CARD_PAYMENT] Failed to parse additionalProperties:", additionalProperties);
          allAdditionalProps = [];
        }
      } else if (Array.isArray(additionalProperties)) {
        allAdditionalProps = additionalProperties;
      }
    }
    
    // Parse secondPropertyNumber if it's a string
    let parsedSecondPropertyNumber = secondPropertyNumber;
    if (typeof secondPropertyNumber === 'string') {
      try {
        parsedSecondPropertyNumber = JSON.parse(secondPropertyNumber);
      } catch (e) {
        // Keep as is
      }
    }
    
    allAdditionalProps = normalizeLinkedPropertyNumbers(
      { additionalProperties: allAdditionalProps, secondPropertyNumber: parsedSecondPropertyNumber },
      propertyNumber,
    );
    
    // Calculate final price based on number of properties
    // Pricing model: 50 SAR for main property + 25 SAR for each additional property
    const basePrice = pkg.price || 0;
    const additionalPropertyCount = allAdditionalProps.length;
    
    let finalAmount;
    if (additionalPropertyCount > 0) {
      // Formula: pkg-price + (addedPropertyCount * propertyPrice)
      const propertyPrice = basePrice || 25;
      finalAmount = basePrice + (additionalPropertyCount * propertyPrice);
    } else if (pkg.pricePerProperty && pkg.pricePerProperty > 0) {
      // For multi-property packages without additional props selected
      finalAmount = pkg.pricePerProperty;
    } else {
      // Regular package price (just the first property)
      finalAmount = basePrice;
    }

    const currentSubscriptionForPaymentAction =
      await firebaseService.getSubscriptionByPropertyNumber(propertyNumber);
    const actionValidation = validatePaymentSubscriptionAction(
      action,
      currentSubscriptionForPaymentAction,
    );
    if (!actionValidation.ok) {
      return res.status(actionValidation.status).json({
        error: actionValidation.error,
        nextAction: actionValidation.nextAction,
        nextUrl: actionValidation.nextUrl,
        actionLabel: actionValidation.actionLabel,
      });
    }

    // Check if this is a package downgrade (for extend/upgrade actions)
    let downgradeWarning = null;
    let willAutoUnlink = 0;
    if (action === 'upgrade' || action === 'extend') {
      const currentLinkedCount = currentSubscriptionForPaymentAction?.linkedProperties?.length || 0;
      const newPackageMaxProps = (pkg as any).maxProperties || 1;
      const allowedLinkedCount = Math.max(0, newPackageMaxProps - 1);
      
      if (currentLinkedCount > allowedLinkedCount) {
        willAutoUnlink = currentLinkedCount - allowedLinkedCount;
        downgradeWarning = `سيتم فصل ${willAutoUnlink} عقار تلقائياً لأن الباقة الجديدة لا تدعم هذا العدد`;
      }
    }

    let discountAmount = 0;

    if (discountCode) {
      const discount = await storage.getDiscountCodeByCode(discountCode);
      if (discount && discount.isActive) {
        if (discount.type === "نسبة") {
          discountAmount = (finalAmount * discount.value) / 100;
          finalAmount -= discountAmount;
        } else {
          discountAmount = discount.value;
          finalAmount -= discount.value;
        }
      }
    }

    console.log(`[CARD_PAYMENT] Creating payment for propertyNumber: "${propertyNumber}", packageId: "${packageId}"`);
    const payment = await paymentService.create({
      propertyNumber,
      packageId,
      amount: finalAmount,
      discountCode: discountCode || "",
      discountAmount,
      finalAmount,
      status: "قيد المراجعة",
      paymentMethod: "بطاقة",
      action: (action as any) || "new",
      secondPropertyNumber: parsedSecondPropertyNumber || undefined,
      additionalProperties: allAdditionalProps.length > 0 ? allAdditionalProps : undefined,
      linkedProperties: allAdditionalProps.length > 0 ? allAdditionalProps : undefined,
    } as any);
    console.log(`[CARD_PAYMENT] ✅ Payment created: ${payment.id} for property: ${propertyNumber}, package: ${packageId}`);

    // للتمديد/الترقية بالبطاقة: احفظ التواريخ المعلقة (محدودة بـ40 يوماً) حتى يتمكن
    // الـ webhook من تفعيل الاشتراك بالتواريخ الصحيحة. بدون هذا لا يجد الـ webhook
    // pendingEndDate فلا يُفعّل تمديد/ترقية البطاقة أبداً.
    if (action === 'extend' || action === 'upgrade') {
      const { startDate: cardStart, endDate: cardEnd } = calculateActionDates(
        action,
        currentSubscriptionForPaymentAction,
        pkg.duration,
      );
      await paymentService.update(payment.id, {
        action,
        pendingStartDate: formatDateRiyadh(cardStart),
        pendingEndDate: formatDateRiyadh(cardEnd),
        pendingPrice: finalAmount,
        pendingSubscriptionType: (isPremiumSubscriptionType(pkg.type) || pkg.price > 0) ? "مميز" : "عادي",
      });
    }

    const paymentReference = `RWQN-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    await paymentService.update(payment.id, { paymentReference });

    const paymobPayment = await paymobService.createIntention(
      finalAmount,
      propertyNumber,
      property?.name || "عقار",
      property?.whatsappNumber || "0500000000",
      pkg.name,
      pkg.duration || 30
    );

    await paymentService.update(payment.id, {
      paymentReference: paymobPayment.intentionId,
      transactionId: paymobPayment.intentionId,
    });

    res.json({
      ok: true,
      paymentId: payment.id,
      paymentReference: paymobPayment.intentionId,
      transactionId: paymobPayment.intentionId,
      redirectUrl: paymobPayment.checkoutUrl,
      finalAmount: finalAmount,
      discountAmount: discountAmount,
      downgradeWarning,
      willAutoUnlink,
    });
  } catch (err: any) {
    console.error("Initiate payment error:", err);
    res.status(500).json({ error: err.message || "خطأ في بدء الدفع" });
  }
});

// POST /api/owner/payment/retry - Retry failed/pending payment
router.post("/api/owner/payment/retry", requireOwner, async (req, res) => {
  try {
    const { paymentId } = req.body;
    const propertyNumber = (req.session as any).propertyNumber;

    if (!paymentId) {
      return res.status(400).json({ error: "معرف الدفعة مطلوب" });
    }

    const payment = await paymentService.getById(paymentId);
    if (!payment) {
      return res.status(404).json({ error: "الدفعة غير موجودة" });
    }

    if (payment.propertyNumber !== propertyNumber) {
      return res.status(403).json({ error: "غير مصرح" });
    }

    if (["مكتمل", "completed", "نجح", "نجاح", "نجح - قيد التحقق", "قيد التحقق"].includes(payment.status)) {
      return res.status(400).json({
        error: "تم استلام هذه الدفعة أو جارٍ التحقق منها، ولا يجب دفعها مرة أخرى",
      });
    }
    if (payment.fulfilledAt || payment.fulfillmentState === "fulfilled") {
      return res.status(400).json({ error: "تم تفعيل هذه الدفعة مسبقاً" });
    }
    if (payment.fulfillmentState === "processing") {
      return res.status(409).json({ error: "تفعيل هذه الدفعة قيد التنفيذ بالفعل" });
    }
    if (payment.fulfillmentState === "failed") {
      return res.status(409).json({
        error: "تم استلام الدفعة وتحتاج عملية التفعيل إلى الاستكمال، ولا يجب دفعها مرة أخرى",
      });
    }

    const pkg = await firebaseService.getPurchasablePackageById(payment.packageId);
    if (!pkg) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    const property = await firebaseService.getPropertyByNumber(payment.propertyNumber);
    const currentSubscription = await firebaseService.getSubscriptionByPropertyNumber(
      payment.propertyNumber,
    );
    const actionValidation = validatePaymentSubscriptionAction(
      payment.action,
      currentSubscription,
    );
    if (!actionValidation.ok) {
      return res.status(actionValidation.status).json({
        error: actionValidation.error,
        nextAction: actionValidation.nextAction,
        nextUrl: actionValidation.nextUrl,
        actionLabel: actionValidation.actionLabel,
      });
    }

    let refreshedPendingDates: { pendingStartDate: string; pendingEndDate: string } | null = null;
    if (payment.action === "extend" || payment.action === "upgrade") {
      const refreshedDates = calculateActionDates(
        payment.action,
        currentSubscription,
        pkg.duration,
      );
      refreshedPendingDates = {
        pendingStartDate: formatDateRiyadh(refreshedDates.startDate),
        pendingEndDate: formatDateRiyadh(refreshedDates.endDate),
      };
    }

    const phone = property?.whatsappNumber || "0500000000";
    const propertyName = property?.name || "عقار";

    const paymobResult = await paymobService.createIntention(
      payment.finalAmount,
      payment.propertyNumber,
      propertyName,
      phone,
      pkg.name,
      pkg.duration || 30,
      "cards"
    );

    await paymentService.update(paymentId, {
      paymentReference: paymobResult.intentionId,
      transactionId: paymobResult.intentionId,
      ...(refreshedPendingDates || {}),
    });

    res.json({
      ok: true,
      checkoutUrl: paymobResult.checkoutUrl,
      paymentId: paymentId,
    });
  } catch (err: any) {
    console.error("Payment retry error:", err);
    res.status(500).json({ error: err.message || "خطأ في إعادة الدفع" });
  }
});

// ======================================================
// التحقق من العقار الثاني (للباقات متعددة العقارات)
// POST /api/owner/verify-second-property
// ======================================================

function checkPropertyUserDataComplete(property: any): { isComplete: boolean; missingFields: string[] } {
  const missingFields: string[] = [];
  
  if (!property.name || property.name.trim() === '') {
    missingFields.push('name');
  }
  if (!property.whatsappNumber || property.whatsappNumber.trim() === '') {
    missingFields.push('whatsappNumber');
  }
  if (!property.city) {
    missingFields.push('city');
  }
  if (!property.direction) {
    missingFields.push('direction');
  }
  if (!property.type) {
    missingFields.push('type');
  }
  if (!property.prices?.weekday || property.prices.weekday.trim() === '') {
    missingFields.push('prices.weekday');
  }
  if (!property.prices?.weekend || property.prices.weekend.trim() === '') {
    missingFields.push('prices.weekend');
  }
  if (!property.prices?.overnight || property.prices.overnight.trim() === '') {
    missingFields.push('prices.overnight');
  }
  if (!property.prices?.holidays || property.prices.holidays.trim() === '') {
    missingFields.push('prices.holidays');
  }
  if (!property.facilities || property.facilities.length === 0) {
    missingFields.push('facilities');
  }
  
  return {
    isComplete: missingFields.length === 0,
    missingFields
  };
}

router.post("/api/owner/verify-second-property", requireOwner, async (req, res) => {
  try {
    const ownerPropertyNumber = (req.session as any).propertyNumber;
    const { secondPropertyNumber } = req.body;

    if (!secondPropertyNumber) {
      return res.status(400).json({ error: "رقم العقار الثاني مطلوب" });
    }

    if (secondPropertyNumber === ownerPropertyNumber) {
      return res.status(400).json({ error: "لا يمكن اختيار نفس العقار" });
    }

    const ownerProperty = await firebaseService.getPropertyByNumber(ownerPropertyNumber);
    if (!ownerProperty) {
      return res.status(404).json({ error: "لم يتم العثور على عقارك" });
    }

    const secondProperty = await firebaseService.getPropertyByNumber(secondPropertyNumber);
    if (!secondProperty) {
      return res.status(404).json({ error: "لم يتم العثور على العقار الثاني" });
    }

    if (secondProperty.pin !== ownerProperty.pin) {
      return res.status(403).json({ error: "هذا العقار يخص مالك آخر" });
    }

    const userDataCheck = checkPropertyUserDataComplete(secondProperty);
    if (!userDataCheck.isComplete) {
      return res.status(400).json({
        error: "بيانات العقار غير مكتملة",
        incomplete: true,
        missingFields: userDataCheck.missingFields,
        property: {
          number: secondProperty.propertyNumber,
          name: secondProperty.name,
          city: secondProperty.city
        }
      });
    }

    const subscription = await subscriptionService.getByProperty(secondPropertyNumber);
    const isActive = subscription &&
      isLinkedSubscriptionActive(subscription.status) &&
      new Date(subscription.endDate) > new Date();
    
    if (isActive) {
      return res.status(400).json({
        error: "العقار الثاني لديه اشتراك نشط بالفعل",
        existingEndDate: subscription.endDate
      });
    }

    res.json({
      ok: true,
      property: {
        number: secondProperty.propertyNumber,
        name: secondProperty.name,
        city: secondProperty.city
      }
    });
  } catch (err: any) {
    console.error("Verify second property error:", err);
    res.status(500).json({ error: err?.message || "فشل في التحقق" });
  }
});

// ======================================================
// طلب إضافة عقار إضافي (تفعيل تلقائي إذا كان العقار الرئيسي لديه اشتراك نشط)
// POST /api/owner/request-additional-property
// ======================================================
router.post("/api/owner/request-additional-property", requireOwner, async (req, res) => {
  try {
    const ownerPropertyNumber = (req.session as any).propertyNumber;
    const { additionalPropertyNumber } = req.body;

    if (!additionalPropertyNumber) {
      return res.status(400).json({ error: "رقم العقار الإضافي مطلوب" });
    }

    const ownerProperty = await firebaseService.getPropertyByNumber(ownerPropertyNumber);
    if (!ownerProperty) {
      return res.status(404).json({ error: "لم يتم العثور على عقارك" });
    }

    const additionalProperty = await firebaseService.getPropertyByNumber(additionalPropertyNumber);
    if (!additionalProperty) {
      return res.status(404).json({ error: "لم يتم العثور على العقار الإضافي" });
    }

    if (additionalProperty.pin !== ownerProperty.pin) {
      return res.status(403).json({ error: "هذا العقار يخص مالك آخر" });
    }

    // Check if already linked
    const existingSub = await firebaseService.getSubscriptionByPropertyNumber(additionalPropertyNumber);
    if (existingSub && (existingSub.linkedProperty === ownerPropertyNumber || isLinkedSubscriptionActive(existingSub.status))) {
      return res.status(400).json({ error: "هذا العقار مرتبط بالفعل بعقار آخر" });
    }

    // Get the owner's active subscription to auto-activate
    const ownerSubscription = await subscriptionService.getByProperty(ownerPropertyNumber);
    if (
      !ownerSubscription ||
      !isLinkedSubscriptionActive(ownerSubscription.status) ||
      calculateRemainingDays(ownerSubscription.endDate) < 0
    ) {
      // No active subscription - fall back to pending approval
      await firebaseService.updateProperty(additionalPropertyNumber, {
        pendingApprovalFrom: ownerPropertyNumber
      });
      return res.json({
        ok: true,
        message: "تم إرسال طلب إضافة العقار الإضافي. في انتظار موافقة الأدمن.",
        additionalProperty: {
          number: additionalProperty.propertyNumber,
          name: additionalProperty.name,
          pendingApprovalFrom: ownerPropertyNumber
        }
      });
    }

    // Check maxProperties limit
    const currentLinkedProperties = ownerSubscription.linkedProperties || [];
    const linkedCount = currentLinkedProperties.filter(lp => lp !== ownerPropertyNumber).length;
    
    let maxProperties = 30;
    if (ownerSubscription.packageId) {
      const ownerPackage = await firebaseService.getPackageById(ownerSubscription.packageId);
      if (ownerPackage) {
        maxProperties = (ownerPackage as any).maxProperties || 30;
      }
    }
    
    if (linkedCount >= maxProperties) {
      return res.status(400).json({
        error: `لا يمكن إضافة أكثر من ${maxProperties} عقار في هذه الباقة`
      });
    }

    // Cross-validate: check if the original payment covered enough properties
    if (ownerSubscription.paymentId) {
      const linkedPayment = await firebaseService.getPaymentById(ownerSubscription.paymentId);
      if (linkedPayment) {
        const paymentTotalProps = 1 + ((linkedPayment as any).additionalProperties?.length || 0) + ((linkedPayment as any).secondPropertyNumber ? 1 : 0);
        const currentlyLinked = linkedCount + 1; // +1 for this new property
        if (currentlyLinked > paymentTotalProps) {
          console.log(`[request-additional-property] ⚠️ Payment (${ownerSubscription.paymentId}) covered ${paymentTotalProps} properties, but ${currentlyLinked} would be linked`);
          // Don't block — the package maxProperties is the final authority
          // But log the discrepancy for audit
        }
      }
    }

    // Auto-activate: create subscription for the additional property
    const linkedSubData = {
      packageId: ownerSubscription.packageId,
      price: 0,
      subscriptionType: getSubscriptionTypeLabel(ownerSubscription.subscriptionType || ownerSubscription.packageType),
      packageType: getSubscriptionTypeLabel(ownerSubscription.packageType || ownerSubscription.subscriptionType),
      startDate: ownerSubscription.startDate,
      endDate: ownerSubscription.endDate,
      linkedProperty: ownerPropertyNumber,
      status: "نشط"
    };

    await firebaseService.addSubscriptionToSheet(
      additionalPropertyNumber,
      linkedSubData,
      additionalProperty,
      ""
    );

    // Update main property's subscription linkedProperties
    const mainSubDoc = await firebaseService.getSubscriptionByPropertyNumber(ownerPropertyNumber);
    if (mainSubDoc) {
      const updatedLinkedProps = [...(mainSubDoc.linkedProperties || []), additionalPropertyNumber];
      await firebaseService.updateSubscription(mainSubDoc.id, {
        linkedProperties: updatedLinkedProps,
        propertyCount: updatedLinkedProps.length + 1
      });
    }

    // Update multi_property_subscriptions record
    const multiSubs = await firebaseService.getMultiPropertySubscriptions();
    const existingMulti = multiSubs.find(m => m.propertyNumber1 === ownerPropertyNumber && isLinkedSubscriptionActive(m.status));
    if (existingMulti) {
      const newAdditional = [...(existingMulti.additionalProperties || []), additionalPropertyNumber];
      const uniqueAdd = new Set<string>([existingMulti.propertyNumber1]);
      if (existingMulti.propertyNumber2) uniqueAdd.add(existingMulti.propertyNumber2);
      for (const ap of newAdditional) uniqueAdd.add(ap);
      const allLinked = Array.from(uniqueAdd);
      
      await firebaseService.updateMultiPropertySubscription(existingMulti.id, {
        additionalProperties: newAdditional,
        linkedProperties: allLinked,
        propertyCount: allLinked.length
      });
    } else {
      await firebaseService.createMultiPropertySubscription({
        packageId: ownerSubscription.packageId,
        propertyNumber1: ownerPropertyNumber,
        propertyNumber2: additionalPropertyNumber,
        additionalProperties: [additionalPropertyNumber],
        linkedProperties: [ownerPropertyNumber, additionalPropertyNumber],
        propertyCount: 2,
        startDate: ownerSubscription.startDate,
        endDate: ownerSubscription.endDate,
        status: "نشط",
        paymentId: ownerSubscription.paymentId
      });
    }

    // Update property fields
    await firebaseService.updateProperty(additionalPropertyNumber, {
      subscriptionType: getSubscriptionTypeLabel(ownerSubscription.subscriptionType || ownerSubscription.packageType),
      pendingApprovalFrom: "" as any
    });

    // العقار المضاف يرث حالة التحقق من العقار الرئيسي — يُوافق عليه تلقائياً
    // (بدلاً من تركه معلقاً/مرفوضاً مما يُظهر العقار الرئيسي نشطاً والمضاف غير نشط)
    await firebaseService.updateVerificationStatus(additionalPropertyNumber, "approved");

    res.json({
      ok: true,
      message: "تم إضافة العقار وتفعيله بنجاح بنفس اشتراك العقار الرئيسي",
      autoActivated: true,
      additionalProperty: {
        number: additionalProperty.propertyNumber,
        name: additionalProperty.name,
        subscription: linkedSubData
      }
    });
  } catch (err: any) {
    console.error("Request additional property error:", err);
    res.status(500).json({ error: err?.message || "فشل في إضافة العقار" });
  }
});

// ======================================================
// استعلام عن حالة الطلبات الإضافية للعقار
// GET /api/owner/additional-property-requests
// ======================================================
router.get("/api/owner/additional-property-requests", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    
    const properties = await firebaseService.getProperties();
    
    // Get properties pending approval (under review)
    const pendingRequests = properties.filter((p: any) => 
      p.pendingApprovalFrom === propertyNumber
    );

    // Collect all linked property numbers from multiple sources
    const approvedPropertyNumbersSet = new Set<string>();

    // Source 1: Subscriptions where linkedProperty points to this property
    const subscriptions = await firebaseService.getSubscriptions();
    const linkedSubscriptions = subscriptions.filter((s: any) => 
      s.linkedProperty === propertyNumber && isLinkedSubscriptionActive(s.status)
    );
    for (const s of linkedSubscriptions) {
      approvedPropertyNumbersSet.add(s.propertyNumber);
    }

    // Source 2: Current subscription's linkedProperties array
    const currentSubscription = subscriptions.find((s: any) => s.propertyNumber === propertyNumber);
    if (currentSubscription?.linkedProperties && Array.isArray(currentSubscription.linkedProperties)) {
      for (const lp of currentSubscription.linkedProperties) {
        if (lp !== propertyNumber) {
          approvedPropertyNumbersSet.add(lp);
        }
      }
    }

    // Source 3: multi_property_subscriptions collection
    const multiSubs = await firebaseService.getMultiPropertySubscriptions();
    for (const multiSub of multiSubs) {
      if (!isLinkedSubscriptionActive(multiSub.status)) continue;
      const allProps = new Set<string>();
      allProps.add(multiSub.propertyNumber1);
      if (multiSub.propertyNumber2) allProps.add(multiSub.propertyNumber2);
      if (multiSub.additionalProperties) {
        for (const ap of multiSub.additionalProperties) allProps.add(ap);
      }
      // If this property is in the group, add all OTHER properties as linked
      if (allProps.has(propertyNumber)) {
        for (const pn of allProps) {
          if (pn !== propertyNumber) {
            approvedPropertyNumbersSet.add(pn);
          }
        }
      }
    }

    const approvedPropertyNumbers = Array.from(approvedPropertyNumbersSet);
    
    // Filter pendingRequests to exclude properties that already have subscriptions (are already linked/approved)
    const filteredPendingRequests = pendingRequests.filter((p: any) => 
      !approvedPropertyNumbers.includes(p.propertyNumber)
    );
    
    // Get the full property details for approved properties
    const approvedProperties = properties.filter((p: any) => 
      approvedPropertyNumbers.includes(p.propertyNumber)
    );

    res.json({
      ok: true,
      pendingRequests: filteredPendingRequests.map((p: any) => ({
        propertyNumber: p.propertyNumber,
        name: p.name,
        city: p.city,
        verificationStatus: p.verificationStatus,
        status: 'pending',
        requestedAt: p.updatedAt || p.createdAt
      })),
      approvedRequests: approvedProperties.map((p: any) => ({
        propertyNumber: p.propertyNumber,
        name: p.name,
        city: p.city,
        verificationStatus: p.verificationStatus,
        status: 'approved',
        requestedAt: p.updatedAt || p.createdAt
      }))
    });
  } catch (err: any) {
    console.error("Get additional property requests error:", err);
    res.status(500).json({ error: err?.message || "فشل في جلب الطلبات" });
  }
});

// ======================================================
// فصل عقار مرتبط من العقار الرئيسي
// DELETE /api/owner/subscription/linked-properties/:propertyNumber
// ======================================================
router.delete("/api/owner/subscription/linked-properties/:propertyNumber", requireOwner, async (req, res) => {
  try {
    const mainPropertyNumber = (req.session as any).propertyNumber;
    const linkedPropertyNumber = req.params.propertyNumber;

    const mainSubscription = await firebaseService.getSubscriptionByPropertyNumber(mainPropertyNumber);
    if (!mainSubscription) {
      return res.status(404).json({ success: false, message: "العقار الرئيسي ليس لديه اشتراك" });
    }

    const currentLinkedProperties = mainSubscription.linkedProperties || [];
    
    if (!currentLinkedProperties.includes(linkedPropertyNumber)) {
      return res.status(400).json({ success: false, message: "العقار غير مرتبط بعقارك" });
    }

    const updatedLinkedProperties = currentLinkedProperties.filter((p: string) => p !== linkedPropertyNumber);
    await firebaseService.updateSubscription(mainSubscription.id, {
      linkedProperties: updatedLinkedProperties,
      propertyCount: updatedLinkedProperties.length + 1
    });

    const linkedSubscription = await firebaseService.getSubscriptionByPropertyNumber(linkedPropertyNumber);
    if (linkedSubscription) {
      await firebaseService.updateSubscription(linkedSubscription.id, {
        linkedProperty: ""
      });
    }

    await firebaseService.updateProperty(linkedPropertyNumber, {
      pendingApprovalFrom: ""
    });

    // Log the unlink against the payment record for audit trail
    if (mainSubscription.paymentId) {
      try {
        const linkedPayment = await firebaseService.getPaymentById(mainSubscription.paymentId);
        if (linkedPayment) {
          const auditNotes = (linkedPayment as any).auditNotes || [];
          auditNotes.push({
            type: "unlink",
            propertyNumber: linkedPropertyNumber,
            timestamp: new Date().toISOString(),
            reason: "فصل بواسطة المالك",
          });
          await firebaseService.updatePayment(mainSubscription.paymentId, { auditNotes } as any);
        }
      } catch (auditErr) {
        console.error("Failed to update payment audit trail:", auditErr);
      }
    }

    res.json({
      success: true,
      message: `تم فصل العقار ${linkedPropertyNumber} من عقارك`
    });
  } catch (err: any) {
    console.error("Unlink property error:", err);
    res.status(500).json({ success: false, message: "فشل في فصل العقار المرتبط" });
  }
});

// ======================================================
// تحضير معلومات الدفع للترقية/التمديد
// POST /api/owner/subscription/prepare-payment
// ======================================================
router.post("/api/owner/subscription/prepare-payment", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    const { action, packageId } = req.body;

    if (!['extend', 'upgrade'].includes(action)) {
      return res.status(400).json({ error: "إجراء غير صالح" });
    }

    const newPackage = await firebaseService.getPurchasablePackageById(packageId);
    if (!newPackage) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    const currentSubscription = await firebaseService.getSubscriptionByPropertyNumber(propertyNumber);
    const actionValidation = validateSubscriptionAction(action, currentSubscription);
    if (!actionValidation.ok) {
      return res.status(actionValidation.status).json({
        error: actionValidation.error,
        nextAction: actionValidation.nextAction,
        nextUrl: actionValidation.nextUrl,
        actionLabel: actionValidation.actionLabel,
      });
    }

    // Check if new package can accommodate current linked properties
    const currentLinkedCount = currentSubscription?.linkedProperties?.length || 0;
    const newPackageMaxProps = (newPackage as any).maxProperties || 1;
    const allowedLinkedCount = Math.max(0, newPackageMaxProps - 1);
    
    let warning = null;
    let willAutoUnlink = 0;
    
    if (currentLinkedCount > allowedLinkedCount) {
      willAutoUnlink = currentLinkedCount - allowedLinkedCount;
      warning = `سيتم فصل ${willAutoUnlink} عقار تلقائياً لأن الباقة الجديدة لا تدعم هذا العدد`;
    }

    res.json({
      ok: true,
      paymentRequired: true,
      action,
      packageId,
      packageName: newPackage.name,
      price: newPackage.price,
      duration: newPackage.duration,
      paymentMethods: ["بطاقة", "Apple Pay", "تحويل بنكي"],
      message: `يجب إتمام الدفع للقيام بـ ${action === 'extend' ? 'التمديد' : 'الترقية'}`,
      warning,
      willAutoUnlink,
      currentLinkedCount,
      newPackageMaxProps
    });
  } catch (err: any) {
    console.error("Subscription prepare payment error:", err);
    res.status(500).json({ error: err?.message || "فشل في التحضير" });
  }
});

// ======================================================
// تأكيد الاشتراك بعد الدفع الناجح
// POST /api/owner/subscription/confirm
// ======================================================
router.post("/api/owner/subscription/confirm", requireOwner, async (req, res) => {
  let fulfillmentClaim: { paymentId: string; token: string } | null = null;
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    const { action, packageId, paymentId } = req.body;

    // Validate paymentId
    if (!paymentId) {
      return res.status(400).json({ error: "معرف الدفع مطلوب" });
    }
    const paymentRecord = await firebaseService.getPaymentById(paymentId);
    if (!paymentRecord) {
      return res.status(404).json({ error: "الدفعة غير موجودة" });
    }
    if (paymentRecord.status !== "مكتمل" && paymentRecord.status !== "نجح" && paymentRecord.status !== "completed") {
      return res.status(400).json({ error: "الدفعة غير مكتملة" });
    }

    if (String(paymentRecord.propertyNumber || "") !== String(propertyNumber || "")) {
      return res.status(403).json({ error: "هذه الدفعة لا تخص هذا العقار" });
    }
    if (String(paymentRecord.packageId || "") !== String(packageId || "")) {
      return res.status(400).json({ error: "الباقة لا تطابق الباقة المدفوعة" });
    }
    const paidAction = String(paymentRecord.action || "new");
    if (
      (paidAction !== "extend" && paidAction !== "upgrade") ||
      String(action || "") !== paidAction
    ) {
      return res.status(400).json({ error: "الإجراء لا يطابق الإجراء المدفوع" });
    }

    // A completed payment remains fulfillable if the package was disabled later.
    const newPackage = await storage.getPackageById(paymentRecord.packageId);
    if (!newPackage) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    console.log(`📦 [Owner Confirm] Package: id=${newPackage.id}, name=${newPackage.name}, type=${newPackage.type}, price=${newPackage.price}`);

    const property = await firebaseService.getPropertyByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    const subscriptions = await firebaseService.getSubscriptionsByProperty(propertyNumber);
    console.log(`📋 Found ${subscriptions.length} subscriptions for ${propertyNumber}`);

    const fulfilledSubscription = subscriptions.find(
      (subscription) => subscription.paymentId === paymentRecord.id,
    );
    if (paymentRecord.fulfilledAt) {
      const effectiveSubscription = fulfilledSubscription || subscriptions[0];
      return res.json({
        ok: true,
        message: "تم تفعيل هذه الدفعة مسبقاً",
        alreadyActivated: true,
        subscription: effectiveSubscription || null,
        endDate: effectiveSubscription?.endDate || null,
      });
    }

    const currentSubscription = subscriptions.find((s) => isActiveSubscription(s));

    console.log(`📋 [Owner Confirm] Current subscription:`, currentSubscription ?
      `status=${currentSubscription.status}, endDate=${currentSubscription.endDate}` : 'None');

    const claimResult = await firebaseService.claimPaymentFulfillment(paymentRecord.id);
    if (claimResult.status === "fulfilled") {
      return res.json({
        ok: true,
        message: "تم تفعيل هذه الدفعة مسبقاً",
        alreadyActivated: true,
        subscription: fulfilledSubscription || currentSubscription || null,
        endDate: fulfilledSubscription?.endDate || currentSubscription?.endDate || null,
      });
    }
    if (claimResult.status === "processing") {
      return res.status(409).json({ error: "تفعيل هذه الدفعة قيد التنفيذ بالفعل" });
    }
    fulfillmentClaim = { paymentId: paymentRecord.id, token: claimResult.token };

    const hasLinkedGroup = normalizeLinkedPropertyNumbers(paymentRecord as any, propertyNumber).length > 0 ||
      (fulfilledSubscription?.linkedProperties?.length || 0) > 0;
    if (
      claimResult.previousState === undefined &&
      isLegacyPaymentFulfillment(paymentRecord, fulfilledSubscription) &&
      !hasLinkedGroup
    ) {
      await firebaseService.completePaymentFulfillment(
        paymentRecord.id,
        claimResult.token,
        fulfilledSubscription?.id || `SUB-${propertyNumber}`,
      );
      fulfillmentClaim = null;
      return res.json({
        ok: true,
        message: "تم تفعيل هذه الدفعة مسبقاً",
        alreadyActivated: true,
        subscription: fulfilledSubscription || null,
        endDate: fulfilledSubscription?.endDate || null,
      });
    }

    // Fresh payments are validated against the current state. Failed partial
    // attempts are reconciled from the payment's persisted dates below.
    if (claimResult.previousState === undefined && !fulfilledSubscription) {
      const actionValidation = validateSubscriptionAction(action, currentSubscription);
      if (!actionValidation.ok) {
        await firebaseService.releasePaymentFulfillment(paymentRecord.id, claimResult.token);
        fulfillmentClaim = null;
        return res.status(actionValidation.status).json({
          error: actionValidation.error,
          nextAction: actionValidation.nextAction,
          nextUrl: actionValidation.nextUrl,
          actionLabel: actionValidation.actionLabel,
        });
      }
    }

    const calculatedDates = calculateActionDates(action, currentSubscription, newPackage.duration);
    const persistedStartDate = paymentRecord.pendingStartDate
      ? new Date(paymentRecord.pendingStartDate)
      : fulfilledSubscription?.startDate
        ? new Date(fulfilledSubscription.startDate)
        : null;
    const persistedEndDate = paymentRecord.pendingEndDate
      ? new Date(paymentRecord.pendingEndDate)
      : fulfilledSubscription?.endDate
        ? new Date(fulfilledSubscription.endDate)
        : null;
    const newStartDate = persistedStartDate && Number.isFinite(persistedStartDate.getTime())
      ? persistedStartDate
      : calculatedDates.startDate;
    const newEndDate = persistedEndDate && Number.isFinite(persistedEndDate.getTime())
      ? persistedEndDate
      : calculatedDates.endDate;
    console.log(
      action === 'extend'
        ? `📅 [Owner Confirm] Extending from ${currentSubscription?.endDate} + ${newPackage.duration} days`
        : `📅 [Owner Confirm] Upgrade starts today + ${newPackage.duration} days`
    );

    const isPremium = isPremiumSubscriptionType(newPackage.type) || newPackage.price > 0;
    const paymentLinkedProperties = normalizeLinkedPropertyNumbers(
      paymentRecord as any,
      propertyNumber,
    );
    const linkedPropertiesSnapshot = paymentLinkedProperties.length > 0
      ? paymentLinkedProperties
      : normalizeLinkedPropertyNumbers(
          { linkedProperties: currentSubscription?.linkedProperties || [] },
          propertyNumber,
        );

    // Persist the original group before the first subscription write. A failed
    // partial attempt can then retry without losing children after the main
    // subscription has already been narrowed to the new package limit.
    if (paymentLinkedProperties.length === 0 && linkedPropertiesSnapshot.length > 0) {
      await firebaseService.updatePayment(paymentRecord.id, {
        additionalProperties: linkedPropertiesSnapshot,
        linkedProperties: linkedPropertiesSnapshot,
      } as any);
    }

    const maxProperties = Number(
      (newPackage as any).maxProperties || newPackage.propertyCount || 1,
    );
    const allowedLinkedProperties = Math.max(0, maxProperties - 1);
    const retainedLinkedProperties = linkedPropertiesSnapshot.slice(0, allowedLinkedProperties);
    const propertiesToUnlink = linkedPropertiesSnapshot.slice(allowedLinkedProperties);

    const subscriptionData = {
      propertyNumber,
      packageId,
      startDate: newStartDate.toISOString(),
      endDate: newEndDate.toISOString(),
      status: 'نشط',
      paymentId: paymentId || "",
      price: newPackage.price,
      subscriptionType: isPremium ? "مميز" : "عادي",
      packageType: isPremium ? "مميز" : "عادي",
      linkedProperties: retainedLinkedProperties,
      propertyCount: retainedLinkedProperties.length + 1,
    };

    await firebaseService.addSubscriptionToSheet(
      propertyNumber,
      subscriptionData,
      property,
      undefined
    );

    console.log(`✅ [Owner Confirm] Subscription activated for: ${propertyNumber}`);

    // Auto-renew linked properties with same dates — sync BOTH subscription doc AND property doc
    // so the linked property always reflects the same state as the main (fixes "active parent, inactive linked").
    if (retainedLinkedProperties.length > 0) {
      console.log(`🔗 [Owner Confirm] Auto-renewing ${retainedLinkedProperties.length} linked properties`);

      const linkedSyncData = {
        subscriptionType: isPremium ? "مميز" : "عادي",
        startDate: newStartDate.toISOString(),
        endDate: newEndDate.toISOString(),
        status: 'نشط' as string,
        paymentId: paymentId,
        packageId: packageId,
      };

      for (const linkedPropNum of retainedLinkedProperties) {
        await firebaseService.syncLinkedProperty(linkedPropNum, propertyNumber, linkedSyncData);
        console.log(`✅ [Owner Confirm] Synced linked property ${linkedPropNum} (sub + property doc + verification=approved)`);
      }
    }

    // Auto-unlink excess properties if new package has fewer slots
    if (propertiesToUnlink.length > 0) {
      console.log(`🔗 [Owner Confirm] Auto-unlinking ${propertiesToUnlink.length} properties due to package downgrade`);

      // Mark unlinked properties clearly: detach from group but keep subscription until expiry
      for (const propNum of propertiesToUnlink) {
        const unlinkedSub = await firebaseService.getSubscriptionByPropertyNumber(propNum);
        if (unlinkedSub) {
          const detachedEndDate = unlinkedSub.endDate || newEndDate.toISOString();
          await firebaseService.updateSubscription(unlinkedSub.id, {
            linkedProperty: "",
            linkedProperties: [],
            propertyCount: 1,
            status: calculateRemainingDays(detachedEndDate) >= 0 ? "نشط" : "منتهي",
          });
          // Reflect detachment on the property doc too so the admin dashboard shows it consistently
          await firebaseService.updateProperty(propNum, { linkedProperty: "" });
          console.log(`✅ [Owner Confirm] Detached property ${propNum} — subscription kept until ${detachedEndDate}`);
        }
      }
    }

    await syncMultiPropertyRecord({
      mainPropertyNumber: propertyNumber,
      linkedProperties: retainedLinkedProperties,
      packageId: newPackage.id,
      startDate: newStartDate.toISOString(),
      endDate: newEndDate.toISOString(),
      paymentId: paymentRecord.id,
    });

    // Update property's subscriptionType to match the package
    await firebaseService.updateProperty(propertyNumber, { 
      subscriptionType: isPremium ? "مميز" : "عادي" 
    });

    await firebaseService.updateVerificationStatus(propertyNumber, "approved");

    await firebaseService.completePaymentFulfillment(
      paymentRecord.id,
      fulfillmentClaim.token,
      `SUB-${propertyNumber}`,
    );
    fulfillmentClaim = null;

    res.json({
      ok: true,
      message: `تم ${action === 'extend' ? 'التمديد' : 'الترقية'} بنجاح`,
      subscription: subscriptionData,
      endDate: newEndDate,
    });
  } catch (err: any) {
    if (fulfillmentClaim) {
      await firebaseService.releasePaymentFulfillment(
        fulfillmentClaim.paymentId,
        fulfillmentClaim.token,
      ).catch((releaseError) => console.error("Failed to release payment fulfillment claim:", releaseError));
    }
    console.error("Subscription confirm error:", err);
    res.status(500).json({ error: err?.message || "فشل في التأكيد" });
  }
});

// GET /api/owner/subscription/:propertyNumber - Get subscription data for any property
router.get("/api/owner/subscription/:propertyNumber", requireOwner, async (req, res) => {
  try {
    const { propertyNumber } = req.params;
    
    if (!propertyNumber || propertyNumber.length !== 5) {
      return res.status(400).json({ error: "رقم العقار غير صحيح" });
    }

    const subscription = await firebaseService.getSubscriptionByPropertyNumber(propertyNumber);
    
    if (!subscription) {
      return res.json({ 
        found: false, 
        propertyNumber,
        subscription: null 
      });
    }

    const property = await firebaseService.getPropertyByNumber(propertyNumber);
    
    res.json({
      found: true,
      propertyNumber,
      subscription: {
        subscriptionType: subscription.subscriptionType || subscription.packageType || 'عادي',
        status: subscription.status,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        packageId: subscription.packageId,
        propertyCount: subscription.propertyCount,
        linkedProperty: subscription.linkedProperty,
      },
      property: property ? {
        name: property.name,
        city: property.city,
        verificationStatus: property.verificationStatus,
      } : null
    });
  } catch (err: any) {
    console.error("Get subscription error:", err);
    res.status(500).json({ error: err?.message || "فشل في جلب بيانات الاشتراك" });
  }
});

// ======================================================
// 🎉 GET /api/owner/occasions - Get owner's property occasions
// ======================================================
router.get("/api/owner/occasions", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    if (!propertyNumber) {
      return res.status(400).json({ error: "Property not found in session" });
    }

    // Get active occasions
    const activeOccasions = await occasionService.getActiveOccasions();
    
    // Get property's occasion data
    const propertyOccasions = await occasionService.getPropertyOccasions(propertyNumber);
    
    // Combine data
    const result = activeOccasions.map(occasion => {
      const propData = propertyOccasions.find(po => po.occasionId === occasion.id);
      return {
        occasion,
        propertyData: propData || null,
        isEnrolled: !!propData,
      };
    });

    res.json(result);
  } catch (err: any) {
    console.error("Get owner occasions error:", err);
    res.status(500).json({ error: "فشل في جلب المناسبات" });
  }
});

// ======================================================
// 🎉 PUT /api/owner/occasions/:occasionId - Update availability & prices
// ======================================================
router.put("/api/owner/occasions/:occasionId", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    if (!propertyNumber) {
      return res.status(400).json({ error: "Property not found in session" });
    }

    const { occasionId } = req.params;
    const { availability, prices } = req.body;

    // Verify the property is enrolled in this occasion
    const existing = await occasionService.getOccasionProperty(occasionId, propertyNumber);
    if (!existing) {
      return res.status(404).json({ error: "العقار غير مسجل في هذه المناسبة" });
    }

    const updates: any = {};
    if (availability !== undefined) updates.availability = availability;
    if (prices !== undefined) updates.prices = prices;

    const result = await occasionService.updateOccasionProperty(existing.id, updates);
    res.json(result);
  } catch (err: any) {
    console.error("Update owner occasion error:", err);
    res.status(500).json({ error: "فشل في تحديث بيانات المناسبة" });
  }
});

export default router;
