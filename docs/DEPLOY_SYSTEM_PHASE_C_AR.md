# RWQAN DEPLOY — تقرير المرحلة C (سجل دائم + سجل تدقيق دائم)

> هذا التقرير يوثّق **المرحلة C** من مشروع «RWQAN DEPLOY» كما طُلبت: مخزن **دائم**
> لسجل الإصدارات وسجل التدقيق في Firestore لمشروع **DEV المعزول** `rwqan-sa-dev`،
> مع زرّي «نشر» (تسجيل دائم فقط) و«استعادة» (عرض آخر 5 إصدارات بترتيب تنازلي).
> **داخل نسخة التطوير (DEV) فقط، وبلا أي نشر/commit/push حقيقي.**
>
> المرجع الأعلى: `docs/START_HERE.md` و`docs/DEPLOY_SYSTEM_PLAN_AR.md`.

---

## 0) الخلاصة

سجل الإصدارات وسجل التدقيق أصبحا **دائمين في Firestore داخل مشروع DEV المعزول**
`rwqan-sa-dev`، مع **فشل مغلق**: إن لم يُثبَت أن المشروع هو `rwqan-sa-dev` (أو غاب
Admin SDK) تُرفض الكتابة (لا نجاح وهمي). كل ما يُصنَّف «منشور» أو يُلتزَم بـGit **لا يحدث
فعليًا**؛ زر «نشر» يحفظ **سجلًا فقط** ويوضّح ذلك للمستخدم.

- **الحالة:** المرحلة C مكتملة ومختبَرة. لا انتقال إلى D/E/F.
- **`npx tsc --noEmit`:** 0 أخطاء.
- **الاختبارات المتعلقة:** 18/18 (خادم+خدمة+بوابة) + 43/43 (runtimeEnvironment) + 8/8 (واجهة) = **69/69**.
- **التحقق الحي:** كُتبت سجلات فعلية في Firestore DEV ثم حُذفت؛ تأكّد الإنشاء/القراءة/الترتيب/الاحتفاظ بآخر 5/التدقيق.
- **تغييرات منطق أعمال غير مرتبط:** لا شيء.

---

## 1) النطاق وما خرج عنه

**داخل النطاق (نُفِّذ):**
- مخزن Firestore دائم لسجل الإصدارات + سجل التدقيق في مشروع DEV فقط.
- بوابة مشروع فشل-مغلق + متجر «غير متاح» يمنع أي كتابة بلا إثبات المشروع.
- فحوص خادمية للقراءة فقط: كشف Git (commit/branch/tag/remote) + فحص أسرار.
- زر «نشر» يحفظ سجلًا دائمًا بعد الفحوص، مع توضيح أنه «حفظ سجل فقط».
- زر «استعادة» يعرض آخر 5 إصدارات تنازليًا + حالة فارغة واضحة (بلا استعادة فعلية).
- اختبارات + توثيق.

**خارج النطاق (لم يُنفَّذ — بالتصميم):**
- أي `git commit` أو `git push` أو `firebase deploy` أو اتصال بالإنتاج.
- حفظ فعلي في GitHub (يبقى مؤجّلًا؛ المرحلة C هنا = سجل دائم، لا كتابة Git).
- تشغيل `tsc`/الاختبارات/`next build` داخل الطلب (NOT_RUN مع سبب؛ ستُربط بـCI في المرحلة E).
- الاستعادة الفعلية (عرض فقط)، والمراحل D/E/F.

---

## 2) الملفات

### جديد
| الملف | الدور |
| --- | --- |
| `server/services/FirestoreDeploySystemStore.ts` | متجر Firestore DEV الدائم + مصنع فشل-مغلق. |
| `server/services/DeployChecksService.ts` | فحوص القراءة فقط (Git + فحص أسرار) + دوال نقية قابلة للاختبار. |
| `server/services/DeployChecksService.test.ts` | اختبارات الفحوص. |
| `server/config/deployEnvironment.test.ts` | اختبار بوابة DEV + إثبات مشروع DEV. |
- هذا التقرير.

**سكربتات فحص مؤقتة (أُنشئت ثم حُذفت):** `scripts/dev/inspect-firestore-phase-c.ts`,
`scripts/dev/verify-phase-c-firestore.ts`.

**معدَّل (تعديلات جراحية):**
| الملف | التعديل |
| --- | --- |
| `shared/deploySystem.ts` | إضافة `DeployGitSource`، `changeSummary`، `checkNotes`، `persistent`/`persistenceNotice` في `DeployState`، إجراء تدقيق `publish_failed`، و`DEPLOY_PUBLISH_NOTICE`. |
| `server/config/deployEnvironment.ts` | إضافة `deployPersistenceProjectConfirmed()` و`DEPLOY_STORE_UNAVAILABLE_BODY`. |
| `server/services/DeploySystemStore.ts` | إعادة بناء: عقد `async`، `InMemoryDeploySystemStore` async، `UnavailableDeploySystemStore`، `buildReleaseRecord`/`evaluateRestore`، مصنع قابل للتسجيل (بلا Firebase)، `buildDeployState` async. |
| `server/routes/admin/deploy.ts` | كل المسارات `async`، الحقول الحسّاسة تُشتق خادميًا، معالجة فشل التخزين (503). |
| `server/services/DeployChecksService.ts` | (جديد) |
| `server/services/FirestoreDeploySystemStore.ts` | (جديد) |
| `server/routes/index.ts` | تسجيل مصنع متجر Firestore (`setDeploySystemStoreFactory`). |
| `server/routes/admin/deploy.test.ts` | إعادة كتابة للعقد async + حالات جديدة. |
| `src/components/admin/sections/deploy.tsx` | عرض الاستمرارية/الفحوص/ملخص التغيير + رسائل «حفظ سجل فقط». |
| `src/components/deploy-bar.tsx` | حالة فارغة واضحة في لوحة الإصدارات. |
| `docs/DEPLOY_SYSTEM_PHASE_C_AR.md` | هذا التقرير. |

---

## 2.1) فحص Firestore DEV قبل التنفيذ (قراءة فقط)

- `firestore.rules`: `allow read, write: if false;` ⇒ **لا وصول للعميل إطلاقًا**؛ كل الوصول خادمي عبر Admin SDK. **لم تُعدَّل القواعد.**
- `firebase.json`: Backend في App Hosting بمعرّف `rwqan-backend` (لا تغيير).
- فحص مشروع DEV: `project_id = rwqan-sa-dev` (مطابق). المجموعات الموجودة: `contact_identity_sessions, customer_accounts, customer_phone_otp_issue_limits, discounts, feature_flags, owner_account_otp_challenges, owner_account_otp_issue_limits, owners, packages, properties, requests, subscriptions, test_users, verification_logs`. مجموعات نظام النشر لم تكن موجودة (تُنشأ عند أول كتابة).

---

## 3) التخزين الدائم (Firestore DEV)

المجموعات (تُكتب من الخادم فقط):

| المجموعة | الوثيقة | الترتيب | الاحتفاظ |
| --- | --- | --- | --- |
| `deploy_releases` | doc لكل إصدار (`releaseId`) | `createdAt` تنازليًا | الأحدث 5 فقط |
| `deploy_audit_log` | doc لكل إجراء (`audit-*`) | `at` تنازليًا | الأحدث 50 |
| `deploy_system_state` | `current` | — | حالة مفتاح البيئة |

- **الاحتفاظ:** بعد كل كتابة يُقتطع الأقدم (تُحذف الوثائق الزائدة) ليبقى الحد الأقصى.
- **بلا أسرار:** لا تُخزَّن أي مفاتيح؛ الحقول هي معرّفات/أوقات/فحوص/مصدر Git **منقّى من الاعتمادات**/ملخص نصي.
- **التنقية:** `sanitizeGitRemote()` تُزيل أي `user:pass@` من رابط Git قبل التخزين.

