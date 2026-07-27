import { Router } from "express";
import { requireAdmin } from "../middleware";
import { propertyService, analyticsService, subscriptionService, paymentService } from "../../services";
import {
  firebaseService,
  LinkedPropertyMutationError,
} from "../../firebaseService";
import { googleDriveService } from "../../integrations/googleDrive";
import { SHEET_MAP, normalizePhoneNumber } from "../../utils/helpers";
import { notifyOwnerSubscriptionActivated, notifyPropertyVerification } from "../../integrations/whatsapp";
import { storage } from "../../storage";
import {
  activateVerifiedPaymentSubscription,
  calculateActionDates,
  resolvePaymentPropertyPlan,
} from "../../utils/paymentScenarioFlow";
import {
  getEffectiveSubscriptionType,
  getSubscriptionTypeLabel,
  isActivePremiumSubscription,
  isPremiumSubscriptionType,
} from "../../../shared/subscriptionType";
import { calculateRemainingDays } from "../../utils/dateUtils";
import { adminApprovalService } from "../../services/AdminApprovalService";
import {
  AdminApprovalError,
  PartialMutationError,
  runAdminApprovalStage,
  sendAdminApprovalError,
} from "../../errors/AdminApprovalError";

const router = Router();

const ACTIVE_LINKED_SUBSCRIPTION_STATUSES = new Set(["نشط", "ساري", "نشط مجاني", "active"]);

function isLinkedSubscriptionActive(status?: string | null): boolean {
  return ACTIVE_LINKED_SUBSCRIPTION_STATUSES.has(String(status || "").trim());
}

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
    
    // Fetch subscription status for each property
    const subscriptions = await firebaseService.getSubscriptions();
    const multiSubs = await firebaseService.getMultiPropertySubscriptions();
    
    // Build a map of propertyNumber -> linkedPropertyCount
    const linkedCountMap: Record<string, number> = {};
    // Source 1: Count via linkedProperty (additional property's subscription points to main)
    for (const sub of subscriptions) {
      if (sub.linkedProperty && isLinkedSubscriptionActive(sub.status)) {
        linkedCountMap[sub.linkedProperty] = (linkedCountMap[sub.linkedProperty] || 0) + 1;
      }
    }
    // Source 2: Override with linkedProperties array if larger (main property lists its children)
    for (const sub of subscriptions) {
      if (sub.linkedProperties && Array.isArray(sub.linkedProperties) && sub.linkedProperties.length > 0) {
        const existing = linkedCountMap[sub.propertyNumber] || 0;
        if (sub.linkedProperties.length > existing) {
          linkedCountMap[sub.propertyNumber] = sub.linkedProperties.length;
        }
      }
    }
    // Source 3: Override with multi_property_subscriptions count if larger
    for (const ms of multiSubs) {
      if (!isLinkedSubscriptionActive(ms.status)) continue;
      const propSet = new Set<string>([ms.propertyNumber1]);
      if (ms.propertyNumber2) propSet.add(ms.propertyNumber2);
      if (ms.additionalProperties) ms.additionalProperties.forEach((ap: string) => propSet.add(ap));
      const count = propSet.size - 1; // exclude main property
      if (count > (linkedCountMap[ms.propertyNumber1] || 0)) {
        linkedCountMap[ms.propertyNumber1] = count;
      }
    }
    
    const itemsWithSubscriptionStatus = items.map(property => {
      const sub = subscriptions.find(s => s.propertyNumber === property.propertyNumber);
      const isExpired = !sub || calculateRemainingDays(sub.endDate) < 0;
      const effectiveSubscriptionType = sub
        ? getEffectiveSubscriptionType({
            subscriptionType: sub.subscriptionType,
            packageType: sub.packageType,
            price: (sub as any).price,
          })
        : "عادي";
      const isPremiumActive = isActivePremiumSubscription({
        subscriptionType: effectiveSubscriptionType,
        status: sub?.status,
        isExpired,
      });
      return {
        ...property,
        subscriptionType: isPremiumActive ? "مميز" : "عادي",
        subscriptionStatus: sub?.status || null,
        isSubscriptionExpired: isExpired,
        isPremiumActive,
        linkedPropertyCount: linkedCountMap[property.propertyNumber] || 0
      };
    });
    
    res.json(itemsWithSubscriptionStatus);
  } catch (err) {
    console.error("Admin get properties error:", err);
    res.status(500).json({ error: "فشل في جلب العقارات" });
  }
});

