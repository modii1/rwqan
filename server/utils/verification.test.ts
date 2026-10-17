import assert from "node:assert/strict";
import test from "node:test";

import { checkPropertyDataComplete } from "./verification";

const completeProperty = {
  name: "Test property",
  location: "https://maps.example/property",
  city: "Riyadh",
  type: "Chalet",
  facilities: ["pool"],
  prices: { weekday: 500 },
  direction: "north",
  imageUrls: ["stale-1.jpg", "stale-2.jpg", "stale-3.jpg"],
};

test("live image counts enforce the exact three-image approval minimum", async () => {
  const zeroImages = await checkPropertyDataComplete(completeProperty, 0);
  const twoImages = await checkPropertyDataComplete(completeProperty, 2);
  const threeImages = await checkPropertyDataComplete(completeProperty, 3);

  assert.equal(zeroImages.isComplete, false);
  assert.ok(zeroImages.missingFields.includes("الصور (0/3 كحد أدنى)"));
  assert.equal(twoImages.isComplete, false);
  assert.ok(twoImages.missingFields.includes("الصور (2/3 كحد أدنى)"));
  assert.equal(threeImages.isComplete, true);
  assert.equal(threeImages.missingFields.length, 0);
});

test("a live zero-image result overrides stale image metadata", async () => {
  const result = await checkPropertyDataComplete(
    {
      ...completeProperty,
      imagesLink: "https://legacy.example/folder",
      images: ["one.jpg", "two.jpg", "three.jpg", "four.jpg"],
    },
    0,
  );

  assert.equal(result.isComplete, false);
  assert.ok(result.missingFields.includes("الصور (0/3 كحد أدنى)"));
});

test("approval validation reports every blocking field at once", async () => {
  const result = await checkPropertyDataComplete(
    {
      name: " ",
      location: "",
      city: "",
      type: "",
      facilities: [],
      prices: {},
      direction: "",
    },
    0,
  );

  assert.equal(result.isComplete, false);
  assert.deepEqual(result.missingFields, [
    "اسم العقار",
    "الموقع",
    "المنطقة/المدينة",
    "نوع العقار",
    "المرافق",
    "الصور (0/3 كحد أدنى)",
  ]);
  assert.deepEqual(result.warnings, [
    "لم يتم تحديد أي سعر",
    "الاتجاه غير محدد",
  ]);
});

test("price and direction warnings remain non-blocking", async () => {
  const result = await checkPropertyDataComplete(
    { ...completeProperty, prices: {}, direction: "" },
    3,
  );

  assert.equal(result.isComplete, true);
  assert.deepEqual(result.missingFields, []);
  assert.deepEqual(result.warnings, [
    "لم يتم تحديد أي سعر",
    "الاتجاه غير محدد",
  ]);
});

test("legacy empty JSON facilities strings cannot pass approval", async () => {
  const result = await checkPropertyDataComplete(
    { ...completeProperty, facilities: "[]" },
    3,
  );

  assert.equal(result.isComplete, false);
  assert.ok(result.missingFields.includes("المرافق"));
});

test("malformed facilities strings cannot pass approval", async () => {
  const result = await checkPropertyDataComplete(
    { ...completeProperty, facilities: "[pool" },
    3,
  );

  assert.equal(result.isComplete, false);
  assert.ok(result.missingFields.includes("المرافق"));
});
