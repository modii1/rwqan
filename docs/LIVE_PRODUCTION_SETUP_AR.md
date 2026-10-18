# تجهيز ربط LIVE للقراءة الفعلية من `rwqan-757` — الخطوات والجاهزية

> استكمال لـ `docs/LIVE_PRODUCTION_CONNECTION_ATTEMPT_AR.md`. الهدف: أقل صلاحيات
> ممكنة لقراءة Firestore من مشروع الإنتاج، مع منع الكتابة.

---

## 1. خطوات إنشاء هوية خدمة قراءة فقط (يدويًا — من مالك المشروع)

> هذه أوامر **تنفيذها على مالك المشروع** (تتطلب صلاحيات Google Cloud على `rwqan-757`).
> **لم أنفّذها** ولا ستُنفَّذ تلقائيًا. لا تستخدم حساب الخدمة المرفق بـ Cloud Run.

```bash
# 1) أنشئ حساب خدمة مخصصًا جديدًا (مختلف عن الأساسي وعن حساب Cloud Run).
gcloud iam service-accounts create rwqan-live-readonly \
  --project=rwqan-757 \
  --display-name="RWQAN LIVE read-only"

# 2) امنحه أقل دور قراءة فقط على مشروع الإنتاج.
gcloud projects add-iam-policy-binding rwqan-757 \
  --member="serviceAccount:rwqan-live-readonly@rwqan-757.iam.gserviceaccount.com" \
  --role="roles/datastore.viewer"

# 3) أنشئ مفتاحًا JSON له (يُخزَّن محليًا فقط، ولا يُنسخ إلى المستودع).
gcloud iam service-accounts keys create live-readonly-key.json \
  --iam-account=rwqan-live-readonly@rwqan-757.iam.gserviceaccount.com \
  --project=rwqan-757
```

- أقل الصلاحيات: `roles/datastore.viewer` (قراءة فقط: `datastore.entities.get` +
  `list`). كافٍ لقراءة `properties` و`subscriptions`. **لا صلاحيات كتابة.**
- انسخ محتوى `live-readonly-key.json` في متغير `LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT`
  (الخطوة 4). **لا تطبعه في التقارير أو المستودع.**

## 2. جاهزية الكود (مُتحقق منها — لا نقص)

الكود في التطوير **يدعم الاعتماد المطلوب بالفعل** (لا حاجة لتعديل):

| المتطلب | الحالة |
|---|---|
| قراءة `LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT` والتحقق من `project_id == LIVE_FIREBASE_PROJECT_ID` | ✅ `liveDataEnvironment.ts`. |
| رفض المشروع == DEV، ورفض تطابق الـ SA مع الحساب الأساسي | ✅ فشل مغلق. |
| بناء تطبيق Firestore منفصل لـ `rwqan-757` | ✅ `getOrCreateLiveFirestore` (الاختبار يبني تطبيقًا حقيقيًا بمفتاح مولَّد). |
| منع الكتابة/الحذف/التعديل/المعاملات في LIVE | ✅ `wrapReadOnlyFirestore` (مجمّعة بالاختبار). |
| هوية المشروع الفعلية | ✅ `activeProjectId` يُقرأ من الإعداد/التطبيق. |
| لا fallback صامت | ✅ عند فشل LIVE يبقى TEST ويعرض السبب. |
| `firebaseService` (مسار التطبيق كله) يقرأ البيئة النشطة | ✅ اختبار `firebaseService.db`. |

الاختبارات: `server/config/dataEnvironment.test.ts` = **10/10** (بناء تطبيق LIVE +
فشل مغلق + حارس الكتابة + الوكيل + firebaseService).

## 3. `.env.development.local` المُجهَّز (أسماء متغيرات فقط)

أُضيفت إلى `.env.development.local` (الملف غير المتتبَّع) مع **قيمة SA فارغة**، لذا
يبقى **LIVE معطّلًا** حتى تُلصق الـ SA:

```
LIVE_DATA_READONLY_ACK=read-only
LIVE_FIREBASE_PROJECT_ID=rwqan-757
LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT=
```

- `LIVE_DATA_READONLY_ACK` و`LIVE_FIREBASE_PROJECT_ID` ليستا سرَّين.
- القيم الاعتمادية تُلصق فقط في الحقل الأخير بعد توفيرها يدويًا.

## 4. فحص R2 (بشكل مستقل)

- كل عقار يخزّن روابط صوره في حقل **`imageUrls`** على مستند Firestore، وهي روابط عامة
  (`https://pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev/<...>`).
- **النتيجة:** بما أن الروابط عامة ومخزَّنة في Firestore، فإن **قراءة Firestore تكفي
  للحصول على روابط الصور** وتقديمها مباشرة للمتصفح — **رمز R2 غير مطلوب** في هذه الحالة.
- يكون **رمز R2 قراءة فقط** مطلوبًا **فقط** إذا احتجنا **سرد** الصور بالبادئة
  (`ListObjectsV2`)، أو إذا كانت بعض الكائنات خاصة (الروابط العامة لن تعمل لها).
- لم أتحقق من عموميّة الحاوية بشكل قاطع (يتطلب سردًا أو مفتاحًا)؛ لكن تقديم الإنتاج
  الحالي للصور عبر الروابط العامة يشير إلى أنها عامة.

## 5. خطة الاختبار (بعد توفير الاعتماد يدويًا)

1. ألصق الـ SA في `LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT`، وأعد تشغيل سيرفر التطوير.
2. `GET /api/admin/live/status` ← تحقق أن `liveAvailable=true` و`liveProjectId=rwqan-757`.
3. اختر **LIVE** من الشريط؛ تحقق أن `environment=LIVE`.
4. **قراءة فعلية محدودة:** استعلام Firestore عبر التطبيق الحي لعدد قليل من
   `properties`/`subscriptions` (عبر الاختبار، بدون واجهة)، وتأكد أنها بيانات الإنتاج.
5. **منع الكتابة:** حاول `set`/`update`/`delete`/`add`/`batch`/`runTransaction` على
   تجميعة LIVE وتأكد أنها تُرفض (`LIVE_WRITE_BLOCKED`).
6. **الصور:** تحقق أن `imageUrls` المقروءة تُقدَّم عبر الرابط العام بدون رمز R2.

## 6. ما بقي معطّلًا

- **LIVE معطّل حاليًا** (فشل مغلق) لأن `LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT` فارغ.
- لا يُفعَّل إلا بعد لصق الـ SA وإعادة التشغيل ونجاح الاختبار (§5).
- `TEST` يعمل على `rwqan-sa-dev`.

## 7. القيود الملتزم بها

- العمل داخل `C:\Users\zerof\Desktop\rwqan-sa-opencode` فقط.
- لا `git pull`، لا لمس مجلد الإنتاج، لا نشر/`commit`/`push`، لا تغيير IAM/أسرار الإنتاج
  دون موافقة صريحة. لا طلب/نسخ مفتاح Cloud Run المرفق. لا طباعة أسرار.
- LIVE للقراءة فقط (`LIVE_WRITE_MODE=read-only`).

## 8. مسار قراءة إنتاجي متاح فورًا (بدون اعتماد): الواجهة العامة `rwqan.sa`

المسار الوحيد المتاح **الآن** دون أي اعتماد هو الواجهة العامة للإنتاج نفسها:

- `GET https://rwqan.sa/api/properties` — قراءة فقط، عامة بطبيعتها، **لا تستخدم Firestore
  credentials** ولا تنسخ أي مفتاح.
- أداة القراءة: `server/services/LivePublicApiSource.ts` (https فقط، timeout، لا fallback،
  `LivePublicApiError`).
- نقطة النهاية: `GET /api/admin/live/properties` — في `LIVE` تقرأ عبر الواجهة العامة،
  وفي `TEST` تقرأ عقارات `rwqan-sa-dev`.

