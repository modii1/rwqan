import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPLOY_GATE_LABELS,
  isFullGitSha,
  type DeployCheckRun,
  type DeployGitHubInfo,
  type DeployGitInfo,
} from "../../shared/deploySystem";
import {
  DEPLOY_DEV_BACKEND_ID,
  DEPLOY_DEV_PROJECT_ID,
  DEPLOY_PROD_BACKEND_ID,
  DEPLOY_PROD_PROJECT_ID,
  deployTargetBlockers,
  type DeployTarget,
} from "../config/deployTarget";
import {
  evaluatePreDeployGate,
  type DeployGateInput,
} from "./DeployPrepublishGate";

function target(overrides: Partial<DeployTarget> = {}): DeployTarget {
  return {
    projectId: DEPLOY_DEV_PROJECT_ID,
    backendId: DEPLOY_DEV_BACKEND_ID,
    baseUrl: null,
    location: "us-central1",
    ...overrides,
  };
}

function git(overrides: Partial<DeployGitInfo> = {}): DeployGitInfo {
  return {
    available: true,
    commitSha: "a".repeat(40),
    shortSha: "abc1234",
    branch: "test/unified-gateway-ui-only",
    worktree: "clean",
    readAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function github(overrides: Partial<DeployGitHubInfo> = {}): DeployGitHubInfo {
  return {
    available: true,
    remoteUrl: "https://github.com/iheeb1/rwqan-sa.git",
    remoteSha: "a".repeat(40),
    match: "match",
    source: "local_ref",
    readAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function checks(
  overrides: Partial<DeployCheckRun["checks"]> = {},
): DeployCheckRun {
  return {
    ranAt: new Date(0).toISOString(),
    checks: {
      typescript: "PASS",
      tests: "NOT_RUN",
      build: "NOT_RUN",
      secretScan: "PASS",
      postDeployHealth: "NOT_RUN",
      ...overrides,
    },
  };
}

function input(overrides: Partial<DeployGateInput> = {}): DeployGateInput {
  return {
    environment: "TEST",
    git: git(),
    github: github(),
    latestCheckRun: checks(),
    realDeployEnabled: true,
    productionDeployEnabled: false,
    verifySourceConfig: { enabled: true },
    target: target({ baseUrl: "https://dev.example.com" }),
    targetBlockers: [],
    dataEnvironment: "TEST",
    tools: {
      firebaseCliAvailable: true,
      firebaseCliVersion: "15.34.0",
      readAt: new Date(0).toISOString(),
    },
    ...overrides,
  };
}

function itemState(
  state: ReturnType<typeof evaluatePreDeployGate>,
  key: string,
) {
  const found = state.items.find((entry) => entry.key === key);
  assert.ok(found, `gate item ${key} expected to exist`);
  return found.state;
}

test("the gate has exactly three Arabic labels", () => {
  assert.equal(DEPLOY_GATE_LABELS.ready_for_review, "جاهز للمراجعة");
  assert.equal(DEPLOY_GATE_LABELS.blocked_by_failed_check, "ممنوع بسبب فشل فحص");
  assert.ok(
    DEPLOY_GATE_LABELS.unverified_missing_info.includes("غير متحقق"),
  );
});

test("all conditions proven → جاهز للمراجعة (TEST target, TEST data)", () => {
  const gate = evaluatePreDeployGate(input());
  assert.equal(gate.status, "ready_for_review");
  for (const entry of gate.items) {
    assert.equal(entry.state, "ok", `${entry.key} must be ok`);
  }
});

test("a dirty worktree is BLOCKED (verdict: ممنوع بسبب فشل فحص)", () => {
  const gate = evaluatePreDeployGate(input({ git: git({ worktree: "dirty" }) }));
  assert.equal(gate.status, "blocked_by_failed_check");
  assert.equal(itemState(gate, "git_worktree"), "blocked");
});

test("a non-full SHA is BLOCKED; a full SHA passes", () => {
  const short = evaluatePreDeployGate(
    input({ git: git({ commitSha: "abc1234" }) }),
  );
  assert.equal(short.status, "blocked_by_failed_check");
  assert.equal(itemState(short, "commit_sha"), "blocked");

  const full = evaluatePreDeployGate(input());
  assert.equal(itemState(full, "commit_sha"), "ok");
  // And the predicate used by the gate is the shared sha predicate.
  assert.equal(isFullGitSha("a".repeat(40)), true);
});

test("a failed secret scan BLOCKS the gate (never bypassable)", () => {
  for (const secretScan of ["FAIL", "BLOCKED"] as const) {
    const gate = evaluatePreDeployGate(
      input({ latestCheckRun: checks({ secretScan }) }),
    );
    assert.equal(gate.status, "blocked_by_failed_check", secretScan);
    assert.equal(itemState(gate, "release_checks"), "blocked");
  }
});

test("a FAILED TypeScript check BLOCKS the gate", () => {
  const gate = evaluatePreDeployGate(
    input({ latestCheckRun: checks({ typescript: "FAIL" }) }),
  );
  assert.equal(gate.status, "blocked_by_failed_check");
  assert.equal(itemState(gate, "release_checks"), "blocked");
});

test("NOT_RUN checks are UNVERIFIED, never a fake PASS", () => {
  const gate = evaluatePreDeployGate(
    input({ latestCheckRun: checks({ typescript: "NOT_RUN" }) }),
  );
  assert.equal(gate.status, "unverified_missing_info");
  assert.equal(itemState(gate, "release_checks"), "unverified");

  const noRun = evaluatePreDeployGate(input({ latestCheckRun: null }));
  assert.equal(noRun.status, "unverified_missing_info");
  assert.equal(itemState(noRun, "release_checks"), "unverified");
});

test("target blockers surface as blocked with the server's Arabic reasons", () => {
  const blockers = deployTargetBlockers(
    target({ projectId: DEPLOY_PROD_PROJECT_ID, backendId: DEPLOY_PROD_BACKEND_ID }),
    "TEST",
  );
  assert.ok(blockers.length > 0, "a TEST deploy aiming at prod must be blocked");
  const gate = evaluatePreDeployGate(input({ targetBlockers: blockers }));
  assert.equal(gate.status, "blocked_by_failed_check");
  assert.equal(itemState(gate, "target_config"), "blocked");
});

test("missing real-deploy opt-in BLOCKS; TEST never requires the production opt-in", () => {
  const closed = evaluatePreDeployGate(input({ realDeployEnabled: false }));
  assert.equal(closed.status, "blocked_by_failed_check");
  assert.equal(itemState(closed, "real_deploy_opt_in"), "blocked");
  assert.equal(itemState(closed, "production_opt_in"), "ok");
});

test("a LIVE target without the production opt-in is BLOCKED", () => {
  const gate = evaluatePreDeployGate(
    input({
      environment: "LIVE",
      target: target({
        projectId: DEPLOY_PROD_PROJECT_ID,
        backendId: DEPLOY_PROD_BACKEND_ID,
        baseUrl: "https://rwqan.sa",
      }),
      productionDeployEnabled: false,
    }),
  );
  assert.equal(gate.status, "blocked_by_failed_check");
  assert.equal(itemState(gate, "production_opt_in"), "blocked");
});

test("missing location/base-url/verify-config/tools turn the gate UNVERIFIED (no fake readiness)", () => {
  let gate = evaluatePreDeployGate(input({ target: target({ location: null }) }));
  assert.equal(gate.status, "unverified_missing_info");
  assert.equal(itemState(gate, "apphosting_location"), "unverified");

  gate = evaluatePreDeployGate(input({ target: target({ baseUrl: null }) }));
  assert.equal(itemState(gate, "verify_url"), "unverified");

  gate = evaluatePreDeployGate(
    input({ verifySourceConfig: { enabled: false, reason: "غير مضبوط." } }),
  );
  assert.equal(itemState(gate, "build_source_verify"), "unverified");
  assert.ok(
    gate.items
      .find((entry) => entry.key === "build_source_verify")
      ?.reason?.includes("غير مضبوط."),
  );

  gate = evaluatePreDeployGate(input({ tools: null }));
  assert.equal(itemState(gate, "firebase_cli"), "unverified");

  gate = evaluatePreDeployGate(
    input({
      tools: {
        firebaseCliAvailable: false,
        firebaseCliVersion: null,
        readAt: new Date(0).toISOString(),
      },
    }),
  );
  assert.equal(gate.status, "blocked_by_failed_check", "no CLI → no rollout");
  assert.equal(itemState(gate, "firebase_cli"), "blocked");
});

test("data isolation honesty: TEST+TEST ok, TEST+LIVE preview unverified, LIVE unverified", () => {
  const isolated = evaluatePreDeployGate(input());
  assert.equal(itemState(isolated, "data_isolation"), "ok");

  const preview = evaluatePreDeployGate(input({ dataEnvironment: "LIVE" }));
  assert.equal(itemState(preview, "data_isolation"), "unverified");
  assert.equal(preview.status, "unverified_missing_info");

  const live = evaluatePreDeployGate(
    input({
      environment: "LIVE",
      target: target({
        projectId: DEPLOY_PROD_PROJECT_ID,
        backendId: DEPLOY_PROD_BACKEND_ID,
        baseUrl: "https://rwqan.sa",
      }),
      productionDeployEnabled: true,
    }),
  );
  assert.equal(itemState(live, "data_isolation"), "unverified");
});

test("LOCAL+LOCAL data isolation is ok; LOCAL+TEST is unverified", () => {
  const localIsolated = evaluatePreDeployGate(
    input({ environment: "LOCAL", dataEnvironment: "LOCAL" }),
  );
  assert.equal(itemState(localIsolated, "data_isolation"), "ok");

  const mixed = evaluatePreDeployGate(
    input({ environment: "LOCAL", dataEnvironment: "TEST" }),
  );
  assert.equal(itemState(mixed, "data_isolation"), "unverified");
});

test("LOCAL never requires the production opt-in", () => {
  const gate = evaluatePreDeployGate(
    input({ environment: "LOCAL", productionDeployEnabled: false }),
  );
  assert.equal(itemState(gate, "production_opt_in"), "ok");
});
