import { Router } from "express";
import { storage } from "../storage";
import type { Request, Response } from "express";

const router = Router();

router.get("/api/packages", async (_req: Request, res: Response) => {
  try {
    const packages = await storage.getPackages();
    res.json(packages);
  } catch (err) {
    console.error("Packages fetch error:", err);
    res.status(500).json({ error: "فشل في جلب الباقات" });
  }
});

router.post("/api/multi-property-subscription", async (req: Request, res: Response) => {
  try {
    const { ownerPropertyNumber, secondPropertyNumber, packageId, paymentMethod, discountCode } = req.body;

    if (!ownerPropertyNumber || !secondPropertyNumber || !packageId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (ownerPropertyNumber === secondPropertyNumber) {
      return res.status(400).json({ error: "Cannot subscribe the same property to itself" });
    }

    const ownerProperty = await storage.getPropertyByNumber(ownerPropertyNumber);
    const secondProperty = await storage.getPropertyByNumber(secondPropertyNumber);

    if (!ownerProperty || !secondProperty) {
      return res.status(404).json({ error: "One or both properties not found" });
    }

    if (ownerProperty.pin !== secondProperty.pin) {
      return res.status(403).json({ error: "Properties must have the same owner PIN" });
    }

    const pkg = await storage.getPackageById(packageId);
    if (!pkg) {
      return res.status(404).json({ error: "Package not found" });
    }

    const subscription = await storage.createSubscription({
      propertyNumber: ownerPropertyNumber,
      packageId: packageId,
      price: pkg.price,
      status: "نشط",
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + pkg.duration * 24 * 60 * 60 * 1000).toISOString(),
      autoRenew: false,
      paymentMethod: paymentMethod || "bank_transfer",
      discountCode: discountCode || null,
    });

    const secondSubscription = await storage.createSubscription({
      propertyNumber: secondPropertyNumber,
      packageId: packageId,
      price: pkg.price,
      status: "نشط",
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + pkg.duration * 24 * 60 * 60 * 1000).toISOString(),
      autoRenew: false,
      paymentMethod: paymentMethod || "bank_transfer",
      discountCode: discountCode || null,
    });

    res.json({
      ok: true,
      subscription,
      secondSubscription,
      package: pkg,
    });
  } catch (err: any) {
    console.error("Multi-property subscription error:", err);
    res.status(500).json({ error: err?.message || "فشل في إنشاء الاشتراك" });
  }
});

export default router;
