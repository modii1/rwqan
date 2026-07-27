import { Router } from "express";
import { requireAdmin } from "../middleware";
import {
  SubscriptionLifecycleError,
  subscriptionService,
  propertyService,
} from "../../services";
import {
  firebaseService,
  LinkedPropertyMutationError,
} from "../../firebaseService";
import { subscriptionIdentifierSchema } from "../../validation";
import {
  getSubscriptionTypeLabel,
  isActivePremiumSubscription,
  isPremiumSubscriptionType,
  isSubscriptionStatusActive,
  isSubscriptionStatusSuspended,
} from "../../../shared/subscriptionType";
import {
  MAX_SUBSCRIPTION_DAYS,
  calculateRemainingDays as calculateServerRemainingDays,
  calculateSubscriptionEndDate,
  getMaxSubscriptionEndDate,
  isSubscriptionEndDateWithinMaxDays,
} from "../../utils/dateUtils";
import {
  SUSPENDED_SUBSCRIPTION_STATUS,
  calculateFrozenRemainingDays,
} from "../../services/subscriptionLifecycle";
import { isPropertySuspended } from "../../services/propertySuspension";

const router = Router();

// All admin subscription routes require admin authentication
router.use("/api/admin", requireAdmin);

type AdminSubscriptionStatus =
  | "ساري"
  | "منتهي"
  | "قريب الانتهاء"
  | "نشط مجاني"
  | "موقوف مؤقتاً";

type StoredSubscriptionStatus = "ساري" | "منتهي" | "نشط مجاني";

function parseStoredSubscriptionStatus(status: unknown): StoredSubscriptionStatus | null {
  const value = String(status || "").trim();
  if (value === "قريب الانتهاء") return "ساري";
  if (value === "ساري" || value === "منتهي" || value === "نشط مجاني") return value;
  return null;
}

function isValidDateInput(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  const date = new Date(String(value));
  return !Number.isNaN(date.getTime());
}

function getSubscriptionDateValidationError(
  startDate: unknown,
  endDate: unknown,
  referenceDate: Date = new Date(),
): string | null {
  const normalizedEndDate = String(endDate || "").trim();
  if (!normalizedEndDate) return null;

  if (!isSubscriptionEndDateWithinMaxDays(normalizedEndDate, referenceDate)) {
    const maxEndDate = getMaxSubscriptionEndDate(referenceDate).toLocaleDateString("en-CA", {
      timeZone: "Asia/Riyadh",
    });
    return `تاريخ انتهاء الاشتراك لا يمكن أن يتجاوز ${MAX_SUBSCRIPTION_DAYS} يوماً من اليوم (الحد الأقصى ${maxEndDate}).`;
  }

  const normalizedStartDate = String(startDate || "").trim();
  if (normalizedStartDate) {
    const parsedStartDate = new Date(normalizedStartDate);
    const parsedEndDate = new Date(normalizedEndDate);
    if (parsedEndDate.getTime() < parsedStartDate.getTime()) {
      return "تاريخ انتهاء الاشتراك يجب أن يكون بعد تاريخ البداية أو مساوياً له.";
    }
  }

  return null;
}

function subscriptionDocId(subscription: any): string {
  return subscription?.id || `SUB-${subscription.propertyNumber}`;
}

function lifecycleErrorStatus(error: SubscriptionLifecycleError): number {
  if (error.code === "NOT_FOUND") return 404;
  if (
    error.code === "INVALID_END_DATE" ||
    error.code === "INVALID_SUSPENSION_STATE"
  ) {
    return 400;
  }
  return 409;
}

// ======================
// 🏠🏠 اشتراكات العقارين
// ======================
router.get("/api/admin/multi-property-subscriptions", async (req, res) => {
  try {
    const subs = await firebaseService.getMultiPropertySubscriptions();
    res.json(subs);
  } catch (error) {
    console.error("Error fetching multi-property subscriptions:", error);
    res.status(500).json({ error: "فشل في جلب اشتراكات العقارين" });
  }
});

