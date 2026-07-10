import { Router } from "express";
import { createHmac } from "node:crypto";
import { analyticsService, propertyService, notificationService } from "../services";
import { firebaseService } from "../firebaseService";
import { detectDeviceType } from "../utils/helpers";
import type { InsertContactEvent } from "../../shared/schema";

const router = Router();

// في الذاكرة: تخزين آخر طلب من كل IP (30 دقيقة) وعدد طلبات كل IP لكل عقار
const requestTracker = new Map<string, { timestamp: number; propertyNumber: string }>();
const ipPropertyCounter = new Map<string, Map<string, number>>();

type ContactEventBase = Omit<InsertContactEvent, "outcome" | "requestCode">;

function getClientIp(req: any): string {
  return (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    || req.socket.remoteAddress
    || "unknown";
}

function getContactActor(req: any): "owner" | "admin" | "anonymous" {
  if (req.session?.propertyNumber) return "owner";
  if (req.session?.isAdmin) return "admin";
  return "anonymous";
}

function createVisitorKey(req: any, ipAddress: string): string {
  const actor = getContactActor(req);
  const source = actor === "owner"
    ? `owner:${req.session.propertyNumber}`
    : actor === "admin"
      ? "admin"
      : `anonymous:${ipAddress}`;
  const secret = process.env.SESSION_SECRET || "rwqan-contact-analytics";
  return createHmac("sha256", secret).update(source).digest("hex").slice(0, 24);
}

async function recordContactEvent(
  base: ContactEventBase,
  outcome: InsertContactEvent["outcome"],
  requestCode?: string,
): Promise<void> {
  try {
    await analyticsService.recordContactEvent({ ...base, outcome, requestCode });
  } catch (error) {
    console.error("Contact analytics event error:", error);
  }
}

router.post("/api/requests/smart", async (req, res) => {
  let contactEventBase: ContactEventBase | null = null;
  let acceptedEventRecorded = false;
  try {
    const propertyNumber = String(req.body?.propertyNumber || "").trim();
    const ipAddress = getClientIp(req);
    const userAgent = req.headers["user-agent"] || "";
    const deviceType = detectDeviceType(userAgent);
    contactEventBase = propertyNumber ? {
      propertyNumber,
      visitorKey: createVisitorKey(req, ipAddress),
      actorType: getContactActor(req),
      deviceType,
    } : null;

    const isAuthenticated = Boolean(
      req.session?.propertyNumber || req.session?.isAdmin,
    );
    if (!isAuthenticated) {
      if (contactEventBase) await recordContactEvent(contactEventBase, "auth_required");
      return res.status(401).json({
        code: "AUTH_REQUIRED",
        error: "سجّل الدخول للتواصل عبر واتساب",
      });
    }

    if (!propertyNumber) {
      return res.status(400).json({ error: "رقم العقار مطلوب" });
    }

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

      if (contactEventBase) await recordContactEvent(contactEventBase, "cooldown");

      return res.status(429).json({
        error: "انتظر قليلاً قبل إرسال طلب آخر لنفس العقار",
        remainingSeconds,
        remainingTimeFormatted: timeDisplay,
      });
    }

    // CRITICAL: استخدام UTC فقط - الواجهة ستتولى التحويل
    const nowTimestamp = Date.now();
    const nowDate = new Date(nowTimestamp);

    // للعرض في الـ response فقط - نستخدم تنسيق الرياض
    const riyadhFormatter = new Intl.DateTimeFormat('ar-SA', {
      timeZone: 'Asia/Riyadh',
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    const riyadhTimeDisplay = riyadhFormatter.format(nowDate);

    // للحفظ في قاعدة البيانات
    const daysAr = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
    // نحتاج اليوم والساعة بتوقيت الرياض للتحليلات
    const riyadhDate = new Date(nowDate.toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }));
    const dayOfWeek = daysAr[riyadhDate.getDay()];
    const hourOfDay = riyadhDate.getHours();

    // أنشئ كود طلب فريد (باستخدام توقيت الرياض للكود)
    const requestCode = `REQ${riyadhDate.getFullYear()}${String(riyadhDate.getMonth() + 1).padStart(2, "0")}${String(riyadhDate.getDate()).padStart(2, "0")}${String(hourOfDay).padStart(2, "0")}${Math.random().toString(36).substr(2, 5).toUpperCase()}`;

    // احسب عدد الطلبات من هذا IP للعقار هذا
    if (!ipPropertyCounter.has(ipAddress)) {
      ipPropertyCounter.set(ipAddress, new Map());
    }
    const propertyMap = ipPropertyCounter.get(ipAddress)!;
    const currentCount = propertyMap.get(propertyNumber) || 0;
    const newCount = currentCount + 1;
    propertyMap.set(propertyNumber, newCount);

    // احفظ الطلب مع العدد من IP
    await analyticsService.recordRequest(
      {
        propertyNumber,
        requestCode,
        timestamp: String(nowTimestamp), // CRITICAL: حفظ epoch milliseconds فقط
        ipAddress,
        dayOfWeek,
        hourOfDay,
        deviceType,
      },
      newCount
    );

    if (contactEventBase) {
      await recordContactEvent(contactEventBase, "accepted", requestCode);
      acceptedEventRecorded = true;
    }


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
    const property = await propertyService.getByNumber(propertyNumber);
    notificationService.smartRequest({
      propertyNumber,
      propertyName: property?.name || "",
      deviceType: deviceType,
      ip: ipAddress,
    }).catch(err => console.error("WhatsApp notify error:", err));

    res.json({
      ok: true,
      message: "تم تسجيل طلبك بنجاح ✅",
      requestCode,
      requestTime: riyadhTimeDisplay,
      whatsappNumber: property?.whatsappNumber || "",
    });
  } catch (err: any) {
    console.error("Smart request error:", err);
    if (contactEventBase && !acceptedEventRecorded) {
      await recordContactEvent(contactEventBase, "error");
    }
    res.status(500).json({ error: "خطأ في معالجة الطلب" });
  }
});

// تتبع زيارات الصفحات (Page Views) - تحديث الإحصائيات فقط (لا تسجل في الطلبات)
router.post("/api/track-pageview", async (req, res) => {
  try {
    const { propertyNumber, userAgent: clientUA } = req.body;
    if (!propertyNumber) {
      return res.status(400).json({ error: "رقم العقار مطلوب" });
    }

    // احصل على IP العميل من الطلب
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      req.socket.remoteAddress ||
      'unknown';

    const now_timestamp = Date.now();

    // تحقق من آخر زيارة من نفس IP لنفس العقار (من جدول الطلبات فقط للتحقق من 24 ساعة)
    const allRequests = await analyticsService.getAllRequests();
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
    await firebaseService.updateAnalyticsRow();

    res.json({ ok: true, message: "تم تحديث الإحصائيات ✅" });
  } catch (err: any) {
    console.error("Page view tracking error:", err);
    res.status(500).json({ error: "خطأ في تسجيل الزيارة" });
  }
});

export default router;
