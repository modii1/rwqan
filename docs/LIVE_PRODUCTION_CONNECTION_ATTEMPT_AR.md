# محاولة ربط LIVE ببيانات الإنتاج — النتيجة والعائق المحدد

> الطلب: استخدام **إعدادات الاتصال الموجودة أصلًا** في إنتاج `rwqan.sa` لربط نسخة التطوير
> بقاعدة بيانات الإنتاج للقراءة فقط.
>
> **النتيجة: لا تتوفر أي بيانات اعتماد قراءة إنتاج متاحة لنسخة التطوير. LIVE بقي معطّلًا
> (فشل مغلق). لم يتم الاتصال بأي بيانات إنتاج.**

---

## 1. ما تستخدمه الإنتاج فعلًا (من مراجع غير سرّية)

| المكوّن | القيمة | المصدر |
|---|---|---|
| مشروع Firebase | `rwqan-757` | `.firebaserc`، الوثائق. |
| خلفية الاستضافة | `rwqan-backend` (App Hosting / Cloud Run) | `firebase.json`، `apphosting.yaml`. |
| قاعدة البيانات | Cloud Firestore (مشروع `rwqan-757`) | قواعد/وثائق. |
| قواعد أمان Firestore | `allow read, write: if false;` (رفض كل شيء) | `firestore.rules`. |
| تخزين الصور | R2، الرابط العام `https://pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev` | `server/utils/r2.ts`. |
| بيانات الاعتماد في الإنتاج | **ADC (حساب الخدمة المرفق) على Cloud Run** | `apphosting.yaml` لا يضبط `GOOGLE_APPLICATION_CREDENTIALS`/`serviceAccount`. |

## 2. البحث عن بيانات اعتماد متاحة (في نسخة التطوير فقط)

| ما فُحص | النتيجة |
|---|---|
| ملفات JSON لحسابات الخدمة (`private_key`) في المشروع | **لا يوجد** (فقط ملفات إعداد مثل `firebase.json`/`firestore.indexes.json`). |
| ملفات `.env` | فقط `.env.development.local` (DEV) و`.env.template`. **لا يوجد `.env.production`**. |
| إعداد Firebase للعميل (`NEXT_PUBLIC_FIREBASE`/`apiKey`/…) | **لا يوجد**. |
| `LIVE_*` في بيئة التطوير | **لا يوجد** (لا `LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT` ولا `LIVE_FIREBASE_PROJECT_ID` ولا `LIVE_R2_*`). |
| ADC / `GOOGLE_APPLICATION_CREDENTIALS` / gcloud | **غير متاح محليًا** (سيرفر تطوير على Windows، لا يوجد metadata server). |
| مجلد الإنتاج `C:\Users\zerof\Desktop\rwqan-sa` | **لم يُمس** (ممنوع). |

**الخلاصة:** الإنتاج يقرأ بياناته عبر **ADC على مثيل Cloud Run**، وهذه الهوية غير
متاحة لسيرفر التطوير المحلي. لا توجد أي مفتاح/رمز قراءة إنتاج في متناول نسخة التطوير.

## 3. لماذا لا يمكن الاتصال حتى عبر واجهة العميل

قواعد أمان Firestore للإنتاج هي `allow read, write: if false;` — أي **رفض كل الوصول**
(قراءة وكتابة) حتى عبر مكتبة العميل. فلا يوجد مسار قراءة بديل بدون هوية خدمة.

## 4. حالة LIVE الحالية (مُتحقق منها من الخادم)

```
GET /api/admin/live/status → environment=TEST, liveAvailable=false
reason: متطلَّب LIVE_DATA_READONLY_ACK="read-only" للتأكيد الصريح على أن الاتصال قراءة فقط.
```

LIVE **معطّل عمدًا** (فشل مغلق). لم يُقرأ أي بيانات إنتاج.

## 5. العائق المحدد والخطوة اليدوية المطلوبة (من مالك المشروع)

**العائق:** لا توجد هوية قراءة لمشروع الإنتاج `rwqan-757` متاحة لسيرفر التطوير المحلي.

**الإجراء اليدوي المطلوب (لا أستطيع تنفيذه):**
1. إنشاء **حساب خدمة قراءة فقط** على `rwqan-757` بالدور `roles/datastore.viewer`
   (أو دور مخصص باذنَين `datastore.entities.get` + `list`). تنزيل مفتاحه.
2. (اختياري للصور) **رمز R2 قراءة فقط** (`ListObjectsV2` + `GetObject`).
3. إضافتها إلى `.env.development.local` في التطوير:
   `LIVE_DATA_READONLY_ACK`, `LIVE_FIREBASE_PROJECT_ID=rwqan-757`,
   `LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT`, و(`LIVE_R2_*`).
4. إعادة تشغيل سيرفر التطوير والتحقق من `liveAvailable=true` و`liveProjectId=rwqan-757`.

حتى توفيرها: **LIVE يبقى معطّلًا**، و`TEST` يعمل على `rwqan-sa-dev`.

## 6. إعدادات غير سرّية تم ضبطها في التطوير (معزولة عن TEST)

لا توجد إعدادات غير سرّية تكفي لتفعيل قراءة إنتاج (الرابط العام لـ R2 لا يكفي لسرد/قراءة
الصور بدون مفاتيح موجودة في Firestore أو رمز سرد). لذلك **لم أضبط أي إعداد يتيح وصولًا**
وظللت على بيانات الاعتماد فقط.

## 7. الحماية والالتزام

- **لم يُمس** مجلد الإنتاج `C:\Users\zerof\Desktop\rwqan-sa`.
- **لم** تُغيّر صلاحيات الإنتاج أو أسراره. **لم** يُنفَّذ نشر أو `commit`/`push`.
- **لم** تُخترع أو تُنسخ أو تُطبع مفاتيح.
- LIVE للقراءة فقط (الحارس `wrapReadOnlyFirestore` + `LIVE_WRITE_MODE=read-only`).
- **لا fallback صامت:** عند فشل LIVE يبقى الخادم على TEST ويعرض السبب الحقيقي.

## 8. معيار نجاح الاتصال (لم يتحقق)

يُعتبر الاتصال ناجحًا **فقط** عند: توفير الاعتماديات اليدوية (§5)، وإعادة التشغيل،
و**قراءة فعلية** من `properties`/`subscriptions` لمشروع `rwqan-757` عبر
`/api/admin/live/status` (حيث `liveAvailable=true` و`liveProjectId=rwqan-757`). لم يتحقق
أي مما سبق — **الاتصال غير ناجح، وLIVE معطّل.**
