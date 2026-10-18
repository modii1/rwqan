# اعتماد النسخة الرسمية المستقرة — `rwqan.sa` (Stable Baseline)

> مهمة **توثيق وفحص وتجهيز فقط**. لم يُنفَّذ أي نشر أو Rollback، ولم يُغيَّر أي إعداد إنتاجي.
> العمل كله داخل `C:\Users\zerof\Desktop\rwqan-sa-opencode` فقط.

---

## 1) المرحلة 1 — نوع الاستضافة الفعلي التي تخدم `rwqan.sa`

### 1.1) الأدلة من الملفات (في مجلد التطوير فقط)
| المصدر | الدليل |
| --- | --- |
| `apphosting.yaml` | تعليق «Settings for Backend (on Cloud Run)» + `runConfig` + `scripts.buildCommand=npm run build` + `scripts.runCommand=node dist/server/index.js` + `NODE_ENV=production` + `NEXT_PUBLIC_BASE_URL=https://rwqan.sa`. |
| `firebase.json` | `"apphosting": { "backendId": "rwqan-backend", "rootDir": "/" }`. |
| `.firebaserc` | `default = rwqan-757` (مشروع الإنتاج). |

### 1.2) الأدلة من فحص حي (قراءة-فقط عبر HTTPS، بلا أي اعتماد)
`GET https://rwqan.sa` ⇒ **HTTP/1.1 200 OK**، مع ترويسات:
```
x-powered-by: Next.js
server: envoy
via: 1.1 google
x-cloud-trace-context: ...
alt-svc: h3=":443" ...
cache-tag: 371865284292:rwqan
Cdn-Cache-Status: miss
```
هذا النمط (Next.js + envoy + via Google + Cloud CDN cache-tag + Cloud Trace) مطابق لـ
**Firebase App Hosting على Cloud Run خلف Google Cloud CDN/LB**.

**النتيجة:** نوع الاستضافة = **Firebase App Hosting (Cloud Run)، backend `rwqan-backend`، مشروع `rwqan-757`.**
درجة الثقة في *نوع* الاستضافة: **`partially_verified`** (توافق الإعداد + الترويسات الحية؛ لا يوجد CLI لإثبات خدمة Cloud Run المحددة).

### 1.3) هل يمكن إثبات الإصدار المنشور؟ **لا**
- الأدوات `firebase` و`gcloud` و`gh` و`docker` **غير مثبّتة** في هذه البيئة.
- لا توجد نقطة نهاية إصدار/صحة:
  `GET /api/deploy-version` ⇒ **404**، `/api/version` ⇒ **404**، `/api/health` ⇒ **404**، `/healthz` ⇒ **404**.
- لا بيانات Rollout/Build/Release متاحة من الواجهة العامة.
⇒ **إصدار `rwqan.sa` المنشور (SHA/رقم) غير قابل للإثبات حاليًا.** لا يُخترع معرّف،
ولا يُفترض أن HEAD المحلي هو المنشور.

---

## 2) المرحلة 2 — سجل النسخة المستقرة الرسمي

| الحقل | القيمة |
| --- | --- |
| اسم الموقع | `rwqan.sa` |
| مصدر الإصدار | Firebase App Hosting (Cloud Run)، backend `rwqan-backend`، مشروع `rwqan-757` |
| معرّف الإصدار المنشور | **غير مُثبَت** (`null`) — لا نقطة نهاية إصدار ولا CLI |
| SHA المنشور | **غير مُثبَت** (`null`) |
| وقت التحقق | `2026-10-16` (الفحص الحي: الموقع يعمل) |
| اختبارات الصحة | HTTP الواجهة: **200** (متاح). نقطة نهاية إصدار: **غير موجودة (404)**. باقي الفحوص: `NOT_RUN`. |
| مستوى الثقة | **`unknown`** (لهوية الإصدار). نوع الاستضافة: `partially_verified`. |
| الفرق بين المنشور وHEAD | **غير قابل للتحديد** (`null`) — لغياب SHA المنشور. |

### 2.1) حالة Git المحلية (للتوثيق فقط — ليست دليلًا على المنشور)
| المرجع | القيمة |
| --- | --- |
| HEAD المحلي | `6c49647abdc14cd5176808fe79839e7ef3d7ebe9` (2026-09-24 — «Add unified account gateway and responsive signup») |
| `origin/main` | نفس HEAD (`6c49647…`) |
| `origin/release/rwqan-test` | `7be886c4f9a8dd97b1c47c8231cfcc4f054e75e5` (2026-09-26) — **متقدّم على HEAD بكوميت واحد** |
| وسم محلي | `backup-main-20260525` |

