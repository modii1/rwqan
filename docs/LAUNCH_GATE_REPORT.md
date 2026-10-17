# تقرير بوابة الإطلاق — Ruqan / Rwqan

الإصدار: 2026-10-14 · النطاق: نسخة التطوير (DEVELOPMENT clone: `rwqan-sa-opencode`)
معرّف الفحص: `scan-2026-10-14T0905` · الوضع: `--ci --no-network true`
هذا التقرير **ملخص تنفيذي**. التفاصيل التقنية الكاملة في [`SECURITY_STATUS.md`](./SECURITY_STATUS.md).

> تنبيه: هذا ليس تثبيتًا أمنيًا للإنتاج (NOT a production attestation). كل الأدلة من فحص
> للقراءة فقط على نسخة التطوير، دون أي تعديل على الإنتاج أو الأسرار أو قواعد البيانات.

---

## 1. القرار النهائي

> ## القرار: **NO-GO** (للإطلاق في الإنتاج)

**التبرير المختصر:**
- تبقى **مخاطر حرجة/عالية غير محسومة** تتطلب قرارات إنتاجية: تسريب أسرار الإنتاج في تاريخ Git
  (SEC-001)، تخزين بيانات اعتماد المالكين/OTP تكستية (AUTH-001)، وإيصالات دفع عامة بمفاتيح
  قابلة للتخمين (R2-001).
- لا يجوز إصدار `GO` ما دامت هناك قرارات إنتاجية معلّقة أو مخاطر حرجة قائمة (كما يقتضي النطاق).

**ملاحظة مهمة:** اجتياز الاختبارات (1026/1026) و«نظافة TypeScript» **لا يعنيان** الجاهزية للإنتاج.
يُقيَّم الإطلاق بمعايير أمنية وتشغيلية منفصلة أدناه.

يمكن إعادة تقييم القرار إلى **CONDITIONAL GO** فقط بعد إغلاق مانعات القسم 4 (وبالأخص SEC-001
و AUTH-001 و R2-001)، وليس قبلها.

---

## 2. حالة الأدلة (متحقَّق منها في المستودع)

| البند | النتيجة | الدليل |
|---|---|---|
| فحص الأنواع TypeScript | **نظيف (0 أخطاء)** | `node ./node_modules/typescript/bin/tsc --noEmit` → بلا مخرجات |
| مجموعة الاختبارات الكاملة | **1026/1026 نجاح** (34 suite، 0 فشل) | `full-suite6.log` (exit 0) |
| ملاحظة عابرة (IPC) | تشغيل واحد أظهر `Error: Unable to deserialize cloned data ...` في Node test runner على `tracking.test.ts`؛ **أُعيد التشغيل فنجح 1026/1026** — عطل عابر في IPC الخاص بمشغّل الاختبار، ليس فشل اختبار فعلي | `full-suite5.log` مقابل `full-suite6.log` |
| ماسح الأمان | **26 نتيجة مفتوحة** · OVERALL ORANGE · قسم Secrets أصبح **GREEN** | `scan-2026-10-14T0905` (`secscan4.log`) |
| أدوات خارجية | gitleaks / semgrep / codeql / osv / trivy / ZAP → **NOT INSTALLED** (قيد بيئة التطوير) | قسم TOOLS في مخرجات الماسح |
| إغلاقات هذه الجلسة | **13 نتيجة أُغلقت** (39 ← 26) | قسم 6 أدناه |

---

## 3. الفصل بين «اجتياز الاختبارات» و«الجاهزية للإنتاج»

- **جاهزية التطوير المحلي (LOCAL DEV): GREEN** — TypeScript نظيف، 1026/1026، بوابات العزل في
  التطوير تعمل، الماسح بلا نتائج حرجة/عالية *جديدة* مُدخلة في هذه الجلسة.
- **جاهزية الإطلاق للإنتاج (PRODUCTION RELEASE): NO-GO** — مانعات في القسم 4 لم تُحسم.
- اجتياز المجموعة لا يبرهن سلامة التصميم الأمني (مثال: أسرار التاريخ في Git لا ترى بالاختبارات؛
  حدّ الخصم غير المُنفَّذ لا تُمسكه الاختبارات الحالية).

---

## 4. المانعات (Blockers) — تتطلب قرارًا/عملًا إنتاجيًا

