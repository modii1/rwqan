import { Router } from "express";
import { storage } from "../storage";
import { googleDriveService } from "../googleDrive";
import { notifyNewProperty, notifyPropertyUpdate } from "../whatsapp";
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

const REVERSE_MAP: Record<string, string> = {
  name: "اسم العقار",
  whatsappNumber: "رقم الجوال",
  location: "الموقع",
  city: "المنطقة",
  direction: "الاتجاه",
  type: "النوع",
  facilities: "المرافق",
  imagesLink: "رابط الصور",
  priceOffer: "سعر العرض",
  priceWeekdays: "سعر وسط الأسبوع",
  weekdayPrice: "سعر وسط الأسبوع",
  priceWeekend: "سعر نهاية الأسبوع",
  weekendPrice: "سعر نهاية الأسبوع",
  priceNight: "سعر المبيت",
  overnightPrice: "سعر المبيت",
  priceSpecial: "سعر خاص",
  specialPrice: "سعر خاص",
  priceHolidays: "سعر الإجازات",
  holidayPrice: "سعر الإجازات",
  subscriptionType: "نوع الاشتراك",
  subscriptionDate: "تاريخ الاشتراك",
};

router.get("/api/properties", async (_req: Request, res: Response) => {
  try {
    const items = await storage.getProperties();
    const filtered = items.filter((p) => {
      if (p.verificationStatus) {
        return p.verificationStatus === "approved";
      }
      return true;
    });
    res.json(filtered);
  } catch (err) {
    console.error("Properties fetch error:", err);
    res.status(500).json({ error: "فشل في جلب العقارات" });
  }
});

router.get("/api/properties/:id", async (req: Request, res: Response) => {
  try {
    const p = await storage.getPropertyByNumber(req.params.id);
    if (!p) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }
    if (p.verificationStatus) {
      if (p.verificationStatus !== "approved") {
        return res.status(403).json({
          error: "هذا العقار غير متاح حالياً",
          status: p.verificationStatus,
        });
      }
    }
    return res.json(p);
  } catch (err) {
    console.error("Property Fetch Error:", err);
    res.status(500).json({ error: "خطأ غير معروف" });
  }
});

router.post("/api/properties", async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const exists = await storage.getPropertyByNumber(data.propertyNumber);
    if (exists) {
      return res.status(400).json({ error: "رقم العقار مستخدم بالفعل" });
    }

    const folderId = await googleDriveService.createPropertyFolder(
      data.propertyNumber,
      data.name
    );

    const created = await storage.createProperty({
      ...data,
      driveFolderId: folderId,
      imageUrls: [],
    });

    notifyNewProperty({
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

router.put("/api/properties/:propertyNumber", async (req: Request, res: Response) => {
  try {
    const incoming = req.body;
    const mapped: Record<string, any> = {};
    const changesForNotification: string[] = [];

    for (const key in incoming) {
      if (key === "pin") continue;

      if (SHEET_MAP[key]) {
        mapped[SHEET_MAP[key]] = incoming[key];
      } else {
        mapped[key] = incoming[key];
      }
      const arabicName = REVERSE_MAP[key] || key;
      changesForNotification.push(`${arabicName}: ${incoming[key]}`);
    }

    delete mapped.propertyNumber;
    delete mapped.pin;

    const changesSummary = changesForNotification.map(c => c.split(':')[0].trim()).filter(Boolean).slice(0, 5).join('، ');
    mapped.lastChanges = changesSummary || 'تحديث عام';

    const updated = await storage.updateProperty(req.params.propertyNumber, mapped);

    if (!updated) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    const changesText = changesForNotification.length > 0
      ? changesForNotification.join("\n")
      : "تم تحديث البيانات";
    notifyPropertyUpdate({
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

router.delete("/api/properties/:propertyNumber", async (req: Request, res: Response) => {
  try {
    await storage.deleteProperty(req.params.propertyNumber);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "فشل في حذف العقار" });
  }
});

export default router;
