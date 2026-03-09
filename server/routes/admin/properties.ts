import { Router } from "express";
import { requireAdmin } from "../middleware";
import { propertyService, analyticsService, subscriptionService, paymentService } from "../../services";
import { firebaseService } from "../../firebaseService";
import { googleDriveService } from "../../integrations/googleDrive";
import { SHEET_MAP } from "../../utils/helpers";
import { notifyPropertyVerification } from "../../integrations/whatsapp";
import { storage } from "../../storage";

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

    // Check for paid/completed payments for this property
    console.log(`[APPROVE] Checking for payments for property: ${propertyNumber}`);
    let subscriptionType = "عادي";
    let packageId = "pkg-free";
    let validPayment: any = null;
    let linkedProperty: string | undefined;
    let propertyCount: number | undefined;
    let linkedProperties: string[] | undefined;

    try {
      console.log(`[APPROVE] Calling paymentService.getByProperty(${propertyNumber})...`);
      const payments = await paymentService.getByProperty(propertyNumber);
      console.log(`[APPROVE] getByProperty returned ${payments.length} payments`);
      
      // Log all payments found
      payments.forEach((p, idx) => {
        console.log(`[APPROVE] Payment[${idx}]: id=${p.id}, propertyNumber="${p.propertyNumber}", status="${p.status}", packageId="${p.packageId}", amount=${p.finalAmount}`);
      });
      
      // First look for completed payments
      let validPayment = payments.find(p => 
        p.status === "مكتمل" || 
        (p.status as string) === "Approved" || 
        p.status === "completed"
      );

      // If no completed payment, look for pending payments
      if (!validPayment) {
        validPayment = payments.find(p => 
          p.status === "قيد التحقق" || 
          p.status === "قيد المراجعة" || 
          p.status === "معلق" ||
          p.status === "pending"
        );
        
        if (validPayment) {
          console.log(`[APPROVE] Found pending payment: ${validPayment.id}, auto-approving it...`);
          // Auto-update payment status to مكتمل
          await paymentService.setStatus(validPayment.id, "مكتمل");
          console.log(`[APPROVE] ✅ Payment ${validPayment.id} auto-approved`);
        }
      }
      
      if (validPayment && validPayment.packageId) {
        packageId = validPayment.packageId;
        console.log(`[APPROVE] ✅ Using payment: ${validPayment.id}, packageId: ${packageId}, amount: ${validPayment.finalAmount}`);
        
        // Get package to determine if premium
        const pkg = await storage.getPackageById(packageId);
        if (pkg) {
          if (pkg.type === "موثوق" || pkg.type === "مميز" || pkg.price > 0) {
            subscriptionType = "مميز";
            console.log(`[APPROVE] Package is premium: ${pkg.name}, type: ${pkg.type}, price: ${pkg.price}`);
          }
        }
      } else {
        console.log(`[APPROVE] No valid payment found, using default pkg-free`);
      }
    } catch (payErr) {
      console.error(`[APPROVE] Error checking payments:`, payErr);
    }

    // Check if there's a placeholder subscription and activate it
    console.log(`[APPROVE] Checking for existing subscription for: ${propertyNumber}`);
    const currentSubscription = await subscriptionService.getByProperty(propertyNumber);
    console.log(`[APPROVE] Current subscription:`, currentSubscription);

    // Get linked property info from payment
    if (validPayment) {
      linkedProperty = (validPayment as any).secondPropertyNumber || (validPayment as any).linkedProperty;
      linkedProperties = (validPayment as any).linkedProperties || (validPayment as any).additionalProperties;
      if (linkedProperties && Array.isArray(linkedProperties)) {
        propertyCount = linkedProperties.length + 1;
      } else if (linkedProperty) {
        propertyCount = 2;
      }
    }

    if (currentSubscription && currentSubscription.status === "غير نشط") {
      console.log(`[APPROVE] Found placeholder subscription, activating for: ${propertyNumber}`);
      // Update the placeholder subscription to active with correct package
      await firebaseService.activateSubscription(propertyNumber, {
        status: "نشط",
        subscriptionType,
        packageId,
        linkedProperty: linkedProperty || "",
        propertyCount,
        linkedProperties,
      });
      console.log(`[APPROVE] ✅ Subscription activated for property: ${propertyNumber}, package: ${packageId}, type: ${subscriptionType}, linkedProperty: ${linkedProperty}`);
    } else if (!currentSubscription) {
      console.log(`[APPROVE] No subscription found for: ${propertyNumber}, creating new one`);
      await firebaseService.activateSubscription(propertyNumber, {
        status: "نشط",
        subscriptionType,
        packageId,
        linkedProperty: linkedProperty || "",
        propertyCount,
        linkedProperties,
      });
      console.log(`[APPROVE] ✅ New subscription created and activated for: ${propertyNumber}, package: ${packageId}, type: ${subscriptionType}, linkedProperty: ${linkedProperty}`);
    } else {
      console.log(`[APPROVE] Subscription already active or not a placeholder: ${propertyNumber}, status: ${currentSubscription?.status}`);
    }

    // Also update the property's subscriptionType to match the package
    await firebaseService.updateProperty(propertyNumber, { 
      subscriptionType: subscriptionType as "عادي" | "مميز" | "موثوق" | "premium" | "trusted" | "normal" | "free" | "مجاني" | undefined
    });
    console.log(`[APPROVE] Property subscriptionType updated to: ${subscriptionType}`);

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