| المعرّف | الخطورة | الدليل (ملف:سطر) | القرار/العمل المطلوب | المالك | دليل الإغلاق |
|---|---|---|---|---|---|
| **SEC-001** | CRITICAL | `.env` في تاريخ Git (commit `ff2b332`, `3672a4e`, `5ada849`)؛ خارج الفهرس حاليًا لكن نسخ HEAD/التاريخ باقية | تدوير جميع أسرار الإنتاج (Firebase/R2/Paymob/WhatsApp/Sessions) + (اختياري) تطهير السجل أو مستودع جديد + أداة كشف تسريب في CI | غير محدد في المستودع (قرار إنتاجي) | تأكيد التدوير + إثبات عدم بقاء أسرار فعلية صالحة في التاريخ + أداة CI فعّالة |
| **AUTH-001** | HIGH | `server/firebaseService.ts:5727` (قراءة password) · `:5752` (الكتابة تُجزّئ) · `:5762-5764` (resetCode يُكتب نصًا) | تشغيل ترحيل-on-login في الإنتاج تحت الأعلام (DEC-001/002) + عدم تخزين OTP نصًا (تجزئة+انتهاء+محاولات) | قرار إنتاجي (غير مسمّى) | تقرير تحقق: لا كلمات مرور نصية + حالة OTP آمنة + تفعيل `AUTH_ENFORCE_HASHED_ONLY` |
| **R2-001** | HIGH | `server/routes/owner.ts:1182` (`receipts/${propertyNumber}-${Date.now()}.${ext}`) · `:1192` (رابط عام) | نموذج فصل عام/خاص + بادئات خاصة + خدمة موقّعة (DEC-003) + إيقاف تضمين روابط الإيصالات العامة | قرار إنتاجي + يحتاج نموذج نطاق المستندات (DEC-004 `BLOCKED_BY_MISSING_MODEL`) | سياسة الباكت + مسار موقّع + ترحيل المفاتيح القديمة |
| **ADMIN-001** (×2) | MEDIUM | `server/routes/admin/settings.ts:273` (`/api/bank-accounts`، يكشف IBAN) · `server/routes/admin/finance.ts:394` (`/api/currency/rate`) | قرار: هل تبقى عامة (يحتاجها الدفع)؟ إن لزم: نقلها تحت `/api/admin` + `requireSameOrigin`/`requireAdmin` + تقييد الحقول | قرار منتج (غير مسمّى) | حصر النقاط العامة + حراسة صريحة + تقييد استجابة IBAN + اختبار انحدار |
| **PAY-001** | MEDIUM | `server/services/DiscountService.ts:34-64` (`apply` لا يفحص `usageCount/maxUses`) · `:69-76` (زيادة بعدية) | فرض الحد الأقصى ذرّيًا قبل حساب المبلغ + زيادة ذرّية عند المطالبة | قرار منتج/أعمال | منطق ذرّي + اختبار استهلاك متكرر |
| **AUTH-005** | MEDIUM | `server/config/runtimeEnvironment.ts:135` (طول SESSION_SECRET فقط) · `server/_legacy/routes.ts:1491` (`ADMIN_PASSWORD \|\| "admin123"`) | فرض حد أدنى (≥12) لـ `ADMIN_CODE`/`ADMIN_PASSWORD` في الإنتاج + إزالة الافتراضي القديم (مع ضمان ألا يمنع الإقلاع) | قرار إنتاجي (بيانات اعتماد) | تشديد البوابة + إزالة الافتراضي + تثبيت عدم كسر الإقلاع |
| **DRIVE-001** | MEDIUM | `server/integrations/googleDrive.ts:20` (نطاق `auth/drive` كامل) · `:39`, `:62` (`role:reader, type:anyone`) | تقليل النطاق إلى `drive.file` + إلغاء الوصول العام + جمهور مُدار | قرار منتج + إعداد Google (غير مسمّى) | نطاق مُقلّص + ACL غير عام + اختبار |

> **لا تخمين:** الأعمدة «المالك» و«دليل الإغلاق» لا تُملأ بأسماء/تفاصيل غير موجودة في المستودع؛
> حيث لم يوجد مالك مُعرَّف وُضع «غير محدد».

---

## 5. تصنيف باقي النتائج (26)

### 5.أ — مخفّفة بالكود لكن الفحص لا يستطيع تأكيد الإغلاق (5)

