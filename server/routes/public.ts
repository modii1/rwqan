import { Router, type RequestHandler } from "express";
import fs from "fs";
import path from "path";
import { propertyService, subscriptionService, discountService, notificationService, contentService, occasionService } from "../services";
import { firebaseService } from "../firebaseService";
import {
  R2ImageStorageUnavailableError,
  listR2PropertyImagesStrict,
} from "../utils/r2";
import { insertSuggestionSchema, type InsertProperty } from "../../shared/schema";
import { getNowInRiyadh, toRiyadhISO } from "../utils/dateUtils";
import { hasActiveCommissionHold } from "../../shared/propertyAvailability";

const router = Router();

// Permanent first-party alias used in owner renewal and upgrade messages.
router.get("/r", (_req, res) => {
  res.set("Cache-Control", "no-store, private");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.set("X-Content-Type-Options", "nosniff");
  return res.redirect(302, "/owner/subscription");
});

// ======================
// Developer Guide HTML
// ======================
router.get("/developer-guide", async (_req, res) => {
  try {
    const filePath = path.join(process.cwd(), "DEVELOPER_GUIDE.html");
    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.sendFile(filePath);
    } else {
      res.status(404).send("Developer Guide not found");
    }
  } catch (error) {
    console.error("Error serving developer guide:", error);
    res.status(500).send("Error loading developer guide");
  }
});

