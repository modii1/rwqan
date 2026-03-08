import { z } from "zod";
import { createInsertSchema } from "drizzle-zod";

// =========================
// Property Schema (العقارات)
// =========================
export const propertySchema = z.object({
  propertyNumber: z.string(), // رقم العقار (5 أرقام)
  name: z.string().max(20, "اسم العقار يجب ألا يتجاوز 20 حرف"),
  whatsappNumber: z.string(), // رقم واتساب للتواصل
  location: z.string().optional(), // الموقع (رابط خرائط)
  city: z.enum(['بريدة', 'عنيزة', 'الرس', 'البكيرية', 'المذنب', 'البدائع', 'الأسياح', 'عيون الجواء', 'رياض الخبراء']),
  direction: z.enum(['شمال', 'جنوب', 'شرق', 'غرب']),
  type: z.enum(['قسم', 'قسمين']),
  facilities: z.array(z.string()), // 100 مرفق
  imagesFolderUrl: z.string().optional(), // رابط مجلد الصور
  imagesLink: z.string().optional(),  // رابط الصور كما هو في Google Sheet
  prices: z.object({
    display: z.string().optional(), // سعر العرض
    weekday: z.string(), // وسط الأسبوع
    weekend: z.string(), // نهاية الأسبوع
    overnight: z.string(), // مبيت
    special: z.string().optional(), // سعر خاص
    holidays: z.string(), // إجازات
  }),
  subscriptionType: z.enum(['عادي', 'مميز', 'موثوق', 'premium', 'trusted', 'normal', 'free', 'مجاني']), // نوع الاشتراك
  lastUpdate: z.string().optional(), // آخر تحديث
  subscriptionDate: z.string().optional(), // تاريخ الاشتراك
  pin: z.string().optional(), // رقم سري للدخول (للنظام القديم)
  verificationStatus: z.enum(['pending', 'approved', 'rejected', 'incomplete', 'verified']).optional(),
  muteExpiryNotification: z.boolean().optional(), // إيقاف إشعارات انتهاء الاشتراك
  driveFolderId: z.string().optional(), // معرف مجلد Google Drive
  imageUrls: z.array(z.string()).default([]), // روابط الصور (كاش)
  lastChanges: z.string().optional(), // آخر التغييرات
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Property = z.infer<typeof propertySchema>;
export const insertPropertySchema = propertySchema.omit({ createdAt: true, updatedAt: true });
export type InsertProperty = z.infer<typeof insertPropertySchema>;

// =========================
// Subscription Schema (الاشتراكات)
// =========================
export const subscriptionSchema = z.object({
  id: z.string(),
  propertyNumber: z.string(),
  packageId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  status: z.enum(['نشط', 'منتهي', 'معلق', 'موقوف', 'ينتهي قريباً', 'نشط مجاني', 'ساري', 'active', 'expired', 'cancelled', 'rejected']),
  paymentId: z.string().optional(),
  linkedProperty: z.string().optional(), // رقم العقار المرتبط (لباقات العقارين)
  linkedProperties: z.array(z.string()).optional(), // جميع العقارات المرتبطة
  propertyCount: z.number().optional(), // عدد العقارات في الاشتراك
  createdAt: z.string().optional(),
  cancelledAt: z.string().optional(),
  cancelReason: z.string().optional(),
});

export type Subscription = z.infer<typeof subscriptionSchema>;
export const insertSubscriptionSchema = subscriptionSchema.omit({ id: true, createdAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;

// =========================
// Package Schema (الباقات)
// =========================
export const packageSchema = z.object({
  id: z.string(),
  name: z.string(),
  duration: z.number(), // بالأيام
  price: z.number(), // السعر الإجمالي للباقة
  pricePerProperty: z.number().optional(), // السعر لكل عقار (مثلاً 25 ريال)
  type: z.enum(['عادي', 'مميز', 'موثوق', 'premium', 'trusted', 'normal', 'free', 'مجاني']),
  features: z.array(z.string()).default([]),
  description: z.string().optional(), // وصف الباقة
  isActive: z.boolean().default(true),
  propertyCount: z.number().default(1), // عدد العقارات الافتراضي
  maxProperties: z.number().optional(), // الحد الأقصى للعقارات المسموح بها
  createdAt: z.string().optional(),
});

export type Package = z.infer<typeof packageSchema>;
export const insertPackageSchema = packageSchema.omit({ id: true, createdAt: true });
export type InsertPackage = z.infer<typeof insertPackageSchema>;

// =========================
// Discount Code Schema (أكواد الخصم)
// =========================
export const discountCodeSchema = z.object({
  code: z.string(),
  type: z.enum(['نسبة', 'قيمة ثابتة']),
  value: z.number(),
  expiryDate: z.string().optional(),
  isActive: z.boolean().default(true),
  usageCount: z.number().default(0),
  createdAt: z.string().optional(),
});

export type DiscountCode = z.infer<typeof discountCodeSchema>;
export const insertDiscountCodeSchema = discountCodeSchema.omit({ createdAt: true, usageCount: true });
export type InsertDiscountCode = z.infer<typeof insertDiscountCodeSchema>;

// =========================
// Profit Schema (الأرباح)
// =========================
export const profitSchema = z.object({
  id: z.string(),
  paymentId: z.string(),
  propertyNumber: z.string(),
  amount: z.number(),
  partnerShare: z.number(),
  cycle: z.string(), // دورة الربح
  date: z.string(),
  createdAt: z.string().optional(),
});

export type Profit = z.infer<typeof profitSchema>;
export const insertProfitSchema = profitSchema.omit({ id: true, createdAt: true });
export type InsertProfit = z.infer<typeof insertProfitSchema>;

// =========================
// Expense Schema (التكاليف/المصاريف)
// =========================
export const expenseSchema = z.object({
  id: z.string(),
  title: z.string(), // عنوان التكلفة (مثل: صيانة، إعلانات، رواتب)
  amount: z.number(), // المبلغ الإجمالي
  category: z.enum(['صيانة', 'إعلانات', 'رواتب', 'استضافة', 'أخرى']).default('أخرى'),
  description: z.string().optional(), // وصف إضافي
  date: z.string(), // تاريخ التكلفة
  // أنواع التكاليف الجديدة
  expenseType: z.enum(['مرة واحدة', 'شهرية', 'موزعة']).default('مرة واحدة'),
  durationMonths: z.number().optional(), // عدد الأشهر (للتكاليف الموزعة)
  startDate: z.string().optional(), // تاريخ بداية التوزيع (للتكاليف الموزعة)
  endDate: z.string().optional(), // تاريخ نهاية التوزيع (للتكاليف الموزعة) - يُحسب تلقائياً
  monthlyAmount: z.number().optional(), // المبلغ الشهري (للتكاليف الموزعة) - يُحسب تلقائياً
  isActive: z.boolean().default(true), // هل التكلفة نشطة (للشهرية)
  createdAt: z.string().optional(),
});

export type Expense = z.infer<typeof expenseSchema>;
export const insertExpenseSchema = expenseSchema.omit({ id: true, createdAt: true, endDate: true, monthlyAmount: true });
export type InsertExpense = z.infer<typeof insertExpenseSchema>;

// =========================
// Request Schema (الطلبات - WhatsApp)
// =========================
export const requestSchema = z.object({
  id: z.string(),
  propertyNumber: z.string(),
  requestCode: z.string(), // كود قصير
  timestamp: z.string(),
  ipAddress: z.string(), // IP العميل
  deviceType: z.enum(['mobile', 'desktop', 'tablet']).default('desktop'), // نوع الجهاز
  dayOfWeek: z.string(), // يوم الأسبوع (الجمعة، السبت، إلخ)
  hourOfDay: z.number(), // الساعة (0-23)
  createdAt: z.string().optional(),
});

export type Request = z.infer<typeof requestSchema>;
export const insertRequestSchema = requestSchema.omit({ id: true, createdAt: true });
export type InsertRequest = z.infer<typeof insertRequestSchema>;

// =========================
// Suggestion Schema (الاقتراحات)
// =========================
export const suggestionSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  city: z.string(),
  suggestion: z.string(),
  status: z.enum(['جديد', 'قيد المراجعة', 'مكتمل', 'مرفوض', 'pending', 'معلق']).default('جديد'),
  createdAt: z.string().optional(),
});

export type Suggestion = z.infer<typeof suggestionSchema>;
export const insertSuggestionSchema = suggestionSchema.omit({ id: true, createdAt: true, status: true });
export type InsertSuggestion = z.infer<typeof insertSuggestionSchema>;

// =========================
// Payment Schema (المدفوعات)
// =========================
export const paymentSchema = z.object({
  id: z.string(),
  propertyNumber: z.string(),
  packageId: z.string(),
  amount: z.number(), // السعر الأصلي قبل الخصم
  discountCode: z.string().optional(),
  discountAmount: z.number().default(0),
  finalAmount: z.number(), // السعر بعد الخصم
  paymobOrderId: z.string().optional(),
  status: z.enum(["مرفوض", 'معلق', 'مكتمل', 'فشل', 'ملغي', 'قيد المراجعة', 'نجح - قيد التحقق', 'قيد التحقق', 'منتهي الصلاحية', 'ملغي - انتهت المهلة', 'completed', 'نجح', 'نجاح', 'pending', 'قيد الدفع']),
  paymentMethod: z.enum(['بطاقة', 'Apple Pay', 'تحويل بنكي', 'paymob', 'تأكيد يدوي']).optional(),
  receiptUrl: z.string().optional(),
  packageName: z.string().optional(),
  ocrConfidence: z.number().optional(),
  autoMatched: z.union([z.boolean(), z.string()]).optional(),
  createdAt: z.string().optional(),
  completedAt: z.string().optional(),
  // بيانات الاشتراك المعلق (يتم حفظها فقط عند نجاح الدفع)
  action: z.enum(['new', 'extend', 'upgrade', 'addon']).optional(),
  pendingStartDate: z.string().optional(),
  pendingEndDate: z.string().optional(),
  pendingSubscriptionType: z.string().optional(),
  pendingPrice: z.number().optional(),
  secondPropertyNumber: z.string().optional(), // رقم العقار الثاني (لباقات العقارين) - للتوافق مع الكود القديم
  additionalProperties: z.array(z.string()).optional(), // مصفوفة العقارات الإضافية
  linkedProperties: z.array(z.string()).optional(), // جميع العقارات المرتبطة (بما فيها الرئيسي)
  // بيانات Paymob Transaction
  transactionId: z.string().optional(),
  merchantFees: z.number().optional(), // رسوم التاجر (merchant_fees)
  acqFees: z.number().optional(), // رسوم البنك (acquirer fees)
  vatAmount: z.number().optional(), // ضريبة القيمة المضافة على الرسوم
  feeAmount: z.number().optional(), // إجمالي رسوم البنك (merchantFees + acqFees) - للتوافق مع الكود القديم
  totalFees: z.number().optional(), // إجمالي الرسوم (merchantFees + acqFees + vat)
  netAmount: z.number().optional(), // المبلغ الصافي بعد الخصومات
  // حقول التحقق من التحويل البنكي
  paymentReference: z.string().optional(), // رمز الدفع الفريد (RWQN-XXXXXX)
  selectedBankAccountId: z.string().optional(), // معرف الحساب البنكي المختار
});

export type Payment = z.infer<typeof paymentSchema>;
export const insertPaymentSchema = paymentSchema.partial({ id: true, createdAt: true, completedAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;

// =========================
// Analytics Schema (تحليلات Google Analytics)
// =========================
export const analyticsSchema = z.object({
  visitors: z.number(),
  devices: z.object({
    mobile: z.number(),
    desktop: z.number(),
    tablet: z.number(),
  }),
  cities: z.array(z.object({
  name: z.string().max(20, "اسم العقار يجب ألا يتجاوز 20 حرف"),
    count: z.number(),
  })),
  lastUpdated: z.string(),
});

export type Analytics = z.infer<typeof analyticsSchema>;

// =========================
// Property Analytics Schema (إحصائيات العقار)
// =========================
export const propertyAnalyticsSchema = z.object({
  propertyNumber: z.string(),
  monthlyWhatsappRequests: z.number().default(0),
  previousMonthGrowth: z.number().default(0),
  averageDailyRequests: z.number().default(0),
  highestDemandDay: z.string().default("الجمعة"),
  engagementRate: z.string().default("متوسط"),
  peakRequestPeriod: z.string().default("المساء"),
  visibilityStatus: z.string().default("عادي"),
  previousMonthRequests: z.number().default(0),
});

export type PropertyAnalytics = z.infer<typeof propertyAnalyticsSchema>;

// =========================
// Backup Schema (النسخ الاحتياطية)
// =========================
export const backupSchema = z.object({
  id: z.string(),
  backupType: z.enum(['كامل', 'جزئي', 'يومي', 'أسبوعي', 'شهري']),
  backupName: z.string(),
  status: z.enum(['جاري', 'مكتمل', 'فشل', 'استعادة']),
  dataTypes: z.array(z.string()), // ['properties', 'subscriptions', 'packages', 'payments', ...]
  filesCount: z.number(),
  sizeInMB: z.number(),
  backupData: z.record(z.any()).optional(), // البيانات المحفوظة
  createdAt: z.string(),
  completedAt: z.string().optional(),
  restoredAt: z.string().optional(),
  autoBackup: z.boolean().default(false),
  description: z.string().optional(),
});

export type Backup = z.infer<typeof backupSchema>;
export const insertBackupSchema = backupSchema.omit({ id: true, createdAt: true, completedAt: true, restoredAt: true });
export type InsertBackup = z.infer<typeof insertBackupSchema>;

// =========================
// Code Backup Schema (نسخ احتياطية الأكواد)
// =========================
export const codeBackupSchema = z.object({
  id: z.string(),
  backupName: z.string(),
  timestamp: z.string(),
  files: z.record(z.string()), // { fileName: fileContent }
  fileCount: z.number(),
  totalSize: z.number(),
  createdAt: z.string(),
});

export type CodeBackup = z.infer<typeof codeBackupSchema>;
export const insertCodeBackupSchema = codeBackupSchema.omit({ id: true, createdAt: true });
export type InsertCodeBackup = z.infer<typeof insertCodeBackupSchema>;

// =========================
// Notification Settings Schema (إعدادات الإشعارات)
// =========================
export const notificationSettingsSchema = z.object({
  allNotifications: z.boolean().default(true), // تشغيل/إيقاف كل الإشعارات
  newProperty: z.boolean().default(true), // إشعار عقار جديد
  newSubscription: z.boolean().default(true), // إشعار اشتراك جديد
  subscriptionRenewal: z.boolean().default(true), // إشعار تجديد اشتراك
  receiptUpload: z.boolean().default(true), // إشعار رفع إيصال
  propertyUpdate: z.boolean().default(true), // إشعار تعديل عقار
  newPayment: z.boolean().default(true), // إشعار دفعة جديدة
  smartRequest: z.boolean().default(true), // إشعار طلب واتساب
  propertyVerification: z.boolean().default(true), // إشعار تحقق
  subscriptionExpired: z.boolean().default(true), // إشعار انتهاء اشتراك
  updatedAt: z.string().optional(),
});

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

// =========================
// Partner Profits Schema (أرباح الشريك)
// =========================
export const partnerProfitSchema = z.object({
  id: z.string(),
  monthYear: z.string(), // الشهر/السنة مثل "2025/11"
  activeSubscriptions: z.number(), // عدد الاشتراكات الفعالة
  totalRevenue: z.number(), // إجمالي الإيرادات
  partnerShare: z.number(), // نصيب الشريك (50%)
  partnerPercentage: z.number().default(50), // نسبة الشريك
  totalExpenses: z.number().default(0), // إجمالي التكاليف
  netProfitAfterExpenses: z.number().default(0), // الربح الصافي بعد التكاليف
  transferDate: z.string().optional(), // تاريخ التحويل
  transferStatus: z.enum(['pending', 'transferred']).default('pending'), // حالة التحويل
  notes: z.string().optional(), // ملاحظات
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type PartnerProfit = z.infer<typeof partnerProfitSchema>;
export const insertPartnerProfitSchema = partnerProfitSchema.omit({ id: true, createdAt: true });
export type InsertPartnerProfit = z.infer<typeof insertPartnerProfitSchema>;

// =========================
// Multi-Property Package Schema (باقة عقارين)
// =========================
export const multiPropertySubscriptionSchema = z.object({
  id: z.string(),
  packageId: z.string(),
  propertyNumber1: z.string(), // رقم العقار الأول
  propertyNumber2: z.string().optional(), // رقم العقار الثاني (للتوافق مع الكود القديم)
  additionalProperties: z.array(z.string()).optional(), // مصفوفة العقارات الإضافية
  linkedProperties: z.array(z.string()).optional(), // جميع العقارات المرتبطة
  propertyCount: z.number().optional(), // عدد العقارات
  startDate: z.string(),
  endDate: z.string(),
  status: z.enum(['نشط', 'منتهي', 'معلق']),
  paymentId: z.string().optional(),
  createdAt: z.string().optional(),
});

export type MultiPropertySubscription = z.infer<typeof multiPropertySubscriptionSchema>;
export const insertMultiPropertySubscriptionSchema = multiPropertySubscriptionSchema.omit({ id: true, createdAt: true });
export type InsertMultiPropertySubscription = z.infer<typeof insertMultiPropertySubscriptionSchema>;

// =========================
// 100 Facilities List (قائمة المرافق)
// =========================
export const FACILITIES = [
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
] as const;

export type Facility = typeof FACILITIES[number];

// =========================
// Fee Configuration Schema (إعدادات الرسوم)
// =========================
export const feeConfigSchema = z.object({
  id: z.string(),
  name: z.string(), // اسم وسيلة الدفع
  nameEn: z.string(), // اسم وسيلة الدفع بالإنجليزي
  percentage: z.number(), // نسبة الرسوم %
  fixedFee: z.number().default(1), // رسوم ثابتة (1 ريال)
  vatRate: z.number().default(15), // نسبة ضريبة القيمة المضافة %
  isActive: z.boolean().default(true),
  isLocal: z.boolean().default(true), // محلي أو دولي
  updatedAt: z.string().optional(),
});

export type FeeConfig = z.infer<typeof feeConfigSchema>;
export const insertFeeConfigSchema = feeConfigSchema.omit({ id: true, updatedAt: true });
export type InsertFeeConfig = z.infer<typeof insertFeeConfigSchema>;


// =========================
// Add-On Package Schema (باقات الإضافات)
// =========================
export const addOnPackageSchema = z.object({
  id: z.string(),

  name: z.string(), // اسم الإضافة
  description: z.string().optional(), // وصف مختصر

  price: z.number(), // السعر
  durationDays: z.number().default(0),
  // 0 = دائم | >0 = عدد أيام

  category: z.string(),
  // مثال: اعلان، ابراز، تثبيت، توثيق، غيره

  isActive: z.boolean().default(true), // تفعيل / إيقاف

  createdAt: z.string(),
  updatedAt: z.string().optional(),
});

export type AddOnPackage = z.infer<typeof addOnPackageSchema>;

export const insertAddOnPackageSchema = addOnPackageSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertAddOnPackage = z.infer<typeof insertAddOnPackageSchema>;

// =========================
// Property Add-On Schema (إضافات العقارات)
// =========================
export const propertyAddOnSchema = z.object({
  id: z.string(),

  propertyNumber: z.string(), // رقم العقار
  addOnPackageId: z.string(), // معرف باقة الإضافة

  status: z.enum([
    "pending",    // بانتظار تحويل بنكي
    "active",    // نشط
    "expired",   // منتهي
    "cancelled", // ملغي
    "rejected",  // مرفوض
  ]),

  startDate: z.string().optional(), // تاريخ التفعيل (فارغ للمعلقة)
  endDate: z.string().optional(), // فارغ = دائم

  paymentId: z.string().optional(), // معرف الدفع (Paymob / تحويل)
  receiptUrl: z.string().optional(), // رابط إيصال التحويل البنكي
  source: z.enum([
    "paymob",
    "bank_transfer",
    "bank",
    "admin",
    "system",
  ]),

  createdAt: z.string(),
  updatedAt: z.string().optional(),
});

export type PropertyAddOn = z.infer<typeof propertyAddOnSchema>;

export const insertPropertyAddOnSchema = propertyAddOnSchema.partial({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPropertyAddOn = z.infer<typeof insertPropertyAddOnSchema>;

// =========================
// Add-On History Schema (سجل الإضافات)
// =========================
export const addOnHistorySchema = z.object({
  id: z.string(),

  propertyNumber: z.string(), // رقم العقار
  addOnPackageId: z.string(), // معرف الإضافة

  action: z.enum([
    "purchased", // شراء
    "activated", // تفعيل
    "expired",   // انتهاء
    "cancelled", // إلغاء
    "rejected",  // رفض
    "pending"    // بانتظار المراجعة
  ]),

  timestamp: z.string(), // وقت العملية
  notes: z.string().optional(), // ملاحظات (سبب الإلغاء، آلي، يدوي...)

  createdBy: z.enum([
    "system",
    "admin",
    "owner",
  ]).default("system"),
});

export type AddOnHistory = z.infer<typeof addOnHistorySchema>;

export const insertAddOnHistorySchema = addOnHistorySchema.omit({
  id: true,
});

export type InsertAddOnHistory = z.infer<typeof insertAddOnHistorySchema>;



// الرسوم الافتراضية من Paymob KSA
export const DEFAULT_FEE_CONFIGS: FeeConfig[] = [
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
export const bankAccountSchema = z.object({
  id: z.string(),
  bankName: z.string(), // اسم البنك
  beneficiaryName: z.string(), // اسم المستفيد
  iban: z.string(), // رقم الآيبان
  accountNumber: z.string().optional(), // رقم الحساب (اختياري)
  barcodeUrl: z.string().optional(), // رابط باركود الحساب البنكي
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false), // الحساب الافتراضي
  createdAt: z.string().optional(),
});

export type BankAccount = z.infer<typeof bankAccountSchema>;
export const insertBankAccountSchema = bankAccountSchema.omit({ id: true, createdAt: true });
export type InsertBankAccount = z.infer<typeof insertBankAccountSchema>;

// =========================
// Feature Flag Schema (أعلام الميزات)
// =========================
export const featureFlagSchema = z.object({
  id: z.string(),
  name: z.string(), // اسم الميزة
  key: z.string(), // المفتاح (FEATURE_XXX)
  description: z.string().optional(), // وصف الميزة
  isEnabled: z.boolean().default(false),
  updatedAt: z.string().optional(),
});

export type FeatureFlag = z.infer<typeof featureFlagSchema>;
export const insertFeatureFlagSchema = featureFlagSchema.omit({ id: true, updatedAt: true });
export type InsertFeatureFlag = z.infer<typeof insertFeatureFlagSchema>;

// الميزات الافتراضية
export const DEFAULT_FEATURE_FLAGS: FeatureFlag[] = [
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
export const ocrResultSchema = z.object({
  paymentId: z.string(),
  extractedAmount: z.number().optional(),
  extractedDate: z.string().optional(),
  extractedIban: z.string().optional(),
  extractedReference: z.string().optional(),
  extractedBankName: z.string().optional(),
  extractedBeneficiaryName: z.string().optional(),
  extractedAccountNumber: z.string().optional(),
  confidence: z.number().optional(), // نسبة الثقة 0-100
  rawText: z.string().optional(), // النص الكامل المستخرج
  matchDetails: z.object({
    bankMatched: z.boolean().optional(),
    beneficiaryMatched: z.boolean().optional(),
    amountMatched: z.boolean().optional(),
    referenceMatched: z.boolean().optional(),
  }).optional(),
  createdAt: z.string().optional(),
});

export type OcrResult = z.infer<typeof ocrResultSchema>;
export const insertOcrResultSchema = ocrResultSchema.omit({ createdAt: true });
export type InsertOcrResult = z.infer<typeof insertOcrResultSchema>;

// =========================
// Blog Post Schema (المدونة)
// =========================
export const blogPostSchema = z.object({
  id: z.string(),
  title: z.string(), // عنوان المقال
  slug: z.string(), // الرابط الدائم (URL-friendly)
  excerpt: z.string().optional(), // مقتطف قصير
  content: z.string(), // محتوى المقال (HTML أو Markdown)
  coverImage: z.string().optional(), // صورة الغلاف
  metaTitle: z.string().optional(), // عنوان SEO
  metaDescription: z.string().optional(), // وصف SEO
  keywords: z.array(z.string()).default([]), // كلمات مفتاحية
  author: z.string().default("روقان"), // اسم الكاتب
  status: z.enum(['مسودة', 'منشور']).default('مسودة'),
  publishedAt: z.string().optional(), // تاريخ النشر
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type BlogPost = z.infer<typeof blogPostSchema>;
export const insertBlogPostSchema = blogPostSchema.omit({ id: true, createdAt: true, updatedAt: true });
export type InsertBlogPost = z.infer<typeof insertBlogPostSchema>;

// =========================
// Property SEO Schema (SEO العقارات)
// =========================
export const propertySeoSchema = z.object({
  propertyNumber: z.string(), // رقم العقار
  seoDescription: z.string().optional(), // وصف SEO خاص بالعقار
  metaTitle: z.string().optional(), // عنوان الصفحة
  keywords: z.array(z.string()).default([]), // كلمات مفتاحية
  updatedAt: z.string().optional(),
});

export type PropertySeo = z.infer<typeof propertySeoSchema>;
export const insertPropertySeoSchema = propertySeoSchema.omit({ updatedAt: true });
export type InsertPropertySeo = z.infer<typeof insertPropertySeoSchema>;
