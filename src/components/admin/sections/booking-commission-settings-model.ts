export const BOOKING_SETTINGS_LIMIT_KEYS = [
  "customerDailyLimit",
  "freeOwnerDailyLimit",
  "freePropertyContactDailyLimit",
] as const;

export type BookingSettingsLimitKey =
  typeof BOOKING_SETTINGS_LIMIT_KEYS[number];

export const BOOKING_WHATSAPP_TEMPLATE_KEYS = [
  "customer_followup",
  "owner_booking_facts",
  "owner_booking_commission",
  "commission_reminder",
  "property_paused",
  "property_released_paid",
  "property_released_waived",
] as const;

export type BookingWhatsAppTemplateKey =
  typeof BOOKING_WHATSAPP_TEMPLATE_KEYS[number];

export type BookingWhatsAppTemplates = Record<
  BookingWhatsAppTemplateKey,
  string
>;

export interface BookingCommissionSettings {
  customerDailyLimit: number;
  freeOwnerDailyLimit: number;
  freePropertyContactDailyLimit: number;
  whatsappTemplates: BookingWhatsAppTemplates;
  optionalCommissionReminderDays: Array<3 | 4>;
  updatedAt: string | null;
  updatedBy: "admin" | "environment";
  source: "firestore" | "environment";
}

export interface BookingCommissionFixedPolicy {
  customerFollowUpDelayHours: 24;
  commissionPaymentWindowDays: 5;
  mandatoryCommissionReminderDays: [5] | readonly [5];
  allowedOptionalCommissionReminderDays: Array<3 | 4> | readonly (3 | 4)[];
  templateSyntaxVersion: 1;
  templateMaxLength: number;
}

export interface BookingCommissionOperationalHealth {
  whatsappProviderConfigured: boolean;
  workerSecretConfigured: boolean;
  publicBaseUrlConfigured: boolean;
  publicBaseUrlValid: boolean;
}

export interface BookingCommissionSettingsPayload {
  settings: BookingCommissionSettings;
  fixedPolicy: BookingCommissionFixedPolicy;
  operationalHealth: BookingCommissionOperationalHealth;
}

export interface BookingCommissionSettingsDraft {
  limits: Record<BookingSettingsLimitKey, string>;
  whatsappTemplates: BookingWhatsAppTemplates;
  optionalCommissionReminderDays: Array<3 | 4>;
}

export interface BookingCommissionSettingsUpdate {
  customerDailyLimit: number;
  freeOwnerDailyLimit: number;
  freePropertyContactDailyLimit: number;
  whatsappTemplates: BookingWhatsAppTemplates;
  optionalCommissionReminderDays: Array<3 | 4>;
}

export interface BookingTemplateDefinition {
  key: BookingWhatsAppTemplateKey;
  label: string;
  description: string;
  placeholders: readonly string[];
}

