/**
 * DEV-only seed entrypoint.
 * Run:  cross-env NODE_ENV=development tsx scripts/dev/e2e-seed.ts
 */
import { seedDevTestData } from "./e2e-test-data";

seedDevTestData()
  .then(() => {
    console.log("[E2E SEED] done");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[E2E SEED] FAILED:", error instanceof Error ? error.message : error);
    process.exit(1);
  });
