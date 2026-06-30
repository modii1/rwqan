/**
 * 📅 مهام مجدولة - تحديث الاشتراكات والإضافات يومياً
 * - تحديث الأيام المتبقية في Firebase
 * - تحديث حالة الإضافات المنتهية
 * - إرسال إشعارات للاشتراكات المنتهية (3 أيام متتالية، ثم توقف 4 أيام، ثم تكرار)
 */

import { storage } from "./storage";
import { 
  notifySubscriptionExpired, 
  notifyOwnerSubscriptionExpired,
  notifyOwnerSubscriptionExpiringSoon,
  sendOwnerWhatsApp
} from "./integrations/whatsapp";
import { firebaseService } from "./firebaseService";
import { runAutoMatch } from "./autoMatchService";



/**
 * التحقق من أن اليوم يقع ضمن أيام الإرسال
 * النمط: 3 أيام إرسال، 3 أيام توقف، تكرار
 * أيام 1-3: إرسال | أيام 4-6: توقف | أيام 7-9: إرسال | أيام 10-12: توقف ...
 */
function shouldSendNotificationToday(daysSinceExpiry: number): boolean {
  if (daysSinceExpiry <= 0) return false;
  
  // حساب الموقع في الدورة (كل دورة 6 أيام)
  const positionInCycle = ((daysSinceExpiry - 1) % 6) + 1;
  
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
    const logs = await firebaseService.getWhatsAppLogs();
    const todayStr = new Date().toISOString().split('T')[0];
    
    for (const log of logs) {
      const propertyNumber = log.propertyNumber || "";
      const notificationType = log.type || "";
      const createdAt = log.createdAt || "";
      
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
              // إشعار للأدمن
              const result = await notifySubscriptionExpired({
                propertyNumber: sub.propertyNumber,
                propertyName: property.name || "",
                ownerPhone: property.whatsappNumber || "",
              });
              
              // إشعار للمالك عبر Enjazatik (بنمط 3/3 مثل الأدمين)
              if (property.whatsappNumber) {
                try {
                  // إرسال للمالك
                  await notifyOwnerSubscriptionExpired({
                    ownerPhone: property.whatsappNumber,
                    propertyNumber: sub.propertyNumber,
                    propertyName: property.name || "",
                  });
                  console.log(`📱 [Scheduler] تم إرسال إشعار للمالك - انتهاء اشتراك: ${sub.propertyNumber}`);
                } catch (ownerErr) {
                  console.error(`❌ [Scheduler] فشل إرسال إشعار المالك لـ ${sub.propertyNumber}:`, ownerErr);
                }
              }
              
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
        } else if (remainingDays === 3) {
          // إشعار للمالك قبل 3 أيام من انتهاء الاشتراك
          expiringSoon++;
          const property = properties.find(p => p.propertyNumber === sub.propertyNumber);
          if (property && property.whatsappNumber) {
            try {
              // إرسال للمالك
              await notifyOwnerSubscriptionExpiringSoon({
                ownerPhone: property.whatsappNumber,
                propertyNumber: sub.propertyNumber,
                propertyName: property.name || "",
                daysLeft: 3,
              });
              console.log(`📱 [Scheduler] تم إرسال تنبيه للمالك - 3 أيام متبقية: ${sub.propertyNumber}`);
            } catch (err) {
              console.error(`❌ [Scheduler] فشل إرسال تنبيه المالك لـ ${sub.propertyNumber}:`, err);
            }
          }
        } else if (remainingDays >= 0 && remainingDays <= 7 && remainingDays !== 3) {
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
    
    // =====================
    // تحديث حالة الإضافات المنتهية
    // =====================
    let expiredAddons = 0;
    try {
      expiredAddons = await firebaseService.updateExpiredAddOns();
      console.log(`📦 [Scheduler] تم تحديث ${expiredAddons} إضافة منتهية`);
    } catch (addOnError) {
      console.error("❌ [Scheduler] خطأ في تحديث الإضافات:", addOnError);
    }
    
    // =====================
    // إلغاء الدفعات المعلقة المنتهية الصلاحية
    // =====================
    let expiredPayments = 0;
    try {
      expiredPayments = await expireOldPendingPayments();
      console.log(`💳 [Scheduler] تم إلغاء ${expiredPayments} دفعة منتهية الصلاحية`);
    } catch (paymentError) {
      console.error("❌ [Scheduler] خطأ في إلغاء الدفعات المعلقة:", paymentError);
    }
    
    return { updated, expired, expiringSoon, notificationsSent, expiredAddons, expiredPayments };
  } catch (error) {
    console.error("❌ [Scheduler] خطأ في تحديث الأيام المتبقية:", error);
    throw error;
  }
}

