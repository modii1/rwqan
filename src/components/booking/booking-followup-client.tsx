"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarCheck2,
  Check,
  CheckCircle2,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  BookingPageHeader,
  BookingPageShell,
  type BookingDatePrecision,
  type BookingQuestionnaire,
  type BookingTiming,
  formatSarFromHalalas,
} from "./booking-display";
import { BookingApiError, bookingApiRequest } from "./booking-api";
import {
  isBookingDateSelectionValid,
  type BookingCalendar,
} from "./booking-calendar";
import { BookingDateInput } from "./booking-date-input";
import {
  buildBookingQuestionnairePayload,
  normalizeListedPriceOptionsHalalas,
  sarInputFromHalalas,
} from "./booking-price-options";
import { CustomerQuestionnaireFacts } from "./customer-questionnaire-facts";
import {
  broadcastCustomerBookingSessionChange,
  resetCustomerSessionQueries,
} from "@/hooks/use-contact-identity";

interface FollowupBooking {
  id: string;
  propertyNumber: string;
  propertyName?: string | null;
  bookingStatus?: string | null;
  questionnaire?: BookingQuestionnaire | null;
  answeredAt?: string | null;
  listedPriceOptionsHalalas?: number[] | null;
}

interface FollowupPayload {
  booking: FollowupBooking;
}

function normalizedStatus(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isDeclinedStatus(value: unknown): boolean {
  return ["declined", "not_booked", "no_booking", "لم_يتم_الحجز"].includes(normalizedStatus(value));
}

function isQuestionnairePendingStatus(value: unknown): boolean {
  return ["booked", "questionnaire_pending", "awaiting_questionnaire"].includes(normalizedStatus(value));
}

function isCompletedStatus(value: unknown): boolean {
  return ["confirmed", "completed", "reported", "booking_confirmed", "تم_التأكيد"].includes(normalizedStatus(value));
}

function propertyLabel(booking: FollowupBooking): string {
  return String(booking.propertyName || "").trim() || `عقار رقم ${booking.propertyNumber}`;
}

function normalizePriceInput(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",")
    .replace(/[^0-9.,]/g, "");
}

