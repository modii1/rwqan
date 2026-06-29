import { Router } from "express";
import { requireAdmin } from "../middleware";
import { subscriptionService, propertyService } from "../../services";
import { firebaseService } from "../../firebaseService";

const router = Router();

// All admin subscription routes require admin authentication
router.use("/api/admin", requireAdmin);

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

router.post("/api/multi-property-subscription", async (req, res) => {
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
    const pkg = await subscriptionService.getPackageById(packageId);
    if (!pkg) {
      return res.status(400).json({ error: "الباقة غير موجودة" });
    }

    // حساب التواريخ (duration بالأيام)
    const startDate = new Date().toISOString();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + (pkg.duration || 30));

    const sub = await firebaseService.createMultiPropertySubscription({
      packageId,
      propertyNumber1,
      propertyNumber2,
      startDate,
      endDate: endDate.toISOString(),
      status: "نشط",
    });

    res.json({ success: true, subscription: sub });
  } catch (error) {
    console.error("Error creating multi-property subscription:", error);
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
      let status: "ساري" | "منتهي" | "قريب الانتهاء" | "نشط مجاني" = "ساري";

      // قراءة البيانات من الاشتراك مباشرة
      const subWithType = sub as any;

      // إذا تم إلغاء الاشتراك يدوياً (موقوف أو ملغى) → منتهي مباشرة
      // لكن إذا تم إعادة تفعيله بعد الإلغاء (startDate > cancelledAt) فلا يُعتبر منتهي
      const wasCancelled = !!(subWithType as any).cancelledAt;
      const wasReactivated = wasCancelled && sub.startDate && 
        new Date(sub.startDate) > new Date((subWithType as any).cancelledAt);
      
      if (sub.status === "منتهي" || (wasCancelled && !wasReactivated)) {
        status = "منتهي";
        remainingDays = -1;
      }
      // إذا لم يكن هناك تاريخ انتهاء = نشط مجاني (free)
      else if (!sub.endDate || sub.endDate.trim() === "") {
        status = "نشط مجاني";
        remainingDays = null;
      } else {
        const end = new Date(sub.endDate);
        const now = new Date();

        // تصفير الوقت للمقارنة بالأيام فقط
        end.setHours(0, 0, 0, 0);
        now.setHours(0, 0, 0, 0);

        const diffTime = end.getTime() - now.getTime();
        remainingDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

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

    const property = await propertyService.getByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    const pkg = await subscriptionService.getPackageById(packageId);
    if (!pkg) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    const isPremium = pkg.type === "موثوق" || pkg.type === "مميز" || pkg.price > 0;

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

    // تفعيل العقارات المرتبطة بنفس التواريخ
    const linkedPropsToSync: string[] = [];
    
    // Check if linkedProperty was explicitly provided
    if (linkedProperty) {
      linkedPropsToSync.push(linkedProperty);
    }
    
    // Also look up existing linked properties from current subscription and multi-property groups
    const currentSub = await firebaseService.getSubscriptionByPropertyNumber(propertyNumber);
    if (currentSub?.linkedProperties && currentSub.linkedProperties.length > 0) {
      for (const lp of currentSub.linkedProperties) {
        if (lp !== propertyNumber && !linkedPropsToSync.includes(lp)) {
          linkedPropsToSync.push(lp);
        }
      }
    }
    if (currentSub?.linkedProperty && !linkedPropsToSync.includes(currentSub.linkedProperty)) {
      linkedPropsToSync.push(currentSub.linkedProperty);
      // Get other linked properties from the main property
      const mainSub = await firebaseService.getSubscriptionByPropertyNumber(currentSub.linkedProperty);
      if (mainSub?.linkedProperties) {
        for (const lp of mainSub.linkedProperties) {
          if (lp !== propertyNumber && !linkedPropsToSync.includes(lp)) {
            linkedPropsToSync.push(lp);
          }
        }
      }
    }

    // Check multi_property_subscriptions collection
    if (linkedPropsToSync.length === 0) {
      const multiSubs = await firebaseService.getMultiPropertySubscriptions();
      const activeGroup = multiSubs.find(
        ms => ms.status === "نشط" && (
          ms.propertyNumber1 === propertyNumber ||
          ms.propertyNumber2 === propertyNumber ||
          (ms.additionalProperties && ms.additionalProperties.includes(propertyNumber))
        )
      );
      if (activeGroup) {
        if (activeGroup.propertyNumber1 !== propertyNumber && !linkedPropsToSync.includes(activeGroup.propertyNumber1)) {
          linkedPropsToSync.push(activeGroup.propertyNumber1);
        }
        if (activeGroup.propertyNumber2 && activeGroup.propertyNumber2 !== propertyNumber && !linkedPropsToSync.includes(activeGroup.propertyNumber2)) {
          linkedPropsToSync.push(activeGroup.propertyNumber2);
        }
        if (activeGroup.additionalProperties) {
          for (const ap of activeGroup.additionalProperties) {
            if (ap !== propertyNumber && !linkedPropsToSync.includes(ap)) {
              linkedPropsToSync.push(ap);
            }
          }
        }
      }
    }

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

    // Get or create subscription for the linked property
    const linkedSub = await firebaseService.getSubscriptionByPropertyNumber(propertyNumber);
    const mainSub = await firebaseService.getSubscriptionByPropertyNumber(linkedProperty);

    if (!mainSub) {
      return res.status(400).json({ error: "العقار الرئيسي ليس لديه اشتراك نشط" });
    }

    // Set linkedProperty on the child subscription
    await firebaseService.updateSubscriptionLinkedProperty(propertyNumber, linkedProperty);

    // Add to main's linkedProperties array
    if (mainSub) {
      const currentLinked = mainSub.linkedProperties || [];
      if (!currentLinked.includes(propertyNumber)) {
        const updatedLinked = [...currentLinked, propertyNumber];
        await firebaseService.updateSubscription(mainSub.id, {
          linkedProperties: updatedLinked,
          propertyCount: updatedLinked.length + 1,
        });
      }
    }

    // Create or update multi-property subscription record
    const multiSubs = await firebaseService.getMultiPropertySubscriptions();
    const existingGroup = multiSubs.find(
      m => m.propertyNumber1 === linkedProperty && m.status === 'نشط'
    );

    if (existingGroup) {
      const addProps = [...(existingGroup.additionalProperties || []), propertyNumber];
      const uniqueAdd = new Set([existingGroup.propertyNumber1, ...addProps].filter(Boolean));
      await firebaseService.updateMultiPropertySubscription(existingGroup.id, {
        additionalProperties: addProps,
        linkedProperties: Array.from(uniqueAdd),
        propertyCount: uniqueAdd.size,
      });
    } else {
      await firebaseService.createMultiPropertySubscription({
        packageId: mainSub.packageId || "",
        propertyNumber1: linkedProperty,
        propertyNumber2: propertyNumber,
        additionalProperties: [propertyNumber],
        linkedProperties: [linkedProperty, propertyNumber],
        propertyCount: 2,
        startDate: mainSub.startDate || new Date().toISOString().split("T")[0],
        endDate: mainSub.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        status: "نشط",
        paymentId: mainSub.paymentId,
      });
    }

    // Update property's subscriptionType to match main
    await firebaseService.updateProperty(propertyNumber, {
      subscriptionType: mainProp.subscriptionType || "مميز",
      pendingApprovalFrom: undefined,
    });

    // If the linked property has no subscription yet, create one with same dates as main
    if (!linkedSub) {
      const today = new Date();
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + 30);

      await firebaseService.addSubscriptionToSheet(
        propertyNumber,
        {
          packageId: mainSub.packageId,
          price: 0,
          subscriptionType: mainSub.subscriptionType || "مميز",
          packageType: mainSub.packageType || "مميز",
          startDate: mainSub.startDate || today.toISOString(),
          endDate: mainSub.endDate || endDate.toISOString(),
          linkedProperty: linkedProperty,
          status: "نشط",
          paymentId: mainSub.paymentId,
        },
        prop
      );
    }

    res.json({ success: true, message: `تم ربط العقار ${propertyNumber} بالعقار ${linkedProperty} بنجاح (رابط ثنائي الاتجاه)` });
  } catch (error) {
    console.error("Error linking properties:", error);
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
