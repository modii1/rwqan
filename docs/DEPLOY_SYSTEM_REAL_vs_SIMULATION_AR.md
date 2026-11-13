# نظام RWQAN DEPLOY — المسار إلى النشر والاستعادة الحقيقيين (فحص وتجهيز DEV)

> المرحلة الحالية: **فحص وتجهيز DEV فقط، دون نشر فعلي.** لا يوصف النظام بأنه ينشر أو
> يستعيد فعليًا حتى تُنفَّذ العملية بإذن صريح ويثبت نجاحها من App Hosting والموقع.

---

## 1. نظام النشر — ما هو حقيقي اليوم

### ✅ حقيقي (يعمل)
| المكوّن | التفاصيل |
|---|---|
| سجل الإصدارات | Firestore DEV (دائم عبر إعادة التشغيل)، مجموعات `deploy_releases` / `deploy_audit_log` / `deploy_system_state`. |
| سجل التدقيق | كل إجراء يُسجَّل بالممثل والنتيجة والسبب. |
| فحص Git للقراءة | commit/branch/tag/remote من مستودق محلي (لا يُؤخذ من الواجهة). |
| فحص الأسرار | أسماء الملفات + أنماط المحتوى (دون طباعة قيم). **لا يُبلّغ عن الملفات المحذوفة** (إصلاح هذه المرحلة). |
| **قبضة التنفيذ `DeployExecutor`** | **جديد:** واجهة تفصل «ماذا ننشر» (السجل) عما «يحدث فعليًا» (التنفيذ). |
| تبديل بيئة النشر | TEST/LIVE في مخزن Firestore DEV. |
| **استعادة فعلية معزولة (المرحلة D)** | `DeployRestoreService`: `git archive` (قراءة-فقط) + `bsdtar` إلى `<devRoot>/.deploy-restore/<releaseId>/` + تقليم أسرار + تحقق بالمحتوى مقابل شجرة الالتزام. **داخل DEV فقط، بلا لمس شجرة العمل ولا الإنتاج.** مُتحقَّق حيًا: `6c49647…` ⇒ نجاح، 500 ملف، قُلّم `.env`. |

### 🧩 مُنفَّذ لكنه معطَّل افتراضيًا (المرحلة E)
| المكوّن | التفاصيل |
|---|---|
| **إثبات هوية الإصدار (الأساس الموثوق)** | `DeployBuildSourceService`: يقرأ من لوحة تحكم App Hosting الـbuild الذي يخدم **حركة المرور الفعلية** (`traffic.current`: split واحد بنسبة 100% و`reconciling=false`) ويطابق `Build.source.codebase.hash` مع الـcommit. يفشل مغلقًا عند `reconciling`/`no-traffic`/`ambiguous`/بنية `archive`/SHA قصير. **إلزامي**؛ بدونه لا يُسجَّل `deployed:true`. |
| **التحقق بعد النشر** | `DeployHealthService.probeDeployHealth`: استعلام HTTP **قراءة-فقط** (`/api/deploy-version`) للتحقق من **الإتاحة فقط** (`requireCommitProof:false`) — HTTP 200 لا يُعتبر إثبات مطابقة commit. يرفض مضيف الإنتاج ويفشل مغلقًا. |
| **منفّذ النشر الحقيقي DEV** | `DeployRealExecutor`: مسار حقيقي نحو هدف **DEV المعزول** فقط (`rwqan-sa-dev`)، معطَّل افتراضيًا، ببوابات: تفعيل + موافقة صريحة + هدف ثابت من الخادم + **SHA كامل** + **شجرة عمل نظيفة** + **منطقة App Hosting إلزامية** + **وجود مُتحقِّق المصدر إلزامي**. |

