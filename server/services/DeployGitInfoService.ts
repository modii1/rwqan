import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DeployGitInfo, DeployWorktreeState } from "../../shared/deploySystem";

/**
 * RWQAN DEPLOY — read-only local Git identity (Phase C extension).
 *
 * Reads (never writes) the local checkout identity: full/short HEAD SHA, current
 * branch, and whether the working tree is clean or dirty. Every command is a
 * read-only `git` invocation (`rev-parse`, `status --porcelain`): there is no
 * commit, push, fetch, checkout, or any other worktree mutation.
 *
 * The recorded SHA is the local HEAD. It is deliberately NOT treated as proof
 * that the working tree matches the commit: `worktree` reports `dirty` whenever
 * there are changes, so a caller can never present HEAD as "exactly what runs".
 * When Git cannot be read the result is `available: false` with a safe reason
 * (never a secret, never a thrown error).
 */

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 8_000;

export interface DeployGitInfoDependencies {
  /** Run a single read-only git command and return trimmed stdout. */
  run(args: string[], cwd: string): Promise<string>;
}

const DEFAULT_DEPENDENCIES: DeployGitInfoDependencies = {
  run: (args, cwd) => runGitReadOnly(args, cwd),
};

function unavailable(readAt: string, reason: string): DeployGitInfo {
  return {
    available: false,
    commitSha: null,
    shortSha: null,
    branch: null,
    worktree: "unknown",
    readAt,
    reason,
  };
}

/**
 * Read the local Git identity. Never throws: any failure becomes an
 * `available: false` result so the caller fails closed instead of guessing.
 */
export async function readDeployGitInfo(
  cwd: string,
  dependencies: DeployGitInfoDependencies = DEFAULT_DEPENDENCIES,
): Promise<DeployGitInfo> {
  const readAt = new Date().toISOString();
  let commitSha: string;
  try {
    commitSha = await dependencies.run(["rev-parse", "HEAD"], cwd);
  } catch {
    return unavailable(readAt, "تعذّرت قراءة مستودع Git المحلي (لن يُخمَّن الإصدار).");
  }
  if (!commitSha) {
    return unavailable(readAt, "لا يوجد commit في المستودع المحلي (HEAD غير معرّف).");
  }

  const shortSha = await dependencies
    .run(["rev-parse", "--short", "HEAD"], cwd)
    .catch(() => "");
  const rawBranch = await dependencies
    .run(["rev-parse", "--abbrev-ref", "HEAD"], cwd)
    .catch(() => "");
  const branch = rawBranch && rawBranch !== "HEAD" ? rawBranch : null;

  let worktree: DeployWorktreeState = "unknown";
  try {
    const status = await dependencies.run(
      ["status", "--porcelain", "--untracked-files=normal"],
      cwd,
    );
    worktree = status.trim().length > 0 ? "dirty" : "clean";
  } catch {
    worktree = "unknown";
  }

  return {
    available: true,
    commitSha,
    shortSha: shortSha || commitSha.slice(0, 7),
    branch,
    worktree,
    readAt,
    ...(worktree === "dirty"
      ? { reason: "شجرة العمل تحتوي تغييرات؛ SHA المسجَّل لا يمثّل بالضرورة محتوى شجرة العمل." }
      : {}),
  };
}

async function runGitReadOnly(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}
