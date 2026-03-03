import { Router } from "express";
import { requireAdmin } from "../middleware";
import { firebaseService } from "../../firebaseService";

const router = Router();

// ======================
// 📦 إدارة الباقات (Admin)
// ======================

// جلب جميع الباقات
router.get("/api/admin/packages", async (_req, res) => {
  try {
    const packages = await firebaseService.getAllPackages();
    res.json(packages);
  } catch (error) {
    console.error("Error fetching packages:", error);
    res.status(500).json({ error: "فشل في جلب الباقات" });
  }
});

// إنشاء باقة جديدة
router.post("/api/admin/packages", requireAdmin, async (req, res) => {
  try {
    const pkgData = {
      name: req.body.name || "",
      duration: req.body.duration || req.body.durationDays || 30,
      price: req.body.price || 0,
      type: req.body.type || "مميز",
      features: req.body.features || (req.body.description ? [req.body.description] : []),
      isActive: req.body.isActive !== false,
      propertyCount: req.body.propertyCount || 1,
    };
    const newPkg = await firebaseService.createPackage(pkgData);
    res.json(newPkg);
  } catch (error) {
    console.error("Error creating package:", error);
    res.status(500).json({ error: "فشل في إنشاء الباقة" });
  }
});

// تحديث باقة
router.put("/api/admin/packages/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const pkgData: any = {};
    if (req.body.name !== undefined) pkgData.name = req.body.name;
    if (req.body.duration !== undefined || req.body.durationDays !== undefined) {
      pkgData.duration = req.body.duration || req.body.durationDays;
    }
    if (req.body.price !== undefined) pkgData.price = req.body.price;
    if (req.body.type !== undefined) pkgData.type = req.body.type;
    if (req.body.features !== undefined) pkgData.features = req.body.features;
    if (req.body.description !== undefined && !req.body.features) {
      pkgData.features = req.body.description ? [req.body.description] : [];
    }
    if (req.body.isActive !== undefined) pkgData.isActive = req.body.isActive;
    if (req.body.propertyCount !== undefined) pkgData.propertyCount = req.body.propertyCount;

    const updated = await firebaseService.updatePackage(id, pkgData);
    if (!updated) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }
    res.json(updated);
  } catch (error) {
    console.error("Error updating package:", error);
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