export const BOOKING_TEMPLATE_DEFINITIONS: readonly BookingTemplateDefinition[] = [
  {
    key: "customer_followup",
    label: "متابعة العميل",
    description: "تُرسل مرة واحدة بعد 24 ساعة من قبول طلب التواصل.",
    placeholders: ["propertyLabel", "followUpLink"],
  },
  {
    key: "owner_booking_facts",
    label: "حقائق الحجز للمالك",
    description: "تُرسل للمالك عند تسجيل الحجز من دون مطالبة عمولة.",
    placeholders: [
      "propertyName",
      "propertyNumber",
      "timing",
      "bookingDate",
      "pricePaidSar",
    ],
  },
  {
    key: "owner_booking_commission",
    label: "الحجز ومطالبة العمولة",
    description: "تتضمن حقائق الحجز والعمولة ورابط السداد.",
    placeholders: [
      "propertyName",
      "propertyNumber",
      "timing",
      "bookingDate",
      "pricePaidSar",
      "commissionPercent",
      "commissionAmountSar",
      "paymentWindowDays",
      "paymentLink",
    ],
  },
  {
    key: "commission_reminder",
    label: "تذكير العمولة",
    description: "قالب واحد لتذكيرات اليوم الثالث والرابع والخامس.",
    placeholders: [
      "reminderDay",
      "propertyName",
      "propertyNumber",
      "commissionAmountSar",
      "commissionDueAt",
      "paymentLink",
    ],
  },
  {
    key: "property_paused",
    label: "إيقاف العقار",
    description: "تُرسل بعد انتهاء مهلة السداد من دون دفع.",
    placeholders: [
      "propertyName",
      "propertyNumber",
      "commissionAmountSar",
      "paymentLink",
    ],
  },
  {
    key: "property_released_paid",
    label: "إعادة الإتاحة بعد السداد",
    description: "تؤكد استلام العمولة وإعادة إتاحة العقار.",
    placeholders: ["propertyName", "propertyNumber"],
  },
  {
    key: "property_released_waived",
    label: "إعادة الإتاحة بعد الإعفاء",
    description: "تؤكد قبول الاعتراض وإعادة إتاحة العقار.",
    placeholders: ["propertyName", "propertyNumber"],
  },
] as const;

const TEMPLATE_DEFINITION_BY_KEY = new Map(
  BOOKING_TEMPLATE_DEFINITIONS.map((definition) => [definition.key, definition]),
);

const PLACEHOLDER_PATTERN = /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g;
const UNSUPPORTED_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const PREVIEW_VALUES: Record<string, string> = {
  propertyLabel: "العقار الريف المائي رقم 13383",
  followUpLink: "https://rwqan.sa/booking/example",
  propertyName: "الريف المائي",
  propertyNumber: "13383",
  timing: "نهاية الأسبوع",
  bookingDate: "20 أغسطس 2026",
  pricePaidSar: "1,000",
  commissionPercent: "10",
  commissionAmountSar: "100",
  paymentWindowDays: "5",
  paymentLink: "https://rwqan.sa/booking-commission/example",
  reminderDay: "3",
  commissionDueAt: "25 أغسطس 2026، 03:00 م",
};

export function parseBookingSettingsLimit(value: string): number | null {
  const normalized = value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 1_000
    ? parsed
    : null;
}

export function parseBookingSettingsLimits(
  limits: Record<BookingSettingsLimitKey, string>,
): Record<BookingSettingsLimitKey, number> | null {
  const customerDailyLimit = parseBookingSettingsLimit(limits.customerDailyLimit);
  const freeOwnerDailyLimit = parseBookingSettingsLimit(limits.freeOwnerDailyLimit);
  const freePropertyContactDailyLimit = parseBookingSettingsLimit(
    limits.freePropertyContactDailyLimit,
  );
  if (
    customerDailyLimit === null ||
    freeOwnerDailyLimit === null ||
    freePropertyContactDailyLimit === null
  ) return null;
  return {
    customerDailyLimit,
    freeOwnerDailyLimit,
    freePropertyContactDailyLimit,
  };
}

export function bookingSettingsToDraft(
  settings: BookingCommissionSettings,
): BookingCommissionSettingsDraft {
  return {
    limits: {
      customerDailyLimit: String(settings.customerDailyLimit),
      freeOwnerDailyLimit: String(settings.freeOwnerDailyLimit),
      freePropertyContactDailyLimit: String(settings.freePropertyContactDailyLimit),
    },
    whatsappTemplates: { ...settings.whatsappTemplates },
    optionalCommissionReminderDays: [...settings.optionalCommissionReminderDays]
      .sort((left, right) => left - right),
  };
}

