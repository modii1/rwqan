import type { BookingCalendar } from "@shared/booking-calendar";

const MAX_BOOKING_PRICE_HALALAS = 100_000_000;

export function normalizeListedPriceOptionsHalalas(value: unknown): number[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<number>();
  const options: number[] = [];
  for (const rawOption of value) {
    const option = Number(rawOption);
    if (
      !Number.isSafeInteger(option)
      || option <= 0
      || option > MAX_BOOKING_PRICE_HALALAS
      || seen.has(option)
    ) continue;
    seen.add(option);
    options.push(option);
  }
  return options;
}

export function sarInputFromHalalas(value: number): string {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_BOOKING_PRICE_HALALAS) return "";
  return (value / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

export function buildBookingQuestionnairePayload({
  timing,
  bookingDate,
  bookingDatePrecision,
  bookingDateCalendar,
  pricePaidSar,
}: {
  timing: "midweek" | "weekend" | "other";
  bookingDate: string;
  bookingDatePrecision: "day" | "month";
  bookingDateCalendar: BookingCalendar;
  pricePaidSar: string;
}) {
  return {
    timing,
    bookingDate,
    bookingDatePrecision,
    bookingDateCalendar,
    pricePaidSar,
  };
}
