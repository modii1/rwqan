# دليل إعداد Paymob للدفع الإلكتروني

## 🔑 الخطوات للحصول على مفاتيح Paymob API

### الخطوة 1: إنشاء حساب Paymob
1. اذهب إلى: https://dashboard.paymob.com
2. اضغط "إنشاء حساب جديد"
3. أدخل:
   - البريد الإلكتروني
   - كلمة المرور
   - بيانات الشركة/المتجر

### الخطوة 2: التحقق والتفعيل
- تحقق من بريدك الإلكتروني
- اتمم بيانات الشركة
- وافق على الشروط والأحكام

### الخطوة 3: الحصول على API Keys
1. من لوحة التحكم، اذهب إلى: **Settings** أو **API Keys**
2. ستجد:
   - **Secret Key** (المفتاح السري) - لا تشاركه مع أحد ✅
   - **Public Key** (المفتاح العام) - يمكن استخدامه في الـ Frontend

### الخطوة 4: إعداد Payment Integrations (طرق الدفع)
1. اذهب إلى: **Payment Integrations**
2. اختر **Payment Gateway**
3. للبطاقات الائتمانية:
   - ستجد **Integration ID for Cards**
   - مثال: `15650`
4. لـ Apple Pay:
   - ستجد **Integration ID for Apple Pay**
   - مثال: `15649`

### الخطوة 5: إضافة المفاتيح إلى Replit
في Replit، اذهب إلى **Secrets** وأضف:

```
PAYMOB_API_KEY = [Secret Key من Paymob]
PAYMOB_PUBLIC_KEY = [Public Key من Paymob]
PAYMOB_HMAC_SECRET = [HMAC Secret للتحقق من الـ Webhooks]
PAYMOB_INTEGRATION_ID_CARDS = 15650
PAYMOB_INTEGRATION_ID_APPLEPAY = 15649
```

---

## 📊 API الحساب الجديد

### Endpoint: `POST /api/payment/calculate`

**الطلب:**
```json
{
  "packageId": "PKG-001",
  "discountCode": "SAVE10"
}
```

**الرد:**
```json
{
  "package": {
    "id": "PKG-001",
    "name": "اشتراك شهر",
    "duration": 30,
    "type": "موثوق"
  },
  "pricing": {
    "basePrice": 35,
    "discountCode": "SAVE10",
    "discountInfo": {
      "code": "SAVE10",
      "type": "نسبة",
      "value": 10
    },
    "discountAmount": 3.5,
    "priceAfterDiscount": 31.5,
    "paymobFee": 0.79,
    "total": 32.29
  },
  "breakdown": {
    "السعر الأساسي": "35 ر.س",
    "الخصم": "-3.5 ر.س",
    "السعر بعد الخصم": "31.5 ر.س",
    "عمولة Paymob (2.5%)": "0.79 ر.س",
    "الإجمالي": "32.29 ر.س"
  }
}
```

---

## 💻 مثال على الاستخدام

```javascript
// حساب السعر قبل الدفع
const response = await fetch('/api/payment/calculate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    packageId: 'PKG-001',
    discountCode: 'SAVE10'
  })
});

const result = await response.json();
console.log('السعر الكلي:', result.pricing.total);
```

---

## ⚙️ عمولة Paymob

حالياً معدلة على **2.5%**. يمكن تغييرها في:
```
server/routes.ts → السطر 870
const PAYMOB_FEE_PERCENTAGE = 0.025; // 2.5%
```

تواصل مع Paymob للتأكد من النسبة الفعلية لحسابك!

---

## 🧪 اختبار الـ API

```bash
curl -X POST http://localhost:5000/api/payment/calculate \
  -H "Content-Type: application/json" \
  -d '{"packageId":"PKG-001"}'
```

---

## 📞 تواصل Paymob Support
- الموقع: https://paymob.com
- البريد: support@paymob.com
- الهاتف: +966 (حسب الدول)
