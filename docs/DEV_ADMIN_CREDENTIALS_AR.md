# بيانات دخول الأدمن في بيئة التطوير (DEV) — مرجع مختصر

> يوضّح هذا الملف أين يُخزَّن حساب الأدمن في DEV، وكيف يُغيَّر مستقبلًا، ولماذا
> لا يتأثر الإنتاج إطلاقًا. المرجع الأوسع: `docs/DEV_E2E_REPORT.md`.

## 1) بيانات دخول DEV الحالية

- **الكود (username):** `admin`
- **كلمة المرور:** `123`

## 2) أين يُخزَّن حساب الأدمن في DEV

- **لا يوجد سجل مستخدم إداري** (لا Firestore ولا جدول). المصادقة **مبنية على
  متغيّرات البيئة** عبر `server/services/AuthService.ts`
  (`validateAdminCredentials`).
- القيم في ملف **`.env.development.local`** (غير متتبَّع في Git — مطابق لـ`.gitignore`
  عبر `.env*.local`):
  ```
  DEV_ONLY_ADMIN_CREDENTIALS=true
  ADMIN_CODE=admin
  ADMIN_PASSWORD=123
  ```
- يُحمَّل هذا الملف **فقط عندما `NODE_ENV !== "production"`** (راجع
  `server/config/loadEnv.ts`). الإنتاج يقرأ قيمه من بيئة النشر الفعلية، ولا يُحمَّل
  ملف DEV مطلقًا.

## 3) كيف يبقى العزل فعّالًا مع قيم بسيطة (`admin` / `123`)

القيم `admin` و`123` لا تحمل بادئة `DEV_ONLY_` ظاهرة، لذا تُوسَم بأنها **DEV فقط**
عبر المتغيّر الصريح:

```
DEV_ONLY_ADMIN_CREDENTIALS=true
```

فيقرأه الحارس `assertDevOnlyAdminCredentialsIsolation`
(`server/config/runtimeEnvironment.ts:216`، موصول في `server/index.ts:40`) ويرفض
إقلاع الخادم **إلا إذا**:
1. `NODE_ENV=development`، **و**
2. مشروع Firebase هو **`rwqan-sa-dev`** بالضبط.

- **لم يُحذف أي فحص قديم:** بادئة `DEV_ONLY_` على `ADMIN_CODE`/`ADMIN_PASSWORD`
  ما زالت تُشغّل نفس الحارس (توافق خلفي كامل).
- **لم تُوَسَّع الصلاحية:** القيم غير الموسومة وغير المبدوءة بـ`DEV_ONLY_` تُعامل كما
  كانت تمامًا (اعتمادات إنتاج عادية لا يتأثر بها الحارس).

> ملاحظة: لا توجد سياسة طول على كلمة مرور الأدمن في `validateAdminCredentials`؛
> السياسة الفعلية الوحيدة هي وسْم DEV المذكور أعلاه.

## 4) كيفية التغيير مستقبلًا (دون التأثير على الإنتاج)

1. عدّل السطرين في `.env.development.local`:
   ```
   ADMIN_CODE=<new_username>
   ADMIN_PASSWORD=<new_password>
   ```
2. **أبقِ `DEV_ONLY_ADMIN_CREDENTIALS=true`** ليبقى العزل فعّالًا. (أو استخدم بادئة
   `DEV_ONLY_` على قيمة أحدهما كبديل — كلاهما يفجّر الحارس.)
3. **لا تعدّل** `.env` الإنتاجي ولا أي سر إنتاجي ولا `.firebaserc`.
4. أعد تشغيل خادم DEV فقط: `npm run dev` (النافذة الحالية تعمل على `:5001`).
5. لا حاجة لأي commit: الملف مُتجاهَل في Git.

## 5) التحقق المنفَّذ (نتائج فعلية)

اختبار حي على خادم DEV (`http://127.0.0.1:5001`, `NODE_ENV=development`):

| الحالة | المدخل | النتيجة |
| --- | --- | --- |
| صحيح | `admin` / `123` | **200** + جلسة إدارية (`GET /api/admin/deploy/state` = 200, `env=TEST`) |
| كلمة مرور خاطئة | `admin` / `nope` | **401** |
| كود خاطئ | `nope` / `123` | **401** |
| القيم القديمة | `DEV_ONLY_admin` / `DEV_ONLY_admin` | **401** |

عزل DEV (probe مباشر على `assertDevOnlyAdminCredentialsIsolation`, القيم `admin`/`123`
+ `DEV_ONLY_ADMIN_CREDENTIALS=true`):

| البيئة | النتيجة |
| --- | --- |
| `NODE_ENV=development` + مشروع `rwqan-sa-dev` | مسموح |
| `NODE_ENV=production` | **محظور** |
| `NODE_ENV=development` + مشروع `rwqan-757` | **محظور** |
| `NODE_ENV=production` + بادئة `DEV_ONLY_` القديمة | **محظور** |
| `NODE_ENV=production` + قيم عادية بلا وسْم (تحقق عدم الكسر) | مسموح |

كما نجحت اختبارات الوحدة: `server/config/runtimeEnvironment.test.ts` (43/43)،
و`npx tsc --noEmit` = 0 أخطاء.

## 6) حدود التغيير

- **معدَّل:** `.env.development.local` (غير متتبَّع)،
  `server/config/runtimeEnvironment.ts` (إضافة وسْم DEV صريح مع الحفاظ على فحص
  البادئة)، `server/config/runtimeEnvironment.test.ts` (اختبارات الوسْم)،
  وdocs (`DEV_E2E_REPORT.md`/`SESSION_HANDOFF.md`/`DEPLOY_SYSTEM_PLAN_AR.md`/هذا الملف).
- **غير معدَّل:** كود المصادقة (`AuthService`)، أي ملف إنتاجي، `.firebaserc`،
  أسرار الإنتاج.
- **لا commits ولا push ولا deploy.**
