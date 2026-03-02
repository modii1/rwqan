"use strict";
/**
 * دوال مساعدة للتعامل مع التواريخ
 *
 * القواعد:
 * - الخادم يعمل بتوقيت UTC
 * - جميع التواريخ تُخزن كـ epoch milliseconds
 * - لا تحويلات يدوية للتوقيت
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNow = getNow;
exports.getNowISO = getNowISO;
exports.getNowGMT3 = getNowGMT3;
exports.getNowInRiyadh = getNowInRiyadh;
exports.toGMT3ISO = toGMT3ISO;
exports.toRiyadhISO = toRiyadhISO;
exports.getTodayDateGMT3 = getTodayDateGMT3;
exports.getCurrentTimeGMT3 = getCurrentTimeGMT3;
exports.formatArabicDate = formatArabicDate;
exports.formatArabicDateTime = formatArabicDateTime;
exports.getStartOfDayRiyadh = getStartOfDayRiyadh;
exports.getEndOfDayRiyadh = getEndOfDayRiyadh;
exports.getStartOfMonthRiyadh = getStartOfMonthRiyadh;
exports.getEndOfMonthRiyadh = getEndOfMonthRiyadh;
exports.addDays = addDays;
exports.calculateSubscriptionEndDate = calculateSubscriptionEndDate;
exports.calculateExtensionEndDate = calculateExtensionEndDate;
exports.addMonths = addMonths;
exports.daysBetween = daysBetween;
exports.arabicToEnglishNumbers = arabicToEnglishNumbers;
exports.formatDateRiyadh = formatDateRiyadh;
exports.parseArabicDate = parseArabicDate;
/**
 * الحصول على الوقت الحالي كـ epoch milliseconds
 */
function getNow() {
    return Date.now();
}
/**
 * الحصول على الوقت الحالي كـ ISO string
 */
function getNowISO() {
    return new Date().toISOString();
}
/**
 * Alias للتوافق مع الكود القديم
 */
function getNowGMT3() {
    return new Date();
}
/**
 * Alias للتوافق مع الكود القديم
 */
function getNowInRiyadh() {
    return new Date();
}
/**
 * تحويل تاريخ إلى ISO string
 */
function toGMT3ISO(date) {
    return (date || new Date()).toISOString();
}
/**
 * Alias للتوافق مع الكود القديم
 */
function toRiyadhISO(date) {
    return toGMT3ISO(date);
}
/**
 * الحصول على تاريخ اليوم بتنسيق YYYY-MM-DD (UTC)
 */
function getTodayDateGMT3() {
    return new Date().toISOString().split('T')[0];
}
/**
 * الحصول على الوقت الحالي بتنسيق HH:MM AM/PM (توقيت الرياض للعرض)
 */
function getCurrentTimeGMT3() {
    return new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Riyadh',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}
/**
 * تحويل تاريخ إلى نص مقروء بالعربية (للعرض فقط)
 */
function formatArabicDate(date) {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Riyadh'
    });
}
/**
 * تحويل تاريخ إلى نص مقروء بالعربية مع الوقت (للعرض فقط)
 */
function formatArabicDateTime(date) {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Riyadh'
    });
}
/**
 * الحصول على بداية اليوم بتوقيت الرياض
 */
function getStartOfDayRiyadh(date) {
    const d = date || new Date();
    // نحسب بداية اليوم بتوقيت الرياض
    const riyadhStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
    return new Date(riyadhStr + 'T00:00:00+03:00');
}
/**
 * الحصول على نهاية اليوم بتوقيت الرياض
 */
function getEndOfDayRiyadh(date) {
    const d = date || new Date();
    const riyadhStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
    return new Date(riyadhStr + 'T23:59:59.999+03:00');
}
/**
 * الحصول على بداية الشهر بتوقيت الرياض
 */
function getStartOfMonthRiyadh(date) {
    const d = date || new Date();
    const riyadhStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
    const [year, month] = riyadhStr.split('-');
    return new Date(`${year}-${month}-01T00:00:00+03:00`);
}
/**
 * الحصول على نهاية الشهر بتوقيت الرياض
 */
function getEndOfMonthRiyadh(date) {
    const d = date || new Date();
    const riyadhStr = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
    const [year, month] = riyadhStr.split('-');
    const nextMonth = new Date(`${year}-${month}-01T00:00:00+03:00`);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(0);
    nextMonth.setHours(23, 59, 59, 999);
    return nextMonth;
}
/**
 * إضافة أيام إلى تاريخ
 */
