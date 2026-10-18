/**
 * RWQAN DEPLOY — official stable release record (read-only, non-secret).
 *
 * This records the REAL stable revision serving production (`rwqan.sa`), sourced
 * from the authoritative Firebase App Hosting deployment record:
 *   - project rwqan-757, backend rwqan, region europe-west4
 *   - rollout `rollout-2026-09-24-001` (state SUCCEEDED), build READY
 *   - commit `6c49647abdc14cd5176808fe79839e7ef3d7ebe9` on branch `main`
 *     ("Add unified account gateway and responsive signup")
 *
 * HONESTY RULES:
 *  - This module NEVER deploys, publishes, or connects to production. It is a
 *    config record only.
 *  - The record is surfaced ONLY after `resolveStableRelease` positively verifies
 *    that the commit exists AND is reachable in the LOCAL Git repository. When
 *    that verification fails, the release is simply not shown (fail closed).
 *  - It records a deploy that DID happen (a real App Hosting rollout succeeded);
 *    it does NOT claim this console performed it, and it never fakes a publish.
 *    `deployed` is true because the revision genuinely is the deployed one.
 */

import type { DeployRelease } from "../../shared/deploySystem";

/** Full commit SHA of the verified production stable release. */
export const RWQAN_STABLE_RELEASE_SHA =
  "6c49647abdc14cd5176808fe79839e7ef3d7ebe9";

/** Deterministic release id (stable across restarts; never random). */
export const RWQAN_STABLE_RELEASE_ID = `rel-stable-${RWQAN_STABLE_RELEASE_SHA}`;

/** Display name shown in the restore list. */
export const RWQAN_STABLE_RELEASE_VERSION = "النسخة المستقرة";

/** Read-only config record for the stable release. Not persisted, not a secret. */
export const RWQAN_STABLE_RELEASE: DeployRelease = {
  releaseId: RWQAN_STABLE_RELEASE_ID,
  version: RWQAN_STABLE_RELEASE_VERSION,
  environment: "LIVE",
  gitCommit: RWQAN_STABLE_RELEASE_SHA,
  gitTag: null,
  gitBranch: "main",
  sourceRepoUrl: "https://github.com/iheeb1/rwqan-sa.git",
  // Rollout created time (ISO, from the App Hosting deployment record).
  createdAt: "2026-09-24T22:24:23.519Z",
  createdBy: "admin",
  changeSummary:
    "النسخة المستقرة الحقيقية على الإنتاج (rwqan.sa): rollout ناجح من Firebase App Hosting بالـcommit الثابت.",
  status: "deployed",
  // This console did not run these checks at build time; recorded honestly.
  checks: {
    typescript: "NOT_RUN",
    tests: "NOT_RUN",
    build: "NOT_RUN",
    secretScan: "NOT_RUN",
    postDeployHealth: "NOT_RUN",
  },
  gitShortSha: RWQAN_STABLE_RELEASE_SHA.slice(0, 7),
  worktree: "unknown",
  savedToGit: true,
  deployed: true,
  simulated: false,
  deployTarget: "rwqan-757",
  stableBaseline: true,
  error: null,
};
