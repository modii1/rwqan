/**
 * Comprehensive Smart Verification Test Suite
 * Run: npx tsx scripts/test-smart-verification-full.ts
 */

// ═══════════════════════════════════════════════════════════════════════════
// Inlined functions (to avoid module resolution issues)
// ═══════════════════════════════════════════════════════════════════════════

const SENSITIVE_FIELDS = ['location', 'city', 'type', 'imagesLink', 'images'];

async function checkPropertyDataComplete(property: any, r2ImageCount?: number) {
  const missingFields: string[] = [];
  const warnings: string[] = [];
  let score = 0;
  const maxScore = 100;

  if (!property.name || property.name.trim() === '') missingFields.push('اسم العقار');
  else score += 10;

  if (!property.location || property.location.trim() === '') missingFields.push('الموقع');
  else score += 10;

  if (!property.city || property.city.trim() === '') missingFields.push('المنطقة/المدينة');
  else score += 10;

  if (!property.type || property.type.trim() === '') missingFields.push('نوع العقار');
  else score += 10;

  const facilities = property.facilities || [];
  if (!facilities || facilities.length === 0) missingFields.push('المرافق');
  else score += 20;

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

  if (imageCount < 3) missingFields.push(`الصور (${imageCount}/3 كحد أدنى)`);
  else score += 30;

  const prices = property.prices || {};
  const hasAnyPrice = prices.weekday || prices.weekend || prices.overnight ||
    property.priceWeekdays || property.priceWeekend || property.priceNight;
  if (!hasAnyPrice) warnings.push('لم يتم تحديد أي سعر');
  else score += 10;

  if (!property.direction || property.direction.trim() === '') warnings.push('الاتجاه غير محدد');

  return { isComplete: missingFields.length === 0, missingFields, warnings, completionScore: Math.round((score / maxScore) * 100) };
}

function detectSensitiveChanges(oldProperty: any, newData: any): string[] {
  const changes: string[] = [];
  for (const field of SENSITIVE_FIELDS) {
    const oldValue = oldProperty[field];
    const newValue = newData[field];
    if (newValue !== undefined && JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      changes.push(field);
    }
  }
  return changes;
}

async function smartVerification(context: any) {
  const { property, paymentRecord, ocrResult, secondProperty, isSensitiveUpdate, previousVerificationStatus, r2ImageCount } = context;
  const notes: string[] = [];
  let adminRequired = false;
  let canAutoActivate = false;

  const dataCheck = await checkPropertyDataComplete(property, r2ImageCount);
  const subscriptionType = property.subscriptionType || 'عادي';
  const isPremium = subscriptionType === 'مميز';

  let aiConfidence = dataCheck.completionScore;
  if (ocrResult) aiConfidence = Math.round((aiConfidence + ocrResult.confidence) / 2);

  let verificationStatus: any = 'pending';
  let paymentStatus: any = 'غير مطلوب';
  let subscriptionStatus: any = 'غير مفعل';

  if (!dataCheck.isComplete) {
    verificationStatus = 'incomplete';
    paymentStatus = 'مرفوض';
    notes.push(`حقول ناقصة: ${dataCheck.missingFields.join('، ')}`);
  } else if (paymentRecord?.paymentMethod === 'bank_transfer' && ocrResult) {
    if (ocrResult.confidence >= 90 && ocrResult.matched) {
      verificationStatus = 'approved';
      paymentStatus = 'مكتمل';
      subscriptionStatus = 'نشط';
      notes.push(`تم التحقق تلقائياً - نسبة الثقة: ${ocrResult.confidence}%`);
      canAutoActivate = true;
    } else {
      verificationStatus = 'rejected';
      paymentStatus = 'مرفوض';
      notes.push(`نسبة الثقة منخفضة: ${ocrResult.confidence}% - تم الرفض`);
    }
  } else if (paymentRecord?.status === 'completed' || paymentRecord?.status === 'مكتمل') {
    if (dataCheck.isComplete) {
      verificationStatus = 'approved';
      paymentStatus = 'مكتمل';
      subscriptionStatus = isPremium ? 'نشط' : 'نشط مجاني';
      notes.push('الدفع مكتمل والبيانات كاملة - تفعيل تلقائي');
      canAutoActivate = true;
    }
  } else if (isSensitiveUpdate && previousVerificationStatus === 'approved') {
    if (dataCheck.isComplete && dataCheck.completionScore >= 80) {
      verificationStatus = 'verified';
      notes.push('تعديل حساس - تم قبوله تلقائياً لأن البيانات مكتملة');
      canAutoActivate = true;
    } else {
      verificationStatus = 'rejected';
      notes.push('تعديل حساس - البيانات غير مكتملة - تم الرفض');
    }
  } else if (secondProperty) {
    const secondDataCheck = await checkPropertyDataComplete(secondProperty, r2ImageCount);
    if (dataCheck.isComplete && secondDataCheck.isComplete) {
      verificationStatus = 'approved';
      notes.push('باقة العقارين - كلا العقارين مكتملين - تفعيل تلقائي');
      canAutoActivate = true;
    } else {
      verificationStatus = 'incomplete';
      if (!dataCheck.isComplete) notes.push(`العقار الأول: ${dataCheck.missingFields.join('، ')}`);
      if (!secondDataCheck.isComplete) notes.push(`العقار الثاني: ${secondDataCheck.missingFields.join('، ')}`);
    }
  } else if (dataCheck.isComplete && dataCheck.completionScore === 100) {
    verificationStatus = 'verified';
    notes.push('البيانات مكتملة 100% - جاهز للتفعيل');
    canAutoActivate = true;
  } else {
    verificationStatus = 'rejected';
    notes.push('البيانات غير مكتملة - تم الرفض');
  }

  if (dataCheck.warnings.length > 0) notes.push(`تحذيرات: ${dataCheck.warnings.join('، ')}`);

  return { verificationStatus, paymentStatus, subscriptionStatus, aiConfidence, adminRequired, notes, canAutoActivate };
}

