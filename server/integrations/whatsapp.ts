// server/whatsapp.ts
import express from "express";
import { firebaseService } from "../firebaseService";
import type { NotificationSettings } from "../../shared/schema";
import { requireAdmin, requireSameOrigin } from "../routes/middleware";
import { isPropertySuspended } from "../services/propertySuspension";
import { formatDateRiyadh } from "../utils/dateUtils";

const router = express.Router();

// Every HTTP endpoint on this router exposes privileged operational data or
// can trigger a paid outbound message. Internal notification helpers exported
// below remain callable by trusted server code without going through Express.
router.use(requireSameOrigin, requireAdmin);

// إعدادات Meta WhatsApp Business API من المتغيرات البيئية
const META_WHATSAPP_TOKEN = process.env.META_WHATSAPP_TOKEN || "";
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID || "";
const META_NOTIFY_NUMBER = process.env.META_NOTIFY_NUMBER || "";

// رقم واتساب المدير (يُستخدم من المتغير البيئي الجديد)
const ADMIN_WHATSAPP = META_NOTIFY_NUMBER || process.env.ADMIN_WHATSAPP || "966533220646";

// إعدادات Meta WhatsApp Cloud API
const WHATSAPP_PHONE_NUMBER_ID = META_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const WHATSAPP_ACCESS_TOKEN = META_WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN || "";

// كاش إعدادات الإشعارات
let cachedSettings: NotificationSettings | null = null;
let settingsCacheTime = 0;
const CACHE_TTL = 60000; // 1 minute

async function getNotificationSettings(): Promise<NotificationSettings> {
  const now = Date.now();
  if (cachedSettings && (now - settingsCacheTime) < CACHE_TTL) {
    return cachedSettings;
  }
  
  try {
    cachedSettings = await firebaseService.getNotificationSettings();
    settingsCacheTime = now;
    return cachedSettings;
  } catch (err) {
    console.error("Error loading notification settings:", err);
    return {
      allNotifications: true,
      newProperty: true,
      newSubscription: true,
      subscriptionRenewal: true,
      receiptUpload: true,
      propertyUpdate: true,
      newPayment: true,
      smartRequest: true,
      propertyVerification: true,
      subscriptionExpired: true,
    };
  }
}

// مسح كاش الإعدادات
export function clearSettingsCache() {
  cachedSettings = null;
  settingsCacheTime = 0;
}

/**
 * دالة مساعدة: إرسال رسالة واتساب للمدير + حفظها في Google Sheet
 */
export async function sendWhatsAppNotification(text: string) {
  return sendAdminWhatsAppNotification({
    type: "تنبيه عام",
    text,
  });
}

