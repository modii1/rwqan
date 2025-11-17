import { z } from "zod";
import { createInsertSchema } from "drizzle-zod";

// =========================
// Property Schema (العقارات)
// =========================
export const propertySchema = z.object({
  propertyNumber: z.string(), // رقم العقار (5 أرقام)
  name: z.string(),
  pin: z.string(), // رقم سري للدخول
  city: z.enum(['بريدة', 'عنيزة', 'الرس', 'البكيرية', 'المذنب']),
  direction: z.enum(['شمال', 'جنوب', 'شرق', 'غرب']),
  type: z.enum(['قسم', 'قسمين']),
  facilities: z.array(z.string()), // 100 مرفق
  prices: z.object({
    weekday: z.string(), // وسط الأسبوع
    weekend: z.string(), // نهاية الأسبوع
    overnight: z.string(), // مبيت
    holidays: z.string(), // إجازات
    offers: z.string().optional(), // عروض
  }),
  subscriptionType: z.enum(['عادي', 'موثوق']), // نوع الاشتراك
  subscriptionEndDate: z.string().optional(), // تاريخ انتهاء الاشتراك
  driveFolderId: z.string().optional(), // معرف مجلد Google Drive
  imageUrls: z.array(z.string()).default([]), // روابط الصور (كاش)
  whatsappNumber: z.string(), // رقم واتساب للتواصل
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
  status: z.enum(['معلق', 'مكتمل', 'فشل', 'ملغي']),
  paymentMethod: z.enum(['بطاقة', 'Apple Pay']).optional(),
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
  'مسبح',
  'بدون مسبح',
  'مبيت',
  'ألعاب مائية',
  'ملعب',
  'مناسبات',
  'شتاء',
  'صيف',
  'مكيف',
  'مدفأة',
  'واي فاي',
  'تلفزيون',
  'شاشة عرض',
  'بلاي ستيشن',
  'كراسي خارجية',
  'طاولة طعام',
  'شواية',
  'فرن خارجي',
  'مطبخ مجهز',
  'ثلاجة',
  'غسالة',
  'مجفف ملابس',
  'مكواة',
  'مكنسة كهربائية',
  'أدوات نظافة',
  'حمام سباحة للأطفال',
  'زحليقة مائية',
  'ملعب كرة قدم',
  'ملعب كرة سلة',
  'ملعب طائرة',
  'تنس طاولة',
  'بلياردو',
  'ألعاب أطفال',
  'أرجوحة',
  'نطيطة',
  'دراجات',
  'سكوتر',
  'ألعاب إلكترونية',
  'مكتبة كتب',
  'كراسي استرخاء',
  'مظلات',
  'خيمة',
  'جلسة خارجية',
  'جلسة داخلية',
  'مدخنة',
  'إضاءة خارجية',
  'إضاءة رومانسية',
  'نظام صوتي',
  'ميكروفون وسماعات',
  'كاميرات مراقبة',
  'حارس أمن',
  'موقف سيارات',
  'موقف مظلل',
  'مدخل خاص',
  'سياج كامل',
  'بوابة كهربائية',
  'حديقة',
  'نوافير',
  'إضاءة حديقة',
  'ممر مشي',
  'مقاعد حديقة',
  'شلال',
  'بحيرة صناعية',
  'جاكوزي',
  'ساونا',
  'غرفة بخار',
  'صالة رياضية',
  'معدات رياضية',
  'يوجا وتأمل',
  'غرفة ألعاب',
  'سينما منزلية',
  'غرفة اجتماعات',
  'مكتب',
  'ركن قهوة',
  'بار',
  'فرن بيتزا',
  'حفرة نار',
  'منطقة شواء مسقوفة',
  'مطبخ خارجي',
  'ثلاجة خارجية',
  'حوض غسيل خارجي',
  'دورات مياه خارجية',
  'غرف نوم متعددة',
  'أسرّة مريحة',
  'مفروشات فاخرة',
  'ستائر عازلة',
  'خزائن ملابس',
  'مرايا كبيرة',
  'إطلالة جميلة',
  'شرفة',
  'بلكونة',
  'سطح',
  'مصعد',
  'مدخل لذوي الاحتياجات',
  'أدوات طبخ كاملة',
  'صحون وأكواب',
  'أدوات مائدة',
  'محضرة طعام',
  'خلاط',
  'صانعة قهوة',
] as const;

export type Facility = typeof FACILITIES[number];
