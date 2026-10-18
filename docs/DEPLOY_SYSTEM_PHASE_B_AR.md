# RWQAN DEPLOY — تقرير المرحلة B (الواجهة والنموذج الأولي)

> هذا التقرير يوثّق **المرحلة B** فقط من مشروع «RWQAN DEPLOY» كما هي معرّفة في
> `docs/DEPLOY_SYSTEM_PLAN_AR.md`. المرحلة B = نموذج أولي آمن (prototype) +
> واجهة إدارية + اختبارات + توثيق. **داخل نسخة التطوير (DEV) فقط.**
>
> المرجع الأعلى: `docs/START_HERE.md` و`docs/DEPLOY_SYSTEM_PLAN_AR.md`.

---

## 0) الخلاصة

نظام النشر أصبح له **هيكل كامل قابل للاختبار** (بيانات + بوابة بيئة + متجر بالذاكرة +
مسارات API محمية + واجهة إدارية)، وكل العمليات فيه **محاكاة صريحة**:
لا `git push`، ولا `firebase deploy`، ولا أي اتصال بالإنتاج أو قاعدته.

- **الحالة:** مكتمل للاختبار الداخلي في DEV — ينتظر موافقة المالك للانتقال إلى المرحلة C.
- **`tsc --noEmit`:** 0 أخطاء.
- **اختبارات المرحلة B (+ تعديل المراجعة):** 15/15 ناجحة (10 للنظام + 5 للشريط العام).
- **تغييرات كود الإنتاج:** لا شيء (كل الإضافات DEV-gated وتفشل مغلقًا خارج DEV).

---

## 1) نطاق المرحلة B وما خرج عنها

**داخل النطاق (نُفِّذ):**
- نموذج بيانات مشترك (`shared/deploySystem.ts`).
- بوابة بيئة (DEV فقط، فشل مغلق).
- متجر بالذاكرة يحاكي شكل بيانات Firestore المستقبلي.
- مسارات Admin API محمية بثلاث طبقات.
- واجهة إدارية (قسم «نظام النشر»).
- اختبارات خادم + واجهة.
- هذا التقرير.

**خارج النطاق (مؤجَّل صراحةً):**
- أي اتصال أو كتابة في GitHub (Token/App).
- أي نشر فعلي أو استعادة فعلية (Firebase App Hosting / Rollout).
- تفعيل مفتاح LIVE أو قراءة بيانات الإنتاج.
- CI/CD، الفروع، الوسوم، آلية الإصدارات الإنتاجية.
- الاستمرارية في Firestore (المرحلة C).
- مراحل C/D/E/F بالكامل.

---

## 2) الملفات

### أُنشئت في المرحلة B
| الملف | الدور |
| --- | --- |
| `shared/deploySystem.ts` | أنواع وثوابت النموذج (بيئة، حالة إصدار، فحوص، سجل تدقيق، واصفات الحالات). |
| `server/config/deployEnvironment.ts` | بوابة `deploySystemEnabled()` = `NODE_ENV === "development"` فقط + جسم الرفض. |
| `server/services/DeploySystemStore.ts` | عقد المتجر + `InMemoryDeploySystemStore` (5 إصدارات بذرة `simulated:true`) + `buildDeployState()`. |
| `server/routes/admin/deploy.ts` | مسارات Admin API للنظام (محمية بـ 3 طبقات). |
| `server/routes/admin/deploy.test.ts` | اختبارات المسارات (حماية/تحقق/محاكاة/تدقيق). |
| `src/components/admin/sections/deploy.tsx` | واجهة قسم «نظام النشر». |
| `src/components/admin/sections/deploy.test.ts` | اختبار مصدري لتكامل الواجهة. |
| `src/components/deploy-bar.tsx` | شريط النشر العام (يظهر في كل الصفحات) — إضافة المراجعة. |
| `src/components/deploy-bar.test.ts` | اختبار الشريط العام — إضافة المراجعة. |
| `docs/DEPLOY_SYSTEM_PHASE_B_AR.md` | هذا التقرير. |

### عُدِّلت (تعديلات جراحية صغيرة)
| الملف | التعديل |
| --- | --- |
| `server/routes/index.ts` | استيراد وتسجيل `adminDeployRoutes` (سطران). |
| `src/components/admin/admin-dashboard.tsx` | استيراد أيقونة `Rocket`، استيراد القسم، إضافة `"deploy"` إلى `AdminSection`، زر شريط جانبي، وسطر العرض. |
| `src/app/admin/[...section]/page.tsx` | إضافة `"deploy"` إلى `validSections`. |
| `src/app/layout-content.tsx` | تركيب `<DeployBar />` مرة واحدة في هيكل التطبيق العام — إضافة المراجعة. |
| `src/app/globals.css` | قواعد إزاحة مُقيَّدة بـ`html.rwqan-deploy-active` (تظهر في DEV فقط) — إضافة المراجعة. |

