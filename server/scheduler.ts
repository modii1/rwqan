/**
 * 📅 مهام مجدولة - تحديث الاشتراكات يومياً
 * - تحديث الأيام المتبقية في Google Sheets
 * - إرسال إشعارات للاشتراكات المنتهية قريباً
 */

import { storage } from "./storage";

// تحديث الأيام المتبقية في الشيت
async function updateRemainingDaysInSheet() {
  try {
    console.log("📅 [Scheduler] بدء تحديث الأيام المتبقية...");
    
    const subscriptions = await storage.getSubscriptions();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let updated = 0;
    let expired = 0;
    let expiringSoon = 0;
    
    for (const sub of subscriptions) {
      if (!sub.endDate || !sub.propertyNumber) continue;
      
      try {
        const endDate = new Date(sub.endDate);
        endDate.setHours(0, 0, 0, 0);
        
        const diffTime = endDate.getTime() - today.getTime();
        const remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        // تحديث الأيام المتبقية في الشيت
        await storage.updateSubscriptionRemainingDays(sub.propertyNumber, Math.max(0, remainingDays));
        updated++;
        
        if (remainingDays < 0) {
          expired++;
        } else if (remainingDays >= 0 && remainingDays <= 7) {
          expiringSoon++;
        }
      } catch (err) {
        console.error(`❌ [Scheduler] خطأ في تحديث ${sub.propertyNumber}:`, err);
      }
    }
    
    console.log(`✅ [Scheduler] تم تحديث ${updated} اشتراك`);
    console.log(`   - منتهي: ${expired}`);
    console.log(`   - ينتهي قريباً: ${expiringSoon}`);
    console.log(`   - التاريخ الحالي: ${today.toISOString().split('T')[0]}`);
    
    return { updated, expired, expiringSoon };
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
}

// تصدير الدالة للاستخدام اليدوي (API endpoint)
export { updateRemainingDaysInSheet };