### الفشل المغلق (fail closed)
`createFirestoreDeploySystemStore()` تُعيد متجرًا دائمًا **فقط** إذا:
1. `deployPersistenceProjectConfirmed()` = `true` (أي `FIREBASE_SERVICE_ACCOUNT.project_id === "rwqan-sa-dev"`)، **و**
2. `db` (Admin SDK) متاح.

وإلا تُعيد `UnavailableDeploySystemStore`: القراءات فارغة و`persistent=false`، و**كل كتابة ترمي `DeployStoreUnavailableError`** ⇒ استجابة `503 DEPLOY_STORE_UNAVAILABLE`، فلا يُبلَّغ عن نجاح أبدًا.

---

## 4) الحقول المشتقة خادميًا (لا يتحكّم بها العميل)

| الحقل | المصدر |
| --- | --- |
| `gitCommit` / `gitBranch` / `gitTag` / `sourceRepoUrl` | فحص Git محلي **للقراءة فقط** (`git rev-parse`, `git describe`, `git config remote.origin.url`). |
| `status` | من الفحوص الخادمية: فشل فحص الأسرار ⇒ `validation_failed`، وإلا `simulated`. **لا يصل أبدًا إلى `deployed`.** |
| `createdBy` / `actor` | جلسة الأدمن (`"admin"`) — لا يُقرأ من الجسم. |
| `savedToGit` / `deployed` | `false` دائمًا. |

> العميل يرسل فقط `version` و`changeSummary` (نص وصفي). إرسال `gitCommit`/`status`/`createdBy`/`deployed` في الجسم **يُتجاهَل** (مغطّى باختبار).

---

## 5) الفحوص الخادمية (`DeployChecksService`)

كلها **للقراءة فقط**، بلا كتابة Git ولا شبكة ولا إنتاج:

- **فحص الأسرار:** يفحص أسماء الملفات في تغييرات شجرة العمل (`git status --porcelain`) + محتوى الملفات النصية (بحد 512KB).
  - اسم مشبوه (`.env`, `.env.production`, `*.pem`, `*.key`, `service-account*.json`, `id_rsa`…) ⇒ `FAIL`.
  - محتوى مشبوه (`PRIVATE KEY`, `sk_live_*`, `AIza…`, `AKIA…`, `ghp_*`, `xox…`, `"private_key":`) ⇒ `FAIL` (لا تُعاد القيمة).
  - تعذّر Git ⇒ `BLOCKED` (فشل مغلق، لا `PASS` وهمي).
- **`typescript` / `tests` / `build` / `postDeployHealth`:** `NOT_RUN` مع سبب صريح (لا تُشغَّل داخل طلب HTTP؛ تُضاف في مسار CI/المرحلة E).

---

## 6) واجهة الـ API (تغيّرات عن المرحلة B)

| الطريقة | المسار | النجاح | ملاحظات جديدة |
| --- | --- | --- | --- |
| GET | `/state` | `200 { prototypeVersion, publishNotice, state }` | `state.persistent` + `state.persistenceNotice`. |
| POST | `/environment` | `200 { publishNotice, state }` | فشل تخزين ⇒ `503`. |
| POST | `/releases` | `201 { release, audit, checks, checkNotes, publishNotice, state }` | `git/status/actor` خادمية؛ `503` عند فشل التخزين. |
| POST | `/releases/:id/restore` | `200 { restored, state }` | معاينة أهلية فقط (لا استعادة فعلية)؛ `503` عند فشل التخزين. |

- حدود الإدخال: `version ≤ 40`، `changeSummary ≤ 500`، `releaseId ≤ 120`.
- الردود تبقى `Cache-Control: no-store, private`، والمسارات محمية بـ`:401` غير مُسجَّل، `:403` أصل مختلف، `:404` خارج DEV.

---

## 7) الواجهة

- **قسم الإدارة:** بانر «وضع تجريبي (المرحلة C)»، شارة الاستمرارية (`persistent`)، نص `persistenceNotice`، وعمودا **ملخص التغيير** و**الفحوصات** (مع سبب فحص الأسرار). زر «نشر (محاكاة)» يوضّح «حُفظ سجل الإصدار فقط».
- **الشريط العام:** لوحة «الإصدارات والاستعادة» تعرض آخر 5 تنازليًا، مع **حالة فارغة واضحة** («لا توجد إصدارات محفوظة بعد»). الاستعادة تتطلب `window.confirm` وتُعطَّل لغير القابل للاستعادة.

---

## 8) الاختبارات (نتائج فعلية)

```
npx tsc --noEmit
node --import tsx --test --test-concurrency=1 \
  server/config/deployEnvironment.test.ts \
  server/services/DeployChecksService.test.ts \
  server/routes/admin/deploy.test.ts \
  src/components/deploy-bar.test.ts \
  src/components/admin/sections/deploy.test.ts
node --import tsx --test --test-concurrency=1 server/config/runtimeEnvironment.test.ts
```

| المجموعة | النتيجة |
| --- | --- |
| `npx tsc --noEmit` | **0 أخطاء** |
| `deployEnvironment.test.ts` | **2/2** |
| `DeployChecksService.test.ts` | **7/7** |
| `deploy.test.ts` (خادم) | **9/9** |
| `deploy-bar.test.ts` + `sections/deploy.test.ts` | **8/8** |
| `runtimeEnvironment.test.ts` | **43/43** |

التغطية المطلوبة:
- **إنشاء/قراءة/ترتيب/الاحتفاظ بآخر 5:** اختبار «ordered newest-first and capped at five» + التحقق الحي.
- **رفض غير المصرّح:** 401 (بلا جلسة) و403 (أصل مختلف) بلا أي تغيير في المتجر.
- **رفض الإنتاج:** `deploySystemEnabled` false خارج DEV، و`deployPersistenceProjectConfirmed` false لأي مشروع ≠ `rwqan-sa-dev`، والواجهة تفشل مغلقًا.
- **فشل التخزين بلا نجاح وهمي:** `UnavailableDeploySystemStore` ⇒ `state.persistent=false` والكتابات `503`.
- **منع تلاعب العميل بالحالة/الهوية/القيم:** إرسال `gitCommit/status/createdBy/deployed` من العميل لا يؤثر (اختبار صريح).
- **فحص الأسرار:** ملف سري ⇒ `validation_failed` + `publish_failed`، وتعذّر Git ⇒ `BLOCKED`.

---

## 8.1) التحقق الحي (Firestore DEV حقيقي)

سكربت تحقق مؤقت (حُذف بعد التشغيل) استخدم `FirestoreDeploySystemStore` مباشرة:
- `project_id = rwqan-sa-dev` مؤكَّد، `deployPersistenceProjectConfirmed() = true`.
- تبديل البيئة LIVE ثم إرجاعها TEST.
- إنشاء **7** إصدارات ⇒ القراءة أعادت **5** (الأحدث فقط) بترتيب `createdAt` تنازليًا؛ القراءة الثانية أثبتت الدوام.
- تسجيل **3** إدخالات تدقيق ⇒ القراءة أعادت الأحدث أولًا.
- ثم **حُذفت** كل السجلات التجريبية و`deploy_system_state/current` لترك السجل نظيفًا.

**النتيجة:** `OK: Firestore durable store verified (create/list/order/retain/audit).`

> ملاحظة صدق: أدوات المتصفح الآلية (Playwright/Puppeteer) غير متاحة في هذه البيئة، لذا
> تعذّر التقاط لقطة بصرية للواجهة. التحقق أعلاه يثبت عقد الخادم والتخزين الفعلي.

