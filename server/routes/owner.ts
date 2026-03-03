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

    console.log(`📝 [Property Update] ${propertyNumber}: ${changesSummary}`);

    // 🔍 فحص التعديل الحساس
    const sensitiveChanges = detectSensitiveChanges(currentProperty, updates);
    const previousStatus = currentProperty.verificationStatus;

    if (sensitiveChanges.length > 0 && previousStatus === 'approved') {
      console.log(`⚠️ [Sensitive Update] ${propertyNumber}: ${sensitiveChanges.join(', ')}`);

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
        console.log(`✅ [Auto-Approved] التعديل الحساس تم قبوله تلقائياً`);
      } else {
        updates.verificationStatus = 'pending';
        console.log(`⏳ [Pending Review] التعديل الحساس يتطلب مراجعة الأدمن`);
      }
    }

    const updated = await propertyService.update(propertyNumber, updates);

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

    console.log(`🔍 Looking for subscription for property: ${propertyNumber}`);

    // استخدام الدالة الجديدة للبحث عن الاشتراك
    const subscription = await subscriptionService.getByProperty(propertyNumber);

    if (!subscription) {
      console.log(`❌ No subscription found for property: ${propertyNumber}`);
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

    console.log(`✅ Found subscription for ${propertyNumber}:`, subscription);
    res.json(subscription);
  } catch (err: any) {
    console.error("Get subscription error:", err?.message);
    res.status(500).json({ error: "Failed to load subscription" });
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

    console.log(`🔍 Fetching payments for property: ${propertyNumber}`);

    const payments = await paymentService.getByProperty(propertyNumber);

    console.log(`✅ Found ${payments.length} payments for property: ${propertyNumber}`);
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
// ✅ POST /api/owner/verify-second-property - Verify second property
// ======================================================
router.post("/api/owner/verify-second-property", requireOwner, async (req, res) => {
  try {
    const ownerPropertyNumber = (req.session as any).propertyNumber;
    const { secondPropertyNumber } = req.body;

    if (!secondPropertyNumber) {
      return res.status(400).json({ error: "رقم العقار الثاني مطلوب" });
    }

    // التحقق من أن العقار الثاني ليس نفس العقار الأول
    if (secondPropertyNumber === ownerPropertyNumber) {
      return res.status(400).json({ error: "لا يمكن اختيار نفس العقار" });
    }

    // جلب بيانات العقار الأول
    const ownerProperty = await propertyService.getByNumber(ownerPropertyNumber);
    if (!ownerProperty) {
      return res.status(404).json({ error: "لم يتم العثور على عقارك" });
    }

    // جلب بيانات العقار الثاني
    const secondProperty = await propertyService.getByNumber(secondPropertyNumber);
    if (!secondProperty) {
      return res.status(404).json({ error: "لم يتم العثور على العقار الثاني" });
    }

    // التحقق من تطابق الـ PIN (نفس المالك)
    if (secondProperty.pin !== ownerProperty.pin) {
      return res.status(403).json({ error: "هذا العقار يخص مالك آخر" });
    }

    // التحقق من أن العقار الثاني ليس لديه اشتراك مميز نشط
    const secondSubscription = await subscriptionService.getByProperty(secondPropertyNumber);
    if (secondSubscription && secondSubscription.status === 'نشط') {
      const endDate = new Date(secondSubscription.endDate);
      if (endDate > new Date()) {
        return res.status(400).json({
          error: "العقار الثاني لديه اشتراك نشط بالفعل",
          existingEndDate: secondSubscription.endDate
        });
      }
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
// 💳 POST /api/owner/subscription/prepare-payment - Prepare payment
// ======================================================
router.post("/api/owner/subscription/prepare-payment", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    const { action, packageId } = req.body;

    if (!['extend', 'upgrade'].includes(action)) {
      return res.status(400).json({ error: "إجراء غير صالح" });
    }

    const newPackage = await subscriptionService.getPackageById(packageId);
    if (!newPackage) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    // إرجاع معلومات الدفع المطلوبة
    res.json({
      ok: true,
      paymentRequired: true,
      action,
      packageId,
      packageName: newPackage.name,
      price: newPackage.price,
      duration: newPackage.duration,
      paymentMethods: ["بطاقة", "Apple Pay", "تحويل بنكي"],
      message: `يجب إتمام الدفع للقيام بـ ${action === 'extend' ? 'التمديد' : 'الترقية'}`
    });
  } catch (err: any) {
    console.error("Subscription prepare payment error:", err);
    res.status(500).json({ error: err?.message || "فشل في التحضير" });
  }
});

// ======================================================
// ✅ POST /api/owner/subscription/confirm - Confirm subscription
// ======================================================
router.post("/api/owner/subscription/confirm", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    const { action, packageId, paymentId } = req.body;

    const newPackage = await subscriptionService.getPackageById(packageId);
    if (!newPackage) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    console.log(`📦 [Owner Confirm] Package: id=${newPackage.id}, name=${newPackage.name}, type=${newPackage.type}, price=${newPackage.price}`);

    // جلب بيانات العقار
    const property = await propertyService.getByNumber(propertyNumber);

    const subscriptions = await firebaseService.getSubscriptionsByProperty(propertyNumber);
    console.log(`📋 [Owner Confirm] Found ${subscriptions.length} subscriptions for ${propertyNumber}`);

    // البحث عن أي اشتراك نشط (مميز أو مجاني) لم ينتهي بعد
    const currentSubscription = subscriptions.find(
      s => (s.status === 'نشط' || s.status === 'نشط مجاني' || s.status === 'ساري') &&
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

    // بيانات الاشتراك للإضافة في شيت الاشتراكات
    const subscriptionData = {
      propertyNumber,
      packageId,
      startDate: newStartDate.toISOString(),
      endDate: newEndDate.toISOString(),
      status: 'نشط',
      paymentId: paymentId,
      price: newPackage.price,
      packageType: newPackage.type,
    };

    // 📋 إضافة/تحديث الاشتراك في شيت الاشتراكات + تحديث شيت بيانات العقارات
    await firebaseService.addSubscriptionToSheet(
      propertyNumber,
      subscriptionData,
      property,
      undefined // receiptUrl
    );

    console.log(`✅ [Owner Confirm] Subscription activated for: ${propertyNumber} (Both sheets updated)`);

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

// ======================================================
// 🔵 GET /api/owner/r2-images - Get R2 images
// ======================================================
router.get("/api/owner/r2-images", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber;

    console.log(`🔍 [FETCH] Getting images for property ${propertyNumber}`);

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
    console.log(`✅ [FETCH] Found ${count} images for ${propertyNumber}`);
    console.log(`📊 [FETCH] Objects:`, list.Contents?.map(o => o.Key));

    let images =
      list.Contents?.map(obj => `${R2_PUBLIC_URL}/${obj.Key}`) || [];

    // ترتيب حسب رقم الصورة 1,2,3...
    images.sort((a, b) => {
      const aParts = a.split("/").pop() || "";
      const bParts = b.split("/").pop() || "";
      const na = parseInt(aParts.replace(".jpg", "")) || 0;
      const nb = parseInt(bParts.replace(".jpg", "")) || 0;
      return na - nb;
    });

    console.log(`✅ [FETCH] Returning ${images.length} image URLs`);
    res.json({ images });

  } catch (err: any) {
    console.error("❌ [FETCH] Error:", err?.message);
    res.json({ images: [] });
  }
});

// ======================================================
// 🟢 POST /api/owner/images - Upload images to R2
// ======================================================
router.post("/api/owner/images", requireOwner, upload.array("images"), async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber || "";

    console.log(`📸 [UPLOAD] Property ${propertyNumber}, Files:`, req.files?.length);

    if (!propertyNumber) {
      console.error("❌ [UPLOAD] No property number in session");
      return res.status(400).json({ error: "Property number not found in session" });
    }

    if (!r2 || !R2_BUCKET) {
      console.error("❌ [UPLOAD] R2_BUCKET not configured");
      return res.status(500).json({ error: "R2 bucket not configured" });
    }

    const files = (req.files as any) || [];
    if (!files || files.length === 0) {
      console.error("❌ [UPLOAD] No files received");
      return res.status(400).json({ error: "لا توجد صور تم رفعها" });
    }

    const uploadedKeys: string[] = [];
    const timestamp = Date.now();

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // استخدام timestamp + index لتجنب التكرار
      const key = `${propertyNumber}/${timestamp}-${i}.jpg`;

      console.log(`⬆️ [UPLOAD] Uploading ${key} (${file.size} bytes)`);

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
      console.log(`✅ [UPLOAD] Uploaded ${key}`);
      uploadedKeys.push(key);
    }

    // تحويل keys إلى URLs مباشرة
    const uploadedUrls = uploadedKeys.map(key => `${R2_PUBLIC_URL}/${key}`);
    console.log(`✅ [UPLOAD] Done! Uploaded ${files.length} images. URLs:`, uploadedUrls);

    // تسجيل التغيير في العقار
    const changeNote = `إضافة ${files.length} صورة جديدة`;
    await propertyService.update(propertyNumber, { lastChanges: changeNote });

    // إشعار واتساب
    const property = await propertyService.getByNumber(propertyNumber);
    notifyPropertyUpdate({
      propertyNumber,
      propertyName: property?.name || '',
      changes: changeNote,
    }).catch(err => console.error("WhatsApp notify error:", err));

    res.json({ ok: true, count: files.length, uploaded: uploadedKeys, urls: uploadedUrls });

  } catch (err: any) {
    console.error("❌ [UPLOAD] Error:", err?.message);
    const errorMsg = err?.message || "فشل الرفع";
    res.status(500).json({ error: errorMsg });
  }
});