// ═══════════════════════════════════════════════════════════════════════════
// Test infrastructure
// ═══════════════════════════════════════════════════════════════════════════
interface TestCase {
  id: string;
  category: string;
  description: string;
  expected: string;
  actual: string;
  pass: boolean;
}

const results: TestCase[] = [];
let nextId = 1;

function test(category: string, description: string, expected: string, actual: string, pass: boolean) {
  results.push({ id: `TC-${String(nextId++).padStart(3, '0')}`, category, description, expected, actual, pass });
}

// ═══════════════════════════════════════════════════════════════════════════
// Base property (all fields present)
// ═══════════════════════════════════════════════════════════════════════════
const base = {
  name: "شاليه الورد",
  location: "https://maps.google.com/...",
  city: "بريدة",
  type: "قسم",
  facilities: ["مسبح", "مطبخ", "شواء"],
  prices: { weekday: "300", weekend: "500", overnight: "200", holidays: "600" },
  direction: "شمال",
};

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 1: Image Check — R2 Count
// ═══════════════════════════════════════════════════════════════════════════
async function testImageR2() {
  const cat = "Image Check — R2 Count";

  let r = await checkPropertyDataComplete(base, 5);
  test(cat, "R2=5 → complete", "true", `${r.isComplete}`, r.isComplete === true);

  r = await checkPropertyDataComplete(base, 0);
  test(cat, "R2=0 → incomplete", "false", `${r.isComplete}`, r.isComplete === false);
  test(cat, "R2=0 → shows (0/3)", "(0/3)", r.missingFields.find(f => f.includes('(0')) || "", r.missingFields.some(f => f.includes('(0')));

  r = await checkPropertyDataComplete(base, 2);
  test(cat, "R2=2 → incomplete", "false", `${r.isComplete}`, r.isComplete === false);
  test(cat, "R2=2 → shows (2/3)", "(2/3)", r.missingFields.find(f => f.includes('(2')) || "", r.missingFields.some(f => f.includes('(2')));

  r = await checkPropertyDataComplete(base, 3);
  test(cat, "R2=3 → complete (boundary)", "true", `${r.isComplete}`, r.isComplete === true);

  r = await checkPropertyDataComplete(base, 1);
  test(cat, "R2=1 → incomplete", "false", `${r.isComplete}`, r.isComplete === false);

  r = await checkPropertyDataComplete(base, 100);
  test(cat, "R2=100 → complete", "true", `${r.isComplete}`, r.isComplete === true);

  r = await checkPropertyDataComplete(base, 999);
  test(cat, "R2=999 → complete", "true", `${r.isComplete}`, r.isComplete === true);
}

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 2: Image Check — Edge Cases
// ═══════════════════════════════════════════════════════════════════════════
async function testImageEdgeCases() {
  const cat = "Image Check — Edge Cases";

  let r = await checkPropertyDataComplete(base, undefined);
  test(cat, "R2=undefined → no R2 count, no legacy → 0", "false", `${r.isComplete}`, r.isComplete === false);

  r = await checkPropertyDataComplete(base, NaN);
  test(cat, "R2=NaN → rejected by guard → 0", "false", `${r.isComplete}`, r.isComplete === false);

  r = await checkPropertyDataComplete(base, -1);
  test(cat, "R2=-1 → rejected by >=0 guard → 0", "false", `${r.isComplete}`, r.isComplete === false);

  r = await checkPropertyDataComplete(base, Infinity);
  test(cat, "R2=Infinity → rejected by isFinite", "false", `${r.isComplete}`, r.isComplete === false);

  r = await checkPropertyDataComplete(base, -Infinity);
  test(cat, "R2=-Infinity → rejected by isFinite", "false", `${r.isComplete}`, r.isComplete === false);

  r = await checkPropertyDataComplete(base, 0.5);
  test(cat, "R2=0.5 → passes guard, 0.5 < 3 → incomplete", "false", `${r.isComplete}`, r.isComplete === false);
}

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 3: Image Check — Priority Chain
// ═══════════════════════════════════════════════════════════════════════════
async function testImagePriorityChain() {
  const cat = "Image Check — Priority Chain";

  // R2 wins over all legacy
  let prop = { ...base, imagesLink: "https://x", images: ["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg"], imageUrls: ["a.jpg", "b.jpg", "c.jpg", "d.jpg"] };
  let r = await checkPropertyDataComplete(prop, 0);
  test(cat, "R2=0 overrides imagesLink+images[5]+imageUrls[4]", "false", `${r.isComplete}`, r.isComplete === false);

  r = await checkPropertyDataComplete(prop, 5);
  test(cat, "R2=5 overrides imagesLink+images[5]+imageUrls[4]", "true", `${r.isComplete}`, r.isComplete === true);

  // No R2 → imageUrls wins
  prop = { ...base, imageUrls: ["a.jpg", "b.jpg"], imagesLink: "https://x", images: ["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg"] };
  r = await checkPropertyDataComplete(prop);
  test(cat, "No R2, imageUrls[2] wins over images[5]", "false", `${r.isComplete}`, r.isComplete === false);

  // No R2, no imageUrls → imagesLink + images
  prop = { ...base, imagesLink: "https://x", images: ["1.jpg", "2.jpg", "3.jpg"] };
  r = await checkPropertyDataComplete(prop);
  test(cat, "No R2, no imageUrls, imagesLink+images[3]", "true", `${r.isComplete}`, r.isComplete === true);

  // No R2, no imageUrls, imagesLink + localImages
  prop = { ...base, imagesLink: "https://x", localImages: ["l1.jpg", "l2.jpg", "l3.jpg"] };
  r = await checkPropertyDataComplete(prop);
  test(cat, "No R2, no imageUrls, imagesLink+localImages[3]", "true", `${r.isComplete}`, r.isComplete === true);

  // No R2, no imageUrls, imagesLink only → defaults to 3
  prop = { ...base, imagesLink: "https://x" };
  r = await checkPropertyDataComplete(prop);
  test(cat, "No R2, no imageUrls, imagesLink only → defaults 3", "true", `${r.isComplete}`, r.isComplete === true);

  // Nothing → 0
  prop = { ...base };
  r = await checkPropertyDataComplete(prop);
  test(cat, "No R2, no imageUrls, no imagesLink → 0", "false", `${r.isComplete}`, r.isComplete === false);

  // imageUrls empty → falls through
  prop = { ...base, imageUrls: [] };
  r = await checkPropertyDataComplete(prop);
  test(cat, "imageUrls=[] → falls through to 0", "false", `${r.isComplete}`, r.isComplete === false);

  // imageUrls is string (not array) → falls through
  prop = { ...base, imageUrls: "not-an-array" };
  r = await checkPropertyDataComplete(prop);
  test(cat, "imageUrls=string → falls through to 0", "false", `${r.isComplete}`, r.isComplete === false);

  // imagesLink empty string → falsy → falls through
  prop = { ...base, imagesLink: "" };
  r = await checkPropertyDataComplete(prop);
  test(cat, "imagesLink='' → falls through to 0", "false", `${r.isComplete}`, r.isComplete === false);

  // imagesLink null → falsy → falls through
  prop = { ...base, imagesLink: null };
  r = await checkPropertyDataComplete(prop);
  test(cat, "imagesLink=null → falls through to 0", "false", `${r.isComplete}`, r.isComplete === false);
}

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 4: Basic Field Checks
// ═══════════════════════════════════════════════════════════════════════════
async function testBasicFields() {
  const cat = "Basic Fields";

  // All present
  let r = await checkPropertyDataComplete(base, 5);
  test(cat, "All fields present → complete", "true", `${r.isComplete}`, r.isComplete === true);
  test(cat, "All fields → score=100", "100", `${r.completionScore}`, r.completionScore === 100);

  // name
  r = await checkPropertyDataComplete({ ...base, name: "" }, 5);
  test(cat, "name='' → incomplete", "false", `${r.isComplete}`, r.isComplete === false);
  test(cat, "name='' → missing includes اسم العقار", "true", `${r.missingFields.some(f => f.includes('اسم العقار'))}`, r.missingFields.some(f => f.includes('اسم العقار')));

  r = await checkPropertyDataComplete({ ...base, name: "   " }, 5);
  test(cat, "name='   ' → incomplete", "false", `${r.isComplete}`, r.isComplete === false);

  r = await checkPropertyDataComplete({ ...base, name: null }, 5);
  test(cat, "name=null → incomplete", "false", `${r.isComplete}`, r.isComplete === false);

  r = await checkPropertyDataComplete({ ...base, name: undefined }, 5);
  test(cat, "name=undefined → incomplete", "false", `${r.isComplete}`, r.isComplete === false);

  // location
  r = await checkPropertyDataComplete({ ...base, location: "" }, 5);
  test(cat, "location='' → missing الموقع", "true", `${r.missingFields.some(f => f.includes('الموقع'))}`, r.missingFields.some(f => f.includes('الموقع')));

  // city
  r = await checkPropertyDataComplete({ ...base, city: "" }, 5);
  test(cat, "city='' → missing المنطقة/المدينة", "true", `${r.missingFields.some(f => f.includes('المنطقة'))}`, r.missingFields.some(f => f.includes('المنطقة')));

  // type
  r = await checkPropertyDataComplete({ ...base, type: "" }, 5);
  test(cat, "type='' → missing نوع العقار", "true", `${r.missingFields.some(f => f.includes('نوع العقار'))}`, r.missingFields.some(f => f.includes('نوع العقار')));

  // facilities
  r = await checkPropertyDataComplete({ ...base, facilities: [] }, 5);
  test(cat, "facilities=[] → missing المرافق", "true", `${r.missingFields.some(f => f.includes('المرافق'))}`, r.missingFields.some(f => f.includes('المرافق')));

  r = await checkPropertyDataComplete({ ...base, facilities: undefined }, 5);
  test(cat, "facilities=undefined → missing المرافق", "true", `${r.missingFields.some(f => f.includes('المرافق'))}`, r.missingFields.some(f => f.includes('المرافق')));

  r = await checkPropertyDataComplete({ ...base, facilities: ["مسبح"] }, 5);
  test(cat, "facilities=[1 item] → has المرافق", "true", `${!r.missingFields.some(f => f.includes('المرافق'))}`, !r.missingFields.some(f => f.includes('المرافق')));

  // All missing
  r = await checkPropertyDataComplete({ name: "", location: "", city: "", type: "", facilities: [] }, 0);
  test(cat, "All 6 fields missing → 6 missing fields", "6", `${r.missingFields.length}`, r.missingFields.length === 6);
  test(cat, "All 6 fields missing → score=0", "0", `${r.completionScore}`, r.completionScore === 0);

  // Score with partial fields (name + city + facilities + images from R2)
  r = await checkPropertyDataComplete({ ...base, location: "", type: "" }, 5);
  test(cat, "Missing location+type → score=80 (10+10+20+30+10)", "80", `${r.completionScore}`, r.completionScore === 80);
}

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 5: Warnings (non-blocking)
// ═══════════════════════════════════════════════════════════════════════════
async function testWarnings() {
  const cat = "Warnings (non-blocking)";

  // No prices → warning only
  let r = await checkPropertyDataComplete({ ...base, prices: {} }, 5);
  test(cat, "No prices → warning, still complete", "true", `${r.isComplete}`, r.isComplete === true);
  test(cat, "No prices → has price warning", "true", `${r.warnings.some(w => w.includes('سعر'))}`, r.warnings.some(w => w.includes('سعر')));

  // With prices → no warning
  r = await checkPropertyDataComplete(base, 5);
  test(cat, "With prices → no price warning", "false", `${r.warnings.some(w => w.includes('سعر'))}`, !r.warnings.some(w => w.includes('سعر')));

  // Flat price fields
  r = await checkPropertyDataComplete({ ...base, prices: {}, priceWeekdays: "300" }, 5);
  test(cat, "Flat priceWeekdays → no price warning", "false", `${r.warnings.some(w => w.includes('سعر'))}`, !r.warnings.some(w => w.includes('سعر')));

  // No direction → warning only
  r = await checkPropertyDataComplete({ ...base, direction: "" }, 5);
  test(cat, "No direction → warning, still complete", "true", `${r.isComplete}`, r.isComplete === true);
  test(cat, "No direction → has direction warning", "true", `${r.warnings.some(w => w.includes('الاتجاه'))}`, r.warnings.some(w => w.includes('الاتجاه')));

  // With direction → no warning
  r = await checkPropertyDataComplete(base, 5);
  test(cat, "With direction → no direction warning", "false", `${r.warnings.some(w => w.includes('الاتجاه'))}`, !r.warnings.some(w => w.includes('الاتجاه')));

  // Both warnings
  r = await checkPropertyDataComplete({ ...base, prices: {}, direction: "" }, 5);
  test(cat, "No prices + no direction → 2 warnings", "2", `${r.warnings.length}`, r.warnings.length === 2);
}

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 6: Score Calculation
// ═══════════════════════════════════════════════════════════════════════════
async function testScores() {
  const cat = "Score Calculation";

  // Full score: 10+10+10+10+20+30+10 = 100
  let r = await checkPropertyDataComplete(base, 5);
  test(cat, "All fields + images + prices → score=100", "100", `${r.completionScore}`, r.completionScore === 100);

  // No images: 10+10+10+10+20+0+10 = 70
  r = await checkPropertyDataComplete(base, 0);
  test(cat, "No images → score=70", "70", `${r.completionScore}`, r.completionScore === 70);

  // No prices: 10+10+10+10+20+30+0 = 90
  r = await checkPropertyDataComplete({ ...base, prices: {} }, 5);
  test(cat, "No prices → score=90", "90", `${r.completionScore}`, r.completionScore === 90);

  // Only name: 10
  r = await checkPropertyDataComplete({ ...base, location: "", city: "", type: "", facilities: [], prices: {}, direction: "" }, 0);
  test(cat, "Only name → score=10", "10", `${r.completionScore}`, r.completionScore === 10);

  // name + city: 20
  r = await checkPropertyDataComplete({ ...base, location: "", type: "", facilities: [], prices: {}, direction: "" }, 0);
  test(cat, "name+city → score=20", "20", `${r.completionScore}`, r.completionScore === 20);
}

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 7: detectSensitiveChanges
// ═══════════════════════════════════════════════════════════════════════════
async function testSensitiveChanges() {
  const cat = "detectSensitiveChanges";

  let changes = detectSensitiveChanges({ city: "بريدة" }, { city: "عنيزة" });
  test(cat, "City changed → detects", "city", changes.join(","), changes.includes('city'));

  changes = detectSensitiveChanges({ city: "بريدة" }, { city: "بريدة" });
  test(cat, "City same → no change", "0", `${changes.length}`, changes.length === 0);

  changes = detectSensitiveChanges({ location: "A" }, { location: "B" });
  test(cat, "Location changed → detects", "location", changes.join(","), changes.includes('location'));

  changes = detectSensitiveChanges({ type: "قسم" }, { type: "قسمين" });
  test(cat, "Type changed → detects", "type", changes.join(","), changes.includes('type'));

  changes = detectSensitiveChanges({ imagesLink: "A" }, { imagesLink: "B" });
  test(cat, "imagesLink changed → detects", "imagesLink", changes.join(","), changes.includes('imagesLink'));

  changes = detectSensitiveChanges({ images: ["a"] }, { images: ["b"] });
  test(cat, "images changed → detects", "images", changes.join(","), changes.includes('images'));

  changes = detectSensitiveChanges({ city: "بريدة" }, { name: "شاليه" });
  test(cat, "Non-sensitive field changed → no detection", "0", `${changes.length}`, changes.length === 0);

  changes = detectSensitiveChanges({}, {});
  test(cat, "Both empty → no changes", "0", `${changes.length}`, changes.length === 0);

  changes = detectSensitiveChanges({ city: "بريدة", location: "A", type: "قسم" }, { city: "عنيزة", location: "B", type: "قسمين" });
  test(cat, "All 3 sensitive changed → detects 3", "3", `${changes.length}`, changes.length === 3);
}

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 8: smartVerification Decision Branches
// ═══════════════════════════════════════════════════════════════════════════
async function testSmartVerification() {
  const cat = "smartVerification";

  // 1. Incomplete data → incomplete/rejected
  let r = await smartVerification({ property: { ...base, name: "" } });
  test(cat, "Incomplete data → status=incomplete", "incomplete", r.verificationStatus, r.verificationStatus === 'incomplete');
  test(cat, "Incomplete data → payment=مرفوض", "مرفوض", r.paymentStatus, r.paymentStatus === 'مرفوض');
  test(cat, "Incomplete data → canAutoActivate=false", "false", `${r.canAutoActivate}`, r.canAutoActivate === false);

  // 2. Complete + bank_transfer + high OCR → approved
  r = await smartVerification({
    property: base,
    paymentRecord: { paymentMethod: "bank_transfer" },
    ocrResult: { confidence: 95, matched: true },
    r2ImageCount: 5
  });
  test(cat, "Complete + bank + OCR 95% → approved", "approved", r.verificationStatus, r.verificationStatus === 'approved');
  test(cat, "Complete + bank + OCR 95% → payment=مكتمل", "مكتمل", r.paymentStatus, r.paymentStatus === 'مكتمل');
  test(cat, "Complete + bank + OCR 95% → canAutoActivate=true", "true", `${r.canAutoActivate}`, r.canAutoActivate === true);

  // 3. Complete + bank_transfer + low OCR → rejected
  r = await smartVerification({
    property: base,
    paymentRecord: { paymentMethod: "bank_transfer" },
    ocrResult: { confidence: 50, matched: false },
    r2ImageCount: 5
  });
  test(cat, "Complete + bank + OCR 50% → rejected", "rejected", r.verificationStatus, r.verificationStatus === 'rejected');
  test(cat, "Complete + bank + OCR 50% → payment=مرفوض", "مرفوض", r.paymentStatus, r.paymentStatus === 'مرفوض');
  test(cat, "Complete + bank + OCR 50% → canAutoActivate=false", "false", `${r.canAutoActivate}`, r.canAutoActivate === false);

  // 4. Complete + bank_transfer + OCR at boundary (90)
  r = await smartVerification({
    property: base,
    paymentRecord: { paymentMethod: "bank_transfer" },
    ocrResult: { confidence: 90, matched: true },
    r2ImageCount: 5
  });
  test(cat, "Complete + bank + OCR 90% (boundary) → approved", "approved", r.verificationStatus, r.verificationStatus === 'approved');

  // 5. Complete + bank_transfer + OCR 89 (just below)
  r = await smartVerification({
    property: base,
    paymentRecord: { paymentMethod: "bank_transfer" },
    ocrResult: { confidence: 89, matched: true },
    r2ImageCount: 5
  });
  test(cat, "Complete + bank + OCR 89% → rejected (below 90)", "rejected", r.verificationStatus, r.verificationStatus === 'rejected');

  // 6. Complete + bank_transfer + OCR matched=false even at 95
  r = await smartVerification({
    property: base,
    paymentRecord: { paymentMethod: "bank_transfer" },
    ocrResult: { confidence: 95, matched: false },
    r2ImageCount: 5
  });
  test(cat, "Complete + bank + OCR 95% but matched=false → rejected", "rejected", r.verificationStatus, r.verificationStatus === 'rejected');

  // 7. Completed payment (electronic) + complete data → approved
  r = await smartVerification({
    property: base,
    paymentRecord: { status: "مكتمل" },
    r2ImageCount: 5
  });
  test(cat, "Payment مكتمل + data complete → approved", "approved", r.verificationStatus, r.verificationStatus === 'approved');
  test(cat, "Payment مكتمل → subscription=نشط مجاني (non-premium)", "نشط مجاني", r.subscriptionStatus, r.subscriptionStatus === 'نشط مجاني');

  // 8. Completed payment + non-premium → نشط مجاني
  r = await smartVerification({
    property: { ...base, subscriptionType: "عادي" },
    paymentRecord: { status: "مكتمل" },
    r2ImageCount: 5
  });
  test(cat, "Payment مكتمل + عادي → subscription=نشط مجاني", "نشط مجاني", r.subscriptionStatus, r.subscriptionStatus === 'نشط مجاني');

  // 9. Completed payment + status="completed" (English)
  r = await smartVerification({
    property: base,
    paymentRecord: { status: "completed" },
    r2ImageCount: 5
  });
  test(cat, "Payment completed (English) → approved", "approved", r.verificationStatus, r.verificationStatus === 'approved');

  // 10. Sensitive update + previously approved + score >= 80 → verified
  r = await smartVerification({
    property: base,
    isSensitiveUpdate: true,
    previousVerificationStatus: "approved",
    r2ImageCount: 5
  });
  test(cat, "Sensitive update + approved + complete → verified", "verified", r.verificationStatus, r.verificationStatus === 'verified');
  test(cat, "Sensitive update → canAutoActivate=true", "true", `${r.canAutoActivate}`, r.canAutoActivate === true);

  // 11. Sensitive update + incomplete data → rejected
  r = await smartVerification({
    property: { ...base, name: "" },
    isSensitiveUpdate: true,
    previousVerificationStatus: "approved"
  });
  test(cat, "Sensitive update + incomplete → incomplete (data check runs first)", "incomplete", r.verificationStatus, r.verificationStatus === 'incomplete');

  // 12. Sensitive update + NOT previously approved → falls through
  r = await smartVerification({
    property: base,
    isSensitiveUpdate: true,
    previousVerificationStatus: "pending",
    r2ImageCount: 5
  });
  test(cat, "Sensitive + pending prev → falls to score=100 → verified", "verified", r.verificationStatus, r.verificationStatus === 'verified');

  // 13. Two-property package + both complete → approved
  r = await smartVerification({
    property: base,
    secondProperty: { ...base, name: "شاليه ثاني" },
    r2ImageCount: 5
  });
  test(cat, "Two props both complete → approved", "approved", r.verificationStatus, r.verificationStatus === 'approved');
  test(cat, "Two props → canAutoActivate=true", "true", `${r.canAutoActivate}`, r.canAutoActivate === true);

  // 14. Two-property package + first incomplete → incomplete
  r = await smartVerification({
    property: { ...base, name: "" },
    secondProperty: base,
    r2ImageCount: 5
  });
  test(cat, "Two props, first incomplete → incomplete", "incomplete", r.verificationStatus, r.verificationStatus === 'incomplete');

  // 15. Two-property package + second incomplete → incomplete
  r = await smartVerification({
    property: base,
    secondProperty: { ...base, name: "" },
    r2ImageCount: 5
  });
  test(cat, "Two props, second incomplete → incomplete", "incomplete", r.verificationStatus, r.verificationStatus === 'incomplete');

  // 16. Two-property package + both incomplete → incomplete
  r = await smartVerification({
    property: { ...base, name: "" },
    secondProperty: { ...base, city: "" },
    r2ImageCount: 5
  });
  test(cat, "Two props, both incomplete → incomplete", "incomplete", r.verificationStatus, r.verificationStatus === 'incomplete');

  // 17. Complete data, no payment, no sensitive, no secondProp, score=100 → verified
  r = await smartVerification({ property: base, r2ImageCount: 5 });
  test(cat, "Complete data, no payment context → verified (score=100)", "verified", r.verificationStatus, r.verificationStatus === 'verified');
  test(cat, "No context → canAutoActivate=true", "true", `${r.canAutoActivate}`, r.canAutoActivate === true);

  // 18. Complete data but score < 100 (e.g. no prices) → rejected
  r = await smartVerification({ property: { ...base, prices: {} }, r2ImageCount: 5 });
  test(cat, "Score=90 (no prices) → rejected (not 100%)", "rejected", r.verificationStatus, r.verificationStatus === 'rejected');

  // 19. AI confidence calculation
  r = await smartVerification({
    property: base,
    paymentRecord: { paymentMethod: "bank_transfer" },
    ocrResult: { confidence: 80, matched: true },
    r2ImageCount: 5
  });
  test(cat, "AI confidence = (100+80)/2 = 90", "90", `${r.aiConfidence}`, r.aiConfidence === 90);

  // 20. AI confidence without OCR = score only
  r = await smartVerification({ property: base, r2ImageCount: 5 });
  test(cat, "No OCR → aiConfidence = completionScore = 100", "100", `${r.aiConfidence}`, r.aiConfidence === 100);

  // 21. Bank transfer but no OCR result → falls through to completed check
  r = await smartVerification({
    property: base,
    paymentRecord: { paymentMethod: "bank_transfer", status: "مكتمل" },
    r2ImageCount: 5
  });
  test(cat, "Bank transfer + no OCR + payment مكتمل → approved", "approved", r.verificationStatus, r.verificationStatus === 'approved');

  // 22. OCR with confidence=0
  r = await smartVerification({
    property: base,
    paymentRecord: { paymentMethod: "bank_transfer" },
    ocrResult: { confidence: 0, matched: false },
    r2ImageCount: 5
  });
  test(cat, "OCR confidence=0 → rejected", "rejected", r.verificationStatus, r.verificationStatus === 'rejected');
}

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORY 9: Integration — R2 → checkPropertyDataComplete → smartVerification
// ═══════════════════════════════════════════════════════════════════════════
async function testIntegration() {
  const cat = "Integration";

  // Property with 0 imagesLink (Firebase) + R2 has 5 images → should pass
  // smartVerification now accepts r2ImageCount from caller
  let svResult = await smartVerification({
    property: { ...base },  // No imagesLink at all (Firebase property)
    paymentRecord: { status: "مكتمل" },
    r2ImageCount: 5
  });
  // With r2ImageCount=5, images pass → data complete → payment completed → approved
  test(cat, "Firebase prop (no imagesLink) + R2=5 → approved", "approved", svResult.verificationStatus, svResult.verificationStatus === 'approved');

  // But the callers (PaymentService, webhooks) now pass R2 count
  // So let's simulate: caller queries R2, gets 5, then passes to checkPropertyDataComplete
  const r2Count = 5;
  const dataCheck = await checkPropertyDataComplete(base, r2Count);
  test(cat, "Caller passes R2=5 → dataCheck.isComplete=true", "true", `${dataCheck.isComplete}`, dataCheck.isComplete === true);
  test(cat, "Caller passes R2=5 → no image missing", "true", `${!dataCheck.missingFields.some(f => f.includes('الصور'))}`, !dataCheck.missingFields.some(f => f.includes('الصور')));

  // Simulate PaymentService.approveBankTransfer flow:
  // 1. get property from Firebase (no imagesLink)
  // 2. query R2 → 5 images
  // 3. checkPropertyDataComplete(property, 5) → complete
  // 4. approve anyway (admin override)
  const firebaseProperty = { ...base }; // no imagesLink, no imageUrls
  const r2ImageCount = 5;
  const check = await checkPropertyDataComplete(firebaseProperty, r2ImageCount);
  test(cat, "Full flow: Firebase prop + R2=5 → passes", "true", `${check.isComplete}`, check.isComplete === true);
  test(cat, "Full flow: completionScore=100", "100", `${check.completionScore}`, check.completionScore === 100);

  // Simulate property with imagesLink but R2=0
  const propWithLegacy = { ...base, imagesLink: "https://drive.google.com/folder/abc", images: ["a.jpg", "b.jpg", "c.jpg", "d.jpg"] };
  const check2 = await checkPropertyDataComplete(propWithLegacy, 0);
  test(cat, "Legacy prop + R2=0 → R2 wins, incomplete", "false", `${check2.isComplete}`, check2.isComplete === false);
}

