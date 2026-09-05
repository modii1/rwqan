export const BOOKING_SETTINGS_LIMIT_KEYS = [
  "customerDailyLimit",
  "freeOwnerDailyLimit",
  "freePropertyContactDailyLimit",
] as const;

export type BookingSettingsLimitKey =
  typeof BOOKING_SETTINGS_LIMIT_KEYS[number];

export const BOOKING_CUSTOMER_FOLLOW_UP_LIMIT_SCOPES = [
  "customer",
  "property",
] as const;

const BOOKING_CUSTOMER_RESPONSE_WINDOW_MINUTES = 7 * 24 * 60;

export type BookingCustomerFollowUpLimitScope =
  typeof BOOKING_CUSTOMER_FOLLOW_UP_LIMIT_SCOPES[number];

export const BOOKING_WHATSAPP_TEMPLATE_KEYS = [
  "admin_customer_technical_support",
  "customer_followup",
  "customer_final_reminder",
  "owner_contact_limit_reached",
  "owner_booking_facts",
  "owner_booking_commission",
  "commission_reminder",
  "property_paused",
  "property_released_paid",
  "property_released_waived",
  "commission_dispute_rejected",
] as const;

export type BookingWhatsAppTemplateKey =
  typeof BOOKING_WHATSAPP_TEMPLATE_KEYS[number];

export type BookingWhatsAppTemplates = Record<
  BookingWhatsAppTemplateKey,
  string
>;

export interface BookingCommissionSettings {
  customerFollowUpDelayMinutes?: number;
  /** Deprecated schema-v4/API response field used during rolling deploys. */
  customerFollowUpDelayHours?: number;
  customerDailyLimit: number;
  freeOwnerDailyLimit: number;
  freePropertyContactDailyLimit: number;
  customerFollowUpMessageLimit: number;
  /** Missing on legacy responses; those safely use the customer-wide scope. */
  customerFollowUpLimitScope?: BookingCustomerFollowUpLimitScope;
  adminCustomerWhatsAppCooldownMinutes: number;
  whatsappTemplates: BookingWhatsAppTemplates;
  optionalCommissionReminderDays: Array<3 | 4>;
  updatedAt: string | null;
  updatedBy: "admin" | "environment";
  source: "firestore" | "environment";
}

export interface BookingCommissionFixedPolicy {
  customerFollowUpDelayMinMinutes: number;
  customerFollowUpDelayMaxMinutes: number;
  /** Deprecated API response fields used by cached schema-v4 admin clients. */
  customerFollowUpDelayMinHours?: number;
  customerFollowUpDelayMaxHours?: number;
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
  customerFollowUpDelayHours: string;
  customerFollowUpDelayMinutes: string;
  customerFollowUpMessageLimit: string;
  customerFollowUpLimitScope: BookingCustomerFollowUpLimitScope;
  adminCustomerWhatsAppCooldownMinutes: string;
  limits: Record<BookingSettingsLimitKey, string>;
  whatsappTemplates: BookingWhatsAppTemplates;
  optionalCommissionReminderDays: Array<3 | 4>;
}