### ⚠️ محاكاة (الافتراضي الآمن)
| المكوّن | الواقع |
|---|---|
| زر «نشر» | يُستدعي `executor.publish()`؛ الافتراضي `SimulationDeployExecutor` يعيد `deployed:false`. **لا بناء ولا نشر.** |
| منفّذ النشر الحقيقي | مُنفَّذ لكنه **معطَّل افتراضيًا**: لا يُختار إلا عند `NODE_ENV=development` **و** `DEPLOY_REAL_DEPLOY=enabled`، ومع موافقة إدارية صريحة (`approve:true`). |
| الفحوصات `typescript`/`tests`/`build` | `NOT_RUN` (لم تُشغَّل داخل الطلب). |
| التحقق `postDeployHealth` | `NOT_RUN` حتى يوفّر المالك هدف DEV منشورًا + أدوات نشر؛ نقطة الإصدار `/api/deploy-version` **موجودة في الكود** لكنها لا تُشغَّل على نشر حقيقي بعد. |

> **لم يحدث أي نشر DEV حقيقي بعد.** حالة المرحلة E = **`NOT_DEPLOYED`**: الأدوات (`firebase`/`gcloud`/`docker`)
> غير مثبّتة، ولا يوجد backend DEV مستقل ولا ربط GitHub/Developer Connect، ولا تفعيل، وشجرة العمل غير نظيفة
> — لذا لا يمكن تنفيذ نشر حقيقي ولا إثباته من لوحة التحكم.

> **«الاستعادة الذكية المعزولة» ≠ نشر حقيقي للإنتاج.** الاستعادة تُعيد بناء شجرة إصدار سابق
> داخل مجلد DEV للفحص فقط؛ لا تلمس App Hosting/Cloud Run ولا `rwqan-757`. «نشر» يبقى محاكاة.

**الخلاصة:** النظام الآن **مهيأ للنشر الحقيقي** عبر قبضة `DeployExecutor`، وفيه **منفّذ DEV حقيقي**
(`DeployRealExecutor`) و**تحقق بعد النشر** (`DeployHealthService`) — لكنهما **محاكاة افتراضيًا**:
لا يقع نشر حقيقي حتى يوفّر المالك هدف DEV + endpoint الإصدار + أدوات النشر، ويُفعَّل العلم ويُمنح تأكيد صريح.
**أما الاستعادة فقد أصبحت فعلية معزولة داخل DEV** (لا نشر)، وفق الملحق D في وثيقة المرحلة C.

## 2. المسار المقترح للنشر الحقيقي (مع منع النشر غير المقصود)

###  Prevent النشر التلقائي من أي `push` (مبدأ التصميم)
- **لا تفعيل نشر تلقائي من GitHub.** النشر الحقيقي يُستدعى **فقط** عبر إجراء إداري
  صريح (زر «نشر» + تأكيد) → `executor.publish()` الحقيقي.
- عند ربط GitHub بـ App Hosting، **لا تستخدم النشر التلقائي على `push`**؛ إن لزم
  الربط، اجعله على فرع منفصل ودمج يدوي محمي، أو فعّل سياسة rollout تتطلب الموافقة.
- بهذا النشر الحقيقي **يتطلب موافقة صريحة** ولا يحدث عن طريق `push` عرضي.

### التنفيذ الحقيقي (يُبنى لاحقًا بصلاحيات المالك)
`executor.publish()` الحقيقي يجب أن: يبني المشروع → ينشر إلى خلفية App Hosting
`rwqan-backend` → يعيد `{deployed:true, gitCommit, detail}`. يفشل مغلقًا عند أي خطأ.

## 3. الإصدار الثابت والاستعادة

- **الإصدار = Git SHA + فحوصات + ملخص.** يُخزَّن دائمًا في Firestore DEV وغير قابل
  للتعديل بعد إنشائه (`releaseId` + `gitCommit` ثابتان).
- **الاستعادة (منفَّذة فعليًا، معزولة في DEV):** `POST /api/admin/deploy/releases/:releaseId/restore`
  يبني شجرة الـSHA المطلوب بـ`git archive`، يستخرجها إلى `<devRoot>/.deploy-restore/<releaseId>/`،
  يقلّم الأسرار، ويتحقق بمطابقة بصمات المحتوى مع شجرة الالتزام. مسار `.../restore/preview`
  يعرض الهدف والموانع **دون تنفيذ** (قراءة-فقط). أي شرط غير مضمون ⇒ `blocked`/`failed` بلا ادعاء نجاح.
  تحقق حي: `6c49647abdc14cd5176808fe79839e7ef3d7ebe9` ⇒ `success`/`verified` (500 ملف، تقليم `.env`).