router.post("/api/multi-property-subscription", requireAdmin, async (req, res) => {
  try {
    const { packageId, propertyNumber1, propertyNumber2 } = req.body;

    // التحقق من وجود العقارين
    const prop1 = await propertyService.getByNumber(propertyNumber1);
    const prop2 = await propertyService.getByNumber(propertyNumber2);

    if (!prop1 || !prop2) {
      return res.status(400).json({
        error: "أحد العقارين غير موجود",
        missing: !prop1 ? propertyNumber1 : propertyNumber2
      });
    }

    // جلب الباقة
    const pkg = await subscriptionService.getPurchasablePackageById(packageId);
    if (!pkg) {
      return res.status(400).json({ error: "الباقة غير موجودة" });
    }

    const sub = await firebaseService.mutateLinkedPropertyGroupAtomically({
      mainPropertyNumber: propertyNumber1,
      addPropertyNumbers: [propertyNumber2],
      approveAddedProperties: true,
    });

    res.json({ success: true, subscription: sub });
  } catch (error) {
    console.error("Error creating multi-property subscription:", error);
    if (error instanceof LinkedPropertyMutationError) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code,
      });
    }
    res.status(500).json({ error: "فشل في إنشاء اشتراك العقارين" });
  }
});

// ======================
// 📋 إدارة الاشتراكات
// ======================
router.get("/api/admin/subscriptions", async (req, res) => {
  try {
    const subscriptions = await subscriptionService.getAll();
    const packages = await subscriptionService.getPackages();
    const properties = await propertyService.getAll();

    // تحويل الاشتراكات لتضمين معلومات إضافية
    const enrichedSubscriptions = subscriptions.map(sub => {
      const property = properties.find(p => p.propertyNumber === sub.propertyNumber);
      const pkg = packages.find(p => p.id === sub.packageId);

      // حساب الأيام المتبقية - الاشتراك يبقى فعال طوال يوم الانتهاء
      let remainingDays: number | null = null;
      let status: AdminSubscriptionStatus = "ساري";

      // قراءة البيانات من الاشتراك مباشرة
      const subWithType = sub as any;

      // إذا تم إلغاء الاشتراك يدوياً → منتهي مباشرة
      // لكن إذا تم إعادة تفعيله بعد الإلغاء (startDate > cancelledAt) فلا يُعتبر منتهي
      const wasCancelled = !!(subWithType as any).cancelledAt;
      const wasReactivated = wasCancelled && sub.startDate && 
        new Date(sub.startDate) > new Date((subWithType as any).cancelledAt);
      
      if (isSubscriptionStatusSuspended(sub.status)) {
        status = SUSPENDED_SUBSCRIPTION_STATUS;
        remainingDays = calculateFrozenRemainingDays(Number(subWithType.remainingDurationMs));
      }
      else if (sub.status === "منتهي" || (wasCancelled && !wasReactivated)) {
        status = "منتهي";
        remainingDays = -1;
      }
      // إذا لم يكن هناك تاريخ انتهاء = نشط مجاني (free)
      else if (sub.status === "نشط مجاني" || !sub.endDate || sub.endDate.trim() === "") {
        status = "نشط مجاني";
        remainingDays = null;
      } else {
        remainingDays = calculateServerRemainingDays(sub.endDate);

        // الاشتراك منتهي فقط إذا كان تاريخ الانتهاء قبل اليوم (سالب)
        if (remainingDays < 0) {
          status = "منتهي";
        } else if (remainingDays <= 7) {
          // اليوم الأخير (0) أو باقي 7 أيام أو أقل ← ينتهي قريباً
          status = "قريب الانتهاء";
        }
      }

      // نوع الاشتراك من الشيت مباشرة (العمود 4)
      const displayType = subWithType.subscriptionType || "عادي";

      // اسم العقار من الشيت مباشرة (العمود 1) أو من جدول العقارات
      const propertyName = subWithType.propertyName || property?.name || "غير معروف";

      return {
        id: sub.id || `${sub.propertyNumber}-${sub.packageId}`,
        propertyNumber: sub.propertyNumber,
        name: propertyName,
        subscriptionType: displayType,
        price: subWithType.price || 0,
        startDate: sub.startDate,
        endDate: sub.endDate,
        remainingDays,
        status,
        suspendedAt: subWithType.suspendedAt || null,
        remainingDurationMs: subWithType.remainingDurationMs ?? null,
        // Linked-group awareness for the admin dashboard
        linkedProperty: subWithType.linkedProperty || null,
        linkedProperties: subWithType.linkedProperties || [],
        propertyCount: subWithType.propertyCount || 1,
        isLinkedChild: !!subWithType.linkedProperty,
        linkedGroupName: subWithType.linkedProperty
          ? (properties.find(p => p.propertyNumber === subWithType.linkedProperty)?.name || subWithType.linkedProperty)
          : null,
      };
    });

    res.json(enrichedSubscriptions);
  } catch (error) {
    console.error("Error fetching subscriptions:", error);
    res.status(500).json({ error: "فشل في جلب الاشتراكات" });
  }
});

