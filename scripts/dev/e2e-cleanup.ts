/**
 * DEV-only cleanup entrypoint.
 * Run:  cross-env NODE_ENV=development tsx scripts/dev/e2e-cleanup.ts
 */
import { cleanupDevTestData } from "./e2e-test-data";

cleanupDevTestData()
  .then(() => {
    console.log("[E2E CLEANUP] done");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[E2E CLEANUP] FAILED:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
