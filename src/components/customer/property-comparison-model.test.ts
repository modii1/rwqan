import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { Property } from "@shared/schema";
import {
  comparisonPriceRowsForProperties,
  keepAvailableComparisonProperties,
  togglePropertyComparison,
  uniquePropertyFacilities,
} from "./property-comparison-model";

function property(overrides: Partial<Property> = {}): Property {
  return {
    propertyNumber: "10001",
    name: "Property",
    whatsappNumber: "512345678",
    city: "بريدة",
    direction: "شمال",
    type: "قسم",
    facilities: [],
    prices: {
      weekday: "500",
      weekend: "700",
      overnight: "900",
      holidays: "1000",
    },
    subscriptionType: "normal",
    imageUrls: [],
    ...overrides,
  };
}

test("comparison selection toggles entries and enforces the three-property limit", () => {
  assert.deepEqual(togglePropertyComparison([], "10001"), {
    propertyNumbers: ["10001"],
    limitReached: false,
  });
  assert.deepEqual(togglePropertyComparison(["10001"], "10001"), {
    propertyNumbers: [],
    limitReached: false,
  });
  assert.deepEqual(togglePropertyComparison(["1", "2", "3"], "4"), {
    propertyNumbers: ["1", "2", "3"],
    limitReached: true,
  });
});

test("comparison selection removes properties that are no longer available", () => {
  assert.deepEqual(
    keepAvailableComparisonProperties(["1", "2", "3"], ["3", "1"]),
    ["1", "3"],
  );
});

test("comparison only shows optional price rows when a selected property has data", () => {
  const withoutOptional = comparisonPriceRowsForProperties([property()]);
  assert.equal(withoutOptional.some((row) => row.key === "display"), false);
  assert.equal(withoutOptional.some((row) => row.key === "special"), false);

  const withOptional = comparisonPriceRowsForProperties([
    property({
      prices: {
        display: "ابتداءً من 500",
        weekday: "500",
        weekend: "700",
        overnight: "900",
        special: "650",
        holidays: "1000",
      },
    }),
  ]);
  assert.equal(withOptional.some((row) => row.key === "display"), true);
  assert.equal(withOptional.some((row) => row.key === "special"), true);
});

test("comparison facility values are trimmed and deduplicated", () => {
  assert.deepEqual(
    uniquePropertyFacilities(property({ facilities: ["مسبح", " مسبح ", "", "ملعب"] })),
    ["مسبح", "ملعب"],
  );
});

test("comparison UI includes admin-managed capacity and availability facts", () => {
  const source = readFileSync(
    new URL("./property-comparison.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /property\.capacity/);
  assert.match(source, /property\.availabilityNote/);
  assert.match(source, /السعة القصوى/);
  assert.match(source, /التوفر/);
});