// ======================================================
// 🔴 POST /api/owner/images/delete - Delete R2 image
// ======================================================
router.post("/api/owner/images/delete", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber || "";
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL مطلوبة" });
    }

    // استخراج الـ key من URL: https://.../{propertyNumber}/{fileName}
    const key = `${propertyNumber}/${url.split("/").pop()}`;

    console.log(`🔴 [DELETE] Deleting: ${key}`);

    if (r2) {
      await r2.send(
        new DeleteObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
        })
      );
    }

    console.log(`✅ [DELETE] Deleted: ${key}`);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("❌ [DELETE] Error:", err?.message);
    res.status(500).json({ error: "فشل الحذف" });
  }
});

// ======================================================
// 🚀 POST /api/owner/property/activate - Activate property (complex multi-scenario)
// ======================================================
router.post("/api/owner/property/activate", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    if (!propertyNumber) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // قراءة الحالة المطلوبة من الطلب (approved أو rejected)
    const requestedStatus = req.body.status || 'approved';

    // جلب بيانات العقار
    const property = await propertyService.getByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    // إذا كانت الحالة rejected، نحدث مباشرة ونخرج
    if (requestedStatus === 'rejected') {
      await firebaseService.updateVerificationStatus(propertyNumber, "rejected");
      console.log(`❌ Verification status updated to 'rejected' for property ${propertyNumber}`);

      return res.json({
        success: true,
        message: "تم تحديث حالة العقار إلى مرفوض",
        status: 'rejected'
      });
    }

    // البحث عن دفعات معلقة أو مكتملة
    const payments = await paymentService.getByProperty(propertyNumber);

    console.log(`📋 [Verify] Found ${payments.length} payments for property ${propertyNumber}`);
    payments.forEach((p, i) => {
      console.log(`   Payment ${i + 1}: status=${p.status}, method=${p.paymentMethod}, amount=${p.finalAmount}`);
    });

    // ترتيب الدفعات حسب الأولوية: مكتمل > نجح - قيد التحقق > قيد التحقق (تحويل) > قيد المراجعة (بطاقة)
    const completedPayment = payments.find(p => p.status === "مكتمل");
    const cardSuccessPayment = payments.find(p => p.status === "نجح - قيد التحقق");
    const bankTransferPayment = payments.find(p => p.status === "قيد التحقق" && p.paymentMethod === "تحويل بنكي");
    const cardPendingPayment = payments.find(p => p.status === "قيد المراجعة" && (p.paymentMethod === "بطاقة" || p.paymentMethod === "Apple Pay"));

    // السيناريو 0: دفعة مكتملة موجودة - التحقق فقط (الاشتراك مُفعّل مسبقاً)
    if (completedPayment) {
      await firebaseService.updateVerificationStatus(propertyNumber, "approved");
      console.log(`✅ [Verify] Payment already completed for ${propertyNumber} - verification only`);

      return res.json({
        success: true,
        message: "تم التحقق من بيانات العقار بنجاح - الاشتراك مُفعّل مسبقاً",
        verificationOnly: true,
        alreadyActivated: true
      });
    }

    // السيناريو 1: بطاقة لم تُدفع بعد (قيد المراجعة) - لا نفعل الاشتراك
    if (cardPendingPayment && !cardSuccessPayment && !bankTransferPayment) {
      // تحديث حالة التحقق فقط
      await firebaseService.updateVerificationStatus(propertyNumber, "approved");
      console.log(`⚠️ Card payment pending - verification only for property ${propertyNumber}`);

      return res.json({
        success: true,
        message: "تم التحقق من البيانات. يرجى إكمال عملية الدفع بالبطاقة لتفعيل الاشتراك",
        verificationOnly: true,
        paymentPending: true,
        paymentMethod: "card"
      });
    }

    // تحديد الدفعة المناسبة للتفعيل
    let pendingPayment = cardSuccessPayment || bankTransferPayment;
    let isBankTransfer = !!bankTransferPayment && !cardSuccessPayment;

    // السيناريو 2: لا توجد دفعة مدفوعة - عقار جديد مجاني يحتاج موافقة الإدارة
    if (!pendingPayment) {
      // التحقق من وجود اشتراك سابق
      const currentSubscription = await subscriptionService.getByProperty(propertyNumber);
      const isNewProperty = !currentSubscription || !currentSubscription.endDate;

      // جلب الباقة المجانية
      const freePkg = await subscriptionService.getPackageById("pkg-free");
      if (!freePkg) {
        await firebaseService.updateVerificationStatus(propertyNumber, "approved");
        console.log(`✅ Verification approved for property ${propertyNumber} (no free package found)`);
        return res.json({
          success: true,
          message: "تم التحقق من بيانات العقار بنجاح",
          verificationOnly: true
        });
      }

      // ⚠️ العقار الجديد المجاني يحتاج موافقة الإدارة
      if (isNewProperty) {
        // تحديث حالة التحقق فقط - لا يتم تفعيل الاشتراك (pending = بانتظار موافقة الإدارة)
        await firebaseService.updateVerificationStatus(propertyNumber, "pending");
        console.log(`🆕 [Verify] New free property ${propertyNumber} - waiting for admin approval`);

        // إشعار للأدمن
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

      // عقار موجود مسبقاً (تجديد اشتراك مجاني) - تفعيل تلقائي
      const freeToday = getStartOfDayRiyadh();
      let startDate = freeToday;
      let endDate = calculateSubscriptionEndDate(null, freePkg.duration);

      if (currentSubscription && new Date(currentSubscription.endDate) > freeToday) {
        startDate = new Date(currentSubscription.endDate);
        endDate = calculateExtensionEndDate(startDate, freePkg.duration);
      }

      const freeSubscriptionData = {
        packageId: freePkg.id,
        price: 0,
        subscriptionType: "عادي",
        packageType: "عادي",
        startDate: formatDateRiyadh(startDate),
        endDate: formatDateRiyadh(endDate),
        paymentId: "",
        status: "نشط"
      };

      console.log(`📦 [Free Subscription Renewal] Package: ${freePkg.name}, type: عادي`);

      await firebaseService.addSubscriptionToSheet(
        propertyNumber,
        freeSubscriptionData,
        property,
        ""
      );

      await firebaseService.updateVerificationStatus(propertyNumber, "approved");
      console.log(`✅ Free subscription renewed for property ${propertyNumber}`);

      // إشعار للأدمن
      await sendWhatsAppNotification(
        `🔄 *تجديد اشتراك مجاني*\n\n` +
        `📍 العقار: ${property.name}\n` +
        `🔢 رقم العقار: ${propertyNumber}\n` +
        `📦 الباقة: ${freePkg.name}\n` +
        `📅 من: ${freeSubscriptionData.startDate}\n` +
        `📅 إلى: ${freeSubscriptionData.endDate}\n` +
        `🏷️ نوع الاشتراك: عادي\n\n` +
        `✅ تم تجديد الاشتراك المجاني تلقائياً`
      );

      return res.json({
        success: true,
        message: "تم تجديد الاشتراك المجاني بنجاح",
        subscriptionType: "عادي"
      });
    }

    // جلب بيانات الباقة
    const pkg = await subscriptionService.getPackageById(pendingPayment.packageId);

    const paymentStatus = pendingPayment.status;

    // ✅ القاعدة الجديدة: التفعيل التلقائي للبطاقة/Apple Pay فقط
    // - "مكتمل" أو "completed" → تفعيل فوري
    // - "نجح - قيد التحقق" (Apple Pay/بطاقة) → تفعيل فوري
    // - ⚠️ تحويل بنكي → لا يتفعل تلقائياً أبداً - يحتاج موافقة يدوية

    const canAutoActivate =
      !isBankTransfer && (  // ⚠️ ممنوع التفعيل التلقائي للتحويل البنكي
        paymentStatus === "مكتمل" ||
        paymentStatus === "completed" ||
        paymentStatus === "نجح - قيد التحقق"  // Apple Pay/بطاقة ناجحة
      );

    if (canAutoActivate) {
      // ✅ تفعيل تلقائي - الفحص نجح
      console.log(`✅ Payment ${pendingPayment.id} (${paymentStatus}) - auto-activating subscription`);

      // تحديث حالة الدفع إلى مكتمل
      if (paymentStatus !== "مكتمل" && paymentStatus !== "completed") {
        await firebaseService.updatePaymentStatus(pendingPayment.id, "مكتمل");
        console.log(`✅ Payment status updated to 'مكتمل' for payment ${pendingPayment.id}`);
      }

      // التحقق من وجود الباقة
      if (!pkg) {
        return res.status(404).json({ error: "الباقة غير موجودة" });
      }

      // حساب تواريخ الاشتراك (30 يوم = 30 يوم كاملة بالضبط)
      const cardPayToday = getStartOfDayRiyadh();
      const currentSubscription = await subscriptionService.getByProperty(propertyNumber);

      let startDate = cardPayToday;
      let endDate = calculateSubscriptionEndDate(null, pkg.duration);

      // إذا كان هناك اشتراك نشط، ابدأ من تاريخ انتهائه
      if (currentSubscription && new Date(currentSubscription.endDate) > cardPayToday) {
        startDate = new Date(currentSubscription.endDate);
        endDate = calculateExtensionEndDate(startDate, pkg.duration);
      }

      // حساب السعر (نصف السعر إذا كانت باقة عقارين)
      const isMultiProperty = !!(pendingPayment as any).secondPropertyNumber;
      const pricePerProperty = isMultiProperty ? pendingPayment.finalAmount / 2 : pendingPayment.finalAmount;

      // تحديد نوع الاشتراك (مميز إذا مدفوع)
      const isPremiumPkg = pkg.type === "موثوق" || pkg.type === "مميز" || pricePerProperty > 0;

      const subscriptionData = {
        packageId: pkg.id,
        price: pricePerProperty,
        subscriptionType: isPremiumPkg ? "مميز" : "عادي",
        packageType: isPremiumPkg ? "مميز" : "عادي",
        startDate: formatDateRiyadh(startDate),
        endDate: formatDateRiyadh(endDate),
        paymentId: pendingPayment.id,
        linkedProperty: isMultiProperty ? (pendingPayment as any).secondPropertyNumber : undefined,
      };

      console.log(`📦 [Card Payment] Package: ${pkg.name}, type: ${pkg.type}, isPremium: ${isPremiumPkg}, finalType: ${subscriptionData.subscriptionType}`);

      // إضافة الاشتراك للشيت
      await firebaseService.addSubscriptionToSheet(
        propertyNumber,
        subscriptionData,
        property,
        pendingPayment.receiptUrl || ""
      );
      console.log(`✅ Subscription activated for property ${propertyNumber} (type: ${subscriptionData.subscriptionType})`);

      // إضافة اشتراك للعقار الثاني إذا كانت باقة عقارين
      if ((pendingPayment as any).secondPropertyNumber) {
        const secondProperty = await propertyService.getByNumber((pendingPayment as any).secondPropertyNumber);
        if (secondProperty) {
          const secondSubscriptionData = {
            ...subscriptionData,
            linkedProperty: propertyNumber,
          };
          await firebaseService.addSubscriptionToSheet(
            (pendingPayment as any).secondPropertyNumber,
            secondSubscriptionData,
            secondProperty,
            pendingPayment.receiptUrl || ""
          );
          console.log(`✅ Second property subscription activated: ${(pendingPayment as any).secondPropertyNumber}`);
        }
      }

      // تحديث حالة التحقق إلى approved
      await firebaseService.updateVerificationStatus(propertyNumber, "approved");
      console.log(`✅ Verification status updated to 'approved' for property ${propertyNumber}`);

      // إرسال إشعار WhatsApp للأدمن
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

      // إرسال إشعار للمالك عبر Enjazatik
      if (property.whatsappNumber) {
        try {
          await notifyOwnerSubscriptionActivated({
            ownerPhone: property.whatsappNumber,
            propertyNumber: propertyNumber,
            propertyName: property.name || "",
            endDate: subscriptionData.endDate,
          });
          console.log(`📱 Owner notification sent for activation: ${propertyNumber}`);
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

    // ❌ الدفعة لم تنجح التفعيل التلقائي - قيد المراجعة
    console.log(`⏳ Payment ${pendingPayment.id} (${paymentStatus}) - requires manual approval`);

    // تحديث حالة التحقق إلى pending (قيد المراجعة)
    await firebaseService.updateVerificationStatus(propertyNumber, "pending");

    // إرسال إشعار للأدمن
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
    console.error("Property activation error details:", err.message, err.stack);
    res.status(500).json({
      success: false,
      error: `خطأ في تفعيل الاشتراك: ${err.message || 'خطأ غير معروف'}`
    });
  }
});

// ======================================================
// 🔍 GET /api/owner/payment/check-pending - Check pending bank transfer
// ======================================================
router.get("/api/owner/payment/check-pending", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    if (!propertyNumber) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const payments = await paymentService.getByProperty(propertyNumber);

    // البحث عن دفعة معلقة (تحويل بنكي)
    const pendingPayment = payments.find(p =>
      (p.status === "قيد المراجعة" || p.status === "معلق") &&
      p.paymentMethod === "تحويل بنكي"
    );

    if (!pendingPayment) {
      return res.json({ hasPending: false });
    }

    // التحقق التلقائي من البيانات
    const issues: string[] = [];

    // 1. التحقق من الإيصال
    if (!pendingPayment.receiptUrl) {
      issues.push("لم يتم رفع إيصال التحويل");
    }

    // 2. التحقق من البيانات الأساسية
    if (!pendingPayment.finalAmount || pendingPayment.finalAmount <= 0) {
      issues.push("المبلغ غير صحيح");
    }

    if (!pendingPayment.packageId) {
      issues.push("لم يتم تحديد الباقة");
    }

    // 3. التحقق من العمر (أكثر من 7 أيام = تحذير)
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

// =======================================
// 📦 GET /api/owner/addons - Get available add-on packages
// =======================================
router.get("/api/owner/addons", async (req, res) => {
  try {
    const addons = await addOnService.getAllPackages();
    res.json(addons);
  } catch (err) {
    console.error("Get owner addons error:", err);
    res.status(500).json({ error: "فشل جلب الإضافات" });
  }
});

// =======================================
// 📦 GET /api/owner/property-addons - Get property's add-ons
// =======================================
router.get("/api/owner/property-addons", async (req, res) => {
  try {
    // 1️⃣ حاول من session
    let propertyNumber = (req as any).session?.propertyNumber;

    // 2️⃣ لو ما فيه session خذه من query
    if (!propertyNumber && req.query.propertyNumber) {
      propertyNumber = String(req.query.propertyNumber);
    }

    // 3️⃣ لو ما زال فاضي
    if (!propertyNumber) {
      return res.status(400).json({ error: "propertyNumber مطلوب" });
    }

    const addons = await addOnService.getForProperty(propertyNumber);
    res.json(addons);
  } catch (err) {
    console.error("Get property addons error:", err);
    res.status(500).json({ error: "فشل جلب إضافات العقار" });
  }
});

// =======================================
// 💳 POST /api/owner/addons/pay - Pay for add-on via Paymob
// =======================================
router.post("/api/owner/addons/pay", async (req, res) => {
  try {
    const { propertyNumber, addOnPackageId } = req.body;

    if (!propertyNumber || !addOnPackageId) {
      return res.status(400).json({ error: "بيانات ناقصة" });
    }

    const addon = await addOnService.getPackageById(addOnPackageId);
    if (!addon) {
      return res.status(404).json({ error: "الإضافة غير موجودة" });
    }

    const property = await propertyService.getByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    // ======================================
    // إنشاء سجلات الدفع والإضافة فوراً
    // ======================================
    const now = new Date();
    const paymentId = `PAY-ADDON-${Date.now()}`;
    const addOnId = `ADDON-${propertyNumber}-${Date.now()}`;

    // إنشاء سجل دفع بحالة "قيد الدفع" (ينتظر اكتمال الدفع من Paymob)
    await paymentService.create({
      id: paymentId,
      propertyNumber,
      amount: addon.price,
      discountCode: undefined,
      discountAmount: 0,
      finalAmount: addon.price,
      paymobOrderId: undefined, // سيتم تحديثه من webhook
      status: "قيد الدفع",
      paymentMethod: "paymob",
      receiptUrl: undefined,
      createdAt: now.toISOString(),
      packageId: addOnPackageId,
      packageName: addon.name,
      action: "addon",
      pendingStartDate: undefined,
      pendingEndDate: undefined,
      pendingSubscriptionType: undefined,
      pendingPrice: addon.price,
    });

    // إنشاء سجل إضافة بحالة "pending"
    await firebaseService.createPropertyAddOn({
      id: addOnId,
      propertyNumber,
      addOnPackageId,
      status: "pending",
      startDate: undefined,
      endDate: undefined,
      paymentId,
      receiptUrl: undefined,
      source: "paymob",
      createdAt: now.toISOString(),
    });

    // تسجيل في سجل الإضافات
    await addOnService.logHistory({
      propertyNumber,
      addOnPackageId,
      action: "pending",
      notes: `تم بدء عملية الدفع الإلكتروني - المبلغ: ${addon.price} ر.س`,
      timestamp: new Date().toISOString(),
      createdBy: "owner",
    });

    console.log(`📦 Created addon payment record: ${paymentId}, addon: ${addOnId}`);

    // الحصول على رابط الدفع من Paymob مع تمرير paymentId
    const { checkoutUrl } = await paymobService.initiateAddOnPayment(
      addon.price,
      propertyNumber,
      property.name,
      property.whatsappNumber || "0500000000",
      addon.id,
      addon.name,
      addon.durationDays,
      'cards',
      paymentId // تمرير paymentId للتتبع
    );

    res.json({ checkoutUrl, paymentId });
  } catch (err) {
    console.error("Pay addon error:", err);
    res.status(500).json({ error: "فشل الدفع" });
  }
});

// =======================================
// 🏦 POST /api/owner/addons/bank-transfer - Bank transfer for add-on
// =======================================
router.post("/api/owner/addons/bank-transfer", upload.single('receipt'), async (req, res) => {
  try {
    const { propertyNumber, addOnPackageId, amount } = req.body;
    const receiptFile = req.file;

    if (!propertyNumber || !addOnPackageId || !receiptFile) {
      return res.status(400).json({ error: "بيانات ناقصة" });
    }

    // التحقق من وجود الإضافة
    const addon = await addOnService.getPackageById(addOnPackageId);
    if (!addon) {
      return res.status(404).json({ error: "الإضافة غير موجودة" });
    }

    // التحقق من وجود العقار
    const property = await propertyService.getByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    // رفع الإيصال للتخزين (صور و PDF)
    let receiptUrl = "";
    if (r2 && R2_BUCKET) {
      const isPdf = receiptFile.mimetype === 'application/pdf';
      const ext = isPdf ? 'pdf' : 'jpg';
      const contentType = isPdf ? 'application/pdf' : 'image/jpeg';
      const receiptKey = `addon-receipts/${propertyNumber}-${Date.now()}.${ext}`;
      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: receiptKey,
          Body: receiptFile.buffer,
          ContentType: contentType,
        })
      );
      receiptUrl = `${R2_PUBLIC_URL}/${receiptKey}`;
    }

    // إنشاء سجل إضافة معلق
    const addOnId = `ADDON-${propertyNumber}-${Date.now()}`;
    const now = new Date();
    const paymentId = `PAY-ADDON-${Date.now()}`;

    // إنشاء سجل دفع في جدول المدفوعات
    await paymentService.create({
      id: paymentId,
      propertyNumber,
      amount: addon.price,
      discountCode: undefined,
      discountAmount: 0,
      finalAmount: addon.price,
      paymobOrderId: undefined,
      status: "قيد المراجعة",
      paymentMethod: "تحويل بنكي",
      receiptUrl,
      createdAt: now.toISOString(),
      packageId: addOnPackageId,
      packageName: addon.name,
      action: "addon",
      pendingStartDate: undefined,
      pendingEndDate: undefined,
      pendingSubscriptionType: undefined,
      pendingPrice: addon.price,
    });

    await firebaseService.createPropertyAddOn({
      id: addOnId,
      propertyNumber,
      addOnPackageId,
      status: "pending",
      startDate: undefined,
      endDate: undefined,
      paymentId,
      receiptUrl,
      source: "bank_transfer",
      createdAt: now.toISOString(),
    });

    // إرسال إشعار واتساب للإدارة
    try {
      await sendWhatsAppNotification(
        `📦 طلب إضافة جديد (تحويل بنكي)\n` +
        `العقار: ${propertyNumber} - ${property.name}\n` +
        `الإضافة: ${addon.name}\n` +
        `المبلغ: ${addon.price} ر.س\n` +
        `رابط الإيصال: ${receiptUrl}`
      );
    } catch (e) {
      console.error("Failed to send WhatsApp notification:", e);
    }

    res.json({
      success: true,
      message: "تم رفع الإيصال بنجاح، سيتم مراجعته وتفعيل الإضافة",
      addOnId,
      paymentId
    });
  } catch (err) {
    console.error("Bank transfer addon error:", err);
    res.status(500).json({ error: "فشل رفع الإيصال" });
  }
});

