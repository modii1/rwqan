import { Router } from "express";
import { storage } from "../storage";
import { googleDriveService } from "../googleDrive";
import { requireAdmin, ADMIN_CODE, ADMIN_PASSWORD } from "./middleware";
import type { Request, Response } from "express";

const router = Router();

const SHEET_MAP: Record<string, string> = {
  "🏷 رقم العقار": "propertyNumber",
  "🏡 اسم العقار": "name",
  "📞 رقم الجوال": "whatsappNumber",
  "📍 الموقع": "location",
  "📍 المنطقة": "city",
  "🧭 الاتجاه": "direction",
  "🏠 النوع": "type",
  "🔹 المرافق": "facilities",
  "🔗 رابط الصور": "imagesLink",
  "💰 سعر العرض": "priceOffer",
  "💰 سعر وسط الأسبوع": "priceWeekdays",
  "💰 سعر نهاية الأسبوع": "priceWeekend",
  "💰 سعر المبيت": "priceNight",
  "💰 سعر خاص (اختياري)": "priceSpecial",
  "💰 سعر الإجازات": "priceHolidays",
  "نوع الاشتراك": "subscriptionType",
  "تاريخ الاشتراك": "subscriptionDate",
  "الرقم السري": "pin",
};

router.post("/api/admin/login", async (req: Request, res: Response) => {
  const { code, password } = req.body;
  if (code !== ADMIN_CODE || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid Admin Credentials" });
  }
  (req.session as any).isAdmin = true;
  req.session.save((err: any) => {
    if (err) {
      return res.status(500).json({ error: "Session save failed" });
    }
    res.json({ ok: true });
  });
});

router.get("/api/admin/session", (req: Request, res: Response) => {
  if ((req.session as any).isAdmin) {
    res.json({ isAdmin: true });
  } else {
    res.status(401).json({ error: "Not authenticated" });
  }
});

router.get("/api/admin/properties", async (_req: Request, res: Response) => {
  try {
    const items = await storage.getProperties();
    res.json(items);
  } catch (err) {
    console.error("Admin get properties error:", err);
    res.status(500).json({ error: "فشل في جلب العقارات" });
  }
});

router.put("/api/admin/properties/:propertyNumber", async (req: Request, res: Response) => {
  try {
    const { propertyNumber } = req.params;
    const body = req.body;
    const updates: any = {};
    for (const [key, value] of Object.entries(body)) {
      const mapped = SHEET_MAP[key];
      if (mapped) {
        updates[mapped] = value;
      } else {
        updates[key] = value;
      }
    }
    const updated = await storage.updateProperty(propertyNumber, updates);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "فشل في التحديث" });
  }
});

router.post("/api/admin/properties", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const data: any = {};
    for (const [key, value] of Object.entries(body)) {
      const mapped = SHEET_MAP[key];
      if (mapped) {
        data[mapped] = value;
      } else {
        data[key] = value;
      }
    }
    const exists = await storage.getPropertyByNumber(data.propertyNumber);
    if (exists) {
      return res.status(400).json({ error: "رقم العقار مستخدم بالفعل" });
    }
    const folderId = await googleDriveService.createPropertyFolder(data.propertyNumber, data.name);
    const created = await storage.createProperty({
      ...data,
      driveFolderId: folderId,
      imageUrls: [],
    });
    res.json(created);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "فشل في الإنشاء" });
  }
});

router.delete("/api/admin/properties/:propertyNumber", async (req: Request, res: Response) => {
  try {
    await storage.deleteProperty(req.params.propertyNumber);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "فشل في الحذف" });
  }
});

router.get("/api/admin/requests", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const allRequests = await storage.getRequests();
    const totalProps = await storage.getProperties();
    res.json({
      recentRequests: allRequests.slice(-100),
      totalRequests: allRequests.length,
      totalProperties: totalProps.length,
    });
  } catch (err) {
    res.status(500).json({ error: "فشل في جلب الطلبات" });
  }
});

router.get("/api/admin/visitors", requireAdmin, async (_req: Request, res: Response) => {
  try {
    res.json({ visitors: [], total: 0 });
  } catch (err) {
    res.status(500).json({ error: "فشل في جلب الزوار" });
  }
});

router.get("/api/admin/analytics", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const properties = await storage.getProperties();
    const subscriptions = await storage.getSubscriptions();
    const payments = await storage.getPayments();
    const requests = await storage.getRequests();

    const activeSubscriptions = subscriptions.filter(s => s.status === "نشط");
    const totalRevenue = payments.filter(p => p.status === "نجح" || p.status === "completed" || p.status === "نجاح")
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    res.json({
      totalProperties: properties.length,
      activeSubscriptions: activeSubscriptions.length,
      totalRevenue,
      totalRequests: requests.length,
      propertiesByCity: properties.reduce((acc: any, p) => {
        acc[p.city] = (acc[p.city] || 0) + 1;
        return acc;
      }, {}),
    });
  } catch (err: any) {
    console.error("Analytics error:", err);
    res.status(500).json({ error: "فشل في جلب التحليلات" });
  }
});