---

## 3) النموذج (`shared/deploySystem.ts`)

- `DeployEnvironment = "TEST" | "LIVE"` — الافتراضي `TEST`.
- `DeployReleaseStatus`: `draft | validated | validation_failed | saved_to_git | deploying | deployed | failed | rolled_back | simulated`.
- `DeployChecks`: `typescript | tests | build | secretScan | postDeployHealth` بقيم `PASS | FAIL | BLOCKED | NOT_RUN`.
- `DeployRelease`: يحمل **حالتين منفصلتين** `savedToGit` و`deployed` (لا يُخلط «حفظ في Git» بـ«نشر»)، إضافةً إلى `simulated`, `deployTarget`, `sourceRepoUrl`, `gitCommit`, `gitTag`, `gitBranch`, `checks`, `createdBy`, `error`.
- `DEPLOY_RELEASE_HISTORY_LIMIT = 5` (آخر 5 إصدارات)، `DEPLOY_AUDIT_HISTORY_LIMIT = 100`.
- `DEPLOY_ENVIRONMENT_NOTICE` + `DEPLOY_STATE_DESCRIPTORS` (وصف عربي لكل حالة).
- `DeployState`: لقطة آمنة للعرض (لا تحتوي أي أسرار).

---

## 4) البوابة والحماية (ثلاث طبقات)

طلب أي نقطة في النظام يمرّ بالترتيب:

1. **حد `/api/admin` المركزي** (`server/routes/index.ts:120`):
   `app.use("/api/admin", requireSameOrigin, requireAdmin)`.
   - غير مُسجَّل → **401**.
   - طلب متصفح من أصل مختلف → **403**.
2. **حماية إضافية على مستوى الراوتر نفسه**
   (`router.use("/api/admin/deploy", requireSameOrigin, requireAdmin)`):
   حماية مزدوجة مستقلة عن أي خطأ في التركيب.
3. **بوابة DEV**: إن لم يكن `NODE_ENV === "development"` → **404**
   `{"code":"DEPLOY_SYSTEM_DISABLED"}`, فلا يمكن حتى معرفة وجود النظام من الإنتاج/CI.

كل الردود تحمل `Cache-Control: no-store, private`.

> **فشل مغلق:** في الإنتاج/CI/Staging تكون `deploySystemEnabled()` = `false`، لذا النظام
> غير قابل للوصول إطلاقًا حتى لو وُجد زر مخفي في الواجهة.

---

## 5) واجهة الـ API

القاعدة: `/api/admin/deploy`. كل النقاط محمية كما في القسم 4.

| الطريقة | المسار | المدخل | النجاح | أخطاء التحقق |
| --- | --- | --- | --- | --- |
| GET | `/state` | — | `200` + `{ prototypeVersion, state }` | — |
| POST | `/environment` | `{ environment: "TEST" \| "LIVE" }` | `200 { state }` | `400 INVALID_ENVIRONMENT` |
| POST | `/releases` | `{ version?, gitCommit?, gitBranch? }` | `201 { release, audit, state }` | يُطبِّق قيمًا افتراضية آمنة |
| POST | `/releases/:releaseId/restore` | `{ confirm: true }` | `200 { restored, state }` | `400 CONFIRMATION_REQUIRED` / `400 INVALID_RELEASE_ID` / `404 RELEASE_NOT_FOUND` / `409 RELEASE_INCOMPLETE` / `409 LIVE_PREVIEW_NOT_IMPLEMENTED` |

- **`buildDeployState()`** يبني لقطة عرض ثابتة: البيئة، النص التحذيري،
  `livePreviewImplemented: false`, `experimental: true`, الإصدارات، سجل التدقيق، وواصفات الحالات.
- **`/releases`** تنشئ إصدارًا بحالة `simulated` دائمًا: `savedToGit:false`, `deployed:false`،
  وكل الفحوص `NOT_RUN`. **لا تُنفِّذ Git ولا نشرًا.**
- **`/restore`** ترفض: الإصدار المجهول (بلا `gitCommit`)، الإصدار غير المكتمل
  (`validation_failed`/`failed`)، وإصدار `LIVE` (معاينة الإنتاج غير مُنفَّذة). كل
  محاولة مرفوضة تُسجَّل `restore_rejected`، والناجحة `restore_simulated`.