- **الاستعادة ليست نشرًا:** لا تلمس الإنتاج ولا تُعيد نشر شيء؛ `executor.restore()` (المحاكاة) يبقى
  مسارًا منفصلًا للنشر الفعلي عند توفير إذن صريح لاحقًا.

## 4. الأسرار المطلوبة لـ Secret Manager (أسماء فقط — لا قيم)

النشر الحقيقي يحتاج أسرار الإنتاج في **Cloud Secret Manager** ويشير إليها في
`apphosting.yaml` (قسم `secret` معلَّق حاليًا). الأسماء التي يقرأها السيرفر:

- `FIREBASE_SERVICE_ACCOUNT`, `SESSION_SECRET`, `BOOKING_WORKER_SECRET`
- `PAYMOB_API_KEY`, `PAYMOB_PUBLIC_KEY`, `PAYMOB_HMAC_SECRET`, `PAYMOB_LEGACY_API_KEY`,
  `PAYMOB_INTEGRATION_ID_CARDS`, `PAYMOB_INTEGRATION_ID_APPLEPAY`
- `GOOGLE_SERVICE_ACCOUNT_KEY`, `OCR_API_KEY`, `GEMINI_API_KEY`
- `META_WHATSAPP_TOKEN`, `META_PHONE_NUMBER_ID`, `META_NOTIFY_NUMBER`,
  `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`
