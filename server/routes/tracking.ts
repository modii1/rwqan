import { Router } from "express";
import { createHmac } from "node:crypto";
import { analyticsService, propertyService, notificationService } from "../services";
import { firebaseService } from "../firebaseService";
import { detectDeviceType, normalizePhoneNumber } from "../utils/helpers";
import type { InsertContactEvent } from "../../shared/schema";

const router = Router();

// عدد الطلبات من كل IP لكل عقار (للتوافق مع حقل التحليلات القديم فقط).
const ipPropertyCounter = new Map<string, Map<string, number>>();

type ContactEventBase = Omit<InsertContactEvent, "outcome" | "requestCode">;

function getClientIp(req: any): string {
  // Express resolves this using the configured trusted-proxy boundary.
  return req.ip
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

function createCooldownKey(visitorKey: string, propertyNumber: string): string {
  const secret = process.env.SESSION_SECRET || "rwqan-contact-analytics";
  return createHmac("sha256", secret)
    .update(`contact-cooldown:${visitorKey}:${propertyNumber}`)
    .digest("hex");
}

async function recordContactEvent(
  base: ContactEventBase,
  outcome: InsertContactEvent["outcome"],
  requestCode?: string,
  clientPhone?: string,
): Promise<void> {
  try {
    await analyticsService.recordContactEvent({
      ...base,
      outcome,
      requestCode,
      ...(clientPhone ? { clientPhone } : {}),
    });
  } catch (error) {
    console.error("Contact analytics event error:", error);
  }
}

router.post("/api/requests/smart", async (req, res) => {
  let contactEventBase: ContactEventBase | null = null;
  let acceptedEventRecorded = false;
  try {
    const propertyNumber = String(req.body?.propertyNumber || "").trim();
    const submittedPhone = String(req.body?.clientPhone || "").trim();

    if (!propertyNumber) {
      return res.status(400).json({ error: "رقم العقار مطلوب" });
    }

    if (!submittedPhone) {
      return res.status(400).json({ error: "رقم الجوال مطلوب" });
    }

    let clientPhone: string;
    try {
      clientPhone = normalizePhoneNumber(submittedPhone);
    } catch (error: any) {
      return res.status(400).json({ error: error?.message || "رقم الجوال غير صحيح" });
    }

    const property = await propertyService.getByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }
    if (property.verificationStatus && property.verificationStatus !== "approved") {
      return res.status(403).json({ error: "هذا العقار غير متاح حالياً" });
    }

    const ipAddress = getClientIp(req);
    const userAgent = req.headers["user-agent"] || "";
    const deviceType = detectDeviceType(userAgent);
    contactEventBase = propertyNumber ? {
      propertyNumber,
      visitorKey: createVisitorKey(req, ipAddress),
      actorType: getContactActor(req),
      deviceType,
    } : null;

    const thirtyMinutes = 30 * 60 * 1000;
    const cooldownKey = createCooldownKey(contactEventBase!.visitorKey, propertyNumber);

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

    // Commit the accepted request, event, and cooldown together.
    const cooldown = await firebaseService.createContactRequestWithCooldown(
      cooldownKey,
      propertyNumber,
      thirtyMinutes,
      {
        propertyNumber,
        requestCode,
        timestamp: String(nowTimestamp), // CRITICAL: حفظ epoch milliseconds فقط
        clientPhone,
        ipAddress,
        dayOfWeek,
        hourOfDay,
        deviceType,
      },
      newCount,
      {
        ...contactEventBase!,
        outcome: "accepted",
        requestCode,
        clientPhone,
      },
    );

    // تحقق من التكرار في آخر 30 دقيقة
    if (!cooldown.accepted) {
      const remainingSeconds = Math.ceil(cooldown.remainingMs / 1000);
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

    propertyMap.set(propertyNumber, newCount);
    acceptedEventRecorded = true;

    // حدّث المتتبع
    console.log(`✅ Request tracked - IP: ${ipAddress}, Property: ${propertyNumber}, Count: ${newCount}`);

    // إرسال إشعار واتساب عند طلب واتساب جديد
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
    const ipAddress = getClientIp(req);

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
