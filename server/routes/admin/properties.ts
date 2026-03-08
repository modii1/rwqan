import { Router } from "express";
import { requireAdmin } from "../middleware";
import { propertyService, analyticsService, subscriptionService } from "../../services";
import { firebaseService } from "../../firebaseService";
import { googleDriveService } from "../../integrations/googleDrive";
import { SHEET_MAP } from "../../utils/helpers";
import { notifyPropertyVerification } from "../../integrations/whatsapp";

const router = Router();

// 🔧 endpoint مؤقت لتحديث بيانات العقار (للاختبار)
router.put("/api/admin/property/:propertyNumber", async (req, res) => {
  try {
    const { propertyNumber } = req.params;
    const updates = req.body;
    // skipVerification: admin edits should not push property back to 'pending'
    const updated = await propertyService.update(propertyNumber, updates, { skipVerification: true });
    res.json({ success: true, property: updated });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// Admin: Get all properties
router.get("/api/admin/properties", async (_req, res) => {
  try {
    const items = await propertyService.getAll();
    res.json(items);
  } catch (err) {
    console.error("Admin get properties error:", err);
    res.status(500).json({ error: "فشل في جلب العقارات" });
  }
});

// Admin: Update property
router.put("/api/admin/properties/:propertyNumber", async (req, res) => {
  const { propertyNumber } = req.params;
  try {
    const body = req.body;

    // Log property name for debugging
    console.log(`[ADMIN_PROPERTY_UPDATE] Property: ${propertyNumber}, Name: "${body.name}", Length: ${body.name?.length || 0}`);

    // Validate name length
    if (body.name && body.name.length > 30) {
      console.log(`[ADMIN_PROPERTY_UPDATE] Validation failed: name too long (${body.name.length} chars)`);
      return res.status(400).json({ error: "اسم العقار يجب ألا يتجاوز 30 حرف" });
    }

    // Convert Arabic keys to English
    const updates: any = {};
    for (const [key, value] of Object.entries(body)) {
      const mapped = SHEET_MAP[key];
      if (mapped) {
        updates[mapped] = value;
      } else {
        // Try direct key (includes 'pin', 'priceWeekday', etc.)
        updates[key] = value;
      }
    }

    // Log PIN changes so they are traceable in server logs
    if (updates.pin !== undefined) {
      console.log(`[ADMIN UPDATE] PIN change requested for property ${propertyNumber}`);
    }

    // Ensure facilities is stored as a native array, not a JSON string
    if (typeof updates.facilities === 'string') {
      const trimmed = updates.facilities.trim();
      if (trimmed.startsWith('[')) {
        try { updates.facilities = JSON.parse(trimmed); } catch { updates.facilities = []; }
      } else {
        updates.facilities = trimmed.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
    }

    // skipVerification=true because admin edits are intentional and should not
    // revert the property back to 'pending' (the old code had the same behaviour).
    const updated = await propertyService.update(propertyNumber, updates, { skipVerification: true });
    console.log(`[ADMIN UPDATE] property ${propertyNumber} updated fields: ${Object.keys(updates).join(", ")}`);
    res.json(updated);
  } catch (err: any) {
    console.error(`[ADMIN UPDATE] Error updating property ${propertyNumber}:`, err?.message);
    res.status(500).json({ error: err?.message || "فشل في التحديث" });
  }
});

// Admin: Create property
router.post("/api/admin/properties", async (req, res) => {
  try {
    const body = req.body;

    // Log property name for debugging
    console.log(`[ADMIN_PROPERTY_CREATE] Name: "${body.name}", Length: ${body.name?.length || 0}`);

    // Validate name length
    if (body.name && body.name.length > 30) {
      console.log(`[ADMIN_PROPERTY_CREATE] Validation failed: name too long (${body.name.length} chars)`);
      return res.status(400).json({ error: "اسم العقار يجب ألا يتجاوز 30 حرف" });
    }

    // Convert Arabic keys to English
    const data: any = {};
    for (const [key, value] of Object.entries(body)) {
      const mapped = SHEET_MAP[key];
      if (mapped) {
        data[mapped] = value;
      } else {
        data[key] = value;
      }
    }

    // Check if exists
    const exists = await propertyService.getByNumber(data.propertyNumber);
    if (exists) {
      return res.status(400).json({ error: "رقم العقار مستخدم بالفعل" });
    }

    // Create Drive folder
    const folderId = await googleDriveService.createPropertyFolder(
      data.propertyNumber,
      data.name
    );

    const created = await propertyService.create({
      ...data,
      driveFolderId: folderId,
      imageUrls: [],
    });

    res.json(created);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "فشل في الإنشاء" });
  }
});

// Admin: Delete property
router.delete("/api/admin/properties/:propertyNumber", async (req, res) => {
  try {
    await propertyService.delete(req.params.propertyNumber);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "فشل في الحذف" });
  }
});

// ==========================
//   التحقق من العقارات
// ==========================