---

## 9) القيود التي التزمنا بها

- لا تعديل `.firebaserc` ولا أي إعداد استهداف إنتاج ولا `firestore.rules`.
- لا `git commit/push` ولا `firebase deploy` ولا أي نشر حقيقي (كل السجلات `savedToGit:false, deployed:false`).
- لا استخدام مشروع الإنتاج `rwqan-757` ولا أي اتصال بقاعدته.
- لا أسرار في السجلات ولا في المخرجات (رابط Git منقّى، ومحتوى الأسرار لا يُعاد).
- تعديلات جراحية؛ لا تغيير لمنطق أعمال غير مرتبط.
- لم تُطبَع أي أسرار أثناء التنفيذ.

---

## 10) ما لم يُنفَّذ (بأمانة)

- **حفظ فعلي في GitHub:** لم يُنفَّذ (خارج نطاق هذه المهمة) ⇒ لا توجد حالة `saved_to_git` حقيقية.
- **النشر/الاستعادة الفعلية:** معطّلة؛ `status` لا يتجاوز `simulated`/`validation_failed`.
- **فحوص `tsc`/tests/build داخل الطلب:** `NOT_RUN` (تُنفَّذ في CI/المرحلة E).
- **LIVE:** معاينة الإنتاج لا تزال غير مُنفَّذة.
- **المراحل D/E/F:** لم تبدأ.

---

## 11) الخطوة التالية (تتوقف هنا)

المرحلة التالية المقترحة (بانتظار موافقة صريحة، ولا تبدأ تلقائيًا): ربط «حفظ في GitHub»
بمسار معزول + CI للفحوص (المرحلة E حسب خطة المرحلة A)، مع إبقاء النشر الفعلي معطّلًا حتى
مراجعة أمنية وموافقة. **أوقفنا العمل عند نهاية المرحلة C.**

---

# الملحق C-1) امتداد المرحلة C — هوية Git + GitHub + فحوص قابلة للتشغيل

> أُضيف لاحقًا داخل DEV فقط. الهدف: ربط سجل الإصدار بهوية Git المحلية (**قراءة-فقط**)،
> مقارنة قراءة-فقط مع GitHub، وتشغيل فحوص إصدار حقيقية **خارج الطلب**، وتحديث النموذج والواجهة.
> **لا `commit`/`push`/`fetch`/`deploy` ولا أي كتابة.** لا انتقال إلى D.

## C-1.0) الخلاصة
- **هوية Git محلية (قراءة-فقط):** SHA كامل/مختصر، الفرع، وحالة شجرة العمل (`clean`/`dirty`/`unknown`).
  الـHEAD **لا يُعتبر** دليلًا على مطابقة شجرة العمل؛ التغييرات ⇒ `dirty` مع تنبيه صريح.
- **GitHub (قراءة-فقط):** المقارنة عبر مرجع التتبّع المحلي `refs/remotes/origin/<branch>` (بلا شبكة).
  `git ls-remote` بديل **اختياري فقط** عند `DEPLOY_GITHUB_LS_REMOTE=enabled`. لا توكن، لا API، لا شبكة افتراضيًا.
- **فحوص قابلة للتشغيل:** إجراء صريح `POST /api/admin/deploy/checks` يشغّل فعليًا `tsc --noEmit`
  (قراءة-فقط) + فحص الأسرار، ويخزّن النتيجة ووقت التشغيل. tests/build/health تبقى `NOT_RUN` بسبب صريح.
- **فشل مغلق:** تعذّر Git/tsc/GitHub ⇒ `unavailable`/`BLOCKED` مع سبب آمن، بلا تخمين وبلا PASS وهمي.

## C-1.1) الملفات
**جديد**
| الملف | الدور |
| --- | --- |
| `server/services/DeployGitInfoService.ts` | قراءة هوية Git المحلية (قراءة-فقط). |
| `server/services/DeployGitHubService.ts` | مقارنة قراءة-فقط مع GitHub + `githubLsRemoteEnabled`. |
| `server/services/DeployChecksRunner.ts` | تشغيل `tsc`/فحص الأسرار فعليًا + أوقات/أوامر + فشل معروف. |
| `server/services/DeployGitInfoService.test.ts` | اختبارات هوية Git. |
| `server/services/DeployGitHubService.test.ts` | اختبارات مقارنة GitHub. |
| `server/services/DeployChecksRunner.test.ts` | اختبارات الفحوص. |

**معدَّل**
| الملف | التعديل |
| --- | --- |
| `shared/deploySystem.ts` | `DeployWorktreeState`/`DeployGitInfo`/`DeployGitHubMatch`/`DeployGitHubInfo`/`DeployCheckMeta`/`DeployCheckRun`؛ حقول اختيارية في `DeployRelease` (`gitShortSha`/`worktree`/`github`/`checksMeta`/`checkRunAt`)؛ `git`/`github`/`latestCheckRun` في `DeployState`؛ إجراء تدقيق `checks_run`. |
| `server/services/DeploySystemStore.ts` | عقد `recordCheckRun`/`getLatestCheckRun`؛ `buildReleaseRecord` يمنع النشر على `secretScan!=="PASS"` **أو `typescript==="FAIL"`** ويشتق الحقول الجديدة؛ `buildDeployState(store, context?)`. |
| `server/services/FirestoreDeploySystemStore.ts` | مجموعة `deploy_check_runs` (وثيقة `latest`) + `toCheckRun`. |
| `server/routes/admin/deploy.ts` | `readGitContext`؛ `GET /state` يمرّر السياق؛ `POST /checks` صريح؛ النشر يُطلَى بأحدث run مخزَّن مع بقاء فحص الأسرار الطازج مرجعًا. |
| `src/components/deploy-bar.tsx` | عرض SHA/الفرع/worktree/GitHub/أوقات الفحوصات + زر «فحوصات». |
| `src/components/admin/sections/deploy.tsx` | بطاقة «حالة المصدر» + زر «تشغيل الفحوصات» + أعمدة السجل. |
| `server/routes/admin/deploy.test.ts` | 6 اختبارات جديدة (سياق/فحوص/تجاوز مخزّن/منع TS FAIL/توافق خلفي). |

## C-1.2) نقاط قرار (من المستخدم)
- **قراءة SHA البعيد:** مرجع التتبّع المحلي أولًا (بلا شبكة)؛ `git ls-remote` اختياري عبر علم بيئة.
- **تنفيذ الفحوص:** إجراء **منفصل صريح** يخزّن النتائج؛ فحوص طلب النشر تبقى `NOT_RUN`/`BLOCKED` مع السبب.

## C-1.2.1) فشل اختبار معروف (مُوثَّق، غير مخفي)
- `server/services/BookingCommissionStore.test.ts` **فاشل بشكل معروف** (اختبار قديم لا يطابق النموذج الحالي)،
  **لا علاقة له بنظام النشر**، ولم يُصلَح هنا. مُدرَج في `DEPLOY_KNOWN_TEST_FAILURES` ويظهر في سبب فحص
  `tests` حتى لا يُقدَّم اختبار أحمر كأخضر. نجاح `tsc` **لا** يُقدَّم كنجاح اختبارات/بناء.

