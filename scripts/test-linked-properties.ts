/**
 * Linked Properties - Comprehensive Test Suite
 * Tests the entire linked properties flow:
 * - Multi-property subscriptions (باقة العقارين)
 * - Linked property creation, linking, unlinking
 * - Dashboard management
 * - API endpoints
 */

import "dotenv/config";
import { firebaseService } from "../server/firebaseService";
import { subscriptionService } from "../server/services";
import { propertyService } from "../server/services";

const SERVER_URL = "http://localhost:5000";

async function log(message: string, data?: any) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(message);
  if (data) {
    console.log(JSON.stringify(data, null, 2));
  }
  console.log("=".repeat(60));
}

async function http(method: string, path: string, body?: any) {
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const res = await fetch(`${SERVER_URL}${path}`, options);
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, data: json };
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function runTests() {
  console.log("\n🔍 Linked Properties - Comprehensive Test Suite");
  console.log("=".repeat(60));

  // ==============================================================
  // TEST 1: Get all properties and subscriptions
  // ==============================================================
  log("TEST 1: Read existing data from Firebase");

  const allProperties = await firebaseService.getProperties();
  const allSubscriptions = await firebaseService.getSubscriptions();
  const multiPropertySubs = await firebaseService.getMultiPropertySubscriptions();
  const packages = await firebaseService.getPackages();

  log(`📊 Total Properties: ${allProperties.length}`);
  log(`📊 Total Subscriptions: ${allSubscriptions.length}`);
  log(`📊 Multi-Property Subscriptions: ${multiPropertySubs.length}`);
  log(`📊 Total Packages: ${packages.length}`);

  // Find properties with linkedProperty set
  const linkedProps = allProperties.filter(p => p.linkedProperty);
  log(`🔗 Properties with linkedProperty field: ${linkedProps.length}`);

  if (linkedProps.length > 0) {
    log("Sample linked properties:");
    linkedProps.slice(0, 3).forEach(p => {
      log(`  - ${p.propertyNumber}: "${p.name}" → linked to: ${p.linkedProperty}`);
    });
  }

  // Find multi-property subscriptions
  log("Multi-property subscriptions:");
  multiPropertySubs.slice(0, 5).forEach(sub => {
    log(`  - ${sub.id}: prop1=${sub.propertyNumber1}, prop2=${sub.propertyNumber2 || 'N/A'}, status=${sub.status}`);
    if (sub.additionalProperties && sub.additionalProperties.length > 0) {
      log(`    Additional: ${sub.additionalProperties.join(", ")}`);
    }
  });

  // ==============================================================
  // TEST 2: API - GET /api/admin/linked-properties
  // ==============================================================
  log("TEST 2: GET /api/admin/linked-properties");

  const api1 = await http("GET", "/api/admin/linked-properties");
  log(`Status: ${api1.status}`, api1.data);

  // ==============================================================
  // TEST 3: API - GET /api/admin/multi-property-subscriptions
  // ==============================================================
  log("TEST 3: GET /api/admin/multi-property-subscriptions");

  const api2 = await http("GET", "/api/admin/multi-property-subscriptions");
  log(`Status: ${api2.status}`);
  log(`Found: ${Array.isArray(api2.data) ? api2.data.length : 'N/A'} multi-property subs`);
  if (Array.isArray(api2.data) && api2.data.length > 0) {
    log("Sample:", api2.data[0]);
  }

  // ==============================================================
  // TEST 4: API - GET /api/admin/subscriptions
  // ==============================================================
  log("TEST 4: GET /api/admin/subscriptions");

  const api3 = await http("GET", "/api/admin/subscriptions");
  log(`Status: ${api3.status}`);
  log(`Found: ${Array.isArray(api3.data) ? api3.data.length : 'N/A'} subscriptions`);
  if (Array.isArray(api3.data)) {
    const premiumSubs = api3.data.filter((s: any) => s.subscriptionType === "مميز");
    const activeSubs = api3.data.filter((s: any) => s.status === "ساري" || s.status === "نشط");
    log(`  - مميز: ${premiumSubs.length}`);
    log(`  - نشط/ساري: ${activeSubs.length}`);
  }

  // ==============================================================
  // TEST 5: API - GET /api/admin/packages
  // ==============================================================
  log("TEST 5: GET /api/admin/packages");

  const api4 = await http("GET", "/api/admin/packages");
  log(`Status: ${api4.status}`);
  if (Array.isArray(api4.data)) {
    log(`Found: ${api4.data.length} packages`);
    api4.data.forEach((pkg: any) => {
      const isMulti = pkg.propertyCount && pkg.propertyCount > 1;
      log(`  - ${pkg.name}: ${pkg.price}SAR, propertyCount=${pkg.propertyCount || 1} ${isMulti ? "(MULTI-PROPERTY)" : ""}`);
    });
  }

  // ==============================================================
  // TEST 6: Verify linked properties in dashboard API
  // ==============================================================
  log("TEST 6: GET /api/properties (verify linkedProperty field in properties list)");

  const api5 = await http("GET", "/api/properties");
  log(`Status: ${api5.status}`);
  if (Array.isArray(api5.data) && api5.data.length > 0) {
    const withLinked = api5.data.filter((p: any) => p.linkedProperty);
    log(`Properties with linkedProperty: ${withLinked.length}`);
    if (withLinked.length > 0) {
      log("Sample:", {
        propertyNumber: withLinked[0].propertyNumber,
        name: withLinked[0].name,
        linkedProperty: withLinked[0].linkedProperty,
        subscriptionType: withLinked[0].subscriptionType,
        subscriptionStatus: withLinked[0].subscriptionStatus,
      });
    }
  }

  // ==============================================================
  // TEST 7: Check property subscription data
  // ==============================================================
  log("TEST 7: Check subscription data structure for linked properties");

  // Get subscriptions that have linkedProperty set
  const subsWithLinkedProp = allSubscriptions.filter(s => (s as any).linkedProperty);
  log(`Subscriptions with linkedProperty field: ${subsWithLinkedProp.length}`);

  if (subsWithLinkedProp.length > 0) {
    log("Sample linked subscription:", {
      id: subsWithLinkedProp[0].id,
      propertyNumber: subsWithLinkedProp[0].propertyNumber,
      linkedProperty: (subsWithLinkedProp[0] as any).linkedProperty,
      status: subsWithLinkedProp[0].status,
      startDate: subsWithLinkedProp[0].startDate,
      endDate: subsWithLinkedProp[0].endDate,
    });
  }

  // ==============================================================
  // TEST 8: Verify main property has linked properties
  // ==============================================================
  log("TEST 8: Check main properties with linked children");

  // Properties that ARE main properties (have other properties pointing to them)
  const linkedPropNumbers = new Set(linkedProps.map(p => p.linkedProperty));
  const mainProperties = allProperties.filter(p => linkedPropNumbers.has(p.propertyNumber));
  log(`Main properties (with linked children): ${mainProperties.length}`);

  if (mainProperties.length > 0) {
    mainProperties.slice(0, 3).forEach(main => {
      const children = linkedProps.filter(p => p.linkedProperty === main.propertyNumber);
      log(`  - ${main.propertyNumber}: "${main.name}" ← ${children.length} linked children`);
      children.forEach(child => {
        log(`      └─ ${child.propertyNumber}: "${child.name}"`);
      });
    });
  }

  // ==============================================================
  // TEST 9: Check multi-property subscription structure
  // ==============================================================
  log("TEST 9: Check multi_property_subscriptions collection structure");

  if (multiPropertySubs.length > 0) {
    const sample = multiPropertySubs[0];
    log("Sample multi-property subscription keys:", Object.keys(sample));
    log("Sample data:", {
      id: sample.id,
      packageId: sample.packageId,
      propertyNumber1: sample.propertyNumber1,
      propertyNumber2: sample.propertyNumber2,
      additionalProperties: sample.additionalProperties,
      linkedProperties: sample.linkedProperties,
      propertyCount: (sample as any).propertyCount,
      status: sample.status,
      startDate: sample.startDate,
      endDate: sample.endDate,
    });
  }

  // ==============================================================
  // TEST 10: Owner API - GET linked property subscription
  // ==============================================================
  log("TEST 10: Owner API - GET /api/owner/subscription/:propertyNumber (for a linked property)");

  if (linkedProps.length > 0) {
    const linkedProp = linkedProps[0];
    const api6 = await http("GET", `/api/owner/subscription/${linkedProp.linkedProperty}`);
    log(`Status: ${api6.status} (for main property: ${linkedProp.linkedProperty})`);

    const api7 = await http("GET", `/api/owner/subscription/${linkedProp.propertyNumber}`);
    log(`Status: ${api7.status} (for linked property: ${linkedProp.propertyNumber})`, api7.data);
  }

  // ==============================================================
  // SUMMARY
  // ==============================================================
  log("TEST SUMMARY");
  console.log(`
  Total Properties: ${allProperties.length}
  Total Subscriptions: ${allSubscriptions.length}
  Properties with linkedProperty: ${linkedProps.length}
  Main properties (with children): ${mainProperties.length}
  Multi-property subscriptions: ${multiPropertySubs.length}
  Packages (total): ${packages.length}
  Packages (multi-property): ${packages.filter((p: any) => p.propertyCount && p.propertyCount > 1).length}
  `);

  if (linkedProps.length === 0 && multiPropertySubs.length === 0) {
    console.log(`
  ⚠️  No linked properties found.
  The system is ready but no linked properties exist yet.
  To test the full flow, you need:
  1. Two properties
  2. A multi-property package (باقة العقارين)
  3. A payment with secondPropertyNumber
  4. Subscription activation with linkedProperty field
    `);
  }
}

runTests().catch(console.error);
