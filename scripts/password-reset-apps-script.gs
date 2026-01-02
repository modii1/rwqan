/**
 * Google Apps Script - نظام إعادة تعيين الرقم السري لروقان
 * ============================================================
 * 
 * التثبيت:
 * 1. افتح Google Sheets الخاص بروقان
 * 2. اضغط على Extensions > Apps Script
 * 3. انسخ هذا الكود كاملاً
 * 4. اذهب إلى Project Settings > Script Properties
 * 5. أضف:
 *    - ENJAZATIK_TOKEN: "KEY_API_TOKEN"
 *    - ENJAZATIK_URL: "https://business.enjazatik.com/api/v1/send-message"
 * 6. Deploy > New deployment > Web app
 * 7. Execute as: Me, Who has access: Anyone
 * 8. انسخ رابط Web App واستخدمه في الفرونت إند
 */

// ============================================================
// الإعدادات
// ============================================================
const SHEET_NAME = "الملاك";
const RESET_COOLDOWN_DAYS = 30;
const CODE_EXPIRY_MINUTES = 10;

// أسماء الأعمدة
const COLS = {
  OWNER_ID: 0,    // A
  PHONE: 1,       // B
  PASSWORD: 2,    // C
  RESET_CODE: 3,  // D
  RESET_EXPIRE: 4,// E
  LAST_RESET: 5   // F
};

// ============================================================
// نقطة الدخول الرئيسية - POST requests
// ============================================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    
    let result;
    switch (action) {
      case "sendResetCode":
        result = sendResetCode(data.ownerId);
        break;
      case "setNewPassword":
        result = setNewPassword(data.ownerId, data.resetCode, data.newPassword);
        break;
      case "changePassword":
        result = changePassword(data.ownerId, data.currentPassword, data.newPassword);
        break;
      default:
        result = { success: false, message: "إجراء غير معروف" };
    }
    
    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        message: "خطأ في النظام: " + error.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ============================================================
// دعم GET للاختبار
// ============================================================
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({
      status: "ok",
      message: "نظام إعادة تعيين الرقم السري يعمل بنجاح"
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// 1️⃣ إرسال رمز إعادة التعيين
// ============================================================
function sendResetCode(ownerId) {
  const sheet = getSheet();
  const row = findOwnerRow(sheet, ownerId);
  
  if (!row) {
    return { success: false, message: "رقم العقار غير موجود" };
  }
  
  const data = sheet.getRange(row, 1, 1, 6).getValues()[0];
  const phone = data[COLS.PHONE];
  const lastReset = data[COLS.LAST_RESET];
  
  // التحقق من رقم الجوال
  if (!phone) {
    return { success: false, message: "لا يوجد رقم جوال مسجل لهذا العقار" };
  }
  
  // التحقق من مرور 30 يوم
  if (lastReset) {
    const lastResetDate = new Date(lastReset);
    const now = new Date();
    const daysDiff = Math.floor((now - lastResetDate) / (1000 * 60 * 60 * 24));
    
    if (daysDiff < RESET_COOLDOWN_DAYS) {
      const remainingDays = RESET_COOLDOWN_DAYS - daysDiff;
      return { 
        success: false, 
        message: `يمكنك إعادة تعيين الرقم السري بعد ${remainingDays} يوم` 
      };
    }
  }
  
  // توليد رمز 6 أرقام
  const resetCode = generateCode();
  const now = new Date();
  const expireTime = new Date(now.getTime() + CODE_EXPIRY_MINUTES * 60 * 1000);
  
  // حفظ في الشيت
  sheet.getRange(row, COLS.RESET_CODE + 1).setValue(resetCode);
  sheet.getRange(row, COLS.RESET_EXPIRE + 1).setValue(expireTime.toISOString());
  sheet.getRange(row, COLS.LAST_RESET + 1).setValue(now.toISOString());
  
  // إرسال واتساب
  const whatsappResult = sendWhatsApp(
    phone, 
    `رمز إعادة تعيين الرقم السري لروقان هو: ${resetCode} (صالح 10 دقائق)`
  );
  
  if (!whatsappResult.success) {
    // مسح الرمز في حالة فشل الإرسال
    sheet.getRange(row, COLS.RESET_CODE + 1).setValue("");
    sheet.getRange(row, COLS.RESET_EXPIRE + 1).setValue("");
    sheet.getRange(row, COLS.LAST_RESET + 1).setValue("");
    return { success: false, message: "فشل في إرسال الرسالة، حاول لاحقاً" };
  }
  
  // إخفاء أول 4 أرقام من الجوال
  const maskedPhone = phone.substring(0, phone.length - 4).replace(/./g, "*") + phone.slice(-4);
  
  return { 
    success: true, 
    message: `تم إرسال رمز التحقق إلى ${maskedPhone}`,
    expiresIn: CODE_EXPIRY_MINUTES
  };
}

// ============================================================
// 2️⃣ تعيين رقم سري جديد
// ============================================================
function setNewPassword(ownerId, resetCode, newPassword) {
  if (!resetCode || !newPassword) {
    return { success: false, message: "البيانات غير مكتملة" };
  }
  
  if (newPassword.length < 4) {
    return { success: false, message: "الرقم السري يجب أن يكون 4 أرقام على الأقل" };
  }
  
  const sheet = getSheet();
  const row = findOwnerRow(sheet, ownerId);
  
  if (!row) {
    return { success: false, message: "رقم العقار غير موجود" };
  }
  
  const data = sheet.getRange(row, 1, 1, 6).getValues()[0];
  const storedCode = data[COLS.RESET_CODE];
  const expireTime = data[COLS.RESET_EXPIRE];
  
  // التحقق من الرمز
  if (!storedCode || storedCode.toString() !== resetCode.toString()) {
    return { success: false, message: "رمز التحقق غير صحيح" };
  }
  
  // التحقق من الصلاحية
  if (expireTime) {
    const expireDate = new Date(expireTime);
    if (new Date() > expireDate) {
      // مسح الرمز المنتهي
      sheet.getRange(row, COLS.RESET_CODE + 1).setValue("");
      sheet.getRange(row, COLS.RESET_EXPIRE + 1).setValue("");
      return { success: false, message: "انتهت صلاحية رمز التحقق" };
    }
  }
  
  // تحديث الرقم السري
  sheet.getRange(row, COLS.PASSWORD + 1).setValue(newPassword);
  
  // مسح الرمز
  sheet.getRange(row, COLS.RESET_CODE + 1).setValue("");
  sheet.getRange(row, COLS.RESET_EXPIRE + 1).setValue("");
  
  return { success: true, message: "تم تغيير الرقم السري بنجاح" };
}

// ============================================================
// 3️⃣ تغيير الرقم السري من لوحة المالك
// ============================================================
function changePassword(ownerId, currentPassword, newPassword) {
  if (!currentPassword || !newPassword) {
    return { success: false, message: "البيانات غير مكتملة" };
  }
  
  if (newPassword.length < 4) {
    return { success: false, message: "الرقم السري يجب أن يكون 4 أرقام على الأقل" };
  }
  
  const sheet = getSheet();
  const row = findOwnerRow(sheet, ownerId);
  
  if (!row) {
    return { success: false, message: "رقم العقار غير موجود" };
  }
  
  const data = sheet.getRange(row, 1, 1, 6).getValues()[0];
  const storedPassword = data[COLS.PASSWORD];
  
  // التحقق من الرقم السري الحالي
  if (storedPassword.toString() !== currentPassword.toString()) {
    return { success: false, message: "الرقم السري الحالي غير صحيح" };
  }
  
  // تحديث الرقم السري
  sheet.getRange(row, COLS.PASSWORD + 1).setValue(newPassword);
  
  // مسح أي رمز إعادة تعيين موجود
  sheet.getRange(row, COLS.RESET_CODE + 1).setValue("");
  sheet.getRange(row, COLS.RESET_EXPIRE + 1).setValue("");
  
  return { success: true, message: "تم تغيير الرقم السري بنجاح" };
}

// ============================================================
// الدوال المساعدة
// ============================================================

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  
  // إنشاء الورقة إذا لم تكن موجودة
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    // إضافة العناوين
    sheet.getRange(1, 1, 1, 6).setValues([
      ["ownerId", "phone", "password", "resetCode", "resetExpire", "lastReset"]
    ]);
    sheet.getRange(1, 1, 1, 6).setFontWeight("bold");
  }
  
  return sheet;
}