## C-1.3) الاختبارات (نتائج فعلية)
```
npx tsc --noEmit
node --import tsx --test --test-concurrency=1 \
  server/config/deployEnvironment.test.ts \
  server/services/DeployChecksService.test.ts \
  server/services/DeployGitInfoService.test.ts \
  server/services/DeployGitHubService.test.ts \
  server/services/DeployChecksRunner.test.ts \
  server/routes/admin/deploy.test.ts \
  src/components/deploy-bar.test.ts \
  src/components/admin/sections/deploy.test.ts
```
| المجموعة | النتيجة |
| --- | --- |
| `npx tsc --noEmit` | **0 أخطاء** (عدا أخطاء سابقة في ملف غير متتبَّع خارج النطاق: `_probe_public.ts`) |
| `deployEnvironment.test.ts` | **2/2** |
| `DeployChecksService.test.ts` | **7/7** |
| `DeployGitInfoService.test.ts` | **7/7** |
| `DeployGitHubService.test.ts` | **9/9** |
| `DeployChecksRunner.test.ts` | **7/7** |
| `deploy.test.ts` (خادم) | **15/15** |
| `deploy-bar.test.ts` + `sections/deploy.test.ts` | **12/12** |
| **الإجمالي** | **59/59 ناجح، 0 فاشل** |

> ملاحظة: لم يُشغَّل `next build` ولا الاختبارات داخل الطلب (NOT_RUN بالتصميم). لم يُشغَّل السويت الكامل
> هنا؛ اختبار `BookingCommissionStore.test.ts` المعروف فاشل ومُوثَّق أعلاه.

## C-1.4) القيود التي التزمنا بها
- لا `commit`/`push`/`fetch`/`checkout`/`deploy`؛ كل أوامر Git المستخدمة قراءة-فقط (`rev-parse`, `status`, `config --get`, `ls-remote` الاختياري).
- لا اتصال بمشروع الإنتاج `rwqan-757`؛ لا تعديل `.firebaserc`/`firestore.rules`/إعدادات النشر.
- لا أسرار في السجلات/المخرجات/الواجهة (رابط Git منقّى، ومحتوى الأسرار لا يُعاد).
- تعديلات جراحية؛ توافق خلفي للسجلات القديمة (الحقول الجديدة اختيارية).

---

# الملحق D) المرحلة D — استعادة فعلية معزولة (DEV فقط، بلا نشر)

> الهدف: تحويل «استعادة» من `restore_simulated` إلى **استعادة فعلية معزولة** لإصدار سابق
> محدد بـ Git SHA حقيقي، **داخل مجلد التطوير فقط**، بلا `commit`/`push`/`fetch`/`pull`/`deploy`
> وبلا لمس الإنتاج. النشر («publish») **يبقى محاكاة**.

## D.0) الخلاصة
- **استعادة حقيقية معزولة:** تُبنى شجرة الإصدار المطلوب بـ `git archive` (قراءة-فقط) وتُستخرج
  بـ `bsdtar` إلى `<devRoot>/.deploy-restore/<releaseId>/`، ثم **تُقلَّم ملفات الأسرار**، ثم
  **تُتحقَّق** بمطابقة بصمات المحتوى مع شجرة الالتزام.
- **لا لمس لشجرة العمل:** لا `checkout`/`reset`/`clean`؛ مصدر الإصدار يُقرأ من قاعدة كائنات Git.
- **فشل مغلق:** أي شرط غير مضمون ⇒ `blocked`/`failed` بلا ادعاء نجاح. لا استعادة على الإنتاج.
- **إصدار الـSHA الحالي المُتحقَّق:** `6c49647abdc14cd5176808fe79839e7ef3d7ebe9` (HEAD) —
  `status: "success"`, `verified: true`, `fileCount: 500`, `prunedSecrets: [".env"]`.

## D.1) الآلية (خطوة بخطوة)
1. **بوابة أولًا** (`store.evaluateRestore` / `restoreRelease`): ترفض عند SHA غير صالح/غير موجود،
   بيئة `LIVE`، مصدر غير موثوق (`source`)، شجرة عمل `dirty`، أو `release` ناقص. تُرجع السبب.
2. **`git archive --format=tar --output=<f.tar> <sha>`** من جذر المستودع (قراءة-فقط، بلا شبكة).
3. **استخراج** بـ `tar -xf <f.tar> -C <targetDir>` إلى داخل `<devRoot>/.deploy-restore/<releaseId>/`.
4. **تقليم الأسرار** بعد الاستخراج عبر `isSecretFileName` (يسمح `.env.example/sample/template`).
5. **تحقق بالمحتوى** (لا بالمسار): مقارنة متعددة-المجموعات لبصمات `git hash-object` للملفات
   المستخرجة مقابل بصمات `git ls-tree -r` للالتزام (مع تجاهل أسماء الأسرار). تطابق تام ⇒ `verified`.
6. **تنظيف** ملف الـtar المؤقت (المجلد الناتج يبقى للفحص البشري إلى أن يُنظَّف).

## D.2) قرارات تقنية (مع الأدلة)
- **لماذا مطابقة بالمحتوى لا بالمسار؟** أسماء ملفات عربية (`public/images/cities/*.jpeg`) فشلت
  مع `git hash-object --stdin-paths` على Windows (تشويش ترميز ⇒ *could not open*). تمرير المسارات
  كـ**وسائط argv** (بلا stdin) يفتحها بنجاح لأن Node يحوّل Unicode عبر واجهة Windows؛ ثم تُطابق
  البصمات **كمنظومة متعددة** فلا يهمّ ترميز المسار إطلاقًا. (كان: 9 ملفات عربية تفلت من المطابقة بالمسار.)
- **بدون `--no-filters`:** ثبت تجريبيًا أن `git hash-object --no-filters` يعطّل تطبيع نهايات الأسطر
  فيُنتج 481 عدم تطابق زائف، بينما السلوك الافتراضي يطابق شجرة الالتزام (0 عدم تطابق). لذلك نستخدم الافتراضي.
- **الجذر داخل مستودع:** الاستخراج تحت `<devRoot>/.deploy-restore/` (مُتجاوَز في `.gitignore`)،
  و`git hash-object` يعمل بـ`cwd` مجلد الاستخراج، و`git ls-tree` بـ`cwd` جذر المستودع.
- **حدود:** مهلة Git 15s، مهلة tar 60s، حد مخزن 32MB، تقطيع argv إلى دفعات 100 مسار.

## D.3) الملفات
**جديد**
| الملف | الوصف |
| --- | --- |
| `server/services/DeployRestoreService.ts` | خدمة الاستعادة المعزولة: بوابة، أرشفة، استخراج، تقليم، تحقق بالمحتوى، تنظيف. |
| `server/services/DeployRestoreService.test.ts` | 18 اختبارًا بتبعيات وهمية (SHA/بيئة/شجرة/تحقق/تكرار/فشل). |

**معدَّل**
| الملف | التعديل |
| --- | --- |
| `shared/deploySystem.ts` | إجراءات تدقيق `restore_preview`/`restore_real`؛ أنواع `DeployRestoreStatus`/`DeployRestorePreview`/`DeployRestoreVerification`/`DeployRestoreResult`؛ ثابت `DEPLOY_RESTORE_REAL_NOTICE`. |
| `server/routes/admin/deploy.ts` | مسار جديد `POST /api/admin/deploy/releases/:releaseId/restore/preview` (قراءة-فقط، تدقيق `restore_preview`)؛ إعادة كتابة `POST .../restore` (تأكيد 400، قفل 409 `RESTORE_IN_PROGRESS`، بوابة ⇒ 404/409، blocked 409 `RESTORE_BLOCKED`، failed 502 `RESTORE_FAILED`، نجاح 200 مع تدقيق `restore_real`). |
| `server/routes/admin/deploy.test.ts` | اختبارات جديدة (معاينة قراءة-فقط/404، نجاح مؤكَّد بتدقيق `restore_real`، blocked 409، failed 502، تزامن 409). **23/23**. |
| `src/components/deploy-bar.tsx` | تدفق: معاينة ⇒ `window.confirm` بالتفاصيل ⇒ استعادة فعلية؛ رسائل نجاح تتضمن `fileCount`/`verified`. |
| `src/components/admin/sections/deploy.tsx` | نفس التدفق («استعادة فعلية»). |
| `.gitignore` | تجاهل `.deploy-restore/` + إبقاء `.env*` مع استثناء `.env.example/sample/template` (مُتحقَّق بـ`git check-ignore`). |

