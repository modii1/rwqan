import { Router } from "express";
import { subscriptionService } from "../../services";
import { firebaseService } from "../../firebaseService";
import { propertyService } from "../../services";
import { isSubscriptionStatusSuspended } from "../../../shared/subscriptionType";
import {
  assertPropertyNotSuspended,
  PropertySuspendedError,
} from "../../services/propertySuspension";
import { notificationSettingsSchema } from "../../../shared/schema";

const router = Router();

// ======================
// ⚙️ إعدادات الإشعارات
// ======================
router.get("/api/admin/settings/notifications", async (req, res) => {
  try {
    const settings = await firebaseService.getNotificationSettings();
    res.json(settings);
  } catch (error) {
    console.error("Error fetching notification settings:", error);
    res.status(500).json({ error: "فشل في جلب إعدادات الإشعارات" });
  }
});

router.put("/api/admin/settings/notifications", async (req, res) => {
  try {
    const parsed = notificationSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "إعدادات الإشعارات غير صالحة" });
    }
    const settings = parsed.data;
    await firebaseService.saveNotificationSettings(settings);
    // مسح كاش الإعدادات في whatsapp.ts
    const { clearSettingsCache } = await import("../../integrations/whatsapp");
    clearSettingsCache();
    res.json({ success: true, message: "تم حفظ الإعدادات بنجاح" });
  } catch (error) {
    console.error("Error saving notification settings:", error);
    res.status(500).json({ error: "فشل في حفظ الإعدادات" });
  }
});

// ======================
// 📱 إرسال إشعار واتساب يدوي للمالك
// ======================
router.post("/api/admin/send-owner-notification", async (req, res) => {
  try {
    const { propertyNumber, notificationType, customMessage } = req.body;

    if (!propertyNumber) {
      return res.status(400).json({ error: "رقم العقار مطلوب" });
    }

    await assertPropertyNotSuspended(propertyNumber);

    // جلب بيانات العقار
    const property = await propertyService.getByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    // جلب رقم المالك من ورقة الملاك
    const ownerPhone = await firebaseService.getOwnerPhone(propertyNumber);
    if (!ownerPhone) {
      return res.status(404).json({ error: "رقم المالك غير مسجل في النظام" });
    }

    // استيراد دوال الإشعارات
    const {
      notifyOwnerSubscriptionExpired,
      notifyOwnerSubscriptionExpiringSoon,
      sendPropertyOwnerWhatsApp
    } = await import("../../integrations/whatsapp");

    let result;
    let messageType = "";

    switch (notificationType) {
      case "expired":
        // إشعار انتهاء الاشتراك
        result = await notifyOwnerSubscriptionExpired({
          ownerPhone,
          propertyNumber,
          propertyName: property.name || propertyNumber,
        });
        messageType = "انتهاء الاشتراك";
        break;

      case "expiring_soon":
        // إشعار قبل انتهاء الاشتراك
        result = await notifyOwnerSubscriptionExpiringSoon({
          ownerPhone,
          propertyNumber,
          propertyName: property.name || propertyNumber,
          daysLeft: 3,
        });
        messageType = "تذكير قبل انتهاء الاشتراك";
        break;

      case "custom":
        // رسالة مخصصة
        if (!customMessage) {
          return res.status(400).json({ error: "الرسالة المخصصة مطلوبة" });
        }
        result = await sendPropertyOwnerWhatsApp({
          ownerPhone,
          propertyNumber,
          message: customMessage,
          logType: "admin_manual_owner",
          propertyName: property.name || propertyNumber,
        });
        messageType = "رسالة مخصصة";
        break;

      default:
        return res.status(400).json({ error: "نوع الإشعار غير صحيح" });
    }

    if (result?.suppressed) {
      if (result.code === "PROPERTY_SUSPENDED") {
        throw new PropertySuspendedError(result.error);
      }
      return res.status(503).json({
        success: false,
        code: result.code || "SUSPENSION_LOOKUP_FAILED",
        error: result.error || "تعذر التحقق من حالة إيقاف العقار",
      });
    }

    if (!result?.success) {
      return res.status(502).json({
        success: false,
        error: result?.error || "فشل في إرسال الإشعار",
      });
    }

    console.log(`📱 [Manual Notification] Sent ${notificationType} to ${ownerPhone} for property ${propertyNumber}`);

    res.json({
      success: true,
      message: `تم إرسال إشعار "${messageType}" بنجاح للرقم ${ownerPhone}`,
      ownerPhone,
      notificationType,
      result,
    });

  } catch (err) {
    if (err instanceof PropertySuspendedError) {
      return res.status(err.status).json({
        success: false,
        code: err.code,
        error: err.message,
      });
    }
    console.error("Manual notification error:", err);
    res.status(500).json({
      success: false,
      error: "فشل في إرسال الإشعار",
      details: err instanceof Error ? err.message : String(err)
    });
  }
});

