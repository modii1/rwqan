/**
 * RWQAN DEPLOY — stable-release RESOLUTION (read-only).
 *
 * Turns the config record in `../config/stableRelease` into a live release ONLY
 * after positively verifying, against the LOCAL Git repository and WITHOUT any
 * network access, that:
 *   1. the recorded value is a full 40-hex commit SHA, and
 *   2. the commit object exists in the object database (`git cat-file -e`), and
 *   3. the commit is reachable from a local ref (`git branch -a --contains`) or
 *      is an ancestor of HEAD (`git merge-base --is-ancestor`).
 *
 * Nothing is written, committed, pushed, fetched, or deployed. When any check
 * cannot be proven, the release is NOT returned (fail closed) so the UI never
 * presents an unverified revision as the stable release.
 *
 * The Git runner is injectable so the service is fully testable without Git.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isFullGitSha, type DeployRelease } from "../../shared/deploySystem";
import { RWQAN_STABLE_RELEASE } from "../config/stableRelease";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 8 * 1024 * 1024;

/** Result of one read-only Git invocation. */
export interface GitRunResult {
  ok: boolean;
  stdout: string;
}

export interface StableReleaseDependencies {
  /** Run a read-only `git` command in `cwd`; never throws. */
  runGit(args: string[], cwd: string): Promise<GitRunResult>;
}

const DEFAULT_DEPENDENCIES: StableReleaseDependencies = {
  async runGit(args, cwd) {
    try {
      const { stdout } = await execFileAsync("git", args, {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: MAX_BUFFER,
      });
      return { ok: true, stdout };
    } catch {
      return { ok: false, stdout: "" };
    }
  },
};

/**
 * TRUE only when `sha` is a full commit SHA that exists AND is reachable in the
 * local repository at `cwd`. Purely read-only; never touches the network.
 */
export async function verifyCommitAccessible(
  sha: string,
  cwd: string,
  dependencies: StableReleaseDependencies = DEFAULT_DEPENDENCIES,
): Promise<boolean> {
  if (!isFullGitSha(sha)) return false;

  const exists = await dependencies.runGit(["cat-file", "-e", `${sha}^{commit}`], cwd);
  if (!exists.ok) return false;

  const contains = await dependencies.runGit(["branch", "-a", "--contains", sha], cwd);
  if (contains.ok && contains.stdout.trim().length > 0) return true;

  const ancestor = await dependencies.runGit(
    ["merge-base", "--is-ancestor", sha, "HEAD"],
    cwd,
  );
  return ancestor.ok;
}

/**
 * Resolve the stable release for display/restore. Returns a fresh copy of the
 * config record when the commit is verified accessible in `cwd`; otherwise null.
 */
export async function resolveStableRelease(options: {
  cwd: string;
  dependencies?: StableReleaseDependencies;
  config?: DeployRelease;
}): Promise<DeployRelease | null> {
  const config = options.config ?? RWQAN_STABLE_RELEASE;
  const verified = await verifyCommitAccessible(
    config.gitCommit,
    options.cwd,
    options.dependencies ?? DEFAULT_DEPENDENCIES,
  );
  return verified ? { ...config } : null;
}