## D.4) الاختبارات (نتائج فعلية)
| المجموعة | النتيجة |
| --- | --- |
| `npx tsc --noEmit` | **0 أخطاء** (عدا الملف غير المتتبَّع السابق `_probe_public.ts`) |
| `DeployRestoreService.test.ts` | **18/18** |
| حزمة اختبارات النشر الخلفية مجتمعة | **49/49** |
| `deploy-bar.test.ts` + `sections/deploy.test.ts` | **9/9** |

**تحقق حي فعلي (`_restore_verify.mts`، سكربت مؤقت حُذف بعد التشغيل):**
```
sha: 6c49647abdc14cd5176808fe79839e7ef3d7ebe9
status: success | verified: true | fileCount: 500 | checked: 500 | mismatches: 0
prunedSecrets: [".env"] | worktreeUnchanged: true | cleaned: true
```

## D.5) القيود التي التزمنا بها
- لا `commit`/`push`/`fetch`/`pull`/`merge`/`rebase`/`reset`/`checkout`؛ كل Git قراءة-فقط (`rev-parse`, `archive`, `ls-tree`, `hash-object`).
- لا نشر (Firebase App Hosting/Cloud Run)؛ «publish» ما زال محاكاة.
- لا لمس `C:\Users\zerof\Desktop\rwqan-sa` ولا `rwqan-757`؛ لا أسرار مطبوعة (`.env` قُلّم ولم يُقرأ محتواه).
- لا كتابة إلى Firestore/R2 الإنتاجي؛ الاستعادة تقع داخل مجلد DEV فقط ومُتجاوَزة في Git.
- تعديلات جراحية؛ توافق خلفي للسجلات القديمة؛ «الاستعادة المعزولة» **ليست** «نشرًا حقيقيًا للإنتاج».

## D.6) ما لم يُنفَّذ (بأمانة)
- **نشر حقيقي:** يبقى معطّلًا (محاكاة)؛ لا معيار إغلاق §9 متحقّق.
- **التحقق داخل الطلب:** `tsc`/tests/build تبقى `NOT_RUN`؛ التحقق الفعلي تمّ عبر السكربت الخارجي أعلاه.
- **المرحلة E:** **لم تبدأ** (بانتظار موافقة صريحة).

---

# الملحق E) المرحلة E — مسار النشر الحقيقي إلى DEV المعزول (مُنفَّذ، غير مُشغَّل)

> الهدف: تحويل «النشر» من محاكاة دائمة إلى **مسار حقيقي قابل للاختبار نحو هدف DEV المعزول فقط**
> (`rwqan-sa-dev`)، مع بقاء **المحاكاة الافتراضية**، وبوابة تمنع أي نشر إلى الإنتاج. يُشترط
> تحقق بعد النشر قبل اعتبار الإصدار `deployed`. **نتيجة المرحلة: `NOT_DEPLOYED`** (لم يقع نشر فعلي).

## E.0) الخلاصة
- **المحاكاة هي الافتراضي:** `createDeployExecutor` يختار `SimulationDeployExecutor` ما لم يُفعَّل العلم.
- **منفّذ DEV حقيقي:** `DeployRealExecutor` يبني ثم ينشر ثم يتحقق، ببوابات صارمة، ويرفض أي هدف إنتاجي/مجهول.
- **لا ادعاء نجاح:** `deployed:true` مشروط بنجاح `DeployHealthService` (مطابقة الإصدار المُشغَّل للـcommit).
- **أدوات النشر غير متوفرة الآن** (`firebase`/`gcloud`/`docker` غير مثبّتة) + لا backend DEV + لا endpoint إصدار
  ⇒ النشر الحقيقي **غير مُشغَّل**. لا يُعلن اكتمال المرحلة E بإعلان نجاح وهمي.

## E.1) الحواجز (فشل مغلق)
| الحاجز | السلوك |
| --- | --- |
| تفعيل | `NODE_ENV=development` **و** `DEPLOY_REAL_DEPLOY=enabled` فقط. |
| موافقة | `publish` بلا `approve:true` ⇒ `409 DEPLOY_BLOCKED` + تدقيق `publish_blocked`. |
| الهدف | ثابت من الخادم (`resolveDeployTarget`) لا من العميل؛ رفض الإنتاج/المجهول. |
| التحقق | لا `deployed` بلا نجاح ما بعد النشر (`/api/deploy-version`). |
| فشل مرحلة | `build`/`deploy`/`verify` فاشلة ⇒ `502 DEPLOY_EXECUTOR_FAILED` بالمرحلة، بلا سجل منشور. |

## E.2) الملفات
**جديد**
| الملف | الدور |
| --- | --- |
| `server/config/deployTarget.ts` | ثوابت هدف DEV + حواجز (`isProductionProjectId`/`isProductionHost`/`deployTargetBlockers`/`realDeployEnabled`). |
| `server/services/DeployRealExecutor.ts` | المنفّذ الحقيقي DEV-only + `createRealDeployDependencies`. |
| `server/services/DeployHealthService.ts` | `probeDeployHealth` + `DEPLOY_VERSION_PATH` (fetch قابل للحقن، رفض الإنتاج، مهلة، فشل مغلق). |
| `server/config/deployTarget.test.ts` | 7 اختبارات. |
| `server/services/DeployHealthService.test.ts` | 9 اختبارات. |
| `server/services/DeployRealExecutor.test.ts` | 9 اختبارات. |

**معدَّل**
| الملف | التعديل |
| --- | --- |
| `server/services/DeployExecutor.ts` | `DeployPublishOutcome` (`blocked`/`stage`/`target`/`releaseRef`/`verify`)، `DeployPublishStage`، `approval`/`requestedTarget`، اختيار الحقيقي عند التفعيل. |
| `server/routes/admin/deploy.ts` | تمرير الموافقة/الهدف؛ `409`/`502`؛ تسجيل `deployTarget`/`deployRef`/`postDeploy`؛ إزالة `gitCommit` المحلي. |
| `shared/deploySystem.ts` | `DeployPostDeployVerification`، حقول `DeployRelease` (`deployTarget`/`deployRef`/`postDeploy`)، `publish_blocked`، `deployTarget`/`realDeployEnabled` في `DeployState`. |
| `server/services/DeploySystemStore.ts` | `CreateReleaseInput` + الحقول الجديدة؛ `buildDeployState` يمرّر الهدف/التفعيل. |
| `src/components/deploy-bar.tsx` | نشر حقيقي vs محاكاة + تأكيد صريح + عرض الهدف/`deployRef`/التحقق. |
| `src/components/admin/sections/deploy.tsx` | نفس الشيء في لوحة الإدارة + عمود «منشور» غني. |
| `server/routes/admin/deploy.test.ts` | 5 اختبارات E جديدة (تمرير approval/target، 409 blocked، 502 stage، نجاح موثَّق، فشل تحقق) ⇒ **28/28**. |

