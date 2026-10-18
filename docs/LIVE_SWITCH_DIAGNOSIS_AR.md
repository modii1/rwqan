# تشخيص تعليق مفتاح TEST/LIVE في شريط RWQAN DEPLOY

## السبب الجذري (مع الأدلة)

الشريط كان يعرض مؤشرين مختلفين للبيئة دون فصل واضح:

1. **شارة نظام النشر** (`data-testid="deploy-bar-environment"`) كانت تعرض
   `البيئة: LIVE` — وهذا هو **بيئة نظام النشر (النشر/الإصدارات)**، لا بيئة البيانات.
   قيمتها مُخزَّنة في Firestore DEV وكانت `LIVE` (مضبوطة سابقًا عبر
   `POST /api/admin/deploy/environment`، وهي تظهر في سجل التدقيق `audit` تحت
   `action: "environment_changed", environment: "LIVE"`).

2. **محدد بيئة البيانات** (`data-testid="deploy-bar-data-environment"`) كان يعرض
   `بيانات: TEST` بشكل صحيح — لأن بيئة البيانات هي `TEST`.

الدليل الفعلي من الخادم:
- `GET /api/admin/deploy/state` ← `"state": { "environment": "LIVE" }`.
- `GET /api/admin/live/status` ← `"environment": "TEST"`, `"activeProjectId": "rwqan-sa-dev"`.

أي أن الواجهة لم تكن "معلّقة على LIVE" من ناحية البيانات؛ بل **شارة النشر كانت
تقرأ `LIVE` من مخزن نظام النشر، وتُعرض بنفس تسمية "البيئة:" بجانب محدد البيانات**،
فظنّ المستخدم أن التطبيق عالق على LIVE.

سبب إضافي مرتبط: محدد البيانات كان يعرض تسميات مكرّرة (`بيانات:` + شارة
`بيانات: TEST` + زرّا TEST/LIVE متلاصقين)، فظهر نص مثل `TESTLIVE`.

## الملفات والأسطر التي فُحصت أو عُدّلت

| الملف | الفحص/التعديل |
|---|---|
| `src/components/deploy-bar.tsx` | إعادة تسمية شارة النشر إلى `بيئة النشر:`؛ فصل محدد بيئة البيانات بصريًا (تحكم مجزأ TEST/LIVE مع فاصل)؛ إظهار مصدر البيانات الفعلي؛ تحسين رسالة فشل LIVE لعرض السبب الحقيقي المُ解析 من الاستجابة. |
| `src/components/deploy-bar.test.ts` | تحديث تسمية شارة النشر في الاختبار؛ إضافة اختبار فصل المؤشرين وإظهار سبب الخطأ. |
| `server/routes/admin/live.ts` | فحص: المسار صحيح، يفشل مغلقًا عند عدم توفر إعداد LIVE. |
| `server/config/dataEnvironment.ts` | فحص: `getActiveFirestore()` و`activeFirestore` و`getActiveFirestoreProjectId()` صحيحة. |
| `server/services/LiveDataEnvironmentStore.ts` | فحص: مخزن في الذاكرة، الافتراضي `TEST`. |
| `server/routes/index.ts` | فحص تسجيل المسارات. |
| `server/config/firebase.ts` | فحص مصنع Firestore للتطبيقين (DEV/LIVE). |

## حالة طلب التحويل واستجابته الفعلية

بعد إعادة تشغيل الخادم وإعادة ضبط بيئة النشر إلى `TEST`:

| الخطوة | الاستجابة |
|---|---|
| الحالة الابتدائية | `TEST` / `activeProjectId=rwqan-sa-dev` |
| `POST /api/admin/live/environment {LIVE}` | `503 {"code":"LIVE_DATA_UNAVAILABLE","reason":"متطلَّب: LIVE_DATA_READONLY_ACK=read-only ..."}` |
| الحالة بعد فشل LIVE | `TEST` / `activeProjectId=rwqan-sa-dev` (لم تتغير) |
| `POST /api/admin/live/environment {TEST}` | `200` |
| الحالة النهائية | `TEST` / `activeProjectId=rwqan-sa-dev` |

## هل قرأ LIVE بيانات حقيقية؟

**لا.** فشل LIVE **قبل** الاتصال بالإنتاج لأنه لا تتوفر اعتماديات قراءة إنتاج
(`LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT` / `LIVE_FIREBASE_PROJECT_ID` /
`LIVE_DATA_READONLY_ACK`). هذا هو سلوك "الفشل المغلق" الصحيح: لا يُقرأ مشروع
التطوير بديلًا صامتًا عن الإنتاج، ولا يُعرض LIVE كأنه متصل.

## هل أُعيد تشغيل الخادم؟

نعم. أُوقف سيرفر التطوير على المنفذ `5001` (PID قديم) وأُعيد تشغيله بنفس المشروع.
سطر التشغيل: `[RWQAN] بيئة البيانات النشطة: TEST · مشروع Firestore الفعلي: rwqan-sa-dev`.

## نتائج الاختبارات

- `npx tsc --noEmit`: **نظيف (0 أخطاء)**.
- الاختبارات الكاملة: **991 اختبار، 990 ناجح، 1 فشل سابق غير متعلق**
  (`server/services/BookingCommissionStore.test.ts` — توقّق قديم ينقصه حقول
  `provider*`، ولا علاقة له بهذا العمل).

## العائق المتبقّي والخطوة المحددة

LIVE للقراءة فقط، ويتطلب **اعتماديات قراءة إنتاج آمنة** غير متوفرة حاليًا:

1. إنشاء/توفير **حساب خدمة Firebase بصلاحية قراءة فقط** لمشروع الإنتاج
   (مختلف عن `FIREBASE_SERVICE_ACCOUNT` الأساسي)، وتوفيره في متغيرات البيئة:
   - `LIVE_DATA_READONLY_ACK=read-only`
   - `LIVE_FIREBASE_PROJECT_ID=<مشروع الإنتاج>`
   - `LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT='<JSON>'`
2. (اختياري للصور) `LIVE_R2_ENDPOINT` / `LIVE_R2_ACCESS_KEY_ID` /
   `LIVE_R2_SECRET_ACCESS_KEY` / `LIVE_R2_BUCKET_NAME` / `LIVE_R2_PUBLIC_URL`.

بعد توفيرها وإعادة تشغيل الخادم، سيصبح زر LIVE قابلًا للاستخدام، وسيتحول التطبيق
كاملًا (Firestore + R2) إلى الإنتاج بوضع قراءة فقط. حتى ذلك الحين يبقى LIVE
معطّلًا عمدًا (فشل مغلق)، و`TEST` يعمل على `rwqan-sa-dev`.

## القيود الملتزم بها

- لم يُلمس مجلد الإنتاج `C:\Users\zerof\Desktop\rwqan-sa`.
- لا كتابة/تعديل/حذف على بيانات الإنتاج؛ لا مدفوعات أو رسائل حقيقية؛ لا نشر.
- لا commit / push / deploy.
- LIVE للقراءة فقط (`LIVE_WRITE_MODE` غير مفعّل).