router.post("/api/admin/subscriptions/:id/suspend", async (req, res) => {
  const identifier = subscriptionIdentifierSchema.safeParse(req.params.id);
  if (!identifier.success) {
    return res.status(400).json({ error: identifier.error.issues[0]?.message });
  }

  try {
    const result = await subscriptionService.suspend(identifier.data);
    return res.json({
      success: true,
      message: "تم إيقاف الاشتراك مؤقتاً مع حفظ المدة المتبقية.",
      ...result,
    });
  } catch (error) {
    if (error instanceof SubscriptionLifecycleError) {
      return res.status(lifecycleErrorStatus(error)).json({
        success: false,
        code: error.code,
        error: error.message,
      });
    }
    console.error("Error suspending subscription:", error);
    return res.status(500).json({ error: "فشل إيقاف الاشتراك مؤقتاً." });
  }
});

router.post("/api/admin/subscriptions/:id/resume", async (req, res) => {
  const identifier = subscriptionIdentifierSchema.safeParse(req.params.id);
  if (!identifier.success) {
    return res.status(400).json({ error: identifier.error.issues[0]?.message });
  }

  try {
    const result = await subscriptionService.resume(identifier.data);
    return res.json({
      success: true,
      message: "تم استئناف الاشتراك من المدة المتبقية.",
      ...result,
    });
  } catch (error) {
    if (error instanceof SubscriptionLifecycleError) {
      return res.status(lifecycleErrorStatus(error)).json({
        success: false,
        code: error.code,
        error: error.message,
      });
    }
    console.error("Error resuming subscription:", error);
    return res.status(500).json({ error: "فشل استئناف الاشتراك." });
  }
});

