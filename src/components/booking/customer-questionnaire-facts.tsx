"use client";

import { useState, type ReactNode } from "react";
import {
  bookingTimingLabel,
  getQuestionnairePrice,
  type BookingDatePrecision,
  type BookingQuestionnaire,
} from "./booking-display";
import {
  formatCanonicalBookingDate,
  type BookingCalendar,
} from "./booking-calendar";

function canonicalDate(questionnaire: BookingQuestionnaire): {
  value: string;
  precision: BookingDatePrecision;
} | null {
  const nested = questionnaire.bookingDate &&
      typeof questionnaire.bookingDate === "object"
    ? questionnaire.bookingDate
    : null;
  const value = String(
    typeof questionnaire.bookingDate === "string"
      ? questionnaire.bookingDate
      : nested?.value || questionnaire.date || "",
  ).trim();
  const precision = String(
    questionnaire.bookingDatePrecision || nested?.precision || "day",
  ) === "month" ? "month" : "day";
  return value ? { value, precision } : null;
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border/70 bg-muted/25 p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-bold text-foreground">{value}</dd>
    </div>
  );
}

export function CustomerQuestionnaireFacts({
  questionnaire,
}: {
  questionnaire?: BookingQuestionnaire | null;
}) {
  const [calendar, setCalendar] = useState<BookingCalendar>("gregorian");
  if (!questionnaire) {
    return <p className="text-sm text-muted-foreground">لم تُسجل تفاصيل الحجز بعد.</p>;
  }
  const date = canonicalDate(questionnaire);
  const dateValue = date
    ? formatCanonicalBookingDate(date.value, date.precision, calendar) || date.value
    : "—";

  return (
    <div className="space-y-3">
      <div
        className="mr-auto grid w-40 grid-cols-2 rounded-lg border bg-muted/20 p-1"
        aria-label="نظام عرض تاريخ الحجز"
      >
        {([
          ["gregorian", "ميلادي"],
          ["hijri", "هجري"],
        ] as const).map(([option, label]) => (
          <button
            key={option}
            type="button"
            onClick={() => setCalendar(option)}
            aria-pressed={calendar === option}
            className={`rounded-md px-2 py-1.5 text-xs font-semibold ${
              calendar === option
                ? "bg-white text-[#76571b] shadow-sm"
                : "text-muted-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <Fact
          label="وقت الحجز"
          value={bookingTimingLabel(
            questionnaire.timing || questionnaire.bookingTiming,
          )}
        />
        <Fact label="تاريخ الحجز" value={dateValue} />
        <Fact label="المبلغ المدفوع" value={getQuestionnairePrice(questionnaire)} />
      </dl>
    </div>
  );
}
