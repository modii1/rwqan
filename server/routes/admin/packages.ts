import { Router } from "express";
import { requireAdmin } from "../middleware";
import { firebaseService } from "../../firebaseService";
import {
  MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS,
  isSubscriptionPackageDurationAllowed,
  normalizeSubscriptionPackageDuration,
} from "../../../shared/subscriptionPackagePolicy";
import { getPackageBasePrice } from "../../../shared/subscriptionPricing";
import {
  normalizePackageFeatures,
  type PackageFeature,
} from "../../../shared/packageFeatures";
import { isSupportedPackageIcon } from "../../../shared/packageIcons";
import {
  isPackageAudience,
  normalizePackageAudience,
} from "../../../shared/packageAudience";

const router = Router();

class PackageFeatureValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackageFeatureValidationError";
  }
}

const PACKAGE_TYPES = [
  "عادي",
  "مميز",
  "premium",
  "trusted",
  "normal",
  "free",
  "مجاني",
] as const;

type PackageType = (typeof PACKAGE_TYPES)[number];

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

function parseMoney(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

function parsePercent(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return Math.round(parsed * 100) / 100;
}

function parseQuarterlyDuration(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 90;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS) {
    return null;
  }
  return parsed;
}

function parseSortOrder(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function parseOfferDate(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const raw = String(value).trim();
  const dateOnly = raw.includes("T") ? raw.slice(0, 10) : raw;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return null;
  const timestamp = new Date(`${dateOnly}T00:00:00`).getTime();
  return Number.isFinite(timestamp) ? dateOnly : null;
}

function parseFeatures(value: unknown): PackageFeature[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new PackageFeatureValidationError("صيغة مميزات الباقة غير صحيحة.");
  }
  const features = normalizePackageFeatures(value);
  for (const feature of features) {
    if (feature.icon && !isSupportedPackageIcon(feature.icon)) {
      throw new PackageFeatureValidationError(
        `أيقونة الميزة "${feature.icon}" غير مدعومة.`,
      );
    }
  }
  return features;
}

function normalizePackageType(value: unknown): PackageType {
  return PACKAGE_TYPES.includes(value as PackageType)
    ? (value as PackageType)
    : "عادي";
}

// ======================
// 📦 إدارة الباقات (Admin)
// ======================