// تعديل الاشتراك يدوياً من لوحة الأدمن
router.put("/api/admin/subscriptions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { subscriptionType, status, startDate, endDate, price } = req.body || {};

    if (!id) {
      return res.status(400).json({
        error: "معرّف الاشتراك أو رقم العقار مطلوب.",
        nextAction: "افتح الاشتراك من لوحة الأدمن ثم حاول مرة أخرى.",
        nextUrl: "/admin",
        actionLabel: "العودة للوحة الأدمن",
      });
    }

    if (!isValidDateInput(startDate) || !isValidDateInput(endDate)) {
      return res.status(400).json({
        error: "صيغة التاريخ غير صحيحة.",
        nextAction: "استخدم صيغة تاريخ صحيحة من حقول بداية ونهاية الاشتراك.",
        nextUrl: "/admin",
        actionLabel: "تعديل التواريخ",
      });
    }

    const allSubscriptions = await firebaseService.getSubscriptions();
    const currentSubscription = allSubscriptions.find((sub: any) =>
      sub.id === id || sub.propertyNumber === id || `SUB-${sub.propertyNumber}` === id
    ) as any;

    if (!currentSubscription) {
      return res.status(404).json({
        error: "لم يتم العثور على الاشتراك المطلوب.",
        nextAction: "تأكد من رقم العقار أو حدّث قائمة الاشتراكات ثم حاول مرة أخرى.",
        nextUrl: "/admin",
        actionLabel: "تحديث الاشتراكات",
      });
    }

    const requestedStartDate = startDate !== undefined
      ? startDate
      : currentSubscription.startDate;
    const requestedEndDate = endDate !== undefined
      ? endDate
      : currentSubscription.endDate;
    const dateValidationError = getSubscriptionDateValidationError(
      requestedStartDate,
      requestedEndDate,
    );
    if (dateValidationError) {
      return res.status(400).json({
        error: dateValidationError,
        nextAction: `اختر تاريخ انتهاء لا يتجاوز ${MAX_SUBSCRIPTION_DAYS} يوماً من اليوم.`,
        actionLabel: "تعديل تاريخ الانتهاء",
      });
    }

    if (isSubscriptionStatusSuspended(currentSubscription.status)) {
      return res.status(409).json({
        error: "استأنف الاشتراك قبل تعديل بياناته حتى لا تضيع المدة المحفوظة.",
        nextAction: "استخدم زر استئناف الاشتراك أولاً.",
      });
    }

    const normalizedType = getSubscriptionTypeLabel(subscriptionType || currentSubscription.subscriptionType || currentSubscription.packageType);
    const storedStatus = status !== undefined
      ? parseStoredSubscriptionStatus(status)
      : parseStoredSubscriptionStatus(currentSubscription.status) || "ساري";

    if (!storedStatus) {
      return res.status(400).json({
        error: "حالة الاشتراك غير صحيحة.",
        nextAction: "اختر حالة اشتراك صحيحة: ساري، منتهي، أو نشط مجاني.",
        nextUrl: "/admin",
        actionLabel: "تعديل الحالة",
      });
    }

    const parsedPrice = price === undefined || price === null || price === "" ? undefined : Number(price);
    if (parsedPrice !== undefined && !Number.isFinite(parsedPrice)) {
      return res.status(400).json({
        error: "السعر المدخل غير صحيح.",
        nextAction: "أدخل السعر كرقم فقط أو اتركه فارغاً.",
        nextUrl: "/admin",
        actionLabel: "تعديل السعر",
      });
    }

    const baseUpdates: any = {
      subscriptionType: normalizedType,
      packageType: normalizedType,
      status: storedStatus,
    };
    if (startDate !== undefined) baseUpdates.startDate = String(startDate || "");
    if (endDate !== undefined) baseUpdates.endDate = String(endDate || "");
    if (parsedPrice !== undefined) baseUpdates.price = parsedPrice;

    const effectiveEndDate = String(baseUpdates.endDate ?? currentSubscription.endDate ?? "");
    const isExpiredByDate = calculateServerRemainingDays(effectiveEndDate) < 0;
    const isPremiumActive = isActivePremiumSubscription({
      subscriptionType: normalizedType,
      status: storedStatus,
      isExpired: isExpiredByDate,
    });

    if (normalizedType === "مميز" && storedStatus === "ساري" && !isPremiumActive) {
      return res.status(400).json({
        error: "الاشتراك المميز الساري يحتاج إلى تاريخ نهاية صالح وغير منتهٍ.",
        nextAction: "حدّث تاريخ النهاية أو اختر حالة منتهي.",
      });
    }

    if (storedStatus === "ساري" || storedStatus === "نشط مجاني") {
      baseUpdates.cancelledAt = null;
      baseUpdates.cancelReason = null;
    }

    const mainPropertyNumber = currentSubscription.linkedProperty || currentSubscription.propertyNumber;
    const mainSubscription = allSubscriptions.find((sub: any) => sub.propertyNumber === mainPropertyNumber) || currentSubscription;
    const targetPropertyNumbers = new Set<string>([mainPropertyNumber, currentSubscription.propertyNumber]);

    if (Array.isArray(mainSubscription.linkedProperties)) {
      for (const linked of mainSubscription.linkedProperties) {
        if (linked) targetPropertyNumbers.add(String(linked));
      }
    }
    if (Array.isArray(currentSubscription.linkedProperties)) {
      for (const linked of currentSubscription.linkedProperties) {
        if (linked) targetPropertyNumbers.add(String(linked));
      }
    }

    const updatedSubscriptions: string[] = [];
    const skippedSubscriptions: string[] = [];
    const groupSize = targetPropertyNumbers.size;

    for (const propertyNumber of targetPropertyNumbers) {
      const targetSub = allSubscriptions.find((sub: any) => sub.propertyNumber === propertyNumber) as any;
      const targetProperty = await propertyService.getByNumber(propertyNumber);
      const updateForTarget: any = { ...baseUpdates };

      if (propertyNumber === mainPropertyNumber) {
        const linkedProperties = Array.from(targetPropertyNumbers).filter((pn) => pn !== mainPropertyNumber);
        if (linkedProperties.length > 0) {
          updateForTarget.linkedProperties = linkedProperties;
          updateForTarget.propertyCount = groupSize;
        }
      } else {
        updateForTarget.linkedProperty = mainPropertyNumber;
        updateForTarget.linkedProperties = null;
        updateForTarget.propertyCount = 1;
      }

      if (targetSub) {
        await firebaseService.updateSubscription(subscriptionDocId(targetSub), updateForTarget);
      } else if (targetProperty && updateForTarget.startDate !== "") {
        await firebaseService.createSubscription({
          propertyNumber,
          packageId: currentSubscription.packageId || "manual",
          paymentId: currentSubscription.paymentId || "",
          linkedProperty: propertyNumber === mainPropertyNumber ? undefined : mainPropertyNumber,
          linkedProperties: propertyNumber === mainPropertyNumber
            ? Array.from(targetPropertyNumbers).filter((pn) => pn !== mainPropertyNumber)
            : undefined,
          propertyCount: propertyNumber === mainPropertyNumber ? groupSize : 1,
          startDate: updateForTarget.startDate || currentSubscription.startDate || new Date().toISOString(),
          endDate: updateForTarget.endDate || currentSubscription.endDate || "",
          status: storedStatus as any,
          subscriptionType: normalizedType,
          packageType: normalizedType,
        } as any);
      } else {
        skippedSubscriptions.push(propertyNumber);
        continue;
      }

      if (targetProperty) {
        const propertyUpdates: any = {
          subscriptionType: isPremiumActive ? "مميز" : "عادي",
        };
        const effectiveStartDate = updateForTarget.startDate ?? targetSub?.startDate ?? currentSubscription.startDate;
        if (effectiveStartDate) {
          propertyUpdates.subscriptionDate = String(effectiveStartDate).split("T")[0];
        }
        if (propertyNumber !== mainPropertyNumber) {
          propertyUpdates.linkedProperty = mainPropertyNumber;
          propertyUpdates.pendingApprovalFrom = undefined;
        }
        await firebaseService.updateProperty(propertyNumber, propertyUpdates);
      }

      updatedSubscriptions.push(propertyNumber);
    }

    res.json({
      success: true,
      message: updatedSubscriptions.length > 1
        ? `تم تحديث الاشتراك المشترك لـ ${updatedSubscriptions.length} عقارات بنجاح`
        : "تم تحديث الاشتراك بنجاح",
      updatedProperties: updatedSubscriptions,
      skippedProperties: skippedSubscriptions,
      subscription: {
        ...currentSubscription,
        ...baseUpdates,
      },
    });
  } catch (error) {
    console.error("Error updating subscription manually:", error);
    res.status(500).json({
      error: "فشل تحديث الاشتراك يدوياً.",
      nextAction: "راجع القيم المدخلة ثم حاول مرة أخرى. إذا استمرت المشكلة، حدّث الصفحة وتأكد من وجود الاشتراك.",
      nextUrl: "/admin",
      actionLabel: "العودة للاشتراكات",
    });
  }
});

