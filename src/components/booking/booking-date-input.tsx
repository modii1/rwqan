"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
  today,
  toCalendar,
  type CalendarDate,
} from "@internationalized/date";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  bookingCalendarInstance,
  calendarDateFromCanonicalDay,
  calendarMonthDate,
  calendarMonthValue,
  canonicalDayFromCalendarDate,
  formatCalendarMonthNumeric,
  isBookingCalendarDateSupported,
  type BookingCalendar,
} from "@shared/booking-calendar";
import type { BookingDatePrecision } from "./booking-display";
import { formatCanonicalBookingDate } from "./booking-calendar";

const RIYADH_TIME_ZONE = "Asia/Riyadh";
function initialVisibleDate(
  value: string,
  precision: BookingDatePrecision,
  calendar: BookingCalendar,
  selectionCalendar: BookingCalendar,
): CalendarDate {
  if (precision === "day") {
    const selected = calendarDateFromCanonicalDay(value, calendar);
    if (selected) return selected;
  } else if (value) {
    const selectedMonth = calendarMonthDate(value, selectionCalendar);
    if (selectedMonth) {
      return toCalendar(selectedMonth, bookingCalendarInstance(calendar));
    }
  }
  return toCalendar(today(RIYADH_TIME_ZONE), bookingCalendarInstance(calendar));
}

function calendarCaption(date: CalendarDate, calendar: BookingCalendar): string {
  return formatCalendarMonthNumeric(calendarMonthValue(date), calendar);
}

function calendarYear(date: CalendarDate): string {
  return String(date.year);
}

function weekdayLabels(): string[] {
  const sunday = new Date(Date.UTC(2026, 7, 23, 12));
  const formatter = new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    timeZone: "UTC",
    weekday: "short",
  });
  return Array.from({ length: 7 }, (_, index) =>
    formatter.format(new Date(sunday.getTime() + index * 86_400_000))
  );
}

function visibleDays(month: CalendarDate): CalendarDate[] {
  const first = startOfWeek(startOfMonth(month), "ar-SA", "sun");
  const last = endOfWeek(endOfMonth(month), "ar-SA", "sun");
  const days: CalendarDate[] = [];
  for (let cursor = first; cursor.compare(last) <= 0; cursor = cursor.add({ days: 1 })) {
    days.push(cursor);
  }
  return days;
}

function monthNumber(month: number, calendar: BookingCalendar): string {
  return calendar === "hijri" ? String(month).padStart(2, "0") : String(month);
}

function adjacentVisibleDate(
  current: CalendarDate,
  precision: BookingDatePrecision,
  calendar: BookingCalendar,
  direction: -1 | 1,
): CalendarDate | null {
  try {
    const duration = precision === "month" ? { years: 1 } : { months: 1 };
    const next = direction === -1 ? current.subtract(duration) : current.add(duration);
    return isBookingCalendarDateSupported(next, calendar) ? next : null;
  } catch {
    return null;
  }
}

