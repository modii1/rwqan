import "dotenv/config";
import { firebaseService } from "../server/firebaseService";

async function main() {
  console.log("Starting Firebase connection test...");
  console.log("Project:", JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}").project_id);

  try {
    // Test 1: Get properties
    const properties = await firebaseService.getProperties();
    console.log(`\n✅ TEST 1: Properties loaded: ${properties.length}`);

    // Test 2: Get subscriptions
    const subscriptions = await firebaseService.getSubscriptions();
    console.log(`✅ TEST 2: Subscriptions loaded: ${subscriptions.length}`);

    // Test 3: Get multi-property subscriptions
    const multiSubs = await firebaseService.getMultiPropertySubscriptions();
    console.log(`✅ TEST 3: Multi-property subscriptions: ${multiSubs.length}`);

    // Test 4: Get packages
    const packages = await firebaseService.getPackages();
    console.log(`✅ TEST 4: Packages loaded: ${packages.length}`);

    // Test 5: Find linked properties
    const linkedProps = properties.filter(p => p.linkedProperty);
    console.log(`✅ TEST 5: Properties with linkedProperty field: ${linkedProps.length}`);

    if (linkedProps.length > 0) {
      linkedProps.slice(0, 3).forEach(p => {
        console.log(`   - ${p.propertyNumber}: "${p.name}" → linked to: ${p.linkedProperty}`);
      });
    }

    // Test 6: Verify multi-property subscription structure
    if (multiSubs.length > 0) {
      const sample = multiSubs[0];
      console.log(`\n✅ TEST 6: Sample multi-property subscription:`);
      console.log(`   ID: ${sample.id}`);
      console.log(`   Property1: ${sample.propertyNumber1}`);
      console.log(`   Property2: ${sample.propertyNumber2 || "N/A"}`);
      console.log(`   Additional: ${(sample.additionalProperties || []).join(", ") || "none"}`);
      console.log(`   Status: ${sample.status}`);
      console.log(`   Start: ${sample.startDate}`);
      console.log(`   End: ${sample.endDate}`);
    }

    // Test 7: Check subscriptions with linkedProperty
    const subsWithLinked = subscriptions.filter(s => (s as any).linkedProperty);
    console.log(`\n✅ TEST 7: Subscriptions with linkedProperty: ${subsWithLinked.length}`);

    if (subsWithLinked.length > 0) {
      subsWithLinked.slice(0, 3).forEach(s => {
        console.log(`   - ${s.propertyNumber}: linked to ${(s as any).linkedProperty}, status: ${s.status}`);
      });
    }

    // Test 8: Validate consistency
    console.log(`\n--- CONSISTENCY CHECK ---`);
    let issues = 0;

    // Check: every linked property should have a subscription
    for (const prop of linkedProps) {
      const sub = subscriptions.find(s => s.propertyNumber === prop.propertyNumber);
      if (!sub) {
        console.log(`   ⚠️  Property ${prop.propertyNumber} has linkedProperty=${prop.linkedProperty} but no subscription`);
        issues++;
      }
    }

    // Check: every multi-property subscription should reference valid properties
    for (const ms of multiSubs) {
      const prop1 = properties.find(p => p.propertyNumber === ms.propertyNumber1);
      if (!prop1) {
        console.log(`   ⚠️  Multi-sub ${ms.id}: propertyNumber1=${ms.propertyNumber1} not found in properties`);
        issues++;
      }
      if (ms.propertyNumber2) {
        const prop2 = properties.find(p => p.propertyNumber === ms.propertyNumber2);
        if (!prop2) {
          console.log(`   ⚠️  Multi-sub ${ms.id}: propertyNumber2=${ms.propertyNumber2} not found in properties`);
          issues++;
        }
      }
    }

    if (issues === 0) {
      console.log(`   ✅ No consistency issues found!`);
    } else {
      console.log(`   ⚠️  Found ${issues} consistency issue(s)`);
    }

    console.log(`\n========== SUMMARY ==========`);
    console.log(`Properties: ${properties.length}`);
    console.log(`Subscriptions: ${subscriptions.length}`);
    console.log(`Multi-property groups: ${multiSubs.length}`);
    console.log(`Linked properties: ${linkedProps.length}`);
    console.log(`Packages: ${packages.length}`);
    console.log(`Multi-property packages: ${packages.filter(p => (p as any).propertyCount > 1).length}`);
    console.log(`=============================\n`);

  } catch (err) {
    console.error("❌ Error:", err);
    process.exit(1);
  }

  process.exit(0);
}

main();
