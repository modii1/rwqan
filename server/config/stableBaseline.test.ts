import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyReleaseMaturity,
  isFullGitSha,
  type DeployRelease,
} from "../../shared/deploySystem";
import {
  buildRollbackReadiness,
  RWQAN_ROLLBACK_CAPABILITY,
  RWQAN_STABLE_BASELINE,
  type RollbackCapabilityConfig,
  type StableBaselineConfig,
} from "./stableBaseline";
import { buildStableBaseline } from "../services/DeployBaselineService";

const FULL_SHA = "a".repeat(40);

function release(overrides: Partial<DeployRelease> = {}): DeployRelease {
  return {
    releaseId: "rel-1",
    version: "1.0.0",
    environment: "TEST",
    gitCommit: FULL_SHA,
    gitTag: null,
    gitBranch: "main",
    sourceRepoUrl: "https://github.com/iheeb1/rwqan-sa.git",
    createdAt: "2026-10-16T00:00:00.000Z",
    createdBy: "admin",
    changeSummary: "",
    status: "deployed",
    checks: {
      typescript: "PASS",
      tests: "NOT_RUN",
      build: "NOT_RUN",
      secretScan: "PASS",
      postDeployHealth: "PASS",
    },
    savedToGit: true,
    deployed: true,
    simulated: false,
    deployTarget: "rwqan-sa-dev",
    ...overrides,
  };
}

test("the recorded baseline identity is unproven when no version id/SHA exists", () => {
  const baseline = buildStableBaseline(null);
  assert.equal(baseline.site, "rwqan.sa");
  assert.equal(baseline.publishedVersionId, null);
  assert.equal(baseline.publishedSha, null);
  assert.equal(baseline.confidence, "unknown");
  assert.equal(baseline.headMatchesBaseline, null);
  assert.equal(baseline.verifiedAt, null);
});

test("the local HEAD is never assumed to be the published version", () => {
  // Even with a known local HEAD, an unproven published SHA leaves it undetermined.
  const baseline = buildStableBaseline({
    available: true,
    commitSha: FULL_SHA,
    shortSha: FULL_SHA.slice(0, 7),
    branch: "main",
    worktree: "dirty",
    readAt: "2026-10-16T00:00:00.000Z",
  });
  assert.equal(baseline.localHeadSha, FULL_SHA);
  assert.equal(baseline.headMatchesBaseline, null);
  assert.equal(baseline.confidence, "unknown");
});

test("a known baseline SHA is compared against HEAD, surfacing a mismatch", () => {
  const config: StableBaselineConfig = {
    ...RWQAN_STABLE_BASELINE,
    publishedSha: "b".repeat(40),
    publishedVersionId: "0-1-2",
    confidence: "verified",
  };
  const same = buildStableBaseline(
    {
      available: true,
      commitSha: "b".repeat(40),
      shortSha: "bbbbbbb",
      branch: "main",
      worktree: "clean",
      readAt: "2026-10-16T00:00:00.000Z",
    },
    config,
  );
  assert.equal(same.headMatchesBaseline, true);

  const different = buildStableBaseline(
    {
      available: true,
      commitSha: "c".repeat(40),
      shortSha: "ccccccc",
      branch: "main",
      worktree: "clean",
      readAt: "2026-10-16T00:00:00.000Z",
    },
    config,
  );
  assert.equal(different.headMatchesBaseline, false);
});

test("an unverified release is never classified as stable baseline", () => {
  const flags = classifyReleaseMaturity(
    release({ checks: { typescript: "FAIL", tests: "NOT_RUN", build: "NOT_RUN", secretScan: "PASS", postDeployHealth: "NOT_RUN" } }),
    { baselineReleaseId: "rel-1", rollbackSupported: true },
  );
  assert.equal(flags.verified, false);
  assert.equal(flags.stableBaseline, false);
});

test("a stable baseline also requires a proven full SHA and actual deployment", () => {
  const noSha = classifyReleaseMaturity(
    release({ gitCommit: "unknown" }),
    { baselineReleaseId: "rel-1", rollbackSupported: true },
  );
  assert.equal(noSha.stableBaseline, false);

  const notDeployed = classifyReleaseMaturity(
    release({ deployed: false, simulated: true, status: "simulated" }),
    { baselineReleaseId: "rel-1", rollbackSupported: true },
  );
  assert.equal(notDeployed.stableBaseline, false);

  const ok = classifyReleaseMaturity(release(), {
    baselineReleaseId: "rel-1",
    rollbackSupported: true,
  });
  assert.equal(ok.verified, true);
  assert.equal(ok.deployed, true);
  assert.equal(ok.stableBaseline, true);
});

test("rollback is never considered ready without proof", () => {
  // Deployed + verified + full SHA, but hosting support is not established.
  assert.equal(
    classifyReleaseMaturity(release(), { rollbackSupported: undefined }).rollbackReady,
    false,
  );
  assert.equal(
    classifyReleaseMaturity(release({ deployed: false, simulated: true }), {
      rollbackSupported: true,
    }).rollbackReady,
    false,
  );
  assert.equal(
    classifyReleaseMaturity(release({ gitCommit: "unknown" }), {
      rollbackSupported: true,
    }).rollbackReady,
    false,
  );
  // A prior, proven, non-baseline release with confirmed hosting support is ready.
  assert.equal(
    classifyReleaseMaturity(release(), { rollbackSupported: true }).rollbackReady,
    true,
  );
});

test("maturity labels are distinct (candidate vs deployed vs verified)", () => {
  const candidate = classifyReleaseMaturity(
    release({ deployed: false, simulated: false, status: "validated" }),
  );
  assert.equal(candidate.candidate, true);
  assert.equal(candidate.deployed, false);

  const deployed = classifyReleaseMaturity(release());
  assert.equal(deployed.deployed, true);
  assert.equal(deployed.candidate, false);
});

test("the live rollback capability is documented but not confirmed here", () => {
  const readiness = buildRollbackReadiness();
  assert.equal(readiness.supported, true);
  assert.equal(readiness.confirmed, false);
  assert.equal(readiness.readyToRollback, false);
  assert.equal(readiness.codeOnly, false);

  const unsupported: RollbackCapabilityConfig = {
    ...RWQAN_ROLLBACK_CAPABILITY,
    supported: false,
  };
  assert.equal(buildRollbackReadiness(unsupported).readyToRollback, false);
});

test("isFullGitSha only accepts a full 40-char hex SHA", () => {
  assert.equal(isFullGitSha(FULL_SHA), true);
  assert.equal(isFullGitSha("seed00001"), false);
  assert.equal(isFullGitSha("unknown"), false);
  assert.equal(isFullGitSha(null), false);
  assert.equal(isFullGitSha("a".repeat(39)), false);
});
