import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runAll } from "./runner";
import { assertE2ETargetIsDevelopment } from "./guards";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function ensureDir(path: string) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

export async function main() {
  try {
    const guard = assertE2ETargetIsDevelopment(process.env);
    if (!guard.ok) {
      const result = {
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        suites: [],
        summary: { total: 0, pass: 0, fail: guard.errors.length, blocked: 0, notRun: 0, criticalFailures: guard.errors.length },
        guard,
      };
      const reportsDir = join(__dirname, "..", "reports");
      ensureDir(reportsDir);
      writeFileSync(join(reportsDir, "phase6g-quality.json"), JSON.stringify(result, null, 2));
      process.exit(1);
    }

    const { businessLogicSuite } = await import("../suites/businessLogic");
    const { liveApiSuite } = await import("../suites/liveApi");
    const { browserE2ESuite } = await import("../suites/browserE2E");

    const suites = [businessLogicSuite, liveApiSuite, browserE2ESuite];
    const result = await runAll(suites);
    const reportsDir = join(__dirname, "..", "reports");
    ensureDir(reportsDir);
    writeFileSync(join(reportsDir, "phase6g-quality.json"), JSON.stringify(result, null, 2));
    if (result.summary.criticalFailures > 0) {
      process.exit(1);
    }
  } catch (error) {
    const result = {
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      suites: [],
      summary: { total: 0, pass: 0, fail: 1, blocked: 0, notRun: 0, criticalFailures: 1 },
      error: error instanceof Error ? error.message : String(error),
    };
    const reportsDir = join(__dirname, "..", "reports");
    ensureDir(reportsDir);
    writeFileSync(join(reportsDir, "phase6g-quality.json"), JSON.stringify(result, null, 2));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