// ======================================================
// 🔒 POST /api/owner/change-password - Change password
// ======================================================
router.post("/api/owner/change-password", async (req, res) => {
  try {
    const propertyNumber = (req.session as any)?.propertyNumber;
    if (!propertyNumber) {
      return res.status(401).json({ success: false, message: "يجب تسجيل الدخول أولاً" });
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "البيانات غير مكتملة" });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ success: false, message: "الرقم السري يجب أن يكون 4 أرقام على الأقل" });
    }

    await firebaseService.syncOwnerFromProperties(propertyNumber);

    const owner = await firebaseService.getOwnerByPropertyNumber(propertyNumber);
    if (!owner) {
      return res.status(404).json({ success: false, message: "بيانات المالك غير موجودة" });
    }

    if (owner.password !== currentPassword) {
      return res.status(400).json({ success: false, message: "الرقم السري الحالي غير صحيح" });
    }

    await firebaseService.updateOwnerPassword(propertyNumber, newPassword);
    await firebaseService.clearOwnerResetCode(propertyNumber);

    console.log(`✅ Password changed for property: ${propertyNumber}`);

    return res.json({ success: true, message: "تم تغيير الرقم السري بنجاح" });
  } catch (error: any) {
    console.error("Change password error:", error);
    return res.status(500).json({ success: false, message: error.message || "خطأ في النظام" });
  }
});

