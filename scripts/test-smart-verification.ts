/**
 * Test script for smart verification image checking
 * Run with: npx tsx scripts/test-smart-verification.ts
 */

// Inline the function to test without module resolution issues
async function checkPropertyDataComplete(property: any, r2ImageCount?: number): Promise<{
  isComplete: boolean;
  missingFields: string[];
  warnings: string[];
  completionScore: number;
}> {
  const missingFields: string[] = [];
  const warnings: string[] = [];
  let score = 0;
  const maxScore = 100;

  if (!property.name || property.name.trim() === '') {
    missingFields.push('اسم العقار');
  } else {
    score += 10;
  }

  if (!property.location || property.location.trim() === '') {
    missingFields.push('الموقع');
  } else {
    score += 10;
  }

  if (!property.city || property.city.trim() === '') {
    missingFields.push('المنطقة/المدينة');
  } else {
    score += 10;
  }

  if (!property.type || property.type.trim() === '') {
    missingFields.push('نوع العقار');
  } else {
    score += 10;
  }

  const facilities = property.facilities || [];
  if (!facilities || facilities.length === 0) {
    missingFields.push('المرافق');
  } else {
    score += 20;
  }

  // 3. الصور (30 نقطة) - على الأقل 3 صور
  // Prefer live R2 count over stale property doc fields
  let imageCount = 0;
  if (typeof r2ImageCount === 'number' && Number.isFinite(r2ImageCount) && r2ImageCount >= 0) {
    imageCount = r2ImageCount;
  } else if (property.imageUrls && Array.isArray(property.imageUrls) && property.imageUrls.length > 0) {
    imageCount = property.imageUrls.length;
  } else if (property.imagesLink) {
    if (property.images && Array.isArray(property.images)) {
      imageCount = property.images.length;
    } else if (property.localImages && Array.isArray(property.localImages)) {
      imageCount = property.localImages.length;
    } else {
      imageCount = 3;
    }
  }

  if (imageCount < 3) {
    missingFields.push(`الصور (${imageCount}/3 كحد أدنى)`);
  } else {
    score += 30;
  }

  const prices = property.prices || {};
  const hasAnyPrice = prices.weekday || prices.weekend || prices.overnight ||
    property.priceWeekdays || property.priceWeekend || property.priceNight;
  if (!hasAnyPrice) {
    warnings.push('لم يتم تحديد أي سعر');
  } else {
    score += 10;
  }

  if (!property.direction || property.direction.trim() === '') {
    warnings.push('الاتجاه غير محدد');
  }

  return {
    isComplete: missingFields.length === 0,
    missingFields,
    warnings,
    completionScore: Math.round((score / maxScore) * 100)
  };
}

// ─── Test Helpers ──────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${testName}`);
    failed++;
  }
}