/**
 * إلغاء الدفعات المعلقة المنتهية الصلاحية
 * - البطاقة: 30 دقيقة بدون webhook = ملغي
 * - التحويل البنكي: 72 ساعة بدون موافقة = منتهي الصلاحية
 * - يتم التحكم بها عبر FEATURE_TIMEOUTS
 */
async function expireOldPendingPayments(): Promise<number> {
  try {
    // التحقق من حالة FEATURE_TIMEOUTS
    const isTimeoutsEnabled = await firebaseService.getFeatureFlag("FEATURE_TIMEOUTS");
    if (!isTimeoutsEnabled) {
      console.log("⏸️ [Scheduler] ميزة المهلات الزمنية معطلة (FEATURE_TIMEOUTS)");
      return 0;
    }
    
    const payments = await firebaseService.getPayments();
    const now = Date.now();
    let expiredCount = 0;
    
    // المهلة الزمنية
    const CARD_TIMEOUT_MS = 30 * 60 * 1000; // 30 دقيقة للبطاقات
    const BANK_TIMEOUT_MS = 72 * 60 * 60 * 1000; // 72 ساعة للتحويل البنكي
    
    for (const payment of payments) {
      const paymentDate = new Date(payment.createdAt || "").getTime();
      const ageMs = now - paymentDate;
      
      // البطاقة: قيد المراجعة لأكثر من 30 دقيقة
      if (payment.status === "قيد المراجعة" && 
          (payment.paymentMethod === "بطاقة" || payment.paymentMethod === "Apple Pay" || payment.paymentMethod === "paymob") &&
          ageMs > CARD_TIMEOUT_MS) {
        await firebaseService.updatePaymentStatus(payment.id, "ملغي - انتهت المهلة");
        console.log(`⏰ [Scheduler] إلغاء دفعة بطاقة منتهية: ${payment.id}`);
        expiredCount++;
      }
      
      // التحويل البنكي: قيد التحقق لأكثر من 72 ساعة
      if (payment.status === "قيد التحقق" && 
          payment.paymentMethod === "تحويل بنكي" &&
          ageMs > BANK_TIMEOUT_MS) {
        await firebaseService.updatePaymentStatus(payment.id, "منتهي الصلاحية");
        console.log(`⏰ [Scheduler] انتهاء صلاحية تحويل بنكي: ${payment.id}`);
        expiredCount++;
      }
    }
    
    return expiredCount;
  } catch (error) {
    console.error("❌ [Scheduler] خطأ في التحقق من الدفعات المعلقة:", error);
    return 0;
  }
}

// حساب الوقت التالي للساعة 12 ظهراً بتوقيت السعودية (UTC+3)
function getNextNoonTime(): { nextNoon: Date; delayMs: number } {
  const now = new Date();
  
  // تحويل الوقت الحالي إلى توقيت السعودية (UTC+3)
  const saudiTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }));
  
  // إنشاء وقت الظهيرة (12:00) لليوم الحالي بتوقيت السعودية
  const nextNoon = new Date(saudiTime);
  nextNoon.setHours(12, 0, 0, 0);
  
  // إذا مضى وقت الظهيرة اليوم، انتقل إلى غداً
  if (saudiTime >= nextNoon) {
    nextNoon.setDate(nextNoon.getDate() + 1);
  }
  
  // حساب الفرق بالميلي ثانية
  const delayMs = nextNoon.getTime() - saudiTime.getTime();
  
  return { nextNoon, delayMs };
}

