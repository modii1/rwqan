import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type {
  DeployCheckMeta,
  DeployCheckResult,
  DeployChecks,
  DeployCheckRun,
} from "../../shared/deploySystem";
import { collectDeployChecks } from "./DeployChecksService";

/**
 * RWQAN DEPLOY — real, out-of-request release checks (Phase C extension).
 *
 * The publish HTTP request must stay fast, so it does NOT run slow checks
 * (TypeScript/tests/build) and marks them NOT_RUN with an explicit reason. This
 * runner is invoked EXPLICITLY (admin endpoint) to actually execute the
 * DEV-safe local checks and record real results + run times.
 *
 * What actually runs: the TypeScript compiler (`tsc --noEmit`, read-only) and
 * the Git-based secret scan. What does NOT run: the test suite and `next build`
 * (slow; a build would disturb the running DEV server) and post-deploy health
 * (there is no real deploy). Those are recorded as NOT_RUN with the exact
 * package.json command, never as a fake PASS. A passing TypeScript check is
 * NEVER presented as a passing test/build result. No secret is ever returned.
 */

const execFileAsync = promisify(execFile);
const TSC_TIMEOUT_MS = 180_000;

/** Exact command each check maps to (documented, read-only in this phase). */
export const DEPLOY_CHECK_COMMANDS: Record<keyof DeployChecks, string> = {
  typescript: "npx tsc --noEmit",
  tests: "node --import tsx --test --test-concurrency=1 <test files>",
  build: "npm run build",
  secretScan: "git status --porcelain --untracked-files=all + secret scan",
  postDeployHealth: "GET /api/properties (بعد النشر الفعلي فقط)",
};

/**
 * Known failing tests that must be reported honestly and never hidden. These are
 * unrelated to the deploy system and are not "fixed" here; the checks runner
 * documents them so a red test is never reported as green.
 */
export const DEPLOY_KNOWN_TEST_FAILURES: ReadonlyArray<{ file: string; note: string }> = [
  {
    file: "server/services/BookingCommissionStore.test.ts",
    note: "فشل معروف ومُوثَّق (اختبار قديم لا يطابق النموذج الحالي) — لا علاقة له بنظام النشر.",
  },
];

const TESTS_NOT_RUN = `الاختبارات لا تُشغَّل داخل هذا الإجراء في هذه المرحلة (الأمر: ${DEPLOY_CHECK_COMMANDS.tests}). فشل معروف مُوثَّق: ${DEPLOY_KNOWN_TEST_FAILURES.map((entry) => entry.file).join(", ")}.`;
const BUILD_NOT_RUN = `البناء (next build) لا يُشغَّل هنا (الأمر: ${DEPLOY_CHECK_COMMANDS.build}) لأنه يُعطّل سيرفر التطوير الجاري — يبقى معطّلًا حتى مسار نشر معزول.`;
const HEALTH_NOT_RUN =
  "فحص ما بعد النشر غير متاح لأن النشر الفعلي غير مُنفَّذ في هذه المرحلة.";

export interface DeployChecksRunnerDependencies {
  runTypeScript(
    cwd: string,
  ): Promise<{ result: DeployCheckResult; exitCode: number | null; reason?: string }>;
  secretScan(
    cwd: string,
  ): Promise<{ result: DeployCheckResult; reason?: string }>;
}

const DEFAULT_DEPENDENCIES: DeployChecksRunnerDependencies = {
  runTypeScript: runTypeScriptCheck,
  async secretScan(cwd) {
    const report = await collectDeployChecks(cwd);
    return {
      result: report.checks.secretScan,
      ...(report.reasons.secretScan ? { reason: report.reasons.secretScan } : {}),
    };
  },
};

/**
 * Run the DEV-safe release checks once. Never throws: a check that cannot run is
 * recorded as BLOCKED/NOT_RUN with a reason rather than a fabricated PASS.
 */
