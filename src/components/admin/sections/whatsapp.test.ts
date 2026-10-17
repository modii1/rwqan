import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const whatsappSource = readFileSync(
  new URL("./whatsapp.tsx", import.meta.url),
  "utf8",
);
const settingsSource = readFileSync(
  new URL("./settings.tsx", import.meta.url),
  "utf8",
);
const bookingsSource = readFileSync(
  new URL("./booking-commissions.tsx", import.meta.url),
  "utf8",
);

test("WhatsApp admin hub centralizes workflow and Meta notification controls", () => {
  assert.match(whatsappSource, /<BookingCommissionSettingsCard \/>/);
  assert.match(whatsappSource, /<WhatsAppNotificationSettings \/>/);
  assert.match(whatsappSource, /tab-whatsapp-workflow/);
  assert.match(whatsappSource, /tab-whatsapp-admin-notifications/);
  assert.match(whatsappSource, /tab-whatsapp-subscription-owner-sends/);
  assert.match(whatsappSource, /tab-whatsapp-activity/);
  assert.match(settingsSource, /export function WhatsAppNotificationSettings/);
  assert.match(whatsappSource, /"\/api\/admin\/booking-commissions"/);
  assert.match(whatsappSource, /إشعارات الحجوزات والعمولات/);
  assert.match(whatsappSource, /إحصائيات إشعارات الإدارة عبر Meta/);
  assert.match(whatsappSource, /href="\/admin\/booking-commissions"/);
});

test("WhatsApp hub exposes authenticated single-owner and bulk subscription sends", () => {
  assert.match(whatsappSource, /"\/api\/admin\/send-owner-notification"/);
  assert.match(whatsappSource, /"\/api\/admin\/send-bulk-notifications"/);
  assert.match(whatsappSource, /credentials: "include"/);
  assert.match(whatsappSource, /value="expired">اشتراك منتهي/);
  assert.match(whatsappSource, /value="expiring_soon">ينتهي قريباً \(3 أيام\)/);
  assert.match(whatsappSource, /value="custom">رسالة مخصصة/);
  assert.match(whatsappSource, /value="all">الكل \(منتهي \+ قريب الانتهاء\)/);
  assert.match(whatsappSource, /dialog-confirm-owner-notification/);
  assert.match(whatsappSource, /button-confirm-owner-notification/);
  assert.match(
    whatsappSource,
    /سيتم إرسال رسائل واتساب لجميع الملاك المطابقين\. هذا قد يستهلك رصيد الرسائل\./,
  );
});

test("booking commissions links to the central WhatsApp settings without mounting a second editor", () => {
  assert.doesNotMatch(bookingsSource, /import BookingCommissionSettingsCard/);
  assert.doesNotMatch(bookingsSource, /<BookingCommissionSettingsCard \/>/);
  assert.match(bookingsSource, /href="\/admin\/whatsapp"/);
});

test("WhatsApp controls remain viewport-bound and stack actions on narrow screens", () => {
  assert.match(whatsappSource, /min-w-0 max-w-full/);
  assert.match(whatsappSource, /max-w-full overflow-x-auto/);
  assert.match(whatsappSource, /grid-cols-2 gap-1 p-1 sm:flex/);
  assert.match(whatsappSource, /whitespace-normal px-2 sm:flex-1/);
  assert.match(
    whatsappSource,
    /grid-cols-1 gap-3 text-center min-\[360px\]:grid-cols-2/,
  );
  assert.match(whatsappSource, /className="w-full sm:w-auto"/);
  assert.match(whatsappSource, /w-\[calc\(100vw-2rem\)\] max-w-md/);
  assert.match(whatsappSource, /flex-col-reverse gap-2 sm:flex-row/);
  assert.match(settingsSource, /min-\[360px\]:flex-row/);
  assert.match(bookingsSource, /w-\[min\(20rem,calc\(100vw-2rem\)\)\]/);
});

test("admin notification settings expose mobile-safe owner subscription template editors", () => {
  assert.match(settingsSource, /قوالب رسائل اشتراكات الملاك/);
  assert.match(settingsSource, /textarea-owner-subscription-\$\{definition\.key\}/);
  assert.match(settingsSource, /ownerSubscriptionWhatsAppTemplates/);
  assert.match(settingsSource, /OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATE_PLACEHOLDERS/);
  assert.match(settingsSource, /min-w-0 space-y-3 rounded-lg/);
  assert.match(settingsSource, /min-h-40 w-full max-w-full/);
  assert.match(settingsSource, /break-all rounded bg-muted/);
  assert.match(settingsSource, /saveMutation\.isPending \|\| !ownerTemplatesValid/);
  assert.match(settingsSource, /button-save-schedule-settings/);
});
