/**
 * Public Property Routes - list, detail, registration, suggestions
 */
import { Router } from "express";
import { propertyService, subscriptionService, contentService, notificationService } from "../services";
import { firebaseService } from "../firebaseService";
import { googleDriveService } from "../integrations/googleDrive";
import type { InsertProperty } from "../../shared/schema";
import { normalizeArabicText } from "../../src/lib/arabicSearch";
import { getEffectiveSubscriptionType, isActivePremiumSubscription } from "../../shared/core/subscriptions/type";
import { calculateRemainingDays } from "../utils/dateUtils";

const router = Router();

function toPublicProperty(property: any) {
  const {
    pin: _pin,
    whatsappNumber: _whatsappNumber,
    ...publicProperty
  } = property;
  return publicProperty;
}

function isExpiredSubscription(subscription: any): boolean {
  if (!subscription || subscription.status === "منتهي" || subscription.status === "expired") {
    return true;
  }
  return !subscription.endDate || calculateRemainingDays(subscription.endDate) < 0;
}

function getPublicSubscriptionFields(subscription: any, isSubscriptionExpired: boolean) {
  const storedSubscriptionType = subscription
    ? getEffectiveSubscriptionType({
        subscriptionType: subscription.subscriptionType,
        packageType: subscription.packageType,
        price: subscription.price,
      })
    : "عادي";
  const isPremiumActive = isActivePremiumSubscription({
    subscriptionType: storedSubscriptionType,
    status: subscription?.status,
    isExpired: isSubscriptionExpired,
  });

  return {
    subscriptionStatus: subscription?.status || null,
    subscriptionEndDate: subscription?.endDate || null,
    isSubscriptionExpired,
    // A property is public-facing premium only while its premium subscription is valid.
    subscriptionType: isPremiumActive ? storedSubscriptionType : "عادي",
    isPremiumActive,
  };
}

