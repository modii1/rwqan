import { Router } from "express";
import { requireOwner } from "../middleware";
import { firebaseService } from "../../firebaseService";
import { addOnService, paymentService, propertyService } from "../../services";
import { PaymobIntentionError, paymobService } from "../../integrations/paymob";
import { sendWhatsAppNotification } from "../../integrations/whatsapp";
import { upload } from "../../utils/helpers";
import { r2, R2_BUCKET, R2_PUBLIC_URL } from "../../utils/r2";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { scanReceiptWithAI } from "../../integrations/aiReceiptScanner";
import { randomUUID } from "node:crypto";
import {
  AdminApprovalError,
  sendAdminApprovalError,
} from "../../errors/AdminApprovalError";
import type {
  AdminPropertyAddOnDecisionResult,
  AdminPropertyAddOnDecisionMode,
} from "../../firebaseService";

const router = Router();

const BANK_TRANSFER_METHODS = new Set([
  "تحويل بنكي",
  "bank_transfer",
  "bank transfer",
]);

function isProviderBackedAddOnPayment(addon: any, payment: any): boolean {
  const method = String(payment?.paymentMethod || "").trim();
  const strongProviderIdentity = Boolean(
    String(payment?.merchantAttemptKey || "").trim() ||
    String(payment?.paymentCheckoutUrl || "").trim() ||
    String(payment?.paymobOrderId || "").trim() ||
    String(payment?.intentionState || "").trim(),
  );
  if (addon?.source === "paymob" || strongProviderIdentity) return true;
  return Boolean(method && !BANK_TRANSFER_METHODS.has(method));
}

function decisionModeFor(addon: any, payment: any): AdminPropertyAddOnDecisionMode {
  if (!payment) return "legacy_without_payment";
  if (isProviderBackedAddOnPayment(addon, payment)) return "settled_paymob";
  return "bank_transfer";
}

function assertExactAddOnPaymentLink(addon: any, payment: any): void {
  if (!addon.paymentId || !payment) {
    throw new AdminApprovalError({
      status: 409,
      code: "PAYMOB_PAYMENT_NOT_RECONCILABLE",
      message: "لا يمكن مطابقة طلب الإضافة بسجل دفع محدد. لم يتم تغيير الطلب.",
    });
  }
  if (
    payment.id !== addon.paymentId ||
    payment.action !== "addon" ||
    payment.propertyNumber !== addon.propertyNumber ||
    payment.packageId !== addon.addOnPackageId
  ) {
    throw new AdminApprovalError({
      status: 409,
      code: "PAYMOB_PAYMENT_IDENTITY_MISMATCH",
      message: "سجل الدفع المرتبط لا يطابق هذه الإضافة بدقة. لم يتم تغيير الطلب.",
    });
  }
}

function assertAdminAddOnDecisionApplied(
  result: AdminPropertyAddOnDecisionResult,
): void {
  if (result.status !== "rejected") return;
  if (result.reason === "not_found" || result.reason === "payment_not_found") {
    throw new AdminApprovalError({
      status: 404,
      code: "PAYMENT_NOT_FOUND",
      message: "طلب الإضافة أو سجل الدفع المرتبط به غير موجود.",
    });
  }
  if (result.reason === "not_pending") {
    throw new AdminApprovalError({
      status: 409,
      code: "PAYMENT_NOT_PENDING",
      message: "طلب الإضافة لم يعد قيد المراجعة، لذلك لم يتم تغييره.",
    });
  }
  throw new AdminApprovalError({
    status: 409,
    code: result.reason === "link_conflict"
      ? "PAYMOB_PAYMENT_IDENTITY_MISMATCH"
      : "PAYMOB_PAYMENT_NOT_RECONCILABLE",
    message: result.reason === "link_conflict"
      ? "بيانات الإضافة لا تطابق سجل الدفع المرتبط بها. لم يتم تغيير الطلب."
      : "حالة الدفع لا توفر دليلاً آمناً لهذا القرار. لم يتم تغيير الطلب.",
  });
}

