// Quick script to check Firebase for linked properties
// Usage: npx tsx scripts/check-linked.ts

import { FirebaseService } from "../server/firebaseService.js";

(async () => {
  const service = new FirebaseService();
  const props = await service.getProperties();
  const linked = props.filter(p => p.linkedProperty);

  console.log(`\n🏠 Total Properties: ${props.length}`);
  console.log(`🔗 Linked Properties: ${linked.length}\n`);

  for (const p of linked) {
    console.log(`  #${p.propertyNumber} - ${p.name} → Linked To: ${p.linkedProperty}`);
  }

  if (linked.length > 0) {
    const first = linked[0];
    console.log(`\n✅ Test with property number: ${first.propertyNumber}`);
  } else {
    console.log("\n❌ No linked properties found.");
  }
})();
