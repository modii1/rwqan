import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import cors from "cors";
import type { CorsOptions } from "cors";

import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";

import { storage } from "./storage";
import { googleSheetsService } from "./googleSheets";
import { googleDriveService } from "./googleDrive";
import { paymobService } from "./paymob";

import session from "express-session";
import MemoryStore from "memorystore";
import multer from "multer";
import * as https from "https";

// Create memory store for sessions
const memoryStore = new (MemoryStore(session))({});

import {
  insertPropertySchema,
  insertSuggestionSchema,
  insertDiscountCodeSchema,
  insertPackageSchema,
  type InsertProperty,
} from "@shared/schema";

const upload = multer({ storage: multer.memoryStorage() });


const r2 = new S3Client({
  region: process.env.R2_REGION || "",
  endpoint: process.env.R2_ENDPOINT || "",
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || "https://pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev";

// ==========================
// Mapping Google Sheet Columns
// ==========================
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

// Session type augmentation
declare global {
  namespace Express {
    interface Session {
      propertyNumber?: string;
    }
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  // ======================
  // CORS FIX
  // ======================
  const corsOptions: CorsOptions = {
    origin: true,
    credentials: true,
  };
  app.use(cors(corsOptions));

  app.post("/api/owner/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });



  // ======================
  // Google Sheets Init
  // ======================
  try {
    await googleSheetsService.initializeSheets();
  } catch (err) {
    console.error("Sheets Init Error:", err);
  }

  // ======================
  // SESSION
  // ======================
  const isProduction = process.env.NODE_ENV === "production";

  app.set("trust proxy", 1);

  app.use(
    session({
      store: memoryStore,
      secret: process.env.SESSION_SECRET || "moddy-secret-key",
      resave: false,
      saveUninitialized: false,
      proxy: true,
      cookie: {
        maxAge: 86400000,
        secure: isProduction,
        httpOnly: true,
        sameSite: "lax",
      },
    })
  );

  // ======================
  // PUBLIC API
  // ======================

  // GET all properties (frontend + admin)
  app.get("/api/properties", async (_req, res) => {
    try {
      const items = await storage.getProperties();
      res.json(items);
    } catch (err) {
      res.status(500).json({ error: "فشل في جلب العقارات" });
    }
  });

  // GET single property
  app.get("/api/properties/:id", async (req, res) => {
    try {
      const p = await storage.getPropertyByNumber(req.params.id);
      if (!p) return res.status(404).json({ error: "Not Found" });
      res.json(p);
    } catch (err) {
      res.status(500).json({ error: "خطأ غير معروف" });
    }
  });

  // CREATE new property (admin)
  app.post("/api/properties", async (req, res) => {
    try {
      const data = req.body;

      const exists = await storage.getPropertyByNumber(data.propertyNumber);
      if (exists)
        return res.status(400).json({ error: "رقم العقار مستخدم بالفعل" });

      const folderId = await googleDriveService.createPropertyFolder(
        data.propertyNumber,
        data.name
      );

      const created = await storage.createProperty({
        ...data,
        driveFolderId: folderId,
        imageUrls: [],
      });

      res.json(created);
    } catch (err) {
      res.status(500).json({ error: "خطأ أثناء إنشاء العقار" });
    }
  });

  // UPDATE property (admin)
  app.put("/api/properties/:propertyNumber", async (req, res) => {
    try {
      const incoming = req.body;
      const mapped: Record<string, any> = {};

      for (const key in incoming) {
        if (SHEET_MAP[key]) mapped[SHEET_MAP[key]] = incoming[key];
      }

      delete mapped.propertyNumber;

      const updated = await storage.updateProperty(
        req.params.propertyNumber,
        mapped
      );

      if (!updated)
        return res.status(404).json({ error: "العقار غير موجود" });

      res.json(updated);
    } catch (error) {
      console.error("Update Error:", error);
      res.status(500).json({ error: "فشل في تحديث العقار" });
    }
  });

  // DELETE property
  app.delete("/api/properties/:propertyNumber", async (req, res) => {
    try {
      await storage.deleteProperty(req.params.propertyNumber);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "فشل في حذف العقار" });
    }
  });

  // ======================
  // SUGGESTIONS
  // ======================
  app.post("/api/suggestions", async (req, res) => {
    try {
      const validate = insertSuggestionSchema.parse(req.body);
      const x = await storage.createSuggestion(validate);
      res.json(x);
    } catch {
      res.status(400).json({ error: "Invalid" });
    }
  });

  // ======================
  // OWNER AUTH
  // ======================

  const requireOwner = (req: Request, res: Response, next: NextFunction) => {
    if (!(req.session as any).propertyNumber)
      return res.status(401).json({ error: "Login Required" });

    (req as any).propertyNumber = (req.session as any).propertyNumber;
    next();
  };

  app.post("/api/owner/login", async (req, res) => {
    const { propertyNumber, pin } = req.body;

    const p = await storage.getPropertyByNumber(propertyNumber);
    if (!p || p.pin !== pin)
      return res.status(401).json({ error: "Invalid Credentials" });

    (req.session as any).propertyNumber = propertyNumber;
    req.session.save((err: any) => {
      if (err) {
        return res.status(500).json({ error: "Session save failed" });
      }
      res.json({ ok: true });
    });
  });

  app.get("/api/owner/property", requireOwner, async (req: any, res) => {
    const p = await storage.getPropertyByNumber(req.propertyNumber);
    res.json(p);
  });

  // ======================
  // GOOGLE DRIVE PROXY
  // ======================

  async function fetchDrive(id: string) {
    const url = `https://drive.google.com/uc?export=download&id=${id}`;

    return new Promise<{ data: Buffer; contentType?: string }>((resolve, reject) => {
      https
        .get(url, (resp) => {
          const chunks: Buffer[] = [];
          resp.on("data", (c) => chunks.push(c));
          resp.on("end", () => {
            resolve({
              data: Buffer.concat(chunks),
              contentType: resp.headers["content-type"],
            });
          });
        })
        .on("error", reject);
    });
  }

  app.get("/proxy/drive/:id", async (req, res) => {
    try {
      const { data, contentType } = await fetchDrive(req.params.id);
      res.setHeader("Content-Type", contentType || "image/jpeg");
      res.send(data);
    } catch (err) {
      console.error("Drive Proxy Error:", err);
      res.status(500).send("fetch error");
    }
  });

  // ======================
  // ADMIN ROUTES
  // ======================

  // Admin: Get all properties
  app.get("/api/admin/properties", async (_req, res) => {
    try {
      const items = await storage.getProperties();
      res.json(items);
    } catch (err) {
      console.error("Admin get properties error:", err);
      res.status(500).json({ error: "فشل في جلب العقارات" });
    }
  });

  // Admin: Update property
  app.put("/api/admin/properties/:propertyNumber", async (req, res) => {
    try {
      const { propertyNumber } = req.params;
      const body = req.body;

      // Convert Arabic keys to English
      const updates: any = {};
      for (const [key, value] of Object.entries(body)) {
        const mapped = SHEET_MAP[key];
        if (mapped) {
          updates[mapped] = value;
        } else {
          // Try direct key
          updates[key] = value;
        }
      }

      const updated = await storage.updateProperty(propertyNumber, updates);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "فشل في التحديث" });
    }
  });

  // Admin: Create property
  app.post("/api/admin/properties", async (req, res) => {
    try {
      const body = req.body;

      // Convert Arabic keys to English
      const data: any = {};
      for (const [key, value] of Object.entries(body)) {
        const mapped = SHEET_MAP[key];
        if (mapped) {
          data[mapped] = value;
        } else {
          data[key] = value;
        }
      }

      // Check if exists
      const exists = await storage.getPropertyByNumber(data.propertyNumber);
      if (exists) {
        return res.status(400).json({ error: "رقم العقار مستخدم بالفعل" });
      }

      // Create Drive folder
      const folderId = await googleDriveService.createPropertyFolder(
        data.propertyNumber,
        data.name
      );

      const created = await storage.createProperty({
        ...data,
        driveFolderId: folderId,
        imageUrls: [],
      });

      res.json(created);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "فشل في الإنشاء" });
    }
  });

  // Admin: Delete property
  app.delete("/api/admin/properties/:propertyNumber", async (req, res) => {
    try {
      await storage.deleteProperty(req.params.propertyNumber);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "فشل في الحذف" });
    }
  });

  // ======================
  // OWNER SESSION CHECK
  // ======================
  app.get("/api/owner/session", (req, res) => {
    const isLoggedIn = Boolean((req.session as any).propertyNumber);

    res.json({
      isLoggedIn,
      propertyNumber: (req.session as any).propertyNumber || null,
    });
  });

  // ======================================================
  // 🔵 جلب صور العقار من R2
  // ======================================================
  app.get("/api/owner/r2-images", requireOwner, async (req, res) => {
    try {
      const propertyNumber = (req.session as any).propertyNumber;

      console.log(`🔍 [FETCH] Getting images for property ${propertyNumber}`);

      if (!propertyNumber || !R2_BUCKET) {
        console.error("❌ [FETCH] Missing propertyNumber or R2_BUCKET");
        return res.json({ images: [] });
      }

      const list = await r2.send(
        new ListObjectsV2Command({
          Bucket: R2_BUCKET,
          Prefix: `${propertyNumber}/`,
          MaxKeys: 100,
        })
      );

      const count = list.Contents?.length || 0;
      console.log(`✅ [FETCH] Found ${count} images for ${propertyNumber}`);
      console.log(`📊 [FETCH] Objects:`, list.Contents?.map(o => o.Key));

      let images =
        list.Contents?.map(obj => `${R2_PUBLIC_URL}/${obj.Key}`) || [];

      // ترتيب حسب رقم الصورة 1,2,3...
      images.sort((a, b) => {
        const aParts = a.split("/").pop() || "";
        const bParts = b.split("/").pop() || "";
        const na = parseInt(aParts.replace(".jpg", "")) || 0;
        const nb = parseInt(bParts.replace(".jpg", "")) || 0;
        return na - nb;
      });

      console.log(`✅ [FETCH] Returning ${images.length} image URLs`);
      res.json({ images });

    } catch (err: any) {
      console.error("❌ [FETCH] Error:", err?.message);
      res.json({ images: [] });
    }
  });

  // ======================================================
  // 🟢 رفع صور المالك إلى R2
  // ======================================================
  app.post("/api/owner/images", requireOwner, upload.array("images"), async (req, res) => {
    try {
      const propertyNumber = (req.session as any).propertyNumber || "";
      
      console.log(`📸 [UPLOAD] Property ${propertyNumber}, Files:`, req.files?.length);
      
      if (!propertyNumber) {
        console.error("❌ [UPLOAD] No property number in session");
        return res.status(400).json({ error: "Property number not found in session" });
      }

      if (!R2_BUCKET) {
        console.error("❌ [UPLOAD] R2_BUCKET not configured");
        return res.status(500).json({ error: "R2 bucket not configured" });
      }

      const files = (req.files as any) || [];
      if (!files || files.length === 0) {
        console.error("❌ [UPLOAD] No files received");
        return res.status(400).json({ error: "لا توجد صور تم رفعها" });
      }

      const uploadedKeys: string[] = [];
      const timestamp = Date.now();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // استخدام timestamp + index لتجنب التكرار
        const key = `${propertyNumber}/${timestamp}-${i}.jpg`;
        
        console.log(`⬆️ [UPLOAD] Uploading ${key} (${file.size} bytes)`);
        
        await r2.send(
          new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: key,
            Body: file.buffer,
            ContentType: "image/jpeg",
            ACL: "public-read",
          })
        );
        console.log(`✅ [UPLOAD] Uploaded ${key}`);
        uploadedKeys.push(key);
      }

      // تحويل keys إلى URLs مباشرة
      const uploadedUrls = uploadedKeys.map(key => `${R2_PUBLIC_URL}/${key}`);
      console.log(`✅ [UPLOAD] Done! Uploaded ${files.length} images. URLs:`, uploadedUrls);
      res.json({ ok: true, count: files.length, uploaded: uploadedKeys, urls: uploadedUrls });

    } catch (err: any) {
      console.error("❌ [UPLOAD] Error:", err?.message);
      const errorMsg = err?.message || "فشل الرفع";
      res.status(500).json({ error: errorMsg });
    }
  });

  // ======================================================
  // 🔴 حذف صورة من R2 باستخدام URL
  // ======================================================
  app.post("/api/owner/images/delete", requireOwner, async (req, res) => {
    try {
      const propertyNumber = (req.session as any).propertyNumber || "";
      const { url } = req.body;

      if (!url) {
        return res.status(400).json({ error: "URL مطلوبة" });
      }

      // استخراج الـ key من URL: https://.../{propertyNumber}/{fileName}
      const key = `${propertyNumber}/${url.split("/").pop()}`;

      console.log(`🔴 [DELETE] Deleting: ${key}`);

      await r2.send(
        new DeleteObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
        })
      );

      console.log(`✅ [DELETE] Deleted: ${key}`);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("❌ [DELETE] Error:", err?.message);
      res.status(500).json({ error: "فشل الحذف" });
    }
  });


  app.get("/api/packages", async (_req, res) => {
    try {
      const rows = await googleSheetsService.readSheet("الباقات");

      if (!rows || rows.length <= 1) {
        return res.json([]);
      }

      const packages = rows.slice(1).map((row) => ({
        id: row[0],
        name: row[1],
        duration: Number(row[2]),
        price: Number(row[3]),
        type: row[4],
        features: parseFeatures(row[5]),
        isActive: String(row[6]).toLowerCase() === "true",
        createdAt: row[7] || "",
      }));

      res.json(packages.filter((p) => p.isActive));
    } catch {
      res.status(500).json({ error: "failed to load packages" });
    }
  });

  function parseFeatures(val: any): string[] {
    if (!val) return [];
    try {
      if (String(val).trim().startsWith("[")) return JSON.parse(val);
    } catch {}
    return String(val).split("\n");
  }



  // ================================
  // 🟢 REGISTER NEW PROPERTY (Public)
  // ================================
  app.post("/api/properties/register", async (req, res) => {
    try {
      const data = req.body;

      // Check duplicate property number
      const exists = await storage.getPropertyByNumber(data.propertyNumber);
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
      };

      const created = await storage.createProperty(newProperty);

      res.json(created);

    } catch (error) {
      res.status(500).json({ error: "خطأ أثناء تسجيل العقار" });
    }
  });


