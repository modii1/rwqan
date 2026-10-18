import {
  DEPLOY_PROTOTYPE_VERSION,
  isFullGitSha,
} from "../../shared/deploySystem";
import { readDeployGitInfo } from "./DeployGitInfoService";

/**
 * RWQAN DEPLOY: the running-version identity surfaced by GET /api/deploy-version.
 *
 * Trust model for the commit:
 *   1. `RWQAN_DEPLOY_COMMIT` — a value injected into the build/runtime by the
 *      build/deploy pipeline from the SAME clean commit that produced the
 *      artifact (never sent by a client). This is the ONLY source trusted in a
 *      production runtime; see docs/DEPLOY_SYSTEM_PHASE_C_AR.md (E.9) for how it
 *      must be re-injected on every deploy so it never goes stale.
 *   2. The read-only local Git HEAD (`git rev-parse HEAD`) — allowed ONLY in
 *      local development (`NODE_ENV=development`). It is a convenience for the
 *      dev machine and is NEVER used to assert the identity of a production or
 *      deployed build, because HEAD does not prove what source was built (the
 *      worktree may be dirty).
 *
 * Consequence: in a production runtime with no injected value the commit is
 * `null` / `commitSource: "unknown"`, and the post-deploy probe
 * (DeployHealthService) fails closed. The endpoint never invents a SHA and never
 * trusts caller-supplied input.
 *
 * Note: a matching reported value proves only that the running app reports the
 * injected value — it does NOT by itself prove the value equals the built source
 * unless the injection step (E.9) is the documented, verifiable per-deploy step.
 */
export const DEPLOY_VERSION_COMMIT_ENV = "RWQAN_DEPLOY_COMMIT";
export const DEPLOY_VERSION_APP_VERSION_ENV = "RWQAN_APP_VERSION";

export type DeployVersionCommitSource = "env" | "git" | "unknown";
export type DeployVersionValueSource = "env" | "default";

export interface DeployVersionInfo {
  commit: string | null;
  version: string;
  commitSource: DeployVersionCommitSource;
  versionSource: DeployVersionValueSource;
}

export interface ResolveDeployVersionDeps {
  /** Environment to read build/runtime values from (defaults to process.env). */
  environment?: NodeJS.ProcessEnv;
  /** Working directory for the read-only local Git fallback. */
  cwd?: string;
  /** Injectable read-only Git HEAD reader (defaults to the real one). */
  readGitCommit?: (cwd: string) => Promise<string | null>;
}

async function defaultReadGitCommit(cwd: string): Promise<string | null> {
  const info = await readDeployGitInfo(cwd);
  return info.available ? info.commitSha : null;
}

export async function resolveDeployVersionInfo(
  deps: ResolveDeployVersionDeps = {},
): Promise<DeployVersionInfo> {
  const environment = deps.environment ?? process.env;

  const rawVersion = environment[DEPLOY_VERSION_APP_VERSION_ENV]?.trim() ?? "";
  const version = rawVersion || DEPLOY_PROTOTYPE_VERSION;
  const versionSource: DeployVersionValueSource = rawVersion ? "env" : "default";

  const rawCommit = environment[DEPLOY_VERSION_COMMIT_ENV]?.trim() ?? "";
  if (isFullGitSha(rawCommit)) {
    return {
      commit: rawCommit.toLowerCase(),
      version,
      commitSource: "env",
      versionSource,
    };
  }

  // Local Git HEAD is trusted ONLY in local development. In every other runtime
  // (notably the deployed production runtime) the identity MUST come from the
  // injected env above; otherwise it is explicitly unknown. `git rev-parse HEAD`
  // is never treated as proof of the deployed/published commit.
  if (environment.NODE_ENV !== "development") {
    return { commit: null, version, commitSource: "unknown", versionSource };
  }

  const readGitCommit = deps.readGitCommit ?? defaultReadGitCommit;
  try {
    const gitCommit = await readGitCommit(deps.cwd ?? process.cwd());
    if (typeof gitCommit === "string" && isFullGitSha(gitCommit)) {
      return {
        commit: gitCommit.toLowerCase(),
        version,
        commitSource: "git",
        versionSource,
      };
    }
  } catch {
    // Fall through to the explicit "unknown" result below.
  }

  return { commit: null, version, commitSource: "unknown", versionSource };
}