export async function runReleaseChecks(
  cwd: string,
  dependencies: DeployChecksRunnerDependencies = DEFAULT_DEPENDENCIES,
): Promise<DeployCheckRun> {
  const ranAt = new Date().toISOString();

  const typescript = await dependencies
    .runTypeScript(cwd)
    .catch(() => ({
      result: "BLOCKED" as DeployCheckResult,
      exitCode: null,
      reason: "تعذّر تشغيل فحص TypeScript.",
    }));
  const secretScan = await dependencies.secretScan(cwd).catch(() => ({
    result: "BLOCKED" as DeployCheckResult,
    reason: "تعذّر تشغيل فحص الأسرار (فشل مغلق).",
  }));

  const checks: DeployChecks = {
    typescript: typescript.result,
    tests: "NOT_RUN",
    build: "NOT_RUN",
    secretScan: secretScan.result,
    postDeployHealth: "NOT_RUN",
  };

  const meta: Partial<Record<keyof DeployChecks, DeployCheckMeta>> = {
    typescript: {
      ranAt: typescript.result === "PASS" || typescript.result === "FAIL" ? ranAt : null,
      command: DEPLOY_CHECK_COMMANDS.typescript,
      exitCode: typescript.exitCode,
      ...(typescript.reason ? { reason: typescript.reason } : {}),
    },
    secretScan: {
      ranAt:
        secretScan.result === "PASS" || secretScan.result === "FAIL" ? ranAt : null,
      command: DEPLOY_CHECK_COMMANDS.secretScan,
      ...(secretScan.reason ? { reason: secretScan.reason } : {}),
    },
    tests: { ranAt: null, command: DEPLOY_CHECK_COMMANDS.tests, reason: TESTS_NOT_RUN },
    build: { ranAt: null, command: DEPLOY_CHECK_COMMANDS.build, reason: BUILD_NOT_RUN },
    postDeployHealth: {
      ranAt: null,
      command: DEPLOY_CHECK_COMMANDS.postDeployHealth,
      reason: HEALTH_NOT_RUN,
    },
  };

  return { ranAt, checks, meta };
}

/**
 * Build per-check metadata for an in-request check report (the publish path uses
 * this so every release still records the exact command and, where a check was
 * not run, an explicit reason).
 */
export function buildChecksMeta(
  checks: DeployChecks,
  reasons: Partial<Record<keyof DeployChecks, string>> | undefined,
  ranAt: string,
): Partial<Record<keyof DeployChecks, DeployCheckMeta>> {
  const meta: Partial<Record<keyof DeployChecks, DeployCheckMeta>> = {};
  (Object.keys(checks) as (keyof DeployChecks)[]).forEach((key) => {
    const result = checks[key];
    meta[key] = {
      ranAt: result === "PASS" || result === "FAIL" ? ranAt : null,
      command: DEPLOY_CHECK_COMMANDS[key],
      ...(reasons?.[key] ? { reason: reasons[key] } : {}),
    };
  });
  return meta;
}

async function runTypeScriptCheck(
  cwd: string,
): Promise<{ result: DeployCheckResult; exitCode: number | null; reason?: string }> {
  const tscPath = path.join(cwd, "node_modules", "typescript", "bin", "tsc");
  try {
    await execFileAsync(process.execPath, [tscPath, "--noEmit"], {
      cwd,
      timeout: TSC_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { result: "PASS", exitCode: 0 };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number") {
      return {
        result: "FAIL",
        exitCode: code,
        reason: "فشل فحص TypeScript (راجع مخرجات tsc) — النجاح هنا لا يعني نجاح الاختبارات أو البناء.",
      };
    }
    return {
      result: "BLOCKED",
      exitCode: null,
      reason: "تعذّر تشغيل tsc (غير مثبّت أو انتهت المهلة) — النتيجة غير معروفة (فشل مغلق).",
    };
  }
}
