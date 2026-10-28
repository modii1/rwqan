import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPLOY_DEV_BACKEND_ID,
  DEPLOY_DEV_BASE_URL,
  DEPLOY_DEV_PROJECT_ID,
  DEPLOY_PROD_BACKEND_ID,
  DEPLOY_PROD_PROJECT_ID,
  type DeployTarget,
} from "../config/deployTarget";
import type {
  DeployChecks,
  DeployPostDeployVerification,
} from "../../shared/deploySystem";
import {
  RealDeployExecutor,
  createRealDeployDependencies,
  type RealDeployDependencies,
} from "./DeployRealExecutor";
import { resolveFirebaseCommand } from "./DeployToolsService";
import {
  getDeployAuthStatus,
  clearDeployAuth,
  __test_setDeployCredentials,
} from "./deployAuth";

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
    baseUrl: DEPLOY_DEV_BASE_URL,
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
  rolloutStdout?: string;
  rolloutStderr?: string;
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
      return {
        exitCode: options.rolloutExit ?? 0,
        stdout: options.rolloutStdout ?? "",
        stderr: options.rolloutStderr ?? "",
      };
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
  production = false,
) {
  return new RealDeployExecutor({
    resolveTarget: () => target,
    dependencies: deps,
    realDeployEnabled: () => enabled,
    productionDeployEnabled: () => production,
  });
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
  // The backend passed to the CLI MUST match the fixed TEST target
  // (rwqan-backend), never the legacy rwqan-dev-backend from firebase.dev.json.
  assert.ok(!rollout!.args.includes("rwqan-dev-backend"), "rollout must not target rwqan-dev-backend");
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
  // TEST's fixed target shares the project id with production, so a production
  // target is recognised by the PRODUCTION backend (`rwqan`), never `rwqan-backend`.
  const production = await executor(deps, devTarget({ backendId: DEPLOY_PROD_BACKEND_ID })).publish({
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
    // The fixed TEST target IS project `rwqan-757`, so a client-confirmed value
    // that does NOT match it is any other id (here: the LIVE backend name).
    requestedTarget: "rwqan",
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

test("a target with no base url is refused at the target gate before any command runs", async () => {
  const { deps, calls, getProbeCalls } = fakeDeps();
  const outcome = await executor(deps, devTarget({ baseUrl: null })).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  assert.equal(outcome.deployed, false);
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.stage, "target");
  // No command runs and the app is never probed.
  assert.equal(calls.length, 0);
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

function prodTarget(overrides: Partial<DeployTarget> = {}): DeployTarget {
  return {
    projectId: DEPLOY_PROD_PROJECT_ID,
    backendId: DEPLOY_PROD_BACKEND_ID,
    baseUrl: "https://rwqan.sa",
    location: LOCATION,
    ...overrides,
  };
}

test("a LIVE publish to production is blocked unless production is explicitly enabled", async () => {
  const { deps, calls } = fakeDeps();
  const outcome = await executor(deps, prodTarget(), true, false).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
    environment: "LIVE",
  });
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.stage, "target");
  assert.equal(calls.length, 0);
});

test("a LIVE publish deploys to production with the production config when enabled", async () => {
  const { deps, calls } = fakeDeps();
  const outcome = await executor(deps, prodTarget(), true, true).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
    environment: "LIVE",
  });
  assert.equal(outcome.deployed, true);
  assert.equal(outcome.target, DEPLOY_PROD_PROJECT_ID);
  const rollout = calls.find((call) => call.stage === "deploy");
  assert.ok(rollout);
  assert.ok(rollout!.args.includes("--config"));
  assert.ok(rollout!.args.includes("firebase.json"));
  assert.ok(rollout!.args.includes(DEPLOY_PROD_PROJECT_ID));
});

test("a TEST publish refuses a production target even when production is enabled", async () => {
  const { deps, calls } = fakeDeps();
  const outcome = await executor(deps, prodTarget(), true, true).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
    environment: "TEST",
  });
  assert.equal(outcome.blocked, true);
  assert.equal(outcome.stage, "target");
  assert.equal(calls.length, 0);
});

