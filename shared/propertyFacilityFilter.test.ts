import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePropertyFacilitySelection,
  parsePropertyFacilities,
  propertyMatchesAllFacilityFilters,
  propertyMatchesFacilityFilter,
  togglePropertyFacilitySelection,
} from "./propertyFacilityFilter";

test("pool never includes properties explicitly marked without a pool", () => {
  assert.equal(propertyMatchesFacilityFilter({ facilities: ["بدون مسبح"] }, "مسبح"), false);
  assert.equal(propertyMatchesFacilityFilter({ facilities: ["مسبح داخلي"] }, "مسبح"), true);
  assert.equal(propertyMatchesFacilityFilter({ facilities: ["بدون مسبح"] }, "بدون مسبح"), true);
});

test("pool and no-pool filters are contradictory even for inconsistent stored data", () => {
  const pool = "\u0645\u0633\u0628\u062d";
  const noPool = "\u0628\u062f\u0648\u0646 \u0645\u0633\u0628\u062d";
  assert.equal(
    propertyMatchesAllFacilityFilters(
      { facilities: [pool, noPool] },
      [pool, noPool],
    ),
    false,
  );
});

test("selecting pool and no-pool values replaces the incompatible choice", () => {
  const indoorPool = "\u0645\u0633\u0628\u062d \u062f\u0627\u062e\u0644\u064a";
  const outdoorPool = "\u0645\u0633\u0628\u062d \u062e\u0627\u0631\u062c\u064a";
  const noPool = "\u0628\u062f\u0648\u0646 \u0645\u0633\u0628\u062d";
  const playground = "\u0645\u0644\u0639\u0628";
  assert.deepEqual(
    togglePropertyFacilitySelection([indoorPool, playground], noPool),
    [playground, noPool],
  );
  assert.deepEqual(
    togglePropertyFacilitySelection([noPool, playground], outdoorPool),
    [playground, outdoorPool],
  );
  assert.deepEqual(
    togglePropertyFacilitySelection([indoorPool, playground], indoorPool),
    [playground],
  );
});

test("legacy property data keeps a specific pool and removes its contradictory no-pool tag", () => {
  const indoorPool = "\u0645\u0633\u0628\u062d \u062f\u0627\u062e\u0644\u064a";
  const noPool = "\u0628\u062f\u0648\u0646 \u0645\u0633\u0628\u062d";
  const bedroom = "\u063a\u0631\u0641\u0629 \u0646\u0648\u0645";
  assert.deepEqual(
    normalizePropertyFacilitySelection([bedroom, indoorPool, noPool]),
    [bedroom, indoorPool],
  );
  assert.deepEqual(normalizePropertyFacilitySelection([bedroom, noPool]), [bedroom, noPool]);
});

test("smart facility filters match the values stored by the property form", () => {
  const property = {
    facilities: ["خيمة شتوية", "إنترنت Wi-Fi", "مكيفات سبليت", "قاعة احتفالات"],
  };
  assert.equal(propertyMatchesFacilityFilter(property, "شتاء"), true);
  assert.equal(propertyMatchesFacilityFilter(property, "واي فاي"), true);
  assert.equal(propertyMatchesFacilityFilter(property, "صيف"), true);
  assert.equal(propertyMatchesFacilityFilter(property, "مناسبات"), true);
});

test("an ordinary living room alone is not treated as an events facility", () => {
  assert.equal(
    propertyMatchesFacilityFilter({ facilities: ["صالة جلوس"] }, "مناسبات"),
    false,
  );
  assert.equal(
    propertyMatchesFacilityFilter({ facilities: ["قاعة احتفالات"] }, "مناسبات"),
    true,
  );
});

test("overnight price and legacy facility strings participate in combined filters", () => {
  const property = {
    facilities: '["مسبح خارجي بحاجز", "ملعب كرة قدم"]',
    prices: { overnight: "450" },
  };
  assert.deepEqual(parsePropertyFacilities(property.facilities), [
    "مسبح خارجي بحاجز",
    "ملعب كرة قدم",
  ]);
  assert.equal(
    propertyMatchesAllFacilityFilters(property, ["مسبح", "ملعب", "مبيت"]),
    true,
  );
});

test("quoted and nested legacy facility values are sanitized before matching", () => {
  const property = {
    facilities: ['"مسبح خارجي بحاجز"', '["خيمة شتوية", "إنترنت Wi-Fi"]'],
  };
  assert.equal(propertyMatchesFacilityFilter(property, "مسبح"), true);
  assert.equal(propertyMatchesFacilityFilter(property, "شتاء"), true);
  assert.equal(propertyMatchesFacilityFilter(property, "واي فاي"), true);
});