// ======================
// 📱 إرسال إشعارات جماعية للملاك
// ======================
router.post("/api/admin/send-bulk-notifications", async (req, res) => {
  try {
    const { notificationType } = req.body;

    if (!notificationType || !["all", "expired", "expiring_soon"].includes(notificationType)) {
      return res.status(400).json({ error: "نوع الإشعار غير صحيح" });
    }

    const subscriptions = await subscriptionService.getAll();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const {
      notifyOwnerSubscriptionExpired,
      notifyOwnerSubscriptionExpiringSoon
    } = await import("../../integrations/whatsapp");

    let sentCount = 0;
    let suspendedCount = 0;
    const errors: string[] = [];

    for (const sub of subscriptions) {
      if (!sub.endDate || !sub.propertyNumber) continue;
      if (isSubscriptionStatusSuspended(sub.status)) {
        suspendedCount++;
        continue;
      }

      try {
        const endDate = new Date(sub.endDate);
        endDate.setHours(0, 0, 0, 0);
        const diffTime = endDate.getTime() - today.getTime();
        const remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        // جلب بيانات العقار ورقم المالك
        const property = await propertyService.getByNumber(sub.propertyNumber);
        const ownerPhone = await firebaseService.getOwnerPhone(sub.propertyNumber);

        if (!ownerPhone) continue;

        let shouldSend = false;
        let notifyFunction: (() => Promise<any>) | null = null;

        // إشعار المنتهية
        if ((notificationType === "all" || notificationType === "expired") && remainingDays < 0) {
          shouldSend = true;
          notifyFunction = () => notifyOwnerSubscriptionExpired({
            ownerPhone,
            propertyNumber: sub.propertyNumber,
            propertyName: property?.name || sub.propertyNumber,
          });
        }
        // إشعار القريبة من الانتهاء (3 أيام أو أقل)
        else if ((notificationType === "all" || notificationType === "expiring_soon") && remainingDays > 0 && remainingDays <= 3) {
          shouldSend = true;
          notifyFunction = () => notifyOwnerSubscriptionExpiringSoon({
            ownerPhone,
            propertyNumber: sub.propertyNumber,
            propertyName: property?.name || sub.propertyNumber,
            daysLeft: remainingDays,
          });
        }

        if (shouldSend && notifyFunction) {
          const result = await notifyFunction();
          if (result?.success) {
            sentCount++;
            console.log(`📱 [Bulk] Sent notification to ${sub.propertyNumber}`);
          } else if (result?.suppressed && result.code === "PROPERTY_SUSPENDED") {
            suspendedCount++;
          } else if (result?.suppressed) {
            errors.push(`${sub.propertyNumber}: ${result.error || "تعذر التحقق من حالة الإيقاف"}`);
          } else if (result?.error) {
            errors.push(`${sub.propertyNumber}: ${result.error}`);
          }
          // تأخير بسيط بين الرسائل لتجنب rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (err) {
        errors.push(`${sub.propertyNumber}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    console.log(`📱 [Bulk Notifications] Sent ${sentCount} notifications, suppressed ${suspendedCount}, ${errors.length} errors`);

    res.json({
      success: true,
      sentCount,
      suspendedCount,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
    });

  } catch (err) {
    console.error("Bulk notification error:", err);
    res.status(500).json({
      success: false,
      error: "فشل في إرسال الإشعارات الجماعية",
      details: err instanceof Error ? err.message : String(err)
    });
  }
});

// ======================
// Bank Accounts API (الحسابات البنكية)
// ======================

// جلب الحسابات البنكية النشطة (للمستخدم)
router.get("/api/bank-accounts", async (_req, res) => {
  try {
    const accounts = await firebaseService.getActiveBankAccounts();
    res.json(accounts);
  } catch (err) {
    console.error("Error fetching bank accounts:", err);
    res.status(500).json({ error: "فشل في جلب الحسابات البنكية" });
  }
});

// جلب الحساب البنكي الافتراضي
router.get("/api/bank-accounts/default", async (_req, res) => {
  try {
    const account = await firebaseService.getDefaultBankAccount();
    res.json(account);
  } catch (err) {
    console.error("Error fetching default bank account:", err);
    res.status(500).json({ error: "فشل في جلب الحساب البنكي الافتراضي" });
  }
});

// جلب كل الحسابات البنكية (للإدارة)
router.get("/api/admin/bank-accounts", async (_req, res) => {
  try {
    const accounts = await firebaseService.getBankAccounts();
    res.json(accounts);
  } catch (err) {
    console.error("Error fetching bank accounts:", err);
    res.status(500).json({ error: "فشل في جلب الحسابات البنكية" });
  }
});

// إضافة حساب بنكي جديد
router.post("/api/admin/bank-accounts", async (req, res) => {
  try {
    const { bankName, beneficiaryName, iban, accountNumber, isActive, isDefault } = req.body;

    if (!bankName || !beneficiaryName || !iban) {
      return res.status(400).json({ error: "يرجى تعبئة جميع الحقول المطلوبة" });
    }

    const account = await firebaseService.addBankAccount({
      bankName,
      beneficiaryName,
      iban,
      accountNumber,
      isActive: isActive !== false,
      isDefault: isDefault === true,
    });

    res.json(account);
  } catch (err) {
    console.error("Error adding bank account:", err);
    res.status(500).json({ error: "فشل في إضافة الحساب البنكي" });
  }
});

// تعديل حساب بنكي
router.put("/api/admin/bank-accounts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    await firebaseService.updateBankAccount(id, updates);
    res.json({ success: true, message: "تم تحديث الحساب البنكي بنجاح" });
  } catch (err) {
    console.error("Error updating bank account:", err);
    res.status(500).json({ error: "فشل في تحديث الحساب البنكي" });
  }
});

// حذف حساب بنكي (إلغاء تفعيل)
router.delete("/api/admin/bank-accounts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await firebaseService.deleteBankAccount(id);
    res.json({ success: true, message: "تم حذف الحساب البنكي بنجاح" });
  } catch (err) {
    console.error("Error deleting bank account:", err);
    res.status(500).json({ error: "فشل في حذف الحساب البنكي" });
  }
});

// ======================
// Feature Flags API (أعلام الميزات)
// ======================

// جلب كل الميزات
router.get("/api/admin/feature-flags", async (_req, res) => {
  try {
    const flags = await firebaseService.getFeatureFlags();
    res.json(flags);
  } catch (err) {
    console.error("Error fetching feature flags:", err);
    res.status(500).json({ error: "فشل في جلب الميزات" });
  }
});

// تحديث حالة ميزة
router.put("/api/admin/feature-flags/:key", async (req, res) => {
  try {
    const { key } = req.params;
    const { isEnabled } = req.body;

    await firebaseService.updateFeatureFlag(key, isEnabled);
    res.json({ success: true, message: "تم تحديث الميزة بنجاح" });
  } catch (err) {
    console.error("Error updating feature flag:", err);
    res.status(500).json({ error: "فشل في تحديث الميزة" });
  }
});

// التحقق من حالة ميزة معينة (للاستخدام الداخلي)
router.get("/api/feature-flag/:key", async (req, res) => {
  try {
    const { key } = req.params;
    const isEnabled = await firebaseService.getFeatureFlag(key);
    res.json({ key, isEnabled });
  } catch (err) {
    console.error("Error checking feature flag:", err);
    res.status(500).json({ error: "فشل في التحقق من الميزة" });
  }
});

// تهيئة الميزات الافتراضية
router.post("/api/admin/feature-flags/initialize", async (_req, res) => {
  try {
    await firebaseService.initializeFeatureFlags();
    res.json({ success: true, message: "تم تهيئة الميزات بنجاح" });
  } catch (err) {
    console.error("Error initializing feature flags:", err);
    res.status(500).json({ error: "فشل في تهيئة الميزات" });
  }
});

export default router;