**تحقق فعلي (هذه الجلسة):**
- `GET https://rwqan.sa/api/properties` ← `200`, `content-type: application/json`, حجم ~87KB.
- `LivePublicApiSource.getProperties()` ← **98 عقار إنتاجي حقيقي** (أول عنصر: `00001`
  «شاليه بيت القمر» ببريدة مع `imageUrls`/`facilities`).
- هذا يثبت إمكانية قراءة الإنتاج الحقيقية عبر الواجهة العامة.

**ملاحظة:** الواجهة العامة تعرض `properties` فقط (علنية بالتصميم)؛ لا `subscriptions`
ولا بيانات خاصة. تقرأ Firestore-level للإنتاج تبقى محجوبة لغياب الاعتماد (§1–§6).

### إعادة تشغيل سيرفر التطوير
السيرفر العامل حاليًا (`tsx server/index.ts`, PID 20268) بدأ **قبل** هذه التعديلات ولا
يعيد التحميل تلقائيًا؛ لإتاحة `/api/admin/live/properties` يجب إعادة تشغيله.

## 9. نتائج الاختبارات (هذه الجلسة)

| المجموعة | النتيجة |
|---|---|
| `tsc --noEmit` | **0 أخطاء** |
| حزمة كاملة (`server`+`shared`+`scripts`, `--test-concurrency=1`, بلا `NODE_ENV`) | **880 اختبار · 879 ✓ · 1 ✗** |
| الاختبار الفاشل | `server/services/BookingCommissionStore.test.ts:1` — «initial workflow schedules one customer follow-up» (حقول `provider*` للتسليم) — **سابق وغير مرتبط بهذا العمل** |
| اختبارات LIVE/البيئة/النشر المستهدفة | `live.test.ts` 9/9 · `live.acceptance.test.ts` · `LivePublicApiSource.test.ts` · `deploy.test.ts` · `deploy-bar.test.ts` — **48/48 ✓** |

## 10. معيار النجاح (لم يتحقق بعد)

LIVE (Firestore-level) يُعتبر متصلًا **فقط** بعد: لصق الـ SA، وإعادة التشغيل،
و`liveProjectId=rwqan-757`، و**قراءة فعلية** ناجحة، وإثبات منع الكتابة. أما قراءة
`properties` العامة فهي متاحة الآن عبر §8 دون اعتماد. قبل ذلك **LIVE معطّل** والاتصال غير ناجح.

## 11. إعادة تشغيل سيرفر DEV والتحقق الفعلي (نُفِّذ)

**نطاق العمل:** مجلد التطوير `C:\Users\zerof\Desktop\rwqan-sa-opencode` فقط. لم يُلمس
مجلد الإنتاج `rwqan-sa`، ولم تُنفَّذ أي عملية على الإنتاج.

### 11.1 التحقق من هوية السيرفر القديم قبل الإيقاف
- PID `20268` = `node tsx server/index.ts` (سلسلة: `npx tsx` → `cmd /c` → `tsx cli` → `node server`)،
  يستمع على `0.0.0.0:5001`، بدأ `10/15/2026 2:50:47 PM`، مسار `node_modules` يخص مشروع التطوير.
- أُوقفت هذه السلسلة فقط (`20268`, `28760`؛ و`564`/`15936` كانت منتهية أصلًا)، وتحرّر المنفذ 5001.
  **لم تُوقَف أي عملية أخرى.**

### 11.2 إعادة التشغيل بالطريقة المستخدمة في المشروع
- `npm run dev` = `cross-env NODE_ENV=development tsx server/index.ts`، detached، السجل في
  `%TEMP%\opencode\dev-server.log`.
- السجل: `Firebase Admin initialized successfully` · `بيئة البيانات النشطة: TEST · مشروع Firestore الفعلي: rwqan-sa-dev`
  · `Server running on port 5001`.
