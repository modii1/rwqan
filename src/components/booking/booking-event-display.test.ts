import assert from "node:assert/strict";
import test from "node:test";
import {
  getBookingEventDetail,
  getBookingEventLabel,
  getPaymentReversalStatusLabel,
} from "./booking-display";

test("financial exception events have clear admin labels", () => {
  assert.equal(
    getBookingEventLabel("commission_duplicate_payment"),
    "تم رصد دفعة عمولة مكررة",
  );
  assert.equal(
    getBookingEventLabel("commission_payment_reversal_reported"),
    "تم الإبلاغ عن عكس دفعة العمولة",
  );
});

test("financial event details explain attempt and reversal values", () => {
  assert.equal(
    getBookingEventDetail("commission_duplicate_payment", "BCOM-ATT-123"),
    "رقم محاولة الدفع: BCOM-ATT-123",
  );
  assert.equal(
    getBookingEventDetail("commission_payment_reversal_reported", "refunded"),
    "تم استرداد الدفعة",
  );
  assert.equal(
    getBookingEventDetail("commission_payment_authorized", "AUTH-123"),
    "رقم عملية التفويض: AUTH-123",
  );
  assert.equal(getPaymentReversalStatusLabel("authorization_only"), "تفويض دفع فقط دون تحصيل");
});

test("safety and reversal resolution events are localized", () => {
  assert.equal(
    getBookingEventLabel("booking_free_eligibility_lost"),
    "تم إغلاق متابعة الحجز بعد تفعيل اشتراك مميز للعقار",
  );
  assert.equal(
    getBookingEventDetail(
      "booking_free_eligibility_lost",
      "active_premium_subscription",
    ),
    "توقف مسار المتابعة والعمولة لأن العقار أصبح ضمن اشتراك مميز فعال.",
  );
  assert.equal(getBookingEventLabel("owner_identity_changed"), "تم رصد تغير هوية مالك العقار");
  assert.equal(getBookingEventLabel("customer_followup_expired"), "انتهت مهلة رد العميل");
  assert.equal(getBookingEventLabel("commission_payment_authorized"), "تم تسجيل تفويض عملية الدفع");
  assert.equal(
    getBookingEventLabel("commission_payment_reversal_collection_resumed"),
    "تمت معالجة العكس واستئناف التحصيل",
  );
  assert.equal(
    getBookingEventLabel("commission_payment_reversal_kept_paid"),
    "تمت معالجة العكس مع إبقاء العمولة مدفوعة",
  );
});

test("the final customer reminder lifecycle is localized", () => {
  assert.equal(
    getBookingEventLabel("customer_final_reminder_scheduled"),
    "تمت جدولة المتابعة الأخيرة مع العميل",
  );
  assert.equal(
    getBookingEventLabel("customer_final_reminder_sent"),
    "تم إرسال المتابعة الأخيرة للعميل",
  );
  assert.equal(
    getBookingEventLabel("customer_final_reminder_failed"),
    "فشل إرسال المتابعة الأخيرة للعميل",
  );
  assert.equal(
    getBookingEventLabel("customer_final_reminder_suppressed"),
    "تم تقييد المتابعة الأخيرة للعميل",
  );
});
