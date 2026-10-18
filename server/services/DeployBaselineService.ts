/**
 * RWQAN DEPLOY — stable-baseline read model.
 *
 * Builds the client-facing `DeployStableBaseline`. When production control-plane
 * verification is enabled it queries the App Hosting control plane for the build
 * ACTUALLY serving `https://rwqan.sa` (`traffic.current` → `source.codebase.hash`)
 * and, when a matching PUBLISHED release exists in the registry, records it as
 * the verified stable reference. Otherwise it stays `confidence: "unknown"` — it
 * never assumes the local HEAD is the published revision, and never invents a SHA.
 *
 * The network client is injectable and off unless explicitly enabled, so tests
 * never touch the network and the default state is fail-closed.
 */

import type {
  DeployChecks,
  DeployGitInfo,
  DeployRelease,
  DeployStableBaseline,
  DeployVerificationConfidence,
} from "../../shared/deploySystem";
import { isFullGitSha } from "../../shared/deploySystem";
import { RWQAN_STABLE_BASELINE, type StableBaselineConfig } from "../config/stableBaseline";
import {
  DEPLOY_PROD_BACKEND_ID,
  DEPLOY_PROD_PROJECT_ID,
} from "../config/deployTarget";
import {
  createAppHostingBuildSourceClient,
  resolveAppHostingVerifyConfig,
  type AppHostingBuildSourceClient,
} from "./DeployBuildSourceService";

const NOT_RUN_CHECKS: DeployChecks = {
  typescript: "NOT_RUN",
  tests: "NOT_RUN",
  build: "NOT_RUN",
  secretScan: "NOT_RUN",
  postDeployHealth: "NOT_RUN",
};

/** A resolved (or explicitly unresolved) published-revision identity. */
export interface ResolvedBaselineIdentity {
  publishedSha: string | null;
  publishedVersionId: string | null;
  baselineReleaseId: string | null;
  verifiedAt: string | null;
  confidence: DeployVerificationConfidence;
  healthChecks: DeployChecks;
  notes: string;
}

/**
 * Resolve the production published revision from the hosting control plane and
 * match it against a published registry release. Returns `undefined` when the
 * check is disabled/misconfigured or the control plane cannot be reached, so the
 * caller falls back to the honest `unknown` baseline.
 */
export async function resolveProductionBaselineIdentity(input: {
  releases: DeployRelease[];
  location: string | null;
  enabled: boolean;
  client?: AppHostingBuildSourceClient;
  now?: () => string;
}): Promise<ResolvedBaselineIdentity | undefined> {
  if (!input.enabled || !input.location) return undefined;
  const now = input.now ?? (() => new Date().toISOString());
  const client = input.client ?? createAppHostingBuildSourceClient();

  let source;
  try {
    source = await client.getServingBuildSource({
      projectId: DEPLOY_PROD_PROJECT_ID,
      backendId: DEPLOY_PROD_BACKEND_ID,
      location: input.location,
    });
  } catch {
    return undefined;
  }

  const sha = source.commitSha;
  const proven =
    source.state === "ready" &&
    source.sourceKind === "codebase" &&
    typeof sha === "string" &&
    isFullGitSha(sha);

  if (!proven) {
    return {
      publishedSha: null,
      publishedVersionId: source.buildName ?? null,
      baselineReleaseId: null,
      verifiedAt: now(),
      confidence: "unknown",
      healthChecks: { ...NOT_RUN_CHECKS },
      notes:
        "تعذّر تأكيد النسخة المنشورة فعليًا من لوحة تحكم App Hosting (حركة مرور غير مؤكدة أو مصدر غير مستودع).",
    };
  }

  const normalized = sha.toLowerCase();
  const match = input.releases.find(
    (release) => release.deployed === true && release.gitCommit.toLowerCase() === normalized,
  );

  return {
    publishedSha: normalized,
    publishedVersionId: match?.releaseId ?? source.buildName ?? null,
    baselineReleaseId: match?.releaseId ?? null,
    verifiedAt: now(),
    confidence: match ? "verified" : "partially_verified",
    healthChecks: { ...NOT_RUN_CHECKS },
    notes: match
      ? "النسخة المنشورة مُثبَتة من لوحة تحكم App Hosting وتطابق سجل إصدار منشور."
      : "النسخة المنشورة مُثبَتة من لوحة تحكم App Hosting لكن لا يوجد سجل إصدار منشور مطابق.",
  };
}

export function buildStableBaseline(
  git: DeployGitInfo | null,
  config: StableBaselineConfig = RWQAN_STABLE_BASELINE,
  resolved?: ResolvedBaselineIdentity,
): DeployStableBaseline {
  const localHeadSha = git?.commitSha ?? null;
  const publishedSha = resolved?.publishedSha ?? config.publishedSha;
  const headMatchesBaseline =
    publishedSha && localHeadSha ? publishedSha === localHeadSha : null;
  return {
    site: config.site,
    hostingSource: config.hostingSource,
    publishedVersionId: resolved?.publishedVersionId ?? config.publishedVersionId,
    publishedSha,
    verifiedAt: resolved?.verifiedAt ?? config.verifiedAt,
    healthChecks: { ...(resolved?.healthChecks ?? config.healthChecks) },
    confidence: resolved?.confidence ?? config.confidence,
    localHeadSha,
    headMatchesBaseline,
    notes: resolved?.notes ?? config.notes,
  };
}