// إلغاء الاشتراك
router.post("/api/admin/subscription/cancel", async (req, res) => {
  try {
    const { propertyNumber, reason } = req.body;

    if (!propertyNumber) {
      return res.status(400).json({ error: "رقم العقار مطلوب" });
    }

    // تحديث الاشتراك في Google Sheets
    await subscriptionService.cancel(propertyNumber, reason);

    res.json({ success: true, message: "تم إلغاء الاشتراك بنجاح" });
  } catch (error) {
    console.error("Error canceling subscription:", error);
    res.status(500).json({ error: "فشل في إلغاء الاشتراك" });
  }
});

// تفعيل اشتراك يدوي (للأدمن)
router.post("/api/admin/subscription/manual-activate", async (req, res) => {
  try {
    const { propertyNumber, packageId, startDate, endDate, linkedProperty, paymentId } = req.body;

    if (!propertyNumber || !packageId || !startDate || !endDate) {
      return res.status(400).json({ error: "propertyNumber, packageId, startDate, endDate مطلوبين" });
    }

    if (await isPropertySuspended(propertyNumber)) {
      return res.status(423).json({
        success: false,
        code: "PROPERTY_SUSPENDED",
        error:
          "الاشتراك موقوف مؤقتاً من الإدارة. استأنف الاشتراك أولاً قبل التفعيل اليدوي.",
      });
    }
    if (linkedProperty && await isPropertySuspended(linkedProperty)) {
      return res.status(423).json({
        success: false,
        code: "PROPERTY_SUSPENDED",
        error:
          "اشتراك العقار المرتبط موقوف مؤقتاً من الإدارة ولا يمكن تفعيله ضمن هذه المجموعة.",
      });
    }

    if (!isValidDateInput(startDate) || !isValidDateInput(endDate)) {
      return res.status(400).json({ error: "صيغة التاريخ غير صحيحة." });
    }
    const dateValidationError = getSubscriptionDateValidationError(startDate, endDate);
    if (dateValidationError) {
      return res.status(400).json({ error: dateValidationError });
    }

    const property = await propertyService.getByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    const pkg = await subscriptionService.getPurchasablePackageById(packageId);
    if (!pkg) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    const isPremium = isPremiumSubscriptionType(pkg.type) || pkg.price > 0;

    // Resolve and validate the complete linked group before the first write.
    // Otherwise a suspended child discovered after activating the main property
    // would leave a partially activated group.
    const linkedPropsToSync: string[] = [];
    const addLinkedProperty = (candidate: unknown) => {
      const normalized = String(candidate || "").trim();
      if (
        normalized &&
        normalized !== String(propertyNumber).trim() &&
        !linkedPropsToSync.includes(normalized)
      ) {
        linkedPropsToSync.push(normalized);
      }
    };

    addLinkedProperty(linkedProperty);

    const currentSub = await firebaseService.getSubscriptionByPropertyNumber(
      propertyNumber,
    );
    for (const linked of currentSub?.linkedProperties || []) {
      addLinkedProperty(linked);
    }
    if (currentSub?.linkedProperty) {
      addLinkedProperty(currentSub.linkedProperty);
      const mainSub = await firebaseService.getSubscriptionByPropertyNumber(
        currentSub.linkedProperty,
      );
      for (const linked of mainSub?.linkedProperties || []) {
        addLinkedProperty(linked);
      }
    }

    if (linkedPropsToSync.length === 0) {
      const multiSubs = await firebaseService.getMultiPropertySubscriptions();
      const activeGroup = multiSubs.find(
        (multiSubscription) =>
          isSubscriptionStatusActive(multiSubscription.status) &&
          (multiSubscription.propertyNumber1 === propertyNumber ||
            multiSubscription.propertyNumber2 === propertyNumber ||
            multiSubscription.additionalProperties?.includes(propertyNumber)),
      );
      if (activeGroup) {
        addLinkedProperty(activeGroup.propertyNumber1);
        addLinkedProperty(activeGroup.propertyNumber2);
        for (const linked of activeGroup.additionalProperties || []) {
          addLinkedProperty(linked);
        }
      }
    }

    for (const linkedPropertyNumber of linkedPropsToSync) {
      if (await isPropertySuspended(linkedPropertyNumber)) {
        return res.status(423).json({
          success: false,
          code: "PROPERTY_SUSPENDED",
          error:
            `اشتراك العقار المرتبط ${linkedPropertyNumber} موقوف مؤقتاً من الإدارة ولا يمكن تفعيل المجموعة.`,
        });
      }
    }

    const subscriptionData = {
      packageId: pkg.id,
      price: pkg.price / 2, // نصف السعر للباقة المشتركة
      subscriptionType: isPremium ? "مميز" : "عادي",
      packageType: isPremium ? "مميز" : "عادي",
      startDate,
      endDate,
      paymentId: paymentId || "",
      linkedProperty: linkedProperty || "",
    };

    await firebaseService.addSubscriptionToSheet(
      propertyNumber,
      subscriptionData,
      property,
      ""
    );

    // تحديث حالة التحقق
    await propertyService.approve(propertyNumber);

    // Apply same subscription to all linked properties
    for (const linkedPropNum of linkedPropsToSync) {
      const linkedProp = await propertyService.getByNumber(linkedPropNum);
      if (linkedProp) {
        await firebaseService.addSubscriptionToSheet(
          linkedPropNum,
          {
            ...subscriptionData,
            linkedProperty: propertyNumber,
          },
          linkedProp,
          ""
        );
        await propertyService.approve(linkedPropNum);
        console.log(`✅ [Manual Activation] تم تفعيل العقار المرتبط: ${linkedPropNum}`);
      }
    }

    console.log(`✅ [Manual Activation] تم تفعيل الاشتراك يدوياً للعقار: ${propertyNumber}${linkedPropsToSync.length > 0 ? ` + ${linkedPropsToSync.length} عقارات مرتبطة` : ''}`);

    res.json({
      success: true,
      message: `تم تفعيل الاشتراك للعقار ${propertyNumber} بنجاح${linkedPropsToSync.length > 0 ? ` و ${linkedPropsToSync.length} عقارات مرتبطة` : ''}`,
      subscription: subscriptionData,
      linkedPropertiesActivated: linkedPropsToSync,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: unknown }).code === "PROPERTY_SUSPENDED"
    ) {
      return res.status(423).json({
        success: false,
        code: "PROPERTY_SUSPENDED",
        error: error.message,
      });
    }
    console.error("Error manual activating subscription:", error);
    res.status(500).json({ error: "فشل في تفعيل الاشتراك" });
  }
});

