import { Router } from "express";
import { requireOwner } from "./middleware";
import { propertyService, subscriptionService, paymentService, addOnService, discountService, contentService, analyticsService, occasionService } from "../services";
import { firebaseService } from "../firebaseService";
import { r2, R2_BUCKET, R2_PUBLIC_URL } from "../utils/r2";
import { upload, uploadImages, detectDeviceType, SHEET_MAP, normalizePhoneNumber } from "../utils/helpers";
import { checkPropertyDataComplete } from "../utils/verification";
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
    const pkg = await firebaseService.getPackageById(packageId);
    if (!pkg) return res.status(404).json({ error: "الباقة غير موجودة" });

    const property = await firebaseService.getPropertyByNumber(propertyNumber);
    if (!property) return res.status(404).json({ error: "العقار غير موجود" });

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
    
    if (parsedSecondPropertyNumber && !allAdditionalProps.includes(parsedSecondPropertyNumber)) {
      allAdditionalProps.push(parsedSecondPropertyNumber);
    }
    
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
    console.log(`[BANK_TRANSFER] Creating payment for propertyNumber: "${propertyNumber}", packageId: "${packageId}"`);
    const payment = await paymentService.create({
      propertyNumber,
      packageId,
      amount: finalAmount,
      discountCode: discountCode || "",
      discountAmount: 0,
      finalAmount,
      status: "قيد التحقق",
      paymentMethod: "تحويل بنكي",
      receiptUrl,
      secondPropertyNumber: secondPropertyNumber || undefined,
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
          // Also sync linked properties from existing subscription/group
          const linkedPropsToSync: string[] = [];
          if (secondPropertyNumber) {
            linkedPropsToSync.push(secondPropertyNumber);
          }
          
          // If no explicit second property, look up existing linked properties
          if (linkedPropsToSync.length === 0 && currentSubscription) {
            if (currentSubscription.linkedProperties && currentSubscription.linkedProperties.length > 0) {
              for (const lp of currentSubscription.linkedProperties) {
                if (lp !== propertyNumber && !linkedPropsToSync.includes(lp)) {
                  linkedPropsToSync.push(lp);
                }
              }
            }
            if ((currentSubscription as any).linkedProperty) {
              const mainPropNum = (currentSubscription as any).linkedProperty;
              if (!linkedPropsToSync.includes(mainPropNum)) {
                linkedPropsToSync.push(mainPropNum);
              }
              const mainSub = await subscriptionService.getByProperty(mainPropNum);
              if (mainSub?.linkedProperties) {
                for (const lp of mainSub.linkedProperties) {
                  if (lp !== propertyNumber && !linkedPropsToSync.includes(lp)) {
                    linkedPropsToSync.push(lp);
                  }
                }
              }
            }
          }

          // Sync subscription to all linked properties
          for (const linkedPropNum of linkedPropsToSync) {
            const linkedProp = await firebaseService.getPropertyByNumber(linkedPropNum);
            if (linkedProp) {
              const linkedSubData = {
                ...subscriptionData,
                price: finalAmount / (1 + linkedPropsToSync.length),
                linkedProperty: propertyNumber,
              };
              await firebaseService.addSubscriptionToSheet(
                linkedPropNum,
                linkedSubData,
                linkedProp,
                receiptUrl
              );
              await firebaseService.updateProperty(linkedPropNum, {
                subscriptionType: isPremiumPackage ? "مميز" : "عادي"
              });

              const linkedPropComplete = await checkPropertyDataComplete(linkedProp);
              if (linkedPropComplete.isComplete) {
                await firebaseService.updateVerificationStatus(linkedPropNum, "approved");
              } else {
                await firebaseService.updateVerificationStatus(linkedPropNum, "pending");
              }
            }
          }

          if (linkedPropsToSync.length > 0 && !secondPropertyNumber) {
            // Create/update multi-property subscription record
            await firebaseService.createMultiPropertySubscription({
              packageId: pkg.id,
              propertyNumber1: propertyNumber,
              propertyNumber2: linkedPropsToSync[0],
              additionalProperties: linkedPropsToSync,
              startDate: formatDateRiyadh(startDate),
              endDate: formatDateRiyadh(endDate),
              status: "نشط",
              paymentId: payment.id,
            });
          } else if (secondPropertyNumber) {
            // Original secondPropertyNumber flow - create multi-property record
            await firebaseService.createMultiPropertySubscription({
              packageId: pkg.id,
              propertyNumber1: propertyNumber,
              propertyNumber2: secondPropertyNumber,
              startDate: formatDateRiyadh(startDate),
              endDate: formatDateRiyadh(endDate),
              status: "نشط",
              paymentId: payment.id,
            });
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
    const cardSuccessPayment = payments.find(p => p.status === "نجح - قيد التحقق");
    const bankTransferPayment = payments.find(p => p.status === "قيد التحقق" && p.paymentMethod === "تحويل بنكي");
    const cardPendingPayment = payments.find(p => p.status === "قيد المراجعة" && (p.paymentMethod === "بطاقة" || p.paymentMethod === "Apple Pay"));

    let pendingPayment = cardSuccessPayment || bankTransferPayment;
    let isBankTransfer = !!bankTransferPayment && !cardSuccessPayment;

    if (!pendingPayment) {
      const currentSubscription = await subscriptionService.getByProperty(propertyNumber);
      const isNewProperty = !currentSubscription?.endDate;
      const freePkg = await storage.getPackageById("pkg-free");

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

    const pkg = await storage.getPackageById(packageId);
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
    
    if (parsedSecondPropertyNumber && !allAdditionalProps.includes(parsedSecondPropertyNumber)) {
      allAdditionalProps.push(parsedSecondPropertyNumber);
    }
    
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

    // Check if this is a package downgrade (for extend/upgrade actions)
    let downgradeWarning = null;
    let willAutoUnlink = 0;
    if (action === 'upgrade' || action === 'extend') {
      const currentSubscription = await firebaseService.getSubscriptionByPropertyNumber(propertyNumber);
      const currentLinkedCount = currentSubscription?.linkedProperties?.length || 0;
      const newPackageMaxProps = (pkg as any).maxProperties || 1;
      
      if (currentLinkedCount > newPackageMaxProps) {
        willAutoUnlink = currentLinkedCount - newPackageMaxProps;
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
      secondPropertyNumber: secondPropertyNumber || undefined,
      additionalProperties: allAdditionalProps.length > 0 ? allAdditionalProps : undefined,
      linkedProperties: allAdditionalProps.length > 0 ? allAdditionalProps : undefined,
    } as any);
    console.log(`[CARD_PAYMENT] ✅ Payment created: ${payment.id} for property: ${propertyNumber}, package: ${packageId}`);

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

    if (payment.status === "مكتمل" || payment.status === "completed") {
      return res.status(400).json({ error: "الدفعة مكتملة مسبقاً" });
    }

    const pkg = await storage.getPackageById(payment.packageId);
    if (!pkg) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    const property = await firebaseService.getPropertyByNumber(payment.propertyNumber);
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
      (subscription.status === 'نشط' || subscription.status === 'ساري' || subscription.status === 'active') &&
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
// طلب إضافة عقار إضافي (يتطلب موافقة الأدمن)
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

    await firebaseService.updateProperty(additionalPropertyNumber, {
      pendingApprovalFrom: ownerPropertyNumber
    });

    res.json({
      ok: true,
      message: "تم إرسال طلب إضافة العقار الإضافي. في انتظار موافقة الأدمن.",
      additionalProperty: {
        number: additionalProperty.propertyNumber,
        name: additionalProperty.name,
        pendingApprovalFrom: ownerPropertyNumber
      }
    });
  } catch (err: any) {
    console.error("Request additional property error:", err);
    res.status(500).json({ error: err?.message || "فشل في إرسال الطلب" });
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
      s.linkedProperty === propertyNumber && s.status === 'نشط'
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
      if (multiSub.status !== 'نشط') continue;
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

    const newPackage = await storage.getPackageById(packageId);
    if (!newPackage) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    // Check if new package can accommodate current linked properties
    const currentSubscription = await firebaseService.getSubscriptionByPropertyNumber(propertyNumber);
    const currentLinkedCount = currentSubscription?.linkedProperties?.length || 0;
    const newPackageMaxProps = (newPackage as any).maxProperties || 1;
    
    let warning = null;
    let willAutoUnlink = 0;
    
    if (currentLinkedCount > newPackageMaxProps) {
      willAutoUnlink = currentLinkedCount - newPackageMaxProps;
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
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    const { action, packageId, paymentId } = req.body;

    const newPackage = await storage.getPackageById(packageId);
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

    const currentSubscription = subscriptions.find(
      s => (s.status === 'نشط' || s.status === 'نشط مجاني' || s.status === 'ساري' || s.status === 'active') &&
        new Date(s.endDate) > new Date()
    );

    console.log(`📋 [Owner Confirm] Current subscription:`, currentSubscription ?
      `status=${currentSubscription.status}, endDate=${currentSubscription.endDate}` : 'None');

    const confirmToday = getStartOfDayRiyadh();
    let newStartDate = confirmToday;
    let newEndDate: Date;

    if (action === 'extend' && currentSubscription) {
      newStartDate = new Date(currentSubscription.endDate);
      newEndDate = calculateExtensionEndDate(newStartDate, newPackage.duration);
      console.log(`📅 [Owner Confirm] Extending from ${currentSubscription.endDate} + ${newPackage.duration} days`);
    } else {
      newEndDate = calculateSubscriptionEndDate(null, newPackage.duration);
      console.log(`📅 [Owner Confirm] New subscription starting today + ${newPackage.duration} days`);
    }

    const isPremium = newPackage.type === "موثوق" || newPackage.type === "مميز" || newPackage.price > 0;

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
      linkedProperties: currentSubscription?.linkedProperties || undefined,
      propertyCount: (currentSubscription?.linkedProperties?.length || 0) + 1,
    };

    await firebaseService.addSubscriptionToSheet(
      propertyNumber,
      subscriptionData,
      property,
      undefined
    );

    console.log(`✅ [Owner Confirm] Subscription activated for: ${propertyNumber}`);

    // Auto-renew linked properties with same dates
    const currentLinkedProperties = currentSubscription?.linkedProperties || [];
    if (currentLinkedProperties.length > 0) {
      console.log(`🔗 [Owner Confirm] Auto-renewing ${currentLinkedProperties.length} linked properties`);
      
      for (const linkedPropNum of currentLinkedProperties) {
        const linkedProperty = await firebaseService.getPropertyByNumber(linkedPropNum);
        const linkedSubscription = await firebaseService.getSubscriptionByPropertyNumber(linkedPropNum);
        
        if (linkedSubscription) {
          await firebaseService.updateSubscription(linkedSubscription.id, {
            startDate: newStartDate.toISOString(),
            endDate: newEndDate.toISOString(),
            packageId: packageId,
            subscriptionType: isPremium ? "مميز" : "عادي",
            packageType: isPremium ? "مميز" : "عادي",
            status: 'نشط'
          });
          console.log(`✅ [Owner Confirm] Updated linked property ${linkedPropNum} subscription to match main property dates`);
        }
      }
    }

    // Auto-unlink excess properties if new package has fewer slots
    const maxProperties = (newPackage as any).maxProperties || 1;
    const linkedPropertiesAfterRenew = currentSubscription?.linkedProperties || [];
    
    if (currentSubscription && linkedPropertiesAfterRenew.length > maxProperties) {
      const toUnlink = linkedPropertiesAfterRenew.slice(maxProperties);
      console.log(`🔗 [Owner Confirm] Auto-unlinking ${toUnlink.length} properties due to package downgrade`);
      
      const remainingLinked = linkedPropertiesAfterRenew.slice(0, maxProperties);
      
      // Update main property's linkedProperties
      await firebaseService.updateSubscription(currentSubscription.id, {
        linkedProperties: remainingLinked,
        propertyCount: maxProperties + 1
      });
      
      // Clear linkedProperty on unlinked subscriptions (keep subscriptions as-is)
      for (const propNum of toUnlink) {
        const unlinkedSub = await firebaseService.getSubscriptionByPropertyNumber(propNum);
        if (unlinkedSub) {
          await firebaseService.updateSubscription(unlinkedSub.id, {
            linkedProperty: ""
          });
          console.log(`✅ [Owner Confirm] Unlinked property ${propNum} - subscription kept active until expiry`);
        }
      }
    }

    // Update property's subscriptionType to match the package
    await firebaseService.updateProperty(propertyNumber, { 
      subscriptionType: isPremium ? "مميز" : "عادي" 
    });

    await firebaseService.updateVerificationStatus(propertyNumber, "approved");

    res.json({
      ok: true,
      message: `تم ${action === 'extend' ? 'التمديد' : 'الترقية'} بنجاح`,
      subscription: subscriptionData,
      endDate: newEndDate,
    });
  } catch (err: any) {
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