// ======================
// SEO: Sitemap.xml
// ======================
router.get("/sitemap.xml", async (_req, res) => {
  try {
    const baseUrl = "https://rwqan.sa";

    // جلب العقارات النشطة
    const properties = await propertyService.getAll();
    const activeProperties = properties.filter((p: any) =>
      !hasActiveCommissionHold(p) &&
      (p.verificationStatus === "approved" || p.verificationStatus === "verified")
    );

    // جلب المقالات
    let blogPosts: any[] = [];
    try {
      blogPosts = await contentService.getAllPosts();
    } catch (e) {
      console.log("No blog posts found for sitemap");
    }

    const today = new Date().toISOString().split('T')[0];

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${baseUrl}/properties</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${baseUrl}/blog</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
`;

    // إضافة صفحات العقارات
    for (const property of activeProperties) {
      xml += `  <url>
    <loc>${baseUrl}/property/${property.propertyNumber}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>
`;
    }

    // إضافة صفحات المدونة
    for (const post of blogPosts) {
      if (post.status === "منشور" && post.slug) {
        xml += `  <url>
    <loc>${baseUrl}/blog/${post.slug}</loc>
    <lastmod>${post.updatedAt || today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
`;
      }
    }

    xml += `</urlset>`;

    res.header("Content-Type", "application/xml");
    res.send(xml);
  } catch (error) {
    console.error("Error generating sitemap:", error);
    res.status(500).send("Error generating sitemap");
  }
});

// ======================
// SUGGESTIONS
// ======================
router.post("/api/suggestions", async (req, res) => {
  try {
    const validate = insertSuggestionSchema.parse(req.body);
    const x = await firebaseService.createSuggestion(validate);
    res.json(x);
  } catch {
    res.status(400).json({ error: "Invalid" });
  }
});

// ================================
// 🟢 REGISTER NEW PROPERTY (Public)
// ================================
router.post("/api/properties/register", async (req, res) => {
  try {
    const data = req.body;

    // Check duplicate property number
    const exists = await propertyService.getByNumber(data.propertyNumber);
    if (exists) {
      return res.status(400).json({ error: "رقم العقار مستخدم بالفعل" });
    }

    // تحويل الأسعار لنسخة متوافقة مع الشيت
    const prices = {
      display: "",                     // سعر العرض (فارغ دائماً)
      weekday: data.prices.weekday || "",
      weekend: data.prices.weekend || "",
      overnight: data.prices.overnight || "",
      special: "",                     // سعر خاص (اختياري)
      holidays: data.prices.holidays || "",
    };

    // تجهيز البيانات كما يتوقعه propertyToRow
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
      verificationStatus: "pending",
    };

    const created = await propertyService.create(newProperty);
    // Establish a fresh owner session only after creation succeeds. A session
    // store failure must not turn the durable registration into an apparent
    // failure that encourages the owner to submit the same property again.
    let ownerSessionEstablished = true;
    try {
      await new Promise<void>((resolve, reject) => {
        req.session.regenerate((error) => error ? reject(error) : resolve());
      });
      req.session.propertyNumber = newProperty.propertyNumber;
      await new Promise<void>((resolve, reject) => {
        req.session.save((error) => error ? reject(error) : resolve());
      });
    } catch (sessionError) {
      ownerSessionEstablished = false;
      console.error(
        "Property registered but owner session setup failed:",
        sessionError,
      );
    }

    // إرسال إشعار واتساب للمدير عند تسجيل عقار جديد
    console.log("📲 Sending WhatsApp notification for new registration:", data.propertyNumber);
    notificationService.newProperty({
      propertyNumber: data.propertyNumber,
      propertyName: data.name || "",
      ownerPhone: data.whatsappNumber || "",
      city: data.city || "",
      type: data.type || "",
    }).then(result => {
      console.log("📲 WhatsApp notification sent:", result);
    }).catch(err => {
      console.error("❌ WhatsApp notify error:", err);
    });

    if (!ownerSessionEstablished) {
      return res.status(201).json({
        ...created,
        registered: true,
        partial: true,
        sessionEstablished: false,
        loginRequired: true,
        message:
          "تم تسجيل العقار بنجاح، لكن تعذر تسجيل الدخول تلقائياً. سجّل الدخول برقم العقار والرقم السري لإكمال الاشتراك.",
      });
    }

    res.json(created);

  } catch (error) {
    console.error("Register property error:", error);
    res.status(500).json({ error: "خطأ أثناء تسجيل العقار" });
  }
});

// ======================================================
// 🖼️ PUBLIC — جلب صور العقار من R2 (للصفحة الرئيسية)
// ======================================================
// Fallback for requests without propertyNumber param
router.get("/api/public/property-images", (_req, res) => {
  res.json({ images: [] });
});

export function createPublicPropertyImagesHandler(
  listImages: (propertyNumber: string) => Promise<string[]> =
    listR2PropertyImagesStrict,
): RequestHandler {
  return async (req, res) => {
    try {
      const images = await listImages(req.params.propertyNumber);
      res.json({ images });
    } catch (err) {
      console.error(`[R2 IMAGES] ERROR for property ${req.params.propertyNumber}:`, err);
      if (err instanceof R2ImageStorageUnavailableError) {
        return res.status(503).json({
          code: "IMAGE_STORAGE_UNAVAILABLE",
          error: "تعذر تحميل صور العقار مؤقتاً",
        });
      }
      res.status(500).json({ error: "تعذر تحميل صور العقار" });
    }
  };
}

router.get(
  "/api/public/property-images/:propertyNumber",
  async (req, res, next) => {
    try {
      const property = await propertyService.getByNumber(req.params.propertyNumber);
      if (hasActiveCommissionHold(property)) {
        return res.status(423).json({ error: "هذا العقار غير متاح حالياً" });
      }
      next();
    } catch (error) {
      console.error("Public property image availability check failed:", error);
      return res.status(503).json({ error: "تعذر تحميل صور العقار مؤقتاً" });
    }
  },
  createPublicPropertyImagesHandler(),
);

// ======================
// 💳 PAYMENT CALCULATION
// ======================

// حساب تفاصيل الدفع الكاملة (الباقة + السعر + الخصم + العمولة)
router.post("/api/payment/calculate", async (req, res) => {
  try {
    const { packageId, discountCode } = req.body;

    if (!packageId) {
      return res.status(400).json({ error: "معرف الباقة مطلوب" });
    }

    // جلب بيانات الباقة
    const pkg = await subscriptionService.getPurchasablePackageById(packageId);
    if (!pkg) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    // السعر الأساسي
    let basePrice = pkg.price;
    let discountAmount = 0;
    let discountInfo: any = null;

    // حساب الخصم إن وجد
    if (discountCode) {
      const discount = await discountService.getByCode(discountCode);
      if (discount && discount.isActive) {
        discountInfo = discount;
        if (discount.type === "نسبة") {
          discountAmount = (basePrice * discount.value) / 100;
        } else {
          discountAmount = discount.value;
        }
      }
    }

    // السعر بعد الخصم
    const priceAfterDiscount = Math.max(0, basePrice - discountAmount);

    // عمولة Paymob (2.5% من السعر النهائي تقريباً)
    const PAYMOB_FEE_PERCENTAGE = 0.025; // 2.5%
    const paymobFee = Math.round(priceAfterDiscount * PAYMOB_FEE_PERCENTAGE * 100) / 100;

    // السعر الكلي المطلوب من العميل (يتحمل العمولة)
    const totalWithFee = priceAfterDiscount + paymobFee;

    res.json({
      package: {
        id: pkg.id,
        name: pkg.name,
        duration: pkg.duration,
        type: pkg.type,
      },
      pricing: {
        basePrice,
        discountCode: discountCode || null,
        discountInfo,
        discountAmount: Math.round(discountAmount * 100) / 100,
        priceAfterDiscount: Math.round(priceAfterDiscount * 100) / 100,
        paymobFee: paymobFee,
        total: Math.round(totalWithFee * 100) / 100,
      },
      breakdown: {
        "السعر الأساسي": `${basePrice} ر.س`,
        "الخصم": discountAmount > 0 ? `-${Math.round(discountAmount * 100) / 100} ر.س` : "لا يوجد",
        "السعر بعد الخصم": `${Math.round(priceAfterDiscount * 100) / 100} ر.س`,
        "عمولة Paymob (2.5%)": `${paymobFee} ر.س`,
        "الإجمالي": `${Math.round(totalWithFee * 100) / 100} ر.س`,
      },
    });
  } catch (err) {
    console.error("Payment calculation error:", err);
    res.status(500).json({ error: "خطأ في حساب الدفع" });
  }
});

// التحقق من كود الخصم
router.post("/api/discount/validate", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "كود مطلوب" });

    const discount = await discountService.getByCode(code);
    if (!discount || !discount.isActive) {
      return res.status(404).json({ error: "كود غير صالح" });
    }

    const expiryDate = new Date(discount.expiryDate || "2099-12-31");
    if (expiryDate < new Date()) {
      return res.status(400).json({ error: "انتهت صلاحية الكود" });
    }

    res.json(discount);
  } catch (err) {
    res.status(500).json({ error: "خطأ في التحقق من الكود" });
  }
});

// GET all available packages
router.get("/api/packages", async (req, res) => {
  try {
    const packages = await subscriptionService.getPackages();
    res.json(packages);
  } catch (err: any) {
    console.error("Get packages error:", err?.message);
    res.status(500).json({ error: "Failed to load packages" });
  }
});

// ======================
// 🎉 المناسبات النشطة (عروض العيد)
// ======================
router.get("/api/occasions/active", async (_req, res) => {
  try {
    const result = await occasionService.getActiveOccasionWithProperties();
    if (!result) {
      return res.json(null);
    }
    const visibleProperties = [];
    for (const occasionProperty of result.properties) {
      const property = await propertyService.getByNumber(occasionProperty.propertyNumber);
      if (!hasActiveCommissionHold(property)) visibleProperties.push(occasionProperty);
    }
    res.json({ ...result, properties: visibleProperties });
  } catch (err: any) {
    console.error("Get active occasion error:", err?.message);
    res.status(500).json({ error: "Failed to load occasion" });
  }
});

// جلب مناسبة بالـ slug
router.get("/api/occasions/:slug", async (req, res) => {
  try {
    const occasion = await occasionService.getOccasionBySlug(req.params.slug);
    const now = toRiyadhISO(getNowInRiyadh());
    if (!occasion || !occasion.isActive || !occasion.endDate || occasion.endDate < now) {
      return res.status(404).json({ error: "المناسبة غير موجودة" });
    }
    const properties = await occasionService.getOccasionProperties(occasion.id);
    const approved = [];
    for (const occasionProperty of properties) {
      if (!occasionProperty.approvedByAdmin) continue;
      const property = await propertyService.getByNumber(occasionProperty.propertyNumber);
      if (!hasActiveCommissionHold(property)) approved.push(occasionProperty);
    }
    res.json({ occasion, properties: approved });
  } catch (err: any) {
    console.error("Get occasion by slug error:", err?.message);
    res.status(500).json({ error: "Failed to load occasion" });
  }
});

export default router;
