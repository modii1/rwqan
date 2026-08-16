"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Loader2,
  PauseCircle,
  RefreshCw,
  ShieldAlert,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  BookingPageHeader,
  BookingPageShell,
  QuestionnaireFacts,
  StatusBadge,
  formatDateTime,
  formatSarFromHalalas,
  getCommissionStatusMeta,
  getComplianceStatusMeta,
  type BookingQuestionnaire,
} from "./booking-display";
import { BookingApiError, bookingApiRequest } from "./booking-api";
import { getOwnerCommissionViewState } from "./booking-commission-state";

interface CommissionDetails {
  id: string;
  propertyNumber: string;
  propertyName?: string | null;
  questionnaire?: BookingQuestionnaire | null;
  commissionAmountHalalas?: number | null;
  dueAt?: string | null;
  commissionStatus?: string | null;
  complianceStatus?: string | null;
  checkoutAvailable?: boolean;
  disputeStatus?: "none" | "pending" | "accepted" | "rejected" | null;
  disputedAt?: string | null;
}

interface CommissionPayload {
  commission: CommissionDetails;
}

function normalized(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function safeCheckoutUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "https:" || (url.protocol === "http:" && process.env.NODE_ENV !== "production")
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export default function BookingCommissionClient({ token }: { token: string }) {
  const [pendingMethod, setPendingMethod] = useState<"cards" | "applepay" | null>(null);
  const [showDispute, setShowDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputePending, setDisputePending] = useState(false);
  const [disputedLocally, setDisputedLocally] = useState(false);
  const [actionError, setActionError] = useState("");

  const query = useQuery<CommissionPayload>({
    queryKey: ["booking-commission", token],
    queryFn: () => bookingApiRequest<CommissionPayload>(`/api/booking-commissions/${encodeURIComponent(token)}`),
    enabled: Boolean(token),
    retry: false,
    refetchOnWindowFocus: true,
  });

  const commission = query.data?.commission;
  const commissionStatus = normalized(commission?.commissionStatus);
  const disputeStatus = normalized(commission?.disputeStatus);
  const viewState = getOwnerCommissionViewState({
    commissionStatus,
    disputeStatus,
    disputedLocally,
  });
  const paid = viewState === "paid";
  const disputed = viewState === "dispute_pending";
  const disputeAccepted = viewState === "waived";
  const disputeRejected = viewState === "dispute_rejected";
  const paused = ["paused", "suspended", "property_paused", "موقوف"].includes(normalized(commission?.complianceStatus));

  const startCheckout = async (paymentMethod: "cards" | "applepay") => {
    setActionError("");
    setPendingMethod(paymentMethod);
    try {
      const response = await bookingApiRequest<{ checkoutUrl?: string }>(
        `/api/booking-commissions/${encodeURIComponent(token)}/checkout`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentMethod }),
        },
      );
      const checkoutUrl = safeCheckoutUrl(response.checkoutUrl);
      if (!checkoutUrl) throw new Error("تعذر فتح رابط الدفع الآمن.");
      try {
        window.sessionStorage.setItem(
          "rwqan-booking-commission-return",
          `/booking-commission/${encodeURIComponent(token)}`,
        );
      } catch {
        // Storage can be disabled without preventing payment.
      }
      window.location.assign(checkoutUrl);
    } catch (error) {
      if (error instanceof BookingApiError && error.status === 409) {
        await query.refetch();
      }
      setActionError(error instanceof Error ? error.message : "تعذر إنشاء رابط الدفع. حاول مرة أخرى.");
      setPendingMethod(null);
    }
  };

  const submitDispute = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError("");
    const reason = disputeReason.trim();
    if (!reason) {
      setActionError("اكتب سبب الاعتراض قبل الإرسال.");
      return;
    }
    setDisputePending(true);
    try {
      await bookingApiRequest<Record<string, unknown>>(
        `/api/booking-commissions/${encodeURIComponent(token)}/dispute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );
      setDisputedLocally(true);
      setShowDispute(false);
      void query.refetch();
    } catch (error) {
      if (error instanceof BookingApiError && error.status === 409) {
        const refreshed = await query.refetch();
        if (
          normalized(refreshed.data?.commission.disputeStatus) === "pending"
          || normalized(refreshed.data?.commission.commissionStatus) === "disputed"
        ) {
          setDisputedLocally(true);
          setShowDispute(false);
          return;
        }
      }
      setActionError(error instanceof Error ? error.message : "تعذر إرسال الاعتراض. حاول مرة أخرى.");
    } finally {
      setDisputePending(false);
    }
  };

  if (query.isLoading) {
    return (
      <BookingPageShell>
        <div className="flex min-h-[420px] items-center justify-center" role="status" aria-label="جاري تحميل العمولة">
          <div className="text-center text-muted-foreground">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#8b6b25]" />
            <p className="mt-3 text-sm">جاري تحميل تفاصيل العمولة...</p>
          </div>
        </div>
      </BookingPageShell>
    );
  }

  if (query.isError || !commission) {
    const unavailable = query.error instanceof BookingApiError && [404, 410].includes(query.error.status);
    return (
      <BookingPageShell>
        <Card className="mx-auto max-w-xl p-6 text-center sm:p-8">
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-600" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-bold text-[#34332f]">{unavailable ? "رابط العمولة غير متاح" : "تعذر تحميل تفاصيل العمولة"}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {unavailable ? "قد يكون الرابط منتهياً أو غير صالح لهذا الطلب." : "تحقق من اتصالك ثم حاول مرة أخرى."}
          </p>
          {!unavailable && (
            <Button type="button" variant="outline" onClick={() => query.refetch()} className="mt-5 gap-2">
              <RefreshCw className="h-4 w-4" />
              إعادة المحاولة
            </Button>
          )}
        </Card>
      </BookingPageShell>
    );
  }

  const commissionMeta = getCommissionStatusMeta(commission.commissionStatus);
  const complianceMeta = getComplianceStatusMeta(commission.complianceStatus);
  const propertyLabel = String(commission.propertyName || "").trim() || `عقار رقم ${commission.propertyNumber}`;

  if (paid) {
    return (
      <BookingPageShell>
        <BookingPageHeader
          eyebrow="عمولة الحجز"
          title="تم سداد العمولة"
          description="تم تأكيد الدفع ولا توجد خطوة مطلوبة لهذا الحجز."
        />
        <Card className="border-emerald-200 p-6 text-center sm:p-8">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-bold text-[#34332f]">{propertyLabel}</h2>
          <p className="mt-2 text-2xl font-bold text-emerald-700">{formatSarFromHalalas(commission.commissionAmountHalalas)}</p>
          <Button asChild variant="outline" className="mt-5">
            <Link href="/owner/dashboard">العودة إلى لوحة المالك</Link>
          </Button>
        </Card>
      </BookingPageShell>
    );
  }

  if (disputeAccepted) {
    return (
      <BookingPageShell>
        <BookingPageHeader
          eyebrow="عمولة الحجز"
          title="تم إلغاء العمولة"
          description="تم قبول الاعتراض وإغلاق العمولة، ولا توجد خطوة دفع مطلوبة لهذا الحجز."
        />
        <Card className="border-emerald-200 p-6 text-center sm:p-8">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-bold text-[#34332f]">{propertyLabel}</h2>
          {commission.disputedAt && <p className="mt-2 text-xs text-muted-foreground">تاريخ الاعتراض: {formatDateTime(commission.disputedAt)}</p>}
          <Button asChild variant="outline" className="mt-5">
            <Link href="/owner/dashboard">العودة إلى لوحة المالك</Link>
          </Button>
        </Card>
      </BookingPageShell>
    );
  }

  return (
    <BookingPageShell>
      <BookingPageHeader
        eyebrow="عمولة الحجز"
        title="تفاصيل العمولة المستحقة"
        description="راجع بيانات الحجز ثم أكمل السداد خلال المهلة الموضحة أدناه."
      />

      {paused && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800" role="alert">
          <PauseCircle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold">العقار موقوف حالياً</p>
            <p className="mt-1 text-xs leading-5">أكمل السداد لتحديث حالة الالتزام ومتابعة إعادة التفعيل.</p>
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="border-b bg-[#fffaf0] p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-[#34332f]">{propertyLabel}</h2>
              <p className="mt-1 text-xs text-muted-foreground">رقم العقار: {commission.propertyNumber}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge label={commissionMeta.label} tone={commissionMeta.tone} />
              <StatusBadge label={complianceMeta.label} tone={complianceMeta.tone} />
            </div>
          </div>
        </div>

        <div className="space-y-6 p-5 sm:p-6">
          <section aria-labelledby="commission-booking-facts">
            <h3 id="commission-booking-facts" className="mb-3 text-sm font-bold text-[#34332f]">بيانات الحجز المبلغ عنها</h3>
            <QuestionnaireFacts questionnaire={commission.questionnaire} />
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[#dbc793] bg-[#fff9e9] p-4">
              <p className="text-xs font-semibold text-[#7b682f]">العمولة المستحقة (10%)</p>
              <p className="mt-2 text-2xl font-bold text-[#6f5417]">{formatSarFromHalalas(commission.commissionAmountHalalas)}</p>
            </div>
            <div className="rounded-xl border bg-muted/20 p-4">
              <p className="text-xs font-semibold text-muted-foreground">آخر موعد للسداد</p>
              <p className="mt-2 text-sm font-bold text-[#34332f]">{formatDateTime(commission.dueAt)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">تبدأ المهلة عندما يقبل مزود واتساب إشعار العمولة للإرسال، ومدتها خمسة أيام.</p>
            </div>
          </div>

          {disputed ? (
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-violet-800">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
                <div>
                  <p className="text-sm font-bold">تم تسجيل الاعتراض</p>
                  <p className="mt-1 text-xs leading-5">سيظهر الاعتراض للإدارة للمراجعة قبل متابعة إجراءات الالتزام.</p>
                  {commission.disputedAt && <p className="mt-1 text-[11px]">{formatDateTime(commission.disputedAt)}</p>}
                </div>
              </div>
            </div>
          ) : (
            <>
              {disputeRejected && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800" role="status">
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-bold">تم رفض الاعتراض</p>
                      <p className="mt-1 text-xs leading-5">عادت العمولة للتحصيل، ويمكنك إكمال السداد من الخيارات أدناه.</p>
                      {commission.disputedAt && <p className="mt-1 text-[11px]">تاريخ الاعتراض: {formatDateTime(commission.disputedAt)}</p>}
                    </div>
                  </div>
                </div>
              )}
              {commission.checkoutAvailable ? (
                <section aria-labelledby="payment-method-title">
                  <h3 id="payment-method-title" className="text-sm font-bold text-[#34332f]">اختر طريقة الدفع</h3>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Button
                      type="button"
                      onClick={() => void startCheckout("cards")}
                      disabled={pendingMethod !== null || disputePending}
                      className="h-12 gap-2"
                      data-testid="button-commission-pay-cards"
                    >
                      {pendingMethod === "cards" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                      الدفع بالبطاقة
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void startCheckout("applepay")}
                      disabled={pendingMethod !== null || disputePending}
                      className="h-12 gap-2 border-slate-300"
                      data-testid="button-commission-pay-applepay"
                    >
                      {pendingMethod === "applepay" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
                      Apple Pay
                    </Button>
                  </div>
                </section>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  رابط الدفع غير متاح حالياً. حاول لاحقاً أو راجع حالة الطلب.
                </div>
              )}

              {!disputeRejected && <div className="border-t pt-5">
                {!showDispute ? (
                  <Button type="button" variant="ghost" onClick={() => setShowDispute(true)} className="text-violet-700 hover:bg-violet-50 hover:text-violet-800">
                    الاعتراض على بيانات الحجز
                  </Button>
                ) : (
                  <form onSubmit={submitDispute} className="rounded-xl border border-violet-200 bg-violet-50/50 p-4">
                    <label htmlFor="commission-dispute-reason" className="text-sm font-bold text-violet-900">سبب الاعتراض</label>
                    <Textarea
                      id="commission-dispute-reason"
                      value={disputeReason}
                      onChange={(event) => setDisputeReason(event.target.value)}
                      placeholder="اشرح سبب الاعتراض باختصار..."
                      maxLength={500}
                      className="mt-2 min-h-24 bg-white"
                      data-testid="input-commission-dispute-reason"
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button type="submit" disabled={disputePending || pendingMethod !== null} className="bg-violet-700 hover:bg-violet-800">
                        {disputePending && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                        إرسال الاعتراض
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setShowDispute(false)} disabled={disputePending}>إلغاء</Button>
                    </div>
                  </form>
                )}
              </div>}
            </>
          )}

          {actionError && <p className="rounded-lg bg-red-50 p-3 text-sm font-medium text-destructive" role="alert">{actionError}</p>}
        </div>
      </Card>
    </BookingPageShell>
  );
}