async function sendAdminWhatsAppNotification(options: {
  type: string; // نوع الإشعار: اشتراك جديد، طلب، إلخ
  text: string; // نص حر إضافي
  propertyNumber?: string; // رقم العقار (اختياري)
  propertyName?: string; // اسم العقار (اختياري)
  ownerPhone?: string; // رقم المالك (اختياري)
}) {
  const { type, text, propertyNumber, propertyName, ownerPhone } = options;

  // بناء نص الرسالة
  let body = `تنبيه جديد من نظام روقـان ✅\n\n`;
  body += `نوع الإشعار: ${type}\n\n`;
  if (propertyNumber) body += `رقم العقار: ${propertyNumber}\n`;
  if (propertyName) body += `اسم العقار: ${propertyName}\n`;
  if (ownerPhone) {
    // تنسيق رقم المالك للواتساب (إزالة الصفر وإضافة 966)
    let ownerWhatsApp = ownerPhone.replace(/^0/, '966').replace(/[^0-9]/g, '');
    if (!ownerWhatsApp.startsWith('966')) {
      ownerWhatsApp = '966' + ownerWhatsApp;
    }
    body += `📲 واتساب المالك: https://wa.me/${ownerWhatsApp}\n`;
  }
  if (text) {
    body += `\nالتفاصيل:\n${text}\n`;
    // أضيف رابط التجديد فقط لإشعارات انتهاء الاشتراك
    if (type.includes("انتهاء")) {
      body += `\n🔗 جدد اشتراكك الآن: https://rwqan.sa/owner/login`;
    }
  }

  const url = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  let status = "pending";
  let responseText = "";

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt === 0) {
        console.log("📲 WhatsApp API call - URL:", url);
        console.log("📲 WhatsApp API call - Phone ID:", WHATSAPP_PHONE_NUMBER_ID ? "present" : "MISSING");
        console.log("📲 WhatsApp API call - Token:", WHATSAPP_ACCESS_TOKEN ? `present (${WHATSAPP_ACCESS_TOKEN.substring(0, 10)}...)` : "MISSING");
        console.log("📲 WhatsApp API call - Admin:", ADMIN_WHATSAPP);
      } else {
        console.log(`📲 WhatsApp API retry attempt ${attempt + 1}/${maxRetries + 1}...`);
      }
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
      
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: ADMIN_WHATSAPP,
          type: "text",
          text: {
            preview_url: false,
            body,
          },
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      console.log("📲 WhatsApp API response status:", resp.status, resp.statusText);
      
      const data = await resp.json().catch(() => ({}));
      status = resp.ok ? "success" : "error";
      responseText = JSON.stringify(data).slice(0, 1000);

      console.log("📲 WhatsApp API response:", status, responseText);
      
      if (resp.ok) break; // Success, no need to retry
      
      // Non-timeout error (e.g. 400 bad request) - don't retry
      if (resp.status >= 400 && resp.status < 500) break;
      
      // Server error - retry
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
      }
    } catch (err: any) {
      status = "error";
      const errorMessage = err?.message || String(err);
      const isTimeout = err?.cause?.code === 'ETIMEDOUT' || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('aborted');
      
      responseText = isTimeout ? `TIMEOUT: ${errorMessage}` : errorMessage;
      
      console.error(`❌ WhatsApp send error (attempt ${attempt + 1}):`, err);
      
      if (isTimeout && attempt < maxRetries) {
        console.log(`🔄 Retrying after timeout (attempt ${attempt + 2})...`);
        await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
      } else if (isTimeout) {
        console.error("🔴 WhatsApp API is unreachable after all retries! Check server network/firewall settings.");
      }
    }
  }

  // حفظ السجل في Firebase
  const log = {
    id: `WA-${Date.now()}`,
    type,
    message: body,
    phone: ADMIN_WHATSAPP,
    status,
    response: responseText,
    createdAt: new Date().toISOString(),
    propertyNumber,
    propertyName,
    ownerPhone,
  };

  try {
    await firebaseService.addWhatsAppLog(log);
  } catch (err) {
    console.error("❌ addWhatsAppLog error:", err);
  }

  return { status, response: responseText };
}

/**
 * 1) إرسال رسالة يدوية من لوحة تحكم الأدمن
 *    تستخدمها صفحة "إرسال رسالة إلى واتساب المدير"
 *    POST /api/whatsapp/send-admin
 */
router.post("/send-admin", async (req, res) => {
  try {
    const { text, type, propertyNumber, propertyName, ownerPhone } = req.body;

    if (!text) {
      return res.status(400).json({ message: "الرسالة مطلوبة" });
    }

    const result = await sendAdminWhatsAppNotification({
      type: type || "رسالة إدارية",
      text,
      propertyNumber,
      propertyName,
      ownerPhone,
    });

    res.json({
      success: result.status === "success",
      status: result.status,
    });
  } catch (err) {
    console.error("send-admin error:", err);
    res.status(500).json({ message: "خطأ في إرسال رسالة الواتساب" });
  }
});

/**
 * 2) جلب سجلات رسائل الواتساب من الشيت
 *    تستخدمها بطاقة "سجل رسائل الواتساب" في لوحة الأدمن
 *    GET /api/whatsapp/logs
 */
