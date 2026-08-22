import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOKING_TEMPLATE_DEFINITIONS,
  bookingSettingsToDraft,
  bookingSettingsUpdateEquals,
  parseCustomerFollowUpDelayHours,
  previewBookingTemplate,
  validateBookingSettingsDraft,
  validateBookingTemplate,
  type BookingCommissionSettings,
  type BookingWhatsAppTemplates,
} from "./booking-commission-settings-model";

function validTemplates(): BookingWhatsAppTemplates {
  return Object.fromEntries(BOOKING_TEMPLATE_DEFINITIONS.map((definition) => [
    definition.key,
    definition.placeholders.map((placeholder) => `{{${placeholder}}}`).join("\n"),
  ])) as BookingWhatsAppTemplates;
}

function settingsFixture(): BookingCommissionSettings {
  return {
    customerFollowUpDelayHours: 24,
    customerDailyLimit: 3,
    freeOwnerDailyLimit: 4,
    freePropertyContactDailyLimit: 5,
    whatsappTemplates: validTemplates(),
    optionalCommissionReminderDays: [3, 4],
    updatedAt: null,
    updatedBy: "environment",
    source: "environment",
  };
}

test("template validation requires every allowed placeholder exactly once", () => {
  assert.equal(
    validateBookingTemplate(
      "customer_followup",
      "الحجز {{propertyLabel}}\n{{followUpLink}}",
      2_000,
    ),
    null,
  );
  assert.match(
    validateBookingTemplate("customer_followup", "{{propertyLabel}}", 2_000) || "",
    /followUpLink/,
  );
  assert.match(
    validateBookingTemplate(
      "customer_followup",
      "{{propertyLabel}} {{followUpLink}} {{followUpLink}}",
      2_000,
    ) || "",
    /مرة واحدة فقط/,
  );
  assert.match(
    validateBookingTemplate(
      "customer_followup",
      "{{propertyLabel}} {{followUpLink}} {{paymentLink}}",
      2_000,
    ) || "",
    /غير مسموح/,
  );
});

test("template validation rejects malformed single braces and oversized copy", () => {
  assert.match(
    validateBookingTemplate(
      "customer_followup",
      "{propertyLabel} {{propertyLabel}} {{followUpLink}}",
      2_000,
    ) || "",
    /صيغة غير صحيحة/,
  );
  assert.match(
    validateBookingTemplate(
      "customer_followup",
      "{{propertyLabel}} {{followUpLink}} }",
      2_000,
    ) || "",
    /صيغة غير صحيحة/,
  );
  assert.match(
    validateBookingTemplate(
      "customer_followup",
      "{{propertyLabel}} {{followUpLink}}",
      10,
    ) || "",
    /الحد الأقصى/,
  );
  assert.match(
    validateBookingTemplate(
      "customer_followup",
      "{{propertyLabel}}\u0007{{followUpLink}}",
      2_000,
    ) || "",
    /محارف تحكم/,
  );
});

test("draft validation creates the strict full-replacement payload", () => {
  const settings = settingsFixture();
  const draft = bookingSettingsToDraft(settings);
  draft.optionalCommissionReminderDays = [4, 3];
  draft.customerFollowUpDelayHours = "٣٦";
  draft.limits.customerDailyLimit = "٠";

  const validation = validateBookingSettingsDraft(draft, 2_000);
  assert.equal(validation.limitsValid, true);
  assert.deepEqual(validation.templateErrors, {});
  assert.equal(validation.customerFollowUpDelayValid, true);
  assert.deepEqual(validation.update, {
    customerFollowUpDelayHours: 36,
    customerDailyLimit: 0,
    freeOwnerDailyLimit: 4,
    freePropertyContactDailyLimit: 5,
    whatsappTemplates: settings.whatsappTemplates,
    optionalCommissionReminderDays: [3, 4],
  });
  assert.equal(bookingSettingsUpdateEquals(validation.update!, settings), false);
});

test("follow-up delay accepts integer Arabic digits only within policy bounds", () => {
  assert.equal(parseCustomerFollowUpDelayHours("٢٤", 1, 120), 24);
  assert.equal(parseCustomerFollowUpDelayHours("۱۲۰", 1, 120), 120);
  assert.equal(parseCustomerFollowUpDelayHours("0", 1, 120), null);
  assert.equal(parseCustomerFollowUpDelayHours("121", 1, 120), null);
  assert.equal(parseCustomerFollowUpDelayHours("1.5", 1, 120), null);

  const settings = settingsFixture();
  const draft = bookingSettingsToDraft(settings);
  draft.customerFollowUpDelayHours = "0";
  const validation = validateBookingSettingsDraft(draft, 2_000, 1, 120);
  assert.equal(validation.customerFollowUpDelayValid, false);
  assert.equal(validation.update, null);
});

test("settings equality includes the configurable follow-up delay", () => {
  const settings = settingsFixture();
  const validation = validateBookingSettingsDraft(
    bookingSettingsToDraft(settings),
    2_000,
    1,
    120,
  );
  assert.ok(validation.update);
  assert.equal(bookingSettingsUpdateEquals(validation.update!, settings), true);
  assert.equal(
    bookingSettingsUpdateEquals(
      { ...validation.update!, customerFollowUpDelayHours: 25 },
      settings,
    ),
    false,
  );
});

test("template preview substitutes sample commission percentage only once", () => {
  const preview = previewBookingTemplate("عمولة روقان ({{commissionPercent}}%): {{commissionAmountSar}} ريال");
  assert.equal(preview, "عمولة روقان (10%): 100 ريال");
  assert.doesNotMatch(preview, /%%/);
});