// ======================================================
// 💳 POST /api/owner/payment/initiate - Start electronic payment (Paymob)
// ======================================================
router.post("/api/owner/payment/initiate", async (req, res) => {
  try {
    const { propertyNumber, packageId, discountCode, paymentMethod = "cards", action, secondPropertyNumber } = req.body;

    if (!propertyNumber) {
      return res.status(400).json({ error: "رقم العقار مطلوب" });
    }

    const pkg = await subscriptionService.getPackageById(packageId);
    if (!pkg) return res.status(404).json({ error: "الباقة غير موجودة" });

    const property = await propertyService.getByNumber(propertyNumber);
    if (!property && action !== 'new') {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    let finalAmount = pkg.price;
    if (discountCode) {
      const discount = await discountService.getByCode(discountCode);
      if (discount && discount.isActive) {
        if (discount.type === "نسبة") {
          finalAmount -= (pkg.price * discount.value) / 100;
        } else {
          finalAmount -= discount.value;
        }
      }
    }

    const propertyName = property?.name || "عقار جديد";
    const whatsappNumber = property?.whatsappNumber || "0000000000";

    const paymobResult = await paymobService.createIntention(
      finalAmount,
      propertyNumber,
      propertyName,
      whatsappNumber,
      pkg.name,
      pkg.duration,
      paymentMethod as "cards" | "applepay"
    );

    const isAddon = packageId.startsWith('addon-');

    const today = getStartOfDayRiyadh();
    let startDate = today;
    let endDate = calculateSubscriptionEndDate(null, pkg.duration);
    let price = pkg.price;
    let subscriptionType = pkg.type;

    if (!isAddon && (action === 'extend' || action === 'upgrade')) {
      const currentSubscription = await subscriptionService.getByProperty(propertyNumber);

      if (action === 'extend' && currentSubscription) {
        const currentEndDate = new Date(currentSubscription.endDate);
        if (currentEndDate > today) {
          startDate = currentEndDate;
          endDate = calculateExtensionEndDate(currentEndDate, pkg.duration);
        }
        price = pkg.price;
        subscriptionType = pkg.type;
      }
    }

    const payment = await paymentService.create({
      propertyNumber,
      packageId,
      amount: pkg.price,
      discountCode: discountCode || "",
      discountAmount: pkg.price - finalAmount,
      finalAmount,
      paymobOrderId: paymobResult.intentionId,
      status: "قيد المراجعة",
      paymentMethod: paymentMethod === "applepay" ? "Apple Pay" : "بطاقة",
      action: action as 'new' | 'extend' | 'upgrade' | undefined,
      pendingStartDate: formatDateRiyadh(startDate),
      pendingEndDate: formatDateRiyadh(endDate),
      pendingSubscriptionType: subscriptionType,
      pendingPrice: price,
      secondPropertyNumber: secondPropertyNumber || undefined,
    });

    console.log(`✅ Payment created (pending): ${payment.id}, Checkout URL: ${paymobResult.checkoutUrl}`);

    try {
      await notifyNewPayment({
        propertyNumber,
        propertyName: propertyName,
        amount: finalAmount,
        paymentMethod: paymentMethod === "applepay" ? "Apple Pay" : "بطاقة",
        transactionId: payment.id,
      });
    } catch (notifyErr) {
      console.error("Failed to send payment notification:", notifyErr);
    }

    res.json({
      checkoutUrl: paymobResult.checkoutUrl,
      paymentId: payment.id,
    });
  } catch (err: any) {
    console.error("Payment initiate error:", err);
    res.status(500).json({ error: err.message || "خطأ في بدء الدفع" });
  }
});

// ======================================================
// 🔄 POST /api/owner/payment/retry - Retry failed payment
// ======================================================
router.post("/api/owner/payment/retry", async (req, res) => {
  try {
    const { paymentId } = req.body;

    if (!paymentId) {
      return res.status(400).json({ error: "معرف الدفعة مطلوب" });
    }

    const payment = await paymentService.getById(paymentId);
    if (!payment) {
      return res.status(404).json({ error: "الدفعة غير موجودة" });
    }

    if (payment.status === "مكتمل") {
      return res.status(400).json({ error: "الدفعة مكتملة مسبقاً" });
    }

    const pkg = await subscriptionService.getPackageById(payment.packageId);
    if (!pkg) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    const property = await propertyService.getByNumber(payment.propertyNumber);
    const phone = property?.whatsappNumber || "0500000000";
    const propertyName = property?.name || "عقار";

    const paymobResult = await paymobService.createIntention(
      payment.finalAmount,
      payment.propertyNumber,
      propertyName,
      phone,
      pkg.name,
      pkg.duration,
      "cards"
    );

    await paymentService.update(paymentId, {
      paymobOrderId: paymobResult.intentionId,
    });

    console.log(`🔄 Payment retry for ${paymentId}, new checkout: ${paymobResult.checkoutUrl}`);

    res.json({
      checkoutUrl: paymobResult.checkoutUrl,
      paymentId: paymentId,
    });
  } catch (err: any) {
    console.error("Payment retry error:", err);
    res.status(500).json({ error: err.message || "خطأ في إعادة الدفع" });
  }
});

// ======================================================
// 📤 POST /api/owner/payment/upload-receipt - Upload receipt
// ======================================================
router.post("/api/owner/payment/upload-receipt", upload.single("receipt"), async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    if (!propertyNumber) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { paymentId, action } = req.body;

    if (!paymentId) {
      return res.status(400).json({ error: "معرف الدفعة مطلوب" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "الإيصال مطلوب" });
    }

    const payment = await paymentService.getById(paymentId);
    if (!payment) {
      return res.status(404).json({ error: "الدفعة غير موجودة" });
    }

    if (payment.propertyNumber !== propertyNumber) {
      return res.status(403).json({ error: "غير مصرح لك" });
    }

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

    await paymentService.update(paymentId, {
      receiptUrl: receiptUrl,
    });

    const property = await propertyService.getByNumber(propertyNumber);
    await sendWhatsAppNotification(
      `📤 *تم رفع إيصال جديد*\n\n` +
      `📍 العقار: ${property?.name || propertyNumber}\n` +
      `🔢 رقم العقار: ${propertyNumber}\n` +
      `💵 المبلغ: ${payment.finalAmount} ر.س\n` +
      `📦 الباقة: ${payment.packageId}\n` +
      `🧾 الإيصال: ${receiptUrl}\n\n` +
      `⏳ بانتظار المراجعة والتفعيل`
    );

    console.log(`📤 Receipt uploaded for payment ${paymentId}: ${receiptUrl}`);

    let aiScanResult = null;
    try {
      const { scanReceiptWithAI } = await import("../integrations/aiReceiptScanner");
      aiScanResult = await scanReceiptWithAI(
        receiptUrl,
        paymentId,
        payment.finalAmount,
        payment.paymentReference
      );
      if (aiScanResult) {
        console.log(`🔬 [AI Scanner] تم فحص الإيصال: ${paymentId}, التوصية: ${aiScanResult.recommendation}`);
      }
    } catch (aiErr) {
      console.error("AI Scanner error:", aiErr);
    }

    res.json({
      success: true,
      message: "تم رفع الإيصال بنجاح",
      receiptUrl: receiptUrl,
      aiScan: aiScanResult ? {
        recommendation: aiScanResult.recommendation,
        confidence: aiScanResult.confidence,
        summary: aiScanResult.summary,
        matchScore: aiScanResult.matchAnalysis.matchScore,
        authenticityScore: aiScanResult.authenticityAnalysis.overallScore,
      } : null
    });
  } catch (err: any) {
    console.error("Receipt upload error:", err);
    res.status(500).json({ error: err.message || "خطأ في رفع الإيصال" });
  }
});

