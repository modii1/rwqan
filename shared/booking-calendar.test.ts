import assert from "node:assert/strict";
import test from "node:test";
import { CalendarDate, IslamicUmalquraCalendar } from "@internationalized/date";
import {
  calendarDateFromCanonicalDay,
  calendarMonthRange,
  canonicalDayFromCalendarDate,
  formatCalendarDayNumeric,
  formatCanonicalDayNumeric,
} from "./booking-calendar";

test("Gregorian and Umm al-Qura selections resolve to the same canonical day", () => {
  const hijri = new CalendarDate(new IslamicUmalquraCalendar(), 1448, 3, 10);
  assert.equal(canonicalDayFromCalendarDate(hijri), "2026-08-23");
  assert.equal(formatCalendarDayNumeric(hijri, "hijri"), "1448/03/10");
  assert.equal(formatCanonicalDayNumeric("2026-08-23", "gregorian"), "2026/8/23");
  assert.equal(formatCanonicalDayNumeric("2026-08-23", "hijri"), "1448/03/10");
});

test("Umm al-Qura month boundaries are canonical Gregorian inclusive dates", () => {
  assert.deepEqual(calendarMonthRange("1448-03", "hijri"), {
    startDate: "2026-08-14",
    endDate: "2026-09-11",
  });
  assert.deepEqual(calendarMonthRange("2026-08", "gregorian"), {
    startDate: "2026-08-01",
    endDate: "2026-08-31",
  });
});

test("invalid exact dates and calendar months fail closed", () => {
  assert.equal(calendarDateFromCanonicalDay("2027-02-29", "gregorian"), null);
  assert.equal(calendarMonthRange("1448-13", "hijri"), null);
  assert.equal(calendarMonthRange("1299-12", "hijri"), null);
  assert.equal(calendarMonthRange("1600-01", "hijri"), null);
  assert.equal(calendarMonthRange("1-01", "gregorian"), null);
  assert.equal(calendarMonthRange("001-01", "gregorian"), null);
  assert.equal(calendarMonthRange("not-a-month", "gregorian"), null);
});
