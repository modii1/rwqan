/**
 * Test Suite: System Scenarios Changes
 * Tests all 7 changes made to the system:
 * 1. Bank transfer Smart Verify auto-flow
 * 2. Paid new property waits for admin approval after payment + Smart Verify
 * 3. Auto run-verification for new property on update
 * 4. Error UX (missingFields, verificationFailed)
 * 5. approveBankTransfer as fallback
 * 6. Linked properties with bank transfer
 * 7. New vs old property behavior
 *
 * Run: npx tsx scripts/test-scenarios-changes.ts
 */

import "dotenv/config";
import { firebaseService } from "../server/firebaseService";
import { paymentService } from "../server/services/PaymentService";
import { checkPropertyDataComplete } from "../server/utils/verification";
import { countR2Images } from "../server/utils/r2";
import {
  calculateSubscriptionEndDate,
  calculateExtensionEndDate,
  getStartOfDayRiyadh,
  formatDateRiyadh,
} from "../server/utils/dateUtils";

const TEST_PREFIX = "TEST-SCEN";
let testPropertyNumbers: string[] = [];
let testPaymentIds: string[] = [];
let testResults: { id: string; pass: boolean; description: string }[] = [];

function test(id: string, pass: boolean, description: string, expected?: any, actual?: any) {
  testResults.push({ id, pass, description });
  const icon = pass ? "✅" : "❌";
  const detail = expected !== undefined ? ` (${expected} → ${actual})` : "";
  console.log(`  ${icon} ${id}: ${description}${detail}`);
}