export interface BookingCommissionSettingsUpdate {
  customerFollowUpDelayMinutes: number;
  customerFollowUpMessageLimit: number;
  customerFollowUpLimitScope: BookingCustomerFollowUpLimitScope;
  adminCustomerWhatsAppCooldownMinutes: number;
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
    key: "admin_customer_technical_support",
    label: "التواصل التقني مع العميل",
    description: "القالب الجاهز الذي يفتحه المشرف للتواصل التقني مع العميل.",
    placeholders: [],
  },
  {
    key: "customer_followup",
    label: "متابعة العميل",
    description: "تُرسل مرة واحدة بعد المدة المحددة لطلب التواصل مع العقار المجاني.",
    placeholders: ["propertyLabel", "followUpLink"],
  },
  {
    key: "customer_final_reminder",
    label: "المتابعة الأخيرة للعميل",
    description: "تُرسل بعد اكتمال عدد رسائل متابعة العميل وعدم استلام رد.",
    placeholders: [],
  },
  {
    key: "owner_contact_limit_reached",
    label: "بلوغ حد طلبات التواصل",
    description: "تُرسل لمالك العقار المجاني عند بلوغ الحد اليومي لطلبات التواصل.",
    placeholders: ["propertyNumber", "dailyLimit", "renewalLink"],
  },
  {
    key: "owner_booking_facts",
    label: "حقائق الحجز للمالك",
    description: "تُرسل للمالك عند تسجيل الحجز من دون مطالبة عمولة.",
    placeholders: [
      "propertyName",
      "propertyNumber",
      "requestCode",
      "customerPhone",
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
      "requestCode",
      "customerPhone",
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
  {
    key: "commission_dispute_rejected",
    label: "رفض الاعتراض واستئناف التحصيل",
    description: "تُرسل للمالك تلقائياً عند رفض الاعتراض.",
    placeholders: [
      "propertyName",
      "propertyNumber",
      "commissionAmountSar",
      "commissionDueAt",
      "paymentLink",
    ],
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
  followUpLink: "https://rwqan.sa/b/RwqanEx123",
  propertyName: "الريف المائي",
  propertyNumber: "13383",
  dailyLimit: "3",
  renewalLink: "https://rwqan.sa/r",
  requestCode: "REQ-13383-001",
  customerPhone: "+966500000002",
  timing: "نهاية الأسبوع",
  bookingDate: "20 أغسطس 2026",
  pricePaidSar: "1,000",
  commissionPercent: "10",
  commissionAmountSar: "100",
  paymentWindowDays: "5",
  paymentLink: "https://rwqan.sa/p/RwqanPay01",
  reminderDay: "3",
  commissionDueAt: "25 أغسطس 2026، 03:00 م",
};

function parseBookingSettingsInteger(
  value: string,
  minimum: number,
  maximum: number,
): number | null {
  const normalized = value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null;
}

export function parseBookingSettingsLimit(value: string): number | null {
  return parseBookingSettingsInteger(value, 0, 1_000);
}

export function parseCustomerFollowUpLimitScope(
  value: unknown,
): BookingCustomerFollowUpLimitScope | null {
  return value === "customer" || value === "property" ? value : null;
}

export function parseCustomerFollowUpDelayHours(
  value: string,
  maximum = 120,
): number | null {
  return parseBookingSettingsInteger(value, 0, maximum);
}

export function parseCustomerFollowUpDelayMinutesPart(
  value: string,
): number | null {
  return parseBookingSettingsInteger(value, 0, 59);
}

export function parseCustomerFollowUpDelayMinutes(
  hoursValue: string,
  minutesValue: string,
  minimum = 1,
  maximum = 7_200,
): number | null {
  const hours = parseCustomerFollowUpDelayHours(
    hoursValue,
    Math.ceil(maximum / 60),
  );
  const minutes = parseCustomerFollowUpDelayMinutesPart(minutesValue);
  if (hours === null || minutes === null) return null;
  const total = hours * 60 + minutes;
  return total >= minimum && total <= maximum ? total : null;
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
  const currentMinutes = settings.customerFollowUpDelayMinutes;
  const legacyHours = settings.customerFollowUpDelayHours;
  const totalDelayMinutes = typeof currentMinutes === "number" &&
      Number.isSafeInteger(currentMinutes) &&
      currentMinutes >= 1 && currentMinutes <= 7_200
    ? currentMinutes
    : typeof legacyHours === "number" &&
        Number.isSafeInteger(legacyHours) &&
        legacyHours >= 1 && legacyHours <= 120
      ? legacyHours * 60
      : 1_440;
  return {
    customerFollowUpDelayHours: String(Math.floor(totalDelayMinutes / 60)),
    customerFollowUpDelayMinutes: String(totalDelayMinutes % 60),
    customerFollowUpMessageLimit: String(
      settings.customerFollowUpMessageLimit ?? settings.customerDailyLimit,
    ),
    customerFollowUpLimitScope:
      parseCustomerFollowUpLimitScope(settings.customerFollowUpLimitScope) ||
      "customer",
    adminCustomerWhatsAppCooldownMinutes: String(
      settings.adminCustomerWhatsAppCooldownMinutes ?? 30,
    ),
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
    (placeholder) => {
      const count = counts.get(placeholder);
      return key === "owner_contact_limit_reached" && placeholder === "dailyLimit"
        ? count !== 1 && count !== 2
        : count !== 1;
    },
  );
  if (duplicate) {
    return key === "owner_contact_limit_reached" && duplicate === "dailyLimit"
      ? `المتغير {{${duplicate}}} يجب أن يظهر مرة أو مرتين فقط.`
      : `المتغير {{${duplicate}}} يجب أن يظهر مرة واحدة فقط.`;
  }
  return null;
}

export function validateBookingSettingsDraft(
  draft: BookingCommissionSettingsDraft,
  maxTemplateLength: number,
  customerFollowUpDelayMinMinutes = 1,
  customerFollowUpDelayMaxMinutes = 7_200,
): {
  update: BookingCommissionSettingsUpdate | null;
  templateErrors: Partial<Record<BookingWhatsAppTemplateKey, string>>;
  limitsValid: boolean;
  customerFollowUpDelayValid: boolean;
  workflowControlsValid: boolean;
} {
  const parsedLimits = parseBookingSettingsLimits(draft.limits);
  const customerFollowUpDelayMinutes = parseCustomerFollowUpDelayMinutes(
    draft.customerFollowUpDelayHours,
    draft.customerFollowUpDelayMinutes,
    customerFollowUpDelayMinMinutes,
    customerFollowUpDelayMaxMinutes,
  );
  const customerFollowUpMessageLimit = parseBookingSettingsLimit(
    draft.customerFollowUpMessageLimit,
  );
  const customerFollowUpLimitScope = parseCustomerFollowUpLimitScope(
    draft.customerFollowUpLimitScope,
  );
  const adminCustomerWhatsAppCooldownMinutes = parseBookingSettingsInteger(
    draft.adminCustomerWhatsAppCooldownMinutes,
    0,
    10_080,
  );
  const followUpScheduleFitsResponseWindow =
    customerFollowUpDelayMinutes !== null &&
    customerFollowUpMessageLimit !== null &&
    (customerFollowUpMessageLimit === 0 ||
      customerFollowUpDelayMinutes * customerFollowUpMessageLimit <
        BOOKING_CUSTOMER_RESPONSE_WINDOW_MINUTES);
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
    parsedLimits &&
    customerFollowUpDelayMinutes !== null &&
    customerFollowUpMessageLimit !== null &&
    followUpScheduleFitsResponseWindow &&
    customerFollowUpLimitScope !== null &&
    adminCustomerWhatsAppCooldownMinutes !== null &&
    remindersValid &&
    Object.keys(templateErrors).length === 0,
  );
  return {
    update: valid && parsedLimits && customerFollowUpDelayMinutes !== null &&
        customerFollowUpMessageLimit !== null &&
        followUpScheduleFitsResponseWindow &&
        customerFollowUpLimitScope !== null &&
        adminCustomerWhatsAppCooldownMinutes !== null
      ? {
          ...parsedLimits,
          customerFollowUpDelayMinutes,
          customerFollowUpMessageLimit,
          customerFollowUpLimitScope,
          adminCustomerWhatsAppCooldownMinutes,
          whatsappTemplates: { ...draft.whatsappTemplates },
          optionalCommissionReminderDays: [...draft.optionalCommissionReminderDays]
            .sort((left, right) => left - right),
        }
      : null,
    templateErrors,
    limitsValid: Boolean(parsedLimits),
    customerFollowUpDelayValid: customerFollowUpDelayMinutes !== null,
    workflowControlsValid:
      customerFollowUpMessageLimit !== null &&
      followUpScheduleFitsResponseWindow &&
      customerFollowUpLimitScope !== null &&
      adminCustomerWhatsAppCooldownMinutes !== null,
  };
}

export function bookingSettingsUpdateEquals(
  left: BookingCommissionSettingsUpdate,
  right: BookingCommissionSettings,
): boolean {
  const rightDelay = bookingSettingsToDraft(right);
  const rightDelayMinutes = parseCustomerFollowUpDelayMinutes(
    rightDelay.customerFollowUpDelayHours,
    rightDelay.customerFollowUpDelayMinutes,
  );
  return left.customerFollowUpDelayMinutes === rightDelayMinutes &&
    left.customerFollowUpMessageLimit === right.customerFollowUpMessageLimit &&
    left.customerFollowUpLimitScope ===
      (parseCustomerFollowUpLimitScope(right.customerFollowUpLimitScope) ||
        "customer") &&
    left.adminCustomerWhatsAppCooldownMinutes ===
      right.adminCustomerWhatsAppCooldownMinutes &&
    BOOKING_SETTINGS_LIMIT_KEYS.every((key) => left[key] === right[key]) &&
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