// تشغيل المهام المجدولة
export function startScheduler() {
  console.log("🕐 [Scheduler] بدء تشغيل المهام المجدولة...");
  
  const { nextNoon, delayMs } = getNextNoonTime();
  const hoursUntilNoon = (delayMs / (1000 * 60 * 60)).toFixed(2);
  
  console.log(`⏰ [Scheduler] وقت التنفيذ المقبل: 12:00 ظهراً بتوقيت السعودية`);
  console.log(`⏳ [Scheduler] سيتم التحديث بعد ${hoursUntilNoon} ساعة`);
  console.log(`📅 [Scheduler] التاريخ والوقت: ${nextNoon.toLocaleString('en-US', { timeZone: 'Asia/Riyadh' })}`);
  
  // جدولة التحديث الأول للساعة 12 ظهراً
  setTimeout(() => {
    console.log(`🕐 [Scheduler] تشغيل التحديث اليومي في الموعد المحدد`);
    updateRemainingDaysInSheet().catch(console.error);
    
    // بعد التحديث الأول، جدول التحديثات المتكررة كل 24 ساعة
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    setInterval(() => {
      const now = new Date();
      console.log(`🕐 [Scheduler] تشغيل التحديث اليومي - ${now.toLocaleString('en-US', { timeZone: 'Asia/Riyadh' })}`);
      updateRemainingDaysInSheet().catch(console.error);
    }, TWENTY_FOUR_HOURS);
  }, delayMs);
  
  console.log("✅ [Scheduler] المهام المجدولة تعمل - تحديث يومي الساعة 12 ظهراً");
  console.log("📋 [Scheduler] يتم التحقق من إشعارات اليوم من Firebase لمنع التكرار");
  
  // تشغيل المطابقة التلقائية والتحقق من المهلات كل 15 دقيقة
  const FIFTEEN_MINUTES = 15 * 60 * 1000;
  setInterval(async () => {
    console.log("🔄 [Scheduler] تشغيل فحص الدفعات...");
    
    // التحقق من المهلات الزمنية
    const expiredCount = await expireOldPendingPayments();
    if (expiredCount > 0) {
      console.log(`⏰ [Scheduler] تم إلغاء/انتهاء ${expiredCount} دفعة`);
    }
    
    // تشغيل المطابقة التلقائية
    try {
      await runAutoMatch();
    } catch (error) {
      console.error("❌ [Scheduler] خطأ في المطابقة التلقائية:", error);
    }
  }, FIFTEEN_MINUTES);
  
  console.log("🔄 [Scheduler] فحص الدفعات كل 15 دقيقة");

  // تشغيل فحص تخفيض الاشتراكات المنتهية كل 30 دقيقة
  const THIRTY_MINUTES = 30 * 60 * 1000;
  setInterval(() => {
    console.log("⬇️ [Scheduler] فحص الاشتراكات المنتهية...");
    downgradeExpiredSubscriptions().catch(console.error);
  }, THIRTY_MINUTES);

  // تشغيل فوري عند البدء
  setTimeout(() => {
    downgradeExpiredSubscriptions().catch(console.error);
  }, 5000);

  console.log("⬇️ [Scheduler] فحص تخفيض الاشتراكات كل 30 دقيقة");
}

// خفض الاشتراكات المنتهية من مميز إلى عادي
// Group-aware: when a main property's subscription expires/cancels, all linked properties
// follow the same state (same endDate, same downgrade) so parent + children never drift.
async function downgradeExpiredSubscriptions(): Promise<number> {
  try {
    const subscriptions = await firebaseService.getSubscriptions();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let downgraded = 0;
    const processed = new Set<string>();

    for (const sub of subscriptions) {
      if (processed.has(sub.propertyNumber)) continue;

      const isPremiumType = sub.subscriptionType === "مميز";
      if (!isPremiumType) continue;

      // Case 1: Subscription was manually cancelled
      const isCancelled = sub.status === "منتهي" || (sub as any).cancelledAt;

      // Case 2: End date has passed
      let isDateExpired = false;
      if (sub.endDate) {
        const endDate = new Date(sub.endDate);
        endDate.setHours(0, 0, 0, 0);
        isDateExpired = endDate < today;
      }

      if (isCancelled || isDateExpired) {
        // Downgrade the main property
        await firebaseService.updateSubscription(sub.id, { subscriptionType: "عادي" });
        await firebaseService.updateProperty(sub.propertyNumber, { subscriptionType: "عادي" });
        console.log(`⬇️ [Scheduler] تم تخفيض اشتراك ${sub.propertyNumber} من ${sub.subscriptionType} إلى عادي (${isCancelled ? 'ملغى' : 'منتهي التاريخ'})`);
        downgraded++;
        processed.add(sub.propertyNumber);

        // Cascade to ALL linked properties — they share the main's endDate and must
        // downgrade together so the group stays consistent.
        const linkedProps: string[] = sub.linkedProperties || [];
        for (const childNum of linkedProps) {
          if (childNum === sub.propertyNumber || processed.has(childNum)) continue;
          const childSub = await firebaseService.getSubscriptionByPropertyNumber(childNum);
          if (childSub && childSub.subscriptionType === "مميز") {
            await firebaseService.updateSubscription(childSub.id, {
              subscriptionType: "عادي",
              status: isCancelled ? "منتهي" : childSub.status,
              endDate: sub.endDate,
            });
            await firebaseService.updateProperty(childNum, { subscriptionType: "عادي" });
            console.log(`⬇️ [Scheduler] تم تخفيض العقار المرتبط ${childNum} تبعاً للعقار الرئيسي ${sub.propertyNumber}`);
            downgraded++;
          }
          processed.add(childNum);
        }
      }
    }

    if (downgraded > 0) {
      console.log(`⬇️ [Scheduler] تم تخفيض ${downgraded} اشتراك منتهي`);
    }
    return downgraded;
  } catch (error) {
    console.error("❌ [Scheduler] خطأ في تخفيض الاشتراكات:", error);
    return 0;
  }
}

// تصدير الدوال للاستخدام اليدوي (API endpoint)
export { updateRemainingDaysInSheet, expireOldPendingPayments, downgradeExpiredSubscriptions };