export function BookingDateInput({
  value,
  precision,
  selectionCalendar,
  onChange,
}: {
  value: string;
  precision: BookingDatePrecision;
  selectionCalendar: BookingCalendar;
  onChange: (value: string, calendar: BookingCalendar) => void;
}) {
  const [calendar, setCalendar] = useState<BookingCalendar>("gregorian");
  const [open, setOpen] = useState(false);
  const dayButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [visibleDate, setVisibleDate] = useState(() =>
    initialVisibleDate(value, precision, "gregorian", selectionCalendar)
  );
  const days = useMemo(() => visibleDays(visibleDate), [visibleDate]);
  const weekdays = useMemo(weekdayLabels, []);
  const selectedInGrid = useMemo(
    () => days.some((date) =>
      isBookingCalendarDateSupported(date, calendar)
      && canonicalDayFromCalendarDate(date) === value
    ),
    [calendar, days, value],
  );
  const previousVisibleDate = adjacentVisibleDate(
    visibleDate,
    precision,
    calendar,
    -1,
  );
  const nextVisibleDate = adjacentVisibleDate(
    visibleDate,
    precision,
    calendar,
    1,
  );

  useEffect(() => {
    setVisibleDate(initialVisibleDate(value, precision, calendar, selectionCalendar));
  }, [calendar, precision, selectionCalendar, value]);

  const selectCalendar = (nextCalendar: BookingCalendar) => {
    setCalendar(nextCalendar);
    setVisibleDate((current) => {
      const canonical = canonicalDayFromCalendarDate(current);
      return calendarDateFromCanonicalDay(canonical, nextCalendar)
        || toCalendar(today(RIYADH_TIME_ZONE), bookingCalendarInstance(nextCalendar));
    });
  };

  const selectedLabel = value
    ? formatCanonicalBookingDate(value, precision, calendar, {
        calendar: selectionCalendar,
      })
    : "";

  const selectDay = (date: CalendarDate) => {
    if (!isBookingCalendarDateSupported(date, calendar)) return;
    onChange(canonicalDayFromCalendarDate(date), calendar);
    setOpen(false);
  };

  const focusDay = (date: CalendarDate) => {
    if (!isBookingCalendarDateSupported(date, calendar)) return;
    setVisibleDate(date);
    const canonical = canonicalDayFromCalendarDate(date);
    requestAnimationFrame(() => {
      dayButtonRefs.current.get(canonical)?.focus();
    });
  };

  const handleDayKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    date: CalendarDate,
  ) => {
    let target: CalendarDate | null = null;
    // The calendar grid is RTL: later dates are visually to the left.
    if (event.key === "ArrowLeft") target = date.add({ days: 1 });
    if (event.key === "ArrowRight") target = date.subtract({ days: 1 });
    if (event.key === "ArrowDown") target = date.add({ days: 7 });
    if (event.key === "ArrowUp") target = date.subtract({ days: 7 });
    if (event.key === "Home") target = startOfWeek(date, "ar-SA", "sun");
    if (event.key === "End") target = endOfWeek(date, "ar-SA", "sun");
    if (event.key === "PageUp") target = date.subtract({ months: 1 });
    if (event.key === "PageDown") target = date.add({ months: 1 });
    if (!target || !isBookingCalendarDateSupported(target, calendar)) return;
    event.preventDefault();
    focusDay(target);
  };

  const selectMonth = (month: number) => {
    const selected = visibleDate.set({ month, day: 1 });
    onChange(calendarMonthValue(selected), calendar);
    setVisibleDate(selected);
    setOpen(false);
  };

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
            onClick={() => selectCalendar(option)}
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

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            dir="ltr"
            aria-label={precision === "month" ? "شهر الحجز" : "تاريخ الحجز"}
            aria-required="true"
            className="flex h-11 w-full items-center justify-between rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="input-booking-date"
          >
            <span>{selectedLabel || (precision === "month" ? "شهر الحجز" : "تاريخ الحجز")}</span>
            <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          dir="rtl"
          className="w-[min(22rem,calc(100vw-2rem))] p-3"
          data-testid={`booking-${calendar}-calendar`}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                if (previousVisibleDate) setVisibleDate(previousVisibleDate);
              }}
              disabled={!previousVisibleDate}
              aria-label={precision === "month" ? "السنة السابقة" : "الشهر السابق"}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
            <p className="min-w-0 truncate text-sm font-bold" aria-live="polite">
              {precision === "month"
                ? calendarYear(visibleDate)
                : calendarCaption(visibleDate, calendar)}
            </p>
            <button
              type="button"
              onClick={() => {
                if (nextVisibleDate) setVisibleDate(nextVisibleDate);
              }}
              disabled={!nextVisibleDate}
              aria-label={precision === "month" ? "السنة التالية" : "الشهر التالي"}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {precision === "day" ? (
            <div role="grid" aria-label={calendarCaption(visibleDate, calendar)}>
              <div className="grid grid-cols-7" role="row">
                {weekdays.map((weekday, index) => (
                  <span
                    key={`${weekday}-${index}`}
                    role="columnheader"
                    className="py-1 text-center text-[11px] font-medium text-muted-foreground"
                  >
                    {weekday}
                  </span>
                ))}
              </div>
              {Array.from(
                { length: Math.ceil(days.length / 7) },
                (_, weekIndex) => days.slice(weekIndex * 7, weekIndex * 7 + 7),
              ).map((week) => (
                <div
                  key={`${week[0].era}-${week[0].year}-${week[0].month}-${week[0].day}`}
                  className="grid grid-cols-7 gap-y-1"
                  role="row"
                >
                {week.map((date) => {
                  const cellKey = `${date.era}-${date.year}-${date.month}-${date.day}`;
                  if (!isBookingCalendarDateSupported(date, calendar)) {
                    return (
                      <div
                        key={cellKey}
                        role="gridcell"
                        aria-disabled="true"
                        className="h-9"
                      />
                    );
                  }
                  const canonical = canonicalDayFromCalendarDate(date);
                  const selected = value === canonical;
                  const outside = date.month !== visibleDate.month;
                  const fallback = date.day === 1 && date.month === visibleDate.month;
                  return (
                    <div key={cellKey} role="gridcell" aria-selected={selected}>
                      <button
                        ref={(element) => {
                          if (element) dayButtonRefs.current.set(canonical, element);
                          else dayButtonRefs.current.delete(canonical);
                        }}
                        type="button"
                        tabIndex={selected || (!selectedInGrid && fallback) ? 0 : -1}
                        aria-label={formatCanonicalBookingDate(canonical, "day", calendar)}
                        onClick={() => selectDay(date)}
                        onKeyDown={(event) => handleDayKeyDown(event, date)}
                        className={`mx-auto inline-flex h-9 w-9 items-center justify-center rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          selected
                            ? "bg-[#8b6b25] font-bold text-white"
                            : outside
                              ? "text-muted-foreground/50 hover:bg-muted"
                              : "hover:bg-muted"
                        }`}
                      >
                        {date.day}
                      </button>
                    </div>
                  );
                })}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2" role="group" aria-label={calendarYear(visibleDate)}>
              {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => {
                const monthValue = calendarMonthValue(visibleDate.set({ month, day: 1 }));
                const selected = selectionCalendar === calendar && value === monthValue;
                return (
                  <button
                    key={month}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => selectMonth(month)}
                    className={`min-h-10 rounded-md border px-2 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      selected
                        ? "border-[#8b6b25] bg-[#8b6b25] text-white"
                        : "hover:bg-muted"
                    }`}
                  >
                    {monthNumber(month, calendar)}
                  </button>
                );
              })}
            </div>
          )}
        </PopoverContent>
      </Popover>

      {value && (
        <p
          className="text-xs font-medium text-muted-foreground"
          data-testid="booking-date-selected-label"
        >
          التاريخ المحدد: {selectedLabel}
        </p>
      )}
    </div>
  );
}
