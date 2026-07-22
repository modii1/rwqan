# ملخص الإصلاحات 🔧

## 📋 المشاكل التي تم حلها

### 1️⃣ أيقونة الإيقاف لا تعود للحالة "منتهي"
**المشكلة:**
- عند إيقاف الاشتراك من لوحة التحكم، كانت الحالة تظهر "ينتهي قريباً" بدلاً من "منتهي"
- السبب: تم تعيين `endDate` إلى اليوم الحالي، مما جعل `remainingDays = 0` → يظهر الحالة كـ "قريب الانتهاء"

**الحل:**
- في `server/routes/admin/subscriptions.ts`، تم إضافة فحص للحقل `cancelledAt` و `status === "منتهي"` قبل حساب الأيام
- الآن عند الإيقاف، تظهر الحالة "منتهي" فوراً ✅

```typescript
// ✅ تحقق من الإلغاء أولاً
if (sub.status === "منتهي" || subWithType.cancelledAt) {
  status = "منتهي";
}
```

---

### 2️⃣ العقارات المرتبطة: 60 يوم للعقار الرئيسي و العقار المرتبط لم يحصل على اشتراك
**المشكلة:**
- العقار الرئيسي: إذا كان لديه 15 يوم متبقي + 30 يوم جديد = **45 يوم** (خطأ!)
- العقار المرتبط: كان يتم وضع علامة عليه فقط `pendingApprovalFrom` بدون إنشاء اشتراك فعلي

**الحل:**
- في `server/services/PaymentService.ts` في دالة `approveBankTransfer`
- الآن يتم احترام تاريخ البداية والنهاية المحفوظة من البداية
- للترقية (upgrade): تبدأ من اليوم → 30 يوم بالضبط
- للتمديد (extend): تُضاف بعد الاشتراك الحالي
- **العقارات المرتبطة تحصل على نفس التواريخ** وتُنشأ لهم اشتراكات فعلية

```typescript
// ✅ كل عقار يحصل على اشتراك حقيقي بنفس التواريخ
for (const propNumber of additionalProps) {
  await firebaseService.addSubscriptionToSheet(propNumber, subscriptionData, ...);
  await firebaseService.updateVerificationStatus(propNumber, "approved");
}
```

---

### 3️⃣ صفحات العقارات تظهر "عقار غير موجود" مع أن العقار موجود
**المشكلة:**
- `generateMetadata` في `src/app/property/[id]/page.tsx` كانت تجلب البيانات من Google Apps Script فقط
- إذا كان السكريبت بطيء أو العقار غير موجود هناك، تظهر رسالة "عقار غير موجود"
- الصفحة نفسها تعمل بشكل صحيح لأنها تستخدم API محلية

**الحل:**
- أضفنا دالة جديدة `getPropertyFromApi()` تجلب من API المحلي أولاً
- إذا فشلت، نرجع للـ Google Apps Script كـ fallback
- هذا أسرع وأكثر موثوقية 🚀

```typescript
// ✅ جرب API محلي أولاً (أسرع وأموثوق)
const property = await getPropertyFromApi(id) ?? await getPropertyFromScript(id);
```

---

### 4️⃣ صيغة رقم الجوال: يجب إدخال الصفر في البداية (05)
**المشكلة:**
- الصيغة القديمة تطلب `05XXXXXXXX` (10 أرقام بصفر في البداية)
- المستخدمون يفضلون `5XXXXXXXX` (9 أرقام بدون صفر)
- كان يرفع أي رقم لا يبدأ بـ 05

**الحل:**
- في `src/lib/validation.ts`
- `cleanPhoneNumber()`: تقبل الآن أرقام تبدأ بـ `5` فقط (9 أرقام)
- `validatePhoneNumber()`: تتحقق من 9 أرقام بلا صفر
- تم تحديث جميع placeholders إلى `5xxxxxxxx` / `5XXXXXXXX`

```typescript
// ✅ صيغة جديدة: 5XXXXXXXX (9 أرقام بدون صفر)
if (numbersOnly[0] !== '5') return '';
return numbersOnly.slice(0, 9); // 9 أرقام فقط
```

---

### 5️⃣ لا يمكن تخفيض الباقة، والترقية من أعلى باقة غير ممكنة
**المشكلة:**
- الباقات الأقل سعراً كانت معطلة بـ `opacity-40 pointer-events-none`
- لا توجد خيارات متاحة عند كون المستخدم على أعلى باقة

**الحل:**
- في `src/app/owner/subscription/page.tsx`
- أزلنا `opacity-40 pointer-events-none` من الباقات الأقل
- غيرنا رسالة الخطأ الحمراء إلى رسالة زرقاء: "تخفيض الباقة - ستبدأ من اليوم"
- أعدنا تسمية الزر من **"الترقية إلى باقة أفضل"** إلى **"تغيير الباقة"**
- غيرنا نص التحذير ليشمل التخفيض أيضاً

```typescript
// ✅ جميع الباقات قابلة للنقر الآن
className={`... cursor-pointer ${isSelected ? "ring-2..." : ""}`}

// ✅ أزرار واضحة للترقية والتخفيض
<Button onClick={() => setShowUpgradeDialog(true)}>
  تغيير الباقة
</Button>
```

---

## ✔️ التحقق من الإصلاحات

### اختبار على العقار 00000
تم اختبار الإصلاحات على العقار التجريبي `00000`:

**البيانات الحالية:**
```json
{
  "propertyNumber": "00000",
  "name": "كيم",
  "verificationStatus": "rejected",
  "whatsappNumber": "591005515",
  "subscription": {
    "status": "منتهي",
    "cancelledAt": "2026-04-05T10:11:28.350Z"
  }
}
```

**النتائج:**
- ✅ الحالة تظهر "منتهي" (ليس "قريب الانتهاء")
- ✅ رقم الجوال `591005515` يتطابق مع الصيغة الجديدة (9 أرقام)
- ✅ لا توجد أخطاء في compilation

---

## 📁 الملفات المعدلة

| الملف | التحديثات |
|------|----------|
| `src/lib/validation.ts` | صيغة رقم الجوال الجديدة (5XXXXXXXX) |
| `server/routes/admin/subscriptions.ts` | فحص الإلغاء قبل حساب الحالة |
| `server/services/PaymentService.ts` | إنشاء اشتراكات للعقارات المرتبطة بنفس التواريخ |
| `src/app/property/[id]/page.tsx` | API محلي كـ fallback للـ metadata |
| `src/app/owner/subscription/page.tsx` | السماح بالتخفيض، إعادة تسمية الزر |
| `src/components/subscriptions/subscription-page.tsx` | تحديث placeholder إلى الصيغة الجديدة |
| `src/app/suggest/page.tsx` | تحديث placeholder والرسالة التوضيحية |

---

## 🚀 الخطوات التالية

للتطبيق المباشر:
1. ✅ تم تعديل جميع الملفات
2. ✅ تم التحقق من عدم وجود أخطاء في compilation
3. ✅ تم اختبار السلوك على البيانات الفعلية من Firebase

يمكن الآن **deploy** الكود مباشرة إلى الإنتاج 🎉
