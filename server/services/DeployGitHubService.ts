import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DeployGitHubInfo, DeployGitHubMatch } from "../../shared/deploySystem";
import { sanitizeGitRemote } from "./DeployChecksService";

/**
 * RWQAN DEPLOY — read-only GitHub status (Phase C extension).
 *
 * Compares the local HEAD with the GitHub remote tip WITHOUT ever writing:
 * no token is created, no fetch/pull/push is run, and the GitHub REST API is not
 * used. The remote SHA is read from a pre-existing local remote-tracking ref
 * (`refs/remotes/origin/<branch>`), which reflects the remote as of the last
 * local fetch. Only when explicitly enabled (`allowLsRemote`, wired to
 * `DEPLOY_GITHUB_LS_REMOTE=enabled`) may it fall back to a live-but-read-only
 * `git ls-remote` query. Everything else fails to `unavailable` with a safe
 * reason. No secret is ever returned or logged.
 */

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 8_000;
const LS_REMOTE_TIMEOUT_MS = 15_000;

export interface DeployGitHubDependencies {
  /** Read-only local git command (no network). */
  run(args: string[], cwd: string): Promise<string>;
  /** Read-only network query: `git ls-remote` (no fetch/push). */
  lsRemote(args: string[], cwd: string): Promise<string>;
}

export interface ReadDeployGitHubInput {
  cwd: string;
  localSha: string | null;
  branch: string | null;
  /** Opt-in live `git ls-remote` fallback (default: false). */
  allowLsRemote?: boolean;
  dependencies?: DeployGitHubDependencies;
}

const DEFAULT_DEPENDENCIES: DeployGitHubDependencies = {
  run: (args, cwd) => runGit(args, cwd, GIT_TIMEOUT_MS),
  lsRemote: (args, cwd) => runGit(args, cwd, LS_REMOTE_TIMEOUT_MS),
};

/** TRUE only when the operator explicitly enables the live read-only query. */
export function githubLsRemoteEnabled(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return environment.DEPLOY_GITHUB_LS_REMOTE === "enabled";
}

function build(
  readAt: string,
  input: {
    remoteUrl: string | null;
    remoteSha: string | null;
    localSha: string | null;
    source: DeployGitHubInfo["source"];
    reason?: string;
  },
): DeployGitHubInfo {
  const match: DeployGitHubMatch =
    input.localSha && input.remoteSha
      ? input.localSha === input.remoteSha
        ? "match"
        : "mismatch"
      : "unavailable";
  return {
    available: Boolean(input.remoteSha),
    remoteUrl: input.remoteUrl,
    remoteSha: input.remoteSha,
    match,
    source: input.source,
    readAt,
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

/**
 * Read the GitHub comparison. Never throws: any failure degrades to
 * `unavailable` so callers fail closed instead of assuming a match.
 */
export async function readDeployGitHubInfo(
  input: ReadDeployGitHubInput,
): Promise<DeployGitHubInfo> {
  const readAt = new Date().toISOString();
  const deps = input.dependencies ?? DEFAULT_DEPENDENCIES;

  let remoteUrl: string | null = null;
  try {
    const raw = await deps.run(["config", "--get", "remote.origin.url"], input.cwd);
    if (raw) remoteUrl = sanitizeGitRemote(raw);
  } catch {
    remoteUrl = null;
  }
  if (!remoteUrl) {
    return build(readAt, {
      remoteUrl: null,
      remoteSha: null,
      localSha: input.localSha,
      source: "none",
      reason: "لا يوجد remote باسم origin قابل للقراءة.",
    });
  }

  const headsRef = input.branch ? `refs/heads/${input.branch}` : "HEAD";
  const trackingRef = input.branch
    ? `refs/remotes/origin/${input.branch}`
    : "refs/remotes/origin/HEAD";

  // 1) Pre-existing local remote-tracking ref (no network).
  try {
    const sha = await deps.run(["rev-parse", trackingRef], input.cwd);
    if (sha) {
      return build(readAt, {
        remoteUrl,
        remoteSha: sha,
        localSha: input.localSha,
        source: "local_ref",
        reason:
          "SHA البعيد مأخوذ من مرجع التتبّع المحلي (كما عند آخر fetch محلي) — قد لا يكون لحظيًا.",
      });
    }
  } catch {
    // ignore
  }

  // 2) Opt-in live read-only query (never fetch/push).
  if (input.allowLsRemote) {
    try {
      const output = await deps.lsRemote(["ls-remote", "origin", headsRef], input.cwd);
      const sha = output.split("\n")[0]?.split(/\s+/)[0]?.trim() ?? "";
      if (sha) {
        return build(readAt, {
          remoteUrl,
          remoteSha: sha,
          localSha: input.localSha,
          source: "ls_remote",
        });
      }
    } catch {
      // fall through
    }
  }

  return build(readAt, {
    remoteUrl,
    remoteSha: null,
    localSha: input.localSha,
    source: "none",
    reason: input.allowLsRemote
      ? "تعذّرت قراءة SHA البعيد (لا مرجع تتبّع محلي، وفشل ls-remote)."
      : "لا يتوفّر مرجع تتبّع محلي للفرع؛ فُعِّل ls-remote اختياريًا فقط عند الحاجة.",
  });
}

async function runGit(
  args: string[],
  cwd: string,
  timeout: number,
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}