// جلب جميع الباقات (بما فيها غير النشطة/المؤرشفة)
router.get("/api/admin/packages", async (_req, res) => {
  try {
    const packages = await firebaseService.getAllPackages();
    const mapped = packages.map((pkg: any) => {
      const normalizedFeatures = normalizePackageFeatures(pkg.features);
      return {
        ...pkg,
        features: normalizedFeatures,
        audience: normalizePackageAudience(pkg.audience),
        durationDays: pkg.durationDays ?? pkg.duration ?? 30,
        description:
          pkg.description ||
          normalizedFeatures.map((feature) => feature.text).join("، "),
        isActive: pkg.isActive === true,
        monthlyPrice: pkg.monthlyPrice ?? getPackageBasePrice(pkg),
        monthlyEnabled: pkg.monthlyEnabled !== false,
        quarterlyEnabled: pkg.quarterlyEnabled === true,
        quarterlyDurationDays: pkg.quarterlyDurationDays ?? 90,
        isVisible: pkg.isVisible !== false,
        sortOrder: pkg.sortOrder ?? 0,
        isRecommended: pkg.isRecommended === true,
        discountStartsAt: pkg.discountStartsAt ?? "",
        discountEndsAt: pkg.discountEndsAt ?? "",
        archived: Boolean(pkg.archivedAt),
      };
    });
    mapped.sort((a: any, b: any) => {
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      const orderA = Number(a.sortOrder ?? 0);
      const orderB = Number(b.sortOrder ?? 0);
      if (Number.isFinite(orderA) && Number.isFinite(orderB) && orderA !== orderB) {
        return orderA - orderB;
      }
      return String(a.name || "").localeCompare(String(b.name || ""), "ar");
    });
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
    const name = String(req.body.name || "").trim();
    if (!name) {
      return res.status(400).json({ error: "اسم الباقة مطلوب." });
    }

    const isActive = req.body.isActive !== false;
    const requestedDuration = req.body.durationDays ?? req.body.duration ?? 30;
    const durationValue = parseSubscriptionPackageDuration(requestedDuration);
    if (
      durationValue === null ||
      !isSubscriptionPackageDurationAllowed(durationValue, isActive)
    ) {
      return res.status(400).json({ error: packageDurationError(isActive) });
    }

    const monthlyPrice = parseMoney(req.body.monthlyPrice ?? req.body.price ?? 0);
    if (monthlyPrice === null) {
      return res.status(400).json({ error: "السعر الشهري يجب أن يكون رقماً غير سالب." });
    }
    const quarterlyPrice = parseMoney(req.body.quarterlyPrice);
    if (req.body.quarterlyPrice !== undefined && req.body.quarterlyPrice !== null && req.body.quarterlyPrice !== "" && quarterlyPrice === null) {
      return res.status(400).json({ error: "سعر الثلاثة أشهر يجب أن يكون رقماً غير سالب." });
    }
    const monthlyDiscountPercent = parsePercent(req.body.monthlyDiscountPercent);
    if (monthlyDiscountPercent === null) {
      return res.status(400).json({ error: "خصم الشهري يجب أن يكون بين 0 و100." });
    }
    const quarterlyDiscountPercent = parsePercent(req.body.quarterlyDiscountPercent);
    if (quarterlyDiscountPercent === null) {
      return res.status(400).json({ error: "خصم الثلاثة أشهر يجب أن يكون بين 0 و100." });
    }
    const quarterlyDurationDays = parseQuarterlyDuration(req.body.quarterlyDurationDays);
    if (quarterlyDurationDays === null) {
      return res.status(400).json({ error: "مدة الثلاثة أشهر يجب أن تكون بين 1 و90 يوماً." });
    }
    const discountStartsAt = parseOfferDate(req.body.discountStartsAt);
    if (
      req.body.discountStartsAt !== undefined &&
      req.body.discountStartsAt !== "" &&
      discountStartsAt === null
    ) {
      return res.status(400).json({ error: "تاريخ بداية العرض غير صحيح." });
    }
    const discountEndsAt = parseOfferDate(req.body.discountEndsAt);
    if (
      req.body.discountEndsAt !== undefined &&
      req.body.discountEndsAt !== "" &&
      discountEndsAt === null
    ) {
      return res.status(400).json({ error: "تاريخ نهاية العرض غير صحيح." });
    }
    if (
      discountStartsAt &&
      discountEndsAt &&
      discountStartsAt > discountEndsAt
    ) {
      return res.status(400).json({ error: "بداية العرض يجب أن تسبق نهايته." });
    }
    const features =
      parseFeatures(req.body.features) ??
      (req.body.description
        ? [{ text: String(req.body.description).trim() }]
        : []);
    const audience =
      req.body.audience === undefined ? "both" : req.body.audience;
    if (!isPackageAudience(audience)) {
      return res.status(400).json({ error: "مكان ظهور الباقة غير صحيح." });
    }

    const pkgData = {
      name,
      audience,
      duration: durationValue,
      durationDays: durationValue,
      // price يبقى مرادفاً للسعر الشهري للتوافق مع الشيفرة الحالية
      price: monthlyPrice,
      monthlyPrice,
      quarterlyPrice: quarterlyPrice ?? null,
      monthlyDiscountPercent,
      quarterlyDiscountPercent,
      monthlyEnabled: req.body.monthlyEnabled !== false,
      quarterlyEnabled: req.body.quarterlyEnabled === true && Boolean(quarterlyPrice && quarterlyPrice > 0),
      quarterlyDurationDays,
      pricePerProperty: parseMoney(req.body.pricePerProperty) ?? undefined,
      type: normalizePackageType(req.body.type),
      features,
      description: String(req.body.description || "").trim(),
      isActive,
      isVisible: req.body.isVisible !== false,
      sortOrder: parseSortOrder(req.body.sortOrder),
      featuredBadge: String(req.body.featuredBadge || "").trim(),
      isRecommended: req.body.isRecommended === true,
      discountStartsAt,
      discountEndsAt,
      propertyCount: Math.max(1, Number(req.body.propertyCount) || 1),
      maxProperties: req.body.maxProperties
        ? Math.max(1, Number(req.body.maxProperties) || 1)
        : undefined,
    };
    const newPkg = await firebaseService.createPackage(pkgData as any);
    if (pkgData.isRecommended) {
      await firebaseService.clearRecommendedPackages(newPkg.id);
    }
    res.json(newPkg);
  } catch (error) {
    console.error("Error creating package:", error);
    if (error instanceof PackageFeatureValidationError) {
      return res.status(400).json({ error: error.message });
    }
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
    if (req.body.name !== undefined) {
      const name = String(req.body.name || "").trim();
      if (!name) return res.status(400).json({ error: "اسم الباقة مطلوب." });
      pkgData.name = name;
    }
    if (req.body.duration !== undefined || req.body.durationDays !== undefined) {
      // durationDays أولاً: الواجهة ترسل الحقل الجديد، والبيانات القديمة تحتوي duration.
      const dur = parseSubscriptionPackageDuration(
        req.body.durationDays ?? req.body.duration,
      );
      if (dur === null) {
        return res.status(400).json({ error: packageDurationError(false) });
      }
      pkgData.duration = dur;
      pkgData.durationDays = dur;
    }
    if (req.body.price !== undefined || req.body.monthlyPrice !== undefined) {
      const monthlyPrice = parseMoney(req.body.monthlyPrice ?? req.body.price);
      if (monthlyPrice === null) {
        return res.status(400).json({ error: "السعر الشهري يجب أن يكون رقماً غير سالب." });
      }
      pkgData.price = monthlyPrice;
      pkgData.monthlyPrice = monthlyPrice;
    }
    if (req.body.quarterlyPrice !== undefined) {
      const quarterlyPrice = parseMoney(req.body.quarterlyPrice);
      if (quarterlyPrice === null) {
        return res.status(400).json({ error: "سعر الثلاثة أشهر يجب أن يكون رقماً غير سالب." });
      }
      pkgData.quarterlyPrice = quarterlyPrice;
    }
    if (req.body.monthlyDiscountPercent !== undefined) {
      const value = parsePercent(req.body.monthlyDiscountPercent);
      if (value === null) return res.status(400).json({ error: "خصم الشهري يجب أن يكون بين 0 و100." });
      pkgData.monthlyDiscountPercent = value;
    }
    if (req.body.quarterlyDiscountPercent !== undefined) {
      const value = parsePercent(req.body.quarterlyDiscountPercent);
      if (value === null) return res.status(400).json({ error: "خصم الثلاثة أشهر يجب أن يكون بين 0 و100." });
      pkgData.quarterlyDiscountPercent = value;
    }
    if (req.body.quarterlyDurationDays !== undefined) {
      const value = parseQuarterlyDuration(req.body.quarterlyDurationDays);
      if (value === null) return res.status(400).json({ error: "مدة الثلاثة أشهر يجب أن تكون بين 1 و90 يوماً." });
      pkgData.quarterlyDurationDays = value;
    }
    if (req.body.pricePerProperty !== undefined) {
      pkgData.pricePerProperty = parseMoney(req.body.pricePerProperty) ?? null;
    }
    if (req.body.type !== undefined) pkgData.type = normalizePackageType(req.body.type);
    const features = parseFeatures(req.body.features);
    if (features !== null) pkgData.features = features;
    if (req.body.description !== undefined) {
      pkgData.description = String(req.body.description || "").trim();
      // لا نعيد بناء features من الوصف إلا إذا لم تكن مرسلة.
      if (features === null) {
        pkgData.features = pkgData.description
          ? [{ text: pkgData.description }]
          : [];
      }
    }
    if (req.body.isActive !== undefined) pkgData.isActive = req.body.isActive;
    if (req.body.audience !== undefined) {
      if (!isPackageAudience(req.body.audience)) {
        return res.status(400).json({ error: "مكان ظهور الباقة غير صحيح." });
      }
      pkgData.audience = req.body.audience;
    }
    if (req.body.isVisible !== undefined) pkgData.isVisible = req.body.isVisible === true;
    if (req.body.monthlyEnabled !== undefined) pkgData.monthlyEnabled = req.body.monthlyEnabled === true;
    if (req.body.quarterlyEnabled !== undefined) pkgData.quarterlyEnabled = req.body.quarterlyEnabled === true;
    if (req.body.sortOrder !== undefined) pkgData.sortOrder = parseSortOrder(req.body.sortOrder);
    if (req.body.featuredBadge !== undefined) pkgData.featuredBadge = String(req.body.featuredBadge || "").trim();
    if (req.body.isRecommended !== undefined) pkgData.isRecommended = req.body.isRecommended === true;
    if (req.body.discountStartsAt !== undefined) {
      const value = parseOfferDate(req.body.discountStartsAt);
      if (req.body.discountStartsAt !== "" && value === null) {
        return res.status(400).json({ error: "تاريخ بداية العرض غير صحيح." });
      }
      pkgData.discountStartsAt = value;
    }
    if (req.body.discountEndsAt !== undefined) {
      const value = parseOfferDate(req.body.discountEndsAt);
      if (req.body.discountEndsAt !== "" && value === null) {
        return res.status(400).json({ error: "تاريخ نهاية العرض غير صحيح." });
      }
      pkgData.discountEndsAt = value;
    }
    if (
      pkgData.discountStartsAt &&
      pkgData.discountEndsAt &&
      pkgData.discountStartsAt > pkgData.discountEndsAt
    ) {
      return res.status(400).json({ error: "بداية العرض يجب أن تسبق نهايته." });
    }
    if (req.body.propertyCount !== undefined) pkgData.propertyCount = Math.max(1, Number(req.body.propertyCount) || 1);
    if (req.body.maxProperties !== undefined) pkgData.maxProperties = req.body.maxProperties ? Math.max(1, Number(req.body.maxProperties) || 1) : null;

    const updated = await firebaseService.updatePackage(id, pkgData);
    if (!updated) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }
    if (pkgData.isRecommended === true) {
      await firebaseService.clearRecommendedPackages(id);
    }
    res.json(updated);
  } catch (error) {
    console.error("Error updating package:", error);
    if (error instanceof PackageFeatureValidationError) {
      return res.status(400).json({ error: error.message });
    }
    if (error instanceof RangeError) {
      return res.status(400).json({ error: servicePackageError(error) });
    }
    res.status(500).json({ error: "فشل في تحديث الباقة" });
  }
});

// أرشفة باقة (حذف منطقي يحافظ على السجلات التاريخية)
router.delete("/api/admin/packages/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await firebaseService.deletePackage(id);
    if (!deleted) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }
    res.json({ success: true, message: "تمت أرشفة الباقة" });
  } catch (error) {
    console.error("Error archiving package:", error);
    res.status(500).json({ error: "فشل في أرشفة الباقة" });
  }
});

export default router;
