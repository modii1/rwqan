import assert from "node:assert/strict";
import test from "node:test";
import { notificationSettingsSchema } from "./schema";
import {
  DEFAULT_OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATES,
  OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATE_MAX_LENGTH,
  normalizeStoredOwnerSubscriptionWhatsAppTemplates,
  ownerSubscriptionWhatsAppTemplatesSchema,
  renderOwnerSubscriptionWhatsAppTemplate,
} from "./subscription-whatsapp";

const validSettings = {
  allNotifications: true,
  newProperty: true,
  newSubscription: true,
  subscriptionRenewal: true,
  receiptUpload: true,
  propertyUpdate: true,
  newPayment: true,
  smartRequest: true,
  propertyVerification: true,
  subscriptionExpired: true,
  smartSchedule: {
    enabled: true,
    sendDays: ["Sunday", "Wednesday"],
    sendTimes: { Sunday: "09:00", Wednesday: "21:00" },
    batchSize: 10,
    slotIntervalMinutes: 60,
    dailyMaxRecipients: 50,
  },
};

test("admin WhatsApp notification settings accept the documented schedule", () => {
  const parsed = notificationSettingsSchema.parse(validSettings);
  assert.equal(parsed.smartSchedule?.dailyMaxRecipients, 50);
  assert.deepEqual(
    parsed.ownerSubscriptionWhatsAppTemplates,
    DEFAULT_OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATES,
  );
});

test("admin WhatsApp notification settings reject unsafe schedule values", () => {
  assert.equal(notificationSettingsSchema.safeParse({
    ...validSettings,
    smartSchedule: {
      ...validSettings.smartSchedule,
      sendTimes: { Sunday: "25:99", Wednesday: "21:00" },
    },
  }).success, false);
  assert.equal(notificationSettingsSchema.safeParse({
    ...validSettings,
    smartSchedule: {
      ...validSettings.smartSchedule,
      dailyMaxRecipients: 501,
    },
  }).success, false);
});

test("legacy notification settings receive byte-exact owner subscription defaults", () => {
  const templates = notificationSettingsSchema.parse(validSettings)
    .ownerSubscriptionWhatsAppTemplates;

  assert.equal(renderOwnerSubscriptionWhatsAppTemplate(
    "activated",
    templates.activated,
    {
      propertyName: "الريف المائي",
      propertyNumber: "13383",
      endDate: "2026-08-28",
    },
  ), `مرحبا بك في نظام روقـان للعقارات

تم تفعيل اشتراكك للعقار الريف المائي رقم 13383

صالح حتى 2026-08-28

شكرا لثقتك بنا`);

  assert.equal(renderOwnerSubscriptionWhatsAppTemplate(
    "expiringSoon",
    templates.expiringSoon,
    {
      propertyName: "الريف المائي",
      propertyNumber: "13383",
      daysLeft: 3,
      renewalLink: "https://rwqan.sa/r",
    },
  ), `مرحبا بك في نظام روقـان للعقارات

اشتراك عقارك الريف المائي رقم 13383 ينتهي خلال 3 ايام

جدد الان للحفاظ على ظهورك المميز
https://rwqan.sa/r`);

  assert.equal(renderOwnerSubscriptionWhatsAppTemplate(
    "expired",
    templates.expired,
    {
      propertyName: "الريف المائي",
      propertyNumber: "13383",
      renewalLink: "https://rwqan.sa/r",
    },
  ), `مرحبا بك في نظام روقـان للعقارات

انتهى اشتراك عقارك الريف المائي رقم 13383

تم تحويله للعرض العادي

جدد الان لاستعادة المميزات
https://rwqan.sa/r`);
});

test("owner subscription templates are strict and require each safe placeholder once", () => {
  assert.deepEqual(
    ownerSubscriptionWhatsAppTemplatesSchema.parse(
      DEFAULT_OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATES,
    ),
    DEFAULT_OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATES,
  );

  for (const activated of [
    "{{propertyName}} {{propertyNumber}}",
    "{{propertyName}} {{propertyNumber}} {{endDate}} {{endDate}}",
    "{{propertyName}} {{propertyNumber}} {{endDate}} {{unknown}}",
    "{propertyName} {{propertyNumber}} {{endDate}}",
    `{{propertyName}} {{propertyNumber}} {{endDate}} ${"x".repeat(
      OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATE_MAX_LENGTH,
    )}`,
    "{{propertyName}} {{propertyNumber}} {{endDate}}\u0007",
  ]) {
    assert.equal(ownerSubscriptionWhatsAppTemplatesSchema.safeParse({
      ...DEFAULT_OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATES,
      activated,
    }).success, false, activated.slice(0, 80));
  }

  assert.equal(ownerSubscriptionWhatsAppTemplatesSchema.safeParse({
    ...DEFAULT_OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATES,
    extra: "unexpected",
  }).success, false);
});

test("stored owner template normalization preserves valid fields and repairs only invalid ones", () => {
  const customActivated =
    "تم التفعيل: {{propertyName}} / {{propertyNumber}} / {{endDate}}";
  assert.deepEqual(normalizeStoredOwnerSubscriptionWhatsAppTemplates({
    activated: customActivated,
    expiringSoon: "invalid",
  }), {
    activated: customActivated,
    expiringSoon: DEFAULT_OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATES.expiringSoon,
    expired: DEFAULT_OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATES.expired,
  });

  const custom = {
    activated: customActivated,
    expiringSoon:
      "{{propertyName}} {{propertyNumber}} {{daysLeft}} {{renewalLink}}",
    expired: "{{propertyName}} {{propertyNumber}} {{renewalLink}}",
  };
  assert.deepEqual(
    notificationSettingsSchema.parse({
      ...validSettings,
      ownerSubscriptionWhatsAppTemplates: custom,
    }).ownerSubscriptionWhatsAppTemplates,
    custom,
  );
  assert.equal(notificationSettingsSchema.safeParse({
    ...validSettings,
    ownerSubscriptionWhatsAppTemplates: {
      ...custom,
      expired: "{{propertyName}} {{propertyNumber}}",
    },
  }).success, false);
});
