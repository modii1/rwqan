import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBookingDate,
  formatDateTime,
  formatSar,
  formatSarFromHalalas,
} from "./booking-display";

const NON_LATIN_DIGIT_PATTERN = /[٠-٩۰-۹]/;

test("new booking screens display money with Western digits", () => {
  const fromHalalas = formatSarFromHalalas(123_45);
  const fromSar = formatSar("123.45");

  assert.match(fromHalalas, /123\.45/);
  assert.match(fromSar, /123\.45/);
  assert.doesNotMatch(fromHalalas, NON_LATIN_DIGIT_PATTERN);
  assert.doesNotMatch(fromSar, NON_LATIN_DIGIT_PATTERN);
});

test("new booking screens display Gregorian dates with full English month names", () => {
  assert.equal(
    formatBookingDate({
      bookingDate: "2026-01-23",
      bookingDatePrecision: "day",
    }),
    "January 23, 2026",
  );
  assert.equal(
    formatBookingDate({
      bookingDate: "2026-01",
      bookingDatePrecision: "month",
    }),
    "January 2026",
  );

  const dateTime = formatDateTime("2026-01-23T12:04:00.000Z");
  assert.match(dateTime, /^January 23, 2026 at 3:04 PM$/);
  assert.doesNotMatch(dateTime, NON_LATIN_DIGIT_PATTERN);
});