router.get("/logs", async (_req, res) => {
  try {
    const logs = (await firebaseService.getWhatsAppLogs()) || [];
    res.json(logs);
  } catch (err) {
    console.error("get /logs error:", err);
    res.status(500).json({ message: "خطأ في جلب سجلات الواتساب" });
  }
});

/**
 * 3) إحصائيات الواتساب
 */
router.get("/stats", async (_req, res) => {
  try {
    const logs = (await firebaseService.getWhatsAppLogs()) || [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const todayCount = logs.filter((l: any) => {
      const d = new Date(l.createdAt);
      return d >= today;
    }).length;

    const weekCount = logs.filter((l: any) => {
      const d = new Date(l.createdAt);
      return d >= weekAgo;
    }).length;

    const monthCount = logs.filter((l: any) => {
      const d = new Date(l.createdAt);
      return d >= monthStart;
    }).length;

    res.json({
      today: todayCount,
      week: weekCount,
      month: monthCount,
      total: logs.length,
    });
  } catch (err) {
    console.error("get /stats error:", err);
    res.json({ today: 0, week: 0, month: 0, total: 0 });
  }
});

/**
 * 4) جلب الطلبات الذكية
 */
router.get("/requests", async (_req, res) => {
  try {
    const requests = await firebaseService.getRequests();
    res.json(requests.slice(0, 50)); // آخر 50 طلب
  } catch (err) {
    console.error("get /requests error:", err);
    res.json([]);
  }
});

/**
 * 5) إرسال رسالة يدوية (من لوحة الأدمن)
 */
router.post("/send", async (req, res) => {
  try {
    const { message, type } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ message: "الرسالة مطلوبة" });
    }

    const result = await sendAdminWhatsAppNotification({
      type: type || "manual",
      text: message,
    });

    res.json({
      success: result.status === "success",
      status: result.status,
    });
  } catch (err) {
    console.error("POST /send error:", err);
    res.status(500).json({ message: "خطأ في إرسال الرسالة" });
  }
});

// ===========================================
// دوال الإشعارات للأحداث المختلفة
// ===========================================

/**
 * إشعار اشتراك جديد
 */
export async function notifyNewSubscription(data: {
  propertyNumber: string;
  propertyName: string;
  ownerPhone: string;
  packageName: string;
  amount: number;
}) {
  const settings = await getNotificationSettings();
  if (!settings.allNotifications || !settings.newSubscription) {
    console.log("📵 Notification disabled: newSubscription");
    return { status: "disabled", response: "الإشعار معطل" };
  }
  
  const text = `📦 باقة: ${data.packageName}\n💰 المبلغ: ${data.amount} ريال`;
  return sendAdminWhatsAppNotification({
    type: "🎉 اشتراك جديد",
    text,
    propertyNumber: data.propertyNumber,
    propertyName: data.propertyName,
    ownerPhone: data.ownerPhone,
  });
}

/**
 * إشعار تجديد اشتراك
 */
export async function notifySubscriptionRenewal(data: {
  propertyNumber: string;
  propertyName: string;
  ownerPhone: string;
  packageName: string;
  amount: number;
}) {
  const settings = await getNotificationSettings();
  if (!settings.allNotifications || !settings.subscriptionRenewal) {
    console.log("📵 Notification disabled: subscriptionRenewal");
    return { status: "disabled", response: "الإشعار معطل" };
  }
  
  const text = `🔄 تجديد باقة: ${data.packageName}\n💰 المبلغ: ${data.amount} ريال`;
  return sendAdminWhatsAppNotification({
    type: "🔄 تجديد اشتراك",
    text,
    propertyNumber: data.propertyNumber,
    propertyName: data.propertyName,
    ownerPhone: data.ownerPhone,
  });
}

/**
 * إشعار رفع إيصال
 */
