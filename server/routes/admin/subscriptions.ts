import { Router } from "express";
import { requireAdmin } from "../middleware";
import { subscriptionService, propertyService } from "../../services";
import { firebaseService } from "../../firebaseService";

const router = Router();

// All admin subscription routes require admin authentication
router.use(requireAdmin);

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
      if (sub.status === "منتهي" || (subWithType as any).cancelledAt) {
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

    console.log(`✅ [Manual Activation] تم تفعيل الاشتراك يدوياً للعقار: ${propertyNumber}`);

    res.json({
      success: true,
      message: `تم تفعيل الاشتراك للعقار ${propertyNumber} بنجاح`,
      subscription: subscriptionData
    });
  } catch (error) {
    console.error("Error manual activating subscription:", error);
    res.status(500).json({ error: "فشل في تفعيل الاشتراك" });
  }
});

// تحديث العقار المرتبط في الاشتراك
router.post("/api/admin/subscription/link", async (req, res) => {
  try {
    const { propertyNumber, linkedProperty } = req.body;
    if (!propertyNumber || !linkedProperty) {
      return res.status(400).json({ error: "propertyNumber و linkedProperty مطلوبين" });
    }
    await firebaseService.updateSubscriptionLinkedProperty(propertyNumber, linkedProperty);
    res.json({ success: true, message: `تم ربط العقار ${propertyNumber} بالعقار ${linkedProperty}` });
  } catch (error) {
    console.error("Error linking properties:", error);
    res.status(500).json({ error: "فشل في ربط العقارات" });
  }
});

export default router;
