import whatsappRoutes, {
  notifyNewSubscription,
  notifySubscriptionRenewal,
  notifyReceiptUpload,
  notifyPropertyUpdate,
  notifyNewProperty,
  notifyNewPayment,
  notifySmartRequest,
  notifyPropertyVerification,
} from "./whatsapp";
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
  insertBackupSchema,
  insertCodeBackupSchema,
  type InsertProperty,
} from "@shared/schema";
import fs from "fs";
import path from "path";

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
  app.use("/api/whatsapp", whatsappRoutes);
  

  // Owner Analytics - بيانات حقيقية من Google Sheets
  app.get("/api/owner/analytics", async (req, res) => {
    try {
      const propertyNumber = (req.session as any)?.propertyNumber;
      if (!propertyNumber) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      

      // جلب جميع الطلبات للعقار من الشهر الحالي
      const allRequests = await googleSheetsService.getRequests();
      const propertyRequests = allRequests.filter(r => r.propertyNumber === propertyNumber);
      
      const now = new Date();
      const currentMonth = propertyRequests.filter(r => {
        try {
          const reqDate = new Date(r.timestamp);
          return reqDate.getMonth() === now.getMonth() && reqDate.getFullYear() === now.getFullYear();
        } catch {
          return false;
        }
      });
      
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1);
      const previousMonth = propertyRequests.filter(r => {
        try {
          const reqDate = new Date(r.timestamp);
          return reqDate.getMonth() === lastMonth.getMonth() && reqDate.getFullYear() === lastMonth.getFullYear();
        } catch {
          return false;
        }
      });

      const monthlyRequests = currentMonth.length;
      const previousMonthRequests = previousMonth.length;
      const growth = previousMonthRequests > 0 
        ? Math.round(((monthlyRequests - previousMonthRequests) / previousMonthRequests) * 100)
        : monthlyRequests > 0 ? 100 : 0;

      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const avgDaily = Math.round(monthlyRequests / daysInMonth);

      const requestsByDay: Record<string, number> = {};
      const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
      currentMonth.forEach(r => {
        try {
          const day = days[new Date(r.timestamp).getDay()];
          requestsByDay[day] = (requestsByDay[day] || 0) + 1;
        } catch {}
      });

      const highestDay = Object.entries(requestsByDay).sort((a, b) => b[1] - a[1])[0]?.[0] || 'الجمعة';

      res.json({
        propertyNumber,
        monthlyWhatsappRequests: monthlyRequests,
        previousMonthGrowth: growth,
        averageDailyRequests: avgDaily,
        highestDemandDay: highestDay,
        engagementRate: monthlyRequests > 50 ? 'عالي' : monthlyRequests > 20 ? 'متوسط' : 'منخفض',
        peakRequestPeriod: 'المساء',
        visibilityStatus: monthlyRequests > 30 ? 'ممتاز' : monthlyRequests > 15 ? 'جيد' : 'عادي',
        previousMonthRequests,
      });
    } catch (err) {
      console.error("Analytics error:", err);
      res.status(500).json({ error: "Failed to load analytics" });
    }
  });

  // Owner Requests - جدول الطلبات للعقار
  app.get("/api/owner/requests", async (req, res) => {
    try {
      const propertyNumber = (req.session as any)?.propertyNumber;
      if (!propertyNumber) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const allRequests = await googleSheetsService.getRequests();
      const propertyRequests = allRequests
        .filter(r => r.propertyNumber === propertyNumber)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 100);

      res.json({ requests: propertyRequests });
    } catch (err) {
      console.error("Requests error:", err);
      res.status(500).json({ error: "Failed to load requests" });
    }
  });

  // Admin - All Requests & Analytics
  app.get("/api/admin/requests", async (req, res) => {
    try {
      const allRequests = await googleSheetsService.getRequests();
      const allProperties = await googleSheetsService.getProperties();
      
      const byProperty: Record<string, number> = {};
      allRequests.forEach(r => {
        byProperty[r.propertyNumber] = (byProperty[r.propertyNumber] || 0) + 1;
      });

      const sorted = Object.entries(byProperty)
        .sort((a, b) => b[1] - a[1])
        .map(([propNum, count]) => {
          const prop = allProperties.find(p => p.propertyNumber === propNum);
          return { propertyNumber: propNum, propertyName: prop?.name || 'غير معروف', requestCount: count };
        });

      res.json({ 
        totalRequests: allRequests.length,
        totalProperties: sorted.length,
        byProperty: sorted,
        recentRequests: allRequests.slice(-20).reverse()
      });
    } catch (err) {
      console.error("Admin requests error:", err);
      res.status(500).json({ error: "Failed to load admin requests" });
    }
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
  // OWNER LOGOUT (MUST BE AFTER SESSION MIDDLEWARE)
  // ======================
  app.post("/api/owner/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ error: "Logout failed" });
      }
      // Clear session cookie
      res.clearCookie("connect.sid");
      console.log("✅ Logout successful");
      res.json({ ok: true });
    });
  });

  // ======================
  // PUBLIC API
  // ======================

  // GET all properties (frontend + admin)
  app.get("/api/properties", async (_req, res) => {
  try {
    const items = await storage.getProperties();

    // 🟢 إظهار العقارات المقبولة فقط
    // 🟢 مع السماح للعقارات القديمة التي لا تحتوي على verificationStatus
    const filtered = items.filter((p) => {
      // العقار الجديد: لازم يكون approved
      if (p.verificationStatus) {
        return p.verificationStatus === "approved";
      }
      // العقار القديم: لا يحتوي الحالة → اعتباره مقبول
      return true;
    });

    res.json(filtered);
  } catch (err) {
    console.error("Properties fetch error:", err);
    res.status(500).json({ error: "فشل في جلب العقارات" });
  }
});



  // GET single property
  app.get("/api/properties/:id", async (req, res) => {
  try {
    const p = await storage.getPropertyByNumber(req.params.id);

    if (!p) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

    // 🛑 العقار الجديد → لا يظهر إذا لم يكن approved
    if (p.verificationStatus) {
      if (p.verificationStatus !== "approved") {
        return res.status(403).json({
          error: "هذا العقار غير متاح حالياً",
          status: p.verificationStatus,
        });
      }
    }

    // 🟢 العقارات القديمة → لا تحتوي verificationStatus → مسموحة
    return res.json(p);

  } catch (err) {
    console.error("Property Fetch Error:", err);
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

      // إرسال إشعار واتساب عند إضافة عقار جديد
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

      // إرسال إشعار واتساب عند تعديل العقار
      const changesText = Object.entries(mapped)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n");
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
  // SMART REQUESTS SYSTEM
  // ======================
  // دالة للحصول على وقت الرياض (UTC+3)
  const getRiyadhTime = () => {
    const now = new Date();
    const riyadhTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
    return riyadhTime;
  };

  // في الذاكرة: تخزين آخر طلب من كل IP (30 دقيقة) وعدد طلبات كل IP لكل عقار
  const requestTracker = new Map<string, { timestamp: number; propertyNumber: string }>();
  const ipPropertyCounter = new Map<string, Map<string, number>>();

  app.post("/api/requests/smart", async (req, res) => {
    try {
      const { propertyNumber } = req.body;
      if (!propertyNumber) {
        return res.status(400).json({ error: "رقم العقار مطلوب" });
      }

      // احصل على IP العميل (يدعم proxies و localhost)
      const ipAddress =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0] ||
        req.socket.remoteAddress ||
        "unknown";

      const now = Date.now();
      const thirtyMinutes = 30 * 60 * 1000;
      const lastRequest = requestTracker.get(ipAddress);

      // تحقق من التكرار في آخر 30 دقيقة
      if (lastRequest && now - lastRequest.timestamp < thirtyMinutes && lastRequest.propertyNumber === propertyNumber) {
        const remainingMs = thirtyMinutes - (now - lastRequest.timestamp);
        const remainingSeconds = Math.ceil(remainingMs / 1000);
        
        // تحويل إلى صيغة أجمل (دقائق وثواني)
        const minutes = Math.floor(remainingSeconds / 60);
        const seconds = remainingSeconds % 60;
        let timeDisplay = "";
        if (minutes > 0) {
          timeDisplay = `${minutes} دقيقة`;
          if (seconds > 0) timeDisplay += ` و${seconds} ثانية`;
        } else {
          timeDisplay = `${seconds} ثانية`;
        }
        
        console.log(`⏱️ Duplicate request blocked - IP: ${ipAddress}, Property: ${propertyNumber}, Remaining: ${timeDisplay}`);
        
        return res.status(429).json({
          error: "انتظر قليلاً قبل إرسال طلب آخر لنفس العقار",
          remainingSeconds,
          remainingTimeFormatted: timeDisplay,
        });
      }

      // احسب معلومات الوقت بتوقيت الرياض
      const now_date = getRiyadhTime();
      const daysAr = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
      const dayOfWeek = daysAr[now_date.getUTCDay()];
      const hourOfDay = now_date.getUTCHours();
      const minutes = now_date.getUTCMinutes();
      
      // تحويل الساعة من 24 ساعة إلى 12 ساعة مع AM/PM
      const hour12 = hourOfDay % 12 || 12;
      const ampm = hourOfDay >= 12 ? 'م' : 'ص';

      // أنشئ كود طلب فريد
      const requestCode = `REQ${now_date.getFullYear()}${String(now_date.getMonth() + 1).padStart(2, "0")}${String(now_date.getDate()).padStart(2, "0")}${String(hourOfDay).padStart(2, "0")}${Math.random().toString(36).substr(2, 5).toUpperCase()}`;

      // احسب عدد الطلبات من هذا IP للعقار هذا
      if (!ipPropertyCounter.has(ipAddress)) {
        ipPropertyCounter.set(ipAddress, new Map());
      }
      const propertyMap = ipPropertyCounter.get(ipAddress)!;
      const currentCount = propertyMap.get(propertyNumber) || 0;
      const newCount = currentCount + 1;
      propertyMap.set(propertyNumber, newCount);

      // احفظ الطلب مع العدد من IP
      const userAgent = req.headers["user-agent"] || "";
const deviceType = detectDeviceType(userAgent); // ← دالة موجودة أصلاً

const request = await storage.createRequest(
  {
    propertyNumber,
    requestCode,
    timestamp: now_date.toISOString(),
    ipAddress,
    dayOfWeek,
    hourOfDay,
    deviceType, // ← أضف هذا السطر فقط
  },
  newCount
);


      // حدّث المتتبع
      requestTracker.set(ipAddress, { timestamp: now, propertyNumber });
      console.log(`✅ Request tracked - IP: ${ipAddress}, Property: ${propertyNumber}, Count: ${newCount}`);

      // نظّف الطلبات القديمة (أكثر من ساعة)
      const keysToDelete: string[] = [];
      requestTracker.forEach((data, ip) => {
        if (now - data.timestamp > 60 * 60 * 1000) {
          keysToDelete.push(ip);
        }
      });
      keysToDelete.forEach(ip => requestTracker.delete(ip));

      // إرسال إشعار واتساب عند طلب واتساب جديد
      const property = await storage.getPropertyByNumber(propertyNumber);
      notifySmartRequest({
        propertyNumber,
        propertyName: property?.name || "",
        deviceType: deviceType,
        ip: ipAddress,
      }).catch(err => console.error("WhatsApp notify error:", err));

      res.json({
        ok: true,
        message: "تم تسجيل طلبك بنجاح ✅",
        requestCode,
        requestTime: `يوم ${dayOfWeek} الساعة ${hour12}:${String(minutes).padStart(2, "0")} ${ampm}`,
      });
    } catch (err: any) {
      console.error("Smart request error:", err);
      res.status(500).json({ error: "خطأ في معالجة الطلب" });
    }
  });

  // دالة تحديد نوع الجهاز من User-Agent
  function detectDeviceType(userAgent: string): 'mobile' | 'desktop' | 'tablet' {
    if (!userAgent) {
      console.log("⚠️ No User-Agent provided, defaulting to desktop");
      return 'desktop';
    }
    const ua = userAgent.toLowerCase();
    console.log(`🔍 Detecting device from UA: ${ua.substring(0, 100)}...`);
    
    if (/ipad|android(?!.*mobile)|kindle|playbook|silk/.test(ua)) {
      console.log("📱 Detected: TABLET");
      return 'tablet';
    }
    if (/mobile|android|iphone|ipod|blackberry|iemobile|opera mini|windows phone/.test(ua)) {
      console.log("📱 Detected: MOBILE");
      return 'mobile';
    }
    console.log("🖥️ Detected: DESKTOP");
    return 'desktop';
  }

  // تتبع زيارات الصفحات (Page Views) - تحديث الإحصائيات فقط (لا تسجل في الطلبات)
  app.post("/api/track-pageview", async (req, res) => {
    try {
      const { propertyNumber, userAgent: clientUA } = req.body;
      if (!propertyNumber) {
        return res.status(400).json({ error: "رقم العقار مطلوب" });
      }

      // احصل على IP العميل من الطلب
      const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 
                       req.socket.remoteAddress || 
                       'unknown';

      const now_date = getRiyadhTime();
      const now_timestamp = now_date.getTime();

      // تحقق من آخر زيارة من نفس IP لنفس العقار (من جدول الطلبات فقط للتحقق من 24 ساعة)
      const allRequests = await storage.getRequests();
      const lastVisitFromIP = allRequests
        .filter(r => r.propertyNumber === propertyNumber && r.ipAddress === ipAddress)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

      // إذا كانت هناك زيارة سابقة من نفس IP، تحقق من الـ 24 ساعة
      if (lastVisitFromIP) {
        const lastVisitTime = new Date(lastVisitFromIP.timestamp).getTime();
        const timeDifference = now_timestamp - lastVisitTime;
        const hoursDifference = timeDifference / (1000 * 60 * 60);

        // إذا كانت أقل من 24 ساعة، لا تحدّث الإحصائيات
        if (hoursDifference < 24) {
          console.log(`⏭️ تم تخطي الزيارة: نفس IP من ${propertyNumber} في آخر 24 ساعة (${hoursDifference.toFixed(1)} ساعة)`);
          return res.json({ ok: true, skipped: true, message: "تم تسجيل زيارتك مسبقاً، يمكنك التصويت مجدداً بعد 24 ساعة" });
        }
      }

      // تحديث الإحصائيات فقط (بدون تسجيل في جدول الطلبات)
      console.log(`📊 تحديث الإحصائيات: IP ${ipAddress} → ${propertyNumber}`);
      await googleSheetsService.updateAnalyticsRow();

      res.json({ ok: true, message: "تم تحديث الإحصائيات ✅" });
    } catch (err: any) {
      console.error("Page view tracking error:", err);
      res.status(500).json({ error: "خطأ في تسجيل الزيارة" });
    }
  });

  // ======================
  // ADMIN: إصلاح الشيتات
  // ======================
  app.post("/api/admin/fix-sheets", async (req, res) => {
    try {
      // تنظيف وإصلاح جدول الطلبات والإحصائيات
      const result = await googleSheetsService.fixAndCleanSheets();
      res.json(result);
    } catch (err: any) {
      console.error("Fix sheets error:", err);
      res.status(500).json({ error: "خطأ في إصلاح الشيتات", details: err.message });
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


  // تحضير معلومات الدفع للترقية/التمديد (بدون دفع فوري)
  app.post("/api/owner/subscription/prepare-payment", requireOwner, async (req, res) => {
    try {
      const propertyNumber = (req.session as any).propertyNumber;
      const { action, packageId } = req.body;
      
      if (!['extend', 'upgrade'].includes(action)) {
        return res.status(400).json({ error: "إجراء غير صالح" });
      }

      const newPackage = await storage.getPackageById(packageId);
      if (!newPackage) {
        return res.status(404).json({ error: "الباقة غير موجودة" });
      }

      // إرجاع معلومات الدفع المطلوبة
      res.json({
        ok: true,
        paymentRequired: true,
        action,
        packageId,
        packageName: newPackage.name,
        price: newPackage.price,
        duration: newPackage.duration,
        paymentMethods: ["بطاقة", "Apple Pay", "تحويل بنكي"],
        message: `يجب إتمام الدفع للقيام بـ ${action === 'extend' ? 'التمديد' : 'الترقية'}`
      });
    } catch (err: any) {
      console.error("Subscription prepare payment error:", err);
      res.status(500).json({ error: err?.message || "فشل في التحضير" });
    }
  });

  // تأكيد الاشتراك بعد الدفع الناجح
  app.post("/api/owner/subscription/confirm", requireOwner, async (req, res) => {
    try {
      const propertyNumber = (req.session as any).propertyNumber;
      const { action, packageId, paymentId } = req.body;

      const newPackage = await storage.getPackageById(packageId);
      if (!newPackage) {
        return res.status(404).json({ error: "الباقة غير موجودة" });
      }

      const subscriptions = await storage.getSubscriptionsByProperty(propertyNumber);
      const currentSubscription = subscriptions.find(
        s => s.status === 'نشط' && new Date(s.endDate) > new Date()
      );

      const today = new Date();
      let newStartDate = today;
      let newEndDate = new Date();

      if (action === 'extend' && currentSubscription) {
        newStartDate = new Date(currentSubscription.endDate);
        newEndDate = new Date(newStartDate.getTime() + newPackage.duration * 24 * 60 * 60 * 1000);
      } else {
        newEndDate = new Date(today.getTime() + newPackage.duration * 24 * 60 * 60 * 1000);
      }

      const newSubscription = await storage.createSubscription({
        propertyNumber,
        packageId,
        startDate: newStartDate.toISOString(),
        endDate: newEndDate.toISOString(),
        status: 'نشط',
        paymentId: paymentId,
      });

      await googleSheetsService.updateProperty(propertyNumber, {
  subscriptionType: newPackage.type,
  subscriptionDate: newSubscription.startDate.split("T")[0],
  lastUpdate: new Date().toISOString(),
});


      res.json({
        ok: true,
        message: `تم ${action === 'extend' ? 'التمديد' : 'الترقية'} بنجاح`,
        subscription: newSubscription,
        endDate: newEndDate,
      });
    } catch (err: any) {
      console.error("Subscription confirm error:", err);
      res.status(500).json({ error: err?.message || "فشل في التأكيد" });
    }
  });

  // ======================
  // ADMIN AUTH
  // ======================

  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!(req.session as any).isAdmin)
      return res.status(401).json({ error: "Admin Login Required" });
    next();
  };

  // Admin credentials - يمكن تغييرها من env variables
  const ADMIN_CODE = process.env.ADMIN_CODE || "admin";
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

  // ======================
  // GET REQUESTS ENDPOINTS
  // ======================
  // المالك: جلب طلبات عقاره
  app.get("/api/owner/requests", requireOwner, async (req: any, res) => {
    try {
      const propertyNumber = req.propertyNumber;
      const allRequests = await storage.getRequests();
      const propertyRequests = allRequests.filter(r => r.propertyNumber === propertyNumber);
      res.json(propertyRequests);
    } catch (err) {
      res.status(500).json({ error: "فشل في جلب الطلبات" });
    }
  });

  // المسؤول: جلب جميع الطلبات
  app.get("/api/admin/requests", requireAdmin, async (req, res) => {
    try {
      const allRequests = await storage.getRequests();
      const totalProps = await storage.getProperties();
      res.json({
        recentRequests: allRequests.slice(-100), // آخر 100 طلب
        totalRequests: allRequests.length,
        totalProperties: totalProps.length,
      });
    } catch (err) {
      res.status(500).json({ error: "فشل في جلب الطلبات" });
    }
  });

  // المسؤول: جلب تفاصيل الزوار الفرديين
  app.get("/api/admin/visitors", requireAdmin, async (req, res) => {
    try {
      const allRequests = await storage.getRequests();
      const totalProps = await storage.getProperties();

      const visitors = allRequests
        .slice(-100) // آخر 100 زائر
        .reverse()
        .map(req => {
          const prop = totalProps.find(p => p.propertyNumber === req.propertyNumber);
          return {
            propertyNumber: req.propertyNumber,
            propertyName: prop?.name || `عقار ${req.propertyNumber}`,
            requestCode: req.requestCode,
            deviceType: req.deviceType || 'desktop',
            ipAddress: req.ipAddress,
            timestamp: req.timestamp,
            dayOfWeek: req.dayOfWeek,
            hourOfDay: req.hourOfDay,
          };
        });

      res.json({ visitors });
    } catch (err: any) {
      console.error("Visitors error:", err);
      res.status(500).json({ error: "فشل في جلب بيانات الزوار" });
    }
  });

  // المسؤول: جلب الإحصائيات - حساب الـ IPs الفريدة فقط
  app.get("/api/admin/analytics", requireAdmin, async (req, res) => {
    try {
      const allRequests = await storage.getRequests();
      const totalProps = await storage.getProperties();

      // ===== حساب الـ IPs الفريدة فقط =====
      // Map لتجميع الـ IPs الفريدة لكل عقار
      const uniqueIPMap: Record<string, { ipAddress: string; deviceType: 'mobile' | 'desktop' | 'tablet' }> = {};
      
      allRequests.forEach(r => {
        const key = `${r.propertyNumber}:${r.ipAddress}`;
        if (!uniqueIPMap[key]) {
          uniqueIPMap[key] = {
            ipAddress: r.ipAddress,
            deviceType: r.deviceType || 'desktop',
          };
        }
      });

      const uniqueRequests = Object.values(uniqueIPMap);

      // 1. إجمالي الزوار الفريدين (حسب IP - كل IP مرة واحدة)
      const visitors = uniqueRequests.length;

      // 2. توزيع الأجهزة الفريدة (كل IP يُحسب مرة واحدة فقط)
      const devices = { mobile: 0, desktop: 0, tablet: 0 };
      uniqueRequests.forEach(r => {
        if (r.deviceType === 'mobile') devices.mobile++;
        else if (r.deviceType === 'tablet') devices.tablet++;
        else devices.desktop++;
      });

      // 3. توزيع المدن (حسب الـ IPs الفريدة)
      const cityIPMap: Record<string, Set<string>> = {};
      allRequests.forEach(r => {
        const prop = totalProps.find(p => p.propertyNumber === r.propertyNumber);
        const city = prop?.city || 'غير محدد';
        
        if (!cityIPMap[city]) {
          cityIPMap[city] = new Set();
        }
        cityIPMap[city].add(r.ipAddress);
      });

      const cities = Object.entries(cityIPMap)
        .sort((a, b) => b[1].size - a[1].size)
        .slice(0, 10)
        .map(([name, ips]) => ({ name, count: ips.size }));

      // 4. توزيع حسب العقارات (حسب الـ IPs الفريدة لكل عقار)
      const propertyIPMap: Record<string, Set<string>> = {};
      allRequests.forEach(r => {
        if (!propertyIPMap[r.propertyNumber]) {
          propertyIPMap[r.propertyNumber] = new Set();
        }
        propertyIPMap[r.propertyNumber].add(r.ipAddress);
      });

      const sortedProperties = Object.entries(propertyIPMap)
        .sort((a, b) => b[1].size - a[1].size)
        .slice(0, 15)
        .map(([propertyNumber, ips]) => {
          const prop = totalProps.find(p => p.propertyNumber === propertyNumber);
          return {
            propertyNumber,
            propertyName: prop?.name || `عقار ${propertyNumber}`,
            requestCount: ips.size, // عدد الـ IPs الفريدة
          };
        });

      // 5. آخر الطلبات
      const recentRequests = allRequests.slice(-20).reverse();

      // 6. آخر تحديث
      const lastUpdated = new Date().toLocaleString('ar-SA');

      const uniqueIPs = new Set(allRequests.map(r => r.ipAddress));

      res.json({
        visitors, // الـ IPs الفريدة الكلية
        devices,
        cities,
        byProperty: sortedProperties,
        recentRequests,
        totalRequests: allRequests.length,
        totalProperties: totalProps.length,
        uniqueVisitors: uniqueIPs.size,
        lastUpdated,
      });
    } catch (err: any) {
      console.error("Analytics error:", err);
      res.status(500).json({ error: "فشل في جلب الإحصائيات" });
    }
  });

  app.post("/api/admin/login", async (req, res) => {
    const { code, password } = req.body;

    if (code !== ADMIN_CODE || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Invalid Admin Credentials" });
    }

    (req.session as any).isAdmin = true;
    req.session.save((err: any) => {
      if (err) {
        return res.status(500).json({ error: "Session save failed" });
      }
      res.json({ ok: true });
    });
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


  // ======================
  // ADMIN SESSION CHECK
  // ======================
  app.get("/api/admin/session", (req, res) => {
    const isAdmin = Boolean((req.session as any).isAdmin);

    res.json({
      isAdmin,
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
  // 🔄 تحديث بيانات العقار من طرف المالك
  // ======================================================
  app.put("/api/owner/property", requireOwner, async (req, res) => {
    try {
      const propertyNumber = (req.session as any).propertyNumber;
      if (!propertyNumber) {
        return res.status(400).json({ error: "Property not found in session" });
      }

      const updates = req.body;
      const updated = await storage.updateProperty(propertyNumber, updates);
      res.json(updated);
    } catch (err: any) {
      console.error("Update property error:", err?.message);
      res.status(500).json({ error: err?.message || "فشل في تحديث البيانات" });
    }
  });

  // ======================================================
  // 📊 جلب إحصائيات العقار
  // ======================================================
app.get("/api/owner/analytics", async (req, res) => {
  try {
    const propertyNumber = req.session.propertyNumber;
    if (!propertyNumber) {
      return res.status(401).json({ error: "NOT_LOGGED_IN" });
    }

    // --------------------------------------------------------
    // 1) جلب الطلبات الحقيقية للعقار
    // --------------------------------------------------------
    const requests = await googleSheetsService.getRequests();
    const propertyRequests = requests.filter(
      (r) => r.propertyNumber === propertyNumber
    );

    // --------------------------------------------------------
    // 2) جلب إحصائيات الزوار الفريدة
    // --------------------------------------------------------
    const analytics = await googleSheetsService.getAnalyticsFromSheet();

    const visitors = analytics?.visitors || 0;
    const mobile = analytics?.mobile || 0;
    const desktop = analytics?.desktop || 0;
    const tablet = analytics?.tablet || 0;
    const cities = analytics?.cities || "لا توجد بيانات";

    // --------------------------------------------------------
    // 3) إجمالي الطلبات
    // --------------------------------------------------------
    const totalRequests = propertyRequests.length;

    // --------------------------------------------------------
    // 4) أعلى يوم طلب (Top Day)
    // --------------------------------------------------------
    let topDay = "لا يوجد";
    if (propertyRequests.length > 0) {
      const counter: Record<string, number> = {};
      for (const r of propertyRequests) {
        const day = r.dayOfWeek || "غير معروف";
        counter[day] = (counter[day] || 0) + 1;
      }

      topDay = Object.entries(counter).sort((a, b) => b[1] - a[1])[0][0];
    }

    // --------------------------------------------------------
    // 5) تحليل آخر 7 أيام لحساب النمو
    // --------------------------------------------------------
    const now = new Date();
    const last7 = now.getTime() - 7 * 86400000;
    const last14 = now.getTime() - 14 * 86400000;

    const weekData = {
      thisWeek: 0,
      lastWeek: 0,
    };

    for (const r of propertyRequests) {
      const t = new Date(r.timestamp).getTime();
      if (t >= last7) weekData.thisWeek++;
      else if (t >= last14) weekData.lastWeek++;
    }

    const growth =
      weekData.lastWeek === 0
        ? 100
        : Math.round(
            ((weekData.thisWeek - weekData.lastWeek) /
              weekData.lastWeek) *
              100,
          );

    // --------------------------------------------------------
    // 6) حساب نسبة التفاعل
    // --------------------------------------------------------
    const engagement =
      visitors === 0 ? 0 : Math.min(100, Math.round((totalRequests / visitors) * 100));

    // --------------------------------------------------------
    // 7) الرد النهائي
    // --------------------------------------------------------
    return res.json({
      visitors,
      mobile,
      desktop,
      tablet,
      cities,
      totalRequests,
      topDay,
      growth,
      engagement,
      lastUpdated: analytics?.lastUpdated || "",
    });
  } catch (error) {
    console.error("❌ Owner analytics error:", error);
    return res.status(500).json({ error: "SERVER_ERROR" });
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

      // إرسال إشعار واتساب للمدير عند تسجيل عقار جديد
      console.log("📲 Sending WhatsApp notification for new registration:", data.propertyNumber);
      notifyNewProperty({
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

      res.json(created);

    } catch (error) {
      console.error("Register property error:", error);
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
// 💳 PAYMENT ENDPOINTS
// ======================

// 0. حساب تفاصيل الدفع الكاملة (الباقة + السعر + الخصم + العمولة)
app.post("/api/payment/calculate", async (req, res) => {
  try {
    const { packageId, discountCode } = req.body;

    if (!packageId) {
      return res.status(400).json({ error: "معرف الباقة مطلوب" });
    }

    // جلب بيانات الباقة
    const pkg = await storage.getPackageById(packageId);
    if (!pkg) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    // السعر الأساسي
    let basePrice = pkg.price;
    let discountAmount = 0;
    let discountInfo: any = null;

    // حساب الخصم إن وجد
    if (discountCode) {
      const discount = await storage.getDiscountCodeByCode(discountCode);
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

// 1. التحقق من كود الخصم
app.post("/api/discount/validate", async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "كود مطلوب" });

    const discount = await storage.getDiscountCodeByCode(code);
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

// 2. بدء عملية الدفع الإلكتروني
app.post("/api/owner/payment/initiate", async (req, res) => {
  try {
    const { propertyNumber, packageId, discountCode, paymentMethod = "cards", action } = req.body;

    if (!propertyNumber) {
      return res.status(400).json({ error: "رقم العقار مطلوب" });
    }

    // جلب بيانات الباقة
    const pkg = await storage.getPackageById(packageId);
    if (!pkg) return res.status(404).json({ error: "الباقة غير موجودة" });

    // جلب بيانات العقار
    const property = await storage.getPropertyByNumber(propertyNumber);
    if (!property) return res.status(404).json({ error: "العقار غير موجود" });

    // حساب السعر النهائي
    let finalAmount = pkg.price;
    if (discountCode) {
      const discount = await storage.getDiscountCodeByCode(discountCode);
      if (discount && discount.isActive) {
        if (discount.type === "نسبة") {
          finalAmount -= (pkg.price * discount.value) / 100;
        } else {
          finalAmount -= discount.value;
        }
      }
    }

    // إنشاء طلب دفع مع Paymob
    const paymobResult = await paymobService.createIntention(
      finalAmount,
      propertyNumber,
      property.name || "عقار",
      property.whatsappNumber,
      pkg.name,
      pkg.duration,
      paymentMethod as "cards" | "applepay"
    );

    // إنشاء سجل الدفع
    const payment = await storage.createPayment({
      propertyNumber,
      packageId,
      amount: pkg.price,
      discountCode: discountCode || "",
      discountAmount: pkg.price - finalAmount,
      finalAmount,
      paymobOrderId: paymobResult.intentionId,
      status: "قيد المراجعة",
      paymentMethod: paymentMethod === "applepay" ? "Apple Pay" : "بطاقة",
    });

    // حفظ البيانات للاشتراك/التمديد/الترقية
    if (action === 'extend' || action === 'upgrade') {
      const today = new Date();
      const currentSubscription = await googleSheetsService.getSubscriptionByPropertyNumber(propertyNumber);
      
      let startDate = today;
      let endDate = new Date(today.getTime() + pkg.duration * 24 * 60 * 60 * 1000);
      let price = pkg.price;
      let subscriptionType = pkg.type;
      
      // إذا كان التمديد، احتفظ بالسعر ونوع الاشتراك الحالي
      if (action === 'extend' && currentSubscription) {
        if (new Date(currentSubscription.endDate) > today) {
          startDate = new Date(currentSubscription.endDate);
          endDate = new Date(startDate.getTime() + pkg.duration * 24 * 60 * 60 * 1000);
        }
        // احتفظ بالسعر والنوع الحالي
        price = (currentSubscription as any).price || pkg.price;
        subscriptionType = (currentSubscription as any).subscriptionType || pkg.type;
      }
      
      const subscriptionData = {
        packageId: packageId,
        price: price,
        subscriptionType: subscriptionType,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        paymentId: payment.id,
      };
      
      // حفظ الاشتراك إلى ورقة الاشتراكات
      await googleSheetsService.addSubscriptionToSheet(propertyNumber, subscriptionData, property);
      console.log(`✅ Subscription saved to الاشتراكات sheet for property ${propertyNumber}`);
    }

    console.log(`✅ Payment created: ${payment.id}, Checkout URL: ${paymobResult.checkoutUrl}`);

    res.json({
      checkoutUrl: paymobResult.checkoutUrl,
      paymentId: payment.id,
    });
  } catch (err: any) {
    console.error("Payment initiate error:", err);
    res.status(500).json({ error: err.message || "خطأ في بدء الدفع" });
  }
});

// 3. التحويل البنكي مع رفع الإيصال
app.post("/api/owner/payment/bank-transfer", upload.single("receipt"), async (req, res) => {
  try {
    const { propertyNumber, packageId, discountCode, action } = req.body;

    if (!propertyNumber) {
      return res.status(400).json({ error: "رقم العقار مطلوب" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "الإيصال مطلوب" });
    }

    // جلب بيانات الباقة والعقار
    const pkg = await storage.getPackageById(packageId);
    if (!pkg) return res.status(404).json({ error: "الباقة غير موجودة" });

    const property = await storage.getPropertyByNumber(propertyNumber);
    if (!property) return res.status(404).json({ error: "العقار غير موجود" });

    // حساب السعر النهائي
    let finalAmount = pkg.price;
    if (discountCode) {
      const discount = await storage.getDiscountCodeByCode(discountCode);
      if (discount && discount.isActive) {
        if (discount.type === "نسبة") {
          finalAmount -= (pkg.price * discount.value) / 100;
        } else {
          finalAmount -= discount.value;
        }
      }
    }

    // رفع الإيصال إلى R2
    let receiptUrl = "";
    if (req.file && R2_BUCKET) {
      const receiptKey = `receipts/${propertyNumber}-${Date.now()}.jpg`;
      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: receiptKey,
          Body: req.file.buffer,
          ContentType: "image/jpeg",
        })
      );
      receiptUrl = `${R2_PUBLIC_URL}/${receiptKey}`;
    }

    // إنشاء سجل الدفع
    const payment = await storage.createPayment({
      propertyNumber,
      packageId,
      amount: pkg.price,
      discountCode: discountCode || "",
      discountAmount: pkg.price - finalAmount,
      finalAmount,
      status: "قيد المراجعة",
      paymentMethod: "تحويل بنكي",
      receiptUrl,
    });

    // حفظ البيانات للاشتراك/التمديد/الترقية
    if (action === 'extend' || action === 'upgrade' || !action) {
      const today = new Date();
      const currentSubscription = await googleSheetsService.getSubscriptionByPropertyNumber(propertyNumber);
      
      let startDate = today;
      let endDate = new Date(today.getTime() + pkg.duration * 24 * 60 * 60 * 1000);
      let price = pkg.price;
      let subscriptionType = pkg.type;
      
      // إذا كان التمديد، احتفظ بالسعر ونوع الاشتراك الحالي
      if ((action === 'extend' || !action) && currentSubscription) {
        if (new Date(currentSubscription.endDate) > today) {
          startDate = new Date(currentSubscription.endDate);
          endDate = new Date(startDate.getTime() + pkg.duration * 24 * 60 * 60 * 1000);
        }
        // احتفظ بالسعر والنوع الحالي
        price = (currentSubscription as any).price || pkg.price;
        subscriptionType = (currentSubscription as any).subscriptionType || pkg.type;
      }
      
      const subscriptionData = {
        packageId: packageId,
        price: price,
        subscriptionType: subscriptionType,
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        paymentId: payment.id,
      };
      
      // حفظ الاشتراك إلى ورقة الاشتراكات
      await googleSheetsService.addSubscriptionToSheet(propertyNumber, subscriptionData, property, receiptUrl);
      console.log(`✅ Subscription saved to الاشتراكات sheet for property ${propertyNumber}`);

      // إرسال إشعار واتساب عند رفع الإيصال
      notifyReceiptUpload({
        propertyNumber,
        propertyName: property.name || "",
        ownerPhone: property.whatsappNumber || "",
        receiptUrl,
      }).catch(err => console.error("WhatsApp notify error:", err));
    }

    res.json({ ok: true, paymentId: payment.id });
  } catch (err: any) {
    console.error("Bank transfer error:", err);
    res.status(500).json({ error: "خطأ في معالجة التحويل البنكي" });
  }
});

  // ======================
  // MISSING ENDPOINTS FOR SUBSCRIPTION PAGE
  // ======================
  
  // GET owner's property data
  app.get("/api/owner/property", requireOwner, async (req, res) => {
    try {
      const propertyNumber = (req.session as any).propertyNumber;
      if (!propertyNumber) {
        return res.status(400).json({ error: "Property not found in session" });
      }
      
      const property = await googleSheetsService.getPropertyByNumber(propertyNumber);
      if (!property) {
        return res.status(404).json({ error: "Property not found" });
      }
      
      res.json(property);
    } catch (err: any) {
      console.error("Get property error:", err?.message);
      res.status(500).json({ error: "Failed to load property" });
    }
  });

  // GET owner's current subscription from الاشتراكات sheet
  app.get("/api/owner/current-subscription", requireOwner, async (req, res) => {
    try {
      const propertyNumber = (req.session as any).propertyNumber;
      if (!propertyNumber) {
        return res.status(400).json({ error: "Property not found in session" });
      }
      
      console.log(`🔍 Looking for subscription for property: ${propertyNumber}`);
      
      // استخدام الدالة الجديدة للبحث عن الاشتراك
      const subscription = await googleSheetsService.getSubscriptionByPropertyNumber(propertyNumber);
      
      if (!subscription) {
        console.log(`❌ No subscription found for property: ${propertyNumber}`);
        // إرجاع اشتراك افتراضي مجاني إذا لم يوجد
        return res.json({
          id: `SUB-${propertyNumber}`,
          propertyNumber,
          packageId: "pkg-free",
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          status: "نشط",
        });
      }
      
      console.log(`✅ Found subscription for ${propertyNumber}:`, subscription);
      res.json(subscription);
    } catch (err: any) {
      console.error("Get subscription error:", err?.message);
      res.status(500).json({ error: "Failed to load subscription" });
    }
  });

  // GET all available packages
  app.get("/api/packages", async (req, res) => {
    try {
      const packages = await googleSheetsService.getPackages();
      res.json(packages);
    } catch (err: any) {
      console.error("Get packages error:", err?.message);
      res.status(500).json({ error: "Failed to load packages" });
    }
  });

  // ======================
  // BACKUP SYSTEM - نظام النسخ الاحتياطية المتقدم
  // ======================

  // GET all backups
  app.get("/api/backups", async (req, res) => {
    try {
      const backups = await storage.getBackups();
      res.json(backups);
    } catch (err: any) {
      console.error("Get backups error:", err?.message);
      res.status(500).json({ error: "Failed to load backups" });
    }
  });

  // GET single backup details
  app.get("/api/backups/:id", async (req, res) => {
    try {
      const backup = await storage.getBackupById(req.params.id);
      if (!backup) {
        return res.status(404).json({ error: "Backup not found" });
      }
      res.json(backup);
    } catch (err: any) {
      console.error("Get backup error:", err?.message);
      res.status(500).json({ error: "Failed to load backup" });
    }
  });

  // CREATE backup - نسخة احتياطية جديدة
  app.post("/api/backups", async (req, res) => {
    try {
      const { backupType, backupName, dataTypes, description } = req.body;

      // Validate input
      if (!backupType || !backupName || !dataTypes) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      // Collect data based on dataTypes
      const backupData: any = {};
      let filesCount = 0;
      let sizeInMB = 0;

      if (dataTypes.includes('properties')) {
        backupData.properties = await storage.getProperties();
        filesCount += backupData.properties.length;
        sizeInMB += JSON.stringify(backupData.properties).length / (1024 * 1024);
      }

      if (dataTypes.includes('subscriptions')) {
        backupData.subscriptions = await storage.getSubscriptions();
        filesCount += backupData.subscriptions.length;
        sizeInMB += JSON.stringify(backupData.subscriptions).length / (1024 * 1024);
      }

      if (dataTypes.includes('packages')) {
        backupData.packages = await storage.getPackages();
        filesCount += backupData.packages.length;
        sizeInMB += JSON.stringify(backupData.packages).length / (1024 * 1024);
      }

      if (dataTypes.includes('payments')) {
        backupData.payments = await storage.getPayments();
        filesCount += backupData.payments.length;
        sizeInMB += JSON.stringify(backupData.payments).length / (1024 * 1024);
      }

      if (dataTypes.includes('discounts')) {
        backupData.discounts = await storage.getDiscountCodes();
        filesCount += backupData.discounts.length;
        sizeInMB += JSON.stringify(backupData.discounts).length / (1024 * 1024);
      }

      if (dataTypes.includes('requests')) {
        backupData.requests = await storage.getRequests();
        filesCount += backupData.requests.length;
        sizeInMB += JSON.stringify(backupData.requests).length / (1024 * 1024);
      }

      // Create backup record
      const backup = await storage.createBackup({
        backupType,
        backupName,
        status: 'جاري',
        dataTypes,
        filesCount,
        sizeInMB: parseFloat(sizeInMB.toFixed(2)),
        backupData,
        autoBackup: false,
        description,
      });

      // Mark as completed
      const completed = await storage.updateBackup(backup.id, {
        status: 'مكتمل',
        completedAt: new Date().toISOString(),
      });

      console.log(`✅ Backup created successfully: ${backup.id}`);
      res.json(completed);
    } catch (err: any) {
      console.error("Create backup error:", err?.message);
      res.status(500).json({ error: "Failed to create backup" });
    }
  });

  // RESTORE backup - استعادة نسخة احتياطية
  app.post("/api/backups/:id/restore", async (req, res) => {
    try {
      const backup = await storage.getBackupById(req.params.id);
      if (!backup) {
        return res.status(404).json({ error: "Backup not found" });
      }

      // Perform restore (mark in storage)
      await storage.restoreBackup(req.params.id);

      console.log(`✅ Backup restored: ${req.params.id}`);
      res.json({ ok: true, message: "تم استعادة النسخة الاحتياطية بنجاح" });
    } catch (err: any) {
      console.error("Restore backup error:", err?.message);
      res.status(500).json({ error: "Failed to restore backup" });
    }
  });

  // DELETE backup
  app.delete("/api/backups/:id", async (req, res) => {
    try {
      const backup = await storage.getBackupById(req.params.id);
      if (!backup) {
        return res.status(404).json({ error: "Backup not found" });
      }

      await storage.deleteBackup(req.params.id);
      console.log(`✅ Backup deleted: ${req.params.id}`);
      res.json({ ok: true, message: "تم حذف النسخة الاحتياطية" });
    } catch (err: any) {
      console.error("Delete backup error:", err?.message);
      res.status(500).json({ error: "Failed to delete backup" });
    }
  });

  // DOWNLOAD backup as JSON
  app.get("/api/backups/:id/download", async (req, res) => {
    try {
      const backup = await storage.getBackupById(req.params.id);
      if (!backup) {
        return res.status(404).json({ error: "Backup not found" });
      }

      const filename = `backup-${backup.backupName}-${new Date().getTime()}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/json');
      res.json(backup);
    } catch (err: any) {
      console.error("Download backup error:", err?.message);
      res.status(500).json({ error: "Failed to download backup" });
    }
  });

  // ======================
  // CODE BACKUP SYSTEM - نظام نسخ احتياطية الأكواد
  // ======================

  // Utility: Recursively read all .ts/.tsx files
  const readCodeFiles = (dir: string, fileList: Record<string, string> = {}): Record<string, string> => {
    try {
      const files = fs.readdirSync(dir);
      files.forEach((file) => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
          readCodeFiles(filePath, fileList);
        } else if ((file.endsWith('.ts') || file.endsWith('.tsx')) && !file.startsWith('.')) {
          const relPath = path.relative(process.cwd(), filePath);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            fileList[relPath] = content;
          } catch (e) {}
        }
      });
    } catch (e) {}
    return fileList;
  };

  // GET all code backups
  app.get("/api/code-backup/list", async (req, res) => {
    try {
      const backups = await storage.getCodeBackups();
      res.json(backups);
    } catch (err: any) {
      console.error("Get code backups error:", err?.message);
      res.status(500).json({ error: "Failed to load code backups" });
    }
  });

  // GET single code backup
  app.get("/api/code-backup/:id", async (req, res) => {
    try {
      const backup = await storage.getCodeBackupById(req.params.id);
      if (!backup) {
        return res.status(404).json({ error: "Code backup not found" });
      }
      res.json(backup);
    } catch (err: any) {
      console.error("Get code backup error:", err?.message);
      res.status(500).json({ error: "Failed to load code backup" });
    }
  });

  // CREATE code backup - نسخة احتياطية من الأكواد
  app.post("/api/code-backup/create", async (req, res) => {
    try {
      const files: Record<string, string> = {};
      
      // Read all code files
      readCodeFiles("client/src", files);
      readCodeFiles("server", files);
      readCodeFiles("shared", files);

      const fileCount = Object.keys(files).length;
      let totalSize = 0;
      Object.values(files).forEach((content) => {
        totalSize += JSON.stringify(content).length / (1024 * 1024);
      });

      const backup = await storage.createCodeBackup({
        backupName: `نسخة احتياطية كاملة - ${new Date().toLocaleString("ar-SA")}`,
        timestamp: new Date().toISOString(),
        files,
        fileCount,
        totalSize: parseFloat(totalSize.toFixed(2)),
      });

      console.log(`✅ Code backup created: ${backup.id} (${fileCount} files, ${backup.totalSize}MB)`);
      res.json(backup);
    } catch (err: any) {
      console.error("Create code backup error:", err?.message);
      res.status(500).json({ error: "Failed to create code backup" });
    }
  });

  // RESTORE code backup - استعادة نسخة احتياطية من الأكواد
  app.post("/api/code-backup/:id/restore", async (req, res) => {
    try {
      const backup = await storage.getCodeBackupById(req.params.id);
      if (!backup) {
        return res.status(404).json({ error: "Code backup not found" });
      }

      // Write files back to disk
      let restoredCount = 0;
      for (const [filePath, content] of Object.entries(backup.files)) {
        try {
          const fullPath = path.join(process.cwd(), filePath);
          const dir = path.dirname(fullPath);
          
          // Create directories if they don't exist
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          
          fs.writeFileSync(fullPath, content, 'utf-8');
          restoredCount++;
        } catch (e) {
          console.error(`Failed to restore ${filePath}:`, e);
        }
      }

      console.log(`✅ Code backup restored: ${backup.id} (${restoredCount}/${backup.fileCount} files)`);
      res.json({ 
        ok: true, 
        message: `تم استعادة ${restoredCount} ملف من أصل ${backup.fileCount}`,
        restoredCount,
        totalCount: backup.fileCount
      });
    } catch (err: any) {
      console.error("Restore code backup error:", err?.message);
      res.status(500).json({ error: "Failed to restore code backup" });
    }
  });

  // DELETE code backup
  app.delete("/api/code-backup/:id", async (req, res) => {
    try {
      const backup = await storage.getCodeBackupById(req.params.id);
      if (!backup) {
        return res.status(404).json({ error: "Code backup not found" });
      }

      await storage.deleteCodeBackup(req.params.id);
      console.log(`✅ Code backup deleted: ${req.params.id}`);
      res.json({ ok: true, message: "تم حذف النسخة الاحتياطية" });
    } catch (err: any) {
      console.error("Delete code backup error:", err?.message);
      res.status(500).json({ error: "Failed to delete code backup" });
    }
  });

  // DOWNLOAD code backup as JSON
  app.get("/api/code-backup/:id/download", async (req, res) => {
    try {
      const backup = await storage.getCodeBackupById(req.params.id);
      if (!backup) {
        return res.status(404).json({ error: "Code backup not found" });
      }

      const filename = `code-backup-${new Date().getTime()}.json`;
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/json');
      res.json(backup);
    } catch (err: any) {
      console.error("Download code backup error:", err?.message);
      res.status(500).json({ error: "Failed to download code backup" });
    }
  });


  // ==============================
// 💬 WhatsApp API Routes
// ==============================
app.get("/api/whatsapp/logs", async (req, res) => {
  try {
    const logs = await googleSheetsService.getWhatsAppLogs();
    res.json(logs);
  } catch (e) {
    console.error("WhatsApp logs error:", e);
    res.status(500).json([]);
  }
});

app.get("/api/whatsapp/requests", async (req, res) => {
  try {
    const requests = await googleSheetsService.getRequests();
    res.json(requests);
  } catch (e) {
    console.error("WhatsApp requests error:", e);
    res.status(500).json([]);
  }
});

app.get("/api/whatsapp/stats", async (req, res) => {
  try {
    const logs = await googleSheetsService.getWhatsAppLogs();
    const now = new Date();

    const today = logs.filter(l => (new Date(l.createdAt)).toDateString() === now.toDateString()).length;
    const week = logs.filter(l => {
      const d = new Date(l.createdAt);
      const diff = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
      return diff <= 7;
    }).length;
    const month = logs.filter(l => {
      const d = new Date(l.createdAt);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;

    res.json({
      today,
      week,
      month,
      total: logs.length,
    });
  } catch (e) {
    console.error("WhatsApp stats error:", e);
    res.status(500).json({ today: 0, week: 0, month: 0, total: 0 });
  }
});

// إرسال يدوي للمدير
app.post("/api/whatsapp/send", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });

    const log = {
      id: `WA-${Date.now()}`,
      type: "manual",
      message,
      phone: process.env.ADMIN_PHONE || "966533220646",
      status: "success",
      response: "saved",
      createdAt: new Date().toISOString(),
    };

    await googleSheetsService.addWhatsAppLog(log);

    res.json({ ok: true });
  } catch (e) {
    console.error("WhatsApp send error:", e);
    res.status(500).json({ error: "Failed" });
  }
});

  // ==========================
  //   التحقق من العقارات
  // ==========================

  app.put("/api/admin/properties/:propertyNumber/approve", async (req, res) => {
  try {
    const { propertyNumber } = req.params;

    // تحديث الحالة في الشيت
    const updated = await googleSheetsService.updateVerificationStatus(
      propertyNumber,
      "approved"
    );

    // تسجيل العملية داخل storage
    await storage.addVerificationLog({
      propertyNumber,
      action: "approved",
      date: new Date().toISOString(),
    });

    // إرسال إشعار واتساب عند قبول العقار
    const property = await storage.getPropertyByNumber(propertyNumber);
    notifyPropertyVerification({
      propertyNumber,
      propertyName: property?.name || "",
      action: "قبول",
      admin: "Admin",
    }).catch(err => console.error("WhatsApp notify error:", err));

    res.json({
      success: true,
      message: "تم قبول العقار",
      property: updated,
    });

  } catch (err) {
    console.error("Approve Error:", err);
    res.status(500).json({ success: false, message: "فشل في قبول العقار" });
  }
});

  app.put("/api/admin/properties/:propertyNumber/reject", async (req, res) => {
    try {
      const { propertyNumber } = req.params;
      const { reason } = req.body;

      // تحديث الحالة في الشيت
      const updated = await googleSheetsService.updateVerificationStatus(
        propertyNumber,
        "rejected"
      );

      // تسجيل العملية داخل storage
      await storage.addVerificationLog({
        propertyNumber,
        action: "rejected",
        reason: reason || "",
        date: new Date().toISOString(),
        admin: "Admin",
      });

      // إرسال إشعار واتساب عند رفض العقار
      const property = await storage.getPropertyByNumber(propertyNumber);
      notifyPropertyVerification({
        propertyNumber,
        propertyName: property?.name || "",
        action: "رفض",
        reason: reason || "",
        admin: "Admin",
      }).catch(err => console.error("WhatsApp notify error:", err));

      res.json({
        success: true,
        message: "تم رفض العقار",
        property: updated,
      });

    } catch (err) {
      console.error("Reject Error:", err);
      res.status(500).json({ success: false, message: "فشل في رفض العقار" });
    }
  });


  // ===============================
  // 🔵 Logs: جلب سجل التحقق بالكامل
  // ===============================
  app.get("/api/admin/verification/logs", async (req, res) => {
    try {
      const logs = await storage.getVerificationLogs();
      res.json(logs || []);
    } catch (error) {
      console.error("Verification logs error:", error);
      res.status(500).json({ error: "Failed to fetch verification logs" });
    }
  });



  
  // ======================
  // ⚙️ إعدادات الإشعارات
  // ======================
  app.get("/api/admin/settings/notifications", async (req, res) => {
    try {
      const settings = await googleSheetsService.getNotificationSettings();
      res.json(settings);
    } catch (error) {
      console.error("Error fetching notification settings:", error);
      res.status(500).json({ error: "فشل في جلب إعدادات الإشعارات" });
    }
  });

  app.put("/api/admin/settings/notifications", async (req, res) => {
    try {
      const settings = req.body;
      await googleSheetsService.saveNotificationSettings(settings);
      // مسح كاش الإعدادات في whatsapp.ts
      const { clearSettingsCache } = await import("./whatsapp");
      clearSettingsCache();
      res.json({ success: true, message: "تم حفظ الإعدادات بنجاح" });
    } catch (error) {
      console.error("Error saving notification settings:", error);
      res.status(500).json({ error: "فشل في حفظ الإعدادات" });
    }
  });

  // ======================
  // 💰 أرباح الشريك
  // ======================
  app.get("/api/admin/partner-profits", async (req, res) => {
    try {
      const profits = await googleSheetsService.getPartnerProfits();
      res.json(profits);
    } catch (error) {
      console.error("Error fetching partner profits:", error);
      res.status(500).json({ error: "فشل في جلب أرباح الشريك" });
    }
  });

  app.get("/api/admin/partner-profits/current", async (req, res) => {
    try {
      const currentProfit = await googleSheetsService.calculateMonthlyProfits();
      res.json(currentProfit);
    } catch (error) {
      console.error("Error calculating current profits:", error);
      res.status(500).json({ error: "فشل في حساب الأرباح الحالية" });
    }
  });

  app.post("/api/admin/partner-profits", async (req, res) => {
    try {
      const profit = await googleSheetsService.createPartnerProfit(req.body);
      res.json(profit);
    } catch (error) {
      console.error("Error creating partner profit:", error);
      res.status(500).json({ error: "فشل في إنشاء سجل الأرباح" });
    }
  });

  app.put("/api/admin/partner-profits/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const profit = await googleSheetsService.updatePartnerProfit(id, req.body);
      if (!profit) {
        return res.status(404).json({ error: "سجل الأرباح غير موجود" });
      }
      res.json(profit);
    } catch (error) {
      console.error("Error updating partner profit:", error);
      res.status(500).json({ error: "فشل في تحديث سجل الأرباح" });
    }
  });

  // ======================
  // 🏠🏠 اشتراكات العقارين
  // ======================
  app.get("/api/admin/multi-property-subscriptions", async (req, res) => {
    try {
      const subs = await googleSheetsService.getMultiPropertySubscriptions();
      res.json(subs);
    } catch (error) {
      console.error("Error fetching multi-property subscriptions:", error);
      res.status(500).json({ error: "فشل في جلب اشتراكات العقارين" });
    }
  });

  app.post("/api/multi-property-subscription", async (req, res) => {
    try {
      const { packageId, propertyNumber1, propertyNumber2 } = req.body;
      
      // التحقق من وجود العقارين
      const prop1 = await storage.getPropertyByNumber(propertyNumber1);
      const prop2 = await storage.getPropertyByNumber(propertyNumber2);
      
      if (!prop1 || !prop2) {
        return res.status(400).json({ 
          error: "أحد العقارين غير موجود",
          missing: !prop1 ? propertyNumber1 : propertyNumber2
        });
      }
      
      // جلب الباقة
      const pkg = await storage.getPackage(packageId);
      if (!pkg) {
        return res.status(400).json({ error: "الباقة غير موجودة" });
      }
      
      // حساب التواريخ
      const startDate = new Date().toISOString();
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + (pkg.durationMonths || 1));
      
      const sub = await googleSheetsService.createMultiPropertySubscription({
        packageId,
        propertyNumber1,
        propertyNumber2,
        startDate,
        endDate: endDate.toISOString(),
        status: "فعال",
      });
      
      res.json({ success: true, subscription: sub });
    } catch (error) {
      console.error("Error creating multi-property subscription:", error);
      res.status(500).json({ error: "فشل في إنشاء اشتراك العقارين" });
    }
  });

  // ======================
  // DONE
  // ======================
  return createServer(app);
}