- `ENJAZATIK_URL`, `ENJAZATIK_TOKEN`
- `R2_REGION`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_BUCKET_NAME`, `R2_PUBLIC_URL`

> غير السرّي (يبقى كمتغيرات عادية): `NODE_ENV`, `NEXT_PUBLIC_BASE_URL`, `PUBLIC_BASE_URL`,
> `PORT`. **لم أطبع أي قيمة سرّية ولم أنشئها/أنقلها.**

## 5. البناء والاختبارات والصحة (فُحصت محليًا)

- `npx tsc --noEmit`: **نظيف (0 أخطاء).**
- الاختبارات الكاملة: **994 اختبار، 993 ناجح، 1 فشل.**
  - **الفشل (موثّق، غير متعلق بهذا العمل):** `server/services/BookingCommissionStore.test.ts`
    — توقّق قديم ينقصه حقول `provider*`. **لا يُعتبر ناجحًا.**
- **`next build` لم يُشغَّل** في هذه المرحلة (بطيء ويزعج سيرفر التطوير يعمل). يُشغَّل في مسار
  البناء الفعلي على App Hosting/CI.
- فحص الصحة بعد النشر: `NOT_RUN` (يصبح متاحًا بعد النشر الحقيقي).

## 6. التغييرات الآمنة المُنفَّذة في DEV

- **قبضة `DeployExecutor`** (`server/services/DeployExecutor.ts` جديد): واجهة
  `publish`/`restore` + `SimulationDeployExecutor` آمن + مصنع `createDeployExecutor`.
- **ربطها في المسار** (`server/routes/admin/deploy.ts`): خيار `executor` (افتراضي
  محاكاة). النشر والاستعادة يستدعيان المنفّذ ويستخدمان نتيجته (`deployed`/`savedToGit`)
  للسجل والتدقيق. فشل المنفّذ يُرجع `502` ولا يُبلغ نجاحًا كاذبًا.
- **نموذج الإصدار** (`DeploySystemStore.ts`): `buildReleaseRecord` يشتق `simulated` من
  `!deployed`؛ يقبل `deployed`/`savedToGit` من المنفّذ فقط (لا من العميل).
- **إجراءات تدقيق حقيقية** (`shared/deploySystem.ts`): أضيفت `publish`/`restore`.
- **فحص الأسرار** (`DeployChecksService.ts`): لم يعد يُعلّم الملفات المحذوفة كأسرار.
- **الاختبارات:** +2 اختبار للقبضة (منفّذ حقيقي يُرجع `deployed:true` يُسجَّل
  `publish`/`deployed:true`؛ والافتراضي محاكاة). `tsc` نظيف، 11/11 لمسار النشر.

## 7. مفتاح TEST/LIVE (مستقل عن النشر)

| البيئة | المصدر | الحالة |
|---|---|---|
| **TEST** | `rwqan-sa-dev` | يعمل. |
| **LIVE** | `rwqan-757` (قراءة فقط) | معطّل عمدًا (فشل مغلق). |

- الحارس `wrapReadOnlyFirestore` يمنع الكتابة/الحذف/التعديل/المعاملات/المدفوعات/
  الرسائل في LIVE. **لا fallback صامت** — يبقى TEST ويعرض السبب عند فشل LIVE.
- النشر لا يعتمد على اتصال البيانات، واتصال البيانات لا يعتمد على النشر.

## 8. ما الذي لم أفعله (التزامًا بالقيود)

- لا نشر فعلي، لا `push`/`deploy`، لا تغيير IAM أو إعدادات GitHub/Firebase الإنتاجية.
- لا تفعيل نشر تلقائي من GitHub. لا إنشاء/نقل أسرار. لا بناء/حذف على الإنتاج.
- لا commit/push. لم ألمس `C:\Users\zerof\Desktop\rwqan-sa`.

## 9. معيار الإغلاق (لا يُوصف بأنه حقيقي قبله)

- **نشر حقيقي:** وفّر المالك تنفيذًا حقيقيًا للمنفّذ (أو ربطًا آمنًا)، وانجح البناء،
  ونفّذت عملية نشر **بإذن صريح**، وثبت النجاح من خلفية `rwqan-backend` **والموقع المنشور**
  (`rwqan.sa` يعرض الإصدار الجديد).
- **استعادة حقيقية:** نفس الشيء لـ `executor.restore()` مع تحقق من صحة الموقع.
- **LIVE:** بعد توفير اعتماديات القراءة وإثبات قراءة فعلية من `rwqan-757` مع منع الكتابة.

## 10. المرحلة E — مسار النشر الحقيقي إلى DEV (مُنفَّذ، غير مُشغَّل)

> الهدف: تحويل «النشر» من محاكاة دائمة إلى **مسار حقيقي نحو DEV المعزول فقط**، مع بقاء المحاكاة
> الافتراضية الآمنة، ومنع أي احتمال للنشر إلى الإنتاج. **لم يحدث أي نشر فعلي في هذه المرحلة.**

### 10.1) البوابات (فشل مغلق)
1. **تفعيل صريح:** لا يُختار المنفّذ الحقيقي إلا عند `NODE_ENV=development` **و** `DEPLOY_REAL_DEPLOY=enabled`.
2. **موافقة إدارية:** طلب النشر يجب أن يحمل `approve:true` (مسارات `publish`)، وإلا ⇒ `409 DEPLOY_BLOCKED` بتدقيق `publish_blocked`.
3. **هدف ثابت من الخادم:** الهدف يأتي من `resolveDeployTarget()` لا من العميل؛ مشروع `rwqan-sa-dev` وخدمة `rwqan-sa-dev` (backend). أي مشروع/مضيف إنتاجي أو مجهول يُرفض.
4. **لا ادعاء نجاح:** `deployed:true` لا يُقبل إلا بعد **إثبات المصدر الإلزامي** من لوحة تحكم App Hosting (`DeployBuildSourceService`: `traffic.current` + مطابقة `source.codebase.hash`)، ثم فحص إتاحة HTTP 200 — والـHTTP 200 وحده **لا يُعتبر إثبات commit**.
5. **فشل المرحلة:** أي فشل build/deploy/verify ⇒ `502 DEPLOY_EXECUTOR_FAILED` بالمرحلة الفاشلة، بلا سجل منشور.

### 10.2) الملفات (المرحلة E)
**جديد**
| الملف | الدور |
| --- | --- |
| `server/config/deployTarget.ts` | ثوابت هدف DEV + حواجز رفض الإنتاج/المجهول + `realDeployEnabled` + قراءة `DEPLOY_APP_HOSTING_LOCATION`. |
| `server/services/DeployRealExecutor.ts` | منفّذ النشر الحقيقي DEV-only: بوابة مصدر (SHA كامل + شجرة نظيفة) ← منطقة إلزامية + مُتحقِّق مصدر إلزامي ← `apphosting:rollouts:create` ← إثبات لوحة التحكم الإلزامي ← فحص إتاحة فقط. |
| `server/services/DeployBuildSourceService.ts` | إثبات هوية المصدر الموثوق من `traffic.current` + `source.codebase.hash` (fail-closed). |
| `server/services/DeployHealthService.ts` | فحص الإتاحة بعد النشر (قراءة-فقط، `requireCommitProof:false`، مضيف الإنتاج مرفوض). |
| `server/services/DeployVersionService.ts`, `server/routes/deploy-version.ts` | نقطة `/api/deploy-version` (404 ما لم يكن المشروع `rwqan-sa-dev`؛ Git fallback في `development` فقط). |
| `server/services/DeployGitInfoService.ts`, `DeployGitHubService.ts` | قراءة هوية Git والشجرة (قراءة فقط) ومقارنة SHA البعيد دون كتابة. |
| `apphosting.dev.yaml` | إعداد بيئة DEV للـbackend (Environment name=`dev`)؛ بلا حقن commit. |
| اختبارات الوحدات/المسارات/الواجهة (16 ملفًا) | **156/156** (E.11.4). |

**معدَّل**
| الملف | التعديل |
| --- | --- |
| `server/services/DeployExecutor.ts` | `DeployPublishOutcome` (`blocked`/`stage`/`target`/`releaseRef`/`verify`)، `DeployPublishStage`، مدخل `publish` (`approval`/`requestedTarget`)، `createDeployExecutor` يختار الحقيقي عند التفعيل. |
| `server/routes/admin/deploy.ts` | تمرير الموافقة/الهدف؛ `409`/`502`؛ تسجيل `deployTarget`/`deployRef`/`postDeploy`. |
| `shared/deploySystem.ts` | `DeployPostDeployVerification`، حقول `DeployRelease` الجديدة، `publish_blocked`، `deployTarget`/`realDeployEnabled` في `DeployState`. |
| `src/components/deploy-bar.tsx`, `src/components/admin/sections/deploy.tsx` | عرض حقيقي vs محاكاة، الهدف، `deployRef`، نتيجة التحقق؛ تأكيد صريح عند تفعيل النشر الحقيقي. |

### 10.3) الاختبارات (نتائج فعلية)
| المجموعة | النتيجة |
| --- | --- |
| `npx tsc --noEmit` | **0 أخطاء** (عدا `_probe_public.ts` غير المتتبَّع) |
| `deployTarget.test.ts` + `DeployHealthService.test.ts` + `DeployRealExecutor.test.ts` | **25/25** |
| `server/routes/admin/deploy.test.ts` | **28/28** |
| حزمة اختبارات النشر الخلفية (config+services) | **76/76** |
| `deploy-bar.test.ts` + `sections/deploy.test.ts` | **9/9** |

> `npm run build`: تجميع Next.js **نجح**، ثم فشل في خطوة TypeScript على `_probe_public.ts` (ملف غير متتبَّع
> خارج النطاق) ⇒ لا يُكتب `dist`. عائق `tsconfig.server.json` السابق (TS1378 في اختبار Paymob) **عولِج** باستثناء `*.test.ts`.

### 10.4) ما ينقص لتشغيل نشر DEV حقيقي (متطلبات المالك)
1. تثبيت/مصادقة Firebase CLI (`firebase`) — و`gcloud`/`docker` حسب الحاجة.
2. إنشاء App Hosting backend مستقل لمشروع `rwqan-sa-dev`، وربطه بمستودع GitHub (`iheeb1/rwqan-sa`) عبر Developer Connect، وضبط Environment name=`dev` لتفعيل `apphosting.dev.yaml` (لا `rwqan-757`)، مع تعطيل النشر التلقائي.
3. ~~توفير endpoint إصدار~~ **تم**: `/api/deploy-version` موجود في الكود؛ يبقى نشر DEV حقيقي للتحقق من الإتاحة.
4. ضبط `DEPLOY_DEV_BASE_URL` (مضيف DEV المنشور) — يُرفض أي مضيف إنتاجي.
5. معالجة عائق البناء الحالي في `_probe_public.ts` (ملف غير متتبَّع خارج النطاق) لإكمال `npm run build`.
6. توليد/تمرير اعتماديات DEV (بيانات اعتماد منفصلة تمامًا عن الإنتاج).

> حتى ذلك الحين: **المرحلة E = `NOT_DEPLOYED`**؛ النشر الحقيقي غير مُشغَّل، و«نشر» يبقى محاكاة افتراضيًا.

---

## 4) تحديث 0.2.0 — المسار الحقيقي الحالي (2026-11-04)

> هذا تحديث حالة لاحق يوضّح الوضع الفعلي في النسخة 0.2.0؛ لا يلغي التوثيق التاريخي أعلاه.

- النشر الحالي يتم عبر **GitHub Actions** (`workflow_dispatch`)، وليس عبر إعادة بناء
  محلية أو محاكاة:
  - TEST: مشروع `rwqan-757` / Backend `rwqan-backend` /
    `https://rwqan-backend--rwqan-757.europe-west4.hosted.app`؛ workflow
    `deploy-test.yml` على فرع `test/unified-gateway-ui-only`.
  - LIVE: مشروع `rwqan-757` / Backend `rwqan` / `https://rwqan.sa`؛ workflow
    `deploy-live.yml` على `main` — إعدادات LIVE لم تتغير في 0.2.0.