export async function notifyReceiptUpload(data: {
  propertyNumber: string;
  propertyName: string;
  ownerPhone: string;
  receiptUrl: string;
}) {
  const settings = await getNotificationSettings();
  if (!settings.allNotifications || !settings.receiptUpload) {
    console.log("📵 Notification disabled: receiptUpload");
    return { status: "disabled", response: "الإشعار معطل" };
  }
  
  const text = `📄 تم رفع إيصال جديد\n🔗 رابط الإيصال: ${data.receiptUrl}`;
  return sendAdminWhatsAppNotification({
    type: "📄 رفع إيصال",
    text,
    propertyNumber: data.propertyNumber,
    propertyName: data.propertyName,
    ownerPhone: data.ownerPhone,
  });
}

/**
 * إشعار تعديل عقار
 */
export async function notifyPropertyUpdate(data: {
  propertyNumber: string;
  propertyName: string;
  changes: string;
}) {
  const settings = await getNotificationSettings();
  if (!settings.allNotifications || !settings.propertyUpdate) {
    console.log("📵 Notification disabled: propertyUpdate");
    return { status: "disabled", response: "الإشعار معطل" };
  }
  
  const text = `✏️ التعديلات:\n${data.changes}`;
  return sendAdminWhatsAppNotification({
    type: "✏️ تعديل عقار",
    text,
    propertyNumber: data.propertyNumber,
    propertyName: data.propertyName,
  });
}

/**
 * إشعار إضافة عقار جديد
 */
export async function notifyNewProperty(data: {
  propertyNumber: string;
  propertyName: string;
  ownerPhone: string;
  city: string;
  type: string;
}) {
  const settings = await getNotificationSettings();
  if (!settings.allNotifications || !settings.newProperty) {
    console.log("📵 Notification disabled: newProperty");
    return { status: "disabled", response: "الإشعار معطل" };
  }
  
  console.log("📲 Sending new property notification:", data.propertyNumber, data.propertyName);
  const text = `🏠 نوع العقار: ${data.type}\n📍 المنطقة: ${data.city}`;
  const result = await sendAdminWhatsAppNotification({
    type: "🏠 عقار جديد",
    text,
    propertyNumber: data.propertyNumber,
    propertyName: data.propertyName,
    ownerPhone: data.ownerPhone,
  });
  console.log("📲 Notification result:", result);
  return result;
}

/**
 * إشعار انتهاء اشتراك
 */
export async function notifySubscriptionExpired(data: {
  propertyNumber: string;
  propertyName: string;
  ownerPhone: string;
}) {
  const settings = await getNotificationSettings();
  if (!settings.allNotifications || !settings.subscriptionExpired) {
    console.log("📵 Notification disabled: subscriptionExpired");
    return { status: "disabled", response: "الإشعار معطل" };
  }
  
  const text = `⚠️ الاشتراك منتهي - يرجى التجديد`;
  return sendAdminWhatsAppNotification({
    type: "⚠️ انتهاء اشتراك",
    text,
    propertyNumber: data.propertyNumber,
    propertyName: data.propertyName,
    ownerPhone: data.ownerPhone,
  });
}

/**
 * إشعار دفعة جديدة (تسجيل جديد - يحتاج تحقق)
 */
export async function notifyNewPayment(data: {
  propertyNumber: string;
  propertyName: string;
  amount: number;
  paymentMethod: string;
  transactionId: string;
}) {
  const settings = await getNotificationSettings();
  if (!settings.allNotifications || !settings.newPayment) {
    console.log("📵 Notification disabled: newPayment");
    return { status: "disabled", response: "الإشعار معطل" };
  }
  
  const text = `💳 طريقة الدفع: ${data.paymentMethod}\n💰 المبلغ: ${data.amount} ريال\n🔢 رقم العملية: ${data.transactionId}\n\n⏳ بانتظار التحقق من بيانات العقار`;
  return sendAdminWhatsAppNotification({
    type: "💳 دفعة جديدة - تسجيل عقار",
    text,
    propertyNumber: data.propertyNumber,
    propertyName: data.propertyName,
  });
}

