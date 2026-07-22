import { Router } from "express";
import { requireAdmin } from "../middleware";
import { analyticsService, propertyService, subscriptionService, paymentService, addOnService } from "../../services";
import { firebaseService } from "../../firebaseService";
import { updateRemainingDaysInSheet } from "../../scheduler";
import { isPremiumSubscriptionType } from "../../../shared/subscriptionType";
import { buildContactAnalytics } from "../../services/contactAnalytics";

const router = Router();

// المسؤول: جلب الطلبات
router.get("/api/admin/requests", requireAdmin, async (req, res) => {
  try {
    const allRequests = await analyticsService.getAllRequests();
    const totalProps = await propertyService.getAll();
    res.json({
      recentRequests: allRequests.slice(-100), // آخر 100 طلب
      totalRequests: allRequests.length,
      totalProperties: totalProps.length,
    });
  } catch (err) {
    res.status(500).json({ error: "فشل في جلب الطلبات" });
  }
});

router.get("/api/admin/contact-analytics", requireAdmin, async (req, res) => {
  try {
    const requestedRange = String(req.query.days || "30");
    const days = requestedRange === "all" ? null : Number(requestedRange);
    if (days !== null && ![7, 30, 90, 365].includes(days)) {
      return res.status(400).json({ error: "الفترة المطلوبة غير صالحة" });
    }

    const [contactEvents, requests, properties] = await Promise.all([
      analyticsService.getContactEvents(),
      analyticsService.getAllRequests(),
      propertyService.getAll(),
    ]);

    return res.json(buildContactAnalytics({
      contactEvents,
      requests,
      properties,
      days,
    }));
  } catch (error) {
    console.error("Contact analytics error:", error);
    return res.status(500).json({ error: "فشل في جلب تحليلات التواصل" });
  }
});

// المسؤول: جلب تفاصيل الزوار الفرديين
router.get("/api/admin/visitors", requireAdmin, async (req, res) => {
  try {
    const allRequests = await analyticsService.getAllRequests();
    const totalProps = await propertyService.getAll();

    const visitors = allRequests
      .slice(-100) // آخر 100 زائر
      .reverse()
      .map(req => {
        const prop = totalProps.find(p => p.propertyNumber === req.propertyNumber);
        return {
          propertyNumber: req.propertyNumber,
          propertyName: prop?.name || `عقار ${req.propertyNumber}`,
          requestCode: req.requestCode,
          deviceType: req.deviceType || 'desktop',
          ipAddress: req.ipAddress,
          timestamp: req.timestamp,
          dayOfWeek: req.dayOfWeek,
          hourOfDay: req.hourOfDay,
        };
      });

    res.json({ visitors });
  } catch (err: any) {
    console.error("Visitors error:", err);
    res.status(500).json({ error: "فشل في جلب بيانات الزوار" });
  }
});

// =====================================
// 📅 تحديث الأيام المتبقية يدوياً
// =====================================
router.post("/api/admin/update-remaining-days", requireAdmin, async (req, res) => {
  try {
    const result = await updateRemainingDaysInSheet();
    res.json({
      success: true,
      message: "تم تحديث الأيام المتبقية بنجاح",
      ...result
    });
  } catch (error) {
    console.error("❌ [API] خطأ في تحديث الأيام المتبقية:", error);
    res.status(500).json({ error: "فشل في تحديث الأيام المتبقية" });
  }
});