function throwPaymobAddOnReconciliationError(
  status: "not_supported" | "provider_unavailable" | "unpaid" | "identity_mismatch",
  decision: "approve" | "reject",
): never {
  if (status === "provider_unavailable") {
    throw new AdminApprovalError({
      status: 503,
      code: "PAYMOB_PROVIDER_UNAVAILABLE",
      message: "تعذر التحقق من دفعة الإضافة لدى Paymob حالياً. لم يتم تغيير الطلب.",
    });
  }
  if (status === "identity_mismatch") {
    throw new AdminApprovalError({
      status: 409,
      code: "PAYMOB_PAYMENT_IDENTITY_MISMATCH",
      message: "بيانات Paymob لا تطابق محاولة دفع الإضافة المسجلة. لم يتم تغيير الطلب.",
    });
  }
  if (status === "unpaid") {
    throw new AdminApprovalError({
      status: 409,
      code: decision === "approve"
        ? "PAYMOB_PAYMENT_NOT_PAID"
        : "PAYMOB_REJECTION_DEFERRED",
      message: decision === "approve"
        ? "لم يؤكد Paymob اكتمال دفع الإضافة، لذلك لم يتم تفعيلها."
        : "دفعة الإضافة ما زالت قابلة لاستقبال نتيجة Paymob. لم يتم رفضها حتى لا تضيع دفعة متأخرة.",
    });
  }
  throw new AdminApprovalError({
    status: 409,
    code: "PAYMOB_PAYMENT_NOT_RECONCILABLE",
    message: "لا توجد هوية Paymob كاملة وآمنة لهذه الإضافة. لم يتم تغيير الطلب.",
  });
}

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
      throw new AdminApprovalError({
        status: 400,
        code: "PAYMENT_ID_REQUIRED",
        message: "معرف طلب الإضافة مطلوب.",
      });
    }

    const addon = await firebaseService.getPropertyAddOnById(propertyAddOnId);
    if (!addon) {
      throw new AdminApprovalError({
        status: 404,
        code: "PAYMENT_NOT_FOUND",
        message: "طلب الإضافة غير موجود.",
      });
    }
    const payment = addon.paymentId
      ? await paymentService.getById(addon.paymentId)
      : null;
    if (addon.paymentId) assertExactAddOnPaymentLink(addon, payment);
    const mode = decisionModeFor(addon, payment);

    const pkg = await addOnService.getPackageById(addon.addOnPackageId);
    if (!pkg) {
      throw new AdminApprovalError({
        status: 404,
        code: "PACKAGE_NOT_FOUND",
        message: "باقة الإضافة المرتبطة بالطلب غير موجودة، لذلك لم يتم التفعيل.",
      });
    }

    const startDate = new Date();
    let endDate: Date | null = null;
    if (pkg.durationDays > 0) {
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + pkg.durationDays);
    }

    if (mode === "settled_paymob") {
      const reconciliation = await paymentService.reconcilePaymobAddonIntention(
        addon.paymentId!,
      );
      if (
        reconciliation.status !== "paid" &&
        reconciliation.status !== "already_processed"
      ) {
        throwPaymobAddOnReconciliationError(reconciliation.status, "approve");
      }
    }

    const result = await firebaseService.applyAdminPropertyAddOnDecision({
      addonId: addon.id,
      ...(addon.paymentId ? { paymentId: addon.paymentId } : {}),
      decision: "approve",
      mode,
      startDate: startDate.toISOString(),
      ...(endDate ? { endDate: endDate.toISOString() } : {}),
    });
    assertAdminAddOnDecisionApplied(result);

    res.json({ ok: true, alreadyProcessed: result.status === "already_applied" });
  } catch (err: unknown) {
    console.error("Approve addon error:", err);
    return sendAdminApprovalError(
      res,
      err,
      "تعذر تفعيل الإضافة حالياً. لم يتم إجراء أي تغيير.",
    );
  }
});