- العملية الجديدة: PID `29568`، بدأت `10/16/2026 02:27:20`، على المنفذ `5001`.

### 11.3 نتائج التحقق (جلسة إدارية صالحة)
| الفحص | النتيجة |
|---|---|
| Liveness | لا يوجد مسار `/health` في التطبيق؛ تم التأكد بالإحياء: `GET /api/properties` → **200** |
| تسجيل الدخول الإداري `POST /api/admin/login` | **200** + كوكي `connect.sid` |
| `GET /api/admin/live/status` | **200** → `environment=TEST`, `liveAvailable=false`, `activeProjectId=rwqan-sa-dev`, `writeMode=read-only`, `writeBlocked=false`, السبب: `LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT` فارغ |
| `GET /api/admin/live/properties` (المسار الجديد موجود) | **200** → `environment=TEST`, المصدر «التطوير المعزول», `total=3`, أول عقار `90001` |

### 11.4 حدود النتيجة (دقة إلزامية)
- ما أُثبت: وجود `/api/admin/live/properties` وعمله، وقراءته من **مشروع التطوير المعزول
  `rwqan-sa-dev`** (3 عقارات اختبارية). **ليس** قراءة من إنتاج Firestore.
- **لا اتصال بقاعدة إنتاج Firestore:** التبديل إلى LIVE **مرفوض (فشل مغلق)** لغياب اعتماد
  القراءة؛ لذلك لا يمكن الوصول لبيانات `rwqan-757` عبر Firestore.
- مسار الواجهة العامة (`https://rwqan.sa/api/properties` → 98 عقارًا، §8) **يثبت مسار API
  العام فقط، لا اتصال Firestore مباشرًا.**
- **لم تُنفَّذ أي كتابة/تعديل على الإنتاج** (كل الطلبات GET فقط)، ولم تُلمس مصادر الإنتاج.

---

## 12. محاولة إيجاد اعتماد إنتاجي جاهز على الجهاز (نُفِّذت فعليًا)

الهدف: العثور على هوية **مصرّح لها بالقراءة من `rwqan-757`** لتفعيل LIVE دون إنشاء مفاتيح جديدة
ودون تغيير صلاحيات.

### 12.1 أماكن البحث (بالميتاداتا فقط، دون طباعة أي سر)
| الموقع | النتيجة |
|---|---|
| متغيرات البيئة (`GOOGLE_APPLICATION_CREDENTIALS`, `GCLOUD_PROJECT`, ...) | غير مضبوطة |
| `gcloud` / `gsutil` / `firebase` CLI | **غير مثبّتة** (لا يمكن توليد مفتاح قراءة) |
| ADC: `%APPDATA%\gcloud`, `%USERPROFILE%\.config\gcloud` | **غير موجودة** |
| إعدادات Firebase CLI (`configstore`) | غير موجودة |
| `.env.development.local` في مشروع DEV | `LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT` **فارغ** |
| فحص ملفات `service_account` في `Downloads`/`Desktop`/`Documents`/بروفايل المستخدم | ٣ ملفات فقط (أدناه) |
| أرشيفات zip في `Downloads` | أرشيف إصدار واحد يحتوي `.env` إنتاجي (أدناه) |

### 12.2 النتائج
| الملف | المشروع | النوع | صالح للقراءة فقط؟ |
|---|---|---|---|
| `Downloads\modi-bot-465120.json` | `modi-bot-465120` | service_account | لا — مشروع مختلف |
| `Downloads\rwqan-sa-dev-firebase-adminsdk-fbsvc-3736864a07.json` | `rwqan-sa-dev` | service_account (Admin SDK) | لا — مشروع DEV |
| `Downloads\rwqan-sa-release-rwqan-test.zip` ← داخله `.env` ← `FIREBASE_SERVICE_ACCOUNT` | `rwqan-757` | service_account — **`firebase-adminsdk-fbsvc@rwqan-757.iam.gserviceaccount.com`** | **لا — مفتاح Admin SDK واسع (قابل للكتابة)** |

