/**
 * Public Property Routes - list, detail, registration, suggestions
 */
import { Router } from "express";
import { propertyService, subscriptionService, contentService, notificationService } from "../services";
import { firebaseService } from "../firebaseService";
import { googleDriveService } from "../integrations/googleDrive";
import type { InsertProperty } from "../../shared/schema";

const router = Router();

// GET all properties (public - only approved)
router.get("/api/properties", async (_req, res) => {
  try {
    const items = await propertyService.getAll();
    const filtered = items.filter((p) => {
      if (p.verificationStatus) return p.verificationStatus === "approved";
      return true;
    });
    res.json(filtered);
  } catch (err) {
    console.error("Properties fetch error:", err);
    res.status(500).json({ error: "فشل في جلب العقارات" });
  }
});

// GET single property
router.get("/api/properties/:id", async (req, res) => {
  try {
    const p = await propertyService.getByNumber(req.params.id);
    if (!p) return res.status(404).json({ error: "العقار غير موجود" });

    if (p.verificationStatus && p.verificationStatus !== "approved") {
      return res.status(403).json({ error: "هذا العقار غير متاح حالياً", status: p.verificationStatus });
    }
    return res.json(p);
  } catch (err) {
    console.error("Property Fetch Error:", err);
    res.status(500).json({ error: "خطأ غير معروف" });
  }
});

// CREATE property (admin shortcut)
router.post("/api/properties", async (req, res) => {
  try {
    const data = req.body;
    const exists = await propertyService.getByNumber(data.propertyNumber);
    if (exists) return res.status(400).json({ error: "رقم العقار مستخدم بالفعل" });

    const folderId = await googleDriveService.createPropertyFolder(data.propertyNumber, data.name);
    const created = await propertyService.create({ ...data, driveFolderId: folderId, imageUrls: [] });

    notificationService.newProperty({
      propertyNumber: data.propertyNumber,
      propertyName: data.name || "",
      ownerPhone: data.whatsappNumber || "",
      city: data.city || "",
      type: data.type || "",
    }).catch(err => console.error("WhatsApp notify error:", err));

    res.json(created);
  } catch (err) {
    res.status(500).json({ error: "خطأ أثناء إنشاء العقار" });
  }
});

// UPDATE property
router.put("/api/properties/:propertyNumber", async (req, res) => {
  try {
    const incoming = req.body;
    const { SHEET_MAP } = await import("../utils/helpers");
    const mapped: Record<string, any> = {};
    const REVERSE_MAP: Record<string, string> = {
      name: "اسم العقار", whatsappNumber: "رقم الجوال", location: "الموقع",
      city: "المنطقة", direction: "الاتجاه", type: "النوع", facilities: "المرافق",
      imagesLink: "رابط الصور", priceOffer: "سعر العرض",
      priceWeekdays: "سعر وسط الأسبوع", weekdayPrice: "سعر وسط الأسبوع",
      priceWeekend: "سعر نهاية الأسبوع", weekendPrice: "سعر نهاية الأسبوع",
      priceNight: "سعر المبيت", overnightPrice: "سعر المبيت",
      priceSpecial: "سعر خاص", specialPrice: "سعر خاص",
      priceHolidays: "سعر الإجازات", holidayPrice: "سعر الإجازات",
      subscriptionType: "نوع الاشتراك", subscriptionDate: "تاريخ الاشتراك",
    };

    const changesForNotification: string[] = [];
    for (const key in incoming) {
      if (key === "pin") continue;
      if (SHEET_MAP[key]) {
        mapped[SHEET_MAP[key]] = incoming[key];
        const arabicName = Object.entries(SHEET_MAP).find(([_, v]) => v === SHEET_MAP[key])?.[0]?.replace(/[^\u0600-\u06FF\s]/g, '').trim() || key;
        changesForNotification.push(`${arabicName}: ${incoming[key]}`);
      } else {
        mapped[key] = incoming[key];
        const arabicName = REVERSE_MAP[key] || key;
        changesForNotification.push(`${arabicName}: ${incoming[key]}`);
      }
    }
    delete mapped.propertyNumber;
    delete mapped.pin;

    const changesSummary = changesForNotification.map(c => c.split(':')[0].trim()).filter(Boolean).slice(0, 5).join('، ');
    mapped.lastChanges = changesSummary || 'تحديث عام';

    const updated = await propertyService.update(req.params.propertyNumber, mapped, { skipVerification: true });
    if (!updated) return res.status(404).json({ error: "العقار غير موجود" });

    const changesText = changesForNotification.length > 0 ? changesForNotification.join("\n") : "تم تحديث البيانات";
    notificationService.propertyUpdated({
      propertyNumber: req.params.propertyNumber,
      propertyName: updated.name || "",
      changes: changesText,
    }).catch(err => console.error("WhatsApp notify error:", err));

    res.json(updated);
  } catch (error) {
    console.error("Update Error:", error);
    res.status(500).json({ error: "فشل في تحديث العقار" });
  }
});

