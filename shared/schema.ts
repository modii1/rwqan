import { z } from "zod";
import { createInsertSchema } from "drizzle-zod";

// =========================
// Property Schema (العقارات)
// =========================
export const propertySchema = z.object({
  propertyNumber: z.string(), // رقم العقار (5 أرقام)
  name: z.string(),
  whatsappNumber: z.string(), // رقم واتساب للتواصل
  location: z.string().optional(), // الموقع (رابط خرائط)
  city: z.enum(['بريدة', 'عنيزة', 'الرس', 'البكيرية', 'المذنب']),
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
  subscriptionType: z.enum(['عادي', 'مميز']), // نوع الاشتراك
  lastUpdate: z.string().optional(), // آخر تحديث
  subscriptionDate: z.string().optional(), // تاريخ الاشتراك
  pin: z.string().optional(), // رقم سري للدخول (للنظام القديم)
  verificationStatus: z.enum(['pending', 'approved', 'rejected', 'incomplete']).optional(),
  driveFolderId: z.string().optional(), // معرف مجلد Google Drive
  imageUrls: z.array(z.string()).default([]), // روابط الصور (كاش)
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
  status: z.enum(['نشط', 'منتهي', 'معلق', 'موقوف', 'ينتهي قريباً']),
  paymentId: z.string().optional(),
  linkedProperty: z.string().optional(), // رقم العقار المرتبط (لباقات العقارين)
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
  price: z.number(), // بالريال
  type: z.enum(['عادي', 'مميز']),
  features: z.array(z.string()).default([]),
  description: z.string().optional(), // وصف الباقة
  isActive: z.boolean().default(true),
  propertyCount: z.number().default(1), // عدد العقارات (1 = عقار واحد، 2 = عقارين)
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
  amount: z.number(), // المبلغ
  category: z.enum(['صيانة', 'إعلانات', 'رواتب', 'استضافة', 'أخرى']).default('أخرى'),
  description: z.string().optional(), // وصف إضافي
  date: z.string(), // تاريخ التكلفة
  createdAt: z.string().optional(),
});

export type Expense = z.infer<typeof expenseSchema>;
export const insertExpenseSchema = expenseSchema.omit({ id: true, createdAt: true });
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
  status: z.enum(['جديد', 'قيد المراجعة', 'مكتمل', 'مرفوض']).default('جديد'),
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
  status: z.enum(['معلق', 'مكتمل', 'فشل', 'ملغي', 'قيد المراجعة']),
  paymentMethod: z.enum(['بطاقة', 'Apple Pay', 'تحويل بنكي']).optional(),
  receiptUrl: z.string().optional(),
  createdAt: z.string().optional(),
  completedAt: z.string().optional(),
  // بيانات الاشتراك المعلق (يتم حفظها فقط عند نجاح الدفع)
  action: z.enum(['new', 'extend', 'upgrade']).optional(),
  pendingStartDate: z.string().optional(),
  pendingEndDate: z.string().optional(),
  pendingSubscriptionType: z.string().optional(),
  pendingPrice: z.number().optional(),
  secondPropertyNumber: z.string().optional(), // رقم العقار الثاني (لباقات العقارين)
  // بيانات Paymob Transaction
  transactionId: z.string().optional(),
  merchantFees: z.number().optional(), // رسوم التاجر (merchant_fees)
  acqFees: z.number().optional(), // رسوم البنك (acquirer fees)
  vatAmount: z.number().optional(), // ضريبة القيمة المضافة على الرسوم
  feeAmount: z.number().optional(), // إجمالي رسوم البنك (merchantFees + acqFees) - للتوافق مع الكود القديم
  totalFees: z.number().optional(), // إجمالي الرسوم (merchantFees + acqFees + vat)
  netAmount: z.number().optional(), // المبلغ الصافي بعد الخصومات
});

export type Payment = z.infer<typeof paymentSchema>;
export const insertPaymentSchema = paymentSchema.omit({ id: true, createdAt: true, completedAt: true });
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
    name: z.string(),
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
  propertyNumber2: z.string(), // رقم العقار الثاني
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
  "غرفتين نوم","غرفة نوم","غرفة اطفال","صالة جلوس","صالة طعام","مجلس داخلي","مجلس رجال","مجلس نساء",
    "مطبخ مجهز","فرن كهربائي","فرن مندي","ميكروويف","مقلط",
    "مسبح داخلي","مسبح خارجي بحاجز","مسبح خارجي بدون حاجز","مسبح أطفال","مسبح أطفال آمن","بدون مسبح","مسبح مفلتر","جاكوزي","ساونا","غرفة بخار",
    "مكيفات سبليت","مغسلة يدين","تلفزيون ذكي","شاشة تلفزيون","إنترنت Wi-Fi","نظام صوت داخلي","نظام إضاءة ليزر","ستارة سينما + بروجكتر",
    "أرضيات رخام / باركيه","عازل صوتي","ستائر كهربائية","بوابة إلكترونية","مدخل سيارة","مواقف سيارات داخلية","كاميرات مراقبة","إنذار حريق","حارس / مراقبة",
    "فرش صلاة","مصلى صغير","صوتيات للقرآن","ألعاب أطفال","ألعاب مائية","ألعاب هوائية","ألعاب لوحية","غرفة ألعاب إلكترونية",
    "طاولة بلياردو","طاولة تنس","طاولة هوكي هوائي","بلايستيشن 5","سينما للأطفال","جلسة مغطاة للأطفال","منطقة رمل",
    "جلسات خارجية","منطقة شواء","دكة نار","حديقة","مشب","مسطحات خضراء","ملعب طائرة","ملعب تنس","ملعب قدم",
    "خيمة عربية","خيمة شتوية","بيت شعر","بئر تقليدي","مسرح صغير","كوشة","إنارة مناسبات","مكبرات صوت","منسق حفلات","قاعة احتفالات",
    "مخيم","نظام قسمين رجال ونساء","ملحق","ممشى صحي"
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
  ]),

  startDate: z.string(), // تاريخ التفعيل
  endDate: z.string().optional(), // فارغ = دائم

  paymentId: z.string().optional(), // معرف الدفع (Paymob / تحويل)
  source: z.enum([
    "paymob",
    "bank_transfer",
    "admin",
  ]),

  createdAt: z.string(),
  updatedAt: z.string().optional(),
});

export type PropertyAddOn = z.infer<typeof propertyAddOnSchema>;

export const insertPropertyAddOnSchema = propertyAddOnSchema.omit({
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
    "rejected"
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