export function validateBookingTemplate(
  key: BookingWhatsAppTemplateKey,
  template: string,
  maxLength: number,
): string | null {
  if (!template.trim()) return "لا يمكن ترك قالب الرسالة فارغاً.";
  if (template.length > maxLength) {
    return `تجاوز القالب الحد الأقصى البالغ ${maxLength} حرفاً.`;
  }
  if (UNSUPPORTED_CONTROL_CHARACTER_PATTERN.test(template)) {
    return "يحتوي القالب على محارف تحكم غير مدعومة.";
  }

  const definition = TEMPLATE_DEFINITION_BY_KEY.get(key);
  if (!definition) return "قالب غير معروف.";
  const matches = [...template.matchAll(PLACEHOLDER_PATTERN)];
  const withoutValidPlaceholders = template.replace(PLACEHOLDER_PATTERN, "");
  if (withoutValidPlaceholders.includes("{") || withoutValidPlaceholders.includes("}")) {
    return "يوجد متغير مكتوب بصيغة غير صحيحة. استخدم {{variableName}} كما هو ظاهر أدناه.";
  }

  const counts = new Map<string, number>();
  for (const match of matches) {
    const placeholder = match[1];
    counts.set(placeholder, (counts.get(placeholder) || 0) + 1);
  }
  const unknown = [...counts.keys()].find(
    (placeholder) => !definition.placeholders.includes(placeholder),
  );
  if (unknown) return `المتغير {{${unknown}}} غير مسموح في هذا القالب.`;

  const missing = definition.placeholders.find(
    (placeholder) => !counts.has(placeholder),
  );
  if (missing) return `المتغير {{${missing}}} مطلوب مرة واحدة.`;

  const duplicate = definition.placeholders.find(
    (placeholder) => counts.get(placeholder) !== 1,
  );
  if (duplicate) return `المتغير {{${duplicate}}} يجب أن يظهر مرة واحدة فقط.`;
  return null;
}

export function validateBookingSettingsDraft(
  draft: BookingCommissionSettingsDraft,
  maxTemplateLength: number,
): {
  update: BookingCommissionSettingsUpdate | null;
  templateErrors: Partial<Record<BookingWhatsAppTemplateKey, string>>;
  limitsValid: boolean;
} {
  const parsedLimits = parseBookingSettingsLimits(draft.limits);
  const templateErrors: Partial<Record<BookingWhatsAppTemplateKey, string>> = {};
  for (const key of BOOKING_WHATSAPP_TEMPLATE_KEYS) {
    const error = validateBookingTemplate(
      key,
      draft.whatsappTemplates[key],
      maxTemplateLength,
    );
    if (error) templateErrors[key] = error;
  }
  const remindersValid = draft.optionalCommissionReminderDays.every(
    (day) => day === 3 || day === 4,
  ) && new Set(draft.optionalCommissionReminderDays).size ===
    draft.optionalCommissionReminderDays.length;
  const valid = Boolean(
    parsedLimits && remindersValid && Object.keys(templateErrors).length === 0,
  );
  return {
    update: valid && parsedLimits
      ? {
          ...parsedLimits,
          whatsappTemplates: { ...draft.whatsappTemplates },
          optionalCommissionReminderDays: [...draft.optionalCommissionReminderDays]
            .sort((left, right) => left - right),
        }
      : null,
    templateErrors,
    limitsValid: Boolean(parsedLimits),
  };
}

export function bookingSettingsUpdateEquals(
  left: BookingCommissionSettingsUpdate,
  right: BookingCommissionSettings,
): boolean {
  return BOOKING_SETTINGS_LIMIT_KEYS.every((key) => left[key] === right[key]) &&
    BOOKING_WHATSAPP_TEMPLATE_KEYS.every(
      (key) => left.whatsappTemplates[key] === right.whatsappTemplates[key],
    ) &&
    [...left.optionalCommissionReminderDays].sort().join(",") ===
      [...right.optionalCommissionReminderDays].sort().join(",");
}

export function previewBookingTemplate(template: string): string {
  return template.replace(PLACEHOLDER_PATTERN, (token, placeholder: string) =>
    PREVIEW_VALUES[placeholder] ?? token);
}