// DELETE property
router.delete("/api/properties/:propertyNumber", async (req, res) => {
  try {
    await propertyService.delete(req.params.propertyNumber);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "فشل في حذف العقار" });
  }
});

// REGISTER new property (public)
router.post("/api/properties/register", async (req, res) => {
  try {
    const data = req.body;
    const exists2 = await propertyService.getByNumber(data.propertyNumber);
    if (exists2) return res.status(400).json({ error: "رقم العقار مستخدم بالفعل" });

    const prices = {
      display: "", weekday: data.prices.weekday || "", weekend: data.prices.weekend || "",
      overnight: data.prices.overnight || "", special: "", holidays: data.prices.holidays || "",
    };

    const newProperty: InsertProperty = {
      propertyNumber: String(data.propertyNumber || ""),
      name: String(data.name || ""),
      whatsappNumber: String(data.whatsappNumber || ""),
      location: String(data.location || ""),
      city: (data.city as any) || "بريدة",
      direction: (data.direction as any) || "شمال",
      type: (data.type as any) || "قسم",
      facilities: Array.isArray(data.facilities) ? data.facilities : [],
      imagesLink: "",
      prices,
      subscriptionType: "عادي",
      subscriptionDate: "",
      pin: String(data.pin || ""),
      imageUrls: [],
    };

    const created2 = await propertyService.create(newProperty);

    notificationService.newProperty({
      propertyNumber: data.propertyNumber,
      propertyName: data.name || "",
      ownerPhone: data.whatsappNumber || "",
      city: data.city || "",
      type: data.type || "",
    }).catch(err => console.error("❌ WhatsApp notify error:", err));

    res.json(created2);
  } catch (error) {
    console.error("Register property error:", error);
    res.status(500).json({ error: "خطأ أثناء تسجيل العقار" });
  }
});

// SUGGESTIONS
router.post("/api/suggestions", async (req, res) => {
  try {
    const { insertSuggestionSchema } = await import("@shared/schema");
    const validate = insertSuggestionSchema.parse(req.body);
    const x = await firebaseService.createSuggestion(validate);
    res.json(x);
  } catch {
    res.status(400).json({ error: "Invalid" });
  }
});

// Property SEO (public)
router.get("/api/properties/:id/seo", async (req, res) => {
  try {
    const { id } = req.params;
    const seo = await contentService.getPropertySeo(id);
    res.json(seo || { propertyNumber: id, seoDescription: "", metaTitle: "", keywords: [] });
  } catch (err) {
    console.error("Error fetching property SEO:", err);
    res.status(500).json({ error: "فشل في جلب بيانات SEO" });
  }
});

// Packages (public)
router.get("/api/packages", async (req, res) => {
  try {
    const packages = await subscriptionService.getPackages();
    res.json(packages);
  } catch (err: any) {
    console.error("Get packages error:", err?.message);
    res.status(500).json({ error: "Failed to load packages" });
  }
});

export default router;