// =====================================
// 🧪 اختبار إشعارات الاشتراكات المنتهية
// =====================================
router.post("/api/admin/test-expired-notifications", requireAdmin, async (req, res) => {
  try {

    const subscriptions = await subscriptionService.getAll();
    const properties = await propertyService.getAll();

    // البحث عن اشتراكات منتهية
    const expiredSubscriptions = subscriptions.filter(sub => {
      if (!sub.endDate) return false;
      const endDate = new Date(sub.endDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      endDate.setHours(0, 0, 0, 0);
      return endDate < today;
    });


    const notifications = [];

    // إرسال إشعار لكل اشتراك منتهي
    for (const sub of expiredSubscriptions.slice(0, 5)) { // حد أقصى 5 إشعارات للاختبار
      const property = properties.find(p => p.propertyNumber === sub.propertyNumber);

      if (property) {

        try {
          const { notifySubscriptionExpired } = await import("../../integrations/whatsapp");
          const result = await notifySubscriptionExpired({
            propertyNumber: sub.propertyNumber,
            propertyName: property.name || "",
            ownerPhone: property.whatsappNumber || "",
          });

          notifications.push({
            propertyNumber: sub.propertyNumber,
            propertyName: property.name,
            endDate: sub.endDate,
            status: result.status,
            response: result.response,
          });

        } catch (err: any) {
          console.error(`❌ [TEST] خطأ في إرسال الإشعار:`, err);
          notifications.push({
            propertyNumber: sub.propertyNumber,
            propertyName: property.name,
            endDate: sub.endDate,
            status: "error",
            response: err.message,
          });
        }
      }
    }

    res.json({
      success: true,
      message: `تم اختبار ${notifications.length} إشعار من أصل ${expiredSubscriptions.length} اشتراك منتهي`,
      totalExpired: expiredSubscriptions.length,
      notificationsSent: notifications.length,
      notifications,
    });
  } catch (error: any) {
    console.error("❌ [TEST] خطأ في اختبار الإشعارات:", error);
    res.status(500).json({ error: error.message || "فشل في اختبار الإشعارات" });
  }
});

// المسؤول: جلب الإحصائيات - حساب الـ IPs الفريدة فقط
router.get("/api/admin/analytics", requireAdmin, async (req, res) => {
  try {
    const allRequests = await analyticsService.getAllRequests();
    const totalProps = await propertyService.getAll();

    // ===== حساب الـ IPs الفريدة فقط =====
    // Map لتجميع الـ IPs الفريدة لكل عقار
    const uniqueIPMap: Record<string, { ipAddress: string; deviceType: 'mobile' | 'desktop' | 'tablet' }> = {};

    allRequests.forEach(r => {
      const key = `${r.propertyNumber}:${r.ipAddress}`;
      if (!uniqueIPMap[key]) {
        uniqueIPMap[key] = {
          ipAddress: r.ipAddress,
          deviceType: r.deviceType || 'desktop',
        };
      }
    });

    const uniqueRequests = Object.values(uniqueIPMap);

    // 1. إجمالي الزوار الفريدين (حسب IP - كل IP مرة واحدة)
    const visitors = uniqueRequests.length;

    // 2. توزيع الأجهزة الفريدة (كل IP يُحسب مرة واحدة فقط)
    const devices = { mobile: 0, desktop: 0, tablet: 0 };
    uniqueRequests.forEach(r => {
      if (r.deviceType === 'mobile') devices.mobile++;
      else if (r.deviceType === 'tablet') devices.tablet++;
      else devices.desktop++;
    });

    // 3. توزيع المدن (حسب الـ IPs الفريدة)
    const cityIPMap: Record<string, Set<string>> = {};
    allRequests.forEach(r => {
      const prop = totalProps.find(p => p.propertyNumber === r.propertyNumber);
      const city = prop?.city || 'غير محدد';

      if (!cityIPMap[city]) {
        cityIPMap[city] = new Set();
      }
      cityIPMap[city].add(r.ipAddress);
    });

    const cities = Object.entries(cityIPMap)
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 10)
      .map(([name, ips]) => ({ name, count: ips.size }));

    // 4. توزيع حسب العقارات (حسب الـ IPs الفريدة لكل عقار)
    const propertyIPMap: Record<string, Set<string>> = {};
    allRequests.forEach(r => {
      if (!propertyIPMap[r.propertyNumber]) {
        propertyIPMap[r.propertyNumber] = new Set();
      }
      propertyIPMap[r.propertyNumber].add(r.ipAddress);
    });

    const sortedProperties = Object.entries(propertyIPMap)
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 15)
      .map(([propertyNumber, ips]) => {
        const prop = totalProps.find(p => p.propertyNumber === propertyNumber);
        return {
          propertyNumber,
          propertyName: prop?.name || `عقار ${propertyNumber}`,
          requestCount: ips.size, // عدد الـ IPs الفريدة
        };
      });

    // 5. آخر الطلبات
    const recentRequests = allRequests.slice(-20).reverse();

    // 6. آخر تحديث
    const lastUpdated = new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' });

    const uniqueIPs = new Set(allRequests.map(r => r.ipAddress));

    res.json({
      visitors, // الـ IPs الفريدة الكلية
      devices,
      cities,
      byProperty: sortedProperties,
      recentRequests,
      totalRequests: allRequests.length,
      totalProperties: totalProps.length,
      uniqueVisitors: uniqueIPs.size,
      lastUpdated,
    });
  } catch (err: any) {
    console.error("Analytics error:", err);
    res.status(500).json({ error: "فشل في جلب الإحصائيات" });
  }
});