- الشريط يقرأ حالة التشغيل الحقيقية من المستودع العام (قراءة مجهولة دون أسرار)،
  ويعرض سبب الفشل والمهمة/الخطوة الفاشلة. لا يُعرض نجاح إلا بعد تحقق خطوة الـrollout،
  وعند تعذّر القراءة يُعرض السبب بوضوح دون نجاح وهمي.
- `deploy-test.yml` أصبح `workflow_dispatch` فقط (أُوقف trigger الـpush) لمنع نشر
  TEST تلقائيًا قبل الموافقة.
- LOCAL: بيئة تطوير ثابتة على `http://localhost:5001`؛ إزالة زر LOCAL من شريط
  البيئات قرار معتمد (DEC-015) **غير منفّذ** في هذا الـCommit.
- لم يُنفَّذ أي نشر TEST أو LIVE في هذا التحديث؛ والتغييرات الموصوفة مُلتزمة في
  `190b43577b3eee10b835579aa63d2c155fd7e660`.

---

## 5) تحديث 0.3.0 — تحرير LIVE (2026-11-04)

- أُزيل التفعيل الإنتاجي المنفصل `DEPLOY_ALLOW_PRODUCTION` نهائيًا؛
  `productionDeployEnabled()` يعكس `DEPLOY_REAL_DEPLOY` فقط. لم يعد LIVE محظورًا
  برمجيًا.
