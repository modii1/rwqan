import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCanonicalBookingDate,
  isCanonicalBookingDate,
} from "./booking-calendar";

test("booking dates remain strictly validated Gregorian canonical values", () => {
  assert.equal(isCanonicalBookingDate("2028-02-29", "day"), true);
  assert.equal(isCanonicalBookingDate("2027-02-29", "day"), false);
  assert.equal(isCanonicalBookingDate("2026-08", "month"), true);
  assert.equal(isCanonicalBookingDate("2026-13", "month"), false);
});

test("the same canonical day can be displayed in Gregorian or Hijri", () => {
  const canonical = "2026-08-22";
  const gregorian = formatCanonicalBookingDate(canonical, "day", "gregorian");
  const hijri = formatCanonicalBookingDate(canonical, "day", "hijri");

  assert.equal(gregorian, "August 22, 2026");
  assert.match(hijri, /1448/);
  assert.doesNotMatch(gregorian, /[٠-٩۰-۹]/);
  assert.doesNotMatch(hijri, /[٠-٩۰-۹]/);
  assert.notEqual(gregorian, hijri);
  assert.equal(canonical, "2026-08-22");
});

test("Gregorian month-only dates use a written English month and Western digits", () => {
  assert.equal(
    formatCanonicalBookingDate("2026-01", "month", "gregorian"),
    "January 2026",
  );
});

test("a Gregorian month is shown as its exact Hijri boundary range", () => {
  const formatHijriDay = new Intl.DateTimeFormat(
    "ar-SA-u-ca-islamic-umalqura-nu-latn",
    {
      timeZone: "UTC",
      year: "numeric",
      month: "long",
      day: "numeric",
    },
  );
  const expectedStart = formatHijriDay.format(
    new Date("2026-08-01T12:00:00.000Z"),
  );
  const expectedEnd = formatHijriDay.format(
    new Date("2026-08-31T12:00:00.000Z"),
  );

  assert.notEqual(expectedStart.split(" ")[1], expectedEnd.split(" ")[1]);
  assert.equal(
    formatCanonicalBookingDate("2026-08", "month", "hijri"),
    `${expectedStart} – ${expectedEnd}`,
  );
  assert.doesNotMatch(expectedStart, /[٠-٩۰-۹]/);
  assert.doesNotMatch(expectedEnd, /[٠-٩۰-۹]/);
});