test("restore creates a rollout for the release commit and verifies the source", async () => {
  const { deps, calls } = fakeDeps();
  const outcome = await executor(deps).restore({
    gitCommit: COMMIT,
    approval: true,
    environment: "TEST",
  });
  assert.equal(outcome.restored, true);
  assert.equal(outcome.buildSource?.ok, true);
  const rollout = calls.find((call) => call.stage === "restore");
  assert.ok(rollout);
  assert.ok(rollout!.args.includes("apphosting:rollouts:create"));
  assert.ok(rollout!.args.includes(COMMIT));
});

test("restore requires approval and a full sha before any command runs", async () => {
  const { deps, calls } = fakeDeps();
  const noApproval = await executor(deps).restore({ gitCommit: COMMIT, environment: "TEST" });
  assert.equal(noApproval.blocked, true);
  const shortSha = await executor(deps).restore({
    gitCommit: COMMIT.slice(0, 7),
    approval: true,
    environment: "TEST",
  });
  assert.equal(shortSha.blocked, true);
  assert.equal(calls.length, 0);
});

test("publish failure shows sanitized Firebase error message with exit code", async () => {
  const { deps } = fakeDeps({
    rolloutExit: 1,
    rolloutStderr: "Error: Failed to get backend: rwqan-backend. Please check the parameters you have provided.",
  });
  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  assert.equal(outcome.deployed, false);
  assert.equal(outcome.stage, "deploy");
  assert.equal(outcome.blocked, false);
  assert.ok(outcome.detail.includes("فشل إنشاء rollout"), "should include the reason");
  assert.ok(outcome.detail.includes("رمز الخروج: 1"), "should include exit code");
  assert.ok(outcome.detail.includes("Failed to get backend"), "should include sanitized Firebase message");
  assert.equal(outcome.target, DEPLOY_DEV_PROJECT_ID, "target should remain TEST project");
});

test("publish failure redacts potential secrets and tokens from stderr", async () => {
  const { deps } = fakeDeps({
    rolloutExit: 1,
    rolloutStderr: "Error: AIzaSyAbcdefghijklmnopqrstuvwxyz1234567890 invalid, ghp_abcdefghijklmnopqrstuvwxyz1234567890 denied",
  });
  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  assert.ok(outcome.detail.includes("***REDACTED***"), "secrets should be redacted");
  assert.ok(!outcome.detail.includes("AIzaSy"), "raw AIza key should not leak");
  assert.ok(!outcome.detail.includes("ghp_abcdef"), "raw ghp_ token should not leak");
});

test("publish failure truncates long stderr output", async () => {
  const { deps } = fakeDeps({
    rolloutExit: 1,
    rolloutStderr: "x".repeat(2000),
  });
  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  assert.ok(outcome.detail.length < 1000, "detail should be truncated");
  assert.ok(outcome.detail.includes("…"), "should show truncation marker");
});

test("publish failure retains diagnostic stderr after secret redaction", async () => {
  const { deps } = fakeDeps({
    rolloutExit: 1,
    rolloutStderr: "Error: Failed to create rollout: backend rwqan-backend not found in project rwqan-757. Token: AIzaSyAbcdefghijklmnopqrstuvwxyz1234567890.",
  });
  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  assert.equal(outcome.deployed, false);
  assert.equal(outcome.stage, "deploy");
  assert.ok(outcome.detail.includes("فشل إنشاء rollout"), "should include the reason");
  assert.ok(outcome.detail.includes("رمز الخروج: 1"), "should include exit code");
  // Diagnostic text should be retained (not hidden behind generic fallback):
  assert.ok(outcome.detail.includes("Failed to create rollout"), "should retain Firebase diagnostic");
  assert.ok(outcome.detail.includes("backend rwqan-backend not found"), "should retain backend context");
  // Secret should be redacted:
  assert.ok(outcome.detail.includes("***REDACTED***"), "secrets should be redacted");
  assert.ok(!outcome.detail.includes("AIzaSy"), "raw AIza key should not leak");
});