- النشر الحقيقي يبقى عبر GitHub Actions (`deploy-live.yml` على `main`)، وليس محاكاة.
- تبقى فحوص البناء وصحة الوجهة وجلسة المسؤول/نفس المصدر وفحوص GitHub إلزامية.
- الروابط المعتمدة: LIVE `https://rwqan--rwqan-757.europe-west4.hosted.app/`،
  TEST `https://rwqan-backend--rwqan-757.europe-west4.hosted.app/`.
- النطاق الرسمي `https://rwqan.sa` لم يُمس (الدفع/واتساب/الحجوزات/SEO كما هي).
- أُزيلت روابط التطوير القديمة (us-central1/europe-west1 وrwqan-sa-dev) من الإعدادات
  والاختبارات؛ وملف `apphosting.dev.yaml` وُسم legacy ولم يُحذف.
- التحقق دون نشر: حالة LIVE تُظهر `productionDeployEnabled=true`،
  `production_opt_in=ok`، `target_config=ok`، `release_checks=ok`.
- القيود المتبقية: شجرة عمل غير نظيفة حتى commit معتمد، و`DEPLOY_GITHUB_TOKEN` مطلوب
  لإرسال GitHub وغير موجود محليًا. لا نشر تم تنفيذه.

---

## 6) تحديث 0.3.1 — إزالة LOCAL وزر النشر العام (2026-11-04)

- أُزيل خيار LOCAL من مبدّل البيئات (DEC-015)؛ المبدّل يعرض TEST/LIVE فقط. LOCAL
  بيئة ثابتة على `http://localhost:5001` دون تغيير في اكتشافها/تشغيلها.