| المعرّف | الخطورة | الدليل | سبب عدم تمكن الفحص من الإغلاق |
|---|---|---|---|
| **LOG-002** | MEDIUM | `server/integrations/ocrService.ts:259` (إسناد، ليس تسجيلًا) · `:247/:261/:279` (تسجيل «تم الاستخراج» بلا قيم) · `:293` (يُسجّل رمز المرجع فقط) | القاعدة تطابق المعرّف `extractedIban` لا تسجيل قيمته → **إيجابية كاذبة**؛ القيم المالية لم تعد تُسجَّل |
| **AUTHZ-002** | MEDIUM (ثقة منخفضة) | `server/routes/owner.ts:3207-3216` + الحراسة في `server/firebaseService.ts:2131-2139` (`LINKED_PROPERTY_NOT_IN_GROUP`) | الحراسة موجودة (العقار غير المرتبط يُرفض 409)؛ القاعدة استدلالية بثقة منخفضة |
| **FILES-004** | MEDIUM | `server/routes/admin/images.ts:74`, `:117` (`parsePropertyNumberParam`) | القاعدة تطابق مسار `/api/admin/r2-images/:propertyNumber` نفسه؛ المدخل مُتحقَّق منه فعلًا |
| **R2-003** | MEDIUM | `server/routes/public.ts:323` (بوابة `verificationStatus !== "approved"` → 403) | القاعدة تطابق مسار `/api/public/property-images/:propertyNumber` نفسه؛ البوابة مضافة فعلًا |
| **R2-002** | MEDIUM | `server/utils/r2.ts:6`, `:29` (خلفية مضيف الإنتاج) + `assertR2DevIsolation` | الحماية قائمة في غير الإنتاج؛ التغيير المباشر يحمل خطر كسر الإنتاج |

### 5.ب — منخفضة الخطورة أو إعدادات أو نتائج استدلالية (14)

| المعرّف | الخطورة | الدليل | ملاحظة |
|---|---|---|---|
| SSRF-002 | LOW | `server/integrations/aiReceiptScanner.ts:27` (`fetch(fileUrl)` بلا حارس أصل) | القيمة مُنشأة خادميًا عند الكتابة حاليًا |
| DEPS-001 (×6) | LOW | `package.json` (`aws-sdk:68`, `@neondatabase/serverless:24`, `@marsidev/react-turnstile:23`, `openai:96`, `passport:99`, `passport-local:100`) | تبعيات غير مستخدمة — تنظيف سلسلة التوريد |
| PAY-002 | LOW | `server/integrations/paymob.ts:12-13` (`15650`/`15649`) | قابلة للضبط عبر البيئة |
| FB-001 | LOW | `.firebaserc:3` (`default: rwqan-757`) | قرار هدف النشر |
| FB-002 | LOW | `FIRESTORE_AUDIT_REPORT.md:4` (63K قراءة/يوم) | أداء/كلفة |
| DRIVE-002 | LOW | `server/integrations/googleDrive.ts:92`, `:96` (معرّف أب ثابت + استيفاء في الاستعلام) | إعداد/تحقّق مدخلات |
| EXT-001 (×2) | MEDIUM | `server/integrations/whatsapp.ts:32` + `src/components/property-details-client.tsx:38` | رقم واتساب احتياطي مُضمّن (إعداد) |
| EXT-002 | LOW | `src/app/property/[id]/page.tsx:61` | رابط Apps Script مُضمّن (إعداد) |

**مجموع التصنيفات:** 7 (مانعة) + 5 (مخفّفة بالكود) + 14 (منخفضة/إعدادات/استدلالية) = **26** ✓

> **SEC-001 لا يظهر ضمن الـ26 الحالية** لأن قسم Secrets صار GREEN بعد إزالة `.env` من الفهرس.
> لكن الخطر الحقيقي (نسخ التاريخ) **قائم** ويُدار كمانع منفصل أعلاه — لا يُدَّعى إغلاقه.

---

## 6. ما أُغلق في هذه الجلسة (13 نتيجة) — أدلة

