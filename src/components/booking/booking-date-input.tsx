"use client";

import { useState } from "react";
import type { BookingDatePrecision } from "./booking-display";
import {
  formatCanonicalBookingDate,
  type BookingCalendar,
} from "./booking-calendar";

export function BookingDateInput({
  value,
  precision,
  onChange,
}: {
  value: string;
  precision: BookingDatePrecision;
  onChange: (value: string) => void;
}) {
  const [calendar, setCalendar] = useState<BookingCalendar>("gregorian");

  return (
    <div className="space-y-3">
      <div
        className="grid grid-cols-2 rounded-lg border bg-muted/20 p-1"
        aria-label="نظام عرض التاريخ"
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
            className={`rounded-md px-2 py-2 text-xs font-semibold ${
              calendar === option
                ? "bg-white text-[#76571b] shadow-sm"
                : "text-muted-foreground"
            }`}
            data-testid={`booking-calendar-${option}`}
          >
            {label}
          </button>
        ))}
      </div>

      <input
        type={precision === "month" ? "month" : "date"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        aria-label={precision === "month" ? "شهر الحجز" : "تاريخ الحجز"}
        className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="input-booking-date"
      />

      {value && (
        <p
          className="text-xs font-medium text-muted-foreground"
          data-testid="booking-date-selected-label"
        >
          التاريخ المحدد: {formatCanonicalBookingDate(value, precision, calendar)}
        </p>
      )}
    </div>
  );
}
