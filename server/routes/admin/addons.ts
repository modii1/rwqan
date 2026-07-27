import { Router } from "express";
import { requireOwner } from "../middleware";
import { firebaseService } from "../../firebaseService";
import { addOnService, paymentService, propertyService } from "../../services";
import { paymobService } from "../../integrations/paymob";
import { sendWhatsAppNotification } from "../../integrations/whatsapp";
import { upload } from "../../utils/helpers";
import { r2, R2_BUCKET, R2_PUBLIC_URL } from "../../utils/r2";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { scanReceiptWithAI } from "../../integrations/aiReceiptScanner";

const router = Router();

// =======================================
// ADMIN – Get Add-On Packages
// =======================================
router.get("/api/admin/addons", async (req, res) => {
  try {
    const packages = await addOnService.getAllPackages();
    res.json(packages);
  } catch (err) {
    console.error("Get addon packages error:", err);
    res.status(500).json({ error: "فشل جلب باقات الإضافات" });
  }
});

// =======================================
// ADMIN – Create Add-On Package
// =======================================
router.post("/api/admin/addons/create", async (req, res) => {
  try {
    const { name, description, price, durationDays, category, isActive } = req.body;

    if (!name || !price || !category) {
      return res.status(400).json({ error: "الاسم والسعر والفئة مطلوبة" });
    }

    const newPackage = await addOnService.createPackage({
      name,
      description: description || "",
      price: Number(price),
      durationDays: Number(durationDays) || 0,
      category,
      isActive: isActive !== false,
    });

    res.json({ ok: true, package: newPackage });
  } catch (err) {
    console.error("Create addon package error:", err);
    res.status(500).json({ error: "فشل إنشاء الباقة" });
  }
});

// =======================================
// ADMIN – Update Add-On Package
// =======================================
router.put("/api/admin/addons/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const updated = await addOnService.updatePackage(id, updates);

    if (!updated) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    res.json({ ok: true, package: updated });
  } catch (err) {
    console.error("Update addon package error:", err);
    res.status(500).json({ error: "فشل تحديث الباقة" });
  }
});

// =======================================
// ADMIN – Get All Property Add-Ons
// =======================================
router.get("/api/admin/property-addons", async (req, res) => {
  try {
    const addons = await addOnService.getAll();
    res.json(addons);
  } catch (err) {
    console.error("Get all property addons error:", err);
    res.status(500).json({ error: "فشل جلب إضافات العقارات" });
  }
});