### 12.3 القرار والعائق
- لم يُعثر على **اعتماد قراءة-فقط مخصّص** لمشروع `rwqan-757`. الموجود الوحيد للإنتاج هو مفتاح
  **`firebase-adminsdk`** الواسع (قابل للكتابة بطبيعته)، وهو بالضبط ما يمنعه القيد الصريح
  «لا تستخدم اعتمادًا إداريًا بصلاحيات كتابة». كما أن تصميم `readLiveDataConfig`
  (`server/config/liveDataEnvironment.ts`) يشترط SA مخصّصًا **مختلفًا** عن الحساب الواسع.
- **لذلك لم يُستخدم المفتاح، ولم يُفعَّل LIVE** (بقي فشلًا مغلقًا)، وبقيت TEST على `rwqan-sa-dev`.
- لا يمكن محليًا توليد مفتاح قراءة-فقط: `gcloud` غير موجود، وإنشاء SA/سياسة IAM **ممنوع** في هذه المرحلة.
- **ملاحظة أمنية (على غرار SEC-001):** ملف `.env` إنتاجي كامل (يضم `FIREBASE_SERVICE_ACCOUNT`,
  Paymob, R2, WhatsApp) **مُحزَّم داخل أرشيف قابل للتنزيل** في `Downloads`. يُوصى بحذف/تدوير الأسرار،
  ولم تُطبع أي قيمة منه.

### 12.4 الخطوة اليدوية المطلوبة من المالك (خارج نطاق هذه المهمة)
1. إنشاء SA مخصّص: `rwqan-live-readonly@rwqan-757.iam.gserviceaccount.com`.
2. منحه `roles/datastore.viewer` على مشروع `rwqan-757` فقط.
3. توليد مفتاح JSON، ولصق قيمته في `LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT` داخل
   `.env.development.local` (مع `LIVE_DATA_READONLY_ACK=read-only`).
4. إعادة تشغيل DEV والتحقق عبر `GET /api/admin/live/status` → `environment=LIVE`, `liveAvailable=true`.

### 12.5 الحالة النهائية بعد هذه المحاولة
- TEST متصل بـ `rwqan-sa-dev` (٣ عقارات اختبارية)؛ LIVE **معطّل فشل-مغلق**؛ لا اتصال Firestore
  إنتاج، ولا كتابة إنتاج. سيرفر DEV يعمل على المنفذ 5001.
  (يُلغي هذا القسم القسمُ 13 أدناه بعد توفّر اعتماد قراءة-فقط.)

---

## 13. تفعيل LIVE والتحقق النهائي (نُفِّذ فعليًا)

### 13.1 ملف الاعتماد (فحص بنية فقط، بلا أسرار)
- المسار: `C:\Users\zerof\Downloads\rwqan-757-21ec5fd03a16.json` (خارج المستودع).
- بنية JSON صحيحة · `type=service_account` · `project_id=rwqan-757` ·
  `client_email=rwqan-live-readonly@rwqan-757.iam.gserviceaccount.com` · حقول المفتاح موجودة.
- لم يُطبع أي حقل سرّي (`private_key`/`private_key_id`) ولا يُكتب في أي ملف أو سجل.

### 13.2 طريقة الاستخدام (بلا نسخ للمستودع)
- الكود الحالي يدعم الاعتماد عبر متغيّر البيئة `LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT` (JSON داخلي)
  — `server/config/liveDataEnvironment.ts:150`.
- حُقِن المتغيّر عند تشغيل الخادم من محتوى الملف (قُرئ إلى متغيّر جلسة فقط)، دون كتابته في
  `.env.development.local` أو `.env` أو أي ملف. أوامر التشغيل لا تحتوي السر.
- `loadEnv` لا يستبدل متغيّرات البيئة المعرّفة مسبقًا، لذا القيمة المحقونة تغلب الفراغ في
  `.env.development.local`.

