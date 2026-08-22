import type { BookingDatePrecision } from "./booking-display";

export type BookingCalendar = "gregorian" | "hijri";

function dateAtUtcNoon(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) return null;
  return date;
}

function formatter(
  calendar: BookingCalendar,
  precision: BookingDatePrecision,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(
    calendar === "hijri"
      ? "ar-SA-u-ca-islamic-umalqura"
      : "ar-SA-u-ca-gregory",
    {
      timeZone: "UTC",
      year: "numeric",
      month: "long",
      ...(precision === "day" ? { day: "numeric" } : {}),
    },
  );
}

export function isCanonicalBookingDate(
  value: string,
  precision: BookingDatePrecision,
): boolean {
  if (precision === "month") {
    if (!/^\d{4}-\d{2}$/.test(value)) return false;
    const month = Number(value.slice(5, 7));
    return month >= 1 && month <= 12;
  }
  return dateAtUtcNoon(value) !== null;
}

/**
 * The persisted value is always Gregorian. A Gregorian month overlaps parts
 * of two Hijri months, so its Hijri representation is deliberately a range;
 * presenting it as one Hijri month would silently change its meaning.
 */
export function formatCanonicalBookingDate(
  value: string,
  precision: BookingDatePrecision,
  calendar: BookingCalendar,
): string {
  if (precision === "day") {
    const date = dateAtUtcNoon(value);
    return date ? formatter(calendar, "day").format(date) : "";
  }

  if (!isCanonicalBookingDate(value, "month")) return "";
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const firstDay = new Date(Date.UTC(year, month - 1, 1, 12));
  if (calendar === "gregorian") {
    return formatter("gregorian", "month").format(firstDay);
  }
  const lastDay = new Date(Date.UTC(year, month, 0, 12));
  const hijriDayFormatter = formatter("hijri", "day");
  return `${hijriDayFormatter.format(firstDay)} – ${hijriDayFormatter.format(lastDay)}`;
}
