/**
 * RWQAN DEPLOY — stable-baseline read model.
 *
 * Builds the client-facing `DeployStableBaseline` from the recorded config plus
 * the read-only local Git HEAD. It never performs a deploy or a rollback, never
 * connects to production, and never claims the local HEAD equals the published
 * revision.
 */

import type { DeployGitInfo, DeployStableBaseline } from "../../shared/deploySystem";
import { RWQAN_STABLE_BASELINE, type StableBaselineConfig } from "../config/stableBaseline";

export function buildStableBaseline(
  git: DeployGitInfo | null,
  config: StableBaselineConfig = RWQAN_STABLE_BASELINE,
): DeployStableBaseline {
  const localHeadSha = git?.commitSha ?? null;
  const headMatchesBaseline =
    config.publishedSha && localHeadSha ? config.publishedSha === localHeadSha : null;
  return {
    site: config.site,
    hostingSource: config.hostingSource,
    publishedVersionId: config.publishedVersionId,
    publishedSha: config.publishedSha,
    verifiedAt: config.verifiedAt,
    healthChecks: { ...config.healthChecks },
    confidence: config.confidence,
    localHeadSha,
    headMatchesBaseline,
    notes: config.notes,
  };
}