- أُزيل زر «نشر» العام (أيقونة السحابة)؛ بقي «نشر نسخة التجربة» و«نشر الموقع الرسمي»
  وحالة TEST/LIVE وآلية النشر دون تغيير.
- لم تتغير روابط البيئات أو إعدادات النشر أو الوظائف الأخرى. لا نشر تم تنفيذه.
- التحقق: TypeScript 0 أخطاء؛ اختبارات الشريط/القسم 19/19 ناجحة.

---

## 7) تحديث 0.4.0 — معالجة Git التلقائية الآمنة لزر TEST (2026-11-04)

- زر TEST يعالج التغييرات المحلية تلقائيًا: فحص كل مسار، إجهاض كامل عند الأسرار،
  استبعاد الملفات المحلية/غير المقصودة، ثم Commit يحمل الإصدار وملخص التعديلات.
- الدفع فقط إلى `test/unified-gateway-ui-only` مع التحقق من طرف الفرع البعيد قبل طلب
  إرسال `deploy-test.yml`. دفع `main` غير ممكن.
- فحوص الأسرار وTypeScript إلزامية قبل الـCommit ولا تُتجاوز. LIVE لا يُنشئ Commit
  تلقائيًا وآليته دون تغيير؛ LOCAL دون تغيير.
- التحقق: TypeScript 0 أخطاء؛ حزمة النشر 291/291؛ الشريط/القسم 16/16. لم يُنفَّذ نشر
  TEST حقيقي؛ `DEPLOY_GITHUB_TOKEN` مطلوب على الخادم وكان غائبًا محليًا.

---

## 8) تحديث 0.4.1 — فحص الأسرار: عيّنات اختبار لا أسرار حقيقية (2026-11-04)

- آخر فشل TEST كان في `secretScan`، لا في TypeScript ولا في النشر.
- السبب: عيّنات صناعية بشكل مفاتيح داخل `DeployRealExecutor.test.ts`، أُعيد بناؤها وقت
  التشغيل فصار الملف المصدر لا يطابق الأنماط مع بقاء اختبارات الحجب فعّالة.
- لا استثناء لملفات الاختبار ولا تخفيف لأي فحص. سبب الفحص يذكر اسم الملف المخالف فقط.
- لم يبدأ أي Commit/Push/Actions/App Hosting، ولم تتغيّر نسخة TEST العاملة.

---

## 9) تحديث 0.4.2 — إثبات عدم استدعاء الالتزام التلقائي (2026-11-04)

- الخادم الجاري كان قد بدأ قبل كتابة راوت الالتزام، و`tsx` لا يعيد التحميل الساخن، فكان
  يشغّل كودًا قديمًا لا يستدعي `DeployTestAutoCommitService`.
- أُزيل التجاوز الصامت: TEST يفشل `DEPLOY_GIT_UNAVAILABLE` إذا تعذّر فحص Git المحلي.
- الفحوص الناجحة تُحفظ قبل الـCommit، والالتزام يُستدعى قبل الإرسال، وتفاصيل فشل
  Commit/Push تُعاد منقّحة، ويُحدَّث SHA/حالة الشجرة في الشريط.
- لم يُنفَّذ Commit/Push أو نشر حقيقي. حزمة النشر 293/293، الشريط 16/16، TS 0 أخطاء.

---

## 10) تحديث 0.4.3 — البوابة النهائية تعتمد الالتزام المتحقق (2026-11-04)

- الشجرة الخام تبقى dirty بعد الالتزام بسبب ملفات محلية مستبعدة (`reports/`…)، فكانت
  البوابة ترفض TEST رغم حفظ كل التغييرات المعتمدة.
- الخدمة تعيد فحص ما بعد الـCommit، تفشل مغلقًا عند بقاء تغيير معتمد، وتُرجع `remaining`
  و`publishWorktree: clean`. المسار يستخدمها كإثبات نهائي (SHA جديد + شجرة نظيفة).
- بوابة TEST تعرض «سيُحفظ تلقائيًا»؛ LIVE وLOCAL صارمان. لا Commit فارغ ولا دفع لـ`main`.
- حزمة النشر 297/297، الشريط 17/17، TS 0 أخطاء. لم يُنفَّذ Commit/Push أو نشر حقيقي.
