/**
 * One-time repair script for linked properties inconsistencies.
 *
 * Problem: linked properties could drift from their main property — different
 * subscriptionType, different endDate, or stale verificationStatus (pending/rejected
 * while the main was approved). This produced "main property active but linked inactive".
 *
 * Usage:
 *   npx tsx scripts/reconcile-linked-properties.ts            # read-only audit report
 *   npx tsx scripts/reconcile-linked-properties.ts --fix      # apply fixes
 */
import "dotenv/config";
import { firebaseService } from "../server/firebaseService";

async function main() {
  const applyFix = process.argv.includes("--fix");
  console.log(`\n${applyFix ? "🔧 REPAIR MODE" : "📋 AUDIT MODE (read-only)"} — Linked Properties Reconcile\n`);
  console.log("=".repeat(70));

  const subscriptions = await firebaseService.getSubscriptions();
  // Main properties = those with a linkedProperties array (group owners)
  const mains = subscriptions.filter(s => s.linkedProperties && s.linkedProperties.length > 0);

  console.log(`Found ${mains.length} main properties with linked groups.\n`);

  let totalInconsistencies = 0;
  let totalFixed = 0;
  const report: any[] = [];

  for (const main of mains) {
    const result = await firebaseService.reconcileLinkedGroup(main.propertyNumber, applyFix);
    if (result.inconsistencies.length > 0) {
      totalInconsistencies += result.inconsistencies.length;
      totalFixed += result.fixed;
      report.push(result);
      console.log(`\n📌 Group main=${main.propertyNumber} (${result.linkedProperties.length} linked)`);
      for (const inc of result.inconsistencies) {
        console.log(`   ⚠️  ${inc.propertyNumber} | ${inc.field}: expected="${inc.expected}" actual="${inc.actual}"`);
      }
      if (applyFix && result.fixed > 0) {
        console.log(`   ✅ Fixed ${result.fixed} linked properties`);
      }
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log(`SUMMARY: ${report.length} groups with issues, ${totalInconsistencies} inconsistencies${applyFix ? `, ${totalFixed} properties fixed` : " (not applied — run with --fix to repair)"}`);

  if (!applyFix && totalInconsistencies > 0) {
    console.log("\nTo apply fixes, run: npx tsx scripts/reconcile-linked-properties.ts --fix");
  } else if (totalInconsistencies === 0) {
    console.log("\n✅ All linked groups are consistent — no repairs needed.");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Script failed:", err);
  process.exit(1);
});