## E.3) الاختبارات (نتائج فعلية)
| المجموعة | النتيجة |
| --- | --- |
| `npx tsc --noEmit` | **0 أخطاء** (عدا `_probe_public.ts` غير المتتبَّع) |
| `deployTarget.test.ts` | **7/7** |
| `DeployHealthService.test.ts` | **9/9** |
| `DeployRealExecutor.test.ts` | **9/9** |
| `server/routes/admin/deploy.test.ts` | **28/28** |
| حزمة اختبارات النشر الخلفية (config+services) | **76/76** |
| `deploy-bar.test.ts` + `sections/deploy.test.ts` | **9/9** |

> `npm run build`: تجميع Next.js **نجح**، لكن `tsc -p tsconfig.server.json` فشل على
> `server/routes/paymob-subscription-flow.test.ts` (TS1378، top-level await؛ `module:commonjs`) —
> **عائق سابق خارج النطاق**، لذلك لا يُكتب `dist`. كذلك `_probe_public.ts` (غير متتبَّع) يكسر خطوة TS في `next build`.
> كلاهما موثَّق ولم يُصلَح هنا.

## E.4) ما ينقص لتشغيل نشر DEV حقيقي
1. تثبيت/مصادقة Firebase CLI (+ `gcloud`/`docker` عند الحاجة).
2. App Hosting backend مستقل لـ`rwqan-sa-dev` (لا `rwqan-757`).
3. endpoint إصدار قراءة-فقط (`/api/deploy-version` يعيد `{commit, version}`).
4. ضبط `DEPLOY_DEV_BASE_URL` (مضيف DEV؛ يُرفض أي مضيف إنتاجي).
5. استثناء `*.test.ts` من `tsconfig.server.json` لإكمال `npm run build`.
6. اعتماديات DEV منفصلة تمامًا عن الإنتاج.

## E.5) القيود التي التزمنا بها
- لا `commit`/`push`/`fetch`/`pull`/`merge`/`rebase`/`reset`/`checkout`؛ لا نشر إلى Firebase/Cloud Run.
- لا لمس `C:\Users\zerof\Desktop\rwqan-sa` ولا `rwqan-757`؛ لا أسرار مطبوعة أو منقولة.
- لا كتابة إلى Firestore/R2 الإنتاجي؛ لا تغيير IAM/GitHub/Cloudflare.
- تعديلات جراحية؛ توافق خلفي للسجلات القديمة؛ **«مسار النشر إلى DEV» ≠ «نشر إنتاج حقيقي»**.

## E.6) ما لم يُنفَّذ (بأمانة)
- **لم يحدث أي نشر DEV حقيقي:** الأدوات غير مثبّتة، ولا backend DEV، ولا endpoint إصدار ⇒ **`NOT_DEPLOYED`**.
- **لم يُشغَّل `next build` كاملًا** حتى `dist` (عائق tsc السابق أعلاه).
- **المرحلة F / أي مرحلة تالية: لم تبدأ.**

---

## E.9) هوية الإصدار: تقييد احتياطي Git + هدف DEV صريح + آلية الحقن

> تعديلات محلية فقط (بلا سحابة/commit). الغاية: منع أي ادّعاء زائف عن «ما تم بناؤه/نشره».

### E.9.1) من أين تُقرأ هوية الـcommit في `/api/deploy-version`
- المصدر الموثوق الوحيد في الإنتاج هو متغير البيئة `RWQAN_DEPLOY_COMMIT` (نص SHA كامل 40 خانة سداسية) ⇒ `commitSource="env"`.
- **احتياطي `git rev-parse HEAD` مُقيَّد الآن بـ`NODE_ENV=development` فقط.** في أي بيئة أخرى (بخاصة وقت التشغيل المنشور، حيث `NODE_ENV=production`) يُرجَع `commit:null` و`commitSource:"unknown"` — **فشل مغلق**.
  - السبب: `HEAD` لا يُثبت مطابقة شجرة العمل؛ فقد تكون «متسخة» بما لا يعكس ما بُني فعلًا.

### E.9.2) فحص ما بعد النشر (fail-closed)
- يتطلب الآن: تشغيلًا reachable + HTTP 200 + `commit` **SHA كامل=40** يساوي المتوقع + **`commitSource:"env"`** + مطابقة الإصدار عند تمريره.
- أي قيمة قصيرة/غير سداسية، أو مصدر ليس `env` (مثل `git`)، أو إصدار مفقود/مختلف ⇒ `ok:false` مع سبب.

