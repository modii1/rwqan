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
import { updateRemainingDaysInSheet } from "./scheduler";

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
  // 🔧 endpoint مؤقت لتحديث بيانات العقار (للاختبار)
  app.put("/api/admin/property/:propertyNumber", async (req, res) => {
    try {
      const { propertyNumber } = req.params;
      const updates = req.body;
      const updated = await storage.updateProperty(propertyNumber, updates);
      res.json({ success: true, property: updated });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  app.get("/api/properties", async (_req, res) => {
  try {
    const items = await storage.getProperties();

    // 🟢 إظهار العقارات المقبولة فقط
    // 🟢 مع السماح للعقارات القديمة التي لا تحتوي verificationStatus
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

      // خريطة عكسية للترجمة من الإنجليزية للعربية
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

      // تتبع التغييرات للإشعار
      const changesForNotification: string[] = [];

      for (const key in incoming) {
        if (key === "pin") continue; // تخطي الرقم السري

        if (SHEET_MAP[key]) {
          mapped[SHEET_MAP[key]] = incoming[key];
          const arabicName = Object.entries(SHEET_MAP).find(([_, v]) => v === SHEET_MAP[key])?.[0]?.replace(/[^\u0600-\u06FF\s]/g, '').trim() || key;
          changesForNotification.push(`${arabicName}: ${incoming[key]}`);
        } else {
          // المفاتيح الإنجليزية مباشرة
          mapped[key] = incoming[key];
          const arabicName = REVERSE_MAP[key] || key;
          changesForNotification.push(`${arabicName}: ${incoming[key]}`);
        }
      }

      delete mapped.propertyNumber;
      delete mapped.pin;

      const updated = await storage.updateProperty(
        req.params.propertyNumber,
        mapped
      );

      if (!updated)
        return res.status(404).json({ error: "العقار غير موجود" });

      // إرسال إشعار واتساب عند تعديل العقار
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

  // التحقق من العقار الثاني (للباقات متعددة العقارات)
  app.post("/api/owner/verify-second-property", requireOwner, async (req, res) => {
    try {
      const ownerPropertyNumber = (req.session as any).propertyNumber;
      const { secondPropertyNumber } = req.body;

      if (!secondPropertyNumber) {
        return res.status(400).json({ error: "رقم العقار الثاني مطلوب" });
      }

      // التحقق من أن العقار الثاني ليس نفس العقار الأول
      if (secondPropertyNumber === ownerPropertyNumber) {
        return res.status(400).json({ error: "لا يمكن اختيار نفس العقار" });
      }

      // جلب بيانات العقار الأول
      const ownerProperty = await storage.getPropertyByNumber(ownerPropertyNumber);
      if (!ownerProperty) {
        return res.status(404).json({ error: "لم يتم العثور على عقارك" });
      }

      // جلب بيانات العقار الثاني
      const secondProperty = await storage.getPropertyByNumber(secondPropertyNumber);
      if (!secondProperty) {
        return res.status(404).json({ error: "لم يتم العثور على العقار الثاني" });
      }

      // التحقق من تطابق الـ PIN (نفس المالك)
      if (secondProperty.pin !== ownerProperty.pin) {
        return res.status(403).json({ error: "هذا العقار يخص مالك آخر" });
      }

      // التحقق من أن العقار الثاني ليس لديه اشتراك مميز نشط
      const secondSubscription = await storage.getSubscriptionByPropertyNumber(secondPropertyNumber);
      if (secondSubscription && secondSubscription.status === 'نشط') {
        const endDate = new Date(secondSubscription.endDate);
        if (endDate > new Date()) {
          return res.status(400).json({ 
            error: "العقار الثاني لديه اشتراك نشط بالفعل",
            existingEndDate: secondSubscription.endDate
          });
        }
      }

      res.json({
        ok: true,
        property: {
          number: secondProperty.propertyNumber,
          name: secondProperty.name,
          city: secondProperty.city
        }
      });
    } catch (err: any) {
      console.error("Verify second property error:", err);
      res.status(500).json({ error: err?.message || "فشل في التحقق" });
    }
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

  // =====================================
  // 📅 تحديث الأيام المتبقية يدوياً
  // =====================================
  app.post("/api/admin/update-remaining-days", requireAdmin, async (req, res) => {
    try {
      console.log("📅 [API] تشغيل تحديث الأيام المتبقية يدوياً...");
      const result = await updateRemainingDaysInSheet();
      res.json({ 
        success: true, 
        message: "تم تحديث الأيام المتبقية بنجاح",
        ...result 
      });
    } catch (error) {
      console.error("❌ [API] خطأ في تحديث الأيام المتبقية:", error);
      res.status(500).json({ error: "فشل في تحديث الأيام المتبقية" });
    }
  });

  // =====================================
  // 🧪 اختبار إشعارات الاشتراكات المنتهية
  // =====================================
  app.post("/api/admin/test-expired-notifications", requireAdmin, async (req, res) => {
    try {
      console.log("🧪 [TEST] بدء اختبار إشعارات الاشتراكات المنتهية...");

      const subscriptions = await storage.getSubscriptions();
      const properties = await storage.getProperties();

      // البحث عن اشتراكات منتهية
      const expiredSubscriptions = subscriptions.filter(sub => {
        if (!sub.endDate) return false;
        const endDate = new Date(sub.endDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        endDate.setHours(0, 0, 0, 0);
        return endDate < today;
      });

      console.log(`📊 [TEST] وجد ${expiredSubscriptions.length} اشتراك منتهي`);

      const notifications = [];

      // إرسال إشعار لكل اشتراك منتهي
      for (const sub of expiredSubscriptions.slice(0, 5)) { // حد أقصى 5 إشعارات للاختبار
        const property = properties.find(p => p.propertyNumber === sub.propertyNumber);

        if (property) {
          console.log(`📤 [TEST] إرسال إشعار لـ ${property.name} (${sub.propertyNumber})`);

          try {
            const { notifySubscriptionExpired } = await import("./whatsapp");
            const result = await notifySubscriptionExpired({
              propertyNumber: sub.propertyNumber,
              propertyName: property.name || "",
              ownerPhone: property.whatsappNumber || "",
            });

            notifications.push({
              propertyNumber: sub.propertyNumber,
              propertyName: property.name,
              endDate: sub.endDate,
              status: result.status,
              response: result.response,
            });

            console.log(`✅ [TEST] تم إرسال الإشعار: ${result.status}`);
          } catch (err: any) {
            console.error(`❌ [TEST] خطأ في إرسال الإشعار:`, err);
            notifications.push({
              propertyNumber: sub.propertyNumber,
              propertyName: property.name,
              endDate: sub.endDate,
              status: "error",
              response: err.message,
            });
          }
        }
      }

      res.json({
        success: true,
        message: `تم اختبار ${notifications.length} إشعار من أصل ${expiredSubscriptions.length} اشتراك منتهي`,
        totalExpired: expiredSubscriptions.length,
        notificationsSent: notifications.length,
        notifications,
      });
    } catch (error: any) {
      console.error("❌ [TEST] خطأ في اختبار الإشعارات:", error);
      res.status(500).json({ error: error.message || "فشل في اختبار الإشعارات" });
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

  // ======================
  // نظام التنبيهات الذكية
  // ======================
  app.get("/api/admin/alerts", requireAdmin, async (req, res) => {
    try {
      const alerts: Array<{
        type: 'warning' | 'danger' | 'info' | 'success';
        category: string;
        title: string;
        message: string;
        count?: number;
        items?: any[];
        icon?: string;
      }> = [];

      // استخدام توقيت الرياض (UTC+3)
      const nowRiyadh = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }));
      const todayStart = new Date(nowRiyadh.getFullYear(), nowRiyadh.getMonth(), nowRiyadh.getDate());
      const sevenDaysAgo = new Date(nowRiyadh.getTime() - 7 * 24 * 60 * 60 * 1000);
      const oneDayAgo = new Date(nowRiyadh.getTime() - 24 * 60 * 60 * 1000);
      const now = nowRiyadh;
      
      console.log(`🕐 [Alerts] Riyadh time: ${nowRiyadh.toISOString()}, Today start: ${todayStart.toISOString()}`);

      // جلب جميع البيانات
      const [subscriptions, payments, allRequests, properties, suggestions] = await Promise.all([
        storage.getSubscriptions(),
        storage.getPayments(),
        storage.getRequests(),
        storage.getProperties(),
        storage.getSuggestions()
      ]);

      // 1. عقارات جديدة اليوم (تاريخ الإنشاء - createdAt)
      const newPropertiesToday = properties.filter(p => {
        if (!p.createdAt) return false;
        const created = new Date(p.createdAt);
        if (isNaN(created.getTime())) return false;
        return created >= todayStart;
      });
      console.log(`🏠 [Alerts] New properties today (createdAt): ${newPropertiesToday.length}`);
      if (newPropertiesToday.length > 0) {
        alerts.push({
          type: 'success',
          category: 'new-properties',
          title: 'عقارات جديدة اليوم',
          message: `${newPropertiesToday.length} عقار تم تسجيله اليوم`,
          count: newPropertiesToday.length,
          icon: 'home-plus',
          items: newPropertiesToday.slice(0, 5).map(p => ({
            propertyNumber: p.propertyNumber,
            name: p.name,
            city: p.city,
            createdAt: p.createdAt
          }))
        });
      }
      
      // 2. تحديثات العقارات (تاريخ التحديث - updatedAt خلال 24 ساعة)
      // ملاحظة: يجب أن يكون التحديث مختلف عن تاريخ الإنشاء
      const updatedProperties = properties.filter(p => {
        if (!p.updatedAt) return false;
        const updated = new Date(p.updatedAt);
        if (isNaN(updated.getTime())) return false;
        // تأكد أن التحديث خلال 24 ساعة
        if (updated < oneDayAgo) return false;
        // تأكد أن التحديث ليس نفس تاريخ الإنشاء (عقار جديد)
        if (p.createdAt) {
          const created = new Date(p.createdAt);
          // إذا كان الفرق أقل من دقيقة، فهو عقار جديد وليس تحديث
          if (Math.abs(updated.getTime() - created.getTime()) < 60000) return false;
        }
        return true;
      });
      console.log(`📝 [Alerts] Updated properties (24h): ${updatedProperties.length}`);
      if (updatedProperties.length > 0) {
        alerts.push({
          type: 'info',
          category: 'property-updates',
          title: 'تحديثات العقارات',
          message: `${updatedProperties.length} عقار تم تحديثه خلال 24 ساعة`,
          count: updatedProperties.length,
          icon: 'edit',
          items: updatedProperties.slice(0, 5).map(p => ({
            propertyNumber: p.propertyNumber,
            name: p.name,
            city: p.city,
            updatedAt: p.updatedAt
          }))
        });
      }
      
      // 3. اشتراكات جديدة اليوم (عقارات بدأت اشتراكها اليوم)
      const todaySubscriptions = subscriptions.filter(s => {
        if (!s.startDate) return false;
        const startDate = new Date(s.startDate);
        if (isNaN(startDate.getTime())) return false;
        return startDate >= todayStart;
      });
      console.log(`🏠 [Alerts] Today subscriptions: ${todaySubscriptions.length}, Total: ${subscriptions.length}`);
      if (todaySubscriptions.length > 0) {
        alerts.push({
          type: 'success',
          category: 'new-subscriptions',
          title: 'اشتراكات جديدة اليوم',
          message: `${todaySubscriptions.length} عقار بدأ اشتراكه اليوم`,
          count: todaySubscriptions.length,
          icon: 'calendar-check',
          items: todaySubscriptions.slice(0, 5).map(s => {
            const prop = properties.find(p => p.propertyNumber === s.propertyNumber);
            return {
              propertyNumber: s.propertyNumber,
              name: prop?.name || 'غير معروف',
              city: prop?.city || '',
              packageId: s.packageId,
              type: s.type,
              startDate: s.startDate
            };
          })
        });
      }

      // 2. مدفوعات جديدة اليوم
      const todayPayments = payments.filter(p => {
        const payDate = new Date(p.createdAt);
        return payDate >= todayStart;
      });
      if (todayPayments.length > 0) {
        const totalAmount = todayPayments.reduce((sum, p) => sum + (p.finalAmount || p.amount || 0), 0);
        alerts.push({
          type: 'success',
          category: 'new-payments',
          title: 'مدفوعات اليوم',
          message: `${todayPayments.length} دفعة جديدة بإجمالي ${totalAmount} ر.س`,
          count: todayPayments.length,
          icon: 'credit-card',
          items: todayPayments.slice(0, 5).map(p => {
            const prop = properties.find(pr => pr.propertyNumber === p.propertyNumber);
            return {
              propertyNumber: p.propertyNumber,
              name: prop?.name || '',
              amount: p.finalAmount || p.amount,
              method: p.paymentMethod,
              status: p.status
            };
          })
        });
      }

      // 3. المدفوعات المعلقة (تحتاج موافقة)
      const pendingPayments = payments.filter(p => p.status === 'pending');
      if (pendingPayments.length > 0) {
        alerts.push({
          type: 'danger',
          category: 'pending-payments',
          title: 'مدفوعات تنتظر الموافقة',
          message: `${pendingPayments.length} دفعة معلقة تحتاج مراجعة عاجلة`,
          count: pendingPayments.length,
          icon: 'alert-circle',
          items: pendingPayments.slice(0, 5).map(p => {
            const prop = properties.find(pr => pr.propertyNumber === p.propertyNumber);
            return {
              propertyNumber: p.propertyNumber,
              name: prop?.name || '',
              amount: p.finalAmount || p.amount,
              method: p.paymentMethod,
              createdAt: p.createdAt
            };
          })
        });
      }

      // 4. اقتراحات جديدة (غير مقروءة)
      console.log(`📝 [Alerts] Suggestions count: ${suggestions.length}`);
      if (suggestions.length > 0) {
        console.log(`📝 [Alerts] Suggestion statuses:`, suggestions.map(s => s.status));
      }
      const pendingSuggestions = suggestions.filter(s => 
        s.status === 'pending' || s.status === 'معلق' || s.status === 'جديد' || !s.status
      );
      console.log(`📝 [Alerts] Pending suggestions: ${pendingSuggestions.length}`);
      if (pendingSuggestions.length > 0) {
        alerts.push({
          type: 'info',
          category: 'suggestions',
          title: 'اقتراحات جديدة',
          message: `${pendingSuggestions.length} اقتراح ينتظر المراجعة`,
          count: pendingSuggestions.length,
          icon: 'lightbulb',
          items: pendingSuggestions.slice(0, 5).map(s => ({
            name: s.name,
            mobile: s.mobile,
            city: s.city,
            suggestion: s.suggestion?.substring(0, 50) + '...'
          }))
        });
      }

      // 5. طلبات واتساب اليوم
      const todayRequests = allRequests.filter(r => {
        const reqDate = new Date(r.timestamp);
        return reqDate >= todayStart;
      });
      if (todayRequests.length > 0) {
        alerts.push({
          type: 'info',
          category: 'requests',
          title: 'طلبات واتساب اليوم',
          message: `${todayRequests.length} طلب واتساب جديد`,
          count: todayRequests.length,
          icon: 'message-circle',
          items: todayRequests.slice(0, 5).map(r => {
            const prop = properties.find(pr => pr.propertyNumber === r.propertyNumber);
            return {
              propertyNumber: r.propertyNumber,
              name: prop?.name || '',
              requestCode: r.requestCode,
              timestamp: r.timestamp
            };
          })
        });
      }

      // 6. اشتراكات ستنتهي خلال 7 أيام
      const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const expiringSoon = subscriptions.filter(sub => {
        if (sub.status !== 'active') return false;
        const endDate = new Date(sub.endDate);
        return endDate > now && endDate <= sevenDaysLater;
      });
      if (expiringSoon.length > 0) {
        alerts.push({
          type: 'warning',
          category: 'expiring-subscriptions',
          title: 'اشتراكات ستنتهي قريباً',
          message: `${expiringSoon.length} اشتراك سينتهي خلال 7 أيام`,
          count: expiringSoon.length,
          icon: 'clock',
          items: expiringSoon.slice(0, 5).map(s => {
            const prop = properties.find(pr => pr.propertyNumber === s.propertyNumber);
            return {
              propertyNumber: s.propertyNumber,
              name: prop?.name || '',
              endDate: s.endDate,
              daysLeft: Math.ceil((new Date(s.endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
            };
          })
        });
      }

      // 7. اشتراكات منتهية حديثاً
      const recentlyExpired = subscriptions.filter(sub => {
        if (sub.status !== 'expired') return false;
        const endDate = new Date(sub.endDate);
        return endDate >= sevenDaysAgo && endDate < now;
      });
      if (recentlyExpired.length > 0) {
        alerts.push({
          type: 'danger',
          category: 'expired-subscriptions',
          title: 'اشتراكات منتهية',
          message: `${recentlyExpired.length} اشتراك انتهى ويحتاج تجديد`,
          count: recentlyExpired.length,
          icon: 'x-circle',
          items: recentlyExpired.slice(0, 5).map(s => {
            const prop = properties.find(pr => pr.propertyNumber === s.propertyNumber);
            return {
              propertyNumber: s.propertyNumber,
              name: prop?.name || '',
              endDate: s.endDate
            };
          })
        });
      }

      // 8. تم نقله للقسم 2 (تحديثات العقارات)

      // حساب الإحصائيات - دعم القيم العربية والإنجليزية
      const activeSubscriptions = subscriptions.filter(s => 
        s.status === 'active' || s.status === 'نشط'
      ).length;
      const expiredSubscriptions = subscriptions.filter(s => 
        s.status === 'expired' || s.status === 'منتهي'
      ).length;
      const trustedProperties = properties.filter(p => 
        p.subscriptionType === 'trusted' || p.subscriptionType === 'مميز'
      ).length;
      const normalProperties = properties.filter(p => 
        p.subscriptionType === 'normal' || p.subscriptionType === 'عادي' || p.subscriptionType === 'مجاني'
      ).length;
      
      // Debug log
      console.log(`📊 [Alerts Stats] Properties: ${properties.length}, Trusted: ${trustedProperties}, Normal: ${normalProperties}`);
      console.log(`📊 [Alerts Stats] Subscriptions: ${subscriptions.length}, Active: ${activeSubscriptions}, Expired: ${expiredSubscriptions}`);
      
      // عرض جميع القيم الفريدة
      const uniqueTypes = [...new Set(properties.map(p => p.subscriptionType))];
      const uniqueStatuses = [...new Set(subscriptions.map(s => s.status))];
      console.log(`📊 [Alerts Stats] Unique property types:`, uniqueTypes);
      console.log(`📊 [Alerts Stats] Unique subscription statuses:`, uniqueStatuses);

      // إحصائيات الأسبوع
      const weekPayments = payments.filter(p => {
        const payDate = new Date(p.createdAt);
        return payDate >= sevenDaysAgo;
      });
      const weekRequests = allRequests.filter(r => {
        const reqDate = new Date(r.timestamp);
        return reqDate >= sevenDaysAgo;
      });
      const weekRevenue = weekPayments
        .filter(p => p.status === 'completed')
        .reduce((sum, p) => sum + (p.finalAmount || p.amount || 0), 0);

      // حساب عدد التنبيهات المهمة
      const criticalCount = alerts.filter(a => a.type === 'danger').reduce((sum, a) => sum + (a.count || 0), 0);
      const warningCount = alerts.filter(a => a.type === 'warning').reduce((sum, a) => sum + (a.count || 0), 0);

      res.json({
        alerts,
        stats: {
          totalProperties: properties.length,
          trustedProperties,
          normalProperties,
          activeSubscriptions,
          expiredSubscriptions,
          pendingPayments: pendingPayments.length,
          todayRequests: todayRequests.length,
          todayPayments: todayPayments.length,
          todayProperties: newPropertiesToday.length,
          todaySubscriptions: todaySubscriptions.length,
          propertyUpdates: updatedProperties.length,
          weekRequests: weekRequests.length,
          weekPayments: weekPayments.length,
          weekRevenue,
          pendingSuggestions: pendingSuggestions.length
        },
        summary: {
          totalAlerts: criticalCount + warningCount,
          criticalAlerts: criticalCount,
          warningAlerts: warningCount,
          lastUpdated: new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' })
        }
      });
    } catch (err: any) {
      console.error("Alerts error:", err);
      res.status(500).json({ error: "فشل في جلب التنبيهات" });
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
  // ADMINROUTES
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


  // استخدام getPackages() في السطر 2197 بدلاً من هذا (تم حذفه لتجنب التكرار)

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
// 🖼️ PUBLIC — جلب صور العقار من R2 (للصفحة الرئيسية)
// ======================================================
app.get("/api/public/property-images/:propertyNumber", async (req, res) => {
  try {
    const propertyNumber = req.params.propertyNumber;

    const list = await r2.send(
      new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: `${propertyNumber}/`,
      })
    );

    // فلترة الصور فقط (jpg, png, webp) وترتيبها
    const images = (list.Contents || [])
      .filter((obj) => obj.Key && /\.(jpg|jpeg|png|webp)$/i.test(obj.Key))
      .sort((a, b) => {
        // ترتيب حسب اسم الملف (1.jpg, 2.jpg, etc.)
        const numA = parseInt(a.Key?.match(/(\d+)\./)?.[1] || "0");
        const numB = parseInt(b.Key?.match(/(\d+)\./)?.[1] || "0");
        return numA - numB;
      })
      .map((obj) => `${R2_PUBLIC_URL}/${obj.Key}`);

    res.json({ images });
  } catch (err) {
    console.error("PUBLIC R2 LIST ERROR:", err);
    res.json({ images: [] }); // Return empty array on error
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
    const { propertyNumber, packageId, discountCode, paymentMethod = "cards", action, secondPropertyNumber } = req.body;

    if (!propertyNumber) {
      return res.status(400).json({ error: "رقم العقار مطلوب" });
    }

    // جلب بيانات الباقة
    const pkg = await storage.getPackageById(packageId);
    if (!pkg) return res.status(404).json({ error: "الباقة غير موجودة" });

    // جلب بيانات العقار
    // للتسجيل الجديد (new action)، قد لا يكون العقار موجوداً بعد
    const property = await storage.getPropertyByNumber(propertyNumber);
    if (!property && action !== 'new') {
      return res.status(404).json({ error: "العقار غير موجود" });
    }

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
    // للتسجيل الجديد، قد لا تكون بيانات العقار كاملة بعد
    const propertyName = property?.name || "عقار جديد";
    const whatsappNumber = property?.whatsappNumber || "0000000000";
    
    const paymobResult = await paymobService.createIntention(
      finalAmount,
      propertyNumber,
      propertyName,
      whatsappNumber,
      pkg.name,
      pkg.duration,
      paymentMethod as "cards" | "applepay"
    );

    // حساب بيانات الاشتراك المعلقة (ستحفظ فقط بعد نجاح الدفع)
    let pendingStartDate: string | undefined;
    let pendingEndDate: string | undefined;
    let pendingSubscriptionType: string | undefined;
    let pendingPrice: number | undefined;

    // حساب تواريخ الاشتراك لجميع الحالات
    const today = new Date();
    let startDate = today;
    let endDate = new Date(today.getTime() + pkg.duration * 24 * 60 * 60 * 1000);
    let price = pkg.price;
    let subscriptionType = pkg.type;

    if (action === 'extend' || action === 'upgrade') {
      const currentSubscription = await googleSheetsService.getSubscriptionByPropertyNumber(propertyNumber);

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
    }

    // حفظ بيانات الاشتراك المعلقة لجميع الحالات
    pendingStartDate = startDate.toISOString().split('T')[0];
    pendingEndDate = endDate.toISOString().split('T')[0];
    pendingSubscriptionType = subscriptionType;
    pendingPrice = price;

    // إنشاء سجل الدفع مع بيانات الاشتراك المعلقة
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
      action: action as 'new' | 'extend' | 'upgrade' | undefined,
      pendingStartDate,
      pendingEndDate,
      pendingSubscriptionType,
      pendingPrice,
      secondPropertyNumber: secondPropertyNumber || undefined,
    });

    console.log(`✅ Payment created (pending): ${payment.id}, Checkout URL: ${paymobResult.checkoutUrl}`);

    // إرسال إشعار واتساب للمسؤول عن الدفعة الجديدة
    try {
      await notifyNewPayment({
        propertyNumber,
        propertyName: propertyName,
        amount: finalAmount,
        paymentMethod: paymentMethod === "applepay" ? "Apple Pay" : "بطاقة",
        transactionId: payment.id,
      });
    } catch (notifyErr) {
      console.error("Failed to send payment notification:", notifyErr);
    }

    res.json({
      checkoutUrl: paymobResult.checkoutUrl,
      paymentId: payment.id,
    });
  } catch (err: any) {
    console.error("Payment initiate error:", err);
    res.status(500).json({ error: err.message || "خطأ في بدء الدفع" });
  }
});

// إعادة محاولة الدفع للدفعات المعلقة
app.post("/api/owner/payment/retry", async (req, res) => {
  try {
    const { paymentId } = req.body;

    if (!paymentId) {
      return res.status(400).json({ error: "معرف الدفعة مطلوب" });
    }

    // جلب الدفعة السابقة
    const payment = await googleSheetsService.getPaymentById(paymentId);
    if (!payment) {
      return res.status(404).json({ error: "الدفعة غير موجودة" });
    }

    if (payment.status === "مكتمل") {
      return res.status(400).json({ error: "الدفعة مكتملة مسبقاً" });
    }

    // جلب الباقة
    const pkg = await storage.getPackageById(payment.packageId);
    if (!pkg) {
      return res.status(404).json({ error: "الباقة غير موجودة" });
    }

    // جلب بيانات العقار
    const property = await storage.getPropertyByNumber(payment.propertyNumber);
    const phone = property?.whatsappNumber || "0500000000";
    const propertyName = property?.name || "عقار";

    // إنشاء رابط دفع جديد
    const paymobResult = await paymobService.createIntention(
      payment.finalAmount,
      payment.propertyNumber,
      propertyName,
      phone,
      pkg.name,
      pkg.duration,
      "cards"
    );

    // تحديث الدفعة بمعرف Paymob الجديد
    await googleSheetsService.updatePayment(paymentId, {
      paymobOrderId: paymobResult.intentionId,
    });

    console.log(`🔄 Payment retry for ${paymentId}, new checkout: ${paymobResult.checkoutUrl}`);

    res.json({
      checkoutUrl: paymobResult.checkoutUrl,
      paymentId: paymentId,
    });
  } catch (err: any) {
    console.error("Payment retry error:", err);
    res.status(500).json({ error: err.message || "خطأ في إعادة الدفع" });
  }
});

// رفع إيصال جديد لدفعة معلقة
app.post("/api/owner/payment/upload-receipt", upload.single("receipt"), async (req, res) => {
  try {
    const propertyNumber = (req.session as any).propertyNumber;
    if (!propertyNumber) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { paymentId, action } = req.body; // Add action here

    if (!paymentId) {
      return res.status(400).json({ error: "معرف الدفعة مطلوب" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "الإيصال مطلوب" });
    }

    // جلب الدفعة والتحقق من أنها تخص هذا العقار
    const payment = await googleSheetsService.getPaymentById(paymentId);
    if (!payment) {
      return res.status(404).json({ error: "الدفعة غير موجودة" });
    }

    if (payment.propertyNumber !== propertyNumber) {
      return res.status(403).json({ error: "غير مصرح لك" });
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

    // تحديث الدفعة بالإيصال الجديد
    await googleSheetsService.updatePayment(paymentId, {
      receiptUrl: receiptUrl,
    });

    // إرسال إشعار WhatsApp
    const property = await googleSheetsService.getPropertyByNumber(propertyNumber);
    await sendWhatsAppNotification(
      `📤 *تم رفع إيصال جديد*\n\n` +
      `📍 العقار: ${property?.name || propertyNumber}\n` +
      `🔢 رقم العقار: ${propertyNumber}\n` +
      `💵 المبلغ: ${payment.finalAmount} ر.س\n` +
      `📦 الباقة: ${payment.packageId}\n` +
      `🧾 الإيصال: ${receiptUrl}\n\n` +
      `⏳ بانتظار المراجعة والتفعيل`
    );

    console.log(`📤 Receipt uploaded for payment ${paymentId}: ${receiptUrl}`);

    res.json({ 
      success: true, 
      message: "تم رفع الإيصال بنجاح",
      receiptUrl: receiptUrl
    });
  } catch (err: any) {
    console.error("Receipt upload error:", err);
    res.status(500).json({ error: err.message || "خطأ في رفع الإيصال" });
  }
});

// 3. التحويل البنكي مع رفع الإيصال
app.post("/api/owner/payment/bank-transfer", upload.single("receipt"), async (req, res) => {
  try {
    const { propertyNumber, packageId, discountCode, action, secondPropertyNumber } = req.body;

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

    // إنشاء سجل الدفع (مع حفظ العقار الثاني إن وجد)
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
      secondPropertyNumber: secondPropertyNumber || undefined,
    } as any);

    console.log(`💾 Payment created: ${payment.id}, secondPropertyNumber: ${secondPropertyNumber || 'none'}`);

    // إرسال إشعار واتساب للمسؤول عن الدفعة الجديدة (للتسجيلات الجديدة)
    if (!action || action === 'new') {
      try {
        await notifyNewPayment({
          propertyNumber,
          propertyName: property.name || "",
          amount: finalAmount,
          paymentMethod: "تحويل بنكي",
          transactionId: payment.id,
        });
      } catch (notifyErr) {
        console.error("Failed to send payment notification:", notifyErr);
      }
    }

    // حفظ البيانات للاشتراك/التمديد/الترقية
    // لا تقم بإنشاء أو تعديل الاشتراك إلا إذا كان هناك إجراء محدد (extend أو upgrade)
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
      await googleSheetsService.addSubscriptionToSheet(propertyNumber, subscriptionData, property, receiptUrl);
      console.log(`✅ Subscription saved to الاشتراكات sheet for property ${propertyNumber}`);

      // إرسال إشعار WhatsApp عند رفع الإيصال (للتمديد/الترقية فقط)
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
      // اقرأ رقم العقار من الكوكي وليس السيشن
const propertyNumber =
  req.cookies?.ownerPropertyNumber ||
  (req.session as any)?.propertyNumber;

if (!propertyNumber) {
  return res.status(401).json({ error: "NOT_AUTHENTICATED" });
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

  // GET owner's payments history - سجل مدفوعات المالك
  app.get("/api/owner/payments", requireOwner, async (req, res) => {
    try {
      // اقرأ رقم العقار من الكوكي وليس السيشن
const propertyNumber =
  req.cookies?.ownerPropertyNumber ||
  (req.session as any)?.propertyNumber;

if (!propertyNumber) {
  return res.status(401).json({ error: "NOT_AUTHENTICATED" });
}


      console.log(`🔍 Fetching payments for property: ${propertyNumber}`);

      const payments = await googleSheetsService.getPaymentsByProperty(propertyNumber);

      console.log(`✅ Found ${payments.length} payments for property: ${propertyNumber}`);
      res.json(payments);
    } catch (err: any) {
      console.error("Get owner payments error:", err?.message);
      res.status(500).json({ error: "Failed to load payments" });
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
  // نظام التحقق الذكي من التحويلات البنكية
  // ======================

  // التحقق التلقائي من التحويل البنكي المعلق
  app.get("/api/owner/payment/check-pending", requireOwner, async (req, res) => {
    try {
      const propertyNumber = (req.session as any).propertyNumber;
      if (!propertyNumber) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const payments = await googleSheetsService.getPaymentsByProperty(propertyNumber);

      // البحث عن دفعة معلقة (تحويل بنكي)
      const pendingPayment = payments.find(p => 
        (p.status === "قيد المراجعة" || p.status === "معلق") && 
        p.paymentMethod === "تحويل بنكي"
      );

      if (!pendingPayment) {
        return res.json({ hasPending: false });
      }

      // التحقق التلقائي من البيانات
      const issues: string[] = [];

      // 1. التحقق من الإيصال
      if (!pendingPayment.receiptUrl) {
        issues.push("لم يتم رفع إيصال التحويل");
      }

      // 2. التحقق من البيانات الأساسية
      if (!pendingPayment.finalAmount || pendingPayment.finalAmount <= 0) {
        issues.push("المبلغ غير صحيح");
      }

      if (!pendingPayment.packageId) {
        issues.push("لم يتم تحديد الباقة");
      }

      // 3. التحقق من العمر (أكثر من 7 أيام = تحذير)
      const paymentDate = new Date(pendingPayment.createdAt || "");
      const daysSincePayment = Math.floor((Date.now() - paymentDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysSincePayment > 7) {
        issues.push(`الدفع معلق منذ ${daysSincePayment} يوم - قد تحتاج المتابعة`);
      }

      return res.json({
        hasPending: true,
        payment: pendingPayment,
        autoCheckPassed: issues.length === 0,
        issues: issues.length > 0 ? issues : undefined,
      });
    } catch (err: any) {
      console.error("Check pending payment error:", err);
      res.status(500).json({ error: "خطأ في التحقق من الدفع" });
    }
  });

  // تفعيل الاشتراك تلقائياً بعد التحقق من بيانات العقار
  app.post("/api/owner/property/activate", requireOwner, async (req, res) => {
    try {
      const propertyNumber = (req.session as any).propertyNumber;
      if (!propertyNumber) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      // قراءة الحالة المطلوبة من الطلب (approved أو rejected)
      const requestedStatus = req.body.status || 'approved';

      // جلب بيانات العقار
      const property = await googleSheetsService.getPropertyByNumber(propertyNumber);
      if (!property) {
        return res.status(404).json({ error: "العقار غير موجود" });
      }

      // إذا كانت الحالة rejected، نحدث مباشرة ونخرج
      if (requestedStatus === 'rejected') {
        await googleSheetsService.updateVerificationStatus(propertyNumber, "rejected");
        console.log(`❌ Verification status updated to 'rejected' for property ${propertyNumber}`);

        return res.json({ 
          success: true, 
          message: "تم تحديث حالة العقار إلى مرفوض",
          status: 'rejected'
        });
      }

      // البحث عن دفعة معلقة (قيد التحقق أو قيد المراجعة)
      const payments = await googleSheetsService.getPaymentsByProperty(propertyNumber);
      const pendingPayment = payments.find(p => 
        (p.status === "قيد التحقق" || p.status === "قيد المراجعة" || p.status === "نجح - قيد التحقق")
      );

      if (!pendingPayment) {
        // تحديث حالة التحقق فقط (للعقارات القديمة أو المجانية)
        await googleSheetsService.updateVerificationStatus(propertyNumber, "approved");
        console.log(`✅ Verification status updated to 'approved' for property ${propertyNumber} (no pending payment)`);

        return res.json({ 
          success: true, 
          message: "تم التحقق من بيانات العقار بنجاح",
          verificationOnly: true
        });
      }

      // تحديث حالة الدفع إلى مكتمل
      await googleSheetsService.updatePaymentStatus(pendingPayment.id, "مكتمل");
      console.log(`✅ Payment status updated to 'مكتمل' for payment ${pendingPayment.id}`);

      // جلب بيانات الباقة
      const pkg = await storage.getPackageById(pendingPayment.packageId);
      if (!pkg) {
        return res.status(404).json({ error: "الباقة غير موجودة" });
      }

      // حساب تواريخ الاشتراك
      const today = new Date();
      const currentSubscription = await googleSheetsService.getSubscriptionByPropertyNumber(propertyNumber);

      let startDate = today;
      let endDate = new Date(today.getTime() + pkg.duration * 24 * 60 * 60 * 1000);

      // إذا كان هناك اشتراك نشط، ابدأ من تاريخ انتهائه
      if (currentSubscription && new Date(currentSubscription.endDate) > today) {
        startDate = new Date(currentSubscription.endDate);
        endDate = new Date(startDate.getTime() + pkg.duration * 24 * 60 * 60 * 1000);
      }

      // حساب السعر (نصف السعر إذا كانت باقة عقارين)
      const isMultiProperty = !!(pendingPayment as any).secondPropertyNumber;
      const pricePerProperty = isMultiProperty ? pendingPayment.finalAmount / 2 : pendingPayment.finalAmount;

      const subscriptionData = {
        packageId: pkg.id,
        price: pricePerProperty,
        subscriptionType: pkg.type,
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
        paymentId: pendingPayment.id,
        linkedProperty: isMultiProperty ? (pendingPayment as any).secondPropertyNumber : undefined,
      };

      // إضافة الاشتراك للشيت
      await googleSheetsService.addSubscriptionToSheet(
        propertyNumber,
        subscriptionData,
        property,
        pendingPayment.receiptUrl || ""
      );
      console.log(`✅ Subscription activated for property ${propertyNumber}`);

      // إضافة اشتراك للعقار الثاني إذا كانت باقة عقارين
      if ((pendingPayment as any).secondPropertyNumber) {
        const secondProperty = await googleSheetsService.getPropertyByNumber((pendingPayment as any).secondPropertyNumber);
        if (secondProperty) {
          const secondSubscriptionData = {
            ...subscriptionData,
            linkedProperty: propertyNumber,
          };
          await googleSheetsService.addSubscriptionToSheet(
            (pendingPayment as any).secondPropertyNumber,
            secondSubscriptionData,
            secondProperty,
            pendingPayment.receiptUrl || ""
          );
          console.log(`✅ Second property subscription activated: ${(pendingPayment as any).secondPropertyNumber}`);
        }
      }

      // تحديث حالة التحقق إلى approved
      await googleSheetsService.updateVerificationStatus(propertyNumber, "approved");
      console.log(`✅ Verification status updated to 'approved' for property ${propertyNumber}`);

      // إرسال إشعار WhatsApp
      await sendWhatsAppNotification(
        `🎉 *تم تفعيل الاشتراك بنجاح*\n\n` +
        `📍 العقار: ${property.name}\n` +
        `🔢 رقم العقار: ${propertyNumber}\n` +
        `📦 الباقة: ${pkg.name}\n` +
        `💵 المبلغ: ${pendingPayment.finalAmount} ر.س\n` +
        `📅 من: ${subscriptionData.startDate}\n` +
        `📅 إلى: ${subscriptionData.endDate}\n` +
        `🏷️ نوع الاشتراك: ${pkg.type}\n\n` +
        `✅ تم التحقق من البيانات وتفعيل الاشتراك`
      );

      res.json({ 
        success: true, 
        message: "تم تفعيل الاشتراك بنجاح" 
      });
    } catch (err: any) {
      console.error("Property activation error:", err);
      console.error("Property activation error details:", err.message, err.stack);
      res.status(500).json({ 
        success: false, 
        error: `خطأ في تفعيل الاشتراك: ${err.message || 'خطأ غير معروف'}`
      });
    }
  });

 // قبول التحويل البنكي (للإدارة)
app.post("/api/admin/payment/approve", async (req, res) => {
  try {
    const { paymentId } = req.body;

    if (!paymentId) {
      return res.status(400).json({ error: "معرف الدفع مطلوب" });
    }

    // جلب بيانات الدفع
    const payment = await googleSheetsService.getPaymentById(paymentId);
    if (!payment) {
      return res.status(404).json({ error: "الدفع غير موجود" });
    }

    // التحقق من أن الدفع معلق
    if (payment.status !== "قيد المراجعة" && payment.status !== "معلق") {
      return res.status(400).json({ error: "الدفع ليس معلقاً" });
    }

    // تحديث حالة الدفع إلى مكتمل
    await googleSheetsService.updatePaymentStatus(paymentId, "مكتمل");

    // جلب بيانات العقار
    const property = await googleSheetsService.getPropertyByNumber(payment.propertyNumber);

    if (property && payment.packageId) {
      const pkg = await storage.getPackageById(payment.packageId);
      if (pkg) {
        const today = new Date();
        const currentSubscription = await googleSheetsService.getSubscriptionByPropertyNumber(payment.propertyNumber);

        let startDate = today;
        let endDate = new Date(today.getTime() + pkg.duration * 86400000);

        // إذا كان هناك اشتراك نشط، ابدأ من تاريخ انتهائه
        if (currentSubscription && new Date(currentSubscription.endDate) > today) {
          startDate = new Date(currentSubscription.endDate);
          endDate = new Date(startDate.getTime() + pkg.duration * 86400000);
        }

        // حساب السعر لكل عقار (نصف السعر إذا كانت باقة عقارين)
        const isMultiProperty = !!(payment as any).secondPropertyNumber;
        const pricePerProperty = isMultiProperty ? payment.finalAmount / 2 : payment.finalAmount;

        const subscriptionData = {
          packageId: pkg.id,
          price: pricePerProperty,
          subscriptionType: pkg.type,
          startDate: startDate.toISOString().split("T")[0],
          endDate: endDate.toISOString().split("T")[0],
          paymentId: payment.id,
        };

        // إضافة الاشتراك للشيت
        await googleSheetsService.addSubscriptionToSheet(
          payment.propertyNumber,
          subscriptionData,
          property,
          payment.receiptUrl || ""
        );
        console.log(`✅ First property subscription activated: ${payment.propertyNumber}, price: ${pricePerProperty}`);

        // === إضافة اشتراك للعقار الثاني إذا كانت باقة عقارين ===
        if ((payment as any).secondPropertyNumber) {
          const secondProperty = await googleSheetsService.getPropertyByNumber((payment as any).secondPropertyNumber);
          if (secondProperty) {
            const secondSubscriptionData = {
              ...subscriptionData,
              linkedProperty: payment.propertyNumber, // ربط بالعقار الأول
            };
            await googleSheetsService.addSubscriptionToSheet(
              (payment as any).secondPropertyNumber,
              secondSubscriptionData,
              secondProperty,
              payment.receiptUrl || ""
            );
            console.log(`✅ Second property subscription activated: ${(payment as any).secondPropertyNumber}, price: ${pricePerProperty}`);

            // === ملء شيت "اشتراكات العقارين" تلقائياً ===
            await googleSheetsService.createMultiPropertySubscription({
              packageId: pkg.id,
              propertyNumber1: payment.propertyNumber,
              propertyNumber2: (payment as any).secondPropertyNumber,
              startDate: startDate.toISOString().split("T")[0],
              endDate: endDate.toISOString().split("T")[0],
              status: "نشط",
              paymentId: payment.id,
            });
            console.log(`✅ Multi-property subscription record created in sheet`);
          }
        }
      }
    }

    // ================================
    // قبول التحقق تلقائياً
    // ================================

    await googleSheetsService.updateVerificationStatus(
      payment.propertyNumber,
      "approved"
    );

    // قبول التحقق للعقار الثاني أيضاً
    if ((payment as any).secondPropertyNumber) {
      await googleSheetsService.updateVerificationStatus(
        (payment as any).secondPropertyNumber,
        "approved"
      );
    }

    // سجل التحقق
    await googleSheetsService.addVerificationLogToSheet({
      date: new Date().toISOString(),
      propertyNumber: payment.propertyNumber,
      action: "قبول التحقق",
      reason: "تم التأكد من صحة الإيصال وتفعيل الاشتراك",
      admin: "النظام",
    });

    res.json({ ok: true, message: "تم قبول التحويل وتفعيل الاشتراك" });

  } catch (err: any) {
    console.error("Approve payment error:", err);
    res.status(500).json({ error: "خطأ في قبول الدفع" });
  }
});


 // ======================
// رفض التحويل البنكي
// ======================
app.post("/api/admin/payment/reject", async (req, res) => {
  try {
    const { paymentId } = req.body;

    if (!paymentId) {
      return res.status(400).json({ error: "معرف الدفع مطلوب" });
    }

    // تحديث حالة الدفع
    await googleSheetsService.updatePaymentStatus(paymentId, "مرفوض");

    // جلب بيانات الدفع لمعرفة العقار
    const payment = await googleSheetsService.getPaymentById(paymentId);
    if (payment && payment.propertyNumber) {

      // رفض التحقق
      await googleSheetsService.updateVerificationStatus(payment.propertyNumber, "rejected");

      // تسجيل في سجل التحقق
      await googleSheetsService.addVerificationLogToSheet({
        date: new Date().toISOString(),
        propertyNumber: payment.propertyNumber,
        action: "رفض التحقق",
        reason: "إيصال دفع غير صحيح",
        admin: "النظام",
      });
    }

    res.json({ ok: true, message: "تم رفض التحويل" });
  } catch (err: any) {
    console.error("Reject payment error:", err);
    res.status(500).json({ error: "خطأ في رفض الدفع" });
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

  // ================== إيقاف/تفعيل إشعارات انتهاء الاشتراك ==================
  app.put("/api/admin/properties/:propertyNumber/mute-expiry", async (req, res) => {
    try {
      const { propertyNumber } = req.params;
      const { muted } = req.body;

      if (typeof muted !== "boolean") {
        return res.status(400).json({ error: "قيمة muted يجب أن تكون true أو false" });
      }

      const updated = await googleSheetsService.updateMuteExpiryNotification(
        propertyNumber,
        muted
      );

      console.log(`📢 [MuteExpiry] تم ${muted ? "إيقاف" : "تفعيل"} إشعارات انتهاء الاشتراك للعقار ${propertyNumber}`);

      res.json({
        success: true,
        message: muted ? "تم إيقاف إشعارات انتهاء الاشتراك" : "تم تفعيل إشعارات انتهاء الاشتراك",
        property: updated,
      });

    } catch (err) {
      console.error("Mute Expiry Error:", err);
      res.status(500).json({ success: false, message: "فشل في تعديل حالة الإشعارات" });
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
  // ✅ تأكيد المدفوعات يدوياً
  // ======================
  app.post("/api/admin/payments/:paymentId/confirm", async (req, res) => {
    try {
      const { paymentId } = req.params;
      console.log(`🔧 Manual payment confirmation for: ${paymentId}`);

      // جلب بيانات الدفع
      const payment = await googleSheetsService.getPaymentById(paymentId);
      if (!payment) {
        return res.status(404).json({ error: "الدفعة غير موجودة" });
      }

      if (payment.status === "مكتمل") {
        return res.status(400).json({ error: "الدفعة مكتملة مسبقاً" });
      }

      // تحديث حالة الدفع
      await googleSheetsService.updatePayment(paymentId, {
        status: "مكتمل",
        completedAt: new Date().toISOString(),
        paymentMethod: payment.paymentMethod || "تأكيد يدوي",
      });

      // تفعيل الاشتراك إذا كانت البيانات موجودة
      if (payment.pendingStartDate && payment.pendingEndDate) {
        const subscriptionData = {
          propertyNumber: payment.propertyNumber,
          packageId: payment.packageId,
          startDate: payment.pendingStartDate,
          endDate: payment.pendingEndDate,
          status: "نشط" as const,
          paymentId: paymentId,
        };

        await googleSheetsService.createSubscription(subscriptionData);

        // تحديث نوع الاشتراك في العقار
        const subType = payment.pendingSubscriptionType || "موثوق";
        await googleSheetsService.updateProperty(payment.propertyNumber, {
          subscriptionType: subType,
          subscriptionDate: payment.pendingEndDate,
        });

        console.log(`✅ Subscription activated for property: ${payment.propertyNumber}`);
      }

      res.json({ 
        success: true, 
        message: "تم تأكيد الدفعة وتفعيل الاشتراك بنجاح" 
      });
    } catch (error: any) {
      console.error("Error confirming payment:", error);
      res.status(500).json({ error: "فشل في تأكيد الدفعة" });
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

  app.get("/api/admin/partner-profits/summary", async (req, res) => {
    try {
      const summary = await googleSheetsService.getProfitsSummary();
      res.json(summary);
    } catch (error) {
      console.error("Error fetching profits summary:", error);
      res.status(500).json({ error: "فشل في جلب ملخص الأرباح" });
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
      const pkg = await storage.getPackageById(packageId);
      if (!pkg) {
        return res.status(400).json({ error: "الباقة غير موجودة" });
      }

      // حساب التواريخ (duration بالأيام)
      const startDate = new Date().toISOString();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + (pkg.duration || 30));

      const sub = await googleSheetsService.createMultiPropertySubscription({
        packageId,
        propertyNumber1,
        propertyNumber2,
        startDate,
        endDate: endDate.toISOString(),
        status: "نشط",
      });

      res.json({ success: true, subscription: sub });
    } catch (error) {
      console.error("Error creating multi-property subscription:", error);
      res.status(500).json({ error: "فشل في إنشاء اشتراك العقارين" });
    }
  });

  // ======================
  // 📋 إدارة الاشتراكات
  // ======================
  app.get("/api/admin/subscriptions", async (req, res) => {
    try {
      const subscriptions = await storage.getSubscriptions();
      const packages = await storage.getPackages();
      const properties = await storage.getProperties();

      // تحويل الاشتراكات لتضمين معلومات إضافية
      const enrichedSubscriptions = subscriptions.map(sub => {
        const property = properties.find(p => p.propertyNumber === sub.propertyNumber);
        const pkg = packages.find(p => p.id === sub.packageId);

        // حساب الأيام المتبقية - الاشتراك يبقى فعال طوال يوم الانتهاء
        let remainingDays: number | null = null;
        let status: "ساري" | "منتهي" | "قريب الانتهاء" | "نشط مجاني" = "ساري";

        // قراءة البيانات من الاشتراك مباشرة
        const subWithType = sub as any;

        // إذا لم يكن هناك تاريخ انتهاء = نشط مجاني (free)
        if (!sub.endDate || sub.endDate.trim() === "") {
          status = "نشط مجاني";
          remainingDays = null;
        } else {
          const end = new Date(sub.endDate);
          const now = new Date();

          // تصفير الوقت للمقارنة بالأيام فقط
          end.setHours(0, 0, 0, 0);
          now.setHours(0, 0, 0, 0);

          const diffTime = end.getTime() - now.getTime();
          remainingDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

          // الاشتراك منتهي فقط إذا كان تاريخ الانتهاء قبل اليوم (سالب)
          if (remainingDays < 0) {
            status = "منتهي";
          } else if (remainingDays <= 7) {
            // اليوم الأخير (0) أو باقي 7 أيام أو أقل ← ينتهي قريباً
            status = "قريب الانتهاء";
          }
        }

        // نوع الاشتراك من الشيت مباشرة (العمود 4)
        const displayType = subWithType.subscriptionType || "عادي";

        // اسم العقار من الشيت مباشرة (العمود 1) أو من جدول العقارات
        const propertyName = subWithType.propertyName || property?.name || "غير معروف";

        return {
          id: sub.id || `${sub.propertyNumber}-${sub.packageId}`,
          propertyNumber: sub.propertyNumber,
          name: propertyName,
          subscriptionType: displayType,
          price: subWithType.price || 0,
          startDate: sub.startDate,
          endDate: sub.endDate,
          remainingDays,
          status,
        };
      });

      res.json(enrichedSubscriptions);
    } catch (error) {
      console.error("Error fetching subscriptions:", error);
      res.status(500).json({ error: "فشل في جلب الاشتراكات" });
    }
  });

  // إلغاء الاشتراك
  app.post("/api/admin/subscription/cancel", async (req, res) => {
    try {
      const { propertyNumber, reason } = req.body;
      
      if (!propertyNumber) {
        return res.status(400).json({ error: "رقم العقار مطلوب" });
      }

      // تحديث الاشتراك في Google Sheets
      await googleSheetsService.cancelSubscription(propertyNumber, reason);

      res.json({ success: true, message: "تم إلغاء الاشتراك بنجاح" });
    } catch (error) {
      console.error("Error canceling subscription:", error);
      res.status(500).json({ error: "فشل في إلغاء الاشتراك" });
    }
  });

  // ======================
  // 📦 إدارة الباقات
  // ======================
  app.get("/api/admin/packages", async (req, res) => {
    try {
      const packages = await storage.getPackages();
      res.json(packages);
    } catch (error) {
      console.error("Error fetching packages:", error);
      res.status(500).json({ error: "فشل في جلب الباقات" });
    }
  });

  app.post("/api/admin/packages", async (req, res) => {
    try {
      // تحويل أسماء الحقول من الفرونت إلى الباكند
      const pkgData = {
        name: req.body.name || "",
        duration: req.body.duration || req.body.durationDays || 30,
        price: req.body.price || 0,
        type: req.body.type || "مميز",
        features: req.body.features || (req.body.description ? [req.body.description] : []),
        isActive: req.body.isActive !== false,
        propertyCount: req.body.propertyCount || 1,
      };
      const newPkg = await storage.createPackage(pkgData);
      res.json(newPkg);
    } catch (error) {
      console.error("Error creating package:", error);
      res.status(500).json({ error: "فشل في إنشاء الباقة" });
    }
  });

  app.put("/api/admin/packages/:id", async (req, res) => {
    try {
      const { id } = req.params;
      // تحويل أسماء الحقول من الفرونت إلى الباكند
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
      
      const updated = await storage.updatePackage(id, pkgData);
      if (!updated) {
        return res.status(404).json({ error: "الباقة غير موجودة" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating package:", error);
      res.status(500).json({ error: "فشل في تحديث الباقة" });
    }
  });

  app.delete("/api/admin/packages/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deletePackage(id);
      res.json({ success: true, message: "تم حذف الباقة بنجاح" });
    } catch (error) {
      console.error("Error deleting package:", error);
      res.status(500).json({ error: "فشل في حذف الباقة" });
    }
  });

  // تحديث العقار المرتبط في الاشتراك
  app.post("/api/admin/subscription/link", async (req, res) => {
    try {
      const { propertyNumber, linkedProperty } = req.body;
      if (!propertyNumber || !linkedProperty) {
        return res.status(400).json({ error: "propertyNumber و linkedProperty مطلوبين" });
      }
      await googleSheetsService.updateSubscriptionLinkedProperty(propertyNumber, linkedProperty);
      res.json({ success: true, message: `تم ربط العقار ${propertyNumber} بالعقار ${linkedProperty}` });
    } catch (error) {
      console.error("Error linking properties:", error);
      res.status(500).json({ error: "فشل في ربط العقارات" });
    }
  });

  // ======================
  // 🏷️ إدارة الخصومات
  // ======================
  app.get("/api/admin/discounts", async (req, res) => {
    try {
      const discounts = await storage.getDiscountCodes();
      res.json(discounts);
    } catch (error) {
      console.error("Error fetching discounts:", error);
      res.status(500).json({ error: "فشل في جلب أكواد الخصم" });
    }
  });

  app.post("/api/admin/discounts", async (req, res) => {
    try {
      // تحويل نوع الخصم لتتوافق مع schema
      const discountType = req.body.type === "ثابت" ? "قيمة ثابتة" : req.body.type;
      const discountData = {
        code: req.body.code || "",
        type: discountType,
        value: req.body.value || 0,
        expiryDate: req.body.expiryDate,
        isActive: req.body.isActive !== false,
      };
      const newDiscount = await storage.createDiscountCode(discountData);
      res.json(newDiscount);
    } catch (error) {
      console.error("Error creating discount:", error);
      res.status(500).json({ error: "فشل في إنشاء كود الخصم" });
    }
  });

  app.put("/api/admin/discounts/:id", async (req, res) => {
    try {
      const { id } = req.params;
      // تحويل نوع الخصم إذا موجود
      const updates: any = { ...req.body };
      if (updates.type === "ثابت") {
        updates.type = "قيمة ثابتة";
      }
      const updated = await storage.updateDiscountCode(id, updates);
      if (!updated) {
        return res.status(404).json({ error: "كود الخصم غير موجود" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating discount:", error);
      res.status(500).json({ error: "فشل في تحديث كود الخصم" });
    }
  });

  app.delete("/api/admin/discounts/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await storage.deleteDiscountCode(id);
      res.json({ success: true, message: "تم حذف كود الخصم بنجاح" });
    } catch (error) {
      console.error("Error deleting discount:", error);
      res.status(500).json({ error: "فشل في حذف كود الخصم" });
    }
  });

  // ======================
  // 💳 إدارة المدفوعات
  // ======================
  app.get("/api/admin/payments", async (req, res) => {
    try {
      const payments = await storage.getPayments();
      const properties = await storage.getProperties();

      // تضمين اسم العقار في المدفوعات
      const enrichedPayments = payments.map(payment => {
        const property = properties.find(p => p.propertyNumber === payment.propertyNumber);
        return {
          ...payment,
          propertyName: property?.name || "غير معروف",
        };
      });

      res.json(enrichedPayments);
    } catch (error) {
      console.error("Error fetching payments:", error);
      res.status(500).json({ error: "فشل في جلب المدفوعات" });
    }
  });

  app.put("/api/admin/payments/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      const updated = await storage.updatePayment(id, { status });
      if (!updated) {
        return res.status(404).json({ error: "الدفعة غير موجودة" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating payment status:", error);
      res.status(500).json({ error: "فشل في تحديث حالة الدفعة" });
    }
  });

  // ======================
// PAYMOB WEBHOOK - GET (Return URL from Paymob)
// ======================
app.get("/api/paymob/webhook", async (req, res) => {
  try {
    console.log("📥 Paymob GET redirect received");
    console.log("📥 Query params:", req.query);

    const success = req.query.success === "true";
    const orderId = (req.query.order as string) || "";
    const transactionId = (req.query.id as string) || "";
    const merchantOrderId = (req.query.merchant_order_id as string) || "";

    console.log(`📊 success=${success}, order=${orderId}, txn=${transactionId}, merchantOrderId=${merchantOrderId}`);

    // 🔍 استخراج رقم العقار من merchant_order_id أو special_reference
    let propertyNumber = "";
    if (merchantOrderId && merchantOrderId.includes("-")) {
      propertyNumber = merchantOrderId.split("-")[0];
    }
    if (!propertyNumber) {
      propertyNumber =
        req.query.special_reference as string || ""; // Check for special_reference
    }

    console.log("🏡 Extracted property number:", propertyNumber);

    // 🔎 استعلام الرسوم (اختياري)
    if (success && orderId) {
      try {
        const { paymobService } = await import("./paymob");
        console.log(`📡 Calling Paymob Inquiry API with order_id: ${orderId}`);
        const inquiry = await paymobService.inquiryByOrderId(orderId);

        if (inquiry?.ok) {
          console.log("✅ Inquiry fees:", inquiry);
        } else {
          console.log("⚠️ Inquiry returned no data");
        }
      } catch (err) {
        console.log("❌ Inquiry API Error:", err);
      }
    }

    // 🎯 إعادة التوجيه بناءً على نوع العملية
    if (success) {
      let paymentAction = '';
      
      // 📲 إرسال إشعار واتساب عند نجاح الدفع الإلكتروني + تحديث حالة الدفع
      if (propertyNumber) {
        try {
          const property = await storage.getPropertyByNumber(propertyNumber);
          const payments = await storage.getPayments();
          
          // البحث عن الدفعة الأحدث للعقار (POST webhook قد يصل قبل GET ويغير الحالة)
          // لذلك نبحث عن أي دفعة أُنشئت خلال آخر 10 دقائق
          const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
          const payment = payments
            .filter(p => p.propertyNumber === propertyNumber && new Date(p.createdAt || 0) > tenMinutesAgo)
            .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];
          
          console.log(`🔍 Looking for payment: propertyNumber=${propertyNumber}, found=${!!payment}, action=${(payment as any)?.action}, status=${payment?.status}`);
          
          // حفظ نوع العملية
          paymentAction = (payment as any)?.action || '';
          
          // تحديث حالة الدفع إلى "نجح - قيد التحقق"
          if (payment && payment.status === "معلق") {
            await storage.updatePayment(payment.id, { 
              status: "نجح - قيد التحقق" as any,
              transactionId,
              completedAt: new Date().toISOString()
            });
            console.log("✅ Payment status updated to 'نجح - قيد التحقق':", payment.id);
          }
          
          // رسالة مختلفة حسب نوع العملية
          const actionLabel = paymentAction === 'upgrade' ? 'ترقية' : paymentAction === 'extend' ? 'تمديد' : 'اشتراك جديد';
          
          await sendWhatsAppNotification(
            `💳 *تم استلام دفعة إلكترونية*\n\n` +
            `🏠 العقار: ${property?.name || propertyNumber}\n` +
            `🔢 رقم العقار: ${propertyNumber}\n` +
            `💰 المبلغ: ${payment?.finalAmount || 'غير محدد'} ر.س\n` +
            `🔢 رقم العملية: ${transactionId}\n` +
            `📋 نوع العملية: ${actionLabel}\n` +
            `📋 الحالة: نجح - قيد التحقق من البيانات`
          );
          console.log("✅ WhatsApp notification sent for electronic payment:", transactionId);
        } catch (notifyErr) {
          console.log("⚠️ Failed to send WhatsApp notification:", notifyErr);
        }
      }

      // التوجيه حسب نوع العملية
      let redirectUrl: string;
      if (paymentAction === 'upgrade' || paymentAction === 'extend') {
        // الترقية والتمديد: توجيه للوحة التحكم
        redirectUrl = `/owner/dashboard?payment=success`;
      } else {
        // تسجيل جديد: توجيه لصفحة المراجعة
        redirectUrl = `/subscription?payment=success&property=${propertyNumber}`;
      }
      
      console.log(`🔁 Redirecting to: ${redirectUrl} (action: ${paymentAction || 'new'})`);
      return res.redirect(redirectUrl);
    } else {
      return res.redirect(`/subscription?payment=failed`);
    }

  } catch (error) {
    console.error("❌ GET Webhook Error:", error);
    return res.redirect(`/subscription?payment=error`);
  }
});


// ======================
// PAYMOB WEBHOOK - POST (Server-to-Server notification)
// ======================
app.post("/api/paymob/webhook", async (req, res) => {
  try {
    console.log("📥 Paymob webhook received");
    console.log("📥 Body:", JSON.stringify(req.body, null, 2));

    const webhook = req.body;
    const t = webhook.obj;
    if (!t) {
      console.log("⚠️ Missing obj");
      return res.json({ ok: true });
    }

    // استخراج المعلومات الأساسية
    const transactionId = String(t.id || "");
    const isSuccess = t.success;
    const paymobOrderId = String(t.order?.id || t.order || "");
    const merchantOrderId =
      t.merchant_order_id || t.order?.merchant_order_id || "";
    const amount = (t.amount_cents || 0) / 100;

    // استخراج رقم العقار
    let propertyNumber = "";
    if (merchantOrderId?.includes("-")) {
      propertyNumber = merchantOrderId.split("-")[0];
    }
    if (!propertyNumber) {
      propertyNumber =
        t.payment_key_claims?.extra?.creation_extras?.propertyNumber || "";
    }
    if (!propertyNumber) {
      propertyNumber = t.order?.merchant_order_id?.split("-")[0] || ""; // Fallback if merchant_order_id is directly on order
    }

    const paymentMethod = t.source_data?.type || "";
    const cardSubType = t.source_data?.sub_type || "";

    console.log("🧾 Transaction:", transactionId, propertyNumber, amount);

    // ===============================
    // 1) جلب الرسوم من Paymob Inquiry API
    // ===============================
    let merchantFees = 0;
    let acqFees = 0;
    let vatAmount = 0;
    let totalFees = 0;
    let netAmount = 0;

    try {
      const { paymobService } = await import("./paymob");

      // استخدام inquiryByOrderId لجلب الرسوم الحقيقية
      console.log(`📡 Calling Paymob Inquiry API with order_id: ${paymobOrderId}`);
      const inquiry = await paymobService.inquiryByOrderId(paymobOrderId);

      console.log("📡 Inquiry Response:", JSON.stringify(inquiry, null, 2));

      if (inquiry?.ok) {
        merchantFees = inquiry.merchantFees || 0;
        acqFees = inquiry.acqFees || 0;
        vatAmount = inquiry.vat || 0;
        totalFees = inquiry.totalFees || 0;
        netAmount = inquiry.netAmount || (amount - totalFees);
        console.log(`✅ Got real fees from Paymob: merchant=${merchantFees}, acq=${acqFees}, vat=${vatAmount}, total=${totalFees}`);
      } else {
        console.log("⚠️ Inquiry returned no data, using fallback calculation");
        // حساب احتياطي: 6.9% شامل الضريبة
        totalFees = Math.round(amount * 0.069 * 100) / 100;
        const baseFee = Math.round((totalFees / 1.15) * 100) / 100;
        vatAmount = Math.round((totalFees - baseFee) * 100) / 100;
        merchantFees = Math.round(baseFee * 0.30 * 100) / 100;
        acqFees = Math.round(baseFee * 0.70 * 100) / 100;
        netAmount = Math.round((amount - totalFees) * 100) / 100;
      }
    } catch (err) {
      console.log("❌ Inquiry API Error:", err);
      // حساب احتياطي عند الفشل
      totalFees = Math.round(amount * 0.069 * 100) / 100;
      netAmount = Math.round((amount - totalFees) * 100) / 100;
    }

    console.log(
      "🏦 Final Fees → merchant:",
      merchantFees,
      "acq:",
      acqFees,
      "vat:",
      vatAmount,
      "total:",
      totalFees,
      "net:",
      netAmount
    );

    if (!isSuccess) {
      console.log("⚠️ Payment failed");
      return res.json({ ok: true });
    }

    // ===============================
    // 2) البحث عن سجل الدفع
    // ===============================
    const payments = await storage.getPayments();
    let payment = null;

    console.log("🔍 Searching for payment with:", { merchantOrderId, paymobOrderId, propertyNumber, amount });
    console.log("🔍 Available pending payments:", payments.filter(p => p.status === "معلق" || p.status === "قيد المراجعة").map(p => ({
      id: p.id,
      propertyNumber: p.propertyNumber,
      amount: p.finalAmount,
      paymobOrderId: p.paymobOrderId,
      status: p.status
    })));

    // البحث 1: بـ merchant_order_id (الصيغة: propertyNumber-timestamp أو id)
    if (!payment && merchantOrderId) {
      // استخراج رقم العقار من merchant_order_id
      const propNum = merchantOrderId.split("-")[0];
      if (propNum) {
        payment = payments.find((p) =>
          p.propertyNumber === propNum &&
          (p.status === "معلق" || p.status === "قيد المراجعة") &&
          Math.abs(p.finalAmount - amount) < 0.01
        );
        if (payment) console.log("✅ Found by merchant_order_id property match");
      }
    }

    // البحث 2: بـ paymobOrderId المباشر (لو نفس الصيغة)
    if (!payment && paymobOrderId) {
      payment = payments.find((p) => p.paymobOrderId === paymobOrderId);
      if (payment) console.log("✅ Found by paymobOrderId exact match");
    }

    // البحث 3: برقم العقار + مبلغ (معلق أو قيد المراجعة)
    if (!payment && propertyNumber) {
      payment = payments.find(
        (p) =>
          p.propertyNumber === propertyNumber &&
          (p.status === "معلق" || p.status === "قيد المراجعة") &&
          Math.abs(p.finalAmount - amount) < 0.01
      );
      if (payment) console.log("✅ Found by property + amount");
    }

    // البحث 4: آخر دفعة معلقة لنفس رقم العقار
    if (!payment && propertyNumber) {
      const pendingPayments = payments.filter(
        (p) =>
          p.propertyNumber === propertyNumber &&
          (p.status === "معلق" || p.status === "قيد المراجعة")
      ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      if (pendingPayments.length > 0) {
        payment = pendingPayments[0];
        console.log("✅ Found latest pending payment for property");
      }
    }

    if (!payment) {
      console.error("❌ Payment not found for:", { merchantOrderId, paymobOrderId, propertyNumber, amount });
      return res.status(404).json({ error: "Payment not found" });
    }

    console.log("✅ Found Payment:", payment.id);

    if (payment.status === "مكتمل") {
      console.log("⚠️ Already completed");
      return res.json({ ok: true });
    }

    // ===============================
    // 3) تحديث الدفع بالرسوم الحقيقية
    // ===============================
    // التسجيل الجديد يحتاج مراجعة، الترقية والتمديد تفعّل مباشرة
    const isNewRegistration = payment.action === 'new' || !payment.action;
    const newPaymentStatus = isNewRegistration ? "نجح - قيد التحقق" : "مكتمل";

    await storage.updatePayment(payment.id, {
      status: newPaymentStatus as any,
      completedAt: new Date().toISOString(),
      transactionId,
      paymentMethod: cardSubType || paymentMethod || "بطاقة",
      merchantFees,
      acqFees,
      vatAmount,
      totalFees,
      feeAmount: merchantFees + acqFees,
      netAmount,
    });

    console.log(`💰 Payment Updated: ${payment.id} - Status: ${newPaymentStatus}`);

    // ===============================
    // 4) تفعيل الاشتراك (فقط للترقية والتمديد - التسجيل الجديد يحتاج مراجعة)
    // ===============================
    if (
      !isNewRegistration &&
      payment.pendingStartDate &&
      payment.pendingEndDate
    ) {
      const property = await storage.getPropertyByNumber(payment.propertyNumber);

      if (property) {
        // تحقق إذا كانت باقة عقارين
        const isMultiPropertyPackage = !!(payment as any).secondPropertyNumber;
        const pricePerProperty = isMultiPropertyPackage 
          ? (payment.pendingPrice || payment.finalAmount) / 2 
          : (payment.pendingPrice || payment.finalAmount);

        const subscriptionData = {
          packageId: payment.packageId,
          price: pricePerProperty,
          subscriptionType: payment.pendingSubscriptionType || "موثوق",
          startDate: payment.pendingStartDate,
          endDate: payment.pendingEndDate,
          paymentId: payment.id,
          linkedProperty: isMultiPropertyPackage ? (payment as any).secondPropertyNumber : undefined,
        };

        await googleSheetsService.addSubscriptionToSheet(
          payment.propertyNumber,
          subscriptionData,
          property
        );

        console.log(`🎉 Subscription Activated: ${payment.propertyNumber} (price: ${pricePerProperty})`);

        // === إضافة اشتراك للعقار الثاني إذا كانت باقة عقارين ===
        if (isMultiPropertyPackage) {
          const secondProperty = await storage.getPropertyByNumber((payment as any).secondPropertyNumber);
          if (secondProperty) {
            const secondSubscriptionData = {
              ...subscriptionData,
              linkedProperty: payment.propertyNumber,
            };
            await googleSheetsService.addSubscriptionToSheet(
              (payment as any).secondPropertyNumber,
              secondSubscriptionData,
              secondProperty
            );
            console.log(`🎉 Second property subscription activated: ${(payment as any).secondPropertyNumber} (price: ${pricePerProperty})`);
          }
        }
      }
    } else if (isNewRegistration) {
      console.log("📋 New registration - awaiting admin verification:", payment.propertyNumber);
    }

    // إرسال إشعار WhatsApp عند نجاح الدفع
    try {
      const property = await storage.getPropertyByNumber(payment.propertyNumber);
      const pkg = await storage.getPackageById(payment.packageId);

      await notifyNewPayment({
        propertyNumber: payment.propertyNumber,
        propertyName: property?.name || payment.propertyNumber,
        amount: payment.finalAmount,
        paymentMethod: cardSubType || paymentMethod || "بطاقة",
        transactionId,
      });
      console.log("✅ WhatsApp notification sent for payment:", transactionId);
    } catch (err) {
      console.error("❌ WhatsApp notification failed:", err);
    }

    return res.json({ ok: true, paymentId: payment.id });
  } catch (err) {
    console.error("❌ Webhook Error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

  // ======================
  // اختبار Paymob Inquiry API
  // ======================
  app.post("/api/admin/test-inquiry", async (req, res) => {
    try {
      const { orderId } = req.body;

      if (!orderId) {
        return res.status(400).json({ error: "orderId مطلوب" });
      }

      console.log(`🧪 Testing Paymob Inquiry API with order_id: ${orderId}`);

      const { paymobService } = await import("./paymob");
      const inquiry = await paymobService.inquiryByOrderId(orderId);

      console.log(`📊 Inquiry Result:`, JSON.stringify(inquiry, null, 2));

      res.json({
        success: true,
        inquiry
      });
    } catch (error: any) {
      console.error("❌ Inquiry Test Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ======================
  // تحديث عناوين أعمدة المدفوعات
  // ======================
  app.post("/api/admin/setup-payment-headers", async (req, res) => {
    try {
      await googleSheetsService.setupPaymentsSheetHeaders();
      res.json({ success: true, message: "تم تحديث عناوين الأعمدة بنجاح" });
    } catch (error: any) {
      console.error("Error setting up payment headers:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ======================
  // تحديث رسوم معاملة يدوياً
  // ======================
  app.post("/api/admin/payments/:transactionId/update-fees", async (req, res) => {
    try {
      const { transactionId } = req.params;
      const { feeAmount, vatAmount, merchantFees, acqFees } = req.body;

      if (!transactionId) {
        return res.status(400).json({ error: "معرف المعاملة مطلوب" });
      }

      // حساب الإجمالي والصافي
      const totalFees = (feeAmount || 0) + (vatAmount || 0);

      console.log(`📝 Updating fees for transaction ${transactionId}:`, {
        feeAmount, vatAmount, totalFees, merchantFees, acqFees
      });

      // تحديث الرسوم في Google Sheets
      await googleSheetsService.updatePaymentFees(transactionId, {
        feeAmount: feeAmount || 0,
        vatAmount: vatAmount || 0,
        totalFees,
        merchantFees: merchantFees || 0,
        acqFees: acqFees || 0,
      });

      res.json({ 
        success: true, 
        message: "تم تحديث الرسوم بنجاح",
        data: { feeAmount, vatAmount, totalFees, merchantFees, acqFees }
      });
    } catch (error: any) {
      console.error("Error updating payment fees:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // تشغيل تحديث عناوين الأعمدة عند بدء الخادم
  setTimeout(async () => {
    try {
      console.log("🔧 Setting up payment sheet headers...");
      await googleSheetsService.setupPaymentsSheetHeaders();

      console.log("🔧 Initializing fee configs...");
      await googleSheetsService.initializeFeeConfigs();
    } catch (error) {
      console.error("❌ Failed to setup payment headers or fee configs:", error);
    }
  }, 5000);

  // ======================
  // 💰 إعدادات الرسوم (Fee Configurations)
  // ======================

  app.get("/api/admin/fee-configs", async (req, res) => {
    try {
      const configs = await googleSheetsService.getFeeConfigs();
      res.json(configs);
    } catch (error: any) {
      console.error("Error fetching fee configs:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/fee-configs", async (req, res) => {
    try {
      const config = await googleSheetsService.createFeeConfig(req.body);
      res.json(config);
    } catch (error: any) {
      console.error("Error creating fee config:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/admin/fee-configs/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const config = await googleSheetsService.updateFeeConfig(id, req.body);
      if (!config) {
        return res.status(404).json({ error: "إعدادات الرسوم غير موجودة" });
      }
      res.json(config);
    } catch (error: any) {
      console.error("Error updating fee config:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/admin/fee-configs/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await googleSheetsService.deleteFeeConfig(id);
      res.json({ success: true, message: "تم حذف إعدادات الرسوم بنجاح" });
    } catch (error: any) {
      console.error("Error deleting fee config:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/fee-configs/initialize", async (req, res) => {
    try {
      await googleSheetsService.initializeFeeConfigs();
      res.json({ success: true, message: "تم تهيئة إعدادات الرسوم الافتراضية" });
    } catch (error: any) {
      console.error("Error initializing fee configs:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/calculate-fees", async (req, res) => {
    try {
      const { amount, paymentMethod, cardType, useConfigs } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({ error: "المبلغ مطلوب ويجب أن يكون أكبر من 0" });
      }

      let fees;
      if (useConfigs) {
        fees = await googleSheetsService.calculatePaymentFeesFromConfigs(amount, paymentMethod, cardType);
      } else {
        fees = googleSheetsService.calculatePaymentFees(amount, paymentMethod, cardType);
      }

      res.json(fees);
    } catch (error: any) {
      console.error("Error calculating fees:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ======================
  // 💵 التكاليف/المصاريف (Expenses)
  // ======================

  app.get("/api/admin/expenses", async (req, res) => {
    try {
      const expenses = await googleSheetsService.getExpenses();
      res.json(expenses);
    } catch (error: any) {
      console.error("Error fetching expenses:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/expenses/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const expense = await googleSheetsService.getExpenseById(id);
      if (!expense) {
        return res.status(404).json({ error: "التكلفة غير موجودة" });
      }
      res.json(expense);
    } catch (error: any) {
      console.error("Error fetching expense:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/expenses", async (req, res) => {
    try {
      const { title, amount, category, description, date } = req.body;

      if (!title || !amount || !date) {
        return res.status(400).json({ error: "العنوان والمبلغ والتاريخ مطلوبة" });
      }

      const expense = await googleSheetsService.createExpense({
        title,
        amount: parseFloat(amount),
        category: category || "أخرى",
        description,
        date,
      });
      res.json(expense);
    } catch (error: any) {
      console.error("Error creating expense:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/admin/expenses/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      if (updates.amount) {
        updates.amount = parseFloat(updates.amount);
      }

      const expense = await googleSheetsService.updateExpense(id, updates);
      if (!expense) {
        return res.status(404).json({ error: "التكلفة غير موجودة" });
      }
      res.json(expense);
    } catch (error: any) {
      console.error("Error updating expense:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/admin/expenses/:id", async (req, res) => {
    try {
      const { id } = req.params;
      await googleSheetsService.deleteExpense(id);
      res.json({ success: true, message: "تم حذف التكلفة بنجاح" });
    } catch (error: any) {
      console.error("Error deleting expense:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/admin/expenses/total", async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const total = await googleSheetsService.getTotalExpenses(
        startDate as string | undefined,
        endDate as string | undefined
      );
      res.json({ total });
    } catch (error: any) {
      console.error("Error calculating total expenses:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ======================
  // DONE
  // ======================
  return createServer(app);
}