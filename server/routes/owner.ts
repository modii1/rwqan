import { Router } from "express";
import { storage } from "../storage";
import { requireOwner } from "./middleware";
import type { Request, Response } from "express";

const router = Router();

router.post("/api/owner/login", async (req: Request, res: Response) => {
  const { propertyNumber, pin } = req.body;
  const p = await storage.getPropertyByNumber(propertyNumber);
  if (!p || p.pin !== pin) {
    return res.status(401).json({ error: "Invalid Credentials" });
  }
  (req.session as any).propertyNumber = propertyNumber;
  req.session.save((err: any) => {
    if (err) {
      return res.status(500).json({ error: "Session save failed" });
    }
    res.json({ ok: true });
  });
});

router.post("/api/owner/logout", (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: "Logout failed" });
    }
    res.json({ ok: true });
  });
});

router.get("/api/owner/session", (req: Request, res: Response) => {
  if ((req.session as any).propertyNumber) {
    res.json({ propertyNumber: (req.session as any).propertyNumber });
  } else {
    res.status(401).json({ error: "Not authenticated" });
  }
});

router.get("/api/owner/property", requireOwner, async (req: Request, res: Response) => {
  try {
    const propertyNumber = (req as any).propertyNumber;
    const property = await storage.getPropertyByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }
    res.json(property);
  } catch (err) {
    res.status(500).json({ error: "فشل في جلب بيانات العقار" });
  }
});

router.put("/api/owner/property", requireOwner, async (req: Request, res: Response) => {
  try {
    const propertyNumber = (req as any).propertyNumber;
    const updates = req.body;
    delete updates.propertyNumber;
    delete updates.pin;
    const updated = await storage.updateProperty(propertyNumber, updates);
    if (!updated) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "فشل في تحديث العقار" });
  }
});

router.get("/api/owner/current-subscription", requireOwner, async (req: Request, res: Response) => {
  try {
    const propertyNumber = (req as any).propertyNumber;
    const subscription = await storage.getSubscriptionByPropertyNumber(propertyNumber);
    if (!subscription) {
      return res.status(404).json({ error: "لا يوجد اشتراك نشط" });
    }
    res.json(subscription);
  } catch (err) {
    res.status(500).json({ error: "فشل في جلب الاشتراك" });
  }
});

router.get("/api/owner/payments", requireOwner, async (req: Request, res: Response) => {
  try {
    const propertyNumber = (req as any).propertyNumber;
    const allPayments = await storage.getPayments();
    const propertyPayments = allPayments.filter(p => p.propertyNumber === propertyNumber);
    res.json(propertyPayments);
  } catch (err) {
    res.status(500).json({ error: "فشل في جلب المدفوعات" });
  }
});

router.get("/api/owner/requests", requireOwner, async (req: Request, res: Response) => {
  try {
    const propertyNumber = (req as any).propertyNumber;
    const allRequests = await storage.getRequests();
    const propertyRequests = allRequests.filter(r => r.propertyNumber === propertyNumber);
    res.json(propertyRequests);
  } catch (err) {
    res.status(500).json({ error: "فشل في جلب الطلبات" });
  }
});

router.post("/api/owner/verify-second-property", requireOwner, async (req: Request, res: Response) => {
  try {
    const ownerPropertyNumber = (req.session as any).propertyNumber;
    const { secondPropertyNumber } = req.body;

    if (!secondPropertyNumber) {
      return res.status(400).json({ error: "رقم العقار الثاني مطلوب" });
    }

    if (secondPropertyNumber === ownerPropertyNumber) {
      return res.status(400).json({ error: "لا يمكن اختيار نفس العقار" });
    }

    const ownerProperty = await storage.getPropertyByNumber(ownerPropertyNumber);
    if (!ownerProperty) {
      return res.status(404).json({ error: "لم يتم العثور على عقارك" });
    }

    const secondProperty = await storage.getPropertyByNumber(secondPropertyNumber);
    if (!secondProperty) {
      return res.status(404).json({ error: "لم يتم العثور على العقار الثاني" });
    }

    if (secondProperty.pin !== ownerProperty.pin) {
      return res.status(403).json({ error: "هذا العقار يخص مالك آخر" });
    }

    const secondSubscription = await storage.getSubscriptionByPropertyNumber(secondPropertyNumber);
    if (secondSubscription && secondSubscription.status === 'نشط') {
      const endDate = new Date(secondSubscription.endDate);
      if (endDate > new Date()) {
        return res.status(400).json({
          error: "العقار الثاني لديه اشتراك نشط بالفعل",
          existingEndDate: secondSubscription.endDate
        });
      }
    }

    res.json({
      ok: true,
      property: {
        number: secondProperty.propertyNumber,
        name: secondProperty.name,
        city: secondProperty.city
      }
    });
  } catch (err: any) {
    console.error("Verify second property error:", err);
    res.status(500).json({ error: err?.message || "فشل في التحقق" });
  }
});

router.get("/api/owner/analytics", requireOwner, async (req: Request, res: Response) => {
  try {
    const propertyNumber = (req as any).propertyNumber;
    const requests = await storage.getRequests();
    const propertyRequests = requests.filter(r => r.propertyNumber === propertyNumber);
    
    res.json({
      totalRequests: propertyRequests.length,
    });
  } catch (err) {
    res.status(500).json({ error: "فشل في جلب التحليلات" });
  }
});

export default router;
