import { Router } from "express";
import { createHmac } from "node:crypto";
import { analyticsService, propertyService, notificationService, subscriptionService } from "../services";
import { firebaseService } from "../firebaseService";
import { detectDeviceType, normalizePhoneNumber } from "../utils/helpers";
import { calculateRemainingDays, getEndOfDayRiyadh, getStartOfDayRiyadh } from "../utils/dateUtils";
import type { InsertContactEvent } from "../../shared/schema";
import { isActivePremiumSubscription } from "../../shared/subscriptionType";
import {
  CONTACT_IDENTITY_COOKIE_NAME,
  ContactIdentityRateLimitError,
  contactIdentityService,
  getContactIdentityClearCookieOptions,
  getContactIdentityCookieOptions,
  maskContactPhone,
} from "../services/ContactIdentityService";
import {
  getContactIdentityCookieToken,
  getContactIdentityIssueLimitKeyForRequest,
  getOwnerContactPhone,
} from "../utils/contactIdentityRequest";
import { isSameOriginRequest } from "../utils/requestOrigin";

const router = Router();

export const CONTACT_REQUEST_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
export const CONTACT_REQUEST_MAX_ATTEMPTS_PER_WINDOW = 60;
export const FREE_PROPERTY_DAILY_CONTACT_LIMIT = 3;

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

function createRememberedVisitorKey(visitorId: string): string {
  const secret = process.env.SESSION_SECRET || "rwqan-contact-analytics";
  return createHmac("sha256", secret)
    .update(`remembered-contact:${visitorId}`)
    .digest("hex")
    .slice(0, 24);
}

function createIpAbuseLimitKey(ipAddress: string, propertyNumber: string): string {
  const secret = process.env.SESSION_SECRET || "rwqan-contact-analytics";
  return createHmac("sha256", secret)
    .update(`contact-ip-limit:${ipAddress}:${propertyNumber}`)
    .digest("hex");
}

function createContactAttemptLimitKey(ipAddress: string): string {
  const secret = process.env.SESSION_SECRET || "rwqan-contact-analytics";
  return createHmac("sha256", secret)
    .update(`contact-attempt-limit:${ipAddress}`)
    .digest("hex");
}