function findOwnerRow(sheet, ownerId) {
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][COLS.OWNER_ID] && data[i][COLS.OWNER_ID].toString() === ownerId.toString()) {
      return i + 1; // +1 لأن getRange يبدأ من 1
    }
  }
  
  return null;
}

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function sendWhatsApp(phone, message) {
  try {
    const props = PropertiesService.getScriptProperties();
    const token = props.getProperty("ENJAZATIK_TOKEN");
    const url = props.getProperty("ENJAZATIK_URL");
    
    if (!token || !url) {
      Logger.log("Missing Enjazatik credentials");
      return { success: false, message: "إعدادات الإرسال غير مكتملة" };
    }
    
    // تنظيف رقم الجوال
    let cleanPhone = phone.toString().replace(/\D/g, "");
    if (cleanPhone.startsWith("0")) {
      cleanPhone = "966" + cleanPhone.substring(1);
    }
    if (!cleanPhone.startsWith("966")) {
      cleanPhone = "966" + cleanPhone;
    }
    
    const payload = {
      number: cleanPhone,
      message: message
    };
    
    const options = {
      method: "post",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    
    Logger.log("WhatsApp API Response: " + responseCode);
    
    // Enjazatik قد يرجع 200 بدون body
    if (responseCode >= 200 && responseCode < 300) {
      return { success: true };
    }
    
    return { success: false, message: "فشل الإرسال: " + responseCode };
    
  } catch (error) {
    Logger.log("WhatsApp Error: " + error.message);
    return { success: false, message: error.message };
  }
}

// ============================================================
// دالة اختبار - لا تُستخدم في الإنتاج
// ============================================================
function testSetup() {
  const sheet = getSheet();
  Logger.log("Sheet Name: " + sheet.getName());
  Logger.log("Rows: " + sheet.getLastRow());
  
  // إضافة بيانات اختبار
  if (sheet.getLastRow() < 2) {
    sheet.appendRow(["00000", "966500000000", "123", "", "", ""]);
    Logger.log("Added test data: ownerId=00000, password=123");
  }
}