// ═══════════════════════════════════════════════════════════════════════════
// RUN ALL
// ═══════════════════════════════════════════════════════════════════════════
async function main() {
  console.log("Running comprehensive smart verification tests...\n");

  await testImageR2();
  await testImageEdgeCases();
  await testImagePriorityChain();
  await testBasicFields();
  await testWarnings();
  await testScores();
  await testSensitiveChanges();
  await testSmartVerification();
  await testIntegration();

  // ─── Print results table ──────────────────────────────────────────────
  const categories = [...new Set(results.map(r => r.category))];
  let totalPass = 0;
  let totalFail = 0;

  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const catPass = catResults.filter(r => r.pass).length;
    const catFail = catResults.filter(r => !r.pass).length;
    totalPass += catPass;
    totalFail += catFail;

    console.log(`\n${"═".repeat(90)}`);
    console.log(`CATEGORY: ${cat} (${catPass}/${catPass + catFail} passed)`);
    console.log(`${"═".repeat(90)}`);
    console.log(`${"ID".padEnd(8)} ${"PASS".padEnd(6)} ${"Description".padEnd(55)} Expected → Actual`);
    console.log(`${"─".repeat(90)}`);
    for (const r of catResults) {
      const icon = r.pass ? "✅" : "❌";
      console.log(`${r.id.padEnd(8)} ${icon.padEnd(6)} ${r.description.padEnd(55)} ${r.expected} → ${r.actual}`);
    }
  }

  // ─── Summary table ────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(90)}`);
  console.log("SUMMARY");
  console.log(`${"═".repeat(90)}`);
  console.log(`${"Category".padEnd(40)} ${"Total".padEnd(8)} ${"Pass".padEnd(8)} ${"Fail".padEnd(8)}`);
  console.log(`${"─".repeat(90)}`);
  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const p = catResults.filter(r => r.pass).length;
    const f = catResults.filter(r => !r.pass).length;
    const status = f === 0 ? "✅" : "❌";
    console.log(`${status} ${cat.padEnd(38)} ${String(catResults.length).padEnd(8)} ${String(p).padEnd(8)} ${String(f).padEnd(8)}`);
  }
  console.log(`${"─".repeat(90)}`);
  const allStatus = totalFail === 0 ? "✅" : "❌";
  console.log(`${allStatus} TOTAL${" ".repeat(33)} ${String(totalPass + totalFail).padEnd(8)} ${String(totalPass).padEnd(8)} ${String(totalFail).padEnd(8)}`);
  console.log(`${"═".repeat(90)}`);

  if (totalFail === 0) {
    console.log("🎉 ALL TESTS PASSED!");
  } else {
    console.log(`⚠️  ${totalFail} TESTS FAILED`);
    // Print failures
    console.log("\nFailed tests:");
    for (const r of results.filter(r => !r.pass)) {
      console.log(`  ${r.id}: ${r.description} — expected "${r.expected}" got "${r.actual}"`);
    }
  }

  process.exit(totalFail > 0 ? 1 : 0);
}

main();
