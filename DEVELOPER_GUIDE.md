# دليل المطور الشامل - نظام روقـان للعقارات 🏡

---

## جدول المحتويات

1. [نظرة عامة على المشروع](#نظرة-عامة-على-المشروع)
2. [هيكل المجلدات والملفات](#هيكل-المجلدات-والملفات)
3. [التقنيات المستخدمة](#التقنيات-المستخدمة)
4. [تشغيل المشروع](#تشغيل-المشروع)
5. [الصفحات والمسارات](#الصفحات-والمسارات)
6. [واجهات API](#واجهات-api)
7. [قاعدة البيانات (Google Sheets)](#قاعدة-البيانات-google-sheets)
8. [نظام الدفع (Paymob)](#نظام-الدفع-paymob)
9. [نظام الاشتراكات](#نظام-الاشتراكات)
10. [تخزين الصور (R2)](#تخزين-الصور-r2)
11. [إشعارات WhatsApp](#إشعارات-whatsapp)
12. [دليل تغيير التصميم](#دليل-تغيير-التصميم)
13. [دليل إضافة صفحات جديدة](#دليل-إضافة-صفحات-جديدة)
14. [دليل تعديل لوحة الإدارة](#دليل-تعديل-لوحة-الإدارة)
15. [دليل تعديل لوحة المالك](#دليل-تعديل-لوحة-المالك)
16. [دليل صفحة العقارات](#دليل-صفحة-العقارات)
17. [دليل صفحة تفاصيل العقار](#دليل-صفحة-تفاصيل-العقار)
18. [المتغيرات والإعدادات](#المتغيرات-والإعدادات)
19. [استكشاف الأخطاء](#استكشاف-الأخطاء)

---

## نظرة عامة على المشروع

### ما هو روقـان؟
روقـان هو نظام إدارة عقارات شامل للشاليهات والاستراحات في منطقة القصيم بالسعودية. يوفر:

- **عرض العقارات**: صفحة رئيسية لعرض جميع العقارات مع فلاتر ذكية
- **نظام اشتراكات**: باقات مجانية ومدفوعة (مميز/موثوق)
- **لوحة إدارة**: للتحكم في العقارات، الدفعات، الاشتراكات
- **لوحة مالك**: لإدارة عقاره وصوره واشتراكه
- **نظام دفع**: Paymob للبطاقات وApple Pay + تحويل بنكي
- **تحقق ذكي**: فحص إيصالات التحويل البنكي بالذكاء الاصطناعي

### التقنيات الرئيسية
| الجانب | التقنية |
|--------|---------|
| Frontend | React + TypeScript + Vite |
| Styling | Tailwind CSS + shadcn/ui |
| Backend | Express.js + TypeScript |
| Database | Google Sheets |
| Storage | Cloudflare R2 |
| Payments | Paymob |
| Notifications | WhatsApp Business API |

---

## هيكل المجلدات والملفات

```
workspace/
├── client/                      # Frontend (React)
│   └── src/
│       ├── App.tsx              # ⭐ التطبيق الرئيسي + المسارات
│       ├── main.tsx             # نقطة الدخول
│       ├── index.css            # ⭐ الألوان والتصميم
│       ├── assets/              # الصور والأيقونات
│       │   ├── logo-icon.png    # شعار صغير
│       │   └── logo-full.png    # شعار كامل
│       ├── components/          # المكونات
│       │   ├── ui/              # مكونات shadcn
│       │   │   ├── button.tsx
│       │   │   ├── card.tsx
│       │   │   ├── dialog.tsx
│       │   │   └── ...
│       │   ├── price-display.tsx
│       │   └── ai-receipt-scanner.tsx
│       ├── hooks/               # React Hooks
│       │   ├── use-session.ts   # ⭐ جلسة المالك
│       │   ├── use-toast.ts     # الإشعارات
│       │   └── use-analytics.tsx
│       ├── lib/                 # دوال مساعدة
│       │   ├── queryClient.ts   # إعدادات React Query
│       │   ├── utils.ts         # cn() وغيرها
│       │   ├── arabicSearch.ts  # بحث عربي ذكي
│       │   ├── dateUtils.ts     # التواريخ
│       │   └── subscription-utils.ts
│       └── pages/               # ⭐ صفحات التطبيق
│           ├── properties.tsx   # ⭐ الصفحة الرئيسية
│           ├── property-details.tsx # تفاصيل العقار
│           ├── owner-login.tsx  # تسجيل دخول المالك
│           ├── owner-dashboard.tsx # ⭐ لوحة المالك
│           ├── owner-subscription.tsx # اشتراك المالك
│           ├── owner-images.tsx # صور المالك
│           ├── subscription.tsx # صفحة الاشتراك
│           ├── register.tsx     # تسجيل عقار جديد
│           ├── blog.tsx         # المدونة
│           ├── blog-post.tsx    # مقال المدونة
│           └── admin/           # ⭐ لوحة الإدارة
│               ├── index.tsx    # الصفحة الرئيسية
│               └── sections/    # أقسام اللوحة
│                   ├── properties.tsx   # العقارات
│                   ├── payments.tsx     # الدفعات
│                   ├── subscriptions.tsx # الاشتراكات
│                   ├── packages.tsx     # الباقات
│                   ├── discounts.tsx    # الخصومات
│                   ├── verification.tsx # التحقق
│                   ├── settings.tsx     # الإعدادات
│                   ├── bank-accounts.tsx # الحسابات البنكية
│                   ├── feature-flags.tsx # Feature Flags
│                   └── ...
├── server/                      # Backend (Express)
│   ├── index.ts                 # ⭐ نقطة الدخول
│   ├── routes.ts                # ⭐⭐ جميع API endpoints
│   ├── googleSheets.ts          # ⭐⭐ التعامل مع Google Sheets
│   ├── storage.ts               # تخزين في الذاكرة
│   ├── paymob.ts                # ⭐ نظام الدفع
│   ├── whatsapp.ts              # ⭐ إشعارات WhatsApp
│   ├── aiReceiptScanner.ts      # ⭐ فحص الإيصالات بالذكاء الاصطناعي
│   ├── ocrService.ts            # خدمة OCR
│   ├── autoMatchService.ts      # مطابقة تلقائية
│   ├── scheduler.ts             # المهام المجدولة
│   ├── dateUtils.ts             # دوال التواريخ (التوقيت السعودي)
│   ├── googleDrive.ts           # Google Drive
│   └── vite.ts                  # إعدادات Vite
├── shared/                      # مشترك بين Frontend/Backend
│   └── schema.ts                # ⭐⭐ أنواع البيانات (Zod schemas)
├── package.json                 # التبعيات
├── tailwind.config.ts           # إعدادات Tailwind
├── vite.config.ts               # إعدادات Vite
├── tsconfig.json                # إعدادات TypeScript
└── replit.md                    # ملخص المشروع
```

### الملفات الأهم (⭐)

| الملف | الوظيفة | متى تعدله |
|-------|---------|-----------|
| `client/src/App.tsx` | المسارات + Header + Footer | إضافة صفحة جديدة |
| `client/src/index.css` | الألوان + التصميم | تغيير الألوان/الخطوط |
| `client/src/pages/properties.tsx` | الصفحة الرئيسية | تعديل عرض العقارات |
| `client/src/pages/admin/index.tsx` | لوحة الإدارة | إضافة قسم جديد |
| `server/routes.ts` | جميع APIs | إضافة endpoint جديد |
| `server/googleSheets.ts` | قاعدة البيانات | تعديل البيانات |
| `shared/schema.ts` | الأنواع | إضافة حقل جديد |

---

## التقنيات المستخدمة

### Frontend
- **React 18**: مكتبة UI
- **TypeScript**: لغة برمجة مع أنواع
- **Vite**: أداة بناء سريعة
- **Tailwind CSS**: تصميم CSS utility-first
- **shadcn/ui**: مكونات UI جاهزة
- **React Query (TanStack)**: إدارة البيانات من API
- **wouter**: التوجيه (routing)
- **react-hook-form**: النماذج
- **Zod**: التحقق من البيانات
- **Lucide React**: الأيقونات

### Backend
- **Express.js**: خادم الويب
- **TypeScript**: لغة برمجة
- **googleapis**: التعامل مع Google APIs
- **multer**: رفع الملفات
- **OpenAI**: الذكاء الاصطناعي (GPT-4o)
- **AWS SDK**: التعامل مع R2

### خدمات خارجية
- **Google Sheets**: قاعدة البيانات
- **Google Drive**: تخزين الصور (قديم)
- **Cloudflare R2**: تخزين الصور (جديد)
- **Paymob**: بوابة الدفع
- **Enjazatik**: WhatsApp API
- **Meta WhatsApp Business**: إشعارات

---

## تشغيل المشروع

### التشغيل المحلي
```bash
npm run dev
```
هذا يشغل:
- Vite (Frontend) على المنفذ 5000
- Express (Backend) على نفس المنفذ

### البناء للإنتاج
```bash
npm run build
npm run start
```

### الأوامر المتاحة
```json
{
  "dev": "NODE_ENV=development tsx server/index.ts",
  "build": "vite build && esbuild server/index.ts ...",
  "start": "NODE_ENV=production node dist/index.js",
  "check": "tsc",
  "db:push": "drizzle-kit push"
}
```

---

## الصفحات والمسارات

### المسارات (في App.tsx)

| المسار | الصفحة | الوصف |
|--------|--------|-------|
| `/` | `PropertiesPage` | الصفحة الرئيسية (عرض العقارات) |
| `/property/:id` | `PropertyDetailsPage` | تفاصيل عقار |
| `/blog` | `BlogPage` | المدونة |
| `/blog/:slug` | `BlogPostPage` | مقال |
| `/owner/login` | `OwnerLogin` | تسجيل دخول المالك |
| `/owner/dashboard` | `OwnerDashboard` | لوحة المالك |
| `/owner/images` | `OwnerImagesPage` | صور المالك |
| `/owner/update-property` | `OwnerUpdateProperty` | تحديث العقار |
| `/owner/subscription` | `OwnerSubscriptionPage` | اشتراك المالك |
| `/subscription` | `SubscriptionPage` | صفحة الاشتراك العامة |
| `/register` | `RegisterPage` | تسجيل عقار جديد |
| `/suggest` | `SuggestPage` | اقتراحات |
| `/forgot-password` | `ForgotPassword` | استعادة كلمة المرور |
| `/admin` | `AdminDashboard` | لوحة الإدارة |
| `/admin/analytics` | `AdminAnalytics` | التحليلات |
| `/admin/images/:propertyNumber` | `AdminImagesPage` | صور عقار (للأدمن) |

---

## واجهات API

### هيكل الـ API
جميع APIs في ملف `server/routes.ts` وتبدأ بـ `/api/`

### APIs العقارات
```
GET  /api/properties              # جلب جميع العقارات
GET  /api/properties/:number      # جلب عقار بالرقم
POST /api/properties              # إضافة عقار جديد
PUT  /api/properties/:number      # تحديث عقار
DELETE /api/properties/:number    # حذف عقار (أدمن)
```

### APIs الاشتراكات
```
GET  /api/subscriptions           # جميع الاشتراكات
GET  /api/subscriptions/:number   # اشتراك عقار
POST /api/subscriptions           # إنشاء اشتراك
PUT  /api/subscriptions/:id       # تحديث اشتراك
```

### APIs الدفع
```
POST /api/payments/create-payment # إنشاء دفعة (Paymob)
POST /api/payments/webhook        # Paymob webhook
POST /api/payments/bank-transfer  # رفع إيصال تحويل بنكي
GET  /api/payments                # جميع الدفعات
PUT  /api/payments/:id/confirm    # تأكيد دفعة (أدمن)
PUT  /api/payments/:id/reject     # رفض دفعة (أدمن)
```

### APIs المالك
```
POST /api/owner/login             # تسجيل الدخول
POST /api/owner/logout            # تسجيل الخروج
GET  /api/owner/session           # الجلسة الحالية
POST /api/owner/verify-property   # التحقق من بيانات العقار
PUT  /api/owner/update-property   # تحديث العقار
```

### APIs الأدمن
```
POST /api/admin/login             # تسجيل دخول الأدمن
GET  /api/admin/session           # جلسة الأدمن
GET  /api/admin/dashboard-stats   # إحصائيات
PUT  /api/admin/properties/:number/approve  # قبول عقار
PUT  /api/admin/properties/:number/reject   # رفض عقار
```

### APIs الباقات والخصومات
```
GET  /api/packages                # جميع الباقات
POST /api/packages                # إضافة باقة
PUT  /api/packages/:id            # تحديث باقة
GET  /api/discount-codes          # أكواد الخصم
POST /api/discount-codes          # إضافة كود
POST /api/discount-codes/validate # التحقق من كود
```

### APIs الصور
```
GET  /api/images/:propertyNumber  # جلب صور عقار
POST /api/images/upload           # رفع صورة
DELETE /api/images/:key           # حذف صورة
POST /api/images/reorder          # إعادة ترتيب
```

---

## قاعدة البيانات (Google Sheets)

### الشيتات (Sheets)

| اسم الشيت | الوصف | الملف المسؤول |
|-----------|-------|---------------|
| `Properties` | العقارات | `googleSheets.ts` |
| `Subscriptions` | الاشتراكات | `googleSheets.ts` |
| `Payments` | المدفوعات | `googleSheets.ts` |
| `Packages` | الباقات | `googleSheets.ts` |
| `DiscountCodes` | أكواد الخصم | `googleSheets.ts` |
| `Requests` | طلبات WhatsApp | `googleSheets.ts` |
| `Suggestions` | الاقتراحات | `googleSheets.ts` |
| `Expenses` | المصاريف | `googleSheets.ts` |
| `Blog` | مقالات المدونة | `googleSheets.ts` |
| `BankAccounts` | الحسابات البنكية | `googleSheets.ts` |
| `FeatureFlags` | Feature Flags | `googleSheets.ts` |
| `VerificationLogs` | سجل التحقق | `googleSheets.ts` |

### أعمدة شيت Properties (العقارات)
```
A: propertyNumber    # رقم العقار (5 أرقام)
B: name              # اسم العقار
C: whatsappNumber    # رقم واتساب
D: location          # رابط الموقع
E: city              # المدينة
F: direction         # الاتجاه
G: type              # نوع (قسم/قسمين)
H: facilities        # المرافق (JSON)
I: imagesFolderUrl   # رابط مجلد الصور
J: prices            # الأسعار (JSON)
K: subscriptionType  # نوع الاشتراك (عادي/مميز)
L: lastUpdate        # آخر تحديث
M: subscriptionDate  # تاريخ الاشتراك
N: pin               # الرقم السري
O: verificationStatus # حالة التحقق
P: driveFolderId     # معرف Google Drive
Q: imageUrls         # روابط الصور (JSON)
R: createdAt         # تاريخ الإنشاء
S: updatedAt         # تاريخ التحديث
```

### أعمدة شيت Payments (الدفعات)
```
A: id                # معرف الدفعة
B: propertyNumber    # رقم العقار
C: packageId         # معرف الباقة
D: amount            # المبلغ الأصلي
E: discountCode      # كود الخصم
F: discountAmount    # مبلغ الخصم
G: finalAmount       # المبلغ النهائي
H: paymobOrderId     # معرف Paymob
I: status            # الحالة
J: paymentMethod     # طريقة الدفع
K: receiptUrl        # رابط الإيصال
L: createdAt         # تاريخ الإنشاء
M: completedAt       # تاريخ الإكمال
N: action            # الإجراء (new/extend/upgrade)
O: pendingStartDate  # تاريخ البداية المعلق
P: pendingEndDate    # تاريخ النهاية المعلق
Q: pendingSubscriptionType # نوع الاشتراك المعلق
R: pendingPrice      # السعر المعلق
S: secondPropertyNumber # العقار الثاني
```

### كيف تضيف عمود جديد؟

1. **أضف العمود في Google Sheet** يدوياً
2. **عدّل `shared/schema.ts`** - أضف الحقل في الـ schema:
   ```typescript
   export const propertySchema = z.object({
     // ... الحقول الموجودة
     newField: z.string().optional(), // الحقل الجديد
   });
   ```
3. **عدّل `server/googleSheets.ts`** - أضف الحقل في دوال القراءة والكتابة:
   ```typescript
   // في parsePropertyRow
   newField: row[20] || '',
   
   // في propertyToRow
   property.newField || '',
   ```

---

## نظام الدفع (Paymob)

### كيف يعمل؟

1. **المستخدم يختار باقة** ويضغط "ادفع"
2. **Frontend** يستدعي `/api/payments/create-payment`
3. **Backend** ينشئ payment intention في Paymob
4. **Frontend** يفتح نافذة Paymob Checkout
5. **المستخدم يدفع** (بطاقة أو Apple Pay)
6. **Paymob** يرسل webhook إلى `/api/payments/webhook`
7. **Backend** يحدث حالة الدفع ويفعّل الاشتراك

### ملف paymob.ts
```typescript
// إنشاء Payment Intention
export async function createPaymentIntention(amount, propertyNumber, packageId) {
  // ...
}

// التحقق من HMAC
export function verifyHmac(requestBody, hmacHeader) {
  // ...
}
```

### المتغيرات المطلوبة
```
PAYMOB_SECRET_KEY     # مفتاح API السري
PAYMOB_PUBLIC_KEY     # المفتاح العام
PAYMOB_HMAC_SECRET    # سر HMAC للتحقق
```

### حالات الدفع
| الحالة | المعنى |
|--------|--------|
| `معلق` | بانتظار الدفع |
| `مكتمل` | تم الدفع بنجاح |
| `فشل` | فشل الدفع |
| `قيد التحقق` | تحويل بنكي بانتظار المراجعة |
| `نجح - قيد التحقق` | بطاقة/Apple Pay ناجحة بانتظار التحقق |

---

## نظام الاشتراكات

### أنواع الاشتراكات
| النوع | الوصف | المميزات |
|-------|-------|----------|
| `عادي` | مجاني | عرض أساسي |
| `مميز` | مدفوع | أولوية في الظهور، شارة "موثوق" |

### حالات الاشتراك
| الحالة | المعنى |
|--------|--------|
| `نشط` | الاشتراك ساري |
| `منتهي` | انتهى الاشتراك |
| `معلق` | بانتظار الدفع |
| `موقوف` | معلق بواسطة الإدارة |
| `ينتهي قريباً` | أقل من 7 أيام |

### حساب تواريخ الاشتراك
```typescript
// في server/dateUtils.ts
export function getStartOfDayRiyadh() { ... }
export function calculateSubscriptionEndDate(startDate, durationDays) { ... }
export function calculateExtensionEndDate(currentEndDate, durationDays) { ... }
export function formatDateRiyadh(date) { ... }
```

---

## تخزين الصور (R2)

### كيف يعمل؟

1. **الصور تُرفع** عبر `/api/images/upload`
2. **تُخزن في Cloudflare R2** (S3-compatible)
3. **الروابط تُحفظ** في Google Sheets

### المتغيرات المطلوبة
```
R2_ACCESS_KEY_ID      # مفتاح الوصول
R2_SECRET_ACCESS_KEY  # المفتاح السري
R2_BUCKET_NAME        # اسم الـ bucket
R2_ENDPOINT           # نقطة النهاية
R2_REGION             # المنطقة
```

### رفع صورة
```typescript
// في server/routes.ts
app.post("/api/images/upload", upload.single("image"), async (req, res) => {
  const { key } = await uploadToR2(buffer, filename);
  // ...
});
```

---

## إشعارات WhatsApp

### أنواع الإشعارات
- إشعار عقار جديد
- إشعار دفعة جديدة
- إشعار رفع إيصال
- إشعار تفعيل اشتراك
- إشعار للمالك عند التفعيل

### ملف whatsapp.ts
```typescript
export async function sendWhatsAppNotification(message) { ... }
export async function notifyNewProperty(data) { ... }
export async function notifyNewPayment(data) { ... }
export async function notifyReceiptUpload(data) { ... }
export async function notifyOwnerSubscriptionActivated(data) { ... }
```

### المتغيرات المطلوبة
```
ENJAZATIK_URL         # رابط API
ENJAZATIK_TOKEN       # التوكن
```

---

## دليل تغيير التصميم

### 1. تغيير الألوان

**الملف:** `client/src/index.css`

```css
:root {
  /* اللون الذهبي الرئيسي */
  --primary: 42 75% 45%; /* #b88d2b */
  
  /* الخلفية */
  --background: 40 15% 97%;
  
  /* النصوص */
  --foreground: 28 38% 25%;
  
  /* البطاقات */
  --card: 40 20% 98%;
  
  /* ألوان خاصة */
  --golden-light: #d4a035;
  --golden-border: #e0c97b;
  --premium-bg: #fffdf0;
  --whatsapp: #25D366;
}
```

**لتغيير اللون الذهبي الرئيسي:**
```css
--primary: 42 75% 45%; /* غيّر هذه القيم */
```

### 2. تغيير الخط

**الملف:** `client/src/index.css`

```css
@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;700&display=swap');

:root {
  --font-sans: 'Cairo', sans-serif;
}
```

**لتغيير الخط:**
1. أضف رابط Google Fonts جديد
2. غيّر `--font-sans`

### 3. تغيير الشعار

**الملفات:**
- `client/src/assets/logo-icon.png` - الشعار الصغير (في Header)
- `client/src/assets/logo-full.png` - الشعار الكامل (في Footer)

**في App.tsx:**
```tsx
import logoIcon from "./assets/logo-icon.png";
import logoFull from "./assets/logo-full.png";

// Header
<img src={logoIcon} alt="روقـان" className="h-[110px] w-auto" />

// Footer
<img src={logoFull} alt="روقـان" className="h-[300px] w-auto" />
```

### 4. تغيير حجم الأزرار

**الملف:** `client/src/components/ui/button.tsx`

```tsx
const buttonVariants = cva(
  "...",
  {
    variants: {
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
  }
);
```

### 5. تغيير نصف القطر (Border Radius)

**الملف:** `client/src/index.css`

```css
:root {
  --radius: 0.625rem; /* 10px */
}
```

---

## دليل إضافة صفحات جديدة

### الخطوات:

#### 1. أنشئ ملف الصفحة
```tsx
// client/src/pages/my-new-page.tsx
export default function MyNewPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold">صفحتي الجديدة</h1>
    </div>
  );
}
```

#### 2. أضف المسار في App.tsx
```tsx
// في الأعلى
import MyNewPage from "@/pages/my-new-page";

// في Router()
<Route path="/my-new-page" component={MyNewPage} />
```

#### 3. (اختياري) أضف رابط في Header
```tsx
// في App.tsx - داخل <nav>
<Button
  variant="ghost"
  size="icon"
  onClick={() => setLocation("/my-new-page")}
  title="صفحتي"
>
  <SomeIcon className="w-5 h-5" />
</Button>
```

### مثال صفحة مع بيانات من API:
```tsx
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function MyDataPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/my-data"],
  });

  if (isLoading) return <div>جاري التحميل...</div>;
  if (error) return <div>خطأ في التحميل</div>;

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <Card>
        <CardHeader>
          <CardTitle>البيانات</CardTitle>
        </CardHeader>
        <CardContent>
          {/* عرض البيانات */}
        </CardContent>
      </Card>
    </div>
  );
}
```

---

## دليل تعديل لوحة الإدارة

### هيكل لوحة الإدارة

**الملف الرئيسي:** `client/src/pages/admin/index.tsx`

```tsx
// الأقسام المتاحة
const sections = [
  { id: "properties", label: "العقارات", icon: Building2 },
  { id: "payments", label: "المدفوعات", icon: CreditCard },
  { id: "subscriptions", label: "الاشتراكات", icon: Calendar },
  { id: "packages", label: "الباقات", icon: Package },
  { id: "discounts", label: "أكواد الخصم", icon: Percent },
  { id: "verification", label: "التحقق", icon: CheckCircle },
  // ...
];
```

### إضافة قسم جديد

#### 1. أنشئ ملف القسم
```tsx
// client/src/pages/admin/sections/my-section.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function MySection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>القسم الجديد</CardTitle>
      </CardHeader>
      <CardContent>
        {/* محتوى القسم */}
      </CardContent>
    </Card>
  );
}
```

#### 2. أضف القسم في index.tsx
```tsx
// استيراد
import MySection from "./sections/my-section";
import { NewIcon } from "lucide-react";

// في sections array
{ id: "my-section", label: "القسم الجديد", icon: NewIcon },

// في renderSection()
case "my-section":
  return <MySection />;
```

### تعديل قسم العقارات
**الملف:** `client/src/pages/admin/sections/properties.tsx`

### تعديل قسم الدفعات
**الملف:** `client/src/pages/admin/sections/payments.tsx`

### تعديل قسم الاشتراكات
**الملف:** `client/src/pages/admin/sections/subscriptions.tsx`

---

## دليل تعديل لوحة المالك

### الملفات الرئيسية

| الملف | الوصف |
|-------|-------|
| `owner-dashboard.tsx` | لوحة التحكم الرئيسية |
| `owner-subscription.tsx` | إدارة الاشتراك |
| `owner-images.tsx` | إدارة الصور |
| `owner-update-property.tsx` | تحديث بيانات العقار |

### تعديل لوحة التحكم الرئيسية

**الملف:** `client/src/pages/owner-dashboard.tsx`

```tsx
// الأقسام الموجودة:
// 1. معلومات العقار الأساسية
// 2. حالة الاشتراك
// 3. الأسعار
// 4. المرافق
// 5. الصور
// 6. إحصائيات WhatsApp
```

### إضافة قسم جديد في Dashboard
```tsx
// في owner-dashboard.tsx
<Card>
  <CardHeader>
    <CardTitle>القسم الجديد</CardTitle>
  </CardHeader>
  <CardContent>
    {/* المحتوى */}
  </CardContent>
</Card>
```

### تعديل صفحة الاشتراك

**الملف:** `client/src/pages/owner-subscription.tsx`

هذا الملف يتضمن:
- عرض حالة الاشتراك الحالي
- اختيار الباقة
- الدفع (Paymob أو تحويل بنكي)
- رفع إيصال التحويل

---

## دليل صفحة العقارات

### الملف
`client/src/pages/properties.tsx`

### الفلاتر المتاحة
```typescript
interface Filters {
  city: string;       // المدينة
  direction: string;  // الاتجاه
  type: string;       // النوع (قسم/قسمين)
  priceRange: string; // نطاق السعر
  facilities: string[]; // المرافق (100 مرفق)
  searchQuery: string;  // البحث
}
```

### إضافة فلتر جديد

#### 1. أضف الحقل في الـ state
```tsx
const [filters, setFilters] = useState({
  // ... الفلاتر الموجودة
  newFilter: "",
});
```

#### 2. أضف عنصر الفلتر في UI
```tsx
<Select
  value={filters.newFilter}
  onValueChange={(v) => setFilters(f => ({ ...f, newFilter: v }))}
>
  <SelectTrigger>
    <SelectValue placeholder="الفلتر الجديد" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="option1">خيار 1</SelectItem>
    <SelectItem value="option2">خيار 2</SelectItem>
  </SelectContent>
</Select>
```

#### 3. أضف منطق الفلترة
```tsx
const filteredProperties = properties.filter(p => {
  // ... الفلاتر الموجودة
  if (filters.newFilter && p.newField !== filters.newFilter) return false;
  return true;
});
```

### تغيير طريقة عرض العقارات

```tsx
// في properties.tsx
// البطاقة الحالية
<Card className="...">
  {/* محتوى البطاقة */}
</Card>

// تغيير التصميم
<Card className="bg-card hover:shadow-lg transition-shadow">
  <CardContent className="p-4">
    {/* تصميم جديد */}
  </CardContent>
</Card>
```

---

## دليل صفحة تفاصيل العقار

### الملف
`client/src/pages/property-details.tsx`

### المكونات الرئيسية

1. **معرض الصور** - عرض الصور بـ carousel
2. **معلومات العقار** - الاسم، الموقع، النوع
3. **الأسعار** - جدول الأسعار
4. **المرافق** - قائمة المرافق (100 مرفق)
5. **زر WhatsApp** - للتواصل

### تعديل معرض الصور
```tsx
// في property-details.tsx
<Carousel className="w-full">
  <CarouselContent>
    {images.map((image, index) => (
      <CarouselItem key={index}>
        <img src={image} alt={`صورة ${index + 1}`} className="..." />
      </CarouselItem>
    ))}
  </CarouselContent>
  <CarouselPrevious />
  <CarouselNext />
</Carousel>
```

### تعديل عرض الأسعار
```tsx
// جدول الأسعار
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>الفترة</TableHead>
      <TableHead>السعر</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>وسط الأسبوع</TableCell>
      <TableCell>{prices.weekday} ر.س</TableCell>
    </TableRow>
    {/* ... */}
  </TableBody>
</Table>
```

---

## المتغيرات والإعدادات

### متغيرات البيئة (Secrets)

| المتغير | الوصف |
|---------|-------|
| `GOOGLE_SHEET_ID` | معرف Google Sheet |
| `PAYMOB_SECRET_KEY` | مفتاح Paymob السري |
| `PAYMOB_PUBLIC_KEY` | مفتاح Paymob العام |
| `PAYMOB_HMAC_SECRET` | سر HMAC |
| `R2_ACCESS_KEY_ID` | مفتاح R2 |
| `R2_SECRET_ACCESS_KEY` | سر R2 |
| `R2_BUCKET_NAME` | اسم الـ bucket |
| `R2_ENDPOINT` | نقطة نهاية R2 |
| `ENJAZATIK_URL` | رابط WhatsApp API |
| `ENJAZATIK_TOKEN` | توكن WhatsApp |
| `WHATSAPP_DELIVERY_WEBHOOK_SECRET` | سر مستقل لمصادقة إشعارات التسليم القادمة من Enjazatik أو مشغّل وسيط |
| `META_WHATSAPP_APP_SECRET` | سر تطبيق Meta للتحقق من توقيع `X-Hub-Signature-256` |
| `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` | رمز عشوائي مستقل للتحقق من اشتراك رابط Meta webhook |

### Feature Flags

في Google Sheet "FeatureFlags":

| Flag | الوصف |
|------|-------|
| `FEATURE_BANK_ACCOUNTS_UI` | عرض تفاصيل الحسابات البنكية |
| `FEATURE_BANK_RECEIPT_REQUIRED` | إلزامية رفع الإيصال |
| `FEATURE_TIMEOUTS` | انتهاء صلاحية الدفعات تلقائياً |
| `FEATURE_OCR_ENABLED` | تفعيل OCR |
| `FEATURE_BANK_AUTO_MATCH` | المطابقة التلقائية |
| `FEATURE_SMART_VERIFICATION` | التحقق الذكي |

---

## استكشاف الأخطاء

### مشاكل شائعة

#### 1. الصفحة لا تظهر
- تأكد من إضافة المسار في `App.tsx`
- تأكد من استيراد الصفحة بشكل صحيح

#### 2. خطأ في API
- تحقق من Console في المتصفح
- تحقق من سجلات الخادم
- تأكد من أن الـ endpoint موجود في `routes.ts`

#### 3. الألوان لا تتغير
- تأكد من تحديث `index.css`
- أعد تشغيل الخادم
- امسح الكاش في المتصفح

#### 4. الصور لا تظهر
- تأكد من إعدادات R2
- تحقق من الروابط في Google Sheet
- تأكد من صلاحيات الـ bucket

#### 5. الدفع لا يعمل
- تأكد من إعدادات Paymob
- تحقق من Webhook URL
- راجع سجلات Paymob

### أوامر مفيدة

```bash
# تشغيل المشروع
npm run dev

# فحص TypeScript
npm run check

# بناء للإنتاج
npm run build
```

### سجلات الأخطاء

- **Frontend**: Console في المتصفح (F12)
- **Backend**: Terminal أو سجلات Replit

---

## ملاحظات إضافية

### التوقيت
- **الخادم**: يستخدم UTC
- **العرض**: يُحوّل للتوقيت السعودي (Asia/Riyadh)
- **التخزين**: epoch milliseconds أو ISO strings

### الأمان
- لا تكشف المفاتيح السرية أبداً
- استخدم HMAC للتحقق من Webhooks
- تحقق من صلاحيات المستخدم

### الأداء
- استخدم React Query للكاش
- لا تجلب بيانات غير ضرورية
- استخدم pagination للقوائم الطويلة

---

**آخر تحديث:** يناير 2026

**المشروع:** روقـان - نظام إدارة العقارات

**الإصدار:** 4.1.19
