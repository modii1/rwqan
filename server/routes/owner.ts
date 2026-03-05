import { Router } from "express";
import { requireOwner } from "./middleware";
import { propertyService, subscriptionService, paymentService, addOnService, discountService, contentService, analyticsService } from "../services";
import { firebaseService } from "../firebaseService";
import { r2, R2_BUCKET, R2_PUBLIC_URL } from "../utils/r2";
import { upload, detectDeviceType, SHEET_MAP } from "../utils/helpers";
import { checkPropertyDataComplete, detectSensitiveChanges, smartVerification } from "../utils/verification";
import { PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { calculateSubscriptionEndDate, calculateExtensionEndDate, getStartOfDayRiyadh, formatDateRiyadh } from "../utils/dateUtils";
import {
  notifyPropertyUpdate,
  sendWhatsAppNotification,
  notifyOwnerSubscriptionActivated,
  notifyReceiptUpload,
  notifyNewPayment,
} from "../integrations/whatsapp";
import { paymobService } from "../integrations/paymob";
import { scanReceiptWithAI } from "../integrations/aiReceiptScanner";

const router = Router();

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

    res.json(property);
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


    // 🔍 فحص التعديل الحساس
    const sensitiveChanges = detectSensitiveChanges(currentProperty, updates);
    const previousStatus = currentProperty.verificationStatus;

    if (sensitiveChanges.length > 0 && previousStatus === 'approved') {

      // تطبيق التعديلات أولاً
      const updatedProperty = { ...currentProperty, ...updates };

      // فحص ذكي للتعديل الحساس
      const verificationResult = await smartVerification({
        property: updatedProperty,
        isSensitiveUpdate: true,
        previousVerificationStatus: previousStatus
      });

      // تحديث حالة التحقق بناءً على النتيجة
      if (verificationResult.canAutoActivate) {
        updates.verificationStatus = 'approved';
      } else {
        updates.verificationStatus = 'pending';
      }
    }

    const updated = await propertyService.update(propertyNumber, updates, { skipVerification: true });

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
    const propertyRequests = allRequests.filter(r => r.propertyNumber === propertyNumber);
    res.json(propertyRequests);
  } catch (err) {
    res.status(500).json({ error: "فشل في جلب الطلبات" });
  }
});