// Admin: Get linked properties for a specific property
router.get("/api/admin/properties/:propertyNumber/linked-properties", async (req, res) => {
  try {
    const { propertyNumber } = req.params;
    const allProperties = await firebaseService.getProperties();
    const subscriptions = await firebaseService.getSubscriptions();
    const multiSubs = await firebaseService.getMultiPropertySubscriptions();
    
    const linkedPropertyNumbers = new Set<string>();
    
    // Source 1: Subscriptions where linkedProperty points to this property
    for (const sub of subscriptions) {
      if (sub.linkedProperty === propertyNumber && isLinkedSubscriptionActive(sub.status)) {
        linkedPropertyNumbers.add(sub.propertyNumber);
      }
    }
    
    // Source 2: Current property's subscription linkedProperties array
    const currentSub = subscriptions.find(s => s.propertyNumber === propertyNumber);
    if (currentSub?.linkedProperties) {
      for (const lp of currentSub.linkedProperties) {
        if (lp !== propertyNumber) linkedPropertyNumbers.add(lp);
      }
    }
    
    // Source 3: multi_property_subscriptions
    for (const ms of multiSubs) {
      if (!isLinkedSubscriptionActive(ms.status)) continue;
      const propSet = new Set<string>([ms.propertyNumber1]);
      if (ms.propertyNumber2) propSet.add(ms.propertyNumber2);
      if (ms.additionalProperties) ms.additionalProperties.forEach((ap: string) => propSet.add(ap));
      if (propSet.has(propertyNumber)) {
        for (const pn of propSet) {
          if (pn !== propertyNumber) linkedPropertyNumbers.add(pn);
        }
      }
    }
    
    const linkedProperties = Array.from(linkedPropertyNumbers).map(pn => {
      const prop = allProperties.find((p: any) => p.propertyNumber === pn);
      const sub = subscriptions.find(s => s.propertyNumber === pn);
      return {
        propertyNumber: pn,
        name: prop?.name || pn,
        city: prop?.city || '',
        direction: prop?.direction || '',
        type: prop?.type || '',
        whatsappNumber: prop?.whatsappNumber || '',
        location: prop?.location || '',
        facilities: prop?.facilities || [],
        prices: prop?.prices || null,
        subscriptionType: sub?.subscriptionType || prop?.subscriptionType || 'عادي',
        subscriptionStatus: sub?.status || null,
        startDate: sub?.startDate || null,
        endDate: sub?.endDate || null,
        packageId: sub?.packageId || null,
        verificationStatus: prop?.verificationStatus || null,
        createdAt: prop?.createdAt || null,
        updatedAt: prop?.updatedAt || null,
        mainPropertyNumber: propertyNumber
      };
    });
    
    res.json({ success: true, data: linkedProperties, count: linkedProperties.length });
  } catch (err) {
    console.error("[GET_LINKED_PROPERTIES_FOR] Error:", err);
    res.status(500).json({ success: false, message: "فشل في جلب العقارات المضافة" });
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
    console.log(`[ADMIN_PROPERTY_UPDATE] Raw body keys: ${Object.keys(body).join(", ")}`);
    for (const [key, value] of Object.entries(body)) {
      const mapped = SHEET_MAP[key];
      if (mapped) {
        updates[mapped] = value;
      } else {
        // Try direct key (includes 'pin', 'priceWeekday', etc.)
        updates[key] = value;
      }
    }
    console.log(
      `[ADMIN_PROPERTY_UPDATE] Processed update fields: ${Object.keys(updates).join(", ")}`,
    );

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

    // Validate and normalize phone number
    if (updates.whatsappNumber) {
      try {
        updates.whatsappNumber = normalizePhoneNumber(updates.whatsappNumber);
        console.log(`[ADMIN UPDATE] Phone normalized for property ${propertyNumber}`);
      } catch (err: any) {
        console.log(`[ADMIN UPDATE] Phone validation failed: ${err.message}`);
        return res.status(400).json({ error: err.message });
      }
    }

    if (updates.subscriptionType) {
      updates.subscriptionType = getSubscriptionTypeLabel(updates.subscriptionType);

      if (updates.subscriptionType === "مميز") {
        const subscription = await subscriptionService.getByProperty(propertyNumber);
        const isExpired = !subscription || calculateRemainingDays(subscription.endDate) < 0;
        const hasValidPremiumSubscription = isActivePremiumSubscription({
          subscriptionType: subscription?.subscriptionType,
          packageType: subscription?.packageType,
          status: subscription?.status,
          isExpired,
        });

        if (!hasValidPremiumSubscription) {
          return res.status(409).json({
            error: "لا يمكن جعل العقار مميزاً دون اشتراك مميز ساري. فعّل الاشتراك أو جدده أولاً.",
          });
        }
      }
    }

    // skipVerification=true because admin edits are intentional and should not
    // revert the property back to 'pending' (the old code had the same behaviour).
    const updated = await propertyService.update(propertyNumber, updates, { skipVerification: true });
    console.log(`[ADMIN UPDATE] property ${propertyNumber} updated fields: ${Object.keys(updates).join(", ")}`);

    // If subscriptionType was changed, also update the subscription document
    if (updates.subscriptionType) {
      console.log(`[ADMIN UPDATE] subscriptionType changed to: ${updates.subscriptionType}`);
      try {
        const subscription = await subscriptionService.getByProperty(propertyNumber);
        const normalizedSubscriptionType = getSubscriptionTypeLabel(updates.subscriptionType);
        const isPremium = isPremiumSubscriptionType(normalizedSubscriptionType);
        
        if (subscription) {
          const newStatus = isPremium ? "ساري" : "منتهي";
          const packageId = isPremium ? "pkg-premium-admin" : "pkg-free";
          
          await firebaseService.activateSubscription(propertyNumber, {
            subscriptionType: normalizedSubscriptionType,
            status: newStatus,
            packageId: packageId,
          });
          console.log(`[ADMIN UPDATE] Subscription updated for ${propertyNumber}: type=${normalizedSubscriptionType}, status=${newStatus}`);
        } else {
          console.log(`[ADMIN UPDATE] No subscription found for ${propertyNumber}, creating one`);
          const newStatus = isPremium ? "ساري" : "منتهي";
          const packageId = isPremium ? "pkg-premium-admin" : "pkg-free";
          
          await firebaseService.activateSubscription(propertyNumber, {
            subscriptionType: normalizedSubscriptionType,
            status: newStatus,
            packageId: packageId,
          });
        }
      } catch (subErr) {
        console.error(`[ADMIN UPDATE] Error updating subscription:`, subErr);
      }
    }

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

    console.log(`[ADMIN_PROPERTY_CREATE] Name length: ${body.name?.length || 0}`);

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

    // Validate and normalize phone number
    if (data.whatsappNumber) {
      try {
        data.whatsappNumber = normalizePhoneNumber(data.whatsappNumber);
        console.log("[ADMIN_PROPERTY_CREATE] Phone normalized");
      } catch (err: any) {
        console.log(`[ADMIN_PROPERTY_CREATE] Phone validation failed: ${err.message}`);
        return res.status(400).json({ error: err.message });
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

    // Validate the property and live R2 image count before any approval or
    // payment-fulfillment mutation. This also returns structured 404/422/503
    // errors for the admin UI.
    const { property: propertyForApproval } =
      await adminApprovalService.requireCompleteProperty(propertyNumber);

    // اعتماد العقار الجديد المدفوع يفعّل الاشتراك من بيانات الدفع المعلقة.
    let subscriptionType = "عادي";
    let updated = propertyForApproval;
    const payments = await runAdminApprovalStage(
      () => paymentService.getByProperty(propertyNumber),
      {
        status: 503,
        code: "PAYMENT_LOOKUP_FAILED",
        message:
          "تعذر تحميل الدفعات المرتبطة بالعقار حالياً. حدّث الصفحة ثم حاول مرة أخرى.",
      },
    );
    const pendingPayment = payments
      .filter(p => p.status === "نجح - قيد التحقق")
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];

    if (pendingPayment) {
      if (!pendingPayment.packageId) {
        throw new AdminApprovalError({
          status: 422,
          code: "PAYMENT_PACKAGE_MISSING",
          message:
            "لا توجد باقة مرتبطة بالدفع المعلق. حدّث بيانات الدفع قبل قبول العقار.",
        });
      }

      const pkg = await runAdminApprovalStage(
        () => subscriptionService.getPackageById(pendingPayment.packageId!),
        {
          status: 503,
          code: "PACKAGE_LOOKUP_FAILED",
          message:
            "تعذر تحميل الباقة المرتبطة بالدفع المعلق. حدّث الصفحة ثم حاول مرة أخرى.",
        },
      );
      if (!pkg) {
        throw new AdminApprovalError({
          status: 404,
          code: "PACKAGE_NOT_FOUND",
          message: "الباقة المرتبطة بالدفع المعلق غير موجودة أو حُذفت.",
        });
      }

      const currentSubscription = await runAdminApprovalStage(
        () => subscriptionService.getByProperty(propertyNumber),
        {
          status: 503,
          code: "SUBSCRIPTION_LOOKUP_FAILED",
          message:
            "تعذر تحميل حالة الاشتراك الحالية. حدّث الصفحة ثم حاول مرة أخرى.",
        },
      );
      const calculatedDates = await runAdminApprovalStage(
        () =>
          calculateActionDates(
            pendingPayment.action,
            currentSubscription,
            pkg.duration,
          ),
        {
          status: 500,
          code: "SUBSCRIPTION_PREPARATION_FAILED",
          message:
            "تعذر تجهيز مدة الاشتراك من بيانات الدفع والباقة. راجع الباقة وتواريخ الدفع قبل إعادة المحاولة.",
        },
      );
      const propertyPlan = await runAdminApprovalStage(
        () =>
          resolvePaymentPropertyPlan(
            pendingPayment,
            pkg,
            currentSubscription,
          ),
        {
          status: 503,
          code: "SUBSCRIPTION_PREPARATION_FAILED",
          message:
            "تعذر تحديد العقارات المرتبطة بهذا الدفع. حدّث الصفحة وراجع روابط العقارات قبل إعادة المحاولة.",
        },
      );
      await adminApprovalService.requireCompleteLinkedProperties(
        propertyPlan.kept,
      );
      const activation = await runAdminApprovalStage(
        () =>
          activateVerifiedPaymentSubscription({
            payment: pendingPayment,
            property: propertyForApproval,
            pkg,
            receiptUrl: pendingPayment.receiptUrl || "",
            startDate:
              pendingPayment.pendingStartDate || calculatedDates.startDate,
            endDate:
              pendingPayment.pendingEndDate || calculatedDates.endDate,
            finalAmount:
              pendingPayment.pendingPrice || pendingPayment.finalAmount,
            propertyPlan,
            allowedPaymentStatuses: [
              String(pendingPayment.status || ""),
            ],
          }),
        {
          status: 500,
          code: "PAYMENT_ACTIVATION_FAILED",
          message:
            "تعذر إكمال تفعيل الاشتراك. قد تكون بعض خطوات التفعيل حُفظت؛ حدّث الصفحة وتحقق من حالة العقار والدفع قبل إعادة المحاولة.",
        },
      );

      // Persist the authoritative approval state before finalizing the payment
      // record, so any later partial failure cannot leave acceptance ambiguous.
      updated = await runAdminApprovalStage(
        () =>
          firebaseService.updateVerificationStatus(propertyNumber, "approved"),
        {
          status: 500,
          code: "APPROVAL_PARTIALLY_COMPLETED",
          message:
            "تم تفعيل الاشتراك، لكن تعذر تأكيد حالة قبول العقار. حدّث الصفحة وراجع حالة العقار قبل تنفيذ أي محاولة أخرى.",
          partial: true,
        },
      );

      await runAdminApprovalStage(
        () =>
          paymentService.update(pendingPayment.id, {
            status: "مكتمل" as any,
            completedAt: new Date().toISOString(),
            notes: "تم تفعيل الاشتراك بعد اعتماد العقار من الإدارة",
          }),
        {
          status: 500,
          code: "APPROVAL_PARTIALLY_COMPLETED",
          message:
            "تم تفعيل الاشتراك وقبول العقار، لكن تعذر إنهاء حالة الدفع. حدّث الصفحة وراجع الدفع قبل تنفيذ أي محاولة أخرى.",
          partial: true,
        },
      );

      subscriptionType = activation.subscriptionType;
      console.log(`[APPROVE] ✅ Activated pending payment ${pendingPayment.id}. Linked: ${activation.linkedProperties.join(", ") || "none"}`);

      if (propertyForApproval.whatsappNumber) {
        notifyOwnerSubscriptionActivated({
          ownerPhone: propertyForApproval.whatsappNumber,
          propertyNumber,
          propertyName: propertyForApproval.name || "",
          endDate: activation.endDate,
        }).catch(err => console.error("Owner activation notify error:", err));
      }
    }

    // Properties without a pending paid activation still need the explicit
    // approval write here.
    if (!pendingPayment) {
      updated = await runAdminApprovalStage(
        () =>
          firebaseService.updateVerificationStatus(propertyNumber, "approved"),
        {
          status: 500,
          code: "VERIFICATION_UPDATE_FAILED",
          message:
            "اكتملت مراجعة البيانات، لكن تعذر حفظ قبول العقار. حدّث الصفحة ثم حاول مرة أخرى.",
        },
      );
    }
    console.log(`[APPROVE] Verification status updated to approved for: ${propertyNumber}`);

    await analyticsService.addVerificationLog({
      propertyNumber,
      action: "approved",
    }).catch((error) =>
      console.error("[APPROVE] Failed to add verification log:", error),
    );

    // Determine subscription type from existing subscription or payment.
    const currentSubscription = await runAdminApprovalStage(
      () => subscriptionService.getByProperty(propertyNumber),
      {
        status: 500,
        code: "APPROVAL_PARTIALLY_COMPLETED",
        message:
          "تم قبول العقار، لكن تعذر مزامنة نوع الاشتراك. حدّث الصفحة وراجع حالة الاشتراك قبل أي محاولة أخرى.",
        partial: true,
      },
    );
    if (currentSubscription?.subscriptionType) {
      subscriptionType = currentSubscription.subscriptionType;
    }

    // Approval never grants premium by itself; only a valid premium subscription does.
    const effectiveSubscription = currentSubscription;
    const effectiveSubscriptionExpired = !effectiveSubscription || calculateRemainingDays(effectiveSubscription.endDate) < 0;
    subscriptionType = isActivePremiumSubscription({
      subscriptionType: effectiveSubscription?.subscriptionType,
      packageType: effectiveSubscription?.packageType,
      status: effectiveSubscription?.status,
      isExpired: effectiveSubscriptionExpired,
    }) ? "مميز" : "عادي";

    // Update the property's subscriptionType to match the valid subscription state.
    await runAdminApprovalStage(
      () =>
        firebaseService.updateProperty(propertyNumber, {
          subscriptionType: subscriptionType as "عادي" | "مميز" | "premium" | "trusted" | "normal" | "free" | "مجاني" | undefined,
        }),
      {
        status: 500,
        code: "APPROVAL_PARTIALLY_COMPLETED",
        message:
          "تم قبول العقار، لكن تعذر حفظ نوع الاشتراك النهائي. حدّث الصفحة وراجع العقار قبل أي محاولة أخرى.",
        partial: true,
      },
    );
    console.log(`[APPROVE] Property subscriptionType updated to: ${subscriptionType}`);

    // إرسال إشعار واتساب عند قبول العقار
    const property = await propertyService
      .getByNumber(propertyNumber)
      .catch((error) => {
        console.error("[APPROVE] Failed to load property for notification:", error);
        return propertyForApproval;
      });
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

  } catch (err: unknown) {
    console.error("[APPROVE] Error:", err);
    return sendAdminApprovalError(
      res,
      err,
      "تعذر قبول العقار حالياً. حاول مرة أخرى.",
    );
  }
});

router.put("/api/admin/properties/:propertyNumber/reject", async (req, res) => {
  try {
    const { propertyNumber } = req.params;
    const { reason } = req.body;
    console.log(`[REJECT] Starting rejection for property: ${propertyNumber}, reason: ${reason}`);

    const property = await runAdminApprovalStage(
      () => propertyService.getByNumber(propertyNumber),
      {
        status: 503,
        code: "PROPERTY_LOOKUP_FAILED",
        message:
          "تعذر تحميل بيانات العقار قبل الرفض. تحقق من الاتصال بقاعدة البيانات ثم حاول مرة أخرى.",
      },
    );
    if (!property) {
      throw new AdminApprovalError({
        status: 404,
        code: "PROPERTY_NOT_FOUND",
        message: "العقار المطلوب رفضه غير موجود.",
      });
    }

    // تحديث الحالة في الشيت
    const updated = await runAdminApprovalStage(
      async () => {
        try {
          return await firebaseService.updateVerificationStatus(
            propertyNumber,
            "rejected",
          );
        } catch (error) {
          throw new PartialMutationError(error);
        }
      },
      {
        status: 500,
        code: "PROPERTY_REJECTION_FAILED",
        message:
          "تعذر تأكيد حفظ رفض العقار. حدّث الصفحة وتحقق من حالته قبل إعادة المحاولة.",
      },
    );
    console.log(`[REJECT] Verification status updated to rejected for: ${propertyNumber}`);

    // تسجيل العملية داخل storage
    await analyticsService
      .addVerificationLog({
        propertyNumber,
        action: "rejected",
        reason: reason || "",
        admin: "Admin",
      })
      .catch((error) =>
        console.error("[REJECT] Failed to add verification log:", error),
      );

    // الرفض لا يؤثر على الاشتراك - الاشتراك يبقى ساري من يوم الدفع
    // الرفض يؤثر فقط على ظهور العقار في صفحات العقارات
    console.log(`[REJECT] Property rejected but subscription remains active for: ${propertyNumber}`);

    // إرسال إشعار واتساب عند رفض العقار
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

  } catch (err: unknown) {
    console.error("Reject Error:", err);
    return sendAdminApprovalError(
      res,
      err,
      "تعذر رفض العقار حالياً. حاول مرة أخرى.",
    );
  }
});

// ==========================
//   الموافقة على عقار إضافي (مضاف من مالك آخر)
// ==========================
router.put("/api/admin/properties/:propertyNumber/approve-additional", async (req, res) => {
  try {
    const { propertyNumber } = req.params;

    // Resolve and validate the complete linked pair before the first write.
    // requireCompleteProperty uses the live R2 count, so an unavailable image
    // store is never mistaken for a property with zero images.
    const { property } =
      await adminApprovalService.requireCompleteProperty(propertyNumber);

    const mainPropertyNumber = String(property.pendingApprovalFrom || "").trim();
    if (!mainPropertyNumber) {
      throw new AdminApprovalError({
        status: 409,
        code: "PROPERTY_VALIDATION_FAILED",
        message: "لا يوجد طلب إضافة معلّق لهذا العقار، وقد تكون حالته تغيّرت بالفعل.",
      });
    }

    const { property: mainProperty } =
      await adminApprovalService.requireCompleteProperty(mainPropertyNumber);

    // Preload the subscription that will be copied and mutated. No database
    // read is deferred until after approval writes have started.
    const mainSubscription = await runAdminApprovalStage(
      () => subscriptionService.getByProperty(mainPropertyNumber),
      {
        status: 503,
        code: "SUBSCRIPTION_LOOKUP_FAILED",
        message:
          "تعذر تحميل اشتراك العقار الرئيسي حالياً. حدّث الصفحة ثم حاول مرة أخرى.",
      },
    );
    if (!mainSubscription) {
      throw new AdminApprovalError({
        status: 422,
        code: "SUBSCRIPTION_LOOKUP_FAILED",
        message: "لا يمكن قبول العقار الإضافي لأن العقار الرئيسي ليس لديه اشتراك.",
      });
    }

    const mutation = await firebaseService.mutateLinkedPropertyGroupAtomically({
      mainPropertyNumber,
      addPropertyNumbers: [propertyNumber],
      approveAddedProperties: true,
    });

    await analyticsService
      .addVerificationLog({
        propertyNumber,
        action: "approved",
        reason: "تمت الموافقة على إضافة العقار من قبل الأدمن",
        admin: "Admin",
      })
      .catch((error) =>
        console.error(
          "[APPROVE_ADDITIONAL] Failed to add verification log:",
          error,
        ),
      );

    if (property.whatsappNumber) {
      notifyPropertyVerification({
        propertyNumber,
        propertyName: property.name || "",
        action: "قبول",
        admin: "Admin",
      }).catch(err => console.error("WhatsApp notify error:", err));
    }

    res.json({
      success: true,
      message: "تمت الموافقة على إضافة العقار الإضافي",
      property: {
        ...property,
        verificationStatus: "approved",
        pendingApprovalFrom: "",
        subscriptionType: mainProperty.subscriptionType || "عادي",
      },
      subscription: mutation.mainSubscription,
    });

  } catch (err: unknown) {
    console.error("[APPROVE_ADDITIONAL] Error:", err);
    if (err instanceof LinkedPropertyMutationError) {
      return res.status(err.status).json({
        success: false,
        code: err.code,
        message: err.message,
        error: err.message,
      });
    }
    return sendAdminApprovalError(
      res,
      err,
      "تعذر قبول العقار الإضافي حالياً. حاول مرة أخرى.",
    );
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
      pendingApprovalFrom: ""
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
//   الحصول على قائمة الطلبات الإضافية المعلقة + العقارات المرتبطة
// ==========================
router.get("/api/admin/additional-property-requests", async (req, res) => {
  try {
    const properties = await firebaseService.getProperties();
    const subscriptions = await firebaseService.getSubscriptions();
    
    // Properties pending approval
    const pendingRequests = properties.filter((p: any) => 
      p.pendingApprovalFrom && p.pendingApprovalFrom.length > 0
    );

    const requestsWithMain = await Promise.all(
      pendingRequests.map(async (p: any) => {
        const mainProperty = await firebaseService.getPropertyByNumber(p.pendingApprovalFrom);
        return {
          type: 'pending',
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

    // Get all linked properties (properties that have linkedProperty set)
    const linkedProperties = subscriptions.filter((s: any) => 
      s.linkedProperty && isLinkedSubscriptionActive(s.status)
    );

    const linkedRequests = await Promise.all(
      linkedProperties.map(async (s: any) => {
        const mainProperty = await firebaseService.getPropertyByNumber(s.linkedProperty);
        const additionalProperty = await firebaseService.getPropertyByNumber(s.propertyNumber);
        return {
          type: 'linked',
          propertyNumber: s.propertyNumber,
          name: additionalProperty?.name || s.propertyNumber,
          city: additionalProperty?.city,
          linkedTo: s.linkedProperty,
          mainPropertyName: mainProperty?.name || s.linkedProperty,
          status: s.status,
          endDate: s.endDate
        };
      })
    );

    // Get main properties (properties that have linkedProperties array)
    const mainProperties = subscriptions.filter((s: any) => 
      s.linkedProperties && s.linkedProperties.length > 0
    );

    const mainRequests = await Promise.all(
      mainProperties.map(async (s: any) => {
        const mainProperty = await firebaseService.getPropertyByNumber(s.propertyNumber);
        const linkedPropsDetails = await Promise.all(
          s.linkedProperties.map(async (propNum: string) => {
            const prop = await firebaseService.getPropertyByNumber(propNum);
            return {
              propertyNumber: propNum,
              name: prop?.name || propNum,
              city: prop?.city
            };
          })
        );
        return {
          type: 'main',
          propertyNumber: s.propertyNumber,
          name: mainProperty?.name || s.propertyNumber,
          city: mainProperty?.city,
          linkedProperties: s.linkedProperties,
          linkedPropertiesDetails: linkedPropsDetails,
          propertyCount: s.propertyCount,
          status: s.status,
          endDate: s.endDate
        };
      })
    );

    res.json({
      success: true,
      pendingRequests: requestsWithMain,
      linkedProperties: linkedRequests,
      mainProperties: mainRequests
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
