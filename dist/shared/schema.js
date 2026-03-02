"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.insertPropertySeoSchema = exports.propertySeoSchema = exports.insertBlogPostSchema = exports.blogPostSchema = exports.insertOcrResultSchema = exports.ocrResultSchema = exports.DEFAULT_FEATURE_FLAGS = exports.insertFeatureFlagSchema = exports.featureFlagSchema = exports.insertBankAccountSchema = exports.bankAccountSchema = exports.DEFAULT_FEE_CONFIGS = exports.insertAddOnHistorySchema = exports.addOnHistorySchema = exports.insertPropertyAddOnSchema = exports.propertyAddOnSchema = exports.insertAddOnPackageSchema = exports.addOnPackageSchema = exports.insertFeeConfigSchema = exports.feeConfigSchema = exports.FACILITIES = exports.insertMultiPropertySubscriptionSchema = exports.multiPropertySubscriptionSchema = exports.insertPartnerProfitSchema = exports.partnerProfitSchema = exports.notificationSettingsSchema = exports.insertCodeBackupSchema = exports.codeBackupSchema = exports.insertBackupSchema = exports.backupSchema = exports.propertyAnalyticsSchema = exports.analyticsSchema = exports.insertPaymentSchema = exports.paymentSchema = exports.insertSuggestionSchema = exports.suggestionSchema = exports.insertRequestSchema = exports.requestSchema = exports.insertExpenseSchema = exports.expenseSchema = exports.insertProfitSchema = exports.profitSchema = exports.insertDiscountCodeSchema = exports.discountCodeSchema = exports.insertPackageSchema = exports.packageSchema = exports.insertSubscriptionSchema = exports.subscriptionSchema = exports.insertPropertySchema = exports.propertySchema = void 0;
const zod_1 = require("zod");
// =========================
// Property Schema (العقارات)
// =========================
exports.propertySchema = zod_1.z.object({
    propertyNumber: zod_1.z.string(), // رقم العقار (5 أرقام)
    name: zod_1.z.string(),
    whatsappNumber: zod_1.z.string(), // رقم واتساب للتواصل
    location: zod_1.z.string().optional(), // الموقع (رابط خرائط)
    city: zod_1.z.enum(['بريدة', 'عنيزة', 'الرس', 'البكيرية', 'المذنب', 'البدائع', 'الأسياح', 'عيون الجواء', 'رياض الخبراء']),
    direction: zod_1.z.enum(['شمال', 'جنوب', 'شرق', 'غرب']),
    type: zod_1.z.enum(['قسم', 'قسمين']),
    facilities: zod_1.z.array(zod_1.z.string()), // 100 مرفق
    imagesFolderUrl: zod_1.z.string().optional(), // رابط مجلد الصور
    imagesLink: zod_1.z.string().optional(), // رابط الصور كما هو في Google Sheet
    prices: zod_1.z.object({
        display: zod_1.z.string().optional(), // سعر العرض
        weekday: zod_1.z.string(), // وسط الأسبوع
        weekend: zod_1.z.string(), // نهاية الأسبوع
        overnight: zod_1.z.string(), // مبيت
        special: zod_1.z.string().optional(), // سعر خاص
        holidays: zod_1.z.string(), // إجازات
    }),
    subscriptionType: zod_1.z.enum(['عادي', 'مميز', 'موثوق', 'premium', 'trusted', 'normal', 'free', 'مجاني']), // نوع الاشتراك
    lastUpdate: zod_1.z.string().optional(), // آخر تحديث
    subscriptionDate: zod_1.z.string().optional(), // تاريخ الاشتراك
    pin: zod_1.z.string().optional(), // رقم سري للدخول (للنظام القديم)
    verificationStatus: zod_1.z.enum(['pending', 'approved', 'rejected', 'incomplete', 'verified']).optional(),
    driveFolderId: zod_1.z.string().optional(), // معرف مجلد Google Drive
    imageUrls: zod_1.z.array(zod_1.z.string()).default([]), // روابط الصور (كاش)
    lastChanges: zod_1.z.string().optional(), // آخر التغييرات
    createdAt: zod_1.z.string().optional(),
    updatedAt: zod_1.z.string().optional(),
});
exports.insertPropertySchema = exports.propertySchema.omit({ createdAt: true, updatedAt: true });
// =========================
// Subscription Schema (الاشتراكات)
// =========================
exports.subscriptionSchema = zod_1.z.object({
    id: zod_1.z.string(),
    propertyNumber: zod_1.z.string(),
    packageId: zod_1.z.string(),
    startDate: zod_1.z.string(),
    endDate: zod_1.z.string(),
    status: zod_1.z.enum(['نشط', 'منتهي', 'معلق', 'موقوف', 'ينتهي قريباً', 'نشط مجاني', 'ساري', 'active', 'expired', 'cancelled', 'rejected']),
    paymentId: zod_1.z.string().optional(),
    linkedProperty: zod_1.z.string().optional(), // رقم العقار المرتبط (لباقات العقارين)
    createdAt: zod_1.z.string().optional(),
    cancelledAt: zod_1.z.string().optional(),
    cancelReason: zod_1.z.string().optional(),
});
exports.insertSubscriptionSchema = exports.subscriptionSchema.omit({ id: true, createdAt: true });
// =========================
// Package Schema (الباقات)
// =========================
exports.packageSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(),
    duration: zod_1.z.number(), // بالأيام
    price: zod_1.z.number(), // بالريال
    type: zod_1.z.enum(['عادي', 'مميز', 'موثوق', 'premium', 'trusted', 'normal', 'free', 'مجاني']),
    features: zod_1.z.array(zod_1.z.string()).default([]),
    description: zod_1.z.string().optional(), // وصف الباقة
    isActive: zod_1.z.boolean().default(true),
    propertyCount: zod_1.z.number().default(1), // عدد العقارات (1 = عقار واحد، 2 = عقارين)
    createdAt: zod_1.z.string().optional(),
});
exports.insertPackageSchema = exports.packageSchema.omit({ id: true, createdAt: true });
// =========================
// Discount Code Schema (أكواد الخصم)
// =========================
exports.discountCodeSchema = zod_1.z.object({
    code: zod_1.z.string(),
    type: zod_1.z.enum(['نسبة', 'قيمة ثابتة']),
    value: zod_1.z.number(),
    expiryDate: zod_1.z.string().optional(),
    isActive: zod_1.z.boolean().default(true),
    usageCount: zod_1.z.number().default(0),
    createdAt: zod_1.z.string().optional(),
});
exports.insertDiscountCodeSchema = exports.discountCodeSchema.omit({ createdAt: true, usageCount: true });
// =========================
// Profit Schema (الأرباح)
// =========================
exports.profitSchema = zod_1.z.object({
    id: zod_1.z.string(),
    paymentId: zod_1.z.string(),
    propertyNumber: zod_1.z.string(),
    amount: zod_1.z.number(),
    partnerShare: zod_1.z.number(),
    cycle: zod_1.z.string(), // دورة الربح
    date: zod_1.z.string(),
    createdAt: zod_1.z.string().optional(),
});
exports.insertProfitSchema = exports.profitSchema.omit({ id: true, createdAt: true });
// =========================
// Expense Schema (التكاليف/المصاريف)
// =========================
exports.expenseSchema = zod_1.z.object({
    id: zod_1.z.string(),
    title: zod_1.z.string(), // عنوان التكلفة (مثل: صيانة، إعلانات، رواتب)
    amount: zod_1.z.number(), // المبلغ الإجمالي
    category: zod_1.z.enum(['صيانة', 'إعلانات', 'رواتب', 'استضافة', 'أخرى']).default('أخرى'),
    description: zod_1.z.string().optional(), // وصف إضافي
    date: zod_1.z.string(), // تاريخ التكلفة
    // أنواع التكاليف الجديدة
    expenseType: zod_1.z.enum(['مرة واحدة', 'شهرية', 'موزعة']).default('مرة واحدة'),
    durationMonths: zod_1.z.number().optional(), // عدد الأشهر (للتكاليف الموزعة)
    startDate: zod_1.z.string().optional(), // تاريخ بداية التوزيع (للتكاليف الموزعة)
    endDate: zod_1.z.string().optional(), // تاريخ نهاية التوزيع (للتكاليف الموزعة) - يُحسب تلقائياً
    monthlyAmount: zod_1.z.number().optional(), // المبلغ الشهري (للتكاليف الموزعة) - يُحسب تلقائياً
    isActive: zod_1.z.boolean().default(true), // هل التكلفة نشطة (للشهرية)
    createdAt: zod_1.z.string().optional(),
});
exports.insertExpenseSchema = exports.expenseSchema.omit({ id: true, createdAt: true, endDate: true, monthlyAmount: true });
// =========================
// Request Schema (الطلبات - WhatsApp)
// =========================
exports.requestSchema = zod_1.z.object({
    id: zod_1.z.string(),
    propertyNumber: zod_1.z.string(),
    requestCode: zod_1.z.string(), // كود قصير
    timestamp: zod_1.z.string(),
    ipAddress: zod_1.z.string(), // IP العميل
    deviceType: zod_1.z.enum(['mobile', 'desktop', 'tablet']).default('desktop'), // نوع الجهاز
    dayOfWeek: zod_1.z.string(), // يوم الأسبوع (الجمعة، السبت، إلخ)
    hourOfDay: zod_1.z.number(), // الساعة (0-23)
    createdAt: zod_1.z.string().optional(),
});
exports.insertRequestSchema = exports.requestSchema.omit({ id: true, createdAt: true });
// =========================
// Suggestion Schema (الاقتراحات)
// =========================
exports.suggestionSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(),
    phone: zod_1.z.string(),
    city: zod_1.z.string(),
    suggestion: zod_1.z.string(),
    status: zod_1.z.enum(['جديد', 'قيد المراجعة', 'مكتمل', 'مرفوض', 'pending', 'معلق']).default('جديد'),
    createdAt: zod_1.z.string().optional(),
});
exports.insertSuggestionSchema = exports.suggestionSchema.omit({ id: true, createdAt: true, status: true });
// =========================
// Payment Schema (المدفوعات)
// =========================
exports.paymentSchema = zod_1.z.object({
    id: zod_1.z.string(),
    propertyNumber: zod_1.z.string(),
    packageId: zod_1.z.string(),
    amount: zod_1.z.number(), // السعر الأصلي قبل الخصم
    discountCode: zod_1.z.string().optional(),
    discountAmount: zod_1.z.number().default(0),
    finalAmount: zod_1.z.number(), // السعر بعد الخصم
    paymobOrderId: zod_1.z.string().optional(),
    status: zod_1.z.enum(['معلق', 'مكتمل', 'فشل', 'ملغي', 'قيد المراجعة', 'نجح - قيد التحقق', 'قيد التحقق', 'منتهي الصلاحية', 'ملغي - انتهت المهلة', 'completed', 'نجح', 'نجاح', 'pending', 'قيد الدفع']),
    paymentMethod: zod_1.z.enum(['بطاقة', 'Apple Pay', 'تحويل بنكي', 'paymob', 'تأكيد يدوي']).optional(),
    receiptUrl: zod_1.z.string().optional(),
    packageName: zod_1.z.string().optional(),
    ocrConfidence: zod_1.z.number().optional(),
    autoMatched: zod_1.z.union([zod_1.z.boolean(), zod_1.z.string()]).optional(),
    createdAt: zod_1.z.string().optional(),
    completedAt: zod_1.z.string().optional(),
    // بيانات الاشتراك المعلق (يتم حفظها فقط عند نجاح الدفع)
    action: zod_1.z.enum(['new', 'extend', 'upgrade', 'addon']).optional(),
    pendingStartDate: zod_1.z.string().optional(),
    pendingEndDate: zod_1.z.string().optional(),
    pendingSubscriptionType: zod_1.z.string().optional(),
    pendingPrice: zod_1.z.number().optional(),
    secondPropertyNumber: zod_1.z.string().optional(), // رقم العقار الثاني (لباقات العقارين)
    // بيانات Paymob Transaction
    transactionId: zod_1.z.string().optional(),
    merchantFees: zod_1.z.number().optional(), // رسوم التاجر (merchant_fees)
    acqFees: zod_1.z.number().optional(), // رسوم البنك (acquirer fees)
    vatAmount: zod_1.z.number().optional(), // ضريبة القيمة المضافة على الرسوم
    feeAmount: zod_1.z.number().optional(), // إجمالي رسوم البنك (merchantFees + acqFees) - للتوافق مع الكود القديم
    totalFees: zod_1.z.number().optional(), // إجمالي الرسوم (merchantFees + acqFees + vat)
    netAmount: zod_1.z.number().optional(), // المبلغ الصافي بعد الخصومات
    // حقول التحقق من التحويل البنكي
    paymentReference: zod_1.z.string().optional(), // رمز الدفع الفريد (RWQN-XXXXXX)
    selectedBankAccountId: zod_1.z.string().optional(), // معرف الحساب البنكي المختار
});
exports.insertPaymentSchema = exports.paymentSchema.partial({ id: true, createdAt: true, completedAt: true });
// =========================
// Analytics Schema (تحليلات Google Analytics)
// =========================
exports.analyticsSchema = zod_1.z.object({
    visitors: zod_1.z.number(),
    devices: zod_1.z.object({
        mobile: zod_1.z.number(),
        desktop: zod_1.z.number(),
        tablet: zod_1.z.number(),
    }),
    cities: zod_1.z.array(zod_1.z.object({
        name: zod_1.z.string(),
        count: zod_1.z.number(),
    })),
    lastUpdated: zod_1.z.string(),
});
// =========================
// Property Analytics Schema (إحصائيات العقار)
// =========================
exports.propertyAnalyticsSchema = zod_1.z.object({
    propertyNumber: zod_1.z.string(),
    monthlyWhatsappRequests: zod_1.z.number().default(0),
    previousMonthGrowth: zod_1.z.number().default(0),
    averageDailyRequests: zod_1.z.number().default(0),
    highestDemandDay: zod_1.z.string().default("الجمعة"),
    engagementRate: zod_1.z.string().default("متوسط"),
    peakRequestPeriod: zod_1.z.string().default("المساء"),
    visibilityStatus: zod_1.z.string().default("عادي"),
    previousMonthRequests: zod_1.z.number().default(0),
});
// =========================
// Backup Schema (النسخ الاحتياطية)
// =========================
exports.backupSchema = zod_1.z.object({
    id: zod_1.z.string(),
    backupType: zod_1.z.enum(['كامل', 'جزئي', 'يومي', 'أسبوعي', 'شهري']),
    backupName: zod_1.z.string(),
    status: zod_1.z.enum(['جاري', 'مكتمل', 'فشل', 'استعادة']),
    dataTypes: zod_1.z.array(zod_1.z.string()), // ['properties', 'subscriptions', 'packages', 'payments', ...]
    filesCount: zod_1.z.number(),
    sizeInMB: zod_1.z.number(),
    backupData: zod_1.z.record(zod_1.z.any()).optional(), // البيانات المحفوظة
    createdAt: zod_1.z.string(),
    completedAt: zod_1.z.string().optional(),
    restoredAt: zod_1.z.string().optional(),
    autoBackup: zod_1.z.boolean().default(false),
    description: zod_1.z.string().optional(),
});
exports.insertBackupSchema = exports.backupSchema.omit({ id: true, createdAt: true, completedAt: true, restoredAt: true });
// =========================
// Code Backup Schema (نسخ احتياطية الأكواد)
// =========================
exports.codeBackupSchema = zod_1.z.object({
    id: zod_1.z.string(),
    backupName: zod_1.z.string(),
    timestamp: zod_1.z.string(),
    files: zod_1.z.record(zod_1.z.string()), // { fileName: fileContent }
    fileCount: zod_1.z.number(),
    totalSize: zod_1.z.number(),
    createdAt: zod_1.z.string(),
});
exports.insertCodeBackupSchema = exports.codeBackupSchema.omit({ id: true, createdAt: true });
// =========================
// Notification Settings Schema (إعدادات الإشعارات)
// =========================
exports.notificationSettingsSchema = zod_1.z.object({
    allNotifications: zod_1.z.boolean().default(true), // تشغيل/إيقاف كل الإشعارات
    newProperty: zod_1.z.boolean().default(true), // إشعار عقار جديد
    newSubscription: zod_1.z.boolean().default(true), // إشعار اشتراك جديد
    subscriptionRenewal: zod_1.z.boolean().default(true), // إشعار تجديد اشتراك
    receiptUpload: zod_1.z.boolean().default(true), // إشعار رفع إيصال
    propertyUpdate: zod_1.z.boolean().default(true), // إشعار تعديل عقار
    newPayment: zod_1.z.boolean().default(true), // إشعار دفعة جديدة
    smartRequest: zod_1.z.boolean().default(true), // إشعار طلب واتساب
    propertyVerification: zod_1.z.boolean().default(true), // إشعار تحقق
    subscriptionExpired: zod_1.z.boolean().default(true), // إشعار انتهاء اشتراك
    updatedAt: zod_1.z.string().optional(),
});
// =========================
// Partner Profits Schema (أرباح الشريك)
// =========================
exports.partnerProfitSchema = zod_1.z.object({
    id: zod_1.z.string(),
    monthYear: zod_1.z.string(), // الشهر/السنة مثل "2025/11"
    activeSubscriptions: zod_1.z.number(), // عدد الاشتراكات الفعالة
    totalRevenue: zod_1.z.number(), // إجمالي الإيرادات
    partnerShare: zod_1.z.number(), // نصيب الشريك (50%)
    partnerPercentage: zod_1.z.number().default(50), // نسبة الشريك
    totalExpenses: zod_1.z.number().default(0), // إجمالي التكاليف
    netProfitAfterExpenses: zod_1.z.number().default(0), // الربح الصافي بعد التكاليف
    transferDate: zod_1.z.string().optional(), // تاريخ التحويل
    transferStatus: zod_1.z.enum(['pending', 'transferred']).default('pending'), // حالة التحويل
    notes: zod_1.z.string().optional(), // ملاحظات
    createdAt: zod_1.z.string().optional(),
    updatedAt: zod_1.z.string().optional(),
});
exports.insertPartnerProfitSchema = exports.partnerProfitSchema.omit({ id: true, createdAt: true });
// =========================
// Multi-Property Package Schema (باقة عقارين)
// =========================
exports.multiPropertySubscriptionSchema = zod_1.z.object({
    id: zod_1.z.string(),
    packageId: zod_1.z.string(),
    propertyNumber1: zod_1.z.string(), // رقم العقار الأول
    propertyNumber2: zod_1.z.string(), // رقم العقار الثاني
    startDate: zod_1.z.string(),
    endDate: zod_1.z.string(),
    status: zod_1.z.enum(['نشط', 'منتهي', 'معلق']),
    paymentId: zod_1.z.string().optional(),
    createdAt: zod_1.z.string().optional(),
});
exports.insertMultiPropertySubscriptionSchema = exports.multiPropertySubscriptionSchema.omit({ id: true, createdAt: true });
// =========================
// 100 Facilities List (قائمة المرافق)
// =========================
exports.FACILITIES = [
    "غرفتين نوم", "غرفة نوم", "غرفة اطفال", "صالة جلوس", "صالة طعام", "مجلس داخلي", "مجلس رجال", "مجلس نساء",
    "مطبخ مجهز", "فرن كهربائي", "فرن مندي", "ميكروويف", "مقلط",
    "مسبح داخلي", "مسبح خارجي بحاجز", "مسبح خارجي بدون حاجز", "مسبح أطفال", "مسبح أطفال آمن", "بدون مسبح", "مسبح مفلتر", "جاكوزي", "ساونا", "غرفة بخار",
    "مكيفات سبليت", "مغسلة يدين", "تلفزيون ذكي", "شاشة تلفزيون", "إنترنت Wi-Fi", "نظام صوت داخلي", "نظام إضاءة ليزر", "ستارة سينما + بروجكتر",
    "أرضيات رخام / باركيه", "عازل صوتي", "ستائر كهربائية", "بوابة إلكترونية", "مدخل سيارة", "مواقف سيارات داخلية", "كاميرات مراقبة", "إنذار حريق", "حارس / مراقبة",
    "فرش صلاة", "مصلى صغير", "صوتيات للقرآن", "ألعاب أطفال", "ألعاب مائية", "ألعاب هوائية", "ألعاب لوحية", "غرفة ألعاب إلكترونية",
    "طاولة بلياردو", "طاولة تنس", "طاولة هوكي هوائي", "بلايستيشن 5", "سينما للأطفال", "جلسة مغطاة للأطفال", "منطقة رمل",
    "جلسات خارجية", "منطقة شواء", "دكة نار", "حديقة", "مشب", "مسطحات خضراء", "ملعب طائرة", "ملعب تنس", "ملعب قدم",
    "خيمة عربية", "خيمة شتوية", "بيت شعر", "بئر تقليدي", "مسرح صغير", "كوشة", "إنارة مناسبات", "مكبرات صوت", "منسق حفلات", "قاعة احتفالات",
    "مخيم", "نظام قسمين رجال ونساء", "ملحق", "ممشى صحي"
];
// =========================
// Fee Configuration Schema (إعدادات الرسوم)
// =========================
exports.feeConfigSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(), // اسم وسيلة الدفع
    nameEn: zod_1.z.string(), // اسم وسيلة الدفع بالإنجليزي
    percentage: zod_1.z.number(), // نسبة الرسوم %
    fixedFee: zod_1.z.number().default(1), // رسوم ثابتة (1 ريال)
    vatRate: zod_1.z.number().default(15), // نسبة ضريبة القيمة المضافة %
    isActive: zod_1.z.boolean().default(true),
    isLocal: zod_1.z.boolean().default(true), // محلي أو دولي
    updatedAt: zod_1.z.string().optional(),
});
exports.insertFeeConfigSchema = exports.feeConfigSchema.omit({ id: true, updatedAt: true });
// =========================
// Add-On Package Schema (باقات الإضافات)
// =========================
exports.addOnPackageSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(), // اسم الإضافة
    description: zod_1.z.string().optional(), // وصف مختصر
    price: zod_1.z.number(), // السعر
    durationDays: zod_1.z.number().default(0),
    // 0 = دائم | >0 = عدد أيام
    category: zod_1.z.string(),
    // مثال: اعلان، ابراز، تثبيت، توثيق، غيره
    isActive: zod_1.z.boolean().default(true), // تفعيل / إيقاف
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string().optional(),
});
exports.insertAddOnPackageSchema = exports.addOnPackageSchema.omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});
// =========================
// Property Add-On Schema (إضافات العقارات)
// =========================
exports.propertyAddOnSchema = zod_1.z.object({
    id: zod_1.z.string(),
    propertyNumber: zod_1.z.string(), // رقم العقار
    addOnPackageId: zod_1.z.string(), // معرف باقة الإضافة
    status: zod_1.z.enum([
        "pending", // بانتظار تحويل بنكي
        "active", // نشط
        "expired", // منتهي
        "cancelled", // ملغي
        "rejected", // مرفوض
    ]),
    startDate: zod_1.z.string().optional(), // تاريخ التفعيل (فارغ للمعلقة)
    endDate: zod_1.z.string().optional(), // فارغ = دائم
    paymentId: zod_1.z.string().optional(), // معرف الدفع (Paymob / تحويل)
    receiptUrl: zod_1.z.string().optional(), // رابط إيصال التحويل البنكي
    source: zod_1.z.enum([
        "paymob",
        "bank_transfer",
        "bank",
        "admin",
        "system",
    ]),
    createdAt: zod_1.z.string(),
    updatedAt: zod_1.z.string().optional(),
});
exports.insertPropertyAddOnSchema = exports.propertyAddOnSchema.partial({
    id: true,
    createdAt: true,
    updatedAt: true,
});
// =========================
// Add-On History Schema (سجل الإضافات)
// =========================
exports.addOnHistorySchema = zod_1.z.object({
    id: zod_1.z.string(),
    propertyNumber: zod_1.z.string(), // رقم العقار
    addOnPackageId: zod_1.z.string(), // معرف الإضافة
    action: zod_1.z.enum([
        "purchased", // شراء
        "activated", // تفعيل
        "expired", // انتهاء
        "cancelled", // إلغاء
        "rejected", // رفض
        "pending" // بانتظار المراجعة
    ]),
    timestamp: zod_1.z.string(), // وقت العملية
    notes: zod_1.z.string().optional(), // ملاحظات (سبب الإلغاء، آلي، يدوي...)
    createdBy: zod_1.z.enum([
        "system",
        "admin",
        "owner",
    ]).default("system"),
});
exports.insertAddOnHistorySchema = exports.addOnHistorySchema.omit({
    id: true,
});
// الرسوم الافتراضية من Paymob KSA
exports.DEFAULT_FEE_CONFIGS = [
    {
        id: "fee-visa-local",
        name: "Visa/Mastercard محلي",
        nameEn: "Visa/Mastercard Local",
        percentage: 2.7,
        fixedFee: 1,
        vatRate: 15,
        isActive: true,
        isLocal: true,
    },
    {
        id: "fee-visa-intl",
        name: "Visa/Mastercard دولي",
        nameEn: "Visa/Mastercard International",
        percentage: 3.7,
        fixedFee: 1,
        vatRate: 15,
        isActive: true,
        isLocal: false,
    },
    {
        id: "fee-mada",
        name: "مدى",
        nameEn: "Mada",
        percentage: 1.0,
        fixedFee: 1,
        vatRate: 15,
        isActive: true,
        isLocal: true,
    },
    {
        id: "fee-stc",
        name: "STC Pay",
        nameEn: "STC Pay",
        percentage: 1.0,
        fixedFee: 1,
        vatRate: 15,
        isActive: true,
        isLocal: true,
    },
    {
        id: "fee-applepay",
        name: "Apple Pay",
        nameEn: "Apple Pay",
        percentage: 2.7,
        fixedFee: 1,
        vatRate: 15,
        isActive: true,
        isLocal: true,
    },
];
// =========================
// Bank Account Schema (الحسابات البنكية)
// =========================
exports.bankAccountSchema = zod_1.z.object({
    id: zod_1.z.string(),
    bankName: zod_1.z.string(), // اسم البنك
    beneficiaryName: zod_1.z.string(), // اسم المستفيد
    iban: zod_1.z.string(), // رقم الآيبان
    accountNumber: zod_1.z.string().optional(), // رقم الحساب (اختياري)
    isActive: zod_1.z.boolean().default(true),
    isDefault: zod_1.z.boolean().default(false), // الحساب الافتراضي
    createdAt: zod_1.z.string().optional(),
});
exports.insertBankAccountSchema = exports.bankAccountSchema.omit({ id: true, createdAt: true });
// =========================
// Feature Flag Schema (أعلام الميزات)
// =========================
exports.featureFlagSchema = zod_1.z.object({
    id: zod_1.z.string(),
    name: zod_1.z.string(), // اسم الميزة
    key: zod_1.z.string(), // المفتاح (FEATURE_XXX)
    description: zod_1.z.string().optional(), // وصف الميزة
    isEnabled: zod_1.z.boolean().default(false),
    updatedAt: zod_1.z.string().optional(),
});
exports.insertFeatureFlagSchema = exports.featureFlagSchema.omit({ id: true, updatedAt: true });
// الميزات الافتراضية
exports.DEFAULT_FEATURE_FLAGS = [
    {
        id: "flag-bank-accounts-ui",
        name: "واجهة الحسابات البنكية",
        key: "FEATURE_BANK_ACCOUNTS_UI",
        description: "إظهار واجهة إدارة الحسابات البنكية",
        isEnabled: true,
    },
    {
        id: "flag-bank-receipt-required",
        name: "إلزامية رفع الإيصال",
        key: "FEATURE_BANK_RECEIPT_REQUIRED",
        description: "إجبار المستخدم على رفع إيصال التحويل",
        isEnabled: false,
    },
    {
        id: "flag-ocr-enabled",
        name: "التعرف على الإيصالات (OCR)",
        key: "FEATURE_OCR_ENABLED",
        description: "استخراج البيانات تلقائياً من صور الإيصالات",
        isEnabled: false,
    },
    {
        id: "flag-bank-auto-match",
        name: "المطابقة التلقائية",
        key: "FEATURE_BANK_AUTO_MATCH",
        description: "مطابقة التحويلات البنكية تلقائياً",
        isEnabled: false,
    },
    {
        id: "flag-timeouts",
        name: "المهلات الزمنية",
        key: "FEATURE_TIMEOUTS",
        description: "إلغاء الدفعات المعلقة تلقائياً",
        isEnabled: true,
    },
];
// =========================
// OCR Result Schema (نتائج OCR)
// =========================
exports.ocrResultSchema = zod_1.z.object({
    paymentId: zod_1.z.string(),
    extractedAmount: zod_1.z.number().optional(),
    extractedDate: zod_1.z.string().optional(),
    extractedIban: zod_1.z.string().optional(),
    extractedReference: zod_1.z.string().optional(),
    extractedBankName: zod_1.z.string().optional(),
    extractedBeneficiaryName: zod_1.z.string().optional(),
    extractedAccountNumber: zod_1.z.string().optional(),
    confidence: zod_1.z.number().optional(), // نسبة الثقة 0-100
    rawText: zod_1.z.string().optional(), // النص الكامل المستخرج
    matchDetails: zod_1.z.object({
        bankMatched: zod_1.z.boolean().optional(),
        beneficiaryMatched: zod_1.z.boolean().optional(),
        amountMatched: zod_1.z.boolean().optional(),
        referenceMatched: zod_1.z.boolean().optional(),
    }).optional(),
    createdAt: zod_1.z.string().optional(),
});
exports.insertOcrResultSchema = exports.ocrResultSchema.omit({ createdAt: true });
// =========================
// Blog Post Schema (المدونة)
// =========================
exports.blogPostSchema = zod_1.z.object({
    id: zod_1.z.string(),
    title: zod_1.z.string(), // عنوان المقال
    slug: zod_1.z.string(), // الرابط الدائم (URL-friendly)
    excerpt: zod_1.z.string().optional(), // مقتطف قصير
    content: zod_1.z.string(), // محتوى المقال (HTML أو Markdown)
    coverImage: zod_1.z.string().optional(), // صورة الغلاف
    metaTitle: zod_1.z.string().optional(), // عنوان SEO
    metaDescription: zod_1.z.string().optional(), // وصف SEO
    keywords: zod_1.z.array(zod_1.z.string()).default([]), // كلمات مفتاحية
    author: zod_1.z.string().default("روقان"), // اسم الكاتب
    status: zod_1.z.enum(['مسودة', 'منشور']).default('مسودة'),
    publishedAt: zod_1.z.string().optional(), // تاريخ النشر
    createdAt: zod_1.z.string().optional(),
    updatedAt: zod_1.z.string().optional(),
});
exports.insertBlogPostSchema = exports.blogPostSchema.omit({ id: true, createdAt: true, updatedAt: true });
// =========================
// Property SEO Schema (SEO العقارات)
// =========================
exports.propertySeoSchema = zod_1.z.object({
    propertyNumber: zod_1.z.string(), // رقم العقار
    seoDescription: zod_1.z.string().optional(), // وصف SEO خاص بالعقار
    metaTitle: zod_1.z.string().optional(), // عنوان الصفحة
    keywords: zod_1.z.array(zod_1.z.string()).default([]), // كلمات مفتاحية
    updatedAt: zod_1.z.string().optional(),
});
exports.insertPropertySeoSchema = exports.propertySeoSchema.omit({ updatedAt: true });
