import { Router } from "express";
import { requireOwner } from "./middleware";
import { propertyService, subscriptionService, paymentService, addOnService, discountService, contentService, analyticsService } from "../services";
import { firebaseService } from "../firebaseService";
import { r2, R2_BUCKET, R2_PUBLIC_URL } from "../utils/r2";
import { upload, detectDeviceType, SHEET_MAP } from "../utils/helpers";
import { checkPropertyDataComplete, detectSensitiveChanges, smartVerification } from "../utils/verification";
import { PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { calculateSubscriptionEndDate, calculateExtensionEndDate, getStartOfDayRiyadh, formatDateRiyadh } from "../utils/dateUtils";
import { storage } from "../storage";
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
router.post("/api/owner/images", requireOwner, upload.array("images"), async (req, res) => {
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
    const errorMsg = err?.message || "فشل الرفع";
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
    res.status(500).json({ error: "فشل الحذف" });
  }
});

router.post("/api/owner/property/activate", requireOwner, async (req, res) => {
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

    if (requestedStatus === 'rejected') {
      await firebaseService.updateVerificationStatus(propertyNumber, "rejected");

      return res.json({
        success: true,
        message: "تم تحديث حالة العقار إلى مرفوض",
        status: 'rejected'
      });
    }

    const payments = await paymentService.getByProperty(propertyNumber);

    const completedPayment = payments.find(p => p.status === "مكتمل");
    const cardSuccessPayment = payments.find(p => p.status === "نجح - قيد التحقق");
    const bankTransferPayment = payments.find(p => p.status === "قيد التحقق" && p.paymentMethod === "تحويل بنكي");
    const cardPendingPayment = payments.find(p => p.status === "قيد المراجعة" && (p.paymentMethod === "بطاقة" || p.paymentMethod === "Apple Pay"));

    let pendingPayment = cardSuccessPayment || bankTransferPayment;
    let isBankTransfer = !!bankTransferPayment && !cardSuccessPayment;

    if (!pendingPayment) {
      const currentSubscription = await subscriptionService.getByProperty(propertyNumber);
      const isNewProperty = !currentSubscription || !currentSubscription.endDate;
      const freePkg = await storage.getPackageById("pkg-free");

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

    const canAutoActivate = !isBankTransfer && (
      paymentStatus === "مكتمل" ||
      paymentStatus === "completed" ||
      paymentStatus === "نجح - قيد التحقق"
    );

    if (canAutoActivate) {

      if (paymentStatus !== "مكتمل" && paymentStatus !== "completed") {
        await paymentService.setStatus(pendingPayment.id, "مكتمل");
      }

      if (!pkg) {
        return res.status(404).json({ error: "الباقة غير موجودة" });
      }

      const cardPayToday = getStartOfDayRiyadh();
      const currentSubscription = await subscriptionService.getByProperty(propertyNumber);

      let startDate = cardPayToday;
      let endDate = calculateSubscriptionEndDate(null, pkg.duration);

      if (currentSubscription && new Date(currentSubscription.endDate) > cardPayToday) {
        startDate = new Date(currentSubscription.endDate);
        endDate = calculateExtensionEndDate(startDate, pkg.duration);
      }

      const isPremiumApproval = pkg.type === "موثوق" || pkg.type === "مميز" || pendingPayment.finalAmount > 0;

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

          await firebaseService.createMultiPropertySubscription({
            packageId: pkg.id,
            propertyNumber1: propertyNumber,
            propertyNumber2: (pendingPayment as any).secondPropertyNumber,
            startDate: formatDateRiyadh(startDate),
            endDate: formatDateRiyadh(endDate),
            status: "نشط",
            paymentId: pendingPayment.id,
          });
        }
      }

      await firebaseService.updateVerificationStatus(propertyNumber, "approved");
      if ((pendingPayment as any).secondPropertyNumber) {
        await firebaseService.updateVerificationStatus((pendingPayment as any).secondPropertyNumber, "approved");
      }

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
      `⏳ *طلب اشتراك - يحتاج مراجعة*\n\n` +
      `📍 العقار: ${property.name}\n` +
      `🔢 رقم العقار: ${propertyNumber}\n` +
      `📦 الباقة: ${pkg?.name || pendingPayment.packageId}\n` +
      `💳 طريقة الدفع: ${pendingPayment.paymentMethod}\n` +
      `💵 المبلغ: ${pendingPayment.finalAmount} ر.س\n` +
      `📊 حالة الدفع: ${paymentStatus}\n` +
      `🧾 الإيصال: ${pendingPayment.receiptUrl ? 'مرفق' : 'غير مرفق'}\n\n` +
      `⚠️ يحتاج موافقة يدوية من الإدارة`
    );

    return res.json({
      success: true,
      message: "عقارك قيد المراجعة - سيتم تفعيل الاشتراك بعد موافقة الإدارة",
      isBankTransfer: isBankTransfer,
      pendingAdminApproval: true,
      subscriptionActivated: false,
      paymentStatus: paymentStatus
    });
  } catch (err: any) {
    console.error("Property activation error:", err);
    res.status(500).json({
      success: false,
      error: `خطأ في تفعيل الاشتراك: ${err.message || 'خطأ غير معروف'}`
    });
  }
});


router.post("/api/owner/payment/initiate", requireOwner, async (req, res) => {
  try {
    const { packageId, discountCode, action, secondPropertyNumber } = req.body;
    const propertyNumber = (req.session as any).propertyNumber;

    if (!propertyNumber) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const property = await firebaseService.getPropertyByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    const pkg = await storage.getPackageById(packageId);
    if (!pkg) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    let finalAmount = pkg.price;
    let discountAmount = 0;

    if (discountCode) {
      const discount = await storage.getDiscountCodeByCode(discountCode);
      if (discount && discount.isActive) {
        if (discount.type === "نسبة") {
          discountAmount = (pkg.price * discount.value) / 100;
          finalAmount -= discountAmount;
        } else {
          discountAmount = discount.value;
          finalAmount -= discountAmount;
        }
      }
    }

    const payment = await paymentService.create({
      propertyNumber,
      packageId,
      amount: pkg.price,
      discountCode: discountCode || "",
      discountAmount,
      finalAmount,
      status: "قيد المراجعة",
      paymentMethod: "بطاقة",
      secondPropertyNumber: secondPropertyNumber || undefined,
    } as any);

    const paymentReference = `RWQN-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    await paymentService.update(payment.id, { paymentReference });

    const paymobPayment = await paymobService.createIntention(
      finalAmount,
      propertyNumber,
      property.name || "عقار",
      property.whatsappNumber || "0500000000",
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
    });
  } catch (err: any) {
    console.error("Initiate payment error:", err);
    res.status(500).json({ error: err.message || "خطأ في بدء الدفع" });
  }
});

export default router;
