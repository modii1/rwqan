// server/whatsapp.ts
import express from "express";
import { googleSheetsService } from "./googleSheets";
import type { NotificationSettings } from "@shared/schema";

const router = express.Router();

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
    cachedSettings = await googleSheetsService.getNotificationSettings();
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
    body += `🔗 لوحة تحكم المالك: https://rwqan.replit.app/owner\n`;
  }
  if (text) {
    body += `\nالتفاصيل:\n${text}\n`;
  }

  const url = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  let status = "pending";
  let responseText = "";

  try {
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
    });

    const data = await resp.json().catch(() => ({}));
    status = resp.ok ? "success" : "error";
    responseText = JSON.stringify(data).slice(0, 1000); // لا نطوّل كثير

    console.log("📲 WhatsApp API response:", status, responseText);
  } catch (err: any) {
    status = "error";
    responseText = String(err?.message || err);
    console.error("❌ WhatsApp send error:", err);
  }

  // حفظ السجل في Google Sheet
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
    await (googleSheetsService as any).addWhatsAppLog(log);
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
    const logs = (await (googleSheetsService as any).getWhatsAppLogs()) || [];
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
    const logs = (await (googleSheetsService as any).getWhatsAppLogs()) || [];
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
    const requests = await googleSheetsService.getRequests();
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

// نصدر الراوتر كـ default
export default router;