/**
 * إشعار طلب واتساب (Smart Request)
 */
export async function notifySmartRequest(data: {
  propertyNumber: string;
  propertyName: string;
  deviceType: string;
  ip: string;
}) {
  const settings = await getNotificationSettings();
  if (!settings.allNotifications || !settings.smartRequest) {
    console.log("📵 Notification disabled: smartRequest");
    return { status: "disabled", response: "الإشعار معطل" };
  }
  
  const text = `📱 الجهاز: ${data.deviceType}\n🌐 IP: ${data.ip}`;
  return sendAdminWhatsAppNotification({
    type: "📲 طلب واتساب جديد",
    text,
    propertyNumber: data.propertyNumber,
    propertyName: data.propertyName,
  });
}

/**
 * إشعار تحقق من عقار (قبول/رفض)
 */
export async function notifyPropertyVerification(data: {
  propertyNumber: string;
  propertyName: string;
  action: "قبول" | "رفض";
  reason?: string;
  admin?: string;
}) {
  const settings = await getNotificationSettings();
  if (!settings.allNotifications || !settings.propertyVerification) {
    console.log("📵 Notification disabled: propertyVerification");
    return { status: "disabled", response: "الإشعار معطل" };
  }
  
  const emoji = data.action === "قبول" ? "✅" : "❌";
  let text = `${emoji} الإجراء: ${data.action}`;
  if (data.reason) text += `\n📝 السبب: ${data.reason}`;
  if (data.admin) text += `\n👤 بواسطة: ${data.admin}`;
  
  return sendAdminWhatsAppNotification({
    type: `${emoji} تحقق من عقار`,
    text,
    propertyNumber: data.propertyNumber,
    propertyName: data.propertyName,
  });
}

// ===========================================
// دوال إرسال الإشعارات للمالك (عبر Enjazatik API)
// ===========================================

const ENJAZATIK_URL = process.env.ENJAZATIK_URL || "";
const ENJAZATIK_TOKEN = process.env.ENJAZATIK_TOKEN || "";

interface EnjazatikWhatsAppDependencies {
  url: string;
  token: string;
  request: (url: string, init: RequestInit) => Promise<Response>;
  delay: (milliseconds: number) => Promise<void>;
}

/**
 * دالة أساسية لإرسال رسالة WhatsApp للمالك عبر Enjazatik
 * مع إعادة المحاولة في حال الفشل
 */