- **الحدود:** `version ≤ 40`، `gitCommit ≤ 80`، `gitBranch ≤ 120`، `releaseId ≤ 120`.

---

## 5.1) سجل التدقيق

كل إجراء إداري يُضاف إلى سجل غير قابل للتعديل من العميل، بإجراءات:
`publish_simulated`, `restore_simulated`, `restore_rejected`, `environment_changed`,
`deploy_started`, `deploy_succeeded`, `deploy_failed`, `rolled_back`.
القيمة تُحصر بـ `DEPLOY_AUDIT_HISTORY_LIMIT` (100). **لا تُسجَّل أي أسرار.**

---

## 6) الواجهة (`src/components/admin/sections/deploy.tsx`)

- قسم مستقل في لوحة الإدارة «نظام النشر» (أيقونة `Rocket`).
- **مفتاح البيئة:** زران `TEST` (الافتراضي) و`LIVE`، مع شارة البيئة النشطة.
- **زر «نشر (محاكاة)»** → `POST /releases`.
- **زر «استعادة (محاكاة)»** لكل إصدار → يتطلب `window.confirm` صريحًا.
- جدول **آخر 5 إصدارات**: الإصدار/البيئة/الحالة/المصدر، وعمودان منفصلان
  «محفوظ في GitHub» و«منشور» (لإبراز الفرق).
- **دليل الحالات** من `DEPLOY_STATE_DESCRIPTORS`.
- **سجل التدقيق** (الوقت/الإجراء/البيئة/النتيجة/السبب).
- **بانر تجريبي بارز:** «وضع تجريبي: كل العمليات محاكاة — لا نشر ولا اتصال بالإنتاج».
- لا تُضمَّن أي أسرار ولا أي عنوان إنتاجي.

---

## 7) الاختبارات (نتائج فعلية)

```
node --import tsx --test --test-concurrency=1 \
  server/routes/admin/deploy.test.ts \
  src/components/admin/sections/deploy.test.ts
```

**النتيجة: 10 اختبارات — 10 نجاح / 0 فشل.**

حالات الخادم (7):
1. الزوّار (بلا جلسة) → 401 على `GET /state` و`POST /environment` و`POST /releases` دون أي تغيير حالة.
2. طلب إداري من أصل مختلف → 403 دون تغيير الحالة.
3. البوابة معطّلة (خارج DEV) → 404 `DEPLOY_SYSTEM_DISABLED`.
4. جلسة إدارية → 200، البيئة الافتراضية `TEST`، 5 إصدارات، `experimental:true`،
   `livePreviewImplemented:false`، `Cache-Control: no-store, private`، ولا أسرار في الحمولة.
5. تبديل البيئة: `PROD` → 400 بلا تغيير، و`LIVE` → 200 مع تسجيل `environment_changed`.
6. النشر: 201، الإصدار `simulated` و`savedToGit:false`/`deployed:false`، تسجيل `publish_simulated`،
   حصر السجل بـ5.
7. الاستعادة: بلا تأكيد → 400، مجهول → 404، غير مكتمل → 409، صالح → 200،
   وتسجيل `restore_rejected`(×2) + `restore_simulated`(×1).

حالات الواجهة (3): تسجيل القسم وربطه بالـ dashboard و`validSections`، ربطه بنقاط
`/api/admin/deploy/*` مع `window.confirm` وحالة تجريبية، وخلوّه من الأسرار/عناوين الإنتاج.

---

## 8) القيود التي التزمنا بها

- لا تعديل `.firebaserc` ولا أي إعداد استهداف إنتاج.
- لا `git push` ولا `git commit` ولا `firebase deploy` ولا أي نشر.
- لا اتصال بقاعدة بيانات الإنتاج ولا قراءتها/تعديلها.
- لا تفعيل مفاتيح LIVE ولا الدفع/WhatsApp الحقيقيين.
- لا إنشاء Tokens أو Service Accounts أو موارد سحابية.
- تعديلات جراحية فقط على الملفات القائمة (لا استبدال كامل).
- لم تُطبَع أي أسرار أثناء التنفيذ.

**مخرجات `git status` المتوقعة:** ملفات `deploy`/`deploy-bar` الجديدة (untracked) + 5 ملفات
معدَّلة (`server/routes/index.ts`, `src/components/admin/admin-dashboard.tsx`,
`src/app/admin/[...section]/page.tsx`, `src/app/layout-content.tsx`, `src/app/globals.css`)
+ هذا التقرير. **لا commits.**

---

## 9) ما لم يُنفَّذ (بأمانة)