// =======================================
// ADMIN – Approve Add-On Bank Transfer
// =======================================
router.post("/api/admin/addons/approve", async (req, res) => {
  try {
    const { propertyAddOnId } = req.body;

    if (!propertyAddOnId) {
      return res.status(400).json({ error: "propertyAddOnId مطلوب" });
    }

    // جلب الإضافة للحصول على معرف الباقة
    const addOns = await addOnService.getAll();
    const addon = addOns.find(a => a.id === propertyAddOnId);

    if (!addon) {
      return res.status(404).json({ error: "الإضافة غير موجودة" });
    }

    // جلب باقة الإضافة لحساب تاريخ الانتهاء
    const pkg = await addOnService.getPackageById(addon.addOnPackageId);

    const startDate = new Date();
    let endDate: Date | null = null;

    if (pkg && pkg.durationDays > 0) {
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + pkg.durationDays);
    }

    const updated = await firebaseService.updatePropertyAddOn(
      propertyAddOnId,
      {
        status: "active",
        startDate: startDate.toISOString(),
        endDate: endDate ? endDate.toISOString() : undefined,
        source: "bank",
      }
    );

    if (!updated) {
      return res.status(404).json({ error: "فشل تحديث الإضافة" });
    }

    // تحديث سجل الدفع المرتبط ليصبح مكتمل
    try {
      const allPayments = await paymentService.getAll();
      const pendingPayment = allPayments.find(p =>
        p.action === "addon" &&
        (p.status === "قيد المراجعة" || p.status === "نجح - قيد التحقق") &&
        p.propertyNumber === addon.propertyNumber &&
        p.packageId === addon.addOnPackageId
      );

      if (pendingPayment) {
        await paymentService.update(pendingPayment.id, {
          status: "مكتمل",
          completedAt: new Date().toISOString(),
        });
        console.log(`✅ Updated addon payment ${pendingPayment.id} to completed`);
      }
    } catch (paymentError) {
      console.error("Error updating addon payment:", paymentError);
      // لا نوقف العملية إذا فشل تحديث الدفع
    }

    await addOnService.logHistory({
      propertyNumber: updated.propertyNumber,
      addOnPackageId: updated.addOnPackageId,
      action: "activated",
      notes: "تم التفعيل بعد التحويل البنكي",
      timestamp: new Date().toISOString(),
      createdBy: "admin",
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Approve addon error:", err);
    res.status(500).json({ error: "فشل تفعيل الإضافة" });
  }
});

// =======================================
// ADMIN – Reject Add-On (Bank Transfer)
// =======================================
router.post("/api/admin/addons/reject", async (req, res) => {
  try {
    const { propertyAddOnId } = req.body;

    if (!propertyAddOnId) {
      return res.status(400).json({ error: "propertyAddOnId مطلوب" });
    }

    const addOns = await addOnService.getAll();
    const addon = addOns.find(a => a.id === propertyAddOnId);

    if (!addon) {
      return res.status(404).json({ error: "الإضافة غير موجودة" });
    }

    const updated = await firebaseService.updatePropertyAddOn(
      propertyAddOnId,
      {
        status: "rejected",
      }
    );

    if (!updated) {
      return res.status(404).json({ error: "فشل تحديث الإضافة" });
    }

    // تحديث سجل الدفع المرتبط ليصبح مرفوض
    try {
      const allPayments = await paymentService.getAll();
      const pendingPayment = allPayments.find(p =>
        p.action === "addon" &&
        (p.status === "قيد المراجعة" || p.status === "نجح - قيد التحقق") &&
        p.propertyNumber === addon.propertyNumber &&
        p.packageId === addon.addOnPackageId
      );

      if (pendingPayment) {
        await paymentService.update(pendingPayment.id, {
          status: "ملغي",
          completedAt: new Date().toISOString(),
        });
        console.log(`❌ Updated addon payment ${pendingPayment.id} to rejected`);
      }
    } catch (paymentError) {
      console.error("Error updating addon payment:", paymentError);
    }

    await addOnService.logHistory({
      propertyNumber: addon.propertyNumber,
      addOnPackageId: addon.addOnPackageId,
      action: "rejected",
      notes: "تم رفض الطلب",
      timestamp: new Date().toISOString(),
      createdBy: "admin",
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("Reject addon error:", err);
    res.status(500).json({ error: "فشل رفض الإضافة" });
  }
});

// =======================================
// ADMIN – Update Expired Add-Ons (Manual Trigger)
// =======================================
router.post("/api/admin/addons/update-expired", async (req, res) => {
  try {
    const count = await addOnService.processExpired();
    res.json({ ok: true, updatedCount: count, message: `تم تحديث ${count} إضافة منتهية` });
  } catch (err) {
    console.error("Update expired addons error:", err);
    res.status(500).json({ error: "فشل تحديث الإضافات المنتهية" });
  }
});


// =======================================
// OWNER – Get available Add-On packages
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
// OWNER – Get Property Add-Ons
// =======================================
router.get("/api/owner/property-addons", requireOwner, async (req, res) => {
  try {
    // Property selection must come only from the authenticated server session.
    // Query parameters are caller-controlled and cannot establish ownership.
    const propertyNumber = (req.session as any)?.propertyNumber;
    if (!propertyNumber) {
      return res.status(401).json({ error: "NOT_AUTHENTICATED" });
    }

    const addons = await addOnService.getForProperty(propertyNumber);
    res.json(addons);
  } catch (err) {
    console.error("Get property addons error:", err);
    res.status(500).json({ error: "فشل جلب إضافات العقار" });
  }
});

// =======================================
// OWNER – Pay Add-On (Paymob) - موحد مع التحويل البنكي
// =======================================
router.post("/api/owner/addons/pay", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any)?.propertyNumber;
    const { addOnPackageId, discountCode } = req.body;

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
    // إنشاء سجلات الدفع والإضافة فوراً (مثل التحويل البنكي)
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

    // تحديث سجل الدفع بمعلومات إضافية (الـ reference)
    // سيتم تحديث paymobOrderId من الـ webhook

    res.json({ checkoutUrl, paymentId });
  } catch (err) {
    console.error("Pay addon error:", err);
    res.status(500).json({ error: "فشل الدفع" });
  }
});