> وجود فرع `release/rwqan-test` (وهو الوحيد غير `main`) يشير بقوة إلى أنه مسار الإصدار المنشور،
> لكن **لا يمكن إثبات** أن `rwqan.sa` بُني منه. لذلك: **HEAD المحلي ≠ الإصدار المنشور** (غير مُثبَت).

### 2.2) الحكم
**لم يُعتمد Stable Baseline بدرجة ثقة كاملة.** السجل موثَّق بدرجة **`unknown`** لهوية الإصدار.
لكي نرفعها إلى `verified` يلزم: (1) App Hosting CLI/Console لإظهار الـRollout النشط ومعرّفه،
و(2) نقطة نهاية إصدار على الموقع تربط الـcommit المُشغَّل بالبناء.

---

## 3) المرحلة 3 — سياسة Stable Release

### 3.1) الحالات المميّزة (ليست مترادفة)
| الحالة | التعريف الدقيق |
| --- | --- |
| `candidate` | إصدار اجتاز تحققًا أوليًا ومرشَّح للاختبار، **لم يُنشر**. |
| `deployed` | إصدار **شُغِّل فعلًا** (`deployed === true`). لا يعني أنه سليم. |
| `verified` | إصدار **اجتاز الفحوص القابلة للتشغيل** (TypeScript + فحص الأسرار `PASS`) بلا فشل. |
| `stable_baseline` | الإصدار **الوحيد** المعتمد كمرجع رسمي: `verified` **و** `deployed` **و** SHA كامل معروف **و** مُعلَّم صراحةً كأساس. |
| `rollback_ready` | إصدار **سابق** ثبتت سلامته **و** آلية الرجوع إليه **مؤكَّدة** في هذه البيئة. |

> هذه الحالات تُحسب بدالة نقية `classifyReleaseMaturity` في `shared/deploySystem.ts`؛
> إصدار واحد قد يحمل أكثر من علامة، و`stable_baseline` ≠ `rollback_ready`.

### 3.2) شروط اعتماد إصدار جديد كـ Stable Baseline (كلها إلزامية)
1. **نجاح الفحوصات المطلوبة** (TypeScript + فحص الأسرار، وأي فحوص إضافية معتمدة).
2. **تحديد SHA ومصدر الإصدار** (SHA كامل 40 حرفًا + مرجع البناء/الـRollout).
3. **نجاح البناء** (`npm run build` يُنتج `dist`).
4. **نجاح التحقق بعد النشر** (نقطة نهاية إصدار تؤكد تطابق الـcommit المُشغَّل).
5. **وجود مسار رجوع واضح** إلى إصدار سليم سابق (انظر §4).

> حتى استيفاء الشروط الخمسة، لا يُمنح أي إصدار حالة `stable_baseline` ولا `rollback_ready`.

---

## 4) المرحلة 4 — خطة الرجوع السريع

### 4.1) الآلية الفعلية
- الاستضافة = **Firebase App Hosting**. تدعم **Rollouts** سابقة (يمكن إعادة بثّ Rollout سابق)،
  وتُرجع تلقائيًا إلى آخر Rollout سليم عند فشل بناء/بث جديد.
- **غير مؤكَّد من هذه البيئة** (لا CLI ولا بيانات Rollout). لا نخترع قدرة «رجوع فوري» غير مُثبتة.
- البديل المقترح إن تعذّر الوصول للـRollouts: **إعادة نشر الالتزام السليم المعروف** (redeploy prior revision)
  عبر بناء نفس الـSHA ودفعه — وهو أبطأ لكنه مضمون منطقيًا.

### 4.2) الصلاحيات والمتطلبات
- الوصول لمشروع `rwqan-757` عبر Firebase CLI أو Cloud Console (صلاحية View/Release على App Hosting).
- حصر الـRollout السابق السليم **ومعرّفه/SHA بنائه**.
- إثبات أن Rollout السابق ما زال قابلًا لإعادة البث ولم يُحذف.

### 4.3) التحقق بعد الرجوع
- `GET https://rwqan.sa` ⇒ 200.
- نقطة نهاية إصدار تقرأ الـcommit وتطابقه مع الإصدار المستهدف (مطلوبة).
- فحص يدوي للوظائف الحرجة (الحجوزات/الدفع/الرسائل).

