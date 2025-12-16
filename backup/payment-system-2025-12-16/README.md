# نسخة احتياطية لنظام الدفع - 16 ديسمبر 2025

## الملفات المحفوظة

| الملف | الوصف |
|-------|-------|
| `routes.ts` | كل الـ API endpoints للدفع والـ webhook |
| `paymob.ts` | خدمة Paymob (إنشاء الدفع، الاستعلام) |
| `googleSheets.ts` | خدمة Google Sheets (حفظ المدفوعات والاشتراكات) |
| `storage.ts` | واجهة التخزين |
| `schema.ts` | تعريفات البيانات |
| `subscription.tsx` | صفحة التسجيل الجديد |
| `owner-subscription.tsx` | صفحة اشتراك المالك (ترقية/تمديد) |
| `owner-dashboard.tsx` | لوحة المالك |
| `admin-payments.tsx` | قسم المدفوعات في لوحة الأدمن |
| `admin-verification.tsx` | قسم التحقق في لوحة الأدمن |

---

## سيناريوهات الدفع

### 1. تسجيل جديد (action: 'new')
- المالك يسجل عقار جديد ويختار باقة مدفوعة
- يتوجه لبوابة Paymob ويكمل الدفع
- عند نجاح الدفع: الحالة = "نجح - قيد التحقق"
- تصل رسالة WhatsApp للأدمن
- الأدمن يراجع العقار ويفعّل الاشتراك من لوحة التحقق

### 2. ترقية اشتراك (action: 'upgrade')
- المالك يختار "ترقية" من لوحته
- يتوجه لبوابة Paymob ويكمل الدفع
- عند نجاح الدفع: الحالة = "مكتمل"
- يتفعل الاشتراك تلقائياً

### 3. تمديد اشتراك (action: 'extend')
- المالك يختار "تمديد" من لوحته
- يتوجه لبوابة Paymob ويكمل الدفع
- عند نجاح الدفع: الحالة = "مكتمل"
- يتفعل الاشتراك تلقائياً (يبدأ من نهاية الاشتراك الحالي)

---

## الإعدادات المطلوبة (Secrets)

```
PAYMOB_API_KEY=...
PAYMOB_PUBLIC_KEY=...
PAYMOB_INTEGRATION_ID_CARDS=...
PAYMOB_HMAC_SECRET=...
```

## رابط Webhook
```
https://rwqan.replit.app/api/paymob/webhook
```

---

## API Endpoints للدفع

| Endpoint | Method | الوصف |
|----------|--------|-------|
| `/api/owner/payment/initiate` | POST | بدء دفع جديد |
| `/api/owner/payment/retry` | POST | إعادة محاولة دفع معلق |
| `/api/owner/payment/bank-transfer` | POST | دفع بتحويل بنكي |
| `/api/owner/payment/upload-receipt` | POST | رفع إيصال لدفعة معلقة |
| `/api/paymob/webhook` | POST | استقبال Webhook من Paymob |
| `/api/admin/payments` | GET | جلب كل المدفوعات |
| `/api/admin/payments/:id/approve` | POST | الموافقة على دفعة |

---

## كيفية استعادة النسخة

1. انسخ الملف المطلوب من هذا المجلد
2. استبدل الملف الأصلي في المسار الصحيح:
   - `routes.ts` → `server/routes.ts`
   - `paymob.ts` → `server/paymob.ts`
   - `googleSheets.ts` → `server/googleSheets.ts`
   - `subscription.tsx` → `client/src/pages/subscription.tsx`
   - وهكذا...
3. أعد تشغيل السيرفر

---

## تاريخ النسخة
- **التاريخ**: 16 ديسمبر 2025
- **الوقت**: 18:37 UTC
- **Commit**: 969d02016372800d811dc69fa5a7b31c68b8f592