// ======================================================
// 📦 GET /api/owner/current-subscription - Owner's current subscription
// ======================================================
router.get("/api/owner/current-subscription", requireOwner, async (req, res) => {
  try {
    // اقرأ رقم العقار من الكوكي وليس السيشن
    const propertyNumber =
      req.cookies?.ownerPropertyNumber ||
      (req.session as any)?.propertyNumber;

    if (!propertyNumber) {
      return res.status(401).json({ error: "NOT_AUTHENTICATED" });
    }


    // استخدام الدالة الجديدة للبحث عن الاشتراك
    let subscription = null;
    try {
      subscription = await subscriptionService.getByProperty(propertyNumber);
    } catch (subErr: any) {
      console.error("Subscription lookup error (returning default):", subErr?.message);
    }

    if (!subscription) {
      // إرجاع اشتراك افتراضي مجاني إذا لم يوجد
      return res.json({
        id: `SUB-${propertyNumber}`,
        propertyNumber,
        packageId: "pkg-free",
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        status: "نشط",
      });
    }

    res.json(subscription);
  } catch (err: any) {
    console.error("Get subscription error:", err?.message);
    // Return a default free subscription instead of 500
    const propertyNumber =
      req.cookies?.ownerPropertyNumber ||
      (req.session as any)?.propertyNumber || "unknown";
    res.json({
      id: `SUB-${propertyNumber}`,
      propertyNumber,
      packageId: "pkg-free",
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      status: "نشط",
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

    // التحقق من اسم العقار في الوصف للعقارات العادية
    const isPremium = property.subscriptionType === "مميز";

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
// 💰 GET /api/owner/payment/check-pending - Check for pending bank transfer
// ======================================================
router.get("/api/owner/payment/check-pending", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    if (!propertyNumber) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const payments = await paymentService.getByProperty(propertyNumber);

    // Look for pending bank transfer payment
    const pendingPayment = payments.find(p =>
      (p.status === "قيد المراجعة" || p.status === "معلق") &&
      p.paymentMethod === "تحويل بنكي"
    );

    if (!pendingPayment) {
      return res.json({ hasPending: false });
    }

    // Auto-check for issues
    const issues: string[] = [];

    if (!pendingPayment.receiptUrl) {
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
    });
  } catch (err: any) {
    console.error("Check pending payment error:", err);
    res.status(500).json({ error: "خطأ في التحقق من الدفع" });
  }
});

// ======================================================
// 💰 POST /api/owner/payment/bank-transfer - Submit bank transfer with receipt
// ======================================================
router.post("/api/owner/payment/bank-transfer", requireOwner, upload.single("receipt"), async (req, res) => {
  try {
    const { propertyNumber, packageId, discountCode, action, secondPropertyNumber } = req.body;
    const isAddon = action === "addon";

    if (!propertyNumber) {
      return res.status(400).json({ error: "رقم العقار مطلوب" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "الإيصال مطلوب" });
    }

    // Get package and property
    const pkg = await firebaseService.getPackageById(packageId);
    if (!pkg) return res.status(404).json({ error: "الباقة غير موجودة" });

    const property = await firebaseService.getPropertyByNumber(propertyNumber);
    if (!property) return res.status(404).json({ error: "العقار غير موجود" });

    // Calculate final price with discount
    let finalAmount = pkg.price;
    if (discountCode) {
      const discount = await firebaseService.getDiscountCodeByCode(discountCode);
      if (discount && discount.isActive) {
        if (discount.type === "نسبة") {
          finalAmount -= (pkg.price * discount.value) / 100;
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
    const payment = await paymentService.create({
      propertyNumber,
      packageId,
      amount: pkg.price,
      discountCode: discountCode || "",
      discountAmount: pkg.price - finalAmount,
      finalAmount,
      status: "قيد التحقق",
      paymentMethod: "تحويل بنكي",
      receiptUrl,
      secondPropertyNumber: secondPropertyNumber || undefined,
      paymentReference,
    } as any);


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
      const todayBankTransfer = getStartOfDayRiyadh();
      const currentSubscription = await subscriptionService.getByProperty(propertyNumber);

      let bankStartDate = todayBankTransfer;
      let bankEndDate = calculateSubscriptionEndDate(null, pkg.duration);

      if (action === 'extend' && currentSubscription) {
        const currentEndDate = new Date(currentSubscription.endDate);
        if (currentEndDate > todayBankTransfer) {
          bankStartDate = currentEndDate;
          bankEndDate = calculateExtensionEndDate(currentEndDate, pkg.duration);
        }
      }

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

    // AI Receipt Scanning
    let aiScanResult = null;
    let autoActivated = false;
    try {
      aiScanResult = await scanReceiptWithAI(
        receiptUrl,
        payment.id,
        finalAmount,
        paymentReference
      );

      if (aiScanResult) {

        // Auto-activate if confidence is high
        if (aiScanResult.recommendation === "تفعيل_تلقائي") {
          await paymentService.setStatus(payment.id, "مكتمل");

          const autoActivateToday = getStartOfDayRiyadh();
          const currentSubscription = await subscriptionService.getByProperty(propertyNumber);

          let startDate = autoActivateToday;
          let endDate = calculateSubscriptionEndDate(null, pkg.duration);

          if (currentSubscription && new Date(currentSubscription.endDate) > autoActivateToday) {
            startDate = new Date(currentSubscription.endDate);
            endDate = calculateExtensionEndDate(startDate, pkg.duration);
          }

          const isPremiumPackage = pkg.type === "موثوق" || pkg.type === "مميز" || finalAmount > 0;

          const subscriptionData = {
            packageId: pkg.id,
            price: finalAmount,
            subscriptionType: isPremiumPackage ? "مميز" : "عادي",
            packageType: isPremiumPackage ? "مميز" : "عادي",
            startDate: formatDateRiyadh(startDate),
            endDate: formatDateRiyadh(endDate),
            paymentId: payment.id,
          };

          await firebaseService.addSubscriptionToSheet(
            propertyNumber,
            subscriptionData,
            property,
            receiptUrl
          );

          // Handle second property for multi-property packages
          if (secondPropertyNumber) {
            const secondProperty = await firebaseService.getPropertyByNumber(secondPropertyNumber);
            if (secondProperty) {
              const pricePerProperty = finalAmount / 2;
              const secondSubscriptionData = {
                ...subscriptionData,
                price: pricePerProperty,
                linkedProperty: propertyNumber,
              };
              await firebaseService.addSubscriptionToSheet(
                secondPropertyNumber,
                secondSubscriptionData,
                secondProperty,
                receiptUrl
              );

              await firebaseService.createMultiPropertySubscription({
                packageId: pkg.id,
                propertyNumber1: propertyNumber,
                propertyNumber2: secondPropertyNumber,
                startDate: formatDateRiyadh(startDate),
                endDate: formatDateRiyadh(endDate),
                status: "نشط",
                paymentId: payment.id,
              });

              // Auto-verify second property
              const secondPropertyComplete = await checkPropertyDataComplete(secondProperty);
              if (secondPropertyComplete.isComplete) {
                await firebaseService.updateVerificationStatus(secondPropertyNumber, "approved");
              } else {
                await firebaseService.updateVerificationStatus(secondPropertyNumber, "pending");
              }
            }
          }

          // Auto-verify first property
          const propertyComplete = await checkPropertyDataComplete(property);
          if (propertyComplete.isComplete) {
            await firebaseService.updateVerificationStatus(propertyNumber, "approved");
          } else {
            await firebaseService.updateVerificationStatus(propertyNumber, "pending");
          }

          autoActivated = true;

          // Send admin notification
          const verificationStatus1 = propertyComplete.isComplete ? '✅ معتمد' : '⏳ ينتظر مراجعة';
          let adminNotification =
            `🤖 *تفعيل تلقائي - تحويل بنكي*\n\n` +
            `📍 العقار: ${property.name}\n` +
            `🔢 رقم العقار: ${propertyNumber}\n` +
            `📦 الباقة: ${pkg.name}\n` +
            `💵 المبلغ: ${finalAmount} ر.س\n` +
            `📅 من: ${subscriptionData.startDate}\n` +
            `📅 إلى: ${subscriptionData.endDate}\n` +
            `🔬 نسبة التطابق: ${aiScanResult.matchAnalysis.matchScore}%\n` +
            `📊 حالة التحقق: ${verificationStatus1}\n`;

          if (secondPropertyNumber) {
            const secondProp = await firebaseService.getPropertyByNumber(secondPropertyNumber);
            const verificationStatus2 = (await checkPropertyDataComplete(secondProp || {})).isComplete ? '✅ معتمد' : '⏳ ينتظر مراجعة';
            adminNotification +=
              `\n🏠 *العقار الثاني:*\n` +
              `📍 الاسم: ${secondProp?.name || secondPropertyNumber}\n` +
              `🔢 الرقم: ${secondPropertyNumber}\n` +
              `📊 حالة التحقق: ${verificationStatus2}\n`;
          }

          adminNotification += `\n✅ تم تفعيل الاشتراك تلقائياً بعد فحص الإيصال`;

          await sendWhatsAppNotification(adminNotification).catch(err => console.error("WhatsApp notify error:", err));

          // Notify owner
          if (property.whatsappNumber) {
            try {
              await notifyOwnerSubscriptionActivated({
                ownerPhone: property.whatsappNumber,
                propertyNumber: propertyNumber,
                propertyName: property.name || "",
                endDate: subscriptionData.endDate,
              });
            } catch (ownerErr) {
              console.error("Owner notification error:", ownerErr);
            }
          }
        } else {
          // Manual approval needed
          await sendWhatsAppNotification(
            `⏳ *تحويل بنكي - يحتاج مراجعة*\n\n` +
            `📍 العقار: ${property.name}\n` +
            `🔢 رقم العقار: ${propertyNumber}\n` +
            `📦 الباقة: ${pkg.name}\n` +
            `💵 المبلغ: ${finalAmount} ر.س\n` +
            `🧾 رقم المرجع: ${paymentReference}\n` +
            `🔬 نتيجة الفحص: ${aiScanResult?.recommendation || 'غير معروف'}\n` +
            `📊 نسبة التطابق: ${aiScanResult?.matchAnalysis?.matchScore || 0}%\n\n` +
            `⚠️ يحتاج موافقة يدوية من الإدارة`
          ).catch(err => console.error("WhatsApp notify error:", err));
        }
      }
    } catch (aiErr) {
      console.error("AI Scanner error:", aiErr);
      await sendWhatsAppNotification(
        `⏳ *تحويل بنكي - يحتاج مراجعة*\n\n` +
        `📍 العقار: ${property.name}\n` +
        `🔢 رقم العقار: ${propertyNumber}\n` +
        `📦 الباقة: ${pkg.name}\n` +
        `💵 المبلغ: ${finalAmount} ر.س\n` +
        `🧾 رقم المرجع: ${paymentReference}\n` +
        `🔬 خطأ في فحص الإيصال\n\n` +
        `⚠️ يحتاج موافقة يدوية من الإدارة`
      ).catch(err => console.error("WhatsApp notify error:", err));
    }

    res.json({
      ok: true,
      paymentId: payment.id,
      autoActivated: autoActivated,
      pendingApproval: !autoActivated,
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

export default router;
