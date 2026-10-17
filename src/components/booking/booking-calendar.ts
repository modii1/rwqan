import type { BookingDatePrecision } from "./booking-display";
import {
  calendarDateFromCanonicalDay,
  calendarMonthDate,
  calendarMonthRange,
  formatCalendarMonthNumeric,
  formatCanonicalDayNumeric,
  type BookingCalendar,
} from "@shared/booking-calendar";

export type { BookingCalendar } from "@shared/booking-calendar";

export type BookingMonthMetadata = {
  calendar?: BookingCalendar | null;
  startDate?: string | null;
  endDate?: string | null;
};

export function isCanonicalBookingDate(
  value: string,
  precision: BookingDatePrecision,
): boolean {
  if (precision === "month") {
    return calendarMonthDate(value, "gregorian") !== null;
  }
  return calendarDateFromCanonicalDay(value, "gregorian") !== null;
}

export function isBookingDateSelectionValid(
  value: string,
  precision: BookingDatePrecision,
  calendar: BookingCalendar,
): boolean {
  return precision === "month"
    ? calendarMonthDate(value, calendar) !== null
    : calendarDateFromCanonicalDay(value, calendar) !== null;
}

function monthRange(
  value: string,
  metadata?: BookingMonthMetadata,
): { calendar: BookingCalendar; startDate: string; endDate: string } | null {
  const sourceCalendar = metadata?.calendar === "hijri" ? "hijri" : "gregorian";
  const expected = calendarMonthRange(value, sourceCalendar);
  if (!expected) return null;

  if (metadata?.startDate || metadata?.endDate) {
    if (
      metadata.startDate !== expected.startDate
      || metadata.endDate !== expected.endDate
    ) return null;
  }
  return { calendar: sourceCalendar, ...expected };
}

/** Exact days remain Gregorian ISO values; calendar months retain their source calendar. */
export function formatCanonicalBookingDate(
  value: string,
  precision: BookingDatePrecision,
  calendar: BookingCalendar,
  metadata?: BookingMonthMetadata,
): string {
  if (precision === "day") {
    return formatCanonicalDayNumeric(value, calendar);
  }

  const range = monthRange(value, metadata);
  if (!range) return "";
  if (calendar === range.calendar) {
    return formatCalendarMonthNumeric(value, calendar);
  }

  const start = formatCanonicalDayNumeric(range.startDate, calendar);
  const end = formatCanonicalDayNumeric(range.endDate, calendar);
  return start && end ? `${start} – ${end}` : "";
}
