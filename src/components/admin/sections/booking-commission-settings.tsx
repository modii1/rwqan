"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Save, Settings2 } from "lucide-react";
import { bookingApiRequest } from "@/components/booking/booking-api";
import { formatDateTime } from "@/components/booking/booking-display";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type LimitKey =
  | "customerDailyLimit"
  | "freeOwnerDailyLimit"
  | "freePropertyContactDailyLimit";

interface BookingCommissionSettings {
  customerDailyLimit: number;
  freeOwnerDailyLimit: number;
  freePropertyContactDailyLimit: number;
  updatedAt: string | null;
  updatedBy: "admin" | "environment";
  source: "firestore" | "environment";
}

interface BookingCommissionSettingsPayload {
  settings: BookingCommissionSettings;
}

type SettingsDraft = Record<LimitKey, string>;

const EMPTY_DRAFT: SettingsDraft = {
  customerDailyLimit: "",
  freeOwnerDailyLimit: "",
  freePropertyContactDailyLimit: "",
};

const LIMIT_FIELDS: Array<{
  key: LimitKey;
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

function toDraft(settings: BookingCommissionSettings): SettingsDraft {
  return {
    customerDailyLimit: String(settings.customerDailyLimit),
    freeOwnerDailyLimit: String(settings.freeOwnerDailyLimit),
    freePropertyContactDailyLimit: String(settings.freePropertyContactDailyLimit),
  };
}

function parseLimit(value: string): number | null {
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

export function parseBookingCommissionSettingsDraft(
  draft: SettingsDraft,
): Pick<BookingCommissionSettings, LimitKey> | null {
  const customerDailyLimit = parseLimit(draft.customerDailyLimit);
  const freeOwnerDailyLimit = parseLimit(draft.freeOwnerDailyLimit);
  const freePropertyContactDailyLimit = parseLimit(draft.freePropertyContactDailyLimit);
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

export default function BookingCommissionSettingsCard() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<SettingsDraft>(EMPTY_DRAFT);
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
    if (query.data?.settings) setDraft(toDraft(query.data.settings));
  }, [query.data?.settings]);

  const parsedDraft = useMemo(
    () => parseBookingCommissionSettingsDraft(draft),
    [draft],
  );
  const changed = Boolean(parsedDraft && query.data?.settings && LIMIT_FIELDS.some(
    ({ key }) => parsedDraft[key] !== query.data?.settings[key],
  ));

  const save = async () => {
    if (!parsedDraft) {
      setSaveError("أدخل أعداداً صحيحة من 0 إلى 1000 لكل حد.");
      setSaveNotice("");
      return;
    }
    setSaving(true);
    setSaveError("");
    setSaveNotice("");
    try {
      const result = await bookingApiRequest<BookingCommissionSettingsPayload>(
        "/api/admin/booking-commissions/settings",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: parsedDraft }),
        },
      );
      queryClient.setQueryData(["/api/admin/booking-commissions/settings"], result);
      setDraft(toDraft(result.settings));
      setSaveNotice("تم حفظ حدود العقارات المجانية وتطبيقها على العمليات الجديدة.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "تعذر حفظ الإعدادات. حاول مرة أخرى.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="overflow-hidden border-[#d8c795]" data-testid="booking-commission-settings">
      <div className="flex flex-col gap-3 border-b bg-[#fffaf0] p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div>
          <div className="flex items-center gap-2 text-[#7b5d1f]">
            <Settings2 className="h-5 w-5" aria-hidden="true" />
            <h2 className="font-bold">إعدادات متابعة العقارات المجانية</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            تحكم في الحدود اليومية للرسائل وطلبات التواصل. القيمة 0 توقف الفئة المحددة.
          </p>
        </div>
        <Button asChild type="button" size="sm" variant="outline" className="w-fit">
          <Link href="/admin/feature-flags">إدارة تشغيل الميزة</Link>
        </Button>
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        {query.isLoading ? (
          <div className="flex min-h-24 items-center justify-center" role="status" aria-label="جاري تحميل إعدادات المتابعة">
            <Loader2 className="h-6 w-6 animate-spin text-[#8b6b25]" />
          </div>
        ) : query.isError || !query.data ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-bold">تعذر تحميل إعدادات المتابعة</p>
            <Button type="button" size="sm" variant="outline" onClick={() => query.refetch()} className="mt-3">
              إعادة المحاولة
            </Button>
          </div>
        ) : (
          <>
            <div className="grid gap-3 lg:grid-cols-3">
              {LIMIT_FIELDS.map((field) => (
                <label key={field.key} htmlFor={`booking-setting-${field.key}`} className="rounded-xl border bg-muted/10 p-4">
                  <span className="text-sm font-bold text-[#34332f]">{field.label}</span>
                  <span className="mt-1 block min-h-10 text-xs leading-5 text-muted-foreground">{field.description}</span>
                  <Input
                    id={`booking-setting-${field.key}`}
                    type="text"
                    inputMode="numeric"
                    value={draft[field.key]}
                    onChange={(event) => {
                      setDraft((current) => ({ ...current, [field.key]: event.target.value }));
                      setSaveError("");
                      setSaveNotice("");
                    }}
                    aria-invalid={draft[field.key] !== "" && parseLimit(draft[field.key]) === null}
                    className="mt-3 text-center text-lg font-bold"
                    dir="ltr"
                    data-testid={`input-${field.key}`}
                  />
                </label>
              ))}
            </div>

            <div className="grid gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <FixedRule label="النطاق" value="العقارات المجانية فقط" />
              <FixedRule label="العمولة" value="10% من المبلغ المبلغ عنه" />
              <FixedRule label="مهلة الرد" value="7 أيام" />
              <FixedRule label="مهلة السداد" value="5 أيام · تذكير 3، 4، 5" />
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs leading-5 text-muted-foreground">
                <p>متابعة العميل تبدأ بعد 24 ساعة. يوم الحجز أو نوعه لا يغيّر نسبة العمولة.</p>
                <p>إشعارات الدفع والتذكير والإيقاف وإعادة التفعيل إلزامية ولا تدخل ضمن حدود الرسائل أعلاه.</p>
                <p className="mt-1">
                  آخر تحديث: {query.data.settings.updatedAt ? formatDateTime(query.data.settings.updatedAt) : "إعدادات البيئة الافتراضية"}
                </p>
              </div>
              <Button
                type="button"
                onClick={() => void save()}
                disabled={saving || !parsedDraft || !changed}
                className="w-full gap-2 sm:w-auto"
                data-testid="button-save-booking-settings"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                حفظ الحدود
              </Button>
            </div>
            {saveNotice && (
              <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800" role="status">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                {saveNotice}
              </p>
            )}
            {saveError && <p className="rounded-lg bg-red-50 p-3 text-sm font-medium text-destructive" role="alert">{saveError}</p>}
          </>
        )}
      </div>
    </Card>
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