export default function BookingFollowupClient({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const [bookedLocally, setBookedLocally] = useState(false);
  const [declinedLocally, setDeclinedLocally] = useState(false);
  const [completedQuestionnaire, setCompletedQuestionnaire] = useState<BookingQuestionnaire | null>(null);
  const [timing, setTiming] = useState<BookingTiming | "">("");
  const [bookingDatePrecision, setBookingDatePrecision] = useState<BookingDatePrecision>("day");
  const [bookingDate, setBookingDate] = useState("");
  const [bookingDateCalendar, setBookingDateCalendar] = useState<BookingCalendar>("gregorian");
  const [pricePaidSar, setPricePaidSar] = useState("");
  const [priceChoice, setPriceChoice] = useState("");
  const [actionError, setActionError] = useState("");
  const [pendingAction, setPendingAction] = useState<"yes" | "no" | "confirm" | null>(null);

  const query = useQuery<FollowupPayload>({
    queryKey: ["booking-followup", token],
    queryFn: () => bookingApiRequest<FollowupPayload>(`/api/booking-followups/${encodeURIComponent(token)}`),
    enabled: Boolean(token),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!query.isSuccess || query.isFetching || query.dataUpdatedAt <= 0) return;
    void resetCustomerSessionQueries(queryClient);
    broadcastCustomerBookingSessionChange();
  }, [query.dataUpdatedAt, query.isFetching, query.isSuccess, queryClient, token]);

  const booking = query.data?.booking;
  const currentQuestionnaire = completedQuestionnaire || booking?.questionnaire || null;
  const completed = Boolean(
    completedQuestionnaire
    || booking?.answeredAt
    || booking?.questionnaire
    || isCompletedStatus(booking?.bookingStatus),
  );
  const declined = declinedLocally || isDeclinedStatus(booking?.bookingStatus);
  const showQuestions = bookedLocally || isQuestionnairePendingStatus(booking?.bookingStatus);
  const listedPriceOptionsHalalas = useMemo(
    () => normalizeListedPriceOptionsHalalas(booking?.listedPriceOptionsHalalas),
    [booking?.listedPriceOptionsHalalas],
  );
  const customPriceSelected = priceChoice === "custom" || listedPriceOptionsHalalas.length === 0;

  const amountIsValid = useMemo(() => {
    const normalized = pricePaidSar.replace(/,/g, "").trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return false;
    const amount = Number(normalized);
    return Number.isFinite(amount) && amount >= 1 && amount <= 1_000_000;
  }, [pricePaidSar]);

  const submitDecision = async (booked: boolean) => {
    setActionError("");
    setPendingAction(booked ? "yes" : "no");
    try {
      await bookingApiRequest<Partial<FollowupPayload>>(
        `/api/booking-followups/${encodeURIComponent(token)}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ booked }),
        },
      );
      if (booked) setBookedLocally(true);
      else setDeclinedLocally(true);
      void query.refetch();
    } catch (error) {
      if (error instanceof BookingApiError && error.status === 409) {
        const refreshed = await query.refetch();
        const refreshedStatus = refreshed.data?.booking.bookingStatus;
        if (
          (booked && (isQuestionnairePendingStatus(refreshedStatus) || isCompletedStatus(refreshedStatus)))
          || (!booked && isDeclinedStatus(refreshedStatus))
        ) {
          if (booked) setBookedLocally(true);
          else setDeclinedLocally(true);
          return;
        }
      }
      setActionError(error instanceof Error ? error.message : "تعذر حفظ الإجابة. حاول مرة أخرى.");
    } finally {
      setPendingAction(null);
    }
  };

  const submitQuestionnaire = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError("");
    if (!timing) {
      setActionError("اختر وقت الحجز للمتابعة.");
      return;
    }
    if (!isBookingDateSelectionValid(
      bookingDate,
      bookingDatePrecision,
      bookingDateCalendar,
    )) {
      setActionError("أدخل تاريخ الحجز بالصيغة المطلوبة.");
      return;
    }
    if (!amountIsValid) {
      setActionError("أدخل المبلغ المدفوع بشكل صحيح.");
      return;
    }

    setPendingAction("confirm");
    const submittedQuestionnaire: BookingQuestionnaire = buildBookingQuestionnairePayload({
      timing,
      bookingDate,
      bookingDatePrecision,
      bookingDateCalendar,
      pricePaidSar,
    });
    try {
      const response = await bookingApiRequest<Partial<FollowupPayload>>(
        `/api/booking-followups/${encodeURIComponent(token)}/confirm`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(submittedQuestionnaire),
        },
      );
      setCompletedQuestionnaire(response.booking?.questionnaire || submittedQuestionnaire);
      void query.refetch();
    } catch (error) {
      if (error instanceof BookingApiError && error.status === 409) {
        const refreshed = await query.refetch();
        if (
          refreshed.data?.booking.questionnaire
          || refreshed.data?.booking.answeredAt
          || isCompletedStatus(refreshed.data?.booking.bookingStatus)
        ) return;
      }
      setActionError(error instanceof Error ? error.message : "تعذر حفظ تفاصيل الحجز. حاول مرة أخرى.");
    } finally {
      setPendingAction(null);
    }
  };

  if (query.isLoading) {
    return (
      <BookingPageShell>
        <div className="flex min-h-[360px] items-center justify-center" role="status" aria-label="جاري تحميل طلب الحجز">
          <div className="text-center text-muted-foreground">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#8b6b25]" />
            <p className="mt-3 text-sm">جاري تحميل الطلب...</p>
          </div>
        </div>
      </BookingPageShell>
    );
  }

  if (query.isError || !booking) {
    const responseExpired = query.error instanceof BookingApiError
      && query.error.code === "BOOKING_RESPONSE_EXPIRED";
    const expired = query.error instanceof BookingApiError && [404, 410].includes(query.error.status);
    return (
      <BookingPageShell>
        <Card className="mx-auto max-w-xl p-6 text-center sm:p-8">
          <AlertTriangle className="mx-auto h-10 w-10 text-amber-600" aria-hidden="true" />
          <h1 className="mt-4 text-xl font-bold text-[#34332f]">{responseExpired ? "انتهت مهلة تأكيد الحجز" : expired ? "الرابط غير متاح" : "تعذر تحميل الطلب"}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {responseExpired
              ? "انتهت المهلة المتاحة لتأكيد نتيجة هذا الطلب."
              : expired
                ? "قد يكون الرابط منتهياً أو تم استخدامه مسبقاً."
                : "تحقق من اتصالك ثم حاول مرة أخرى."}
          </p>
          {!expired && (
            <Button type="button" variant="outline" onClick={() => query.refetch()} className="mt-5 gap-2">
              <RefreshCw className="h-4 w-4" />
              إعادة المحاولة
            </Button>
          )}
        </Card>
      </BookingPageShell>
    );
  }

  if (completed) {
    return (
      <BookingPageShell>
        <BookingPageHeader
          eyebrow="تأكيد الحجز"
          title="تم تسجيل تفاصيل الحجز"
          description="شكراً لك. تم حفظ الإجابات وربطها بطلب التواصل الصحيح."
        />
        <Card className="overflow-hidden border-emerald-200">
          <div className="bg-emerald-50 p-5 text-center sm:p-6">
            <CheckCircle2 className="mx-auto h-11 w-11 text-emerald-600" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-bold text-emerald-800">{propertyLabel(booking)}</h2>
            <p className="mt-1 text-xs text-emerald-700">رقم العقار: {booking.propertyNumber}</p>
          </div>
          <div className="p-5 sm:p-6">
            <CustomerQuestionnaireFacts questionnaire={currentQuestionnaire} />
            <Button asChild className="mt-6 w-full sm:w-auto">
              <Link href="/profile">عرض حجوزاتي</Link>
            </Button>
          </div>
        </Card>
      </BookingPageShell>
    );
  }

  if (declined) {
    return (
      <BookingPageShell>
        <BookingPageHeader
          eyebrow="متابعة طلب التواصل"
          title="تم تسجيل إجابتك"
          description="شكراً لتأكيد أن الحجز لم يتم. لن تحتاج إلى إدخال أي تفاصيل أخرى."
        />
        <Card className="p-6 text-center sm:p-8">
          <CheckCircle2 className="mx-auto h-11 w-11 text-emerald-600" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-bold text-[#34332f]">{propertyLabel(booking)}</h2>
          <p className="mt-1 text-sm text-muted-foreground">تم إغلاق متابعة هذا الطلب.</p>
          <Button asChild variant="outline" className="mt-5">
            <Link href="/">العودة إلى روقان</Link>
          </Button>
        </Card>
      </BookingPageShell>
    );
  }

  return (
    <BookingPageShell>
      <BookingPageHeader
        eyebrow="متابعة طلب التواصل"
        title={showQuestions ? "أكمل تفاصيل الحجز" : "هل تم الحجز؟"}
        description={showQuestions
          ? "ثلاثة أسئلة قصيرة تساعدنا على توثيق الحجز بدقة."
          : `نود التأكد من نتيجة تواصلك مع ${propertyLabel(booking)}.`}
      />

      {!showQuestions ? (
        <Card className="p-5 sm:p-7">
          <div className="rounded-xl border border-[#eadfca] bg-[#fffaf0] p-4 text-center">
            <CalendarCheck2 className="mx-auto h-8 w-8 text-[#8b6b25]" aria-hidden="true" />
            <p className="mt-3 font-bold text-[#34332f]">{propertyLabel(booking)}</p>
            <p className="mt-1 text-xs text-muted-foreground">رقم العقار: {booking.propertyNumber}</p>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3" aria-label="اختر نتيجة التواصل">
            <Button
              type="button"
              onClick={() => void submitDecision(true)}
              disabled={pendingAction !== null}
              className="h-12 gap-2 bg-emerald-600 hover:bg-emerald-700"
              data-testid="button-booking-yes"
            >
              {pendingAction === "yes" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              نعم، تم الحجز
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void submitDecision(false)}
              disabled={pendingAction !== null}
              className="h-12 gap-2 border-slate-300"
              data-testid="button-booking-no"
            >
              {pendingAction === "no" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
              لا، لم يتم
            </Button>
          </div>
          {actionError && <p className="mt-4 text-center text-sm font-medium text-destructive" role="alert">{actionError}</p>}
        </Card>
      ) : (
        <Card className="p-5 sm:p-7">
          <form onSubmit={submitQuestionnaire} className="space-y-7" noValidate>
            <fieldset>
              <legend className="text-base font-bold text-[#34332f]">
                <span className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#f2e8cd] text-sm text-[#7b5d1f]">1</span>
                متى كان الحجز؟
              </legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {([
                  ["midweek", "وسط الأسبوع"],
                  ["weekend", "نهاية الأسبوع"],
                  ["other", "وقت آخر"],
                ] as const).map(([value, label]) => (
                  <label key={value} className={`cursor-pointer rounded-lg border p-3 text-center text-sm font-semibold transition focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ${timing === value ? "border-[#b88d2b] bg-[#fff8e7] text-[#76571b]" : "border-border hover:bg-muted/40"}`}>
                    <input
                      type="radio"
                      name="timing"
                      value={value}
                      checked={timing === value}
                      onChange={() => setTiming(value)}
                      className="sr-only"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset>
              <legend className="text-base font-bold text-[#34332f]">
                <span className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#f2e8cd] text-sm text-[#7b5d1f]">2</span>
                ما تاريخ الحجز؟
              </legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
                <div className="grid grid-cols-2 rounded-lg border bg-muted/20 p-1" aria-label="دقة التاريخ">
                  {([
                    ["day", "يوم محدد"],
                    ["month", "الشهر فقط"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setBookingDatePrecision(value);
                        setBookingDate("");
                      }}
                      aria-pressed={bookingDatePrecision === value}
                      className={`rounded-md px-2 py-2 text-xs font-semibold ${bookingDatePrecision === value ? "bg-white text-[#76571b] shadow-sm" : "text-muted-foreground"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <BookingDateInput
                  value={bookingDate}
                  precision={bookingDatePrecision}
                  selectionCalendar={bookingDateCalendar}
                  onChange={(nextValue, nextCalendar) => {
                    setBookingDate(nextValue);
                    setBookingDateCalendar(nextCalendar);
                  }}
                />
              </div>
            </fieldset>

            <fieldset>
              <legend id="booking-price-question" className="text-base font-bold text-[#34332f]">
                <span className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#f2e8cd] text-sm text-[#7b5d1f]">3</span>
                كم كان المبلغ المدفوع؟
              </legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-labelledby="booking-price-question">
                {listedPriceOptionsHalalas.map((option) => {
                  const choiceValue = String(option);
                  return (
                    <label key={option} className={`cursor-pointer rounded-lg border p-3 text-center text-sm font-semibold transition focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ${priceChoice === choiceValue ? "border-[#b88d2b] bg-[#fff8e7] text-[#76571b]" : "border-border hover:bg-muted/40"}`}>
                      <input
                        type="radio"
                        name="price-choice"
                        value={choiceValue}
                        checked={priceChoice === choiceValue}
                        onChange={() => {
                          setPriceChoice(choiceValue);
                          setPricePaidSar(sarInputFromHalalas(option));
                        }}
                        className="sr-only"
                        data-testid={`booking-price-option-${option}`}
                      />
                      {formatSarFromHalalas(option)}
                    </label>
                  );
                })}
                <label className={`cursor-pointer rounded-lg border p-3 text-center text-sm font-semibold transition focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ${customPriceSelected ? "border-[#b88d2b] bg-[#fff8e7] text-[#76571b]" : "border-border hover:bg-muted/40"}`}>
                  <input
                    type="radio"
                    name="price-choice"
                    value="custom"
                    checked={customPriceSelected}
                    onChange={() => {
                      setPriceChoice("custom");
                      setPricePaidSar("");
                    }}
                    className="sr-only"
                    data-testid="booking-price-option-custom"
                  />
                  إدخال مبلغ آخر
                </label>
              </div>
              {customPriceSelected && (
                <div className="relative mt-3">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={pricePaidSar}
                    onChange={(event) => setPricePaidSar(normalizePriceInput(event.target.value))}
                    placeholder="مثال: 750"
                    required
                    aria-label="المبلغ المدفوع بالريال السعودي"
                    className="h-11 w-full rounded-lg border border-input bg-background px-3 pl-16 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    dir="ltr"
                    data-testid="input-booking-price"
                  />
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">ر.س</span>
                </div>
              )}
            </fieldset>

            {actionError && <p className="rounded-lg bg-red-50 p-3 text-sm font-medium text-destructive" role="alert">{actionError}</p>}

            <Button
              type="submit"
              disabled={pendingAction !== null}
              className="h-11 w-full bg-emerald-600 hover:bg-emerald-700"
              data-testid="button-confirm-booking-questionnaire"
            >
              {pendingAction === "confirm" && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
              تأكيد الإجابات
            </Button>
          </form>
        </Card>
      )}
    </BookingPageShell>
  );
}
