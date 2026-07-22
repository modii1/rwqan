import { Router } from "express";
import { requireAdmin } from "../middleware";
import { firebaseService } from "../../firebaseService";
import {
  MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS,
  isSubscriptionPackageDurationAllowed,
  normalizeSubscriptionPackageDuration,
} from "../../../shared/core/subscriptions/package-policy";

const router = Router();

function parseSubscriptionPackageDuration(value: unknown): number | null {
  return normalizeSubscriptionPackageDuration(value);
}

function packageDurationError(isActive: boolean): string {
  return isActive
    ? `مدة الباقة النشطة يجب أن تكون عدداً صحيحاً بين 1 و${MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS} يوماً. عطّل الباقة أولاً للاحتفاظ بمدة أطول.`
    : "مدة باقة الاشتراك يجب أن تكون عدداً صحيحاً موجباً.";
}

function servicePackageError(error: unknown): string {
  if (error instanceof RangeError && error.message.includes("cannot exceed")) {
    return packageDurationError(true);
  }
  return "مدة باقة الاشتراك يجب أن تكون عدداً صحيحاً موجباً.";
}

// ======================
// 📦 إدارة الباقات (Admin)
// ======================

// جلب جميع الباقات
router.get("/api/admin/packages", async (_req, res) => {
  try {
    const packages = await firebaseService.getAllPackages();
    // Map fields for frontend compatibility: duration → durationDays, features → description
    const mapped = packages.map((pkg: any) => ({
      ...pkg,
      durationDays: pkg.durationDays ?? pkg.duration ?? 30,
      description: pkg.description || (pkg.features && pkg.features.length > 0 ? pkg.features.join("، ") : ""),
      isActive: pkg.isActive === true,
    }));
    res.json(mapped);
  } catch (error) {
    console.error("Error fetching packages:", error);
    res.status(500).json({ error: "فشل في جلب الباقات" });
  }
});

// إنشاء باقة جديدة
router.post("/api/admin/packages", requireAdmin, async (req, res) => {
  try {
    if (req.body.isActive !== undefined && typeof req.body.isActive !== "boolean") {
      return res.status(400).json({ error: "حالة تفعيل الباقة غير صحيحة." });
    }
    const isActive = req.body.isActive !== false;
    const requestedDuration = req.body.duration ?? req.body.durationDays ?? 30;
    const durationValue = parseSubscriptionPackageDuration(requestedDuration);
    if (
      durationValue === null ||
      !isSubscriptionPackageDurationAllowed(durationValue, isActive)
    ) {
      return res.status(400).json({
        error: packageDurationError(isActive),
      });
    }
    const pkgData = {
      name: req.body.name || "",
      duration: durationValue,
      durationDays: durationValue,
      price: req.body.price || 0,
      pricePerProperty: req.body.pricePerProperty || undefined,
      type: req.body.type || "مميز",
      features: req.body.features || (req.body.description ? [req.body.description] : []),
      description: req.body.description || "",
      isActive,
      propertyCount: req.body.propertyCount || 1,
      maxProperties: req.body.maxProperties || undefined,
    };
    const newPkg = await firebaseService.createPackage(pkgData);
    res.json(newPkg);
  } catch (error) {
    console.error("Error creating package:", error);
    if (error instanceof RangeError) {
      return res.status(400).json({ error: servicePackageError(error) });
    }
    res.status(500).json({ error: "فشل في إنشاء الباقة" });
  }
});

// تحديث باقة
router.put("/api/admin/packages/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const pkgData: any = {};
    if (req.body.isActive !== undefined && typeof req.body.isActive !== "boolean") {
      return res.status(400).json({ error: "حالة تفعيل الباقة غير صحيحة." });
    }
    if (req.body.name !== undefined) pkgData.name = req.body.name;
    if (req.body.duration !== undefined || req.body.durationDays !== undefined) {
      const dur = parseSubscriptionPackageDuration(
        req.body.duration ?? req.body.durationDays,
      );
      if (dur === null) {
        return res.status(400).json({
          error: packageDurationError(false),
        });
      }
      pkgData.duration = dur;
      pkgData.durationDays = dur;
    }
    if (req.body.price !== undefined) pkgData.price = req.body.price;
    if (req.body.pricePerProperty !== undefined) pkgData.pricePerProperty = req.body.pricePerProperty || null;
    if (req.body.type !== undefined) pkgData.type = req.body.type;
    if (req.body.features !== undefined) pkgData.features = req.body.features;
    if (req.body.description !== undefined && !req.body.features) {
      pkgData.features = req.body.description ? [req.body.description] : [];
    }
    if (req.body.isActive !== undefined) pkgData.isActive = req.body.isActive;
    if (req.body.propertyCount !== undefined) pkgData.propertyCount = req.body.propertyCount;
    if (req.body.maxProperties !== undefined) pkgData.maxProperties = req.body.maxProperties || null;

    const updated = await firebaseService.updatePackage(id, pkgData);
    if (!updated) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }
    res.json(updated);
  } catch (error) {
    console.error("Error updating package:", error);
    if (error instanceof RangeError) {
      return res.status(400).json({ error: servicePackageError(error) });
    }
    res.status(500).json({ error: "فشل في تحديث الباقة" });
  }
});

// حذف باقة
router.delete("/api/admin/packages/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await firebaseService.deletePackage(id);
    if (!deleted) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }
    res.json({ success: true, message: "تم حذف الباقة بنجاح" });
  } catch (error) {
    console.error("Error deleting package:", error);
    res.status(500).json({ error: "فشل في حذف الباقة" });
  }
});

export default router;