router.get("/api/admin/alerts", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const subscriptions = await storage.getSubscriptions();
    const now = new Date();
    const criticalCount = subscriptions.filter(s => {
      if (s.status !== "نشط") return false;
      const endDate = new Date(s.endDate);
      const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return daysLeft <= 3 && daysLeft > 0;
    }).length;

    const warningCount = subscriptions.filter(s => {
      if (s.status !== "نشط") return false;
      const endDate = new Date(s.endDate);
      const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      return daysLeft <= 7 && daysLeft > 3;
    }).length;

    res.json({
      totalAlerts: criticalCount + warningCount,
      criticalAlerts: criticalCount,
      warningAlerts: warningCount,
      lastUpdated: new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' })
    });
  } catch (err: any) {
    console.error("Alerts error:", err);
    res.status(500).json({ error: "فشل في جلب التنبيهات" });
  }
});

router.get("/api/admin/subscriptions", async (_req: Request, res: Response) => {
  try {
    const subscriptions = await storage.getSubscriptions();
    res.json(subscriptions);
  } catch (err) {
    res.status(500).json({ error: "فشل في جلب الاشتراكات" });
  }
});

router.post("/api/admin/subscription/cancel", async (req: Request, res: Response) => {
  try {
    const { propertyNumber } = req.body;
    const subscription = await storage.getSubscriptionByPropertyNumber(propertyNumber);
    if (!subscription) {
      return res.status(404).json({ error: "الاشتراك غير موجود" });
    }
    await storage.updateSubscription(subscription.propertyNumber, { status: "منتهي" });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "فشل في إلغاء الاشتراك" });
  }
});

router.get("/api/admin/payments", async (_req: Request, res: Response) => {
  try {
    const payments = await storage.getPayments();
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: "فشل في جلب المدفوعات" });
  }
});

router.post("/api/admin/payment/approve", async (req: Request, res: Response) => {
  try {
    const { paymentId } = req.body;
    const payment = await storage.getPaymentById(paymentId);
    if (!payment) {
      return res.status(404).json({ error: "الدفعة غير موجودة" });
    }
    await storage.updatePayment(paymentId, { status: "نجح" });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "فشل في الموافقة" });
  }
});

router.post("/api/admin/payment/reject", async (req: Request, res: Response) => {
  try {
    const { paymentId, reason } = req.body;
    const payment = await storage.getPaymentById(paymentId);
    if (!payment) {
      return res.status(404).json({ error: "الدفعة غير موجودة" });
    }
    await storage.updatePayment(paymentId, { 
      status: "مرفوض",
      notes: reason || "مرفوض"
    });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "فشل في الرفض" });
  }
});

router.get("/api/admin/packages", async (_req: Request, res: Response) => {
  try {
    const packages = await storage.getPackages();
    res.json(packages);
  } catch (err) {
    res.status(500).json({ error: "فشل في جلب الباقات" });
  }
});

router.post("/api/admin/packages", async (req: Request, res: Response) => {
  try {
    const pkg = await storage.createPackage(req.body);
    res.json(pkg);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "فشل في إنشاء الباقة" });
  }
});

router.put("/api/admin/packages/:id", async (req: Request, res: Response) => {
  try {
    const updated = await storage.updatePackage(req.params.id, req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "فشل في تحديث الباقة" });
  }
});

router.delete("/api/admin/packages/:id", async (req: Request, res: Response) => {
  try {
    await storage.deletePackage(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "فشل في حذف الباقة" });
  }
});

router.get("/api/admin/discounts", async (_req: Request, res: Response) => {
  try {
    const discounts = await storage.getDiscountCodes();
    res.json(discounts);
  } catch (err) {
    res.status(500).json({ error: "فشل في جلب أكواد الخصم" });
  }
});

router.post("/api/admin/discounts", async (req: Request, res: Response) => {
  try {
    const discount = await storage.createDiscountCode(req.body);
    res.json(discount);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "فشل في إنشاء كود الخصم" });
  }
});

router.put("/api/admin/discounts/:id", async (req: Request, res: Response) => {
  try {
    const updated = await storage.updateDiscountCode(req.params.id, req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "فشل في تحديث كود الخصم" });
  }
});

router.delete("/api/admin/discounts/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteDiscountCode(req.params.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "فشل في حذف كود الخصم" });
  }
});

export default router;