### 4.4) المخاطر (الرجوع ليس «كودًا فقط» دائمًا)
- **لا يتراجع عن هجرات Firestore** أو تغييرات البيانات أو ملفات R2. الـ`codeOnly = false`.
- قد يظهر عدم توافق بين الواجهة المنشورة حديثًا وخادم قديم (أو العكس).
- **غياب نقطة نهاية إصدار يمنع التحقق الآلي** بعد الرجوع ⇒ التحقق يدوي مؤقتًا.

### 4.5) الحالة الحالية
`rollback.supported = true` (قدرة موثَّقة)، `rollback.confirmed = false`، **`rollback.readyToRollback = false`**.
لم يُنفَّذ أي Rollback. لا يُعرض «جاهز للرجوع» قبل إثبات الآلية.

---

## 5) المرحلة 5 — الدمج مع نظام النشر (مضاف فقط ما يلزم)

- **الأنواع (`shared/deploySystem.ts`):** `DeployVerificationConfidence`، `DeployReleaseMaturity`،
  `DeployReleaseMaturityFlags`، `classifyReleaseMaturity()`، `isFullGitSha()`، `DeployStableBaseline`،
  `DeployRollbackReadiness`، وحقلان جديدان في `DeployState`: `stableBaseline` و`rollback`.
- **الإعداد (`server/config/stableBaseline.ts`):** سجل `RWQAN_STABLE_BASELINE` + `RWQAN_ROLLBACK_CAPABILITY`
  + `buildRollbackReadiness()` (قراءة-فقط، بلا أسرار).
- **الخدمة (`server/services/DeployBaselineService.ts`):** `buildStableBaseline(git)` يحسب
  `headMatchesBaseline` (يبقى `null` ما لم يُثبَت SHA المنشور).
- **`buildDeployState`:** يمرّر `stableBaseline` و`rollback` لكل حالة — توافق خلفي (الحقول الجديدة
  مضافة، والسجلات القديمة تُسلسَل كما هي).
- **الواجهة:** بطاقة «النسخة المستقرة المرجعية» + «جاهزية الرجوع» في
  `src/components/admin/sections/deploy.tsx` و`src/components/deploy-bar.tsx`، مع عرض الثقة والفرق عن HEAD.
- **زر الاستعادة:** لا يعرض نجاحًا قبل تحقق الاستعادة الفعلي (سلوك المرحلة D القائم)؛ ولا يُربط بجاهزية الرجوع.

> لم يُنفَّذ أي نشر في هذه المرحلة، ولم تبدأ المرحلة F.

---

## 6) الاختبارات
| المجموعة | النتيجة |
| --- | --- |
| `npx tsc --noEmit` | 0 أخطاء (عدا `_probe_public.ts` غير المتتبَّع) |
| `server/config/stableBaseline.test.ts` | هوية غير مُثبَتة / عدم مطابقة HEAD / عدم اعتماد غير متحقق / عدم جاهزية رجوع بلا إثبات |
| `DeployRestoreService.test.ts` + حزمة النشر | كما هي (بلا انحدار) |
| واجهة `deploy-bar` + `sections/deploy` | كما هي (بلا انحدار) |

---

## 7) القيود التي التزمنا بها
- لا لمس `C:\Users\zerof\Desktop\rwqan-sa`، ولا `rwqan-757` ولا أي إعداد Firebase/Cloudflare/GitHub/IAM/أسرار.
- لا `commit`/`push`/`fetch`/`pull`/`merge`/`rebase`/`reset`/`checkout` مغيِّر لملفات العمل.
- لا نشر ولا Rollback؛ لا كتابة إلى Firestore/R2 الإنتاجي؛ لا طباعة أسرار.
- الفحص الحي الوحيد: GET قراءة-فقط إلى `rwqan.sa` (لا اعتماد، لا كتابة).

## 8) ما ينقص (متطلبات المالك) لرفع الثقة وتفعيل الرجوع
1. تثبيت/مصادقة Firebase CLI على `rwqan-757` (لعرض الـRollouts وتحديد الإصدار النشط).
2. إضافة نقطة نهاية إصدار قراءة-فقط على الموقع (commit + version) لإثبات المطابقة والتحقق بعد الرجوع.
3. تحديد الـRollout/الإصدار السليم السابق لتثبيت `rollback_ready`.
4. (عند الحاجة) إكمال `npm run build` بمعالجة عائق `tsconfig.server.json` السابق.

---