// GET all properties (public - only approved)
router.get("/api/properties", async (_req, res) => {
  try {
    const items = await propertyService.getAll();
    const withSubscriptionStatus = await Promise.all(
      items.map(async (p) => {
        const subscription = await subscriptionService.getByProperty(p.propertyNumber);
        const isSubscriptionExpired = isExpiredSubscription(subscription);
        
        return {
          ...toPublicProperty(p),
          ...getPublicSubscriptionFields(subscription, isSubscriptionExpired),
        };
      })
    );

    const filtered = withSubscriptionStatus.filter((p) => {
      if (p.verificationStatus) return p.verificationStatus === "approved";
      return true;
    });

    // Sort: premium properties first
    filtered.sort((a, b) => {
      const aIsPremium = (a as any).isPremiumActive ? 1 : 0;
      const bIsPremium = (b as any).isPremiumActive ? 1 : 0;
      return bIsPremium - aIsPremium;
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

    // Check subscription status
    const subscription = await subscriptionService.getByProperty(req.params.id);
    
    const isSubscriptionExpired = isExpiredSubscription(subscription);

    const response = {
      ...toPublicProperty(p),
      ...getPublicSubscriptionFields(subscription, isSubscriptionExpired),
    };

    return res.json(response);
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

// GET /api/search - Search with query params
router.get("/api/search", async (req, res) => {
  try {
    const { search, city, direction, type, facilities, maxPrice } = req.query;
    let items = await propertyService.getAll();
    items = items.filter((p) => {
      if (p.verificationStatus) return p.verificationStatus === "approved";
      return true;
    });

    // Apply subscription status
    items = await Promise.all(items.map(async (p) => {
      const subscription = await subscriptionService.getByProperty(p.propertyNumber);
      const isSubscriptionExpired = isExpiredSubscription(subscription);
      return {
        ...toPublicProperty(p),
        ...getPublicSubscriptionFields(subscription, isSubscriptionExpired),
      };
    }));

    // Filter by city
    if (city && city !== "all" && city !== "") {
      items = items.filter(p => p.city === city);
    }

    // Filter by direction
    if (direction && direction !== "all" && direction !== "") {
      items = items.filter(p => p.direction === direction);
    }

    // Filter by type
    if (type && type !== "all" && type !== "") {
      items = items.filter(p => p.type === type);
    }

    // Filter by facilities
    if (facilities) {
      const facilityList: string[] = (Array.isArray(facilities) ? facilities : [facilities])
        .flatMap((value) => String(value).split(","))
        .map((value) => value.trim())
        .filter(Boolean);
      items = items.filter(p => {
        const propFacilities: string[] = Array.isArray(p.facilities) ? p.facilities : [];
        return facilityList.every((f: string) => {
          // مبيت: تطابق العقارات التي لها سعر مبيت أو "مبيت" في المرافق
          if (f === "مبيت") {
            const hasInFacilities = propFacilities.some((pf: string) => pf.includes("مبيت") || "مبيت".includes(pf));
            const hasOvernightPrice = !!(p.prices?.overnight && p.prices.overnight !== "0" && p.prices.overnight !== "");
            return hasInFacilities || hasOvernightPrice;
          }
          return propFacilities.some((pf: string) => pf.includes(f) || f.includes(pf));
        });
      });
    }

    // Filter by max price (weekend price)
    if (maxPrice && !isNaN(Number(maxPrice))) {
      const price = Number(maxPrice);
      items = items.filter(p => {
        const propPrice = parseFloat(p.prices?.weekend || p.prices?.weekday || "0");
        return propPrice <= price;
      });
    }

    // Apply text search
    if (search && typeof search === "string" && search.trim()) {
      const normalizedSearch = normalizeArabicText(search);
      items = items.filter(p => {
        const parts: (string | null | undefined)[] = [
          p.propertyNumber,
          p.name,
          p.city,
          p.direction,
          p.type,
          p.lastChanges,
          // المرافق
          ...(Array.isArray(p.facilities) ? p.facilities : []),
          // إضافة "مبيت" كلمة مفتاحية إذا كان سعر المبيت محددًا
          (p.prices?.overnight && p.prices.overnight !== "0" && p.prices.overnight !== "") ? "مبيت" : null,
          // أي حقول نصية إضافية قد تكون موجودة في Firestore
          (p as any).description,
          (p as any).notes,
          (p as any).seoDescription,
        ];
        const normalizedQuery = normalizeArabicText(parts.filter(Boolean).join(" "));
        return normalizedQuery.includes(normalizedSearch);
      });
    }

    // Sort: premium properties first
    items.sort((a, b) => {
      const aIsPremium = (a as any).isPremiumActive ? 1 : 0;
      const bIsPremium = (b as any).isPremiumActive ? 1 : 0;
      return bIsPremium - aIsPremium;
    });

    res.json(items);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "فشل في البحث" });
  }
});

// GET /api/cities - Returns cities with count and random property image
router.get("/api/cities", async (_req, res) => {
  try {
    const items = await propertyService.getAll();
    const now = new Date();

    // Only approved properties
    const approved = items.filter((p) => {
      if (p.verificationStatus) return p.verificationStatus === "approved";
      return true;
    });

    const CITIES = ["بريدة", "عنيزة", "الرس", "البكيرية", "المذنب", "البدائع", "الأسياح", "رياض الخبراء", "عيون الجواء"];

    const result = CITIES.map((city) => {
      const cityProperties = approved.filter((p) => p.city === city);
      const randomProperty = cityProperties[Math.floor(Math.random() * cityProperties.length)];
      return {
        name: city,
        count: cityProperties.length,
        image: randomProperty?.imageUrls?.[0] || "/assets/placeholder-property.jpg",
      };
    }).filter((c) => c.count > 0);

    res.json(result);
  } catch (err) {
    console.error("Cities fetch error:", err);
    res.status(500).json({ error: "فشل في جلب المدن" });
  }
});

export default router;