function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}
/**
 * حساب تاريخ انتهاء الاشتراك بشكل موحد
 * القاعدة: الاشتراك يبدأ من بداية اليوم وينتهي في نهاية اليوم الأخير (23:59:59)
 * مثال: 30 يوم اشتراك = اليوم + 30 يوم كاملة
 *
 * @param startDate تاريخ البداية (إذا لم يحدد، يبدأ من اليوم)
 * @param durationDays عدد الأيام (مثلاً 30)
 * @returns تاريخ الانتهاء في نهاية اليوم الأخير
 */
function calculateSubscriptionEndDate(startDate, durationDays) {
    // بداية اليوم بتوقيت الرياض
    const start = startDate ? getStartOfDayRiyadh(startDate) : getStartOfDayRiyadh();
    // إضافة عدد الأيام (مثلاً 30)
    // القاعدة: يوم البداية يُحسب كيوم كامل
    // مثال: 30 يوم بدءاً من 7 يناير = ينتهي نهاية 5 فبراير
    // لكن لعرض 30 يوم في الواجهة، نضيف durationDays مباشرة
    const endDate = new Date(start);
    endDate.setDate(endDate.getDate() + durationDays);
    // نهاية اليوم الأخير
    endDate.setHours(23, 59, 59, 999);
    return endDate;
}
/**
 * حساب تاريخ انتهاء الاشتراك للتمديد
 * القاعدة: إذا كان الاشتراك الحالي نشط، يضاف من تاريخ انتهائه
 * وإلا يبدأ من اليوم
 */
function calculateExtensionEndDate(currentEndDate, durationDays) {
    const today = getStartOfDayRiyadh();
    if (currentEndDate) {
        const currentEnd = new Date(currentEndDate);
        // إذا كان الاشتراك الحالي لم ينتهي بعد، نضيف من تاريخ انتهائه
        if (currentEnd > today) {
            const newEnd = new Date(currentEnd);
            newEnd.setDate(newEnd.getDate() + durationDays);
            newEnd.setHours(23, 59, 59, 999);
            return newEnd;
        }
    }
    // إذا انتهى أو لا يوجد اشتراك، نبدأ من اليوم
    return calculateSubscriptionEndDate(null, durationDays);
}
/**
 * إضافة أشهر إلى تاريخ
 */
function addMonths(date, months) {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    return result;
}
/**
 * حساب الفرق بين تاريخين بالأيام
 */
function daysBetween(date1, date2) {
    const d1 = typeof date1 === 'string' ? new Date(date1) : date1;
    const d2 = typeof date2 === 'string' ? new Date(date2) : date2;
    const diffTime = Math.abs(d2.getTime() - d1.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}
/**
 * تحويل الأرقام العربية إلى إنجليزية
 * مثال: "٢٩‏/١٢‏/٢٠٢٥" -> "29/12/2025"
 */
function arabicToEnglishNumbers(str) {
    if (!str)
        return str;
    const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    let result = str;
    for (let i = 0; i < 10; i++) {
        result = result.replace(new RegExp(arabicNumerals[i], 'g'), String(i));
    }
    // إزالة أي أحرف تحكم غير مرئية
    result = result.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
    return result;
}
/**
 * تحويل تاريخ (قد يكون بالأرقام العربية) إلى كائن Date
 * يدعم الصيغ: "٢٩‏/١٢‏/٢٠٢٥", "29/12/2025", "2025-12-29", ISO string
 */
/**
 * تنسيق التاريخ بالتوقيت السعودي (YYYY-MM-DD)
 * هذه الدالة تضمن أن التاريخ يُحفظ بالتوقيت السعودي وليس UTC
 */
function formatDateRiyadh(date) {
    return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
}
function parseArabicDate(dateStr) {
    if (!dateStr)
        return null;
    // تحويل الأرقام العربية إلى إنجليزية
    const cleanStr = arabicToEnglishNumbers(dateStr.trim());
    // محاولة تحليل التاريخ مباشرة (ISO format)
    let date = new Date(cleanStr);
    if (!isNaN(date.getTime())) {
        return date;
    }
    // محاولة صيغة DD/MM/YYYY
    const ddmmyyyy = cleanStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmmyyyy) {
        const [, day, month, year] = ddmmyyyy;
        date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        if (!isNaN(date.getTime())) {
            return date;
        }
    }
    // محاولة صيغة MM/DD/YYYY (احتياطي)
    const mmddyyyy = cleanStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mmddyyyy) {
        const [, month, day, year] = mmddyyyy;
        date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        if (!isNaN(date.getTime())) {
            return date;
        }
    }
    return null;
}
