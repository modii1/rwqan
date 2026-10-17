import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPLOY_DEV_BACKEND_ID,
  DEPLOY_DEV_PROJECT_ID,
  type DeployTarget,
} from "../config/deployTarget";
import type {
  DeployChecks,
  DeployPostDeployVerification,
} from "../../shared/deploySystem";
import {
  RealDeployExecutor,
  type RealDeployDependencies,
} from "./DeployRealExecutor";

const COMMIT = "c".repeat(40);
const LOCATION = "us-central1";
const CHECKS: DeployChecks = {
  typescript: "PASS",
  tests: "NOT_RUN",
  build: "NOT_RUN",
  secretScan: "PASS",
  postDeployHealth: "NOT_RUN",
};

function devTarget(overrides: Partial<DeployTarget> = {}): DeployTarget {
  return {
    projectId: DEPLOY_DEV_PROJECT_ID,
    backendId: DEPLOY_DEV_BACKEND_ID,
    baseUrl: "https://dev.example.com",
    location: LOCATION,
    ...overrides,
  };
}

// The app probe now only proves reachability (commit identity comes from the
// control plane), so `ok` mirrors reachability.
function verification(ok: boolean): DeployPostDeployVerification {
  return {
    attempted: true,
    reachable: ok,
    ok,
    url: "https://dev.example.com/api/deploy-version",
    httpStatus: ok ? 200 : 503,
    expectedCommit: COMMIT,
    reportedCommit: null,
    reportedVersion: null,
    match: false,
    verifiedAt: "2026-01-01T00:00:00.000Z",
    ...(ok ? {} : { reason: "التطبيق غير مُتاح." }),
  };
}

interface FakeOptions {
  rolloutExit?: number;
  buildSource?: "ok" | "mismatch" | "absent";
  reachable?: boolean;
}

function fakeDeps(options: FakeOptions = {}) {
  const calls: Array<{
    stage: string;
    file: string;
    args: string[];
    env?: Record<string, string>;
    requireCommitProof?: boolean;
  }> = [];
  let probeCalls = 0;
  const buildSourceMode = options.buildSource ?? "ok";
  const deps: RealDeployDependencies = {
    runCommand: async (spec) => {
      calls.push({ stage: spec.stage, file: spec.file, args: spec.args, env: spec.env });
      return { exitCode: options.rolloutExit ?? 0, stdout: "", stderr: "" };
    },
    ...(buildSourceMode === "absent"
      ? {}
      : {
          verifyBuildSource: async () => ({
            attempted: true,
            ok: buildSourceMode === "ok",
            backend: DEPLOY_DEV_BACKEND_ID,
            expectedCommit: COMMIT,
            reportedCommit: buildSourceMode === "ok" ? COMMIT : "d".repeat(40),
            sourceKind: "codebase" as const,
            verifiedAt: "2026-01-01T00:00:00.000Z",
            ...(buildSourceMode === "ok"
              ? {}
              : { reason: "commit المخزَّن في البناء لا يطابق الـcommit المتوقع." }),
          }),
        }),
    probeHealth: async (input) => {
      probeCalls += 1;
      calls.push({
        stage: "probe",
        file: "",
        args: [],
        requireCommitProof: input.requireCommitProof,
      });
      return verification(options.reachable ?? true);
    },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    cwd: () => "C:/dev/project",
  };
  return { deps, calls, getProbeCalls: () => probeCalls };
}

function executor(
  deps: RealDeployDependencies,
  target: DeployTarget = devTarget(),
  enabled = true,
) {
  return new RealDeployExecutor({ target, dependencies: deps, realDeployEnabled: () => enabled });
}

test("a controlled rollout succeeds only after a control-plane source proof", async () => {
  const { deps, calls, getProbeCalls } = fakeDeps();
  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  assert.equal(outcome.deployed, true);
  assert.equal(outcome.savedToGit, false);
  assert.equal(outcome.target, DEPLOY_DEV_PROJECT_ID);
  assert.equal(outcome.releaseRef, `${DEPLOY_DEV_BACKEND_ID}:${COMMIT.slice(0, 7)}`);
  assert.equal(outcome.verify?.ok, true);
  assert.equal(outcome.buildSource?.ok, true);
  assert.equal(outcome.buildSource?.sourceKind, "codebase");

  const rollout = calls.find((call) => call.stage === "deploy");
  assert.ok(rollout);
  assert.equal(rollout!.file, "firebase");
  assert.ok(rollout!.args.includes("apphosting:rollouts:create"));
  assert.ok(rollout!.args.includes(DEPLOY_DEV_BACKEND_ID));
  assert.ok(rollout!.args.includes("--git-commit"));
  assert.ok(rollout!.args.includes(COMMIT));
  assert.ok(rollout!.args.includes("--location"));
  assert.ok(rollout!.args.includes(LOCATION));
  assert.ok(rollout!.args.includes("--project"));
  assert.ok(rollout!.args.includes(DEPLOY_DEV_PROJECT_ID));
  assert.ok(rollout!.args.includes("--config"));
  assert.ok(rollout!.args.includes("firebase.dev.json"));
  // The app probe is reachability-only because the proof is mandatory elsewhere.
  assert.equal(getProbeCalls(), 1);
});

