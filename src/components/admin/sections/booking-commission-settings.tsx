"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageSquareText,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { bookingApiRequest } from "@/components/booking/booking-api";
import { formatDateTime } from "@/components/booking/booking-display";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  BOOKING_TEMPLATE_DEFINITIONS,
  bookingSettingsToDraft,
  bookingSettingsUpdateEquals,
  parseBookingSettingsLimit,
  parseBookingSettingsLimits,
  previewBookingTemplate,
  validateBookingSettingsDraft,
  type BookingCommissionOperationalHealth,
  type BookingCommissionSettingsDraft,
  type BookingCommissionSettingsPayload,
  type BookingSettingsLimitKey,
} from "./booking-commission-settings-model";

type LegacySettingsDraft = Record<BookingSettingsLimitKey, string>;

const EMPTY_LIMITS: LegacySettingsDraft = {
  customerDailyLimit: "",
  freeOwnerDailyLimit: "",
  freePropertyContactDailyLimit: "",
};

const EMPTY_TEMPLATES = Object.fromEntries(
  BOOKING_TEMPLATE_DEFINITIONS.map(({ key }) => [key, ""]),
) as BookingCommissionSettingsDraft["whatsappTemplates"];

const EMPTY_DRAFT: BookingCommissionSettingsDraft = {
  customerFollowUpDelayHours: "24",
  customerFollowUpDelayMinutes: "0",
  limits: EMPTY_LIMITS,
  whatsappTemplates: EMPTY_TEMPLATES,
  optionalCommissionReminderDays: [],
};

const LIMIT_FIELDS: Array<{
  key: BookingSettingsLimitKey;
  label: string;
  description: string;
}> = [
  {
    key: "customerDailyLimit",
    label: "رسائل متابعة العميل يومياً",
    description: "الحد لكل رقم عميل، ويشمل رسالة السؤال عن نتيجة الحجز.",
  },
  {
    key: "freeOwnerDailyLimit",
    label: "إشعارات الحجز للمالك يومياً",
    description: "الحد لكل مالك للعقارات المجانية، ويشمل إرسال حقائق الحجز الجديدة.",
  },
  {
    key: "freePropertyContactDailyLimit",
    label: "طلبات التواصل للعقار يومياً",
    description: "عدد طلبات واتساب المقبولة لكل عقار مجاني خلال يوم الرياض.",
  },
];

/** Kept as a public helper for the existing limit-field tests and consumers. */
export function parseBookingCommissionSettingsDraft(
  draft: LegacySettingsDraft,
): Record<BookingSettingsLimitKey, number> | null {
  return parseBookingSettingsLimits(draft);
}

