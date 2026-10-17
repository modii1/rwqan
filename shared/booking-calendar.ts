import {
  CalendarDate,
  endOfMonth,
  GregorianCalendar,
  IslamicUmalquraCalendar,
  parseDate,
  startOfMonth,
  toCalendar,
  type Calendar,
} from "@internationalized/date";

export type BookingCalendar = "gregorian" | "hijri";

const CANONICAL_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CALENDAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
export const UMM_AL_QURA_MIN_YEAR = 1300;
export const UMM_AL_QURA_MAX_YEAR = 1599;

export function bookingCalendarInstance(calendar: BookingCalendar): Calendar {
  return calendar === "hijri"
    ? new IslamicUmalquraCalendar()
    : new GregorianCalendar();
}

export function isBookingCalendarDateSupported(
  date: CalendarDate,
  calendar: BookingCalendar,
): boolean {
  try {
    const displayed = toCalendar(date, bookingCalendarInstance(calendar));
    if (
      !Number.isSafeInteger(displayed.year)
      || !Number.isSafeInteger(displayed.month)
      || !Number.isSafeInteger(displayed.day)
    ) return false;
    return calendar !== "hijri"
      || (
        displayed.year >= UMM_AL_QURA_MIN_YEAR
        && displayed.year <= UMM_AL_QURA_MAX_YEAR
      );
  } catch {
    return false;
  }
}

export function calendarDateFromCanonicalDay(
  value: string,
  calendar: BookingCalendar,
): CalendarDate | null {
  if (!CANONICAL_DAY_PATTERN.test(value)) return null;
  try {
    const date = toCalendar(parseDate(value), bookingCalendarInstance(calendar));
    return isBookingCalendarDateSupported(date, calendar) ? date : null;
  } catch {
    return null;
  }
}

export function calendarMonthDate(
  value: string,
  calendar: BookingCalendar,
): CalendarDate | null {
  const match = value.match(CALENDAR_MONTH_PATTERN);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isSafeInteger(year) || year < 1 || year > 9999 || month < 1 || month > 12) {
    return null;
  }
  // Adobe's bundled Saudi Umm al-Qura table is authoritative only in this range.
  if (
    calendar === "hijri"
    && (year < UMM_AL_QURA_MIN_YEAR || year > UMM_AL_QURA_MAX_YEAR)
  ) return null;
  try {
    const date = new CalendarDate(bookingCalendarInstance(calendar), year, month, 1);
    return date.year === year && date.month === month ? date : null;
  } catch {
    return null;
  }
}

export function calendarMonthRange(
  value: string,
  calendar: BookingCalendar,
): { startDate: string; endDate: string } | null {
  const date = calendarMonthDate(value, calendar);
  if (!date) return null;
  return {
    startDate: startOfMonth(date).toString(),
    endDate: endOfMonth(date).toString(),
  };
}

export function canonicalDayFromCalendarDate(date: CalendarDate): string {
  return toCalendar(date, new GregorianCalendar()).toString();
}

export function calendarMonthValue(date: CalendarDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}`;
}

export function formatCalendarDayNumeric(
  date: CalendarDate,
  calendar: BookingCalendar,
): string {
  if (!isBookingCalendarDateSupported(date, calendar)) return "";
  const displayed = toCalendar(date, bookingCalendarInstance(calendar));
  const month = calendar === "hijri"
    ? String(displayed.month).padStart(2, "0")
    : String(displayed.month);
  const day = calendar === "hijri"
    ? String(displayed.day).padStart(2, "0")
    : String(displayed.day);
  return `${displayed.year}/${month}/${day}`;
}

export function formatCanonicalDayNumeric(
  value: string,
  calendar: BookingCalendar,
): string {
  const date = calendarDateFromCanonicalDay(value, calendar);
  return date ? formatCalendarDayNumeric(date, calendar) : "";
}

export function formatCalendarMonthNumeric(
  value: string,
  calendar: BookingCalendar,
): string {
  const date = calendarMonthDate(value, calendar);
  if (!date) return "";
  const month = calendar === "hijri"
    ? String(date.month).padStart(2, "0")
    : String(date.month);
  return `${date.year}/${month}`;
}