// ==========================
//   الموافقة على عقار إضافي (مضاف من مالك آخر)
// ==========================
router.put("/api/admin/properties/:propertyNumber/approve-additional", async (req, res) => {
  try {
    const { propertyNumber } = req.params;
    console.log(`[APPROVE_ADDITIONAL] Starting approval for additional property: ${propertyNumber}`);

    const property = await firebaseService.getPropertyByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ success: false, message: "العقار غير موجود" });
    }

    const mainPropertyNumber = property.pendingApprovalFrom;
    if (!mainPropertyNumber) {
      return res.status(400).json({ success: false, message: "هذا العقار ليس لديه طلب إضافة من عقار آخر" });
    }

    const mainProperty = await firebaseService.getPropertyByNumber(mainPropertyNumber);
    if (!mainProperty) {
      return res.status(404).json({ success: false, message: "العقار الرئيسي غير موجود" });
    }

    // Get the main property subscription to copy dates
    const mainSubscription = await subscriptionService.getByProperty(mainPropertyNumber);
    if (!mainSubscription) {
      return res.status(400).json({ success: false, message: "العقار الرئيسي ليس لديه اشتراك نشط" });
    }

    // Update additional property status
    await firebaseService.updateVerificationStatus(propertyNumber, "approved");
    await firebaseService.updateProperty(propertyNumber, {
      pendingApprovalFrom: undefined,
      subscriptionType: mainProperty.subscriptionType || "عادي"
    });

    // Create subscription for the additional property with same dates as main
    // Price is 0 since the main property already paid for all properties
    const subscriptionData = {
      packageId: mainSubscription.packageId,
      price: 0,
      subscriptionType: mainSubscription.subscriptionType || "عادي",
      packageType: mainSubscription.packageType || "عادي",
      startDate: mainSubscription.startDate,
      endDate: mainSubscription.endDate,
      linkedProperty: mainPropertyNumber,
      status: "نشط"
    };

    await firebaseService.addSubscriptionToSheet(
      propertyNumber,
      subscriptionData,
      property,
      ""
    );

    // Log the verification
    await analyticsService.addVerificationLog({
      propertyNumber,
      action: "approved",
      reason: "تمت الموافقة على إضافة العقار من قبل الأدمن",
      admin: "Admin",
    });

    // Send notification to additional property owner
    if (property.whatsappNumber) {
      notifyPropertyVerification({
        propertyNumber,
        propertyName: property.name || "",
        action: "قبول",
        admin: "Admin",
      }).catch(err => console.error("WhatsApp notify error:", err));
    }

    console.log(`[APPROVE_ADDITIONAL] Completed for property: ${propertyNumber}, linked to: ${mainPropertyNumber}`);
    res.json({
      success: true,
      message: "تمت الموافقة على إضافة العقار الإضافي",
      property: property,
      subscription: subscriptionData
    });

  } catch (err) {
    console.error("[APPROVE_ADDITIONAL] Error:", err);
    res.status(500).json({ success: false, message: "فشل في الموافقة على العقار الإضافي" });
  }
});