## 9) محاولة تحديد آخر Rollout ناجح لـ`rwqan-backend` (فحص قراءة-فقط)

> هذه المحاولة **لم تُغيِّر أي شيء** في الإنتاج، ولم تُثبِّت أدوات ولم تُعدّل صلاحيات.
> الهدف: معرفة معرّف/وقت/حالة/SHA آخر Rollout **ناجح**. النتيجة: **تعذّر آليًا** (لا اعتماد ولا أدوات)، والبيانات المطلوبة تبقى **مجهولة**.

### 9.1) ما هو **مؤكد** (أدلة قابلة للتكرار)
| البند | الدليل / النتيجة | المصدر |
| --- | --- | --- |
| أدوات Firebase/Google | `firebase`, `gcloud`, `gh`, `docker` **غير مثبّتة**؛ `node v24.15.0` + `npm 11.12.1` + `npx` + `curl.exe` متاحة | فحص PATH مباشر |
| اعتمادات Google/Firebase | **لا توجد**: `application_default_credentials.json`, `configstore/firebase-tools.json`, `%APPDATA%\firebase`, `~/.config/gcloud` كلها **غائبة**؛ لا متغيرات `GOOGLE*/FIREBASE*/CLOUDSDK*` | فحص مسارات ومتغيرات |
| App Hosting REST API | `GET .../projects/rwqan-757/locations/-/backends/rwqan-backend/rollouts` ⇒ **HTTP 401 UNAUTHENTICATED** (وكذلك `/backends` و`/locations`) | طلب بلا اعتماد |
| DNS `rwqan.sa` | A ⇒ `35.219.200.99` (Google Cloud LB)، AAAA ⇒ `64:ff9b::23db:c863` (NAT64)؛ لا CNAME | استعلام DNS |
| كاش `.firebase/hosting.cHVibGlj.cache` | يخص **Hosting ثابتًا قديمًا** (logo/index/404/assets، ~2026-02–03) — **ليس** دليلًا على نشرة App Hosting | محتوى الملف |

### 9.2) ما هو **مجهول** (يتطلب اعتمادًا)
- معرّف آخر Rollout ناجح (`rolloutId`) واسم الإصدار (`version`).
- وقت النشر الفعلي (`createTime`/`deployTime`) والحالة (`state`).
- الـSHA/الـcommit المرتبط بالبناء (`commit`)، والفرق عن HEAD المحلي.

⇒ لذلك **يبقى** `publishedVersionId`/`publishedSha`/`verifiedAt` = `null` و`confidence = "unknown"`، و`rollback_ready = false`. لا يُخترع معرّف ولا يُفترض `origin/main`.

### 9.3) الأوامر اليدوية الدقيقة (للمالك — قراءة-فقط)
**الخيار A — Firebase CLI** (يحتاج تثبيتًا ومصادقة):
```
firebase login
firebase apphosting:backends:list --project rwqan-757
firebase apphosting:backends:get rwqan-backend --project rwqan-757 --location <REGION>
firebase apphosting:rollouts:list rwqan-backend --project rwqan-757 --location <REGION>
```
- `<REGION>` يُستخرج من مخرجات `backends:list`/`backends:get` (مثلًا `us-central1`).
- «آخر Rollout ناجح» = أحدث عنصر حالته الناجحة (`SUCCEEDED`) في القائمة؛ أعلاه غالبًا هو الـRollout النشط الحالي.

**الخيار B — REST مباشر** (Google Cloud SDK):
```
gcloud auth login
gcloud auth application-default login
curl -H "Authorization: Bearer $(gcloud auth print-access-token)" ^
  "https://firebaseapphosting.googleapis.com/v1beta/projects/rwqan-757/locations/<REGION>/backends/rwqan-backend/rollouts?orderBy=createTime%20desc&pageSize=20"
```

**الخيار C — Firebase Console**: App Hosting ⇒ backend `rwqan-backend` ⇒ **Rollouts** (يُظهر الـRollout الذي يخدم الموقع الآن + السجل الكامل).

**الصلاحية المطلوبة:** `firebaseapphosting.rollouts.list` و`firebaseapphosting.backends.get` (دور مثل `Firebase App Hosting Viewer`).

### 9.4) بعد الحصول على البيانات (خطوة تالية، ليست منفَّذة)
عند توفّر `rolloutId` + `commit` + `state=SUCCEEDED`، يمكن إثبات الإصدار المنشور في القسم 2 (رفع الثقة من `unknown`)، وتثبيت `rollback_ready`.
