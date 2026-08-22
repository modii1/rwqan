import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildBookingQuestionnairePayload,
  normalizeListedPriceOptionsHalalas,
  sarInputFromHalalas,
} from "./booking-price-options";

test("listed booking prices stay ordered while invalid and duplicate options are removed", () => {
  assert.deepEqual(
    normalizeListedPriceOptionsHalalas([80_000, 120_000, 80_000, 0, -100, 12.5, "95000", null]),
    [80_000, 120_000, 95_000],
  );
  assert.deepEqual(normalizeListedPriceOptionsHalalas(null), []);
});

test("a listed halala price converts exactly to the existing SAR input contract", () => {
  assert.equal(sarInputFromHalalas(75_000), "750");
  assert.equal(sarInputFromHalalas(75_050), "750.5");
  assert.equal(sarInputFromHalalas(75_055), "750.55");
});

test("questionnaire payload remains limited to the existing three booking facts", () => {
  const payload = buildBookingQuestionnairePayload({
    timing: "weekend",
    bookingDate: "2026-08-18",
    bookingDatePrecision: "day",
    pricePaidSar: sarInputFromHalalas(90_000),
  });

  assert.deepEqual(payload, {
    timing: "weekend",
    bookingDate: "2026-08-18",
    bookingDatePrecision: "day",
    pricePaidSar: "900",
  });
  assert.deepEqual(Object.keys(payload), [
    "timing",
    "bookingDate",
    "bookingDatePrecision",
    "pricePaidSar",
  ]);
});

test("questionnaire UI keeps three questions and offers listed or custom prices", () => {
  const source = readFileSync(
    new URL("./booking-followup-client.tsx", import.meta.url),
    "utf8",
  );

  assert.equal(source.match(/<fieldset>/g)?.length, 3);
  assert.match(source, /listedPriceOptionsHalalas\.map/);
  assert.match(source, /data-testid="booking-price-option-custom"/);
  assert.match(source, /data-testid="input-booking-price"/);
  assert.match(source, />1<\/span>/);
  assert.match(source, />2<\/span>/);
  assert.match(source, />3<\/span>/);
  assert.doesNotMatch(source, />[١٢٣]<\/span>/);
});

test("customer profile renders the property name supplied by its booking snapshot DTO", () => {
  const source = readFileSync(
    new URL("./customer-bookings-profile.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /getPropertyLabel\(booking\)/);
});