// ======================================================
// 🟣 ADMIN — إدارة صور العقار من R2 (جلب + رفع + حذف)
// ======================================================

// جلب جميع صور عقار من R2
app.get("/api/admin/r2-images/:propertyNumber", async (req, res) => {
  try {
    const propertyNumber = req.params.propertyNumber;

    const list = await r2.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: `${propertyNumber}/`,
      })
    );

    const images =
      list.Contents?.map((obj) => `${R2_PUBLIC_URL}/${obj.Key}`) || [];

    res.json({ images });
  } catch (err) {
    console.error("ADMIN R2 LIST ERROR:", err);
    res.status(500).json({ error: "Failed to list R2 images" });
  }
});

// رفع صور جديدة لعقار من لوحة التحكم
app.post(
  "/api/admin/r2-images/:propertyNumber",
  upload.array("images"),
  async (req, res) => {
    try {
      const propertyNumber = req.params.propertyNumber;

      // عد الصور الحالية لتحديد البداية
      const list = await r2.send(
        new ListObjectsV2Command({
          Bucket: R2_BUCKET,
          Prefix: `${propertyNumber}/`,
        })
      );

      let index = (list.Contents?.length || 0) + 1;

      const files = Array.isArray(req.files) ? req.files : [];
      for (const file of files) {
        await r2.send(
          new PutObjectCommand({
            Bucket: R2_BUCKET || "",
            Key: `${propertyNumber}/${index}.jpg`,
            Body: file.buffer,
            ContentType: "image/jpeg",
          })
        );
        index++;
      }

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: "Admin upload failed" });
    }
  }
);

// حذف صورة معينة من R2
app.delete(
  "/api/admin/r2-images/:propertyNumber/:index",
  async (req, res) => {
    try {
      const { propertyNumber, index } = req.params;

      await r2.send(
        new DeleteObjectCommand({
          Bucket: R2_BUCKET,
          Key: `${propertyNumber}/${index}.jpg`,
        })
      );

      res.json({ ok: true });
    } catch (err) {
      console.error("ADMIN R2 DELETE ERROR:", err);
      res.status(500).json({ error: "Admin delete failed" });
    }
  }
);



  // ======================
  // DONE
  // ======================
  return createServer(app);
}
