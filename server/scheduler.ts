/**
 * 📅 مهام مجدولة - تحديث الاشتراكات يومياً
 * - تحديث الأيام المتبقية في Google Sheets
 * - إرسال إشعارات للاشتراكات المنتهية (3 أيام متتالية، ثم توقف 4 أيام، ثم تكرار)
 */

import { storage } from "./storage";
import { notifySubscriptionExpired } from "./whatsapp";
import { googleSheetsService } from "./googleSheets";

/**
 * التحقق من أن اليوم يقع ضمن أيام الإرسال
 * النمط: 3 أيام إرسال، 4 أيام توقف، تكرار
 * أيام 1-3: إرسال | أيام 4-7: توقف | أيام 8-10: إرسال | أيام 11-14: توقف ...
 */
function shouldSendNotificationToday(daysSinceExpiry: number): boolean {
  if (daysSinceExpiry <= 0) return false;
  
  // حساب الموقع في الدورة (كل دورة 7 أيام)
  const positionInCycle = ((daysSinceExpiry - 1) % 7) + 1;
  
  // إرسال في أول 3 أيام من كل دورة
  return positionInCycle <= 3;
}

/**
 * جلب الإشعارات المُرسلة اليوم من جدول "تنبيهات الواتساب"
 * للتأكد من عدم إرسال إشعار مكرر حتى لو أُعيد تشغيل السيرفر
 * 
 * هيكل الجدول:
 * [0] id, [1] propertyNumber, [2] propertyName, [3] ownerPhone,
 * [4] type, [5] message, [6] status, [7] response, [8] createdAt
 */
async function getTodaysSentNotifications(): Promise<Set<string>> {
  const sentToday = new Set<string>();
  try {
    const notifications = await googleSheetsService.readSheet("تنبيهات الواتساب");
    const todayStr = new Date().toISOString().split('T')[0];
    
    for (const row of notifications) {
      const propertyNumber = row[1] || ""; // عمود رقم العقار (index 1)
      const notificationType = row[4] || ""; // عمود نوع الإشعار (index 4)
      const createdAt = row[8] || ""; // عمود تاريخ الإنشاء (index 8)
      
      // البحث عن إشعارات "انتهاء اشتراك" المُرسلة اليوم
      if (notificationType.includes("انتهاء") && createdAt.includes(todayStr)) {
        sentToday.add(propertyNumber);
      }
    }
    console.log(`📋 [Scheduler] إشعارات انتهاء مُرسلة اليوم: ${sentToday.size} عقار`);
  } catch (error) {
    console.error("❌ [Scheduler] خطأ في قراءة إشعارات اليوم:", error);
  }
  return sentToday;
}