// ======================
// نظام التنبيهات الذكية
// ======================
router.get("/api/admin/alerts", requireAdmin, async (req, res) => {
  try {
    const alerts: Array<{
      type: 'warning' | 'danger' | 'info' | 'success';
      category: string;
      title: string;
      message: string;
      count?: number;
      items?: any[];
      icon?: string;
    }> = [];

    // استخدام توقيت الرياض (UTC+3)
    const nowRiyadh = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' }));
    const todayStart = new Date(nowRiyadh.getFullYear(), nowRiyadh.getMonth(), nowRiyadh.getDate());
    const sevenDaysAgo = new Date(nowRiyadh.getTime() - 7 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(nowRiyadh.getTime() - 24 * 60 * 60 * 1000);
    const now = nowRiyadh;


    // جلب جميع البيانات
    const [subscriptions, payments, allRequests, properties, suggestions] = await Promise.all([
      subscriptionService.getAll(),
      paymentService.getAll(),
      analyticsService.getAllRequests(),
      propertyService.getAll(),
      firebaseService.getSuggestions()
    ]);

    // 1. عقارات جديدة اليوم (تاريخ الإنشاء - createdAt)
    const newPropertiesToday = properties.filter(p => {
      if (!p.createdAt) return false;
      const created = new Date(p.createdAt || "");
      if (isNaN(created.getTime())) return false;
      return created >= todayStart;
    });
    if (newPropertiesToday.length > 0) {
      alerts.push({
        type: 'success',
        category: 'new-properties',
        title: 'عقارات جديدة اليوم',
        message: `${newPropertiesToday.length} عقار تم تسجيله اليوم`,
        count: newPropertiesToday.length,
        icon: 'home-plus',
        items: newPropertiesToday.map(p => ({
          propertyNumber: p.propertyNumber,
          name: p.name,
          city: p.city,
          createdAt: p.createdAt
        }))
      });
    }

    // 2. تحديثات العقارات (تاريخ التحديث - updatedAt خلال 24 ساعة)
    // ملاحظة: يجب أن يكون التحديث مختلف عن تاريخ الإنشاء
    const updatedProperties = properties.filter(p => {
      if (!p.updatedAt) return false;
      const updated = new Date(p.updatedAt || "");
      if (isNaN(updated.getTime())) return false;
      // تأكد أن التحديث خلال 24 ساعة
      if (updated < oneDayAgo) return false;
      // تأكد أن التحديث ليس نفس تاريخ الإنشاء (عقار جديد)
      if (p.createdAt) {
        const created = new Date(p.createdAt || "");
        // إذا كان الفرق أقل من دقيقة، فهو عقار جديد وليس تحديث
        if (Math.abs(updated.getTime() - created.getTime()) < 60000) return false;
      }
      return true;
    });
    if (updatedProperties.length > 0) {
      alerts.push({
        type: 'info',
        category: 'property-updates',
        title: 'تحديثات العقارات',
        message: `${updatedProperties.length} عقار تم تحديثه خلال 24 ساعة`,
        count: updatedProperties.length,
        icon: 'edit',
        items: updatedProperties.map(p => ({
          propertyNumber: p.propertyNumber,
          name: p.name,
          city: p.city,
          updatedAt: p.updatedAt,
          lastChanges: (p as any).lastChanges || ''
        }))
      });
    }

    // 3. اشتراكات جديدة اليوم - نعتمد على المدفوعات المكتملة اليوم
    // لأن جدول الاشتراكات قد لا يحتوي على تاريخ البدء الصحيح
    const todayCompletedPayments = payments.filter(p => {
      if (!p.createdAt) return false;
      const payDate = new Date(p.createdAt || "");
      if (isNaN(payDate.getTime())) return false;
      // المدفوعات المكتملة أو قيد التحقق اليوم
      const isToday = payDate >= todayStart && payDate <= nowRiyadh;
      const isCompleted = p.status === 'مكتمل' || p.status === 'نجح - قيد التحقق' || p.status === 'completed';
      return isToday && isCompleted;
    });

    // تحويل المدفوعات إلى اشتراكات جديدة
    const todaySubscriptionNumbers = [...new Set(todayCompletedPayments.map(p => p.propertyNumber))];
    const todaySubscriptions = todaySubscriptionNumbers.map(propNum => {
      const payment = todayCompletedPayments.find(p => p.propertyNumber === propNum);
      const prop = properties.find(p => p.propertyNumber === propNum);
      const sub = subscriptions.find(s => s.propertyNumber === propNum);
      return {
        propertyNumber: propNum,
        name: prop?.name || 'غير معروف',
        city: prop?.city || '',
        packageId: payment?.packageId || sub?.packageId || '',
        type: (sub as any)?.subscriptionType || 'مميز',
        startDate: payment?.createdAt || new Date().toISOString()
      };
    });

    if (todaySubscriptions.length > 0) {
      alerts.push({
        type: 'success',
        category: 'new-subscriptions',
        title: 'اشتراكات جديدة اليوم',
        message: `${todaySubscriptions.length} عقار بدأ اشتراكه اليوم`,
        count: todaySubscriptions.length,
        icon: 'calendar-check',
        items: todaySubscriptions
      });
    }

    // 2. مدفوعات جديدة اليوم
    const todayPayments = payments.filter(p => {
      if (!p.createdAt) return false;
      const payDate = new Date(p.createdAt || "");
      return payDate >= todayStart;
    });
    if (todayPayments.length > 0) {
      const totalAmount = todayPayments.reduce((sum, p) => sum + (p.finalAmount || p.amount || 0), 0);
      alerts.push({
        type: 'success',
        category: 'new-payments',
        title: 'مدفوعات اليوم',
        message: `${todayPayments.length} دفعة جديدة بإجمالي ${totalAmount} ر.س`,
        count: todayPayments.length,
        icon: 'credit-card',
        items: todayPayments.map(p => {
          const prop = properties.find(pr => pr.propertyNumber === p.propertyNumber);
          return {
            propertyNumber: p.propertyNumber,
            name: prop?.name || '',
            amount: p.finalAmount || p.amount,
            method: p.paymentMethod,
            status: p.status
          };
        })
      });
    }

    // 3. المدفوعات المعلقة (تحتاج موافقة) - تشمل pending و معلق و قيد المراجعة
    const pendingPayments = payments.filter(p =>
      p.status === 'pending' || p.status === 'معلق' || p.status === 'قيد المراجعة' || p.status === 'نجح - قيد التحقق'
    );
    if (pendingPayments.length > 0) {
      alerts.push({
        type: 'danger',
        category: 'pending-payments',
        title: 'مدفوعات تنتظر الموافقة',
        message: `${pendingPayments.length} دفعة معلقة تحتاج مراجعة عاجلة`,
        count: pendingPayments.length,
        icon: 'alert-circle',
        items: pendingPayments.map(p => {
          const prop = properties.find(pr => pr.propertyNumber === p.propertyNumber);
          return {
            propertyNumber: p.propertyNumber,
            name: prop?.name || '',
            amount: p.finalAmount || p.amount,
            method: p.paymentMethod,
            createdAt: p.createdAt
          };
        })
      });
    }

    // 4. اقتراحات جديدة (غير مقروءة)
    if (suggestions.length > 0) {
      console.log(`📝 [Alerts] Suggestion statuses:`, suggestions.map(s => s.status));
    }
    const pendingSuggestions = suggestions.filter(s =>
      s.status === 'pending' || s.status === 'معلق' || s.status === 'جديد' || !s.status
    );
    if (pendingSuggestions.length > 0) {
      alerts.push({
        type: 'info',
        category: 'suggestions',
        title: 'اقتراحات جديدة',
        message: `${pendingSuggestions.length} اقتراح ينتظر المراجعة`,
        count: pendingSuggestions.length,
        icon: 'lightbulb',
        items: pendingSuggestions.map(s => ({
          name: s.name,
          mobile: (s as any).phone || (s as any).mobile || '',
          city: s.city,
          suggestion: s.suggestion?.substring(0, 50) + '...'
        }))
      });
    }

    // 5. طلبات واتساب اليوم
    const todayRequests = allRequests.filter(r => {
      const reqDate = new Date(r.timestamp || "");
      return reqDate >= todayStart;
    });
    if (todayRequests.length > 0) {
      alerts.push({
        type: 'info',
        category: 'requests',
        title: 'طلبات واتساب اليوم',
        message: `${todayRequests.length} طلب واتساب جديد`,
        count: todayRequests.length,
        icon: 'message-circle',
        items: todayRequests.map(r => {
          const prop = properties.find(pr => pr.propertyNumber === r.propertyNumber);
          return {
            propertyNumber: r.propertyNumber,
            name: prop?.name || '',
            requestCode: r.requestCode,
            timestamp: r.timestamp
          };
        })
      });
    }

    // 5.1 إشعارات واتساب (جميع الطلبات - للعرض في لوحة التحكم)
    const recentRequests = allRequests.filter(r => {
      const reqDate = new Date(r.timestamp || "");
      return reqDate >= sevenDaysAgo;
    });
    if (recentRequests.length > 0) {
      alerts.push({
        type: 'info',
        category: 'whatsapp-notifications',
        title: 'إشعارات واتساب',
        message: `${recentRequests.length} طلب واتساب خلالآخر 7 أيام`,
        count: recentRequests.length,
        icon: 'message-circle',
        items: recentRequests.slice(0, 10).map(r => {
          const prop = properties.find(pr => pr.propertyNumber === r.propertyNumber);
          return {
            propertyNumber: r.propertyNumber,
            name: prop?.name || '',
            requestCode: r.requestCode,
            timestamp: r.timestamp
          };
        })
      });
    }

    // 6. اشتراكات ستنتهي خلال 7 أيام
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const expiringSoon = subscriptions.filter(sub => {
      if (sub.status !== 'active') return false;
      const endDate = new Date(sub.endDate || "");
      return endDate > now && endDate <= sevenDaysLater;
    });
    if (expiringSoon.length > 0) {
      alerts.push({
        type: 'warning',
        category: 'expiring-subscriptions',
        title: 'اشتراكات ستنتهي قريباً',
        message: `${expiringSoon.length} اشتراك سينتهي خلال 7 أيام`,
        count: expiringSoon.length,
        icon: 'clock',
        items: expiringSoon.map(s => {
          const prop = properties.find(pr => pr.propertyNumber === s.propertyNumber);
          return {
            propertyNumber: s.propertyNumber,
            name: prop?.name || '',
            endDate: s.endDate,
            daysLeft: Math.ceil((new Date(s.endDate || "").getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
          };
        })
      });
    }

    // 7. اشتراكات منتهية حديثاً
    const recentlyExpired = subscriptions.filter(sub => {
      if (sub.status !== 'expired') return false;
      const endDate = new Date(sub.endDate || "");
      return endDate >= sevenDaysAgo && endDate < now;
    });
    if (recentlyExpired.length > 0) {
      alerts.push({
        type: 'danger',
        category: 'expired-subscriptions',
        title: 'اشتراكات منتهية',
        message: `${recentlyExpired.length} اشتراك انتهى ويحتاج تجديد`,
        count: recentlyExpired.length,
        icon: 'x-circle',
        items: recentlyExpired.map(s => {
          const prop = properties.find(pr => pr.propertyNumber === s.propertyNumber);
          return {
            propertyNumber: s.propertyNumber,
            name: prop?.name || '',
            endDate: s.endDate,
            type: 'عادي'
          };
        })
      });
    }

    // 8. تم نقله للقسم 2 (تحديثات العقارات)

    // 9. إضافات معلقة تحتاج موافقة
    let pendingAddons: any[] = [];
    let todayAddons: any[] = [];
    try {
      const allPropertyAddons = await firebaseService.getAllPropertyAddOns();
      pendingAddons = allPropertyAddons.filter((addon: any) =>
        addon.status === 'pending' || addon.status === 'معلق'
      );
      todayAddons = allPropertyAddons.filter((addon: any) => {
        if (!addon.createdAt) return false;
        const createdDate = new Date(addon.createdAt || "");
        if (isNaN(createdDate.getTime())) return false;
        return createdDate >= todayStart;
      });

      if (pendingAddons.length > 0) {
        alerts.push({
          type: 'danger',
          category: 'pending-addons',
          title: 'إضافات تنتظر الموافقة',
          message: `${pendingAddons.length} طلب إضافة معلق يحتاج مراجعة`,
          count: pendingAddons.length,
          icon: 'package',
          items: pendingAddons.map((addon: any) => {
            const prop = properties.find(p => p.propertyNumber === addon.propertyNumber);
            return {
              propertyNumber: addon.propertyNumber,
              name: prop?.name || '',
              addOnPackageId: addon.addOnPackageId,
              createdAt: addon.createdAt
            };
          })
        });
      }

      if (todayAddons.length > 0) {
        alerts.push({
          type: 'success',
          category: 'new-addons',
          title: 'إضافات جديدة اليوم',
          message: `${todayAddons.length} طلب إضافة جديد اليوم`,
          count: todayAddons.length,
          icon: 'package-plus',
          items: todayAddons.map((addon: any) => {
            const prop = properties.find(p => p.propertyNumber === addon.propertyNumber);
            return {
              propertyNumber: addon.propertyNumber,
              name: prop?.name || '',
              addOnPackageId: addon.addOnPackageId,
              status: addon.status,
              createdAt: addon.createdAt
            };
          })
        });
      }
    } catch (addonErr) {
      console.error("Error fetching addons for alerts:", addonErr);
    }

    // حساب الإحصائيات - دعم القيم العربية والإنجليزية
    const activeSubscriptions = subscriptions.filter(s =>
      s.status === 'active' || s.status === 'نشط'
    ).length;
    const expiredSubscriptions = subscriptions.filter(s =>
      s.status === 'expired' || s.status === 'منتهي'
    ).length;
    const trustedProperties = properties.filter(p =>
      isPremiumSubscriptionType(p.subscriptionType)
    ).length;
    const normalProperties = properties.filter(p =>
      !isPremiumSubscriptionType(p.subscriptionType)
    ).length;

    // مدفوعات اليوم المكتملة فقط للإحصائيات (تتصفر نهاية اليوم)
    const todayCompletedPaymentsStats = payments.filter(p => {
      const payDate = new Date(p.createdAt || "");
      return payDate >= todayStart && (p.status === 'مكتمل' || p.status === 'completed');
    });

    // اشتراكات اليوم المكتملة (بناءً على المدفوعات المكتملة اليوم)
    // هذا يعكس نفس المنطق المستخدم في todaySubscriptions للتنبيهات
    const todayCompletedSubscriptionsStats = payments.filter(p => {
      const payDate = new Date(p.createdAt || "");
      return payDate >= todayStart && (p.status === 'مكتمل' || p.status === 'completed' || p.status === 'نجح - قيد التحقق');
    });

    // إجمالي مدفوعات اليوم المكتملة
    const todayRevenue = todayCompletedPaymentsStats.reduce((sum, p) => sum + (p.finalAmount || p.amount || 0), 0);

    // عرض جميع القيم الفريدة
    const uniqueTypes = [...new Set(properties.map(p => p.subscriptionType))];
    const uniqueStatuses = [...new Set(subscriptions.map(s => s.status))];

    // إحصائيات الأسبوع (مكتملة فقط)
    const weekPayments = payments.filter(p => {
      const payDate = new Date(p.createdAt || "");
      return payDate >= sevenDaysAgo && (p.status === 'مكتمل' || p.status === 'completed');
    });
    const weekRequests = allRequests.filter(r => {
      const reqDate = new Date(r.timestamp || "");
      return reqDate >= sevenDaysAgo;
    });
    const weekRevenue = weekPayments
      .reduce((sum, p) => sum + (p.finalAmount || p.amount || 0), 0);

    // حساب عدد التنبيهات المهمة
    const criticalCount = alerts.filter(a => a.type === 'danger').reduce((sum, a) => sum + (a.count || 0), 0);
    const warningCount = alerts.filter(a => a.type === 'warning').reduce((sum, a) => sum + (a.count || 0), 0);

    res.json({
      alerts,
      stats: {
        totalProperties: properties.length,
        trustedProperties,
        normalProperties,
        activeSubscriptions,
        expiredSubscriptions,
        pendingPayments: pendingPayments.length,
        todayRequests: todayRequests.length,
        todayPayments: todayPayments.length,
        todayCompletedPayments: todayCompletedPaymentsStats.length,
        todayCompletedSubscriptions: todayCompletedSubscriptionsStats.length,
        todayRevenue,
        todayProperties: newPropertiesToday.length,
        todaySubscriptions: todaySubscriptions.length,
        propertyUpdates: updatedProperties.length,
        weekRequests: weekRequests.length,
        weekPayments: weekPayments.length,
        weekRevenue,
        pendingSuggestions: pendingSuggestions.length,
        pendingAddons: pendingAddons.length,
        todayAddons: todayAddons.length
      },
      summary: {
        totalAlerts: criticalCount + warningCount,
        criticalAlerts: criticalCount,
        warningAlerts: warningCount,
        lastUpdated: new Date().toLocaleString('en-US', { timeZone: 'Asia/Riyadh' })
      }
    });
  } catch (err: any) {
    console.error("Alerts error:", err);
    res.status(500).json({ error: "فشل في جلب التنبيهات" });
  }
});

export default router;
