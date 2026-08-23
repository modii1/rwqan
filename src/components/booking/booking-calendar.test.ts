import assert from "node:assert/strict";
import test from "node:test";
import {
  formatCanonicalBookingDate,
  isBookingDateSelectionValid,
  isCanonicalBookingDate,
} from "./booking-calendar";

test("booking dates remain strictly validated Gregorian canonical values", () => {
  assert.equal(isCanonicalBookingDate("2028-02-29", "day"), true);
  assert.equal(isCanonicalBookingDate("2027-02-29", "day"), false);
  assert.equal(isCanonicalBookingDate("2026-08", "month"), true);
  assert.equal(isCanonicalBookingDate("2026-13", "month"), false);
});

test("the same canonical day can be displayed in Gregorian or Hijri", () => {
  const canonical = "2026-08-23";
  const gregorian = formatCanonicalBookingDate(canonical, "day", "gregorian");
  const hijri = formatCanonicalBookingDate(canonical, "day", "hijri");

  assert.equal(gregorian, "2026/8/23");
  assert.equal(hijri, "1448/03/10");
  assert.doesNotMatch(gregorian, /[٠-٩۰-۹]/);
  assert.doesNotMatch(hijri, /[٠-٩۰-۹]/);
  assert.notEqual(gregorian, hijri);
  assert.equal(canonical, "2026-08-23");
});

test("Gregorian month-only dates use numeric Western output", () => {
  assert.equal(
    formatCanonicalBookingDate("2026-01", "month", "gregorian"),
    "2026/1",
  );
});

test("a Gregorian month is shown as its exact numeric Hijri boundary range", () => {
  assert.equal(
    formatCanonicalBookingDate("2026-08", "month", "hijri"),
    "1448/02/18 – 1448/03/18",
  );
});

test("a selected Hijri month retains its identity and exact Gregorian range", () => {
  const metadata = {
    calendar: "hijri" as const,
    startDate: "2026-08-14",
    endDate: "2026-09-11",
  };
  assert.equal(
    formatCanonicalBookingDate("1448-03", "month", "hijri", metadata),
    "1448/03",
  );
  assert.equal(
    formatCanonicalBookingDate("1448-03", "month", "gregorian", metadata),
    "2026/8/14 – 2026/9/11",
  );
  assert.equal(isBookingDateSelectionValid("1448-03", "month", "hijri"), true);
  assert.equal(isBookingDateSelectionValid("1448-13", "month", "hijri"), false);
  assert.equal(isBookingDateSelectionValid("2174-01-01", "day", "hijri"), false);
});