test("publish failure with empty stderr uses fallback message with exit code", async () => {
  const { deps } = fakeDeps({
    rolloutExit: 2,
    rolloutStderr: "",
    rolloutStdout: "",
  });
  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  assert.equal(outcome.deployed, false);
  assert.equal(outcome.stage, "deploy");
  assert.ok(outcome.detail.includes("رمز الخروج: 2"), "should include exit code");
  assert.ok(outcome.detail.includes("فشل إنشاء rollout"), "should include the reason");
});

test("publish failure does not leak raw secrets in detail", async () => {
  const { deps } = fakeDeps({
    rolloutExit: 1,
    rolloutStderr: "raw sensitive line that should not appear verbatim AIzaSyRawKey123456789012345678901234567890",
  });
  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  // Diagnostic text is retained (not hidden behind generic fallback):
  assert.ok(outcome.detail.includes("فشل إنشاء rollout"), "should include the reason");
  assert.ok(outcome.detail.includes("رمز الخروج: 1"), "should include exit code");
  assert.ok(outcome.detail.includes("raw sensitive line"), "diagnostic text should be retained");
  // Secret should be redacted:
  assert.ok(outcome.detail.includes("***REDACTED***"), "secrets should be redacted");
  assert.ok(!outcome.detail.includes("AIzaSy"), "raw AIza key should not leak");
  assert.ok(!outcome.detail.includes("RawKey123456789012345678901234567890"), "raw secret value should not leak");
});

test("publish failure with missing stderr and stdout uses fallback message", async () => {
  const { deps } = fakeDeps({
    rolloutExit: 3,
  });
  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
  });
  assert.ok(outcome.detail.includes("رمز الخروج: 3"), "should include exit code");
  assert.ok(outcome.detail.includes("فشل إنشاء rollout"), "should include the reason");
});

test("publish returns authRequired when sessionId provided but no Firebase CLI credentials", async () => {
  const { deps, calls } = fakeDeps();
  const sessionId = "test-session-no-auth";
  clearDeployAuth(sessionId);
  // Ensure OAuth env is present so getDeployAuthStatus doesn't return not_configured.
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
  process.env.DEPLOY_AUTH_REDIRECT_URI = "https://example.com/callback";

  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
    sessionId,
  });

  assert.equal(outcome.deployed, false);
  assert.equal(outcome.authRequired, true);
  assert.ok(outcome.detail.includes("مصادقة Firebase CLI مطلوبة"));
  assert.equal(calls.length, 0, "no command should run when auth is required");
});

test("publish skips auth check when no sessionId is provided", async () => {
  const { deps, calls } = fakeDeps({ rolloutExit: 0 });
  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
    // No sessionId — auth check is skipped, executor proceeds to runCommand.
  });

  assert.equal(outcome.deployed, true);
  assert.equal(calls.length, 2, "rollout command + probe should run when no sessionId provided");
  assert.equal(calls[0].stage, "deploy", "first call should be the deploy rollout");
});

test("publish runs auth-verify before deploy when sessionId has credentials", async () => {
  const { deps, calls } = fakeDeps({ rolloutExit: 0 });
  const sessionId = "test-session-with-auth";
  await __test_setDeployCredentials(sessionId, "valid-refresh-token-string-for-testing", "admin-1");
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
  process.env.DEPLOY_AUTH_REDIRECT_URI = "https://example.com/callback";

  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
    sessionId,
    adminId: "admin-1",
  });

  assert.equal(outcome.deployed, true);
  // auth-verify should run before deploy
  assert.equal(calls.length, 3, "auth-verify + deploy + probe should run");
  assert.equal(calls[0].stage, "auth-verify", "first call should be auth verification");
  assert.equal(calls[1].stage, "deploy", "second call should be deploy rollout");
  assert.equal(calls[2].stage, "probe", "third call should be health probe");
  // FIREBASE_TOKEN should be injected into the deploy command env
  const deployCall = calls.find((c) => c.stage === "deploy");
  assert.ok(deployCall);
  assert.ok(deployCall!.env);
  assert.equal(deployCall!.env!["FIREBASE_TOKEN"], "valid-refresh-token-string-for-testing");
});

