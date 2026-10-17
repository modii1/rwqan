import assert from "node:assert/strict";
import test from "node:test";
import {
  notificationKindLabel,
  notificationProviderErrorLabel,
  notificationRecipientLabel,
  notificationStatusMeta,
} from "./booking-admin-history";

test("admin notification history localizes kinds and recipients", () => {
  assert.equal(notificationKindLabel("commission_reminder_4"), "تذكير العمولة لليوم الرابع");
  assert.equal(notificationKindLabel("customer_final_reminder"), "المتابعة الأخيرة مع العميل");
  assert.equal(
    notificationKindLabel("owner_contact_limit_reached"),
    "إشعار المالك باكتمال حد التواصل",
  );
  assert.equal(notificationRecipientLabel("owner"), "المالك");
});

test("admin notification history distinguishes terminal and queued states", () => {
  assert.deepEqual(notificationStatusMeta("sent"), { label: "تم الإرسال", tone: "green" });
  assert.deepEqual(notificationStatusMeta("suppressed_quota"), { label: "منعها حد الرسائل", tone: "amber" });
  assert.deepEqual(notificationStatusMeta("pending"), { label: "مجدولة", tone: "blue" });
});

test("admin notification history explains workflow provider reasons", () => {
  assert.equal(
    notificationProviderErrorLabel("owner_identity_changed"),
    "تغيرت هوية مالك العقار فتوقف الإرسال.",
  );
  assert.equal(
    notificationProviderErrorLabel("awaiting_owner_commission_notice"),
    "بانتظار قبول مزود واتساب لإشعار العمولة الأساسي للإرسال.",
  );
});