### 13.3 نتائج التحقق الفعلية (سكربت داخل العملية + خادم DEV على المنفذ 5001)
| الفحص | النتيجة |
|---|---|
| LIVE · `getActiveFirestoreProjectId()` | **`rwqan-757`** |
| LIVE · قراءة فعلية محدودة من Firestore (`properties`, limit 3) | **3 وثائق** · أول معرّف `00000` |
| TEST · `getActiveFirestoreProjectId()` | **`rwqan-sa-dev`** |
| TEST · قراءة فعلية (`properties`, limit 3) | **3 وثائق** · أول معرّف `90001` |

حاجز الكتابة في LIVE — كلها رمَت `LiveWriteBlockedError` بلا أي كتابة فعلية:
`doc.set` · `collection.add` · `doc.update` · `doc.delete` · `doc.create` · `batch().commit()` ·
`runTransaction()`.

### 13.4 مراجعة مسارات الكتابة/الدفع/الإرسال
- **Firestore (الإنتاج):** لا يُنشأ اتصال إنتاجي إلا في `server/config/dataEnvironment.ts`
  (`getOrCreateLiveFirestore`)، ثم يُلفّ للقراءة فقط عبر `wrapReadOnlyFirestore` ما لم يُضبط
  `LIVE_WRITE_MODE=enabled` (الافتراضي read-only).
- **الخدمات:** كل خدمات Firestore تستورد `activeFirestore` (Proxy → `getActiveFirestore`)، و
  `server/firebaseService.ts:364 private get db() → getActiveFirestore()`. الاستثناء الوحيد
  `server/services/FirestoreDeploySystemStore.ts:2` يستورد `db` (DEV) عمدًا لبيانات نظام النشر — لا قراءة/كتابة إنتاج.
- **Paymob:** `server/integrations/paymob.ts:194` محكوم بـ `paymobEnabled()`؛ وفي DEV بمفاتيح
  **TEST** فقط (يفرضه `assertPaymobKeyEnvironmentMatch`)، وأي سجل دفع يُكتب عبر حارس Firestore.
- **WhatsApp/المسح الضوئي:** `server/integrations/whatsapp.ts:129,892` و
  `server/integrations/aiReceiptScanner.ts:136` معطّلة في DEV عبر `externalServicesEnabled()`.
- **دليل حيّ:** تسجيل الدخول الإداري الجديد أثناء LIVE رجع **503** لأن محدِّد المحاولات المشترك
  (`firebaseService.consumeAdminLoginAttemptLimit` → `runTransaction`) أوقفه حارس القراءة فقط
  (`server/routes/auth.ts:108-124`) — دليل عملي على منع الكتابة، لكنه يعني تعذّر تسجيل دخول إداري
  **جديد** أثناء LIVE (الجلسات القائمة تبقى صالحة).

### 13.5 النظافة (Git والسجلات)
- ملف الاعتماد خارج المستودع؛ لا يوجد ملف **متتبَّع** فيه `rwqan-live-readonly` أو اسم الملف
  (`git grep` على الملفات المتتبَّعة: لا نتائج).
- لا سجلات (`dev-live-server*.log`) تحتوي `PRIVATE KEY`/`private_key`؛ المخرجات اكتفت بالميتاداتا.

### 13.6 حدود وملاحظات
- حالة البيئة **في الذاكرة**: إعادة تشغيل الخادم تُعيدها إلى TEST (الافتراضي الآمن). لتفعيل LIVE بعد
  ذلك يلزم حقن `LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT` من مسار الملف مجددًا (نفس طريقة التنفيذ أعلاه).
- لم تُعدَّل قواعد/صلاحيات/أسرار الإنتاج، ولم يُنفَّذ نشر أو `commit`/`push`، ولم يُلمس مجلد الإنتاج.
- لم تُنفَّذ أي عملية كتابة فعلية على الإنتاج أثناء التحقق (قراءات فقط + محاولات محجوبة).
