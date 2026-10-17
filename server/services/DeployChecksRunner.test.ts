import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPLOY_CHECK_COMMANDS,
  DEPLOY_KNOWN_TEST_FAILURES,
  buildChecksMeta,
  runReleaseChecks,
  type DeployChecksRunnerDependencies,
} from "./DeployChecksRunner";

test("runReleaseChecks records real TypeScript and secret-scan results with run times", async () => {
  const deps: DeployChecksRunnerDependencies = {
    runTypeScript: async () => ({ result: "PASS", exitCode: 0 }),
    secretScan: async () => ({ result: "PASS" }),
  };

  const run = await runReleaseChecks("/repo", deps);

  assert.equal(run.checks.typescript, "PASS");
  assert.equal(run.checks.secretScan, "PASS");
  assert.equal(run.checks.tests, "NOT_RUN");
  assert.equal(run.checks.build, "NOT_RUN");
  assert.equal(run.checks.postDeployHealth, "NOT_RUN");
  assert.ok(run.meta?.typescript?.ranAt, "a ran check must carry a run time");
  assert.equal(run.meta?.typescript?.command, DEPLOY_CHECK_COMMANDS.typescript);
  assert.equal(run.meta?.tests?.ranAt, null);
  assert.equal(run.meta?.build?.ranAt, null);
  assert.equal(run.meta?.postDeployHealth?.ranAt, null);
});

test("runReleaseChecks never presents a NOT_RUN check as PASS", async () => {
  const deps: DeployChecksRunnerDependencies = {
    runTypeScript: async () => ({ result: "PASS", exitCode: 0 }),
    secretScan: async () => ({ result: "PASS" }),
  };

  const run = await runReleaseChecks("/repo", deps);

  assert.notEqual(run.checks.tests, "PASS");
  assert.notEqual(run.checks.build, "PASS");
  assert.notEqual(run.checks.postDeployHealth, "PASS");
  assert.match(run.meta?.tests?.reason ?? "", /BookingCommissionStore/);
});

test("runReleaseChecks documents the known failing test file honestly", () => {
  assert.ok(
    DEPLOY_KNOWN_TEST_FAILURES.some((entry) =>
      entry.file.includes("BookingCommissionStore.test.ts"),
    ),
  );
});

test("runReleaseChecks reports a failing TypeScript check as FAIL, never PASS", async () => {
  const deps: DeployChecksRunnerDependencies = {
    runTypeScript: async () => ({ result: "FAIL", exitCode: 2, reason: "tsc errors" }),
    secretScan: async () => ({ result: "PASS" }),
  };

  const run = await runReleaseChecks("/repo", deps);

  assert.equal(run.checks.typescript, "FAIL");
  assert.equal(run.meta?.typescript?.exitCode, 2);
  assert.ok(run.meta?.typescript?.ranAt);
});

test("runReleaseChecks fails closed (BLOCKED) when TypeScript cannot run", async () => {
  const deps: DeployChecksRunnerDependencies = {
    runTypeScript: async () => {
      throw new Error("tsc missing");
    },
    secretScan: async () => ({ result: "PASS" }),
  };

  const run = await runReleaseChecks("/repo", deps);

  assert.equal(run.checks.typescript, "BLOCKED");
  assert.equal(run.meta?.typescript?.ranAt, null);
  assert.match(run.meta?.typescript?.reason ?? "", /TypeScript/);
});

test("runReleaseChecks fails closed (BLOCKED) when the secret scan cannot run", async () => {
  const deps: DeployChecksRunnerDependencies = {
    runTypeScript: async () => ({ result: "PASS", exitCode: 0 }),
    secretScan: async () => {
      throw new Error("git missing");
    },
  };

  const run = await runReleaseChecks("/repo", deps);

  assert.equal(run.checks.secretScan, "BLOCKED");
  assert.equal(run.meta?.secretScan?.ranAt, null);
});

test("buildChecksMeta stamps a run time only for actually run checks", () => {
  const ranAt = "2026-01-01T00:00:00.000Z";
  const meta = buildChecksMeta(
    {
      typescript: "PASS",
      tests: "NOT_RUN",
      build: "NOT_RUN",
      secretScan: "FAIL",
      postDeployHealth: "NOT_RUN",
    },
    { secretScan: "secret file detected" },
    ranAt,
  );

  assert.equal(meta.typescript?.ranAt, ranAt);
  assert.equal(meta.secretScan?.ranAt, ranAt);
  assert.equal(meta.tests?.ranAt, null);
  assert.equal(meta.build?.ranAt, null);
  assert.equal(meta.postDeployHealth?.ranAt, null);
  assert.equal(meta.secretScan?.reason, "secret file detected");
  assert.equal(meta.typescript?.command, DEPLOY_CHECK_COMMANDS.typescript);
});