// ربط عقار بعقار آخر مع التحقق من البيانات وإنشاء رابط ثنائي الاتجاه
router.post("/api/admin/subscription/link", async (req, res) => {
  try {
    const { propertyNumber, linkedProperty } = req.body;
    if (!propertyNumber || !linkedProperty) {
      return res.status(400).json({ error: "propertyNumber و linkedProperty مطلوبين" });
    }

    // Validate both properties exist
    const prop = await firebaseService.getPropertyByNumber(propertyNumber);
    const mainProp = await firebaseService.getPropertyByNumber(linkedProperty);
    if (!prop) {
      return res.status(404).json({ error: "العقار الأول غير موجود" });
    }
    if (!mainProp) {
      return res.status(404).json({ error: "العقار الثاني غير موجود" });
    }

    await firebaseService.mutateLinkedPropertyGroupAtomically({
      mainPropertyNumber: linkedProperty,
      addPropertyNumbers: [propertyNumber],
      approveAddedProperties: true,
    });

    res.json({ success: true, message: `تم ربط العقار ${propertyNumber} بالعقار ${linkedProperty} بنجاح (رابط ثنائي الاتجاه)` });
  } catch (error) {
    console.error("Error linking properties:", error);
    if (error instanceof LinkedPropertyMutationError) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code,
      });
    }
    res.status(500).json({ error: "فشل في ربط العقارات" });
  }
});

