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
  subscriptionType: z.enum(['عادي', 'موثوق']), // نوع الاشتراك
  lastUpdate: z.string().optional(), // آخر تحديث
  subscriptionDate: z.string().optional(), // تاريخ الاشتراك
  pin: z.string().optional(), // رقم سري للدخول (للنظام القديم)
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
  status: z.enum(['نشط', 'منتهي', 'معلق']),
  paymentId: z.string().optional(),
  createdAt: z.string().optional(),
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
  type: z.enum(['عادي', 'موثوق']),
  features: z.array(z.string()).default([]),
  isActive: z.boolean().default(true),
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
// Request Schema (الطلبات - WhatsApp)
// =========================
export const requestSchema = z.object({
  id: z.string(),
  propertyNumber: z.string(),
  requestCode: z.string(), // كود قصير
  timestamp: z.string(),
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
  amount: z.number(),
  discountCode: z.string().optional(),
  discountAmount: z.number().default(0),
  finalAmount: z.number(),
  paymobOrderId: z.string().optional(),
  status: z.enum(['معلق', 'مكتمل', 'فشل', 'ملغي', 'قيد المراجعة']),
  paymentMethod: z.enum(['بطاقة', 'Apple Pay', 'تحويل بنكي']).optional(),
  receiptUrl: z.string().optional(),
  createdAt: z.string().optional(),
  completedAt: z.string().optional(),
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