export function createEnjazatikWhatsAppSender(
  dependencies: EnjazatikWhatsAppDependencies,
) {
  return async function sendEnjazatikWhatsApp(
    phone: string,
    message: string,
    retries = 2,
  ): Promise<{ success: boolean; error?: string }> {
    if (!dependencies.url || !dependencies.token) {
      console.error("❌ Missing Enjazatik credentials");
      return { success: false, error: "إعدادات الإرسال غير مكتملة" };
    }

    // تنظيف وتنسيق رقم الهاتف
    let cleanPhone = phone.replace(/[^0-9]/g, "");
    if (cleanPhone.startsWith("0")) {
      cleanPhone = "966" + cleanPhone.substring(1);
    } else if (!cleanPhone.startsWith("966")) {
      cleanPhone = "966" + cleanPhone;
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await dependencies.request(dependencies.url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${dependencies.token}`,
            "Content-Type": "application/json"
          },
          signal: AbortSignal.timeout(15_000),
          body: JSON.stringify({
            number: cleanPhone,
            message: message
          })
        });

        if (response.ok) {
          console.log(`✅ Owner notification sent to ${cleanPhone.substring(0, 6)}**** (attempt ${attempt + 1})`);
          return { success: true };
        }

        console.error(`❌ Enjazatik send failed (attempt ${attempt + 1}/${retries + 1}):`, response.status);
        if (attempt < retries) {
          const backoff = 5000 * (attempt + 1); // 5s, 10s
          await dependencies.delay(backoff);
        }
      } catch (error) {
        console.error(`❌ Enjazatik error (attempt ${attempt + 1}/${retries + 1}):`, error);
        if (attempt < retries) {
          const backoff = 5000 * (attempt + 1);
          await dependencies.delay(backoff);
        }
      }
    }

    return { success: false, error: "فشل في إرسال الرسالة بعد عدة محاولات" };
  };
}

const sendOwnerWhatsAppWithDefaults = createEnjazatikWhatsAppSender({
  url: ENJAZATIK_URL,
  token: ENJAZATIK_TOKEN,
  request: (url, init) => fetch(url, init),
  delay: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
});

export async function sendOwnerWhatsApp(
  phone: string,
  message: string,
  retries = 2,
): Promise<{ success: boolean; error?: string }> {
  return sendOwnerWhatsAppWithDefaults(phone, message, retries);
}

export interface PropertyOwnerWhatsAppResult {
  success: boolean;
  error?: string;
  suppressed?: boolean;
  code?: "PROPERTY_SUSPENDED" | "SUSPENSION_LOOKUP_FAILED";
}

interface PropertyOwnerWhatsAppDependencies {
  isSuspended: (propertyNumber: string) => Promise<boolean>;
  send: (
    phone: string,
    message: string,
    retries: number,
  ) => Promise<{ success: boolean; error?: string }>;
  delay: (milliseconds: number) => Promise<void>;
}

export function createPropertyOwnerWhatsAppSender(
  dependencies: PropertyOwnerWhatsAppDependencies,
) {
  return async function sendPropertyOwnerWhatsAppWithDependencies(options: {
    ownerPhone: string;
    propertyNumber: string;
    message: string;
    retries?: number;
  }): Promise<PropertyOwnerWhatsAppResult> {
    const requestedRetries = options.retries ?? 2;
    const retries = Number.isFinite(requestedRetries)
      ? Math.max(0, Math.floor(requestedRetries))
      : 2;
    let lastError = "فشل في إرسال الرسالة بعد عدة محاولات";

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (await dependencies.isSuspended(options.propertyNumber)) {
          console.log(
            `🔒 Owner notification suppressed for suspended property ${options.propertyNumber}`,
          );
          return {
            success: false,
            suppressed: true,
            code: "PROPERTY_SUSPENDED",
            error: "العقار موقوف مؤقتاً ولن تصله إشعارات حتى إعادة التفعيل",
          };
        }
      } catch (error) {
        console.error(
          `❌ Could not verify suspension status for ${options.propertyNumber}; owner notification suppressed:`,
          error,
        );
        return {
          success: false,
          suppressed: true,
          code: "SUSPENSION_LOOKUP_FAILED",
          error: "تعذر التحقق من حالة إيقاف العقار، لذلك لم يتم إرسال الإشعار",
        };
      }

      const result = await dependencies.send(
        options.ownerPhone,
        options.message,
        0,
      );
      if (result.success) return { success: true };

      lastError = result.error || lastError;
      if (lastError === "إعدادات الإرسال غير مكتملة") break;

      if (attempt < retries) {
        await dependencies.delay(5000 * (attempt + 1));
      }
    }

    return { success: false, error: lastError };
  };
}

const sendPropertyOwnerWhatsAppWithDefaults = createPropertyOwnerWhatsAppSender({
  isSuspended: isPropertySuspended,
  send: sendOwnerWhatsApp,
  delay: (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
});

export async function sendPropertyOwnerWhatsApp(options: {
  ownerPhone: string;
  propertyNumber: string;
  message: string;
  retries?: number;
}): Promise<PropertyOwnerWhatsAppResult> {
  return sendPropertyOwnerWhatsAppWithDefaults(options);
}

export function buildOwnerFreeContactLimitReachedMessage(data: {
  propertyNumber: string;
  dailyLimit?: number;
}): string {
  if (data.dailyLimit !== undefined && data.dailyLimit !== 3) {
    return `تم الوصول إلى الحد اليومي لطلبات التواصل للعقار رقم ${data.propertyNumber} ضمن الباقة المجانية (${data.dailyLimit} من ${data.dailyLimit}).

قم بترقية الباقة لاستقبال طلبات تواصل غير محدودة:
https://rwqan.sa/owner/subscription`;
  }

  return `تم الوصول إلى الحد اليومي لطلبات التواصل للعقار رقم ${data.propertyNumber} ضمن الباقة المجانية (3 من 3).

قم بترقية الباقة لاستقبال طلبات تواصل غير محدودة:
https://rwqan.sa/owner/subscription`;
}

export async function notifyOwnerFreeContactLimitReached(data: {
  ownerPhone: string;
  propertyNumber: string;
  dailyLimit?: number;
}): Promise<PropertyOwnerWhatsAppResult> {
  return sendPropertyOwnerWhatsApp({
    ownerPhone: data.ownerPhone,
    propertyNumber: data.propertyNumber,
    message: buildOwnerFreeContactLimitReachedMessage(data),
  });
}

export function buildOwnerSubscriptionActivatedMessage(data: {
  propertyNumber: string;
  propertyName: string;
  endDate: string;
}): string {
  const parsedEndDate = new Date(data.endDate);
  const displayedEndDate = Number.isFinite(parsedEndDate.getTime())
    ? formatDateRiyadh(parsedEndDate)
    : data.endDate;

  return `مرحبا بك في نظام روقـان للعقارات

تم تفعيل اشتراكك للعقار ${data.propertyName} رقم ${data.propertyNumber}

صالح حتى ${displayedEndDate}

شكرا لثقتك بنا`;
}

/**
 * إشعار تفعيل الاشتراك للمالك
 */
export async function notifyOwnerSubscriptionActivated(data: {
  ownerPhone: string;
  propertyNumber: string;
  propertyName: string;
  endDate: string;
  message?: string;
}) {
  const defaultMessage = buildOwnerSubscriptionActivatedMessage(data);

  const finalMessage = data.message || defaultMessage;

  return sendPropertyOwnerWhatsApp({
    ownerPhone: data.ownerPhone,
    propertyNumber: data.propertyNumber,
    message: finalMessage,
  });
}

/**
 * إشعار تنبيه قبل انتهاء الاشتراك (3 أيام)
 */
export async function notifyOwnerSubscriptionExpiringSoon(data: {
  ownerPhone: string;
  propertyNumber: string;
  propertyName: string;
  daysLeft: number;
}) {
  const message = `مرحبا بك في نظام روقـان للعقارات

اشتراك عقارك ${data.propertyName} رقم ${data.propertyNumber} ينتهي خلال ${data.daysLeft} ايام

جدد الان للحفاظ على ظهورك المميز
https://rwqan.sa/owner/login`;

  return sendPropertyOwnerWhatsApp({
    ownerPhone: data.ownerPhone,
    propertyNumber: data.propertyNumber,
    message,
  });
}

/**
 * إشعار انتهاء الاشتراك للمالك
 */
export async function notifyOwnerSubscriptionExpired(data: {
  ownerPhone: string;
  propertyNumber: string;
  propertyName: string;
}) {
  const message = `مرحبا بك في نظام روقـان للعقارات

انتهى اشتراك عقارك ${data.propertyName} رقم ${data.propertyNumber}

تم تحويله للعرض العادي

جدد الان لاستعادة المميزات
https://rwqan.sa/owner/login`;

  return sendPropertyOwnerWhatsApp({
    ownerPhone: data.ownerPhone,
    propertyNumber: data.propertyNumber,
    message,
  });
}

// نصدر الراوتر كـ default
export default router;