function assertIncludes(arr: string[], text: string, testName: string) {
  const found = arr.some(s => s.includes(text));
  if (found) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${testName} — array: [${arr.join(', ')}]`);
    failed++;
  }
}

// ─── Base complete property ────────────────────────────────────────────────
const completeProperty = {
  name: "شاليه الورد",
  location: "https://maps.google.com/...",
  city: "بريدة",
  type: "قسم",
  facilities: ["مسبح", "مطبخ", "شواء"],
  prices: { weekday: "300", weekend: "500", overnight: "200", holidays: "600" },
  direction: "شمال",
};

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 1: R2 image count provided
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n═══ SCENARIO 1: R2 image count provided ═══");

{
  // 1a: R2 says 5 images → should pass
  const result = await checkPropertyDataComplete(completeProperty, 5);
  assert(result.isComplete, "1a: r2ImageCount=5 → isComplete=true");
  assert(!result.missingFields.some(f => f.includes('الصور')), "1a: no image missing field");
  assert(result.completionScore === 100, "1a: score=100");
}

{
  // 1b: R2 says 0 images → should fail with (0/3)
  const result = await checkPropertyDataComplete(completeProperty, 0);
  assert(!result.isComplete, "1b: r2ImageCount=0 → isComplete=false");
  assertIncludes(result.missingFields, "الصور (0/3", "1b: missing images (0/3)");
  assert(result.completionScore === 70, "1b: score=70 (no image points)");
}

{
  // 1c: R2 says 2 images → should fail with (2/3)
  const result = await checkPropertyDataComplete(completeProperty, 2);
  assert(!result.isComplete, "1c: r2ImageCount=2 → isComplete=false");
  assertIncludes(result.missingFields, "الصور (2/3", "1c: missing images (2/3)");
}

{
  // 1d: R2 says exactly 3 images → should pass
  const result = await checkPropertyDataComplete(completeProperty, 3);
  assert(result.isComplete, "1d: r2ImageCount=3 → isComplete=true");
  assert(result.completionScore === 100, "1d: score=100");
}

{
  // 1e: R2 says 10 images → should pass
  const result = await checkPropertyDataComplete(completeProperty, 10);
  assert(result.isComplete, "1e: r2ImageCount=10 → isComplete=true");
  assert(result.completionScore === 100, "1e: score=100");
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 2: R2 overrides stale property doc fields
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n═══ SCENARIO 2: R2 overrides stale property doc fields ═══");

{
  // 2a: Property has imagesLink (truthy) with images array, but R2 says 0
  const propWithLegacy = {
    ...completeProperty,
    imagesLink: "https://drive.google.com/folder/abc",
    images: ["img1.jpg", "img2.jpg", "img3.jpg", "img4.jpg"],
  };
  const result = await checkPropertyDataComplete(propWithLegacy, 0);
  assert(!result.isComplete, "2a: R2=0 overrides legacy images[4] → isComplete=false");
  assertIncludes(result.missingFields, "الصور (0/3", "2a: uses R2 count (0), not legacy");
}

{
  // 2b: Property has NO imagesLink, but R2 says 5 → should pass
  const propNoImagesLink = {
    ...completeProperty,
    // no imagesLink, no images, no localImages
  };
  const result = await checkPropertyDataComplete(propNoImagesLink, 5);
  assert(result.isComplete, "2b: R2=5 with no imagesLink → isComplete=true");
  assert(result.completionScore === 100, "2b: score=100");
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 3: No R2 count — legacy fallback chain
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n═══ SCENARIO 3: No R2 count — legacy fallback chain ═══");

{
  // 3a: imageUrls has 4 items → should use imageUrls.length
  const prop = {
    ...completeProperty,
    imageUrls: ["a.jpg", "b.jpg", "c.jpg", "d.jpg"],
  };
  const result = await checkPropertyDataComplete(prop);
  assert(result.isComplete, "3a: imageUrls[4] → isComplete=true");
  assert(result.completionScore === 100, "3a: score=100");
}

{
  // 3b: imageUrls empty array → should NOT use it (length === 0)
  const prop = {
    ...completeProperty,
    imageUrls: [],
  };
  const result = await checkPropertyDataComplete(prop);
  assert(!result.isComplete, "3b: imageUrls=[] → isComplete=false");
  assertIncludes(result.missingFields, "الصور (0/3", "3b: missing images (0/3)");
}

{
  // 3c: imagesLink truthy, images array with 5 items → use images.length
  const prop = {
    ...completeProperty,
    imagesLink: "https://drive.google.com/folder/abc",
    images: ["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg"],
  };
  const result = await checkPropertyDataComplete(prop);
  assert(result.isComplete, "3c: imagesLink + images[5] → isComplete=true");
}

{
  // 3d: imagesLink truthy, localImages with 3 items → use localImages.length
  const prop = {
    ...completeProperty,
    imagesLink: "https://drive.google.com/folder/abc",
    localImages: ["local1.jpg", "local2.jpg", "local3.jpg"],
  };
  const result = await checkPropertyDataComplete(prop);
  assert(result.isComplete, "3d: imagesLink + localImages[3] → isComplete=true");
}

{
  // 3e: imagesLink truthy, no images array → defaults to 3
  const prop = {
    ...completeProperty,
    imagesLink: "https://drive.google.com/folder/abc",
    // no images, no localImages
  };
  const result = await checkPropertyDataComplete(prop);
  assert(result.isComplete, "3e: imagesLink only → defaults to 3 → isComplete=true");
}

{
  // 3f: No imagesLink, no imageUrls, no images → imageCount=0
  const prop = {
    ...completeProperty,
    // nothing image-related
  };
  const result = await checkPropertyDataComplete(prop);
  assert(!result.isComplete, "3f: no image fields → isComplete=false");
  assertIncludes(result.missingFields, "الصور (0/3", "3f: missing images (0/3)");
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 4: Property is missing other fields
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n═══ SCENARIO 4: Property missing other fields ═══");

{
  // 4a: Missing name
  const prop = { ...completeProperty, name: "" };
  const result = await checkPropertyDataComplete(prop, 5);
  assert(!result.isComplete, "4a: missing name → isComplete=false");
  assertIncludes(result.missingFields, "اسم العقار", "4a: name in missingFields");
}

{
  // 4b: Missing city
  const prop = { ...completeProperty, city: "" };
  const result = await checkPropertyDataComplete(prop, 5);
  assert(!result.isComplete, "4b: missing city → isComplete=false");
  assertIncludes(result.missingFields, "المنطقة/المدينة", "4b: city in missingFields");
}

{
  // 4c: Missing type
  const prop = { ...completeProperty, type: "" };
  const result = await checkPropertyDataComplete(prop, 5);
  assert(!result.isComplete, "4c: missing type → isComplete=false");
  assertIncludes(result.missingFields, "نوع العقار", "4c: type in missingFields");
}

{
  // 4d: Missing location
  const prop = { ...completeProperty, location: "" };
  const result = await checkPropertyDataComplete(prop, 5);
  assert(!result.isComplete, "4d: missing location → isComplete=false");
  assertIncludes(result.missingFields, "الموقع", "4d: location in missingFields");
}

{
  // 4e: Missing facilities
  const prop = { ...completeProperty, facilities: [] };
  const result = await checkPropertyDataComplete(prop, 5);
  assert(!result.isComplete, "4e: missing facilities → isComplete=false");
  assertIncludes(result.missingFields, "المرافق", "4e: facilities in missingFields");
}

{
  // 4f: Missing everything
  const prop = { name: "", location: "", city: "", type: "", facilities: [] };
  const result = await checkPropertyDataComplete(prop, 0);
  assert(!result.isComplete, "4f: missing everything → isComplete=false");
  assert(result.missingFields.length === 6, `4f: 6 missing fields (got ${result.missingFields.length})`);
  assert(result.completionScore === 0, "4f: score=0");
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 5: Edge cases
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n═══ SCENARIO 5: Edge cases ═══");

{
  // 5a: r2ImageCount is undefined (not passed) — same as no R2
  const result = await checkPropertyDataComplete(completeProperty, undefined);
  assert(!result.isComplete, "5a: r2ImageCount=undefined → image fallback to 0");
}

{
  // 5b: r2ImageCount is NaN — should be rejected by Number.isFinite guard
  const result = await checkPropertyDataComplete(completeProperty, NaN);
  const imageFieldInMissing = result.missingFields.some(f => f.includes('الصور'));
  assert(imageFieldInMissing, "5b: r2ImageCount=NaN → correctly rejected (falls back to 0)");
}

{
  // 5c: r2ImageCount is negative → should fail
  const result = await checkPropertyDataComplete(completeProperty, -1);
  assertIncludes(result.missingFields, "الصور", "5c: negative count → missing images");
}

{
  // 5d: r2ImageCount is very large
  const result = await checkPropertyDataComplete(completeProperty, 9999);
  assert(result.isComplete, "5d: r2ImageCount=9999 → isComplete=true");
}

{
  // 5e: imagesLink is empty string (falsy) — should NOT enter the block
  const prop = {
    ...completeProperty,
    imagesLink: "",
  };
  const result = await checkPropertyDataComplete(prop);
  assert(!result.isComplete, "5e: imagesLink='' → imageCount=0");
  assertIncludes(result.missingFields, "الصور (0/3", "5e: missing images (0/3)");
}

{
  // 5f: imagesLink is null — should NOT enter the block
  const prop = {
    ...completeProperty,
    imagesLink: null,
  };
  const result = await checkPropertyDataComplete(prop);
  assert(!result.isComplete, "5f: imagesLink=null → imageCount=0");
}

{
  // 5g: prices are at top-level (flat format) — should detect prices
  const prop = {
    ...completeProperty,
    prices: {},
    priceWeekdays: "300",
    priceWeekend: "500",
    priceNight: "200",
  };
  const result = await checkPropertyDataComplete(prop, 5);
  assert(result.isComplete, "5g: flat price fields → detected as hasAnyPrice");
}

{
  // 5h: Whitespace-only name → should fail
  const prop = { ...completeProperty, name: "   " };
  const result = await checkPropertyDataComplete(prop, 5);
  assert(!result.isComplete, "5h: whitespace name → isComplete=false");
  assertIncludes(result.missingFields, "اسم العقار", "5h: name in missingFields");
}

{
  // 5i: Direction is warning-only, not blocking
  const prop = { ...completeProperty, direction: "" };
  const result = await checkPropertyDataComplete(prop, 5);
  assert(result.isComplete, "5i: no direction → still isComplete=true (warning only)");
  assert(result.warnings.some(w => w.includes('الاتجاه')), "5i: direction in warnings");
}

{
  // 5j: imageUrls is a string (not array) — should not count
  const prop = {
    ...completeProperty,
    imageUrls: "not-an-array" as any,
  };
  const result = await checkPropertyDataComplete(prop);
  assert(!result.isComplete, "5j: imageUrls=string → isComplete=false");
}

// ═══════════════════════════════════════════════════════════════════════════
// SCENARIO 6: Priority chain verification
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n═══ SCENARIO 6: Priority chain verification ═══");

{
  // 6a: R2=0 + imageUrls=[1,2,3,4] + imagesLink with images[5] → R2 wins (0)
  const prop = {
    ...completeProperty,
    imageUrls: ["a.jpg", "b.jpg", "c.jpg", "d.jpg"],
    imagesLink: "https://drive.google.com/folder/abc",
    images: ["i1.jpg", "i2.jpg", "i3.jpg", "i4.jpg", "i5.jpg"],
  };
  const result = await checkPropertyDataComplete(prop, 0);
  assert(!result.isComplete, "6a: R2=0 overrides all legacy → isComplete=false");
  assertIncludes(result.missingFields, "الصور (0/3", "6a: uses R2 count (0)");
}

{
  // 6b: No R2 + imageUrls=[1,2] + imagesLink with images[4] → imageUrls wins (2)
  const prop = {
    ...completeProperty,
    imageUrls: ["a.jpg", "b.jpg"],
    imagesLink: "https://drive.google.com/folder/abc",
    images: ["i1.jpg", "i2.jpg", "i3.jpg", "i4.jpg"],
  };
  const result = await checkPropertyDataComplete(prop);
  // No r2ImageCount passed → falls to imageUrls check → length=2
  assert(!result.isComplete, "6b: imageUrls[2] wins over images[4] → isComplete=false");
  assertIncludes(result.missingFields, "الصور (2/3", "6b: uses imageUrls count (2)");
}

{
  // 6c: No R2 + no imageUrls + imagesLink with localImages[4] → localImages wins (4)
  const prop = {
    ...completeProperty,
    imagesLink: "https://drive.google.com/folder/abc",
    localImages: ["l1.jpg", "l2.jpg", "l3.jpg", "l4.jpg"],
    // no imageUrls, no images
  };
  const result = await checkPropertyDataComplete(prop);
  assert(result.isComplete, "6c: localImages[4] via imagesLink → isComplete=true");
}

// ═══════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n" + "═".repeat(60));
console.log(`RESULTS: ${passed} passed, ${failed} failed out of ${passed + failed} total`);
if (failed === 0) {
  console.log("🎉 ALL TESTS PASSED!");
} else {
  console.log(`⚠️  ${failed} TESTS FAILED`);
}
console.log("═".repeat(60));

process.exit(failed > 0 ? 1 : 0);
