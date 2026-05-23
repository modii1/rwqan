import { Router } from "express";
import { requireAdmin } from "../middleware";
import { occasionService, propertyService } from "../../services";

const router = Router();

// ======================
// 🎉 إدارة المناسبات (Occasions)
// ======================

// جلب كل المناسبات
router.get("/api/admin/occasions", requireAdmin, async (_req, res) => {
  try {
    const occasions = await occasionService.getAllOccasions();
    res.json(occasions);
  } catch (error) {
    console.error("Error fetching occasions:", error);
    res.status(500).json({ error: "فشل في جلب المناسبات" });
  }
});

// جلب مناسبة محددة
router.get("/api/admin/occasions/:id", requireAdmin, async (req, res) => {
  try {
    const occasion = await occasionService.getOccasionById(req.params.id);
    if (!occasion) {
      return res.status(404).json({ error: "المناسبة غير موجودة" });
    }
    res.json(occasion);
  } catch (error) {
    console.error("Error fetching occasion:", error);
    res.status(500).json({ error: "فشل في جلب المناسبة" });
  }
});

// إنشاء مناسبة جديدة
router.post("/api/admin/occasions", requireAdmin, async (req, res) => {
  try {
    const { name, slug, type, startDate, endDate, days, isActive, theme, description } = req.body;

    if (!name || !slug || !type || !startDate || !endDate || !days || !Array.isArray(days)) {
      return res.status(400).json({ error: "بيانات المناسبة غير مكتملة" });
    }

    const occasion = await occasionService.createOccasion({
      name,
      slug,
      type,
      startDate,
      endDate,
      days,
      isActive: isActive ?? false,
      theme: theme || 'default',
      description,
    });

    res.status(201).json(occasion);
  } catch (error) {
    console.error("Error creating occasion:", error);
    res.status(500).json({ error: "فشل في إنشاء المناسبة" });
  }
});

// تحديث مناسبة
router.put("/api/admin/occasions/:id", requireAdmin, async (req, res) => {
  try {
    const occasion = await occasionService.updateOccasion(req.params.id, req.body);
    res.json(occasion);
  } catch (error: any) {
    console.error("Error updating occasion:", error);
    if (error.message?.includes("not found")) {
      return res.status(404).json({ error: "المناسبة غير موجودة" });
    }
    res.status(500).json({ error: "فشل في تحديث المناسبة" });
  }
});

// حذف مناسبة
router.delete("/api/admin/occasions/:id", requireAdmin, async (req, res) => {
  try {
    await occasionService.deleteOccasion(req.params.id);
    res.json({ success: true, message: "تم حذف المناسبة بنجاح" });
  } catch (error) {
    console.error("Error deleting occasion:", error);
    res.status(500).json({ error: "فشل في حذف المناسبة" });
  }
});

// ======================
// 🏠 إدارة عقارات المناسبات
// ======================

// جلب عقارات مناسبة محددة
router.get("/api/admin/occasions/:id/properties", requireAdmin, async (req, res) => {
  try {
    const properties = await occasionService.getOccasionProperties(req.params.id);
    res.json(properties);
  } catch (error) {
    console.error("Error fetching occasion properties:", error);
    res.status(500).json({ error: "فشل في جلب عقارات المناسبة" });
  }
});

// إضافة عقار لمناسبة
router.post("/api/admin/occasions/:id/properties", requireAdmin, async (req, res) => {
  try {
    const { propertyNumber, availability, prices } = req.body;
    const occasionId = req.params.id;

    if (!propertyNumber) {
      return res.status(400).json({ error: "رقم العقار مطلوب" });
    }

    // Verify property exists
    const property = await propertyService.getByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    // Verify occasion exists
    const occasion = await occasionService.getOccasionById(occasionId);
    if (!occasion) {
      return res.status(404).json({ error: "المناسبة غير موجودة" });
    }

    const result = await occasionService.addPropertyToOccasion({
      occasionId,
      propertyNumber,
      availability: availability || {},
      prices: prices || {},
      addedBy: 'admin',
      approvedByAdmin: true,
    });

    res.status(201).json(result);
  } catch (error) {
    console.error("Error adding property to occasion:", error);
    res.status(500).json({ error: "فشل في إضافة العقار للمناسبة" });
  }
});

// إضافة عدة عقارات دفعة واحدة
router.post("/api/admin/occasions/:id/properties/bulk", requireAdmin, async (req, res) => {
  try {
    const { propertyNumbers } = req.body;
    const occasionId = req.params.id;

    if (!propertyNumbers || !Array.isArray(propertyNumbers) || propertyNumbers.length === 0) {
      return res.status(400).json({ error: "أرقام العقارات مطلوبة" });
    }

    const results = await occasionService.bulkAddProperties(occasionId, propertyNumbers, 'admin');
    res.status(201).json({ added: results.length, properties: results });
  } catch (error: any) {
    console.error("Error bulk adding properties:", error);
    if (error.message?.includes("not found")) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: "فشل في إضافة العقارات" });
  }
});

// تحديث بيانات عقار في مناسبة (التوفر والأسعار)
router.put("/api/admin/occasions/:id/properties/:propertyNumber", requireAdmin, async (req, res) => {
  try {
    const { availability, prices, approvedByAdmin, notes } = req.body;
    const { id: occasionId, propertyNumber } = req.params;

    const existing = await occasionService.getOccasionProperty(occasionId, propertyNumber);
    if (!existing) {
      return res.status(404).json({ error: "العقار غير موجود في هذه المناسبة" });
    }

    const updates: any = {};
    if (availability !== undefined) updates.availability = availability;
    if (prices !== undefined) updates.prices = prices;
    if (approvedByAdmin !== undefined) updates.approvedByAdmin = approvedByAdmin;
    if (notes !== undefined) updates.notes = notes;

    const result = await occasionService.updateOccasionProperty(existing.id, updates);
    res.json(result);
  } catch (error) {
    console.error("Error updating occasion property:", error);
    res.status(500).json({ error: "فشل في تحديث بيانات العقار" });
  }
});

// إزالة عقار من مناسبة
router.delete("/api/admin/occasions/:id/properties/:propertyNumber", requireAdmin, async (req, res) => {
  try {
    await occasionService.removePropertyFromOccasion(req.params.id, req.params.propertyNumber);
    res.json({ success: true, message: "تم إزالة العقار من المناسبة" });
  } catch (error) {
    console.error("Error removing property from occasion:", error);
    res.status(500).json({ error: "فشل في إزالة العقار" });
  }
});

export default router;
