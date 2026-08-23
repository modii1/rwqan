import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./booking-date-input.tsx", import.meta.url),
  "utf8",
);

test("booking input uses a real dual-calendar browser instead of a native Gregorian input", () => {
  assert.match(source, /calendarDateFromCanonicalDay/);
  assert.match(source, /calendarMonthDate/);
  assert.match(source, /canonicalDayFromCalendarDate/);
  assert.match(source, /bookingCalendarInstance\(nextCalendar\)/);
  assert.match(source, /aria-required="true"/);
  assert.doesNotMatch(source, /type=\{precision === "month" \? "month" : "date"\}/);
});

test("calendar captions and month choices are numeric and use Western digits", () => {
  assert.match(source, /formatCalendarMonthNumeric/);
  assert.match(source, /monthNumber\(month, calendar\)/);
  assert.doesNotMatch(source, /month: "long"/);
  assert.doesNotMatch(source, /month: "short"/);
});

test("day calendar exposes grid rows and arrow-key navigation", () => {
  assert.match(source, /role="grid"/);
  assert.match(source, /role="row"/);
  assert.match(source, /role="gridcell"/);
  for (const key of ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"]) {
    assert.match(source, new RegExp(`event\\.key === "${key}"`));
  }
  assert.match(source, /event\.key === "ArrowLeft"\) target = date\.add\(\{ days: 1 \}\)/);
  assert.match(source, /event\.key === "ArrowRight"\) target = date\.subtract\(\{ days: 1 \}\)/);
});