// ==========================
//   رفض عقار إضافي (مضاف من مالك آخر)
// ==========================
router.put("/api/admin/properties/:propertyNumber/reject-additional", async (req, res) => {
  try {
    const { propertyNumber } = req.params;
    const { reason } = req.body;
    console.log(`[REJECT_ADDITIONAL] Starting rejection for additional property: ${propertyNumber}, reason: ${reason}`);

    const property = await firebaseService.getPropertyByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ success: false, message: "العقار غير موجود" });
    }

    const mainPropertyNumber = property.pendingApprovalFrom;
    if (!mainPropertyNumber) {
      return res.status(400).json({ success: false, message: "هذا العقار ليس لديه طلب إضافة من عقار آخر" });
    }

    // Update additional property status - reset to no pending approval
    await firebaseService.updateProperty(propertyNumber, {
      pendingApprovalFrom: undefined
    });

    // Log the rejection
    await analyticsService.addVerificationLog({
      propertyNumber,
      action: "rejected",
      reason: reason || "تم رفض طلب إضافة العقار من قبل الأدمن",
      admin: "Admin",
    });

    // Send notification to additional property owner
    if (property.whatsappNumber) {
      notifyPropertyVerification({
        propertyNumber,
        propertyName: property.name || "",
        action: "رفض",
        reason: reason || "",
        admin: "Admin",
      }).catch(err => console.error("WhatsApp notify error:", err));
    }

    console.log(`[REJECT_ADDITIONAL] Completed for property: ${propertyNumber}`);
    res.json({
      success: true,
      message: "تم رفض طلب إضافة العقار الإضافي",
      property: property
    });

  } catch (err) {
    console.error("[REJECT_ADDITIONAL] Error:", err);
    res.status(500).json({ success: false, message: "فشل في رفض العقار الإضافي" });
  }
});

// ==========================
//   الحصول على قائمة الطلبات الإضافية المعلقة
// ==========================
router.get("/api/admin/additional-property-requests", async (req, res) => {
  try {
    const properties = await firebaseService.getProperties();
    const pendingRequests = properties.filter((p: any) => 
      p.pendingApprovalFrom && p.pendingApprovalFrom.length > 0
    );

    const requestsWithMain = await Promise.all(
      pendingRequests.map(async (p: any) => {
        const mainProperty = await firebaseService.getPropertyByNumber(p.pendingApprovalFrom);
        return {
          propertyNumber: p.propertyNumber,
          name: p.name,
          city: p.city,
          verificationStatus: p.verificationStatus,
          pendingApprovalFrom: p.pendingApprovalFrom,
          mainPropertyName: mainProperty?.name || p.pendingApprovalFrom,
          requestedAt: p.updatedAt || p.createdAt
        };
      })
    );

    res.json({
      success: true,
      requests: requestsWithMain
    });

  } catch (err) {
    console.error("[GET_ADDITIONAL_REQUESTS] Error:", err);
    res.status(500).json({ success: false, message: "فشل في جلب الطلبات" });
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

// Admin: Get subscription data for a property
router.get("/api/admin/property/:propertyNumber/subscription", async (req, res) => {
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

export default router;
