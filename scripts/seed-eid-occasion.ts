/**
 * Seed script: Creates the initial Eid occasion and populates it with properties.
 * Run: npx tsx scripts/seed-eid-occasion.ts
 */

import "dotenv/config";
import { db } from "../server/config/firebase";

const EID_OCCASION = {
  name: "عيد الأضحى 1447",
  slug: "eid-adha-1447",
  type: "eid",
  startDate: "2026-06-06T00:00:00.000Z",
  endDate: "2026-06-12T00:00:00.000Z",
  days: [
    { key: "day1", label: "أول العيد" },
    { key: "day2", label: "ثاني العيد" },
    { key: "day3", label: "ثالث العيد" },
    { key: "day4", label: "رابع العيد" },
    { key: "day5", label: "خامس العيد" },
    { key: "day6", label: "سادس العيد" },
  ],
  isActive: true,
  theme: "eid",
  description: "عروض الشاليهات لعيد الأضحى المبارك",
};

// Properties extracted from the images with their availability
// true = green (available), false = white (not available)
// Column order: day1 (أول العيد) to day6 (سادس العيد)
const EID_PROPERTIES: { name: string; availability: boolean[] }[] = [
  // Image 1
  { name: "لمير", availability: [false, true, true, true, true, true] },
  { name: "الريم", availability: [true, false, false, false, true, true] },
  { name: "التميز", availability: [false, false, false, true, true, true] },
  { name: "لندا", availability: [false, false, false, true, true, true] },
  { name: "فجر", availability: [true, true, true, true, true, true] },
  { name: "ردن", availability: [true, true, true, false, true, true] },
  { name: "عريب", availability: [true, true, true, false, true, true] },
  { name: "بريدة قيو", availability: [true, true, false, false, false, true] },
  { name: "لوزان", availability: [true, true, true, false, false, true] },
  { name: "ثمانية", availability: [true, true, true, false, false, false] },
  // Image 2
  { name: "النسيم البارد", availability: [true, true, true, true, true, false] },
  { name: "سحاب النخيل", availability: [true, true, false, true, true, false] },
  { name: "إكليل", availability: [true, true, true, true, true, true] },
  { name: "موديل1", availability: [true, true, true, true, true, true] },
  { name: "الكرم", availability: [true, true, true, true, true, true] },
  { name: "الأمل", availability: [true, true, true, true, true, false] },
  { name: "Livo", availability: [true, true, true, true, true, true] },
  { name: "لانتانا", availability: [true, true, true, true, true, true] },
  { name: "تالارا", availability: [true, true, true, true, true, true] },
  { name: "سفينسكا", availability: [true, true, true, true, true, true] },
  // Image 3
  { name: "برنوف", availability: [true, true, true, true, true, true] },
  { name: "فهدة", availability: [true, true, true, true, true, true] },
  { name: "رواء", availability: [true, true, false, true, true, true] },
  { name: "لاوس", availability: [true, true, false, true, true, true] },
  { name: "القصيعة", availability: [true, true, false, true, true, true] },
  { name: "إكليل الخزامى", availability: [true, true, false, false, true, true] },
  { name: "الودق", availability: [true, true, false, false, false, true] },
  { name: "اكزورا", availability: [true, true, true, false, false, true] },
  { name: "القيروان", availability: [true, true, true, false, false, false] },
];

async function seedEidOccasion() {
  if (!db) {
    console.error("Firebase not initialized");
    process.exit(1);
  }

  console.log("🌙 Seeding Eid occasion...");

  // 1. Create the occasion
  const occasionRef = db.collection("occasions").doc();
  const occasionId = occasionRef.id;
  const now = new Date().toISOString();

  await occasionRef.set({
    ...EID_OCCASION,
    id: occasionId,
    createdAt: now,
    updatedAt: now,
  });
  console.log(`✅ Created occasion: ${EID_OCCASION.name} (${occasionId})`);

  // 2. Find property numbers by name
  const propertiesSnapshot = await db.collection("properties").get();
  const allProperties = propertiesSnapshot.docs.map(doc => ({
    propertyNumber: doc.id,
    name: doc.data().name as string,
  }));

  console.log(`📋 Found ${allProperties.length} properties in database`);

  // 3. Match and add properties
  let matched = 0;
  let notFound = 0;

  for (const eidProp of EID_PROPERTIES) {
    const property = allProperties.find(p =>
      p.name === eidProp.name ||
      p.name?.includes(eidProp.name) ||
      eidProp.name.includes(p.name || "")
    );

    if (!property) {
      console.log(`  ⚠️  Not found: "${eidProp.name}"`);
      notFound++;
      continue;
    }

    const availability: Record<string, boolean> = {};
    const prices: Record<string, string> = {};
    EID_OCCASION.days.forEach((day, i) => {
      availability[day.key] = eidProp.availability[i] ?? false;
      prices[day.key] = ""; // Prices to be set by owners
    });

    const opRef = db.collection("occasion_properties").doc();
    await opRef.set({
      id: opRef.id,
      occasionId,
      propertyNumber: property.propertyNumber,
      availability,
      prices,
      addedBy: "admin",
      approvedByAdmin: true,
      createdAt: now,
      updatedAt: now,
    });

    matched++;
    console.log(`  ✅ Added: "${eidProp.name}" → #${property.propertyNumber}`);
  }

  console.log(`\n🎉 Done! Matched: ${matched}, Not found: ${notFound}`);
  console.log(`🌙 Occasion ID: ${occasionId}`);
  process.exit(0);
}

seedEidOccasion().catch(err => {
  console.error("Error seeding:", err);
  process.exit(1);
});