router.put("/api/admin/properties/:propertyNumber/approve", async (req, res) => {
  try {
    const { propertyNumber } = req.params;
    console.log(`[APPROVE] Starting approval for property: ${propertyNumber}`);

    // تحديث الحالة في الشيت
    const updated = await firebaseService.updateVerificationStatus(
      propertyNumber,
      "approved"
    );
    console.log(`[APPROVE] Verification status updated to approved for: ${propertyNumber}`);

    // تسجيل العملية داخل storage
    await analyticsService.addVerificationLog({
      propertyNumber,
      action: "approved",
    });

    // Check if there's a placeholder subscription and activate it
    console.log(`[APPROVE] Checking for existing subscription for: ${propertyNumber}`);
    const currentSubscription = await subscriptionService.getByProperty(propertyNumber);
    console.log(`[APPROVE] Current subscription:`, currentSubscription);

    if (currentSubscription && currentSubscription.status === "غير نشط") {
      console.log(`[APPROVE] Found placeholder subscription, activating for: ${propertyNumber}`);
      // Update the placeholder subscription to active
      await firebaseService.activateSubscription(propertyNumber, {
        status: "نشط",
        subscriptionType: "عادي",
        packageId: "pkg-free",
      });
      console.log(`[APPROVE] ✅ Subscription activated for property: ${propertyNumber}`);
    } else if (!currentSubscription) {
      console.log(`[APPROVE] No subscription found for: ${propertyNumber}, creating new one`);
      await firebaseService.activateSubscription(propertyNumber, {
        status: "نشط",
        subscriptionType: "عادي",
        packageId: "pkg-free",
      });
      console.log(`[APPROVE] ✅ New subscription created and activated for: ${propertyNumber}`);
    } else {
      console.log(`[APPROVE] Subscription already active or not a placeholder: ${propertyNumber}, status: ${currentSubscription?.status}`);
    }

    // إرسال إشعار واتساب عند قبول العقار
    const property = await propertyService.getByNumber(propertyNumber);
    notifyPropertyVerification({
      propertyNumber,
      propertyName: property?.name || "",
      action: "قبول",
      admin: "Admin",
    }).catch(err => console.error("WhatsApp notify error:", err));

    console.log(`[APPROVE] Completed for property: ${propertyNumber}`);
    res.json({
      success: true,
      message: "تم قبول العقار",
      property: updated,
    });

  } catch (err) {
    console.error("[APPROVE] Error:", err);
    res.status(500).json({ success: false, message: "فشل في قبول العقار" });
  }
});

router.put("/api/admin/properties/:propertyNumber/reject", async (req, res) => {
  try {
    const { propertyNumber } = req.params;
    const { reason } = req.body;
    console.log(`[REJECT] Starting rejection for property: ${propertyNumber}, reason: ${reason}`);

    // تحديث الحالة في الشيت
    const updated = await firebaseService.updateVerificationStatus(
      propertyNumber,
      "rejected"
    );
    console.log(`[REJECT] Verification status updated to rejected for: ${propertyNumber}`);

    // تسجيل العملية داخل storage
    await analyticsService.addVerificationLog({
      propertyNumber,
      action: "rejected",
      reason: reason || "",
      admin: "Admin",
    });

    // Cancel/deactivate the subscription when property is rejected
    console.log(`[REJECT] Cancelling subscription for: ${propertyNumber}`);
    await firebaseService.cancelSubscription(propertyNumber, reason || "رفض العقار من الإدارة");
    console.log(`[REJECT] Subscription cancelled for: ${propertyNumber}`);

    // إرسال إشعار واتساب عند رفض العقار
    const property = await propertyService.getByNumber(propertyNumber);
    notifyPropertyVerification({
      propertyNumber,
      propertyName: property?.name || "",
      action: "رفض",
      reason: reason || "",
      admin: "Admin",
    }).catch(err => console.error("WhatsApp notify error:", err));

    console.log(`[REJECT] Completed for property: ${propertyNumber}`);
    res.json({
      success: true,
      message: "تم رفض العقار",
      property: updated,
    });

    res.json({
      success: true,
      message: "تم رفض العقار",
      property: updated,
    });

  } catch (err) {
    console.error("Reject Error:", err);
    res.status(500).json({ success: false, message: "فشل في رفض العقار" });
  }
});

// ================== إيقاف/تفعيل إشعارات انتهاء الاشتراك ==================
router.put("/api/admin/properties/:propertyNumber/mute-expiry", async (req, res) => {
  try {
    const { propertyNumber } = req.params;
    const { muted } = req.body;

    if (typeof muted !== "boolean") {
      return res.status(400).json({ error: "قيمة muted يجب أن تكون true أو false" });
    }

    const updated = await firebaseService.updateMuteExpiryNotification(
      propertyNumber,
      muted
    );

    console.log(`📢 [MuteExpiry] تم ${muted ? "إيقاف" : "تفعيل"} إشعارات انتهاء الاشتراك للعقار ${propertyNumber}`);

    res.json({
      success: true,
      message: muted ? "تم إيقاف إشعارات انتهاء الاشتراك" : "تم تفعيل إشعارات انتهاء الاشتراك",
      property: updated,
    });

  } catch (err) {
    console.error("Mute Expiry Error:", err);
    res.status(500).json({ success: false, message: "فشل في تعديل حالة الإشعارات" });
  }
});

export default router;
