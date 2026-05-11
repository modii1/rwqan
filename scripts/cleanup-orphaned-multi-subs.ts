/**
 * Cleanup orphaned multi-property subscriptions
 * Removes multi_property_subscriptions that reference non-existent properties
 * and fixes corrupted data (propertyNumber2 containing "[")
 */
import "dotenv/config";
import { firebaseService } from "../server/firebaseService";

async function cleanup() {
  console.log("🧹 Starting cleanup of orphaned multi-property subscriptions...\n");

  const properties = await firebaseService.getProperties();
  const multiSubs = await firebaseService.getMultiPropertySubscriptions();
  const propertyNumbers = new Set(properties.map(p => p.propertyNumber));

  let cleaned = 0;
  let fixed = 0;

  for (const ms of multiSubs) {
    const prop1Exists = propertyNumbers.has(ms.propertyNumber1);
    const prop2Valid = !ms.propertyNumber2 || (ms.propertyNumber2 !== "[" && propertyNumbers.has(ms.propertyNumber2));

    // Delete if main property doesn't exist or data is corrupted
    if (!prop1Exists || ms.propertyNumber2 === "[") {
      console.log(`  🗑️  Deleting ${ms.id}: prop1=${ms.propertyNumber1} (exists: ${prop1Exists}), prop2=${ms.propertyNumber2}`);
      await firebaseService.deleteMultiPropertySubscription(ms.id);
      cleaned++;
      continue;
    }

    // If property2 doesn't exist but property1 does, remove prop2 reference
    if (ms.propertyNumber2 && !propertyNumbers.has(ms.propertyNumber2)) {
      console.log(`  🔧 Fixing ${ms.id}: removing invalid prop2=${ms.propertyNumber2}`);
      await firebaseService.updateMultiPropertySubscription(ms.id, {
        propertyNumber2: undefined,
        linkedProperties: [ms.propertyNumber1],
        propertyCount: 1,
      });
      fixed++;
    }
  }

  console.log(`\n✅ Cleanup complete: ${cleaned} deleted, ${fixed} fixed`);
  process.exit(0);
}

cleanup().catch(err => {
  console.error("❌ Cleanup failed:", err);
  process.exit(1);
});