// ======================
// 🔧 مزامنة / إصلاح العقارات المرتبطة (Reconcile)
// ======================

// Reconcile a single linked group (force all linked properties to match the main)
router.post("/api/admin/subscriptions/reconcile", async (req, res) => {
  try {
    const { propertyNumber } = req.body;
    if (!propertyNumber) {
      return res.status(400).json({ error: "رقم العقار مطلوب" });
    }
    const result = await firebaseService.reconcileLinkedGroup(propertyNumber, true);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Error reconciling linked group:", error);
    res.status(500).json({ error: "فشل في مزامنة العقارات المرتبطة" });
  }
});

// Audit all linked groups (read-only report of inconsistencies)
router.get("/api/admin/subscriptions/reconcile-audit", async (req, res) => {
  try {
    const subscriptions = await firebaseService.getSubscriptions();
    // Only main properties (those with a linkedProperties array)
    const mains = subscriptions.filter(s => s.linkedProperties && s.linkedProperties.length > 0);

    const reports = [];
    let totalInconsistencies = 0;
    for (const main of mains) {
      const report = await firebaseService.reconcileLinkedGroup(main.propertyNumber, false);
      if (report.inconsistencies.length > 0) {
        reports.push(report);
        totalInconsistencies += report.inconsistencies.length;
      }
    }
    res.json({ success: true, groupsAudited: mains.length, groupsWithIssues: reports.length, totalInconsistencies, reports });
  } catch (error) {
    console.error("Error auditing linked groups:", error);
    res.status(500).json({ error: "فشل في تدقيق العقارات المرتبطة" });
  }
});

// Reconcile ALL linked groups at once (apply fixes)
router.post("/api/admin/subscriptions/reconcile-all", async (req, res) => {
  try {
    const subscriptions = await firebaseService.getSubscriptions();
    const mains = subscriptions.filter(s => s.linkedProperties && s.linkedProperties.length > 0);

    let totalFixed = 0;
    const results = [];
    for (const main of mains) {
      const result = await firebaseService.reconcileLinkedGroup(main.propertyNumber, true);
      if (result.fixed > 0) {
        results.push({ propertyNumber: main.propertyNumber, fixed: result.fixed });
        totalFixed += result.fixed;
      }
    }
    res.json({ success: true, groupsReconciled: mains.length, propertiesFixed: totalFixed, results });
  } catch (error) {
    console.error("Error reconciling all linked groups:", error);
    res.status(500).json({ error: "فشل في مزامنة جميع العقارات المرتبطة" });
  }
});

export default router;
