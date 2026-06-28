import { Router } from "express";
import { requireAdmin } from "../middleware";
import { paymentService, propertyService } from "../../services";
import { firebaseService } from "../../firebaseService";
import {
  calculateSubscriptionEndDate,
  formatDateRiyadh,
} from "../../utils/dateUtils";

const router = Router();

// قبول التحويل البنكي — تجاوز يدوي للتحقق التلقائي
router.post("/api/admin/payment/approve", requireAdmin, async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) return res.status(400).json({ error: "معرف الدفع مطلوب" });
    await paymentService.approveBankTransfer(paymentId);
    res.json({ ok: true, message: "تم قبول التحويل وتفعيل الاشتراك" });
  } catch (err: any) {
    console.error("Approve payment error:", err);
    const status = err.message?.includes("ليس معلقاً") ? 400 : err.message?.includes("غير موجود") ? 404 : 500;
    res.status(status).json({ error: err.message || "خطأ في قبول الدفع" });
  }
});


router.post("/api/admin/payment/reject", requireAdmin, async (req, res) => {
  try {
    const { paymentId } = req.body;
    if (!paymentId) return res.status(400).json({ error: "معرف الدفع مطلوب" });
    await paymentService.rejectBankTransfer(paymentId);
    res.json({ ok: true, message: "تم رفض التحويل" });
  } catch (err: any) {
    console.error("Reject payment error:", err);
    res.status(500).json({ error: "خطأ في رفض الدفع" });
  }
});


router.post("/api/admin/payments/:paymentId/confirm", requireAdmin, async (req, res) => {
  try {
    const { paymentId } = req.params;
    await paymentService.confirmManually(paymentId);
    res.json({ success: true, message: "تم تأكيد الدفعة وتفعيل الاشتراك بنجاح" });
  } catch (err: any) {
    const status = err.message?.includes("مكتملة مسبقاً") ? 400 : err.message?.includes("غير موجودة") ? 404 : 500;
    res.status(status).json({ error: err.message || "فشل في تأكيد الدفعة" });
  }
});


router.get("/api/admin/payments", requireAdmin, async (req, res) => {
  try {
    const payments = await paymentService.getAll();
    const properties = await propertyService.getAll();

    // تضمين اسم العقار في المدفوعات
    const enrichedPayments = payments.map(payment => {
      const property = properties.find(p => p.propertyNumber === payment.propertyNumber);
      return {
        ...payment,
        propertyName: property?.name || "غير معروف",
      };
    });

    res.json(enrichedPayments);
  } catch (error) {
    console.error("Error fetching payments:", error);
    res.status(500).json({ error: "فشل في جلب المدفوعات" });
  }
});

router.put("/api/admin/payments/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const updated = await paymentService.update(id, { status } as any);
    if (!updated) {
      return res.status(404).json({ error: "الدفعة غير موجودة" });
    }
    res.json(updated);
  } catch (error) {
    console.error("Error updating payment status:", error);
    res.status(500).json({ error: "فشل في تحديث حالة الدفعة" });
  }
});


// ======================
// تحديث عناوين أعمدة المدفوعات
// ======================
router.post("/api/admin/setup-payment-headers", async (req, res) => {
  try {
    await firebaseService.initializeSheets();
    res.json({ success: true, message: "تم تحديث عناوين الأعمدة بنجاح" });
  } catch (error: any) {
    console.error("Error setting up payment headers:", error);
    res.status(500).json({ error: error.message });
  }
});

// ======================
// تحديث رسوم معاملة يدوياً
// ======================
router.post("/api/admin/payments/:transactionId/update-fees", async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { feeAmount, vatAmount, merchantFees, acqFees } = req.body;

    if (!transactionId) {
      return res.status(400).json({ error: "معرف المعاملة مطلوب" });
    }

    // حساب الإجمالي والصافي
    const totalFees = (feeAmount || 0) + (vatAmount || 0);

    console.log(`📝 Updating fees for transaction ${transactionId}:`, {
      feeAmount, vatAmount, totalFees, merchantFees, acqFees
    });

    // تحديث الرسوم في Google Sheets
    await firebaseService.updatePaymentFees(transactionId, {
      feeAmount: feeAmount || 0,
      vatAmount: vatAmount || 0,
      totalFees,
      merchantFees: merchantFees || 0,
      acqFees: acqFees || 0,
    });

    res.json({
      success: true,
      message: "تم تحديث الرسوم بنجاح",
      data: { feeAmount, vatAmount, totalFees, merchantFees, acqFees }
    });
  } catch (error: any) {
    console.error("Error updating payment fees:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