// ======================================================
// 🏦 POST /api/owner/payment/bank-transfer - Bank transfer with receipt
// ======================================================
router.post("/api/owner/payment/bank-transfer", upload.single("receipt"), async (req, res) => {
  try {
    const { propertyNumber, packageId, discountCode, action, secondPropertyNumber } = req.body;
    const isAddon = action === "addon";

    if (!propertyNumber) {
      return res.status(400).json({ error: "رقم العقار مطلوب" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "الإيصال مطلوب" });
    }

    const pkg = await subscriptionService.getPackageById(packageId);
    if (!pkg) return res.status(404).json({ error: "الباقة غير موجودة" });

    const property = await propertyService.getByNumber(propertyNumber);
    if (!property) return res.status(404).json({ error: "العقار غير موجود" });

    let finalAmount = pkg.price;
    if (discountCode) {
      const discount = await discountService.getByCode(discountCode);
      if (discount && discount.isActive) {
        if (discount.type === "نسبة") {
          finalAmount -= (pkg.price * discount.value) / 100;
        } else {
          finalAmount -= discount.value;
        }
      }
    }

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

    const generatePaymentReference = (): string => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let code = 'RWQN-';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return code;
    };
    const paymentReference = generatePaymentReference();

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

    console.log(`💾 Payment created: ${payment.id}, secondPropertyNumber: ${secondPropertyNumber || 'none'}`);

    if (isAddon) {
      await firebaseService.createPropertyAddOn({
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
      console.log(`📝 Payment ${payment.id} saved with pending subscription data (action: ${action}).`);

      notifyReceiptUpload({
        propertyNumber,
        propertyName: property.name || "",
        ownerPhone: property.whatsappNumber || "",
        receiptUrl,
      }).catch(err => console.error("WhatsApp notify error:", err));
    }

    let aiScanResult = null;
    let autoActivated = false;
    try {
      const { scanReceiptWithAI } = await import("../integrations/aiReceiptScanner");
      aiScanResult = await scanReceiptWithAI(
        receiptUrl,
        payment.id,
        finalAmount,
        paymentReference
      );
      if (aiScanResult) {
        console.log(`🔬 [AI Scanner] تم فحص إيصال التحويل: ${payment.id}, التوصية: ${aiScanResult.recommendation}`);

        if (aiScanResult.recommendation === "تفعيل_تلقائي") {
          console.log(`🚀 [Auto Activation] بدء تفعيل الدفعة تلقائياً: ${payment.id}`);

          await firebaseService.updatePaymentStatus(payment.id, "مكتمل");

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

          if (secondPropertyNumber) {
            const secondProperty = await propertyService.getByNumber(secondPropertyNumber);
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
              console.log(`✅ [Auto Activation] تم تفعيل العقار الثاني: ${secondPropertyNumber}`);

              await firebaseService.createMultiPropertySubscription({
                packageId: pkg.id,
                propertyNumber1: propertyNumber,
                propertyNumber2: secondPropertyNumber,
                startDate: formatDateRiyadh(startDate),
                endDate: formatDateRiyadh(endDate),
                status: "نشط",
                paymentId: payment.id,
              });

              const secondPropertyComplete = await checkPropertyDataComplete(secondProperty);
              if (secondPropertyComplete.isComplete) {
                await firebaseService.updateVerificationStatus(secondPropertyNumber, "approved");
              } else {
                await firebaseService.updateVerificationStatus(secondPropertyNumber, "pending");
              }
            }
          }

          const propertyComplete = await checkPropertyDataComplete(property);
          if (propertyComplete.isComplete) {
            await firebaseService.updateVerificationStatus(propertyNumber, "approved");
          } else {
            await firebaseService.updateVerificationStatus(propertyNumber, "pending");
          }

          autoActivated = true;
          console.log(`✅ [Auto Activation] تم تفعيل الاشتراك تلقائياً للعقار: ${propertyNumber}`);

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
            const secondProp = await propertyService.getByNumber(secondPropertyNumber);
            const verificationStatus2 = (await checkPropertyDataComplete(secondProp || {})).isComplete ? '✅ معتمد' : '⏳ ينتظر مراجعة';
            adminNotification +=
              `\n🏠 *العقار الثاني:*\n` +
              `📍 الاسم: ${secondProp?.name || secondPropertyNumber}\n` +
              `🔢 الرقم: ${secondPropertyNumber}\n` +
              `📊 حالة التحقق: ${verificationStatus2}\n`;
          }

          adminNotification += `\n✅ تم تفعيل الاشتراك تلقائياً بعد فحص الإيصال`;

          await sendWhatsAppNotification(adminNotification).catch(err => console.error("WhatsApp notify error:", err));

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
          console.log(`⚠️ [AI Scanner] فحص الإيصال لم ينجح - ينتظر موافقة يدوية: ${propertyNumber}`);

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
      } else {
        await sendWhatsAppNotification(
          `⏳ *تحويل بنكي - يحتاج مراجعة*\n\n` +
          `📍 العقار: ${property.name}\n` +
          `🔢 رقم العقار: ${propertyNumber}\n` +
          `📦 الباقة: ${pkg.name}\n` +
          `💵 المبلغ: ${finalAmount} ر.س\n` +
          `🧾 رقم المرجع: ${paymentReference}\n` +
          `🔬 لم يتم فحص الإيصال\n\n` +
          `⚠️ يحتاج موافقة يدوية من الإدارة`
        ).catch(err => console.error("WhatsApp notify error:", err));
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

// ======================================================
// 🔬 POST /api/owner/payment/:paymentId/rescan - Re-scan receipt with AI
// ======================================================
router.post("/api/owner/payment/:paymentId/rescan", requireOwner, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const propertyNumber = req.cookies?.ownerPropertyNumber || (req.session as any)?.propertyNumber;

    if (!propertyNumber) {
      return res.status(401).json({ error: "غير مصرح" });
    }

    const payments = await paymentService.getByProperty(propertyNumber);
    const payment = payments.find(p => p.id === paymentId);

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

export default router;