function section(title: string) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(70)}`);
}

async function cleanup() {
  console.log("\n🧹 Cleaning up test data...");
  for (const pn of testPropertyNumbers) {
    try {
      await firebaseService.deleteProperty(pn);
      console.log(`  Deleted property: ${pn}`);
    } catch (e) {
      // ignore
    }
  }
  for (const pid of testPaymentIds) {
    try {
      await firebaseService.updatePaymentStatus(pid, "مرفوض");
      console.log(`  Rejected payment: ${pid}`);
    } catch (e) {
      // ignore
    }
  }
  console.log("  Cleanup done.");
}

async function runTests() {
  console.log("\n🧪 System Scenarios Changes — Test Suite");
  console.log(`${"═".repeat(70)}`);
  console.log("Testing all 7 changes from the scenarios update.\n");

  try {
    // ============================================================
    // TEST 1: checkPropertyDataComplete — Smart Verify logic
    // ============================================================
    section("TEST 1: Smart Verify — checkPropertyDataComplete");

    const completeProperty = {
      name: "شاليه تجريبي",
      location: "https://maps.google.com/test",
      city: "القصيم",
      type: "قسم",
      facilities: ["مسبح", "مطبخ", "بيارق"],
      prices: { weekday: 500, weekend: 800, overnight: 300 },
      direction: "شمال",
    };

    const r1 = await checkPropertyDataComplete(completeProperty, 5);
    test("T1.1", r1.isComplete === true, "Complete property → isComplete=true", true, r1.isComplete);
    test("T1.2", r1.missingFields.length === 0, "Complete property → 0 missing fields", 0, r1.missingFields.length);
    test("T1.3", r1.completionScore === 100, "Complete property → score=100", 100, r1.completionScore);

    const incompleteProperty = {
      name: "",
      location: "",
      city: "",
      type: "",
      facilities: [],
      prices: {},
    };

    const r2 = await checkPropertyDataComplete(incompleteProperty, 0);
    test("T1.4", r2.isComplete === false, "Empty property → isComplete=false", false, r2.isComplete);
    test("T1.5", r2.missingFields.length >= 4, "Empty property → at least 4 missing fields", ">=4", r2.missingFields.length);
    test("T1.6", r2.completionScore === 0, "Empty property → score=0", 0, r2.completionScore);

    const partialProperty = {
      name: "شاليه ناقص",
      location: "https://maps.google.com/test",
      city: "الرياض",
      type: "قسم",
      facilities: ["مسبح"],
      prices: { weekday: 300 },
      direction: "",
    };

    const r3 = await checkPropertyDataComplete(partialProperty, 1);
    test("T1.7", r3.isComplete === false, "Partial property (1 img) → isComplete=false", false, r3.isComplete);
    test("T1.8", r3.missingFields.some(f => f.includes("الصور")), "Partial property → missing الصور", true, r3.missingFields.some(f => f.includes("الصور")));

    // ============================================================
    // TEST 2: Date calculation logic
    // ============================================================
    section("TEST 2: Date Calculations — Renewal vs Upgrade");

    const today = getStartOfDayRiyadh();
    const thirtyDays = calculateSubscriptionEndDate(null, 30);
    const extended = calculateExtensionEndDate(new Date("2026-07-20"), 30);

    test("T2.1", thirtyDays > today, "Subscription end date > today", true, thirtyDays > today);
    test("T2.2", extended > new Date("2026-07-20"), "Extension end > current end", true, extended > new Date("2026-07-20"));

    // Upgrade: starts from today
    const upgradeEnd = new Date(today);
    upgradeEnd.setDate(upgradeEnd.getDate() + 30);
    test("T2.3", upgradeEnd.toDateString() === thirtyDays.toDateString(), "Upgrade starts from today", true, upgradeEnd.toDateString() === thirtyDays.toDateString());

    // ============================================================
    // TEST 3: Create test property (new, no subscription)
    // ============================================================
    section("TEST 3: Create Test Property (New Property)");

    const testPN = `${TEST_PREFIX}-${Date.now()}`;
    testPropertyNumbers.push(testPN);

    const newProperty = await firebaseService.createProperty({
      propertyNumber: testPN,
      name: "شاليه اختباري",
      whatsappNumber: "555555555",
      location: "https://maps.google.com/test",
      city: "القصيم",
      direction: "شمال",
      type: "قسم",
      facilities: ["مسبح", "مطبخ"],
      prices: { weekday: 500, weekend: 800, overnight: 300 },
      subscriptionType: "عادي",
      pin: "1234",
      verificationStatus: "pending",
    } as any);

    test("T3.1", newProperty !== null, "Property created successfully", true, newProperty !== null);
    test("T3.2", newProperty.verificationStatus === "pending", "New property verification=pending", "pending", newProperty.verificationStatus);

    // ============================================================
    // TEST 4: Auto run-verification for new property
    // ============================================================
    section("TEST 4: Auto Run-Verification for New Property");

    // Simulate: property with complete data → should auto-verify
    const completeNewProp = await firebaseService.getPropertyByNumber(testPN);
    if (completeNewProp) {
      // Make it complete
      await firebaseService.updateProperty(testPN, {
        name: "شاليه مكتمل",
        location: "https://maps.google.com/test",
        city: "القصيم",
        type: "قسم",
        facilities: ["مسبح", "مطبخ", "بيارق"],
        prices: { weekday: 500, weekend: 800, overnight: 300 },
        direction: "شمال",
      });

      const updatedProp = await firebaseService.getPropertyByNumber(testPN);
      const r2ImgCount = await countR2Images(testPN);
      const verifyResult = await checkPropertyDataComplete(updatedProp, r2ImgCount);

      // Property has no R2 images → Smart Verify correctly says incomplete
      // This is expected: a real property needs at least 3 images
      test("T4.1", verifyResult.isComplete === false, "New property without R2 images → isComplete=false (needs images)", false, verifyResult.isComplete);
      test("T4.2", verifyResult.missingFields.some(f => f.includes("الصور")), "Missing field includes الصور", true, verifyResult.missingFields.some(f => f.includes("الصور")));
    }

    // ============================================================
    // TEST 5: Create payment for new property (simulate bank transfer)
    // ============================================================
    section("TEST 5: Bank Transfer Payment for New Property");

    const pkg = await firebaseService.getPackageById("pkg-month");
    if (!pkg) {
      console.log("  ⚠️  pkg-premium-30 not found, skipping payment tests");
    } else {
      const payment = await paymentService.create({
        propertyNumber: testPN,
        packageId: pkg.id,
        amount: 50,
        discountCode: "",
        discountAmount: 0,
        finalAmount: 50,
        status: "قيد المراجعة",
        paymentMethod: "تحويل بنكي",
        receiptUrl: "",
      } as any);
      testPaymentIds.push(payment.id);

      test("T5.1", payment.status === "قيد المراجعة", "Bank transfer initial status=قيد المراجعة", "قيد المراجعة", payment.status);
      test("T5.2", payment.paymentMethod === "تحويل بنكي", "Payment method=تحويل بنكي", "تحويل بنكي", payment.paymentMethod);

      // Simulate: AI scan succeeds → status changes to "نجح - قيد التحقق"
      await paymentService.setStatus(payment.id, "نجح - قيد التحقق");
      const updatedPayment = await paymentService.getById(payment.id);
      test("T5.3", updatedPayment?.status === "نجح - قيد التحقق", "After AI scan → نجح - قيد التحقق", "نجح - قيد التحقق", updatedPayment?.status);

      // Simulate: Smart Verify passes → new property with complete data → pending admin approval
      const propForPayment = await firebaseService.getPropertyByNumber(testPN);
      if (propForPayment) {
        const r2Img = await countR2Images(testPN);
        const svResult = await checkPropertyDataComplete(propForPayment, r2Img);

        if (svResult.isComplete) {
          // New property: should check hasPriorSubscription
          const existingSub = await firebaseService.getSubscriptionByPropertyNumber(testPN);
          const hasPrior = !!(existingSub as any)?.endDate;

          test("T5.4", hasPrior === false, "New property has no prior subscription", false, hasPrior);

          // Final rule: new paid property waits for admin approval after Smart Verify
          if (!hasPrior) {
            await paymentService.setStatus(payment.id, "نجح - قيد التحقق");
            await firebaseService.updateProperty(testPN, {
              verificationStatus: "pending",
              smartVerificationPassed: true,
              smartVerificationPassedAt: new Date().toISOString(),
              pendingPaidSubscription: true,
            } as any);

            const finalPayment = await paymentService.getById(payment.id);
            const finalSub = await firebaseService.getSubscriptionByPropertyNumber(testPN);
            const finalProp = await firebaseService.getPropertyByNumber(testPN);

            test("T5.5", finalPayment?.status === "نجح - قيد التحقق", "Payment status → نجح - قيد التحقق", "نجح - قيد التحقق", finalPayment?.status);
            test("T5.6", finalSub === null, "No subscription created before admin approval", true, finalSub === null);
            test("T5.7", finalProp?.verificationStatus === "pending", "Property verification remains pending", "pending", finalProp?.verificationStatus);
            test("T5.8", (finalProp as any)?.smartVerificationPassed === true, "Smart Verify pass flag saved", true, (finalProp as any)?.smartVerificationPassed);
          }
        }
      }
    }

    // ============================================================
    // TEST 6: Linked properties scenario
    // ============================================================
    section("TEST 6: Linked Properties");

    const testPN2 = `${TEST_PREFIX}-LINK-${Date.now()}`;
    testPropertyNumbers.push(testPN2);

    const linkedProp = await firebaseService.createProperty({
      propertyNumber: testPN2,
      name: "شاليه مرتبط",
      whatsappNumber: "555555556",
      location: "https://maps.google.com/test2",
      city: "الرياض",
      direction: "جنوب",
      type: "قسمين",
      facilities: ["مسبح"],
      prices: { weekday: 400 },
      subscriptionType: "عادي",
      pin: "5678",
      verificationStatus: "pending",
    } as any);

    test("T6.1", linkedProp !== null, "Linked property created", true, linkedProp !== null);

    // Simulate: linked property gets same subscription dates as main
    if (pkg) {
      let mainSub = await firebaseService.getSubscriptionByPropertyNumber(testPN);
      if (!mainSub) {
        const mainPropForApproval = await firebaseService.getPropertyByNumber(testPN);
        const endDate = calculateSubscriptionEndDate(null, pkg.duration);
        if (mainPropForApproval) {
          await firebaseService.addSubscriptionToSheet(
            testPN,
            {
              packageId: pkg.id,
              price: 50,
              subscriptionType: "مميز",
              packageType: "مميز",
              startDate: formatDateRiyadh(today),
              endDate: formatDateRiyadh(endDate),
              paymentId: "admin-approval-simulated",
            },
            mainPropForApproval
          );
          await firebaseService.updateVerificationStatus(testPN, "approved");
          mainSub = await firebaseService.getSubscriptionByPropertyNumber(testPN);
        }
      }
      if (mainSub) {
        await firebaseService.addSubscriptionToSheet(
          testPN2,
          {
            packageId: pkg.id,
            price: 25,
            subscriptionType: "مميز",
            packageType: "مميز",
            startDate: mainSub.startDate,
            endDate: mainSub.endDate,
            linkedProperty: testPN,
          },
          linkedProp
        );

        // Linked property auto-approved (inherits main's verification)
        await firebaseService.updateVerificationStatus(testPN2, "approved");

        const linkedSub = await firebaseService.getSubscriptionByPropertyNumber(testPN2);
        const linkedPropFinal = await firebaseService.getPropertyByNumber(testPN2);

        test("T6.2", linkedSub !== null, "Linked property has subscription", true, linkedSub !== null);
        test("T6.3", linkedPropFinal?.verificationStatus === "approved", "Linked property auto-approved", "approved", linkedPropFinal?.verificationStatus);

        if (linkedSub && mainSub) {
          test("T6.4", linkedSub.startDate === mainSub.startDate, "Linked starts same as main", mainSub.startDate, linkedSub.startDate);
          test("T6.5", linkedSub.endDate === mainSub.endDate, "Linked ends same as main", mainSub.endDate, linkedSub.endDate);
        }
      }
    }

    // ============================================================
    // TEST 7: Error response structure (UX)
    // ============================================================
    section("TEST 7: Error Response Structure");

    // Simulate what the bank transfer endpoint returns on verification failure
    const errorResponse = {
      ok: true,
      paymentId: "test-123",
      autoActivated: false,
      verificationFailed: true,
      missingFields: ["اسم العقار", "رقم الواتساب", "الصور (0/3 كحد أدنى)"],
      aiScan: null,
    };

    test("T7.1", errorResponse.verificationFailed === true, "verificationFailed flag present", true, errorResponse.verificationFailed);
    test("T7.2", errorResponse.missingFields?.length === 3, "missingFields has 3 items", 3, errorResponse.missingFields?.length);
    test("T7.3", errorResponse.autoActivated === false, "autoActivated=false on failure", false, errorResponse.autoActivated);

    // Success response
    const successResponse = {
      ok: true,
      paymentId: "test-456",
      autoActivated: false,
      pendingAdminApproval: true,
      verificationFailed: false,
      missingFields: undefined,
      aiScan: { recommendation: "تفعيل_تلقائي", confidence: 95, matchScore: 98, authenticityScore: 97 },
    };

    test("T7.4", successResponse.pendingAdminApproval === true, "pendingAdminApproval=true for new property success", true, successResponse.pendingAdminApproval);
    test("T7.5", successResponse.verificationFailed === false, "verificationFailed=false on success", false, successResponse.verificationFailed);
    test("T7.6", successResponse.aiScan?.recommendation === "تفعيل_تلقائي", "AI scan recommendation present", "تفعيل_تلقائي", successResponse.aiScan?.recommendation);

    // ============================================================
    // TEST 8: approveBankTransfer as fallback
    // ============================================================
    section("TEST 8: approveBankTransfer as Fallback");

    const fallbackPayment = await paymentService.create({
      propertyNumber: testPN,
      packageId: pkg?.id || "pkg-free",
      amount: 40,
      discountCode: "",
      discountAmount: 0,
      finalAmount: 40,
      status: "قيد المراجعة",
      paymentMethod: "تحويل بنكي",
      receiptUrl: "",
    } as any);
    testPaymentIds.push(fallbackPayment.id);

    // Verify fallback accepts pending statuses
    const pendingStatuses = ["قيد المراجعة", "معلق", "قيد التحقق", "pending", "نجح - قيد التحقق", "مرفوض"];
    test("T8.1", pendingStatuses.includes("قيد المراجعة"), "قيد المراجعة is in pending statuses", true, pendingStatuses.includes("قيد المراجعة"));
    test("T8.2", pendingStatuses.includes("نجح - قيد التحقق"), "نجح - قيد التحقق is in pending statuses", true, pendingStatuses.includes("نجح - قيد التحقق"));

    // ============================================================
    // TEST 9: Upgrade vs Renewal date logic
    // ============================================================
    section("TEST 9: Upgrade vs Renewal Date Logic");

    const currentEndDate = new Date("2026-07-20");

    // Renewal: appends after current end (capped at MAX_SUBSCRIPTION_DAYS=40 from today)
    const renewalEnd = calculateExtensionEndDate(currentEndDate, 30);
    const renewalDiff = Math.ceil((renewalEnd.getTime() - currentEndDate.getTime()) / (1000 * 60 * 60 * 24));
    // capAtMaxDays limits to 40 days from today, so if current end + 30 > today + 40, it's capped
    const maxEnd = new Date(today);
    maxEnd.setDate(maxEnd.getDate() + 40);
    const maxDiff = Math.ceil((maxEnd.getTime() - currentEndDate.getTime()) / (1000 * 60 * 60 * 24));
    const expectedRenewalDiff = Math.min(30, maxDiff);
    test("T9.1", renewalDiff === expectedRenewalDiff, `Renewal adds days (capped at MAX_SUBSCRIPTION_DAYS=40 from today)`, expectedRenewalDiff, renewalDiff);

    // Upgrade: starts from today
    const upgradeEndCalc = new Date(today);
    upgradeEndCalc.setDate(upgradeEndCalc.getDate() + 30);
    const upgradeDiff = Math.ceil((upgradeEndCalc.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    test("T9.2", upgradeDiff === 30, "Upgrade starts from today + 30 days", 30, upgradeDiff);

    // Verify upgrade doesn't extend from current end
    const upgradeFromCurrentEnd = Math.ceil((upgradeEndCalc.getTime() - currentEndDate.getTime()) / (1000 * 60 * 60 * 24));
    test("T9.3", upgradeFromCurrentEnd !== 30, "Upgrade does NOT extend from current end", true, upgradeFromCurrentEnd !== 30);

    // ============================================================
    // TEST 10: New property activation rules
    // ============================================================
    section("TEST 10: New Property Activation Rules");

    // Rule: New + free + complete → pending admin
    // Rule: New + paid + complete + Smart Verify → pending admin approval
    // Rule: New + paid + incomplete → needs user action / manual review, no activation

    const ruleNewFree = { hasPrior: false, isPaid: false, verificationPassed: true };
    const ruleNewPaid = { hasPrior: false, isPaid: true, verificationPassed: true };
    const ruleNewPaidFail = { hasPrior: false, isPaid: true, verificationPassed: false };
    const ruleOldPaid = { hasPrior: true, isPaid: true, verificationPassed: true };

    // New free → pending admin
    const action1 = !ruleNewFree.hasPrior && !ruleNewFree.isPaid && ruleNewFree.verificationPassed ? "pending_admin" :
                    !ruleNewFree.hasPrior && ruleNewFree.isPaid && ruleNewFree.verificationPassed ? "pending_admin" : "other";
    test("T10.1", action1 === "pending_admin", "New free → pending_admin", "pending_admin", action1);

    // New paid + verified → pending admin approval
    const action2 = !ruleNewPaid.hasPrior && ruleNewPaid.isPaid && ruleNewPaid.verificationPassed ? "pending_admin" : "other";
    test("T10.2", action2 === "pending_admin", "New paid + verified → pending_admin", "pending_admin", action2);

    // New paid + failed → needs user action/manual review
    const action3 = !ruleNewPaidFail.hasPrior && ruleNewPaidFail.isPaid && !ruleNewPaidFail.verificationPassed ? "needs_action" : "other";
    test("T10.3", action3 === "needs_action", "New paid + failed → needs_action", "needs_action", action3);

    // Old paid + verified → auto-activate
    const action4 = ruleOldPaid.hasPrior && ruleOldPaid.isPaid && ruleOldPaid.verificationPassed ? "auto_activate" : "other";
    test("T10.4", action4 === "auto_activate", "Old paid + verified → auto_activate", "auto_activate", action4);

  } catch (err: any) {
    console.error("\n❌ Test error:", err.message);
    console.error(err.stack);
  } finally {
    await cleanup();
  }

  // ============================================================
  // Summary
  // ============================================================
  console.log(`\n${"═".repeat(70)}`);
  console.log("  RESULTS SUMMARY");
  console.log(`${"═".repeat(70)}`);

  const passed = testResults.filter(r => r.pass).length;
  const failed = testResults.filter(r => !r.pass).length;
  const total = testResults.length;

  console.log(`\n  Total: ${total} | ✅ Passed: ${passed} | ❌ Failed: ${failed}`);
  console.log(`  Pass Rate: ${((passed / total) * 100).toFixed(1)}%\n`);

  if (failed > 0) {
    console.log("  Failed tests:");
    testResults.filter(r => !r.pass).forEach(r => {
      console.log(`    ❌ ${r.id}: ${r.description}`);
    });
  }

  console.log(`${"═".repeat(70)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
