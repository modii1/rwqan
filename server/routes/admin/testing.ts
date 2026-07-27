import { Router } from "express";
import { requireAdmin } from "../middleware";
import { propertyService, paymentService, analyticsService } from "../../services";
import { firebaseService } from "../../firebaseService";
import { smartVerification } from "../../utils/verification";
import { isPropertySuspended } from "../../services/propertySuspension";

const router = Router();

// ======================
// ADMIN: إصلاح الشيتات
// ======================
router.post("/api/admin/fix-sheets", async (req, res) => {
  try {
    // تنظيف وإصلاح جدول الطلبات والإحصائيات
    const result = await (firebaseService as any).fixAndCleanSheets();
    res.json(result);
  } catch (err: any) {
    console.error("Fix sheets error:", err);
    res.status(500).json({ error: "خطأ في إصلاح الشيتات", details: err.message });
  }
});

// ===============================
// 🔵 Logs: جلب سجل التحقق بالكامل
// ===============================
router.get("/api/admin/verification/logs", async (req, res) => {
  try {
    const logs = await analyticsService.getVerificationLogs();
    res.json(logs || []);
  } catch (error) {
    console.error("Verification logs error:", error);
    res.status(500).json({ error: "Failed to fetch verification logs" });
  }
});

// ======================
// 📄 نتائج OCR
// ======================
router.get("/api/admin/ocr-results", async (req, res) => {
  try {
    const results = await firebaseService.getAllOcrResults();
    res.json(results || []);
  } catch (error) {
    console.error("OCR results error:", error);
    res.status(500).json({ error: "Failed to fetch OCR results" });
  }
});

// ======================
// 🔍 التحقق الذكي من العقار
// ======================
router.post("/api/admin/smart-verify", async (req, res) => {
  try {
    const { propertyNumber, paymentId, secondPropertyNumber } = req.body;

    if (!propertyNumber) {
      return res.status(400).json({ error: "رقم العقار مطلوب" });
    }

    if (await isPropertySuspended(propertyNumber)) {
      return res.status(423).json({
        success: false,
        code: "PROPERTY_SUSPENDED",
        error:
          "الاشتراك موقوف مؤقتاً من الإدارة. يجب استئنافه قبل تشغيل التحقق الذكي.",
      });
    }

    if (secondPropertyNumber && await isPropertySuspended(secondPropertyNumber)) {
      return res.status(423).json({
        success: false,
        code: "PROPERTY_SUSPENDED",
        error:
          "الاشتراك موقوف مؤقتاً من الإدارة. يجب استئنافه قبل تشغيل التحقق الذكي.",
      });
    }

    const property = await propertyService.getByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    let paymentRecord = null;
    let ocrResult: { confidence: number; matched: boolean } | undefined = undefined;
    let secondProperty = null;

    if (paymentId) {
      const payments = await paymentService.getAll();
      paymentRecord = payments.find((p: any) => p.paymentId === paymentId);

      if ((paymentRecord as any)?.ocrConfidence) {
        ocrResult = {
          confidence: Number((paymentRecord as any).ocrConfidence) || 0,
          matched: (paymentRecord as any).autoMatched === 'true' || (paymentRecord as any).autoMatched === true
        };
      }
    }

    if (secondPropertyNumber) {
      secondProperty = await propertyService.getByNumber(secondPropertyNumber);
    }

    const result = await smartVerification({
      property,
      paymentRecord,
      ocrResult,
      secondProperty
    });

    console.log(`🔍 [Smart Verify] ${propertyNumber}: ${result.verificationStatus} (confidence: ${result.aiConfidence}%)`);

    res.json({
      success: true,
      propertyNumber,
      ...result
    });
  } catch (error) {
    console.error("Error in smart verification:", error);
    res.status(500).json({ error: "فشل في التحقق الذكي" });
  }
});

router.get("/api/admin/property-verification/:propertyNumber", async (req, res) => {
  try {
    const { propertyNumber } = req.params;

    if (await isPropertySuspended(propertyNumber)) {
      return res.status(423).json({
        success: false,
        code: "PROPERTY_SUSPENDED",
        error:
          "الاشتراك موقوف مؤقتاً من الإدارة. يجب استئنافه قبل تشغيل التحقق الذكي.",
      });
    }

    const property = await propertyService.getByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    const result = await smartVerification({ property });

    res.json({
      propertyNumber,
      name: property.name,
      currentStatus: property.verificationStatus || 'غير محدد',
      ...result
    });
  } catch (error) {
    console.error("Error checking property verification:", error);
    res.status(500).json({ error: "فشل في فحص حالة التحقق" });
  }
});

// ======================
// اختبار Enjazatik API مباشرة
// ======================
router.post("/api/admin/test-enjazatik", async (req, res) => {
  try {
    const { phone, message } = req.body;

    const targetPhone = phone;
    const testMessage = message || "🔔 اختبار من نظام روقـان\n\nهذه رسالة تجريبية للتأكد من عمل نظام الإشعارات.";

    const { sendOwnerWhatsApp } = await import("../../integrations/whatsapp");
    const result = await sendOwnerWhatsApp(targetPhone, testMessage);

    console.log(`📱 [Test] Enjazatik test to ${targetPhone}:`, result);

    res.json({
      success: result.success,
      phone: targetPhone,
      error: result.error,
    });
  } catch (error: any) {
    console.error("❌ Enjazatik Test Error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ======================
// اختبار Paymob Inquiry API
// ======================
router.post("/api/admin/test-inquiry", async (req, res) => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: "orderId مطلوب" });
    }

    console.log(`🧪 Testing Paymob Inquiry API with order_id: ${orderId}`);

    const { paymobService } = await import("../../integrations/paymob");
    const inquiry = await paymobService.inquiryByOrderId(orderId);

    console.log(`📊 Inquiry Result:`, JSON.stringify(inquiry, null, 2));

    res.json({
      success: true,
      inquiry
    });
  } catch (error: any) {
    console.error("❌ Inquiry Test Error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
