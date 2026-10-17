# تقرير المرحلة السابعة — المهام الخلفية (Schedulers / Workers) على بيئة التطوير

**التاريخ:** 2026-10-15
**النطاق:** جرد المجدولات/العمال الخلفيين، إثبات عزل DEV، اختبار المهام فعليًا على بيانات DEV فقط، وإصلاحات جراحية أدنى.
**البيئة:** Firebase `rwqan-sa-dev`، R2 bucket `rwqan-sa-dev`، منفذ التطوير `5001`، `ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT=false`.
**الأداة:** `scripts/dev/phase7-background-jobs-dev.ts` — الدليل الآلي: `quality/reports/phase7-background-jobs.json`.
**النتيجة:** 9 PASS / 0 FAIL / 0 BLOCKED / 0 NA. `npx tsc --noEmit` = 0. الاختبارات الوحدوية ذات الصلة: 39/39.

---

## 1) نطاق المرحلة
جرد المهام الخلفية الفعلية (المجدولات والعمال)، إثبات عزلها في بيئة التطوير، واختبار سلوكها على بيانات DEV اصطناعية فقط (المعرّفات/التكرار/التزامن والفشل)، مع تقرير عربي. **لم تُبدأ المرحلة الثامنة.**

## 2) الأنظمة الخلفية الفعلية (الجرد)
عند الإقلاع `server/index.ts` يستدعي ثلاثة أنظمة، وكلها محكومة بعزل بيئة التطوير:

| النظام | المصدر | دالة البدء | جدولته |
| --- | --- | --- | --- |
| المجدول العام | `server/scheduler.ts` | `startScheduler()` | كل 5 ثوانٍ فحص أولي، ثم يوميًا 12:00 بتوقيت السعودية؛ تخفيض الاشتراكات كل 30 دقيقة |
| عامل إشعارات الحجز | `server/services/BookingNotificationWorker.ts` | `startBookingCommissionWorker()` | أول تشغيل بعد 15 ثانية ثم كل 60 ثانية (`BOOKING_WORKER_INTERVAL_MS`) |
| المجدول الذكي | `server/smartScheduler.ts` | `startSmartScheduler()` | نافذتان أسبوعيًا (الأحد 09:00 / الأربعاء 21:00)، دفعات 10، فاصل 60 دقيقة، سقف يومي 50 |

**بنية غير موصولة:** `server/services/DistributedScheduledJob.ts` (عدّاد بإيجار/lease) — لا يوجد له أي مستدعٍ في الكود خارج ملفه واختباره، لذا فهو غير موصول بأي مهمة فعلية (يُوثَّق فقط، لم يُفعّل).

**مهام المجدول العام الداخلية:**
- `updateRemainingDaysInSheet()` — يوميًا: تحديث الأيام المتبقية وإرسال تنبيهات الانتهاء (دورة 3 إرسال / 3 توقف).
- `downgradeExpiredSubscriptions()` — كل 30 دقيقة: تخفيض الاشتراكات المنتهية/الملغاة إلى «منتهي» وإزالة الصفة المميزة من الاشتراك والعقار.
- `expireOldPendingPayments()` — إلغاء الدفعات المعلقة المنتهية (بطاقة 30 دقيقة، تحويل بنكي 72 ساعة)، محكوم بـ `FEATURE_TIMEOUTS`.

**مُشغّلات عامل الحجز:** `POST /api/internal/booking-worker` (يتطلب `hasValidWorkerSecret`)؛ `POST /api/admin/booking-commissions/run-worker`؛ ويُستدعى بعد Webhook لـ Paymob.

## ── عزل بيئة التطوير (مُثبت) ──
- القاعدة `shouldStartScheduledBackgroundWork()`: production → تعمل؛ خارج production → فقط عند `ENABLE_SCHEDULERS_IN_DEVELOPMENT === "true"` (حساس لحالة الأحرف). عامل الحجز يضيف أيضًا البوابة القديمة `ENABLE_BOOKING_WORKER_IN_DEVELOPMENT`.
- في DEV الحالي: كلا البوابتين **غير مضبوطتين** → المجدولات + عامل الحجز **معطّلة**.
- سجل الإقلاع الفعلي لخادم DEV أثبت: `Booking commission worker is disabled outside production...` ولا رسائل بدء مجدولات.
- `externalServicesEnabled() === false`؛ هوية DEV: مشروع `rwqan-sa-dev` وحاوية R2 `rwqan-sa-dev`.

