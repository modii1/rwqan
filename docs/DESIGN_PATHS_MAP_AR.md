# 🗺️ خريطة مسارات التصميم — Ruqan / Rwqan (Design Paths Map)

> **الحالة:** مسودة معتمدة / نشطة
> **تاريخ آخر تحديث:** 2026-11-21
> **المرجع الحالي:** فرع `test/unified-gateway-ui-only` @ `bdea374c74c996a00b40644adcd6c55a3d80961f` — **المسار NEW**

---

## أولًا: المساران

| المسار | المعنى | الفرع | البيئة | الوصف |
|---|---|---|---|---|
| **OLD / LIVE-HOTFIX** | التصميم القديم → إصلاح → اختبار → نشر إلى LIVE | مرجع التصميم القديم (قيد التحقق) | LOCAL (DEV) → TEST → LIVE | تعديل محدود على التصميم القديم فقط |
| **NEW / REDESIGN-2027** | تطوير/تحسين التصميم الجديد → اختبار في TEST | `test/unified-gateway-ui-only` | LOCAL (DEV) → TEST (بلا LIVE) | الاستمرار حتى قرار الإطلاق 2027 |

---

## ثانيًا: تعريف الملفات حسب المسار

### OLD — التصميم القديم / مسار الإصلاح السريع إلى LIVE
- `src/app/page-original.tsx`
- `src/app/page.tsx.backup`
- `src/app/page.tsx.old`
- `src/app/properties/page.tsx.old`
- `src/components/owner/owner-dashboard-old.tsx`

> **ملاحظة مؤكدة:** هذه الملفات تعتبر **مراجع محفوظة فقط**، ولا تعتبر نسخة OLD تشغيلية مؤكدة قبل التحقق.

### NEW — التصميم الجديد / redesign 2027
- `src/app/page.tsx` + `src/components/home-client.tsx`
- `src/components/subscription-page.tsx`
- `src/app/subscription/page.tsx`
- `src/app/owner/subscription/page.tsx`
- `src/components/owner/owner-page.tsx`
- `src/components/owner/owner-payment-summary.tsx`
- `src/components/summary-strike-price.tsx`
- `src/components/price-display.tsx`
- `shared/platformFonts.ts`
- `src/components/admin/admin-font-scope.tsx`
- `src/app/admin/layout.tsx`
- `src/components/package-icon.tsx`
- `src/components/feature-icon.tsx`
- `src/components/owner/owner-ui.tsx`
- `src/components/owner/owner-verification-gate.tsx`
- `shared/packageAudience.ts`, `shared/packageFeatures.ts`, `shared/packageIcons.ts`

### مشتركة (ينبغي تحديدها عند الازدواجية)
- `src/components/ui/*`
- `src/components/header.tsx`, `footer.tsx`, `filter-modal.tsx`, `properties-client.tsx`, `property-details-client.tsx`

---

## ثالثًا: الفروع والبيئات

- **LOCAL:** `localhost:5001` — DEV — `rwqan-sa-dev`
- **TEST:** `test/unified-gateway-ui-only` → workflow `deploy-test.yml` → backend `rwqan-backend`، مشروع `rwqan-757`، data `rwqan-sa-dev`, URL: `https://rwqan-backend--rwqan-757.europe-west4.hosted.app`
- **LIVE:** `main` → workflow `deploy-live.yml` → backend `rwqan`, مشروع `rwqan-757`, domain: `https://rwqan.sa`, gate: `DEPLOY_REAL_DEPLOY`

---

## رابعًا: اختبار ونشر

- **OLD:** تحديد baseline OLD الصحيح (بعد التأكيد الفعلي من LIVE) → تعديل إصلاح على OLD → `tsc` + اختبارات مرتبطة → publish **TEST** (approved) → publish **LIVE** (موافقة صريحة).
- **NEW:** تعديل على NEW الحالي → `tsc` + اختبارات مرتبة → publish **TEST** → لا publish LIVE قبل قرار 2027.

---

## خامسًا: النقاط غير المؤكدة (Unconfirmed)

1. **مرجع التصميم القديم النهائي:** `6c49647abdc14cd5176808fe79839e7ef3d7ebe9` لم يُتحقق بعد أنه مطابق فعلياً لتصميم LIVE. **لا يُعتمد كمرجع نهائي OLD قبل التحقق الفعلي.**
2. **نسخة OLD التشغيلية:** ملفات `page-original*` و `old*`/`backup` ليست مؤكدة كنسخة OLD تشغيلية قبل التحقق.
3. **هوية إصدار LIVE:** غير مثبتة (versionId/publishedSha = null حسب الوثائق).
4. **علاقة design commits بـ origin/main:** غير مؤكدة كلياً.

---

## سادسًا: الموافقات والممنوعات المعتمدة

1. لا اعتماد `6c49647` كمرجع نهائي OLD قبل التأكد الفعلي من مطابقة تصميم LIVE.
2. ملفات OLD/backup = مراجع فقط.
3. الحفاظ على تعديلات NEW الحالية في `test/unified-gateway-ui-only`.
4. استقلال OLD التام على نسخة LIVE الصحيحة بعد التأكيد.
5. لا نقل إصلاح OLD → NEW أو العكس إلا عند الحاجة ومراجعة.
6. اعتماد نظام العمل السريع.
7. السطر السابق قبل التنفيذ.
8. بدء مباشر عند وضوح المسار.
9. لا commit/push/deploy قبل الموافقة الصريحة.

---

## سابعًا: تعليمات العمل اليومي (مفعّلة)

- عدم الفحص الشامل المتكرر.
- الفحص: الملفات المتعلقة بالمشكلة فقط.
- الاختبارات: المرتبطة بالتغيير فقط.
- قبل التنفيذ: السطر الوحيد:
  `المسار: OLD أو NEW | الملفات المستهدفة: ...`
- الإيقاف والسؤال فقط في الحالات المحددة.

---

## ثامنًا: قواعد الحماية (معتمدة)

- لا تفقد تعديلات Working Tree الحالية.
- لا تخلط إصلاحات OLD مع تطوير NEW.
- لا تنفذ Commit أو Push أو Deploy دون موافقتي.
- LIVE لا يتغير إلا بموافقتي الصريحة.
- لا تعِد بناء أو استبدال صفحات كاملة من أجل إصلاح محدود.

---

تم إنشاء الملف: `docs/DESIGN_PATHS_MAP_AR.md` ✅
بدون أي تغيير على كود أو فروع أو إعدادات بيئات ✅

---

## ✅ تأكيد مختصر

تم إنشاء `docs/DESIGN_PATHS_MAP_AR.md` بالنص المعتمد، مع توثيق النقاط غير المؤكدة، وبدون تنفيذ أي تعديل على الكود/الفروع/البيئات.

لم أبدأ تجهيز مسار OLD أو نقل أي ملفات — كالموعد المطلوب.

**التالي (عندك):** إنشاء الخريطة تم · موافقة اعتمادتها صدرت · الآن أنت في النظام الجديد التشغيلي.
