import { z } from "zod";

export const OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATE_MAX_LENGTH = 2_000 as const;

export const OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATE_PLACEHOLDERS = {
  activated: ["propertyName", "propertyNumber", "endDate"],
  expiringSoon: [
    "propertyName",
    "propertyNumber",
    "daysLeft",
    "renewalLink",
  ],
  expired: ["propertyName", "propertyNumber", "renewalLink"],
} as const;

export type OwnerSubscriptionWhatsAppTemplateKey =
  keyof typeof OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATE_PLACEHOLDERS;

export const DEFAULT_OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATES = {
  activated: `مرحبا بك في نظام روقـان للعقارات

تم تفعيل اشتراكك للعقار {{propertyName}} رقم {{propertyNumber}}

صالح حتى {{endDate}}

شكرا لثقتك بنا`,
  expiringSoon: `مرحبا بك في نظام روقـان للعقارات

اشتراك عقارك {{propertyName}} رقم {{propertyNumber}} ينتهي خلال {{daysLeft}} ايام

جدد الان للحفاظ على ظهورك المميز
{{renewalLink}}`,
  expired: `مرحبا بك في نظام روقـان للعقارات

انتهى اشتراك عقارك {{propertyName}} رقم {{propertyNumber}}

تم تحويله للعرض العادي

جدد الان لاستعادة المميزات
{{renewalLink}}`,
} as const;

const placeholderPattern = /\{\{([a-z][A-Za-z0-9]*)\}\}/g;
const unsupportedControlPattern =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function templateSchemaFor(key: OwnerSubscriptionWhatsAppTemplateKey) {
  const required = (
    OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATE_PLACEHOLDERS[key]
  ) as readonly string[];
  const allowed = new Set(required);

  return z.string()
    .min(1)
    .max(OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATE_MAX_LENGTH)
    .superRefine((template, context) => {
      if (!template.trim()) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "WhatsApp template cannot be blank",
        });
      }
      if (unsupportedControlPattern.test(template)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "WhatsApp template contains unsupported control characters",
        });
      }

      const placeholders = Array.from(
        template.matchAll(placeholderPattern),
        (match) => match[1],
      );
      if (/[{}]/.test(template.replace(placeholderPattern, ""))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "WhatsApp template contains malformed placeholder syntax",
        });
      }
      for (const placeholder of placeholders) {
        if (!allowed.has(placeholder)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Placeholder {{${placeholder}}} is not allowed for ${key}`,
          });
        }
      }
      for (const placeholder of required) {
        const occurrences = placeholders.filter(
          (value) => value === placeholder,
        ).length;
        if (occurrences !== 1) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Placeholder {{${placeholder}}} must appear exactly once for ${key}`,
          });
        }
      }
    });
}

export const ownerSubscriptionWhatsAppTemplatesSchema = z.object({
  activated: templateSchemaFor("activated"),
  expiringSoon: templateSchemaFor("expiringSoon"),
  expired: templateSchemaFor("expired"),
}).strict();

export type OwnerSubscriptionWhatsAppTemplates = z.infer<
  typeof ownerSubscriptionWhatsAppTemplatesSchema
>;

type OwnerSubscriptionWhatsAppTemplateValues = {
  [Key in OwnerSubscriptionWhatsAppTemplateKey]: Record<
    typeof OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATE_PLACEHOLDERS[Key][number],
    string | number
  >;
};

/** Plain-text replacement only: templates are never evaluated as code or HTML. */
export function renderOwnerSubscriptionWhatsAppTemplate<
  Key extends OwnerSubscriptionWhatsAppTemplateKey,
>(
  key: Key,
  rawTemplate: string,
  values: OwnerSubscriptionWhatsAppTemplateValues[Key],
): string {
  const template = ownerSubscriptionWhatsAppTemplatesSchema.shape[key]
    .parse(rawTemplate);
  return template.replace(placeholderPattern, (_token, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(values, name)) {
      throw new RangeError(`Missing WhatsApp template value: ${name}`);
    }
    return String((values as Record<string, string | number>)[name]);
  });
}

/**
 * Firestore and legacy stores may contain a missing, partial, or older object.
 * Preserve each valid stored template and fall back only the invalid fields.
 */
export function normalizeStoredOwnerSubscriptionWhatsAppTemplates(
  value: unknown,
): OwnerSubscriptionWhatsAppTemplates {
  const stored = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

  const activated = ownerSubscriptionWhatsAppTemplatesSchema.shape.activated
    .safeParse(stored.activated);
  const expiringSoon =
    ownerSubscriptionWhatsAppTemplatesSchema.shape.expiringSoon
      .safeParse(stored.expiringSoon);
  const expired = ownerSubscriptionWhatsAppTemplatesSchema.shape.expired
    .safeParse(stored.expired);

  return {
    activated: activated.success
      ? activated.data
      : DEFAULT_OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATES.activated,
    expiringSoon: expiringSoon.success
      ? expiringSoon.data
      : DEFAULT_OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATES.expiringSoon,
    expired: expired.success
      ? expired.data
      : DEFAULT_OWNER_SUBSCRIPTION_WHATSAPP_TEMPLATES.expired,
  };
}