## ── نتائج الاختبار الفعلي على DEV (9/9 PASS) ──
| المعرّف | الفحص | النتيجة |
| --- | --- | --- |
| ISOL-001 | المجدولات والعامل متوقفة افتراضيًا في DEV وتعمل فقط بالتفعيل الصريح | PASS |
| ISOL-002 | نقطة العامل الداخلية ترفض الاستدعاء غير المُصادق | PASS (401) |
| SUB-001 | تخفيض اشتراك مميز منتهٍ (الحالة + إزالة الصفة المميزة من الاشتراك والعقار) | PASS |
| SUB-002 | إعادة تشغيل مهمة التخفيض لا تُحدث أثرًا مكررًا | PASS |
| PAY-001 | دفعة بطاقة معلقة **لا تُفعّلها** المهمة بلا إثبات دفع (تتحول إلى «ملغي - انتهت المهلة») | PASS |
| PAY-002 | إعادة تشغيل مهمة انتهاء الدفعات لا تغيّر حالة مُسوّاة | PASS |
| PAY-003 | تشغيلان متزامنان لنفس الدفعة يسوّيانها **مرة واحدة فقط** | PASS |
| PAY-004 | التحويل البنكي المعلق لا يُعتمد/يُفعّل تلقائيًا | PASS |
| REMIND-001 | مهمة الأيام المتبقية تعمل لكنها **لا ترسل أي إشعار** في DEV (الخدمات الخارجية معطلة) | PASS |

المهام نُفِّذت يدويًا (استدعاء مباشر للدوال المُصدَّرة) على بيانات DEV اصطناعية وسُبكها (marker `testData`)، ثم حُذفت بالكامل (تحقق آلي: `clean` لجميع الوثائق المُنشأة).

## ── ملاحظات/عجائب (بدون تعديل كود) ──
1. **`remainingDays` لا يُحفظ في مسار المجدول الحالي:** `FirebaseStorage.updateAllSubscriptionsRemainingDays` يفوّض إلى `updateSubscriptionRemainingDays` الذي يحدّث **الحالة فقط** عبر `getSubscriptionByPropertyNumber` ولا يكتب الحقل `remainingDays`. الدالة الموازية `firebaseService.updateAllSubscriptionsRemainingDays` (التي تكتب `remainingDays`) **غير مستخدمة** في مسار المجدول. النتيجة: العدد المُعاد يمثل العقارات المُعالجة لا صفوفًا كُتب فيها الحقل.
2. **إرسال الإشعارات آمن في DEV:** جميع مسارات الإرسال تمر عبر بوابة `externalServicesEnabled()` (`sendAdminWhatsAppNotification`) فترجع `disabled` دون إرسال فعلي — مثبت عمليًا (`notificationsSent === 0`).
3. **التحكم بـ `FEATURE_TIMEOUTS`:** القيمة في DEV = **`true`**، لذا مطابقة Paymob للدفعات الحديثة و المهلات الزمنية نشطة عند تنفيذ المهمة.
4. **`DistributedScheduledJob` غير موصول** بأي مهمة (بنية جاهزة غير مُستعملة).

## ── ما لم يُشغَّل مباشرة (حدود) ──
- لم أُنشئ/أُعدّل أي مجدول خارجي (Cron/Scheduler) — وفق القواعد.
- لم تُجرَّب إرسال رسائل حقيقية (WhatsApp) ولا مطابقة Paymob الخارجية (خدمات خارجية معطلة ومحظورة في DEV).
- سيناريوهات الفشل/إعادة المحاولة/التعافي وملكية الإيجار تُغطّيها اختبارات الوحدة (39/39 PASS): `BookingNotificationOnceOnly`، `DistributedScheduledJob`، `BookingNotificationWorker`، `scheduler-payment-expiry`.

## ── التحقق الآلي ──
- `npx tsc --noEmit` = **0 أخطاء**.
- اختبارات الوحدة ذات الصلة: **39/39 PASS**.
- حزمة المرحلة: `quality/reports/phase7-background-jobs.json` (**9 PASS / 0 FAIL / 0 BLOCKED / 0 NA**).
- تشغيل: `$env:NODE_ENV="development"; npx tsx scripts/dev/phase7-background-jobs-dev.ts`

## ── عائق سابق غير متعلق (لم يُعدَّل) ──
`server/services/BookingCommissionStore.test.ts:290` اختبار فاشل سابق بتوقّع قديم (يغيب عنه حقول `provider*`)؛ لا علاقة له بمهام هذه المرحلة، وتُرك دون تغيير.
