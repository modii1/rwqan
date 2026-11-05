/**
 * DEV-only cleanup for partner profit test records created during manual/browser testing.
 * Run:  cross-env NODE_ENV=development tsx scripts/dev/cleanup-partner-profits-test-data.ts
 *
 * Keeps pre-existing structural seed records (e.g. PP-TEST-1). Deletes cycles
 * created in this verification session (future months and recent timestamp IDs).
 */
import "../../server/config/loadEnv";
import { db } from "../../server/config/firebase";

const PROTECTED_IDS = new Set(["PP-TEST-1"]);
const TEST_MONTH_PREFIXES = ["2050-", "2030-", "2027-"];
const TEST_MONTHS = new Set(["2026-10", "2026-11", "2026-12"]);

async function cleanupPartnerProfitTestData(): Promise<number> {
  const firestore = db;
  const snapshot = await firestore.collection("partner_profits").get();
  let deleted = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const id = doc.id;
    const monthYear = data.monthYear || "";

    if (PROTECTED_IDS.has(id)) continue;

    const isTestMonthPrefix = TEST_MONTH_PREFIXES.some((prefix) =>
      monthYear.startsWith(prefix)
    );
    const isTestMonth = TEST_MONTHS.has(monthYear);
    const isTestData = data.testData === true;

    if (isTestMonthPrefix || isTestMonth || isTestData) {
      await doc.ref.delete();
      console.log(`[CLEANUP] deleted ${id} (${monthYear})`);
      deleted += 1;
    }
  }

  console.log(`[CLEANUP] total deleted: ${deleted}`);
  return deleted;
}

cleanupPartnerProfitTestData()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[CLEANUP] FAILED:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