// =======================================
// OWNER – Bank Transfer for Add-On
// =======================================
router.post("/api/owner/addons/bank-transfer", requireOwner, upload.single('receipt'), async (req, res) => {
  try {
    const propertyNumber = (req.session as any)?.propertyNumber;
    const { addOnPackageId, amount, discountCode } = req.body;
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

    // إنشاء سجل دفع في جدول المدفوعات (مثل الاشتراكات)
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

    // AI Receipt Scanning
    let aiScanResult = null;
    try {
      aiScanResult = await scanReceiptWithAI(
        receiptUrl,
        paymentId,
        addon.price,
        propertyNumber
      );

      if (aiScanResult) {
        console.log(`🔬 [AI Scanner] تم فحص إيصال الإضافة: ${paymentId}, التوصية: ${aiScanResult.recommendation}`);
      }
    } catch (aiError) {
      console.error("AI scan error for addon:", aiError);
    }

    // إرسال إشعار واتساب للإدارة
    try {
      let notificationMessage = `📦 طلب إضافة جديد (تحويل بنكي)\n` +
        `العقار: ${propertyNumber} - ${property.name}\n` +
        `الإضافة: ${addon.name}\n` +
        `المبلغ: ${addon.price} ر.س\n` +
        `رابط الإيصال: ${receiptUrl}`;
      
      if (aiScanResult) {
        notificationMessage += `\n🔬 نتيجة الفحص: ${aiScanResult.recommendation}\n` +
          `📊 نسبة التطابق: ${aiScanResult.matchAnalysis?.matchScore || 0}%`;
      }
      
      await sendWhatsAppNotification(notificationMessage);
    } catch (e) {
      console.error("Failed to send WhatsApp notification:", e);
    }

    res.json({
      success: true,
      message: "تم رفع الإيصال بنجاح، سيتم مراجعته وتفعيل الإضافة",
      addOnId,
      paymentId,
      aiScan: aiScanResult ? {
        recommendation: aiScanResult.recommendation,
        confidence: aiScanResult.confidence,
        summary: aiScanResult.summary,
        matchScore: aiScanResult.matchAnalysis?.matchScore,
        authenticityScore: aiScanResult.authenticityAnalysis?.overallScore,
      } : null
    });
  } catch (err) {
    console.error("Bank transfer addon error:", err);
    res.status(500).json({ error: "فشل رفع الإيصال" });
  }
});

// ======================
// Auto-Match API (المطابقة التلقائية)
// ======================

// تشغيل المطابقة التلقائية يدوياً
router.post("/api/admin/auto-match/run", async (_req, res) => {
  try {
    const { runAutoMatch } = await import("../../autoMatchService");
    await runAutoMatch();
    res.json({
      success: true,
      message: "تمت المطابقة التلقائية بنجاح",
    });
  } catch (err) {
    console.error("Error running auto-match:", err);
    res.status(500).json({ error: "فشل في تشغيل المطابقة التلقائية" });
  }
});

export default router;
