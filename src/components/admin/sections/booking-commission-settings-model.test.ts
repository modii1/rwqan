import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOKING_TEMPLATE_DEFINITIONS,
  bookingSettingsToDraft,
  bookingSettingsUpdateEquals,
  parseCustomerFollowUpDelayHours,
  parseCustomerFollowUpDelayMinutes,
  parseCustomerFollowUpDelayMinutesPart,
  previewBookingTemplate,
  validateBookingSettingsDraft,
  validateBookingTemplate,
  type BookingCommissionSettings,
  type BookingWhatsAppTemplates,
} from "./booking-commission-settings-model";

function validTemplates(): BookingWhatsAppTemplates {
  return Object.fromEntries(BOOKING_TEMPLATE_DEFINITIONS.map((definition) => [
    definition.key,
    definition.placeholders.length > 0
      ? definition.placeholders.map((placeholder) => `{{${placeholder}}}`).join("\n")
      : "رسالة ثابتة",
  ])) as BookingWhatsAppTemplates;
}

function settingsFixture(): BookingCommissionSettings {
  return {
    customerFollowUpDelayMinutes: 1_440,
    customerDailyLimit: 3,
    freeOwnerDailyLimit: 4,
    freePropertyContactDailyLimit: 5,
    customerFollowUpMessageLimit: 3,
    customerFollowUpLimitScope: "customer",
    adminCustomerWhatsAppCooldownMinutes: 30,
    whatsappTemplates: validTemplates(),
    optionalCommissionReminderDays: [3, 4],
    updatedAt: null,
    updatedBy: "environment",
    source: "environment",
  };
}

test("template validation enforces every allowed placeholder occurrence rule", () => {
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
  assert.equal(
    validateBookingTemplate(
      "customer_final_reminder",
      "هذه آخر متابعة منا.",
      2_000,
    ),
    null,
  );
  assert.match(
    validateBookingTemplate(
      "customer_final_reminder",
      "هذه آخر متابعة منا. {{followUpLink}}",
      2_000,
    ) || "",
    /غير مسموح/,
  );
  assert.equal(
    validateBookingTemplate(
      "admin_customer_technical_support",
      "مرحباً، معك فريق الدعم.",
      2_000,
    ),
    null,
  );
  assert.match(
    validateBookingTemplate(
      "admin_customer_technical_support",
      "مرحباً {{customerPhone}}",
      2_000,
    ) || "",
    /غير مسموح/,
  );
  assert.equal(
    validateBookingTemplate(
      "owner_contact_limit_reached",
      "{{propertyNumber}} {{dailyLimit}} {{dailyLimit}} {{renewalLink}}",
      2_000,
    ),
    null,
  );
  assert.equal(
    validateBookingTemplate(
      "owner_contact_limit_reached",
      "{{propertyNumber}} {{dailyLimit}} {{renewalLink}}",
      2_000,
    ),
    null,
  );
  assert.match(
    validateBookingTemplate(
      "owner_contact_limit_reached",
      "{{propertyNumber}} {{dailyLimit}} {{dailyLimit}} {{dailyLimit}} {{renewalLink}}",
      2_000,
    ) || "",
    /مرة أو مرتين فقط/,
  );
});

test("admin settings expose the editable technical-support template without placeholders", () => {
  const definition = BOOKING_TEMPLATE_DEFINITIONS.find(
    ({ key }) => key === "admin_customer_technical_support",
  );
  assert.deepEqual(definition, {
    key: "admin_customer_technical_support",
    label: "التواصل التقني مع العميل",
    description: "القالب الجاهز الذي يفتحه المشرف للتواصل التقني مع العميل.",
    placeholders: [],
  });
});

test("admin settings expose the final customer reminder as a no-placeholder template", () => {
  const definition = BOOKING_TEMPLATE_DEFINITIONS.find(
    ({ key }) => key === "customer_final_reminder",
  );
  assert.deepEqual(definition, {
    key: "customer_final_reminder",
    label: "المتابعة الأخيرة للعميل",
    description: "تُرسل بعد اكتمال عدد رسائل متابعة العميل وعدم استلام رد.",
    placeholders: [],
  });
});