function createFreePropertyDailyLimitKey(propertyNumber: string): string {
  const secret = process.env.SESSION_SECRET || "rwqan-contact-analytics";
  return createHmac("sha256", secret)
    .update(`free-property-daily-contact-limit:${propertyNumber}`)
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
  let responseContactIdentity: { kind: "client"; maskedPhone: string } | undefined;
  try {
    if (!isSameOriginRequest(req)) {
      return res.status(403).json({ code: "CROSS_ORIGIN_REQUEST", error: "الطلب غير مسموح" });
    }

    const propertyNumber = String(req.body?.propertyNumber || "").trim();
    const submittedPhone = String(req.body?.clientPhone || "").trim();

    if (!propertyNumber) {
      return res.status(400).json({ error: "رقم العقار مطلوب" });
    }

    const ipAddress = getClientIp(req);
    // Requests without Origin are supported for non-browser clients, but they
    // pass through the same persistent abuse boundary as browser requests.
    const attemptLimit = await firebaseService.consumeContactRequestAttemptLimit(
      createContactAttemptLimitKey(ipAddress),
      Date.now(),
      CONTACT_REQUEST_ATTEMPT_WINDOW_MS,
      CONTACT_REQUEST_MAX_ATTEMPTS_PER_WINDOW,
    );
    if (!attemptLimit.allowed) {
      const retryAfterSeconds = Math.ceil(attemptLimit.retryAfterMs / 1000);
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        code: "CONTACT_ATTEMPT_RATE_LIMIT",
        error: "تم إجراء محاولات تواصل كثيرة. حاول مرة أخرى لاحقاً.",
        retryAfterSeconds,
      });
    }

    const property = await propertyService.getByNumber(propertyNumber);
    if (!property) {
      return res.status(404).json({ error: "العقار غير موجود" });
    }
    if (property.verificationStatus && property.verificationStatus !== "approved") {
      return res.status(403).json({ error: "هذا العقار غير متاح حالياً" });
    }

    const subscription = await subscriptionService.getByProperty(propertyNumber);
    const isPremiumProperty = Boolean(
      subscription &&
      isActivePremiumSubscription({
        subscriptionType: subscription.subscriptionType,
        packageType: subscription.packageType,
        status: subscription.status,
        isExpired: calculateRemainingDays(subscription.endDate) < 0,
      }),
    );

    const userAgent = req.headers["user-agent"] || "";
    const deviceType = detectDeviceType(userAgent);
    const actor = getContactActor(req);
    contactEventBase = {
      propertyNumber,
      visitorKey: createVisitorKey(req, ipAddress),
      actorType: actor,
      deviceType,
    };
    let clientPhone: string | null = null;
    let contactVisitorId: string | null = null;

    if (actor === "owner") {
      clientPhone = await getOwnerContactPhone(String(req.session.propertyNumber));
      if (!clientPhone) {
        await recordContactEvent(contactEventBase, "auth_required");
        return res.status(409).json({
          code: "OWNER_PHONE_MISSING",
          error: "لا يوجد رقم جوال صحيح مسجل للعقار. يرجى تحديث بيانات العقار أولاً.",
        });
      }
    } else if (actor === "admin") {
      if (submittedPhone) {
        try {
          clientPhone = normalizePhoneNumber(submittedPhone);
        } catch (error: any) {
          return res.status(400).json({
            code: "INVALID_CONTACT_PHONE",
            error: error?.message || "رقم الجوال غير صحيح",
          });
        }
      }

      if (!clientPhone) {
        await recordContactEvent(contactEventBase, "auth_required");
        return res.status(428).json({
          code: "CONTACT_PHONE_REQUIRED",
          error: "أدخل رقم الجوال للمتابعة إلى واتساب",
        });
      }
    } else {
      const cookieToken = getContactIdentityCookieToken(req);
      const rememberedIdentity = await contactIdentityService.resolve(cookieToken);

      if (cookieToken && !rememberedIdentity) {
        res.clearCookie(CONTACT_IDENTITY_COOKIE_NAME, getContactIdentityClearCookieOptions());
      }

      if (rememberedIdentity) {
        clientPhone = rememberedIdentity.clientPhone;
        contactVisitorId = rememberedIdentity.visitorId;
      } else if (submittedPhone) {
        try {
          clientPhone = normalizePhoneNumber(submittedPhone);
        } catch (error: any) {
          return res.status(400).json({
            code: "INVALID_CONTACT_PHONE",
            error: error?.message || "رقم الجوال غير صحيح",
          });
        }

        try {
          const issued = await contactIdentityService.issue(
            clientPhone,
            cookieToken,
            getContactIdentityIssueLimitKeyForRequest(req),
          );
          contactVisitorId = issued.visitorId;
          res.cookie(CONTACT_IDENTITY_COOKIE_NAME, issued.token, getContactIdentityCookieOptions());
        } catch (error) {
          if (error instanceof ContactIdentityRateLimitError) {
            const retryAfterSeconds = Math.ceil(error.retryAfterMs / 1000);
            res.set("Retry-After", String(retryAfterSeconds));
            return res.status(429).json({
              code: "CONTACT_IDENTITY_RATE_LIMIT",
              error: error.message,
              retryAfterSeconds,
            });
          }
          console.error("Contact identity issuance error:", error);
          return res.status(500).json({
            code: "CONTACT_IDENTITY_SAVE_FAILED",
            error: "تعذر حفظ رقم التواصل. حاول مرة أخرى.",
          });
        }
      }

      if (!clientPhone) {
        await recordContactEvent(contactEventBase, "auth_required");
        return res.status(428).json({
          code: "CONTACT_PHONE_REQUIRED",
          error: "أدخل رقم جوالك للمتابعة إلى واتساب",
        });
      }
    }

    const resolvedClientPhone = clientPhone;
    if (actor === "anonymous" && resolvedClientPhone) {
      const maskedPhone = maskContactPhone(resolvedClientPhone);
      if (maskedPhone) {
        responseContactIdentity = { kind: "client", maskedPhone };
      }
    }

    if (contactVisitorId) {
      contactEventBase.visitorKey = createRememberedVisitorKey(contactVisitorId);
    }

    const thirtyMinutes = 30 * 60 * 1000;
    const hasUnlimitedClientContact = actor === "anonymous" && isPremiumProperty;
    const cooldownKey = createCooldownKey(contactEventBase!.visitorKey, propertyNumber);

    // CRITICAL: استخدام UTC فقط - الواجهة ستتولى التحويل
    const nowTimestamp = Date.now();
    const nowDate = new Date(nowTimestamp);
    const riyadhDayStart = getStartOfDayRiyadh(nowDate).getTime();
    const riyadhDayEnd = getEndOfDayRiyadh(nowDate).getTime() + 1;

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
      hasUnlimitedClientContact ? 0 : thirtyMinutes,
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
      hasUnlimitedClientContact
        ? undefined
        : {
            key: createIpAbuseLimitKey(ipAddress, propertyNumber),
            windowMs: thirtyMinutes,
            maxAcceptedRequests: 10,
          },
      actor === "anonymous" && !isPremiumProperty
        ? {
            key: createFreePropertyDailyLimitKey(propertyNumber),
            windowStartedAt: riyadhDayStart,
            windowEndsAt: riyadhDayEnd,
            maxAcceptedRequests: FREE_PROPERTY_DAILY_CONTACT_LIMIT,
          }
        : undefined,
    );

    // تحقق من التكرار في آخر 30 دقيقة
    if (!cooldown.accepted) {
      const remainingSeconds = Math.ceil(cooldown.remainingMs / 1000);
      const hours = Math.floor(remainingSeconds / 3600);
      const minutes = Math.floor((remainingSeconds % 3600) / 60);
      const seconds = remainingSeconds % 60;
      let timeDisplay = "";
      if (hours > 0) {
        timeDisplay = `${hours} ساعة`;
        if (minutes > 0) timeDisplay += ` و${minutes} دقيقة`;
      } else if (minutes > 0) {
        timeDisplay = `${minutes} دقيقة`;
        if (seconds > 0) timeDisplay += ` و${seconds} ثانية`;
      } else {
        timeDisplay = `${seconds} ثانية`;
      }

      console.log(`⏱️ Duplicate request blocked - IP: ${ipAddress}, Property: ${propertyNumber}, Remaining: ${timeDisplay}`);

      return res.status(429).json({
        code: cooldown.reason === "daily_property_limit"
          ? "FREE_PROPERTY_DAILY_CONTACT_LIMIT"
          : "CONTACT_COOLDOWN",
        error: cooldown.reason === "daily_property_limit"
          ? "اكتملت محاولات التواصل الثلاث المتاحة اليوم لهذا العقار المجاني. حاول مجدداً غداً."
          : "انتظر قليلاً قبل إرسال طلب آخر لنفس العقار",
        remainingSeconds,
        remainingTimeFormatted: timeDisplay,
        ...(responseContactIdentity
          ? { contactIdentity: responseContactIdentity }
          : {}),
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
      ...(responseContactIdentity
        ? { contactIdentity: responseContactIdentity }
        : {}),
    });
  } catch (err: any) {
    console.error("Smart request error:", err);
    if (contactEventBase && !acceptedEventRecorded) {
      await recordContactEvent(contactEventBase, "error");
    }
    res.status(500).json({
      error: "خطأ في معالجة الطلب",
      ...(responseContactIdentity
        ? { contactIdentity: responseContactIdentity }
        : {}),
    });
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
