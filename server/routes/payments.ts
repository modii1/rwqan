import { Router } from "express";
import { storage } from "../storage";
import { paymobService } from "../paymob";
import type { Request, Response } from "express";

const router = Router();

router.post("/api/payment/calculate", async (req: Request, res: Response) => {
  try {
    const { propertyNumber, packageId, discountCode } = req.body;

    const property = await storage.getPropertyByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    const pkg = await storage.getPackageById(packageId);
    if (!pkg) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    let finalPrice = pkg.price;
    let discountAmount = 0;

    if (discountCode) {
      const discounts = await storage.getDiscountCodes();
      const discount = discounts.find(d => d.code === discountCode);
      if (discount && discount.isActive) {
        if (discount.type === "percentage") {
          discountAmount = (pkg.price * (discount.value || 0)) / 100;
        } else {
          discountAmount = discount.value || 0;
        }
        finalPrice = Math.max(0, pkg.price - discountAmount);
      }
    }

    res.json({
      originalPrice: pkg.price,
      discountAmount,
      finalPrice,
      package: pkg,
    });
  } catch (err) {
    console.error("Payment calculate error:", err);
    res.status(500).json({ error: "فشل في حساب السعر" });
  }
});

router.post("/api/discount/validate", async (req: Request, res: Response) => {
  try {
    const { code, propertyNumber } = req.body;

    if (!code) {
      return res.status(400).json({ error: "كود الخصم مطلوب" });
    }

    const discounts = await storage.getDiscountCodes();
    const discount = discounts.find(d => d.code === code);
    if (!discount) {
      return res.status(404).json({ valid: false, error: "كود الخصم غير موجود" });
    }

    if (!discount.isActive) {
      return res.status(400).json({ valid: false, error: "كود الخصم غير نشط" });
    }

    if (discount.validUntil) {
      const validUntil = new Date(discount.validUntil);
      if (validUntil < new Date()) {
        return res.status(400).json({ valid: false, error: "كود الخصم منتهي الصلاحية" });
      }
    }

    if (discount.usedCount !== undefined && discount.maxUses) {
      if (discount.usedCount >= discount.maxUses) {
        return res.status(400).json({ valid: false, error: "تم استخدام الكود بالكامل" });
      }
    }

    res.json({
      valid: true,
      discount: {
        code: discount.code,
        type: discount.type,
        value: discount.value,
      },
    });
  } catch (err) {
    console.error("Discount validate error:", err);
    res.status(500).json({ error: "فشل في التحقق من كود الخصم" });
  }
});

export default router;