test("a short commit sha is refused at the source gate before any command runs", async () => {
  const { deps, calls } = fakeDeps();
  const outcome = await executor(deps).publish({
    gitCommit: COMMIT.slice(0, 7),
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  assert.equal(outcome.deployed, false);
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.stage, "source");
  assert.equal(calls.length, 0);
});

test("a dirty worktree is refused at the source gate before any command runs", async () => {
  const { deps, calls } = fakeDeps();
  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "dirty",
  });
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.stage, "source");
  assert.ok(outcome.detail.includes("غير مُثبَّتة"));
  assert.equal(calls.length, 0);
});

test("an unknown worktree state is refused (fail closed) before any command runs", async () => {
  const { deps, calls } = fakeDeps();
  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
  });
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.stage, "source");
  assert.equal(calls.length, 0);
});

test("a deploy without explicit approval is blocked before any command runs", async () => {
  const { deps, calls, getProbeCalls } = fakeDeps();
  const outcome = await executor(deps).publish({ gitCommit: COMMIT, checks: CHECKS });
  assert.equal(outcome.deployed, false);
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.stage, "approval");
  assert.equal(calls.length, 0);
  assert.equal(getProbeCalls(), 0);
});

test("a disabled real deploy is blocked at approval before any command runs", async () => {
  const { deps, calls } = fakeDeps();
  const outcome = await executor(deps, devTarget(), false).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.stage, "approval");
  assert.equal(calls.length, 0);
});

test("a production or unknown target is refused before any command runs", async () => {
  const { deps, calls } = fakeDeps();
  const production = await executor(deps, devTarget({ projectId: "rwqan-757" })).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  assert.equal(production.blocked, true);
  assert.equal(production.stage, "target");

  const unknown = await executor(deps, devTarget({ projectId: "unknown-project" })).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  assert.equal(unknown.blocked, true);
  assert.equal(unknown.stage, "target");
  assert.equal(calls.length, 0);
});

test("a client-confirmed target that does not match the DEV target is refused", async () => {
  const { deps, calls } = fakeDeps();
  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
    requestedTarget: "rwqan-757",
  });
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.stage, "target");
  assert.equal(calls.length, 0);
});

test("a missing App Hosting location is refused before any command runs", async () => {
  const { deps, calls } = fakeDeps();
  const outcome = await executor(deps, devTarget({ location: null })).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.stage, "target");
  assert.ok(outcome.detail.includes("DEPLOY_APP_HOSTING_LOCATION"));
  assert.equal(calls.length, 0);
});

test("a real deploy is refused when the source-identity verifier is not configured", async () => {
  const { deps, calls } = fakeDeps({ buildSource: "absent" });
  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  assert.equal(outcome.deployed, false);
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.stage, "verify");
  assert.equal(calls.length, 0);
});

test("a failed rollout command stops before any proof and is not a success", async () => {
  const { deps, calls, getProbeCalls } = fakeDeps({ rolloutExit: 1 });
  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  assert.equal(outcome.deployed, false);
  assert.equal(outcome.stage, "deploy");
  assert.equal(calls.filter((call) => call.stage === "deploy").length, 1);
  assert.equal(getProbeCalls(), 0);
});

test("a mismatched control-plane build source is never reported as deployed", async () => {
  const { deps, getProbeCalls } = fakeDeps({ buildSource: "mismatch" });
  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  assert.equal(outcome.deployed, false);
  assert.equal(outcome.stage, "verify");
  assert.equal(outcome.buildSource?.ok, false);
  // Reachability is never even attempted when the source proof fails.
  assert.equal(getProbeCalls(), 0);
});

test("a proven source with no base url fails the reachability step", async () => {
  const { deps, getProbeCalls } = fakeDeps();
  const outcome = await executor(deps, devTarget({ baseUrl: null })).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  assert.equal(outcome.deployed, false);
  assert.equal(outcome.stage, "verify");
  assert.equal(outcome.buildSource?.ok, true);
  assert.equal(getProbeCalls(), 0);
});

test("a proven source but unreachable app is not reported as deployed", async () => {
  const { deps } = fakeDeps({ reachable: false });
  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  assert.equal(outcome.deployed, false);
  assert.equal(outcome.stage, "verify");
  assert.equal(outcome.buildSource?.ok, true);
  assert.equal(outcome.verify?.ok, false);
});