// =======================================
// ADMIN – Reject Add-On (Bank Transfer)
// =======================================
router.post("/api/admin/addons/reject", async (req, res) => {
  try {
    const { propertyAddOnId } = req.body;

    if (!propertyAddOnId) {
      throw new AdminApprovalError({
        status: 400,
        code: "PAYMENT_ID_REQUIRED",
        message: "معرف طلب الإضافة مطلوب.",
      });
    }

    const addon = await firebaseService.getPropertyAddOnById(propertyAddOnId);
    if (!addon) {
      throw new AdminApprovalError({
        status: 404,
        code: "PAYMENT_NOT_FOUND",
        message: "طلب الإضافة غير موجود.",
      });
    }
    const payment = addon.paymentId
      ? await paymentService.getById(addon.paymentId)
      : null;
    if (addon.paymentId) assertExactAddOnPaymentLink(addon, payment);
    const mode = decisionModeFor(addon, payment);

    if (mode === "settled_paymob") {
      const reconciliation = await paymentService.reconcilePaymobAddonIntention(
        addon.paymentId!,
      );
      if (
        reconciliation.status === "paid" ||
        reconciliation.status === "already_processed"
      ) {
        throw new AdminApprovalError({
          status: 409,
          code: "PAYMOB_PAYMENT_ALREADY_PAID",
          message: "أكد Paymob اكتمال دفعة الإضافة، لذلك لم يتم رفضها. يمكن اعتمادها بعد مراجعة البيانات.",
        });
      }
      throwPaymobAddOnReconciliationError(reconciliation.status, "reject");
    }

    const result = await firebaseService.applyAdminPropertyAddOnDecision({
      addonId: addon.id,
      ...(addon.paymentId ? { paymentId: addon.paymentId } : {}),
      decision: "reject",
      mode,
    });
    assertAdminAddOnDecisionApplied(result);

    res.json({ ok: true, alreadyProcessed: result.status === "already_applied" });
  } catch (err: unknown) {
    console.error("Reject addon error:", err);
    return sendAdminApprovalError(
      res,
      err,
      "تعذر رفض الإضافة حالياً. لم يتم إجراء أي تغيير.",
    );
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
  let createdPaymentId: string | null = null;
  let createdAddOnId: string | null = null;
  let paymentIntentionRequestStarted = false;
  let paymentIntentionPersisted = false;
  let knownPaymentIntention: {
    intentionId: string;
    checkoutUrl: string;
    paymobOrderId: string;
  } | null = null;
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
    const uniqueAttemptId = randomUUID().toUpperCase();
    const paymentId = `PAY-ADDON-${Date.now()}-${uniqueAttemptId.slice(0, 8)}`;
    const addOnId = `ADDON-${propertyNumber}-${Date.now()}-${uniqueAttemptId.slice(9, 17)}`;
    const merchantAttemptKey = `RWQN-ADDON-${uniqueAttemptId}`;

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
      merchantAttemptKey,
      intentionState: "creating",
    });
    createdPaymentId = paymentId;

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
    createdAddOnId = addOnId;

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
    paymentIntentionRequestStarted = true;
    const paymobPayment = await paymobService.initiateAddOnPayment(
      addon.price,
      propertyNumber,
      property.name,
      property.whatsappNumber || "0500000000",
      addon.id,
      addon.name,
      addon.durationDays,
      'cards',
      { merchantAttemptKey, paymentId },
    );

    // تحديث سجل الدفع بمعلومات إضافية (الـ reference)
    // سيتم تحديث paymobOrderId من الـ webhook

    knownPaymentIntention = paymobPayment;
    await paymentService.update(paymentId, {
      paymentReference: paymobPayment.intentionId,
      transactionId: paymobPayment.intentionId,
      paymentCheckoutUrl: paymobPayment.checkoutUrl,
      paymobOrderId: paymobPayment.paymobOrderId,
      intentionState: "created",
    });
    paymentIntentionPersisted = true;

    res.json({ checkoutUrl: paymobPayment.checkoutUrl, paymentId });
  } catch (err: any) {
    console.error("Pay addon error:", err);
    if (createdPaymentId && !paymentIntentionPersisted) {
      const recoverableIntention = knownPaymentIntention ||
        (err instanceof PaymobIntentionError ? err.createdIntention : undefined);
      if (recoverableIntention) {
        // A provider request that may have succeeded is never replaced. Keep
        // every known identifier so reconciliation can recover it safely.
        await paymentService.update(createdPaymentId, {
          paymentReference: recoverableIntention.intentionId,
          transactionId: recoverableIntention.intentionId,
          paymentCheckoutUrl: recoverableIntention.checkoutUrl,
          ...(recoverableIntention.paymobOrderId
            ? { paymobOrderId: recoverableIntention.paymobOrderId }
            : {}),
          intentionState: recoverableIntention.paymobOrderId
            ? "created"
            : "unknown",
        }).catch((persistenceError) =>
          console.error(
            "Failed to preserve known add-on Paymob intention:",
            persistenceError,
          ),
        );
      } else if (
        !paymentIntentionRequestStarted ||
        (err instanceof PaymobIntentionError && err.certainty === "rejected")
      ) {
        if (createdAddOnId) {
          await firebaseService.cancelRejectedAddOnIntentionCreation(
            createdPaymentId,
            createdAddOnId,
          ).then(async (cancelled) => {
            if (!cancelled) {
              console.error(
                "Rejected add-on Paymob intention could not be cancelled safely",
                { createdPaymentId, createdAddOnId },
              );
            }
          }).catch((persistenceError) =>
            console.error(
              "Failed to atomically cancel rejected add-on Paymob intention:",
              persistenceError,
            ),
          );
        } else {
          await paymentService.update(createdPaymentId, {
            status: "فشل",
            intentionState: "failed",
          }).catch((persistenceError) =>
            console.error(
              "Failed to finalize rejected add-on Paymob intention:",
              persistenceError,
            ),
          );
        }
      } else {
        await paymentService.update(createdPaymentId, {
          intentionState: "unknown",
        }).catch((persistenceError) =>
          console.error(
            "Failed to mark ambiguous add-on Paymob intention:",
            persistenceError,
          ),
        );
      }
    }
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
