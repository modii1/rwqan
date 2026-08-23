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

test("new booking screens display Gregorian dates numerically with Western digits", () => {
  assert.equal(
    formatBookingDate({
      bookingDate: "2026-01-23",
      bookingDatePrecision: "day",
    }),
    "2026/1/23",
  );
  assert.equal(
    formatBookingDate({
      bookingDate: "2026-01",
      bookingDatePrecision: "month",
    }),
    "2026/1",
  );

  const dateTime = formatDateTime("2026-01-23T12:04:00.000Z");
  assert.equal(dateTime, "2026/1/23 3:04 PM");
  assert.doesNotMatch(dateTime, NON_LATIN_DIGIT_PATTERN);
});

test("a stored Hijri month displays its selected numeric month without losing boundaries", () => {
  assert.equal(
    formatBookingDate({
      bookingDate: {
        value: "1448-03",
        precision: "month",
        calendar: "hijri",
        startDate: "2026-08-14",
        endDate: "2026-09-11",
      },
    }),
    "1448/03",
  );
});