// تحديث الأيام المتبقية في الشيت + إرسال إشعارات
async function updateRemainingDaysInSheet() {
  try {
    console.log("📅 [Scheduler] بدء تحديث الأيام المتبقية...");
    
    const subscriptions = await storage.getSubscriptions();
    const properties = await storage.getProperties();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    
    // جلب الإشعارات المُرسلة اليوم من Google Sheets (للتأكد حتى بعد إعادة تشغيل السيرفر)
    const sentToday = await getTodaysSentNotifications();
    
    let expired = 0;
    let expiringSoon = 0;
    let notificationsSent = 0;
    
    // تجميع كل التحديثات للتنفيذ دفعة واحدة (batch update)
    const batchUpdates: Array<{ propertyNumber: string; remainingDays: number }> = [];
    
    for (const sub of subscriptions) {
      if (!sub.endDate || !sub.propertyNumber) continue;
      
      try {
        const endDate = new Date(sub.endDate);
        endDate.setHours(0, 0, 0, 0);
        
        const diffTime = endDate.getTime() - today.getTime();
        const remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // تجميع التحديث بدلاً من التنفيذ المباشر
        batchUpdates.push({ propertyNumber: sub.propertyNumber, remainingDays: Math.max(0, remainingDays) });
        
        if (remainingDays < 0) {
          expired++;
          
          const daysSinceExpiry = Math.abs(remainingDays);
          const property = properties.find(p => p.propertyNumber === sub.propertyNumber);
          
          // التحقق من:
          // 1. العقار موجود
          // 2. اليوم ضمن أيام الإرسال (3 أيام كل أسبوع)
          // 3. لم يُرسل إشعار لهذا العقار اليوم (من Google Sheets)
          // 4. إشعارات الانتهاء غير موقوفة لهذا العقار
          const alreadySentToday = sentToday.has(sub.propertyNumber);
          const isMuted = (property as any)?.muteExpiryNotification === true;
          
          if (property && shouldSendNotificationToday(daysSinceExpiry) && !alreadySentToday && !isMuted) {
            try {
              console.log(`📤 [Scheduler] إرسال إشعار انتهاء للعقار ${sub.propertyNumber} (يوم ${daysSinceExpiry} منذ الانتهاء)`);
              const result = await notifySubscriptionExpired({
                propertyNumber: sub.propertyNumber,
                propertyName: property.name || "",
                ownerPhone: property.whatsappNumber || "",
              });
              if (result.status === "success") {
                notificationsSent++;
                sentToday.add(sub.propertyNumber); // إضافة للذاكرة المؤقتة لتجنب التكرار في نفس الدورة
                console.log(`✅ [Scheduler] تم إرسال إشعار انتهاء اشتراك: ${sub.propertyNumber}`);
              } else {
                console.log(`⚠️ [Scheduler] إشعار ${sub.propertyNumber}: ${result.status} - ${result.response}`);
              }
            } catch (err) {
              console.error(`❌ [Scheduler] فشل إرسال إشعار لـ ${sub.propertyNumber}:`, err);
            }
          }
        } else if (remainingDays >= 0 && remainingDays <= 7) {
          expiringSoon++;
        }
      } catch (err) {
        console.error(`❌ [Scheduler] خطأ في معالجة ${sub.propertyNumber}:`, err);
      }
    }
    
    // تنفيذ تحديث الأيام المتبقية دفعة واحدة (يقرأ الجدول مرة واحدة فقط)
    const updated = await storage.updateAllSubscriptionsRemainingDays(batchUpdates);
    
    console.log(`✅ [Scheduler] تم تحديث ${updated} اشتراك`);
    console.log(`   - منتهي: ${expired}`);
    console.log(`   - ينتهي قريباً: ${expiringSoon}`);
    console.log(`   - إشعارات مُرسلة: ${notificationsSent}`);
    console.log(`   - التاريخ الحالي: ${todayStr}`);
    
    return { updated, expired, expiringSoon, notificationsSent };
  } catch (error) {
    console.error("❌ [Scheduler] خطأ في تحديث الأيام المتبقية:", error);
    throw error;
  }
}

// تشغيل المهام المجدولة
export function startScheduler() {
  console.log("🕐 [Scheduler] بدء تشغيل المهام المجدولة...");
  
  // تحديث عند بدء السيرفر (بعد تأخير لتجنب تجاوز حصص Google Sheets)
  setTimeout(() => {
    updateRemainingDaysInSheet().catch(console.error);
  }, 60000); // انتظار 60 ثانية لتجنب تجاوز حصة القراءة
  
  // تحديث كل 24 ساعة (86400000 مللي ثانية)
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
  
  setInterval(() => {
    const now = new Date();
    console.log(`🕐 [Scheduler] تشغيل التحديث اليومي - ${now.toLocaleString('ar-SA')}`);
    updateRemainingDaysInSheet().catch(console.error);
  }, TWENTY_FOUR_HOURS);
  
  console.log("✅ [Scheduler] المهام المجدولة تعمل - تحديث كل 24 ساعة");
  console.log("📋 [Scheduler] يتم التحقق من إشعارات اليوم من Google Sheets لمنع التكرار");
}

// تصدير الدالة للاستخدام اليدوي (API endpoint)
export { updateRemainingDaysInSheet };