export default function BookingCommissionSettingsCard() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<BookingCommissionSettingsDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");

  const query = useQuery<BookingCommissionSettingsPayload>({
    queryKey: ["/api/admin/booking-commissions/settings"],
    queryFn: () => bookingApiRequest<BookingCommissionSettingsPayload>(
      "/api/admin/booking-commissions/settings",
    ),
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (query.data?.settings) setDraft(bookingSettingsToDraft(query.data.settings));
  }, [query.data?.settings]);

  const validation = useMemo(
    () => validateBookingSettingsDraft(
      draft,
      query.data?.fixedPolicy.templateMaxLength || 2_000,
      query.data?.fixedPolicy.customerFollowUpDelayMinMinutes || 1,
      query.data?.fixedPolicy.customerFollowUpDelayMaxMinutes || 7_200,
    ),
    [
      draft,
      query.data?.fixedPolicy.customerFollowUpDelayMaxMinutes,
      query.data?.fixedPolicy.customerFollowUpDelayMinMinutes,
      query.data?.fixedPolicy.templateMaxLength,
    ],
  );
  const changed = Boolean(
    validation.update &&
    query.data?.settings &&
    !bookingSettingsUpdateEquals(validation.update, query.data.settings),
  );

  const clearMessages = () => {
    setSaveError("");
    setSaveNotice("");
  };

  const resetDraft = () => {
    if (!query.data?.settings) return;
    setDraft(bookingSettingsToDraft(query.data.settings));
    clearMessages();
  };

  const save = async () => {
    if (!validation.update) {
      setSaveError(
        !validation.customerFollowUpDelayValid
          ? "أدخل مدة متابعة صحيحة من دقيقة واحدة إلى 120 ساعة."
          : validation.limitsValid
            ? "راجع قوالب الرسائل المطلوبة قبل الحفظ."
            : "أدخل أعداداً صحيحة من 0 إلى 1000 لكل حد.",
      );
      setSaveNotice("");
      return;
    }
    setSaving(true);
    clearMessages();
    try {
      const result = await bookingApiRequest<BookingCommissionSettingsPayload>(
        "/api/admin/booking-commissions/settings",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: validation.update }),
        },
      );
      queryClient.setQueryData(
        ["/api/admin/booking-commissions/settings"],
        result,
      );
      setDraft(bookingSettingsToDraft(result.settings));
      setSaveNotice("تم حفظ إعدادات متابعة العقارات المجانية.");
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "تعذر حفظ الإعدادات. حاول مرة أخرى.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      className="overflow-hidden border-[#d8c795]"
      data-testid="booking-commission-settings"
    >
      <div className="flex flex-col gap-3 border-b bg-[#fffaf0] p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div>
          <div className="flex items-center gap-2 text-[#7b5d1f]">
            <Settings2 className="h-5 w-5" aria-hidden="true" />
            <h2 className="font-bold">إعدادات متابعة العقارات المجانية</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            تحكم في موعد متابعة العميل والحدود اليومية للرسائل وطلبات التواصل. القيمة 0 توقف الفئة المحددة.
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            ويمكنك أيضاً تخصيص قوالب واتساب واختيار تذكيرات اليوم الثالث والرابع.
          </p>
        </div>
        <Button asChild type="button" size="sm" variant="outline" className="w-fit">
          <Link href="/admin/feature-flags">إدارة تشغيل الميزة</Link>
        </Button>
      </div>

      <div className="space-y-6 p-4 sm:p-5">
        {query.isLoading ? (
          <div
            className="flex min-h-24 items-center justify-center"
            role="status"
            aria-label="جاري تحميل إعدادات المتابعة"
          >
            <Loader2 className="h-6 w-6 animate-spin text-[#8b6b25]" />
          </div>
        ) : query.isError || !query.data ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-bold">تعذر تحميل إعدادات المتابعة</p>
            <p className="mt-1 text-xs leading-5">
              تحقق من اتصال الخادم ثم أعد المحاولة. لا يتم تغيير أي إعداد عند فشل التحميل.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => query.refetch()}
              className="mt-3"
            >
              إعادة المحاولة
            </Button>
          </div>
        ) : (
          <>
            <OperationalHealthPanel health={query.data.operationalHealth} />

            <section aria-labelledby="booking-fixed-policy-heading">
              <div className="mb-3 flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-[#7b5d1f]" aria-hidden="true" />
                <h3 id="booking-fixed-policy-heading" className="text-sm font-bold">
                  المواعيد والسياسة الثابتة
                </h3>
              </div>
              <div className="grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 sm:grid-cols-2 lg:grid-cols-4">
                <FixedRule label="النطاق" value="العقارات المجانية فقط" />
                <FixedRule label="العمولة" value="10% من المبلغ المبلغ عنه" />
                <FixedRule label="مهلة الرد" value="7 أيام" />
                <FixedRule label="مهلة السداد" value="5 أيام · تذكير 3، 4، 5" />
                <FixedRule
                  label="نافذة الدفع الثابتة"
                  value={`${query.data.fixedPolicy.commissionPaymentWindowDays} أيام · ثابتة`}
                />
                <FixedRule
                  label="التذكير الإلزامي"
                  value={`اليوم ${query.data.fixedPolicy.mandatoryCommissionReminderDays.join("، ")} · ثابت`}
                />
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                العمولة 10% من المبلغ الذي يبلّغ عنه العميل. إعداد تأخير المتابعة أدناه مستقل عن مهلة السداد الثابتة.
              </p>
            </section>

            <section aria-labelledby="booking-followup-delay-heading">
              <h3 id="booking-followup-delay-heading" className="mb-3 text-sm font-bold">
                موعد متابعة العميل
              </h3>
              <div className="block rounded-xl border bg-muted/10 p-4">
                <span className="text-sm font-bold text-[#34332f]">
                  تأخير إرسال متابعة العميل (بالساعات والدقائق)
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                  القيمة الافتراضية 24 ساعة.
                </span>
                <div className="mt-3 grid max-w-sm grid-cols-2 gap-3">
                  <label htmlFor="booking-setting-customerFollowUpDelayHours">
                    <span className="block text-xs font-semibold text-muted-foreground">الساعات</span>
                    <Input
                      id="booking-setting-customerFollowUpDelayHours"
                      type="text"
                      inputMode="numeric"
                      value={draft.customerFollowUpDelayHours}
                      onChange={(event) => {
                        setDraft((current) => ({
                          ...current,
                          customerFollowUpDelayHours: event.target.value,
                        }));
                        clearMessages();
                      }}
                      aria-invalid={
                        draft.customerFollowUpDelayHours !== "" &&
                        draft.customerFollowUpDelayMinutes !== "" &&
                        !validation.customerFollowUpDelayValid
                      }
                      aria-describedby="booking-setting-help-customerFollowUpDelay"
                      className="mt-1 text-center text-lg font-bold"
                      dir="ltr"
                      data-testid="input-customerFollowUpDelayHours"
                    />
                  </label>
                  <label htmlFor="booking-setting-customerFollowUpDelayMinutes">
                    <span className="block text-xs font-semibold text-muted-foreground">الدقائق</span>
                    <Input
                      id="booking-setting-customerFollowUpDelayMinutes"
                      type="text"
                      inputMode="numeric"
                      value={draft.customerFollowUpDelayMinutes}
                      onChange={(event) => {
                        setDraft((current) => ({
                          ...current,
                          customerFollowUpDelayMinutes: event.target.value,
                        }));
                        clearMessages();
                      }}
                      aria-invalid={
                        draft.customerFollowUpDelayMinutes !== "" &&
                        draft.customerFollowUpDelayHours !== "" &&
                        !validation.customerFollowUpDelayValid
                      }
                      aria-describedby="booking-setting-help-customerFollowUpDelay"
                      className="mt-1 text-center text-lg font-bold"
                      dir="ltr"
                      data-testid="input-customerFollowUpDelayMinutes"
                    />
                  </label>
                </div>
                <span
                  id="booking-setting-help-customerFollowUpDelay"
                  className="mt-2 block text-[11px] leading-5 text-muted-foreground"
                >
                  من دقيقة واحدة إلى {query.data.fixedPolicy.customerFollowUpDelayMaxMinutes / 60} ساعة. يُطبّق فقط على طلبات التواصل الجديدة المقبولة للعقارات المجانية. تبقى الرسائل المجدولة سابقاً كما هي.
                </span>
              </div>
            </section>

            <section aria-labelledby="booking-limits-heading">
              <h3 id="booking-limits-heading" className="mb-3 text-sm font-bold">
                الحدود اليومية
              </h3>
              <div className="grid gap-3 lg:grid-cols-3">
                {LIMIT_FIELDS.map((field) => (
                  <label
                    key={field.key}
                    htmlFor={`booking-setting-${field.key}`}
                    className="rounded-xl border bg-muted/10 p-4"
                  >
                    <span className="text-sm font-bold text-[#34332f]">{field.label}</span>
                    <span className="mt-1 block min-h-10 text-xs leading-5 text-muted-foreground">
                      {field.description}
                    </span>
                    <Input
                      id={`booking-setting-${field.key}`}
                      type="text"
                      inputMode="numeric"
                      value={draft.limits[field.key]}
                      onChange={(event) => {
                        setDraft((current) => ({
                          ...current,
                          limits: {
                            ...current.limits,
                            [field.key]: event.target.value,
                          },
                        }));
                        clearMessages();
                      }}
                      aria-invalid={
                        draft.limits[field.key] !== "" &&
                        parseBookingSettingsLimit(draft.limits[field.key]) === null
                      }
                      aria-describedby={`booking-setting-help-${field.key}`}
                      className="mt-3 text-center text-lg font-bold"
                      dir="ltr"
                      data-testid={`input-${field.key}`}
                    />
                    <span
                      id={`booking-setting-help-${field.key}`}
                      className="mt-2 block text-[11px] text-muted-foreground"
                    >
                      من 0 إلى 1000. القيمة 0 توقف هذه الفئة.
                    </span>
                  </label>
                ))}
              </div>
            </section>

            <ReminderDaysSection
              allowedDays={query.data.fixedPolicy.allowedOptionalCommissionReminderDays}
              selectedDays={draft.optionalCommissionReminderDays}
              mandatoryDays={query.data.fixedPolicy.mandatoryCommissionReminderDays}
              onChange={(days) => {
                setDraft((current) => ({
                  ...current,
                  optionalCommissionReminderDays: days,
                }));
                clearMessages();
              }}
            />

            <section aria-labelledby="booking-message-templates-heading">
              <div className="mb-1 flex items-center gap-2">
                <MessageSquareText className="h-4 w-4 text-[#7b5d1f]" aria-hidden="true" />
                <h3 id="booking-message-templates-heading" className="text-sm font-bold">
                  قوالب رسائل واتساب
                </h3>
              </div>
              <p className="mb-3 text-xs leading-5 text-muted-foreground">
                اكتب النص بحرية مع إبقاء كل متغير ظاهر أسفل القالب مرة واحدة. تُستبدل المتغيرات ببيانات الحجز عند الإرسال.
              </p>
              <Accordion
                type="multiple"
                defaultValue={["customer_followup"]}
                className="rounded-xl border px-4"
              >
                {BOOKING_TEMPLATE_DEFINITIONS.map((definition) => {
                  const template = draft.whatsappTemplates[definition.key];
                  const error = validation.templateErrors[definition.key];
                  return (
                    <AccordionItem
                      key={definition.key}
                      value={definition.key}
                      data-testid={`template-section-${definition.key}`}
                    >
                      <AccordionTrigger className="gap-3 text-right hover:no-underline">
                        <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                          <span>
                            <span className="block text-sm font-bold">{definition.label}</span>
                            <span className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                              {definition.description}
                            </span>
                          </span>
                          {error ? (
                            <span className="shrink-0 text-xs font-semibold text-destructive">
                              يحتاج مراجعة
                            </span>
                          ) : (
                            <CheckCircle2
                              className="h-4 w-4 shrink-0 text-emerald-600"
                              aria-label="القالب صالح"
                            />
                          )}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4">
                        <div>
                          <Textarea
                            id={`booking-template-${definition.key}`}
                            value={template}
                            onChange={(event) => {
                              setDraft((current) => ({
                                ...current,
                                whatsappTemplates: {
                                  ...current.whatsappTemplates,
                                  [definition.key]: event.target.value,
                                },
                              }));
                              clearMessages();
                            }}
                            aria-invalid={Boolean(error)}
                            aria-describedby={`booking-template-help-${definition.key}`}
                            className="min-h-40 resize-y whitespace-pre-wrap leading-6"
                            dir="rtl"
                            data-testid={`textarea-template-${definition.key}`}
                          />
                          <div
                            id={`booking-template-help-${definition.key}`}
                            className="mt-2 flex flex-wrap items-center gap-1.5"
                          >
                            <span className="ml-1 text-[11px] font-semibold text-muted-foreground">
                              المتغيرات المطلوبة:
                            </span>
                            {definition.placeholders.map((placeholder) => (
                              <code
                                key={placeholder}
                                className="rounded border bg-muted px-1.5 py-0.5 text-[11px]"
                                dir="ltr"
                              >
                                {`{{${placeholder}}}`}
                              </code>
                            ))}
                          </div>
                          <div className="mt-2 flex items-start justify-between gap-3 text-[11px]">
                            <p className={error ? "font-medium text-destructive" : "text-muted-foreground"}>
                              {error || "القالب صالح وجميع المتغيرات موجودة مرة واحدة."}
                            </p>
                            <span
                              className={
                                template.length > query.data.fixedPolicy.templateMaxLength
                                  ? "shrink-0 font-bold text-destructive"
                                  : "shrink-0 text-muted-foreground"
                              }
                              dir="ltr"
                            >
                              {template.length}/{query.data.fixedPolicy.templateMaxLength}
                            </span>
                          </div>
                        </div>
                        <div className="rounded-lg border bg-[#fcfbf7] p-3">
                          <p className="mb-2 text-[11px] font-bold text-[#7b5d1f]">
                            معاينة ببيانات تجريبية
                          </p>
                          <p className="whitespace-pre-wrap break-words text-sm leading-6">
                            {previewBookingTemplate(template)}
                          </p>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </section>

            <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs leading-5 text-muted-foreground">
                <p>موعد متابعة العميل المحدد لا يغيّر نسبة العمولة أو مهلة السداد.</p>
                <p>إشعارات الدفع والتذكير والإيقاف وإعادة التفعيل إلزامية ولا تدخل ضمن حدود الرسائل أعلاه.</p>
                <p>تُطبّق القوالب المحفوظة على كل رسالة لم تُرسل بعد، ولا تعيد إرسال الرسائل التي سبق إرسالها.</p>
                <p className="mt-1">
                  آخر تحديث: {query.data.settings.updatedAt
                    ? formatDateTime(query.data.settings.updatedAt)
                    : "إعدادات البيئة الافتراضية"}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetDraft}
                  disabled={saving || !changed}
                  className="gap-2"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  التراجع عن التعديلات
                </Button>
                <Button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || !validation.update || !changed}
                  className="gap-2"
                  data-testid="button-save-booking-settings"
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  حفظ الإعدادات
                </Button>
              </div>
            </div>
            {saveNotice && (
              <p
                className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800"
                role="status"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {saveNotice}
              </p>
            )}
            {saveError && (
              <p
                className="rounded-lg bg-red-50 p-3 text-sm font-medium text-destructive"
                role="alert"
              >
                {saveError}
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function OperationalHealthPanel({
  health,
}: {
  health: BookingCommissionOperationalHealth;
}) {
  const checks = [
    {
      key: "provider",
      label: "مزود واتساب",
      ready: health.whatsappProviderConfigured,
      warning: "بيانات مزود واتساب غير مكتملة؛ لن تُرسل الرسائل تلقائياً.",
    },
    {
      key: "base-url-configured",
      label: "رابط المنصة العام",
      ready: health.publicBaseUrlConfigured,
      warning: "رابط المنصة العام غير مضبوط؛ قد تشير روابط المتابعة والدفع إلى بيئة خاطئة.",
    },
    {
      key: "base-url-valid",
      label: "صلاحية رابط المنصة",
      ready: health.publicBaseUrlValid,
      warning: "رابط المنصة العام غير صالح للاستخدام في رسائل المتابعة والدفع.",
    },
  ];
  const allReady = checks.every((check) => check.ready);

  return (
    <section
      aria-labelledby="booking-operational-health-heading"
      className={
        allReady
          ? "rounded-xl border border-emerald-200 bg-emerald-50/70 p-4"
          : "rounded-xl border border-amber-300 bg-amber-50 p-4"
      }
      data-testid="booking-whatsapp-operational-health"
    >
      <div className="flex items-start gap-3">
        {allReady ? (
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
        ) : (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <h3 id="booking-operational-health-heading" className="text-sm font-bold">
            {allReady ? "إعدادات الإرسال مكتملة" : "إعدادات الإرسال تحتاج مراجعة"}
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            تعرض هذه اللوحة حالة الإعداد فقط، ولا تعرض المفاتيح أو القيم السرية.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {checks.map((check) => (
              <div
                key={check.key}
                className="flex items-center gap-2 rounded-lg border bg-white/80 px-3 py-2 text-xs font-semibold"
              >
                {check.ready ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                )}
                {check.label}
              </div>
            ))}
          </div>
          {!allReady && (
            <ul className="mt-3 space-y-1 text-xs leading-5 text-amber-900">
              {checks.filter((check) => !check.ready).map((check) => (
                <li key={check.key}>• {check.warning}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function ReminderDaysSection({
  allowedDays,
  selectedDays,
  mandatoryDays,
  onChange,
}: {
  allowedDays: readonly (3 | 4)[];
  selectedDays: Array<3 | 4>;
  mandatoryDays: readonly 5[];
  onChange: (days: Array<3 | 4>) => void;
}) {
  return (
    <section aria-labelledby="booking-reminder-days-heading">
      <h3 id="booking-reminder-days-heading" className="mb-1 text-sm font-bold">
        أيام تذكير العمولة
      </h3>
      <p className="mb-3 text-xs leading-5 text-muted-foreground">
        اختر التذكيرات الإضافية. تذكير اليوم الخامس إلزامي ويُرسل قبل إيقاف العقار.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {allowedDays.map((day) => {
          const checked = selectedDays.includes(day);
          return (
            <label
              key={day}
              htmlFor={`booking-reminder-day-${day}`}
              className="flex items-center justify-between gap-4 rounded-xl border bg-muted/10 p-4"
            >
              <span>
                <span className="block text-sm font-bold">اليوم {day}</span>
                <span className="mt-1 block text-xs text-muted-foreground">تذكير اختياري</span>
              </span>
              <Switch
                id={`booking-reminder-day-${day}`}
                checked={checked}
                onCheckedChange={(nextChecked) => {
                  const next = nextChecked
                    ? [...new Set([...selectedDays, day])]
                    : selectedDays.filter((selectedDay) => selectedDay !== day);
                  onChange(next.sort((left, right) => left - right) as Array<3 | 4>);
                }}
                aria-label={`إرسال تذكير العمولة في اليوم ${day}`}
                data-testid={`switch-reminder-day-${day}`}
              />
            </label>
          );
        })}
        {mandatoryDays.map((day) => (
          <div
            key={day}
            className="flex items-center justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4"
          >
            <span>
              <span className="block text-sm font-bold">اليوم {day}</span>
              <span className="mt-1 block text-xs text-emerald-800">تذكير إلزامي قبل الإيقاف</span>
            </span>
            <Switch
              checked
              disabled
              aria-label={`تذكير العمولة الإلزامي في اليوم ${day}`}
            />
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
        تُطبّق خيارات اليوم الثالث والرابع على الحجوزات التي تُؤكد أو تُعاد دورة تحصيلها بعد الحفظ. تبقى التذكيرات المجدولة سابقاً كما هي.
      </p>
    </section>
  );
}

function FixedRule({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-emerald-700">{label}</p>
      <p className="mt-1 text-sm font-bold text-emerald-900">{value}</p>
    </div>
  );
}
