// server/whatsapp.ts
import express from "express";
import { googleSheetsService } from "./googleSheets";

const router = express.Router();

// رقم واتساب المدير (أنت)
// تقدر تعدله من المتغير البيئي ADMIN_WHATSAPP أو خليه ثابت هنا
const ADMIN_WHATSAPP = process.env.ADMIN_WHATSAPP || "966533220646"; // عدله لرقمك بدون +

// إعدادات Meta WhatsApp Cloud API
const WHATSAPP_PHONE_NUMBER_ID =
  process.env.WHATSAPP_PHONE_NUMBER_ID || "602477526273771";
const WHATSAPP_ACCESS_TOKEN =
  process.env.WHATSAPP_ACCESS_TOKEN || "YOUR_ACCESS_TOKEN_HERE";

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
  let body = `تنبيه جديد من نظام مودي الذكي ✅\n\n`;
  body += `نوع الإشعار: ${type}\n\n`;
  if (propertyNumber) body += `رقم العقار: ${propertyNumber}\n`;
  if (propertyName) body += `اسم العقار: ${propertyName}\n`;
  if (ownerPhone) body += `رقم المالك: ${ownerPhone}\n`;
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

// نصدر الراوتر كـ default
export default router;

// نصدّر أيضاً الدالة للاستعمال لاحقاً من باقي الراوتات (اشتراك جديد، دفع، إلخ)
export { sendAdminWhatsAppNotification };