- **LIVE:** معاينة/استعادة الإنتاج غير مُنفَّذة (تعود `409 LIVE_PREVIEW_NOT_IMPLEMENTED`)؛
  المفتاح موجود للعرض فقط.
- **الاستمرارية:** المتجر بالذاكرة؛ يُفقد عند إعادة التشغيل (مقصود في المرحلة B).
- **Git/CI/CD:** لا دمج فعلي ولا وسوم ولا فروع إصدار.
- **Rollout/Restore الحقيقي في App Hosting:** الآلية لا تزال UNKNOWN (مرحلة A).
- **الواجهة الفعلية للنشر:** كل شيء محاكاة معروضة بوضوح.

---

## 10) الخطوة التالية (المرحلة C — بانتظار موافقة)

المرحلة C (مقترحة، ولا تبدأ دون موافقة صريحة): استمرارية المتجر في Firestore
(`server/services/DeploySystemStore.ts` → متجر Firestore بنفس العقد)، مع بقاء النشر
محاكاةً وبقاء بوابة DEV. تليها المراحل D–F وفق خطة المرحلة A.

**المرجع الكامل للخطة:** `docs/DEPLOY_SYSTEM_PLAN_AR.md`.

---

## 11) تعديل المراجعة: شريط نشر عام في كل صفحات DEV

**المتطلب:** شريط ثابت أعلى نسخة DEV بالكامل (لا داخل لوحة الإدارة فقط)، يظهر في
الرئيسية وتفاصيل/قوائم العقارات والمدونة والحساب وباقي الصفحات، مثبّت أثناء التمرير،
متوافق مع الجوال/سطح المكتب/RTL، دون تغطية المحتوى أو تعارض مع التنقل، وللمستخدم
الإداري المصرّح فقط في DEV.

### 11.1) مكان التركيب (فحص هيكل التطبيق)

- `src/app/layout.tsx` (Root Layout) → يستدعي `src/app/layout-content.tsx`.
- `layout-content.tsx` هو **هيكل التطبيق العام** الذي يغلّف كل الصفحات
  (`Header` + `<main>` + `Footer`) داخل `QueryProvider`.
- لذلك أُضيف الشريط هناك **مرة واحدة** كأول عنصر داخل عمود التخطيط:
  `import { DeployBar } from "@/components/deploy-bar"` ثم `<DeployBar />`.
- النتيجة: الشريط موجود في كل المسارات (الرئيسية، العقارات، المدونة، الحساب، الإدارة…)
  دون تكرار، لأن `layout-content` يبقى مركّبًا عبر التنقلات.

### 11.2) المكوّن `src/components/deploy-bar.tsx`

- **ظهور مزدوج الشرط (فشل مغلق):** يُعرض فقط إذا كان بناء العميل تطويريًا
  (`process.env.NODE_ENV === "development"`) **و** أعاد الخادم `200` من
  `/api/admin/deploy/state` (أي المستخدم إداري مصرّح في DEV). في بناء الإنتاج لا
  يُنفَّذ أي طلب إطلاقًا ولا يظهر أي شيء → سلوك الإنتاج بلا تغيير.
- **إخفاء الشريط ليس حدّ الأمان:** العمليات تبقى محمية على الخادم
  (`requireSameOrigin` + `requireAdmin` + بوابة DEV).
- **المحتوى:** اسم `RWQAN DEPLOY`، شارة البيئة `TEST`/`LIVE` (قراءة فقط)، وأزرار
  «نشر» و«استعادة» و«الإصدارات»، ورقم الإصدار ونص «محاكاة».
- **«نشر»** → `POST /api/admin/deploy/releases` (محاكاة). **«استعادة»/«الإصدارات»**
  → تفتح لوحة صغيرة أسفل الشريط تعرض آخر 5 إصدارات مع زر استعادة لكل إصدار
  (يتطلب `window.confirm`، ويُعطَّل للمصادر المجهولة/غير المكتملة/إصدار LIVE).
- كل العمليات محاكاة؛ لا GitHub/نشر/استعادة فعلية/اتصال بالإنتاج.

### 11.3) الإزاحة ومنع التغطية/التعارض

الشريط `fixed top-0 z-[100]` بارتفاع 40px. لتجنّب تغطية المحتوى أو تعارضه مع
رؤوس الصفحات المثبّتة (`sticky top-0`)، أُضيفت قواعد **مُقيَّدة** في `globals.css`:

```css
html.rwqan-deploy-active body { padding-top: var(--rwqan-deploy-bar-height, 40px); }
html.rwqan-deploy-active .header-glass.sticky,
html.rwqan-deploy-active header.sticky.top-0 { top: var(--rwqan-deploy-bar-height, 40px); }
```

- الفئة `rwqan-deploy-active` تُضاف على `<html>` عبر `useEffect` **فقط عندما يكون
  الشريط مرئيًا**، وتُزيل عند الإخفاء/إلغاء التركيب. الإنتاج لا يحملها أبدًا.
- القاعدة الثانية تُزيح كل الرؤوس العلوية المثبّتة (رئيسي/مدونة/صفحة المالك) أسفل
  الشريط تلقائيًا، فلا تعارض مع التنقل ولا تغطية.
- الشريط ذو `overflow-x-auto` وارتفاع ثابت → متوافق مع الجوال بلا التفاف يكسر
  التخطيط، ويحترم RTL عبر `dir="rtl"`.

### 11.4) الاختبارات المضافة

`src/components/deploy-bar.test.ts` (4 اختبارات مصدرية):
1. الشريط مركّب **مرة واحدة** في `layout-content` (منع التكرار).
2. يُفعَّل الاستعلام فقط في بناء DEV (`enabled: isDevelopment`) ولا يعرض شيئًا بلا بيانات.
3. يعرض `RWQAN DEPLOY` والبيئة `TEST`/`LIVE` والأزرار الثلاثة و`window.confirm`.
4. يتحدث فقط إلى `/api/admin/deploy/*`، محاكاة صراحةً، وبلا أسرار أو عناوين إنتاج.
5. قاعدة CSS للإزاحة مقيّدة بـ`html.rwqan-deploy-active`.

**النتيجة:** 5/5 ناجحة (إضافةً إلى 10 اختبارات المرحلة B السابقة ⇒ 15/15).

### 11.5) التحقق الحي على خادم DEV (بلا أداة متصفح آلية)

> **ملاحظة صدق:** أدوات المتصفح الآلية (Playwright/Puppeteer) **غير متاحة** في هذه
> البيئة، لذا تعذّر التقاط لقطة بصرية للشريط. الاستدلال التالي هو أقوى دليل متاح:
> عقد الخادم حيّ + أن كود العميل يُخدَّم فعلًا + أن الصفحات تُترجم بلا أخطاء.

أُعيد تشغيل خادم DEV (`npm run dev`, NODE_ENV=development, PORT=5001) لتحميل المسارات
الجديدة، ثم نُفِّذ الفحص الحي التالي (لا أسرار مطبوعة):

| الفحص | النتيجة |
| --- | --- |
| `GET /api/admin/deploy/state` بلا جلسة | **401** (محمي) |
| `POST /api/admin/login` ثم `GET .../state` | **200**، `env=TEST`, `releases=5`, `experimental=true`, `livePreviewImplemented=false`, `Cache-Control: no-store, private` |
| `POST /api/admin/deploy/releases` (أدمن) | **201**، `status=simulated`, `simulated=true`, `savedToGit=false`, `deployed=false` |
| صفحات `/` و`/properties` و`/blog` | **200** (لا كسر للتخطيط/الترجمة) |
| حزمة العميل `/_next/static/chunks/app/layout.js` | تحتوي كود الشريط (`RWQAN DEPLOY` / `api/admin/deploy/state`) ⇒ الشريط مُضمَّن في هيكل التطبيق المخدوم |
| ورقة الأنماط `/_next/static/css/app/layout.css` | تحتوي قاعدة `rwqan-deploy-active` ⇒ الإزاحة مُترجَمة ومخدومة |

**الخلاصة:** الشريط مُركَّب في الهيكل العام وواجهة برمجته تعمل حيًّا للأدمن في DEV،
ويُخفى بالكامل (بلا طلب) في الإنتاج. **لا يزال التحقق البصري داخل متصفح حقيقي غير
مُنفَّذ** لعدم توفر أداة متصفح؛ يُوصى بمشاهدته يدويًا: تسجيل دخول الأدمن في DEV ثم
فتح `/` و`/properties` و`/blog` والتأكد من ثبات الشريط أعلى كل صفحة دون تغطية.

### 11.6) ملفات هذا التعديل

- **جديد:** `src/components/deploy-bar.tsx`, `src/components/deploy-bar.test.ts`.
- **معدَّل (جراحي):** `src/app/layout-content.tsx` (سطرا التركيب)، `src/app/globals.css`
  (قواعد الإزاحة المقيّدة).
- **بلا تغيير:** `header.tsx` وباقي الرؤوس (تُزاح عبر CSS العام المقيّد فقط).