### E.9.3) هدف DEV صريح في المنفّذ الحقيقي
- أمر النشر: `firebase deploy --only apphosting:rwqan-dev-backend --config firebase.dev.json --project rwqan-sa-dev`.
  - `--config firebase.dev.json` إلزامي وإلا قرأ الـCLI ملف `firebase.json` الإنتاجي.
  - `--only apphosting:<backendId>` يحدد الخدمة؛ تحذير: عند غياب الـbackendId من الملف قد ينجح الأمر بلا نشر فعلي (firebase-tools #10161) ⇒ لا يُعتبر نجاح الأمر إثباتًا.
- يُرفض النشر قبل أي أمر عند: SHA غير كامل، أو شجرة عمل `dirty`/`unknown` (fail-closed).

### E.9.4) الملفات المُضافة (DEV فقط)
- `firebase.dev.json`: مصفوفة `apphosting` بمدخلة واحدة `rwqan-dev-backend` (`rootDir: "."`).
- `apphosting.dev.yaml`: تجاوزات DEV؛ يُستعمل فقط عندما يكون **Environment name** للـbackend (من Console) = `dev`.

### E.9.5) حقن `RWQAN_DEPLOY_COMMIT` — وضعه الحالي بأمانة
- **لا يوجد حقن تلقائي موثوق بعد.** App Hosting يبني على البعيد؛ لا تُوجد آلية CLI معروفة تُمرّر الـSHA تلقائيًا إلى بيئة بناء/تشغيل الـrollout.
- لذلك في `apphosting.dev.yaml` يكون `RWQAN_DEPLOY_COMMIT` **معطَّلًا افتراضيًا**؛ النتيجة: تطبيق DEV يعيد `unknown`، وفحص الصحة يفشل مغلقًا (لا نجاح زائف).
- لتمكين التحقق: عيّن قيمته إلى SHA الكامل المُنشَر **يدويًا في كل rollout** (وتأكّد من تحديثه كي لا يقدم قيمة قديمة). وصول دخول تلقائي موثوق = بند مفتوح للمرحلة التالية.
- **تحديث لاحق (E.10):** لم يعد مسار الإغلاق يعتمد على هذا الحقن إطلاقًا؛ إثبات هوية الإصدار يأتي من `Build.source.codebase.hash` عبر حركة المرور الفعلية (`traffic.current`). أُبقي هذا المتغيّر مُعطَّلًا.

### E.9.6) ما لم يتغيّر
- **لم يُنفَّذ أي نشر/rollback أو `firebase login`**؛ لم تُلمس `rwqan-757`/`rwqan.sa`؛ لا commit/push؛ لا أسرار/APIs/IAM.

---

# E-إغلاق) مراجعة إغلاق المرحلة E (قراءة/تحقق فقط، بلا نشر)

> مراجعة إغلاق لاحقة. **لم يُنفَّذ أي نشر أو rollback**، ولم تُلمس `rwqan-757`/`rwqan.sa`، ولا commit/push.

## E.7) إصلاح ضمن النطاق: عائق TS1378 في `tsconfig.server.json`
- **السبب الجذري:** `tsconfig.server.json` (إعداد الإخراج) يشمل `server/**/*` فيُصرّف **ملفات `*.test.ts`** بـ`module: commonjs`، والاختبار `server/routes/paymob-subscription-flow.test.ts` يستخدم top-level `await` ⇒ `TS1378`.
- **هل هو مرتبط بتغييرات E؟** **لا.** الاختبار يخص تدفق دفع Paymob ولا علاقة له بالنشر؛ المشكلة إعداد-بناء قائمة مستقلة.
- **الإصلاح (ضمن نطاق E، بند E.4#5، دون لمس الاختبار):** أُضيف إلى `exclude` في `tsconfig.server.json`:
  `server/**/*.test.ts` و`shared/**/*.test.ts`. (كان `dist` يحتوي 120 ملف `.test.js` ⇒ كان الاختبار يُبنى إلى `dist` بغير حق.)
- **الأثر:** `npx tsc -p tsconfig.server.json --noEmit` ⇒ **0 أخطاء** (كان 1 خطأ TS1378).
- **ملاحظة:** بقيت الاختبارات مُفحوصة نوعيًا عبر الإعداد الأساسي `npx tsc --noEmit`.

## E.7.1) نتائج المراجعة (فعلية)
| الفحص | النتيجة |
| --- | --- |
| `node --import tsx --test --test-concurrency=1` لـ12 ملف E | **113/113 ناجح، 0 فاشل** |
| `npx tsc -p tsconfig.server.json --noEmit` | **0 أخطاء** (بعد الإصلاح) |
| `npx tsc --noEmit` (الأساسي) | خطآن فقط في ملف خارج النطاق غير متتبَّع `_probe_public.ts` |
| `npm run build` | **يفشل** عند `next build` بسبب نفس `_probe_public.ts` (غير E)، فلا يصل لخطوة `tsc`/`dist` |
| `firebase`/`gcloud`/`docker` | **غير مثبّتة** |
| نقطة `GET /api/deploy-version` | **موجودة الآن** (`server/routes/deploy-version.ts`) — تُرجع `404` ما لم يكن المشروع `rwqan-sa-dev`؛ تقرأ `RWQAN_DEPLOY_COMMIT` أو Git fallback محلي في `development` فقط. **لا تُستعمل كإثبات هوية** (انظر E.10.1). |
| backend DEV مستقل (`rwqan-dev-backend`) | **غير مُعرَّف** (لا إعداد له) |
| `.github/**` (CI/CD) | **غير موجود** ⇒ لا نشر آلي |

## E.8) الخلاصة
**المرحلة E غير مكتملة كإغلاق** (رغم اكتمال الكود والاختبارات): معيار القبول (نشر DEV حقيقي ناجح + فحوص صحة PASS)
**غير مُتحقّق** لأن مسار النشر الحقيقي غير قابل للتنفيذ في هذه البيئة (لا backend DEV، لا أدوات CLI، لا تفعيل، شجرة عمل غير نظيفة).
> **تحديث (E.11):** نقطة `GET /api/deploy-version` **أصبحت موجودة** (`server/routes/deploy-version.ts`) بعد هذه المراجعة، فلم يعد سبب التعذّر «غياب نقطة التحقق» بل غياب نشر DEV حقيقي مُتحقَّق منه من لوحة تحكم App Hosting.

---

# E.10) إثبات هوية الإصدار الموثوق عبر App Hosting (تحقيق + آلية + حدود)

> تعديلات محلية فقط. **لا موارد سحابية، لا login/deploy/rollback، لا IAM/أسرار، لا commit/push.**

## E.10.1) ما الذي يوفّره App Hosting فعليًا (نتيجة تحقيق)
- متغيّرات النظام التي يوفّرها Firebase للتطبيق: `FIREBASE_CONFIG` (BUILD+RUNTIME) و`FIREBASE_WEBAPP_CONFIG` (BUILD فقط). **لا يوجد أي متغيّر يحمل commit/معرّف البناء**، وأسماء المتغيّرات لا يجوز أن تبدأ بـ`X_FIREBASE_`.
- **الخلاصة:** لا يمكن للتطبيق أن يُبلّغ بأمانة عن الـcommit الذي بُني منه عبر بيئة وقت البناء/التشغيل ⇒ `GET /api/deploy-version` (القيمة المحقونة) **ليس دليلًا بحد ذاته**.
- المصدر الموثوق الوحيد لربط commit البناء بالنشر هو **لوحة تحكم App Hosting**: مورد `Build` يحمل `source.codebase.hash` (SHA-1 كامل) الذي سجّلته Google وقت البناء.
- **قيد حاسم:** هذا الحقل يوجد **فقط** عندما يكون مصدر البناء `codebase` أي backend **مرتبط بمستودع GitHub (Developer Connect)** وrollout أُنشئ عبر `apphosting:rollouts:create --git-commit <full-sha>`.
  أما `firebase deploy` من المصدر المحلي فيرفع **archive** بلا commit (`source.archive`)، وعندها **لا يمكن التحقق أبدًا** (fail-closed).

## E.10.2) الآلية المُطبَّقة (قراءة-فقط من لوحة التحكم)
- أُضيف `server/services/DeployBuildSourceService.ts`:
  - `verifyAppHostingBuildSource(...)`: يوازن الـcommit المتوقع مع `source.codebase.hash` للـbuild الذي **يخدم حركة المرور فعليًا**؛ fail-closed عند: مرجع متوقع غير صالح، خطأ قراءة، **حالة مرور ليست `ready`**، مصدر ليس `codebase`، SHA غير كامل، أو عدم تطابق.
  - `createAppHostingBuildSourceClient(...)`: عميل قراءة-فقط فوق `googleapis` (`firebaseapphosting_v1beta`) يقرأ **`traffic.get`** أولًا:
    - `reconciling=true` ⇒ `reconciling` (فشل مغلق).
    - لا يوجد split بنسبة 100% ⇒ `no-traffic`.
    - أكثر من split بنسبة 100% ⇒ `ambiguous`.
    - خلاف ذلك: `builds.get` للـbuild الفعلي ⇒ `source.codebase.hash` وحالة `ready`.
    - **لا يُفترض أبدًا "أحدث rollout ناجح"**؛ الإصدار النشط يُحدَّد من `traffic.current`. **googleapis يُستورد lazily**.
  - التفعيل fail-closed: لا يعمل إلا مع `DEPLOY_BUILD_SOURCE_VERIFY=enabled` **و** `DEPLOY_APP_HOSTING_LOCATION` (مثل `us-central1`).
- الربط في `DeployRealExecutor` (تدفق النشر الحقيقي أصبح متحكَّمًا به):
  1. بوابة المصدر (SHA كامل + شجرة نظيفة).
  2. **منطقة App Hosting إلزامية** (`DEPLOY_APP_HOSTING_LOCATION`) و**وجود `verifyBuildSource` إلزامي** — وإلا يُرفض.
  3. إنشاء rollout للـcommit المحدد: `firebase apphosting:rollouts:create <backend> --git-commit <sha> --location <region> --project <proj> --config firebase.dev.json` (لا `firebase deploy` محلي: يرفع archive بلا commit).
   - **إثبات المصدر إلزامي** من لوحة التحكم (خدمة `DeployBuildSourceService`)؛ إن لم ينجح ⇒ `deployed:false` (stage=`verify`) مع تسجيل `buildSource`.
   - **فحص الحياة أخيرًا فقط** (`requireCommitProof:false`): HTTP 200 يكفي للاتاحة؛ لا يُدّعى أي مطابقة commit من التطبيق. HTTP 200 وحده لا يُعتبر إثباتًا.
- **موضع `/api/deploy-version`:** لم يعد يُستعمل كإثبات هوية (فقط اتاحة). بطاقة الهوية الموثوقة هي `buildSource` من لوحة التحكم.

## E.10.3) الحدود (بأمانة — لا ضمان مُختلق)
- `traffic.current` هو مرجع "المُخدِّم النشط"، لكن لا polling هنا: إذا كان الـrollout الجديد ما زال يزامن (`reconciling`) أو وزّع جزئيًا يحسب الفحص فاشلًا (وهذا مقصود).
- **كل مسار لوحة التحكم غير مُختبَر حيًّا هنا** (لا backend مرتبط بـGitHub، لا صلاحيات، لا شبكة). اختباراته الوحيدة عبر عميل وهمي (`*_test.ts`).

## E.10.4) الخطوة التالية لإغلاق E (سحابية — تتطلب موافقة المالك)
1. إنشاء backend DEV `rwqan-dev-backend` في `rwqan-sa-dev` **مرتبطًا بمستودع GitHub** (Developer Connect) مع Environment name = `dev` (لتفعيل `apphosting.dev.yaml`)، **وتعطيل سياسة النشر التلقائي** (`traffic.rolloutPolicy.disabled=true`) كي لا يُنشئ push تلقائيًا أي rollout.
2. النشر المتحكَّم به عبر `firebase apphosting:rollouts:create rwqan-dev-backend --git-commit <full-sha> --location <region> --project rwqan-sa-dev` (لا `firebase deploy` محلي لنشر DEV الموثوق).
3. منح حساب الخدمة الخادمي صلاحية قراءة فقط **`roles/firebaseapphosting.viewer`** (يشمل `traffic.get` و`builds.get` و`rollouts.get`)، وتشغيل الخادم بـ`DEPLOY_BUILD_SOURCE_VERIFY=enabled` و`DEPLOY_APP_HOSTING_LOCATION=<region>`. **فصل الصلاحيات:** إنشاء الـrollout بصلاحية منفصلة (`firebaseapphosting.developer`) لا يملكها الخادم.
4. التحقق: نجاح `DEPLOY_DEV_BASE_URL` + وصول HTTP 200 + `buildSource.ok=true` (المصدر `codebase` والـhash يساوي الـcommit) قبل اعتبار E مكتملة.

---

# E.11) جاهزية إغلاق E — تحقق محلي فقط (بلا نشر/سحابة/commit)

> مراجعة تجهيز. **لم يُنفَّذ أي نشر أو إجراء سحابي أو IAM/أسرار أو commit/push**، ولم تُلمس `rwqan-757`/`rwqan.sa`.

## E.11.1) ما اكتمل (محليًا) وما بقي
- **مكتمل (كود/اختبارات/توثيق):** بوابات الهدف/الموافقة/التفعيل، بوابة المصدر (SHA كامل + شجرة نظيفة)، إثبات المصدر من لوحة التحكم (`DeployBuildSourceService`)، فحص الحياة كإتاحة فقط، ونقطة `/api/deploy-version`. الاختبارات المُحدَّثة تمر بالكامل (E.11.4).
- **متبقٍ (سحابي/بيئة):** لا backend DEV مستقل، لا ربط GitHub/Developer Connect، لا CLI (`firebase`/`gcloud`/`docker`)، لا تفعيل، شجرة عمل غير نظيفة، IAM غير مهيّأ. لذلك **E = `NOT_DEPLOYED`**.

## E.11.2) عائق «شجرة العمل غير النظيفة» وكيفية التحقق/البناء بأمان
- **المصدر (كود):** `readDeployGitInfo` يقرأ `git status --porcelain` للقراءة فقط ويرفع الحالة `dirty` عند وجود أي تغيير (`server/services/DeployGitInfoService.ts`)، ثم يرفضها `DeployRealExecutor` في **بوابة المصدر** (`server/services/DeployRealExecutor.ts:183-192`، `stage="source"`).
- **السبب:** نشر App Hosting يُبنى من الـcommit على المستودع المرتبط بـGitHub، لا من الشجرة المحلية؛ فإن كانت هناك تغييرات غير مُثبَّتة فإن الـSHA المُنشَر **لا يمثّل** الكود المختبَر. البوابة تمنع «نشر شيء ≠ ما تم اختباره».
- **طريقة التحقق/البناء الآمنة (دون فقد تغييرات ولا commit/push):**
  1. **تحقق داخل المكان (آمن):** `npx tsc -p tsconfig.server.json --noEmit` و`npx tsc --noEmit` والاختبارات — كلها قراءة-فقط ولا تعدّل ملفات متتبَّعة.
   - **بناء معزول:** النسخ/البناء في نسخة خارج المستودع (نفس آلية أرشيف الاستعادة المُتحقَّقة) بحيث لا يُلمس المستودع الحالي، مع استثناء الأسرار و`_probe_public.ts`.
  - **لا يُستعمل** `git stash`/`checkout`/commit لأنها تُعدّل المراجع/الشجرة. أي نشر فعلي يتطلب مسبقًا وجود الـcommit على الفرع المتصل (خارج نطاق هذه القيود).
- **حالة الشجرة الآن:** `HEAD=6c49647` = `origin/main`؛ معدَّلة (متتبَّعة) + 183 غير متتبَّع؛ الفهرس = `D .env` فقط.

## E.11.3) المنطقة وربط GitHub/Developer Connect — من أدلة محلية فقط (بلا تخمين)
- **remote origin (مؤكَّد محليًا):** `https://github.com/iheeb1/rwqan-sa.git` (لا `.github/**` محليًا).
- **منطقة DEV:** لا يوجد backend بعد، و**منطقة App Hosting الخاصة بالـbackend غير مثبتة محليًا**. أقرب دليل: مستندات DEV تذكر منطقة **مشروع Firebase** DEV = `me-central2` (وليست بالضرورة منطقة الـbackend). يجب قراءة منطقة الـbackend فعليًا من `firebase apphosting:backends:get`/`backends:list` بعد إنشائه وتصديرها في `DEPLOY_APP_HOSTING_LOCATION` — **لا تُخمَّن**.
- **ربط GitHub:** الآلية المطلوبة (Developer Connect) موثَّقة في E.10.1؛ **لا يوجد أي أثر محلي** يثبت وجود اتصال قائم أو اسم اتصال/مستودع مربوط ⇒ UNKNOWN ويتطلب تأكيدًا من الكونسول/CLI.

## E.11.4) نتائج الفحص الفعلي (هذه المراجعة)
| الفحص | النتيجة |
| --- | --- |
| اختبارات E (16 ملفًا: config/services/routes/UI) | **156/156 ناجح، 0 فاشل** |
| `npx tsc -p tsconfig.server.json --noEmit` | **0 أخطاء** |
| `npx tsc --noEmit` | خطآن فقط في `_probe_public.ts` غير المتتبَّع وخارج النطاق |
| `npm run build` | تجميع Next.js **نجح** ثم فشل في خطوة TypeScript على `_probe_public.ts` (غير E) ⇒ لا `dist` |
| `firebase`/`gcloud`/`docker`/`gh` | **غير مثبّتة**؛ `git` متوفّر |

## E.11.5) `apphosting.dev.yaml` — ما يلزم قبل أول rollout (بلا قيم مخمَّنة)
- يُختار عبر **Environment name = `dev`** في إعداد الـbackend (لا من `firebase.json`).
- `NEXT_PUBLIC_BASE_URL` = **نائب** `https://REPLACE-WITH-DEV-BACKEND-HOST` ⇒ يجب استبداله بمضيف الـbackend الفعلي (قيمة تُؤخذ من App Hosting، لا تُخمَّن).
- `NODE_ENV=production` مقصود (وقت تشغيل App Hosting إنتاجي؛ فيبقى Git fallback معطَّلًا).
- **لا يُحقن commit هنا** (E.10.1): إثبات الهوية يأتي من `Build.source.codebase.hash` عبر `traffic.current` فقط.