| المعرّف | الإصلاح | الدليل |
|---|---|---|
| AUTH-002 | مقارنات اعتماد المالك عبر `_safeCredentialMatch` (`timingSafeEqual`) | `server/services/AuthService.ts` |
| AUTH-003 | `randomInt(100_000, 1_000_000)` بدل `Math.random()` | `server/services/AuthService.ts` |
| AUTH-004 (×2) | `getContactAnalyticsSecret()` يفشل مغلقًا (إنتاج يتطلب `SESSION_SECRET`)؛ لا خلفية ثابتة | `server/services/ContactIdentityService.ts` + `server/routes/tracking.ts` |
| SSRF-001 | تسمية متغيرات العملة (مع الإبقاء على تحقق ISO) | `server/routes/admin/finance.ts` |
| FILES-001 | رفع الإيصال: حدود حجم/نوع + تحقق بايتات سحرية (`parseReceiptUpload`) | `server/routes/owner.ts` + `server/utils/helpers.ts` |
| FILES-002 | نفس المعالجة لإيصالات الإضافات | `server/routes/admin/addons.ts` |
| FILES-003 | صور المالك: تحقق بايتات سحرية + إزالة `ACL: public-read` | `server/routes/owner.ts` |
| LOG-001 | إزالة بادئة الرمز/رقم المدير من السجل | `server/integrations/whatsapp.ts` |
| LOG-003 (×2) | إزالة أرقام/معرّفات الهواتف من السجلات والرسائل | `server/routes/owner.ts`, `server/routes/admin/settings.ts`, `server/routes/admin/testing.ts` |
| ERR-001 | رسائل أخطاء عامة (بلا `err.message`) | `server/routes/owner.ts`, `server/routes/admin/settings.ts`, `server/routes/admin/properties.ts` |
| SEC-002 | إعادة صياغة قيم المستند إلى قائمة بلا نمط `KEY=` | `docs/WHATSAPP_REPORT_AR.md` |

> **تنويه منهجي:** الماسح يُظهر `RESOLVED: 0` رغم إغلاق 13 نتيجة، لأن ارتباطه بالأساس يعتمد على
> بصمات الموقع/السطر، وتغيّر الأسطر يجعل النتائج المعدّلة تظهر كـ`NEW`/`EXISTING`. `RESOLVED: 0`
> **ليس** دليلًا على عدم وجود إصلاحات.

---

## 7. التناقضات ونقاط غير مؤكدة (مسجّلة لا مُخمّنة)

1. **تناقض عدد الأساس:** `SECURITY_STATUS.md` (2026-10-13) يوثّق أساسًا = **40 نتيجة** بحالة RED
   مُفعَّلة بواسطة SEC-001 (.env متتبَّع). أما أول فحص في هذه الجلسة (`secscan.log`) فأظهر
   **39 نتيجة** وقسم Secrets بحالة **ORANGE (medium)** لا RED. الفرق = نتيجة واحدة (SEC-001).
   السبب المرجّح: إزالة `.env` من الفهرس في التنظيف السابق جعلت قاعدة SEC-001 تتوقف عن الظهور.
   **لم يُتحقَّق بشكل مستقل من أي لقطة فحص يعكسها `security/baseline.json`** — يُسجَّل كتناقض قائم.
2. **سيولة `NEW`:** أعداد `NEW` (4 → 11 → 6 → 6) تعكس انزياح الأسطر بين الفحوص لا بالضرورة
   نتائج جديدة فعليًا؛ التصنيفات أعلاه بُنيت على مطابقة المعرّفات مع الدليل الفعلي، لا على عدّاد NEW.
3. **أدوات خارجية غير مثبتة** (gitleaks/semgrep/codeql/osv/trivy/ZAP): لا تغطية من فحوصات خارجية؛
   النتائج محصورة بالماسح المحلي الاستدلالي.
4. **SEC-001:** لا يوجد دليل على تنفيذ تدوير الأسرار الإنتاجية؛ الحالة = BLOCKED.

---

## 8. شروط الانتقال إلى CONDITIONAL GO / GO

- إغلاق **SEC-001**: تدوير أسرار الإنتاج + معالجة نسخ التاريخ + أداة كشف في CI.
- إغلاق **AUTH-001**: ترحيل بيانات الاعتماد في الإنتاج والتحقق من غياب النص الصريح/OTP غير الآمن.
- إغلاق **R2-001**: فصل عام/خاص للإيصالات + خدمة موقّعة + ترحيل المفاتيح.
- حسم قرارات **ADMIN-001 / PAY-001 / AUTH-005 / DRIVE-001**.
- توثيق حالة التشغيل (HTTPS ingress للـwebhook، النسخ الاحتياطي/الاستعادة، staging) — غير معروفة حاليًا.
- عند تحقق الشروط أعلاه فقط: يُرفع القرار إلى **CONDITIONAL GO** بشرط تحقق المتبقي، ثم **GO**.

---

## 9. أوامر إعادة الإنتاج

```powershell
# فحص الأنواع
node ./node_modules/typescript/bin/tsc --noEmit

# مجموعة الاختبارات الكاملة (بدون NODE_ENV=development)
Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue
node --import tsx --test --test-concurrency=1 <files...>

# ماسح الأمان (بدون شبكة)
npx tsx security/src/cli.ts --ci --no-network true
```

المراجع: [`SECURITY_STATUS.md`](./SECURITY_STATUS.md) · `docs/DECISIONS.md` · `docs/SESSION_HANDOFF.md`