test("admin settings expose the editable owner contact-limit template", () => {
  const definition = BOOKING_TEMPLATE_DEFINITIONS.find(
    ({ key }) => key === "owner_contact_limit_reached",
  );
  assert.deepEqual(definition, {
    key: "owner_contact_limit_reached",
    label: "بلوغ حد طلبات التواصل",
    description: "تُرسل لمالك العقار المجاني عند بلوغ الحد اليومي لطلبات التواصل.",
    placeholders: ["propertyNumber", "dailyLimit", "renewalLink"],
  });
  assert.equal(
    previewBookingTemplate(
      "العقار {{propertyNumber}} ({{dailyLimit}} من {{dailyLimit}}): {{renewalLink}}",
    ),
    "العقار 13383 (3 من 3): https://rwqan.sa/r",
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
  draft.customerFollowUpDelayMinutes = "١٥";
  draft.customerFollowUpMessageLimit = "٣";
  draft.adminCustomerWhatsAppCooldownMinutes = "٠";
  draft.limits.customerDailyLimit = "٠";

  const validation = validateBookingSettingsDraft(draft, 2_000);
  assert.equal(validation.limitsValid, true);
  assert.deepEqual(validation.templateErrors, {});
  assert.equal(validation.customerFollowUpDelayValid, true);
  assert.equal(validation.workflowControlsValid, true);
  assert.deepEqual(validation.update, {
    customerFollowUpDelayMinutes: 2_175,
    customerFollowUpMessageLimit: 3,
    customerFollowUpLimitScope: "customer",
    adminCustomerWhatsAppCooldownMinutes: 0,
    customerDailyLimit: 0,
    freeOwnerDailyLimit: 4,
    freePropertyContactDailyLimit: 5,
    whatsappTemplates: settings.whatsappTemplates,
    optionalCommissionReminderDays: [3, 4],
  });
  assert.equal(bookingSettingsUpdateEquals(validation.update!, settings), false);
});

test("workflow controls accept zero and bounds while rejecting fractions and overflow", () => {
  const settings = settingsFixture();
  const draft = bookingSettingsToDraft(settings);
  assert.equal(draft.customerFollowUpMessageLimit, "3");
  assert.equal(draft.adminCustomerWhatsAppCooldownMinutes, "30");

  draft.customerFollowUpMessageLimit = "٠";
  draft.adminCustomerWhatsAppCooldownMinutes = "۱۰۰۸۰";
  let validation = validateBookingSettingsDraft(draft, 2_000);
  assert.equal(validation.workflowControlsValid, true);
  assert.equal(validation.update?.customerFollowUpMessageLimit, 0);
  assert.equal(validation.update?.adminCustomerWhatsAppCooldownMinutes, 10_080);

  draft.customerFollowUpMessageLimit = "1.5";
  validation = validateBookingSettingsDraft(draft, 2_000);
  assert.equal(validation.workflowControlsValid, false);
  assert.equal(validation.update, null);

  draft.customerFollowUpMessageLimit = "3";
  draft.adminCustomerWhatsAppCooldownMinutes = "10081";
  validation = validateBookingSettingsDraft(draft, 2_000);
  assert.equal(validation.workflowControlsValid, false);
  assert.equal(validation.update, null);
});

test("workflow controls reject a sequence whose final step reaches the response window", () => {
  const draft = bookingSettingsToDraft(settingsFixture());
  draft.customerFollowUpDelayHours = "56";
  draft.customerFollowUpDelayMinutes = "0";
  draft.customerFollowUpMessageLimit = "3";
  let validation = validateBookingSettingsDraft(draft, 2_000);
  assert.equal(validation.customerFollowUpDelayValid, true);
  assert.equal(validation.workflowControlsValid, false);
  assert.equal(validation.update, null);

  draft.customerFollowUpDelayHours = "55";
  draft.customerFollowUpDelayMinutes = "59";
  validation = validateBookingSettingsDraft(draft, 2_000);
  assert.equal(validation.workflowControlsValid, true);
  assert.notEqual(validation.update, null);

  draft.customerFollowUpDelayHours = "120";
  draft.customerFollowUpDelayMinutes = "0";
  draft.customerFollowUpMessageLimit = "0";
  validation = validateBookingSettingsDraft(draft, 2_000);
  assert.equal(validation.workflowControlsValid, true);
  assert.notEqual(validation.update, null);
});

test("follow-up scope supports customer-wide and per-property limits with a safe legacy default", () => {
  const settings = settingsFixture();
  const customerDraft = bookingSettingsToDraft(settings);
  assert.equal(customerDraft.customerFollowUpLimitScope, "customer");
  assert.equal(
    validateBookingSettingsDraft(customerDraft, 2_000).update
      ?.customerFollowUpLimitScope,
    "customer",
  );

  const propertyDraft = {
    ...customerDraft,
    customerFollowUpLimitScope: "property" as const,
  };
  const propertyUpdate = validateBookingSettingsDraft(
    propertyDraft,
    2_000,
  ).update;
  assert.equal(propertyUpdate?.customerFollowUpLimitScope, "property");
  assert.equal(bookingSettingsUpdateEquals(propertyUpdate!, settings), false);

  const legacy = { ...settings };
  delete legacy.customerFollowUpLimitScope;
  assert.equal(
    bookingSettingsToDraft(legacy).customerFollowUpLimitScope,
    "customer",
  );
});

test("follow-up delay accepts Arabic-digit hour and minute components within policy bounds", () => {
  assert.equal(parseCustomerFollowUpDelayHours("٢٤", 120), 24);
  assert.equal(parseCustomerFollowUpDelayHours("۱۲۰", 120), 120);
  assert.equal(parseCustomerFollowUpDelayHours("121", 120), null);
  assert.equal(parseCustomerFollowUpDelayHours("1.5", 120), null);
  assert.equal(parseCustomerFollowUpDelayMinutesPart("٥٩"), 59);
  assert.equal(parseCustomerFollowUpDelayMinutesPart("60"), null);
  assert.equal(parseCustomerFollowUpDelayMinutes("0", "30"), 30);
  assert.equal(parseCustomerFollowUpDelayMinutes("٢٤", "١٥"), 1_455);
  assert.equal(parseCustomerFollowUpDelayMinutes("120", "1"), null);
  assert.equal(parseCustomerFollowUpDelayMinutes("0", "0"), null);

  const settings = settingsFixture();
  const draft = bookingSettingsToDraft(settings);
  draft.customerFollowUpDelayHours = "0";
  draft.customerFollowUpDelayMinutes = "0";
  const validation = validateBookingSettingsDraft(draft, 2_000, 1, 7_200);
  assert.equal(validation.customerFollowUpDelayValid, false);
  assert.equal(validation.update, null);
});

test("settings equality includes delay, sequence length, scope, cooldown, and templates", () => {
  const settings = settingsFixture();
  const validation = validateBookingSettingsDraft(
    bookingSettingsToDraft(settings),
    2_000,
    1,
    7_200,
  );
  assert.ok(validation.update);
  assert.equal(bookingSettingsUpdateEquals(validation.update!, settings), true);
  assert.equal(
    bookingSettingsUpdateEquals(
      { ...validation.update!, customerFollowUpDelayMinutes: 1_500 },
      settings,
    ),
    false,
  );
  assert.equal(
    bookingSettingsUpdateEquals(
      { ...validation.update!, customerFollowUpMessageLimit: 4 },
      settings,
    ),
    false,
  );
  assert.equal(
    bookingSettingsUpdateEquals(
      { ...validation.update!, customerFollowUpLimitScope: "property" },
      settings,
    ),
    false,
  );
  assert.equal(
    bookingSettingsUpdateEquals(
      { ...validation.update!, adminCustomerWhatsAppCooldownMinutes: 0 },
      settings,
    ),
    false,
  );
  assert.equal(
    bookingSettingsUpdateEquals(
      {
        ...validation.update!,
        whatsappTemplates: {
          ...validation.update!.whatsappTemplates,
          admin_customer_technical_support: "نص تقني مخصص",
        },
      },
      settings,
    ),
    false,
  );
});

test("settings model reads schema-v4 hours and prefers canonical minutes during rollout", () => {
  const current = settingsFixture();
  const legacy: BookingCommissionSettings = {
    ...current,
    customerFollowUpDelayMinutes: undefined,
    customerFollowUpDelayHours: 36,
  };
  const legacyDraft = bookingSettingsToDraft(legacy);
  assert.equal(legacyDraft.customerFollowUpDelayHours, "36");
  assert.equal(legacyDraft.customerFollowUpDelayMinutes, "0");
  const legacyValidation = validateBookingSettingsDraft(legacyDraft, 2_000);
  assert.ok(legacyValidation.update);
  assert.equal(
    bookingSettingsUpdateEquals(legacyValidation.update!, legacy),
    true,
  );

  const transitional: BookingCommissionSettings = {
    ...current,
    customerFollowUpDelayMinutes: 90,
    customerFollowUpDelayHours: 1.5,
  };
  const transitionalDraft = bookingSettingsToDraft(transitional);
  assert.equal(transitionalDraft.customerFollowUpDelayHours, "1");
  assert.equal(transitionalDraft.customerFollowUpDelayMinutes, "30");
});

test("template preview substitutes sample commission percentage only once", () => {
  const preview = previewBookingTemplate("عمولة روقان ({{commissionPercent}}%): {{commissionAmountSar}} ريال");
  assert.equal(preview, "عمولة روقان (10%): 100 ريال");
  assert.doesNotMatch(preview, /%%/);

  const paymentPreview = previewBookingTemplate("رابط الدفع: {{paymentLink}}");
  assert.equal(paymentPreview, "رابط الدفع: https://rwqan.sa/p/RwqanPay01");
});