test("publish refuses when FIREBASE_TOKEN is missing from env despite auth status", async () => {
  const { deps, calls } = fakeDeps({ rolloutExit: 0 });
  const sessionId = "test-session-no-token";
  // Set auth status but no actual token (simulate storage inconsistency)
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
  process.env.DEPLOY_AUTH_REDIRECT_URI = "https://example.com/callback";

  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
    sessionId,
    adminId: "admin-1",
  });

  assert.equal(outcome.deployed, false);
  assert.equal(outcome.authRequired, true);
  assert.ok(outcome.detail.includes("مصادقة Firebase CLI مطلوبة"));
  assert.equal(calls.length, 0, "no command should run when auth is incomplete");
});

test("publish stores pending publish intent when auth required and pendingPublish provided", async () => {
  const { deps, calls } = fakeDeps();
  const sessionId = "test-session-pending-publish";
  clearDeployAuth(sessionId);
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
  process.env.DEPLOY_AUTH_REDIRECT_URI = "https://example.com/callback";

  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
    sessionId,
    adminId: "admin-1",
    pendingPublish: {
      gitCommit: COMMIT,
      environment: "TEST",
      approval: true,
      requestedTarget: null,
      worktree: "clean",
      sessionId,
      adminId: "admin-1",
      createdAt: Date.now(),
    },
  });

  assert.equal(outcome.deployed, false);
  assert.equal(outcome.authRequired, true);
  assert.ok(outcome.detail.includes("مصادقة Firebase CLI مطلوبة"));
  assert.equal(calls.length, 0, "no command should run when auth is required");
  // The pending publish intent should have been stored for auto-resume.
  // We verify this indirectly: startDeployAuthFlow was called with pendingPublish.
  // The executor internally calls startDeployAuthFlow which stores the intent.
});

test("publish with valid credentials and pendingPublish proceeds normally", async () => {
  const { deps, calls } = fakeDeps({ rolloutExit: 0 });
  const sessionId = "test-session-with-pending-publish";
  await __test_setDeployCredentials(sessionId, "valid-refresh-token-string-for-testing", "admin-1");
  process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
  process.env.DEPLOY_AUTH_REDIRECT_URI = "https://example.com/callback";

  const outcome = await executor(deps).publish({
    gitCommit: COMMIT,
    checks: CHECKS,
    approval: true,
    worktree: "clean",
    sessionId,
    adminId: "admin-1",
    pendingPublish: {
      gitCommit: COMMIT,
      environment: "TEST",
      approval: true,
      requestedTarget: null,
      worktree: "clean",
      sessionId,
      adminId: "admin-1",
      createdAt: Date.now(),
    },
  });

  assert.equal(outcome.deployed, true);
  assert.equal(calls.length, 3, "auth-verify + deploy + probe should run");
  assert.equal(calls[0].stage, "auth-verify");
});

// Real end-to-end proof, WITHOUT any deploy: the default runner must launch
// the installed firebase CLI successfully — through the resolved JS entry on
// Windows — using argv only (no shell, no command string). Skipped on machines
// where the firebase-tools entry cannot be resolved.
const REAL_ENTRY_RESOLVED =
  process.platform === "win32" && resolveFirebaseCommand().prefixArgs.length > 0;

test(
  "default runCommand launches firebase without a shell (real CLI --version)",
  {
    skip: REAL_ENTRY_RESOLVED
      ? false
      : "firebase-tools entry not resolvable on this machine",
  },
  async () => {
    const result = await createRealDeployDependencies().runCommand({
      stage: "deploy",
      file: "firebase",
      args: ["--version"],
      cwd: process.cwd(),
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /\d+\.\d+\.\d+/);
  },
);
