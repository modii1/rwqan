import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * RWQAN DEPLOY — unified GitHub authentication for workflow dispatch.
 *
 * Resolution order:
 *   1. `DEPLOY_GITHUB_TOKEN` if the server already provides it.
 *   2. The existing, already-authenticated GitHub CLI session (`gh auth token`)
 *      on non-production runtimes. This reuses the trusted connection the
 *      operator already uses for Git/GitHub Actions instead of demanding a
 *      second, separate token.
 *
 * The token is never written to disk, never logged, and never returned in any
 * API response. Read-only resolution; no token is ever created.
 */

export const DEPLOY_GITHUB_TOKEN_ENV_KEY = "DEPLOY_GITHUB_TOKEN";

const GH_TIMEOUT_MS = 8_000;
const TOKEN_SHAPE = /^[A-Za-z0-9_\-]{20,}$/;
const execFileAsync = promisify(execFile);

export type GithubTokenSource = "env" | "gh_cli" | "none";

export interface GithubTokenResolution {
  token: string | null;
  source: GithubTokenSource;
  /** Admin-facing reason when no token is available (never a secret). */
  reason: string | null;
}

export interface ResolveGithubTokenOptions {
  /**
   * Allow reading the existing `gh` session. Production stays explicit-env only.
   * Defaults to false so tests and library callers never touch the host keyring.
   */
  allowGhCli?: boolean;
  /** Test seam: return the `gh auth token` output. */
  runGh?: () => Promise<string>;
}

async function readGhAuthToken(): Promise<string> {
  const { stdout } = await execFileAsync(
    "gh",
    ["auth", "token", "--hostname", "github.com"],
    {
      timeout: GH_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  return stdout;
}

/**
 * Resolve a GitHub token without ever creating or persisting one.
 * Fails closed with a clear reason when neither source is available.
 */
export async function resolveDeployGithubToken(
  environment: Record<string, string | undefined> = process.env,
  options: ResolveGithubTokenOptions = {},
): Promise<GithubTokenResolution> {
  const explicit = environment[DEPLOY_GITHUB_TOKEN_ENV_KEY]?.trim() ?? "";
  if (explicit) {
    return { token: explicit, source: "env", reason: null };
  }

  const runtime = environment.NODE_ENV;
  const ghAllowed = options.allowGhCli === true && runtime === "development";

  if (!ghAllowed) {
    return {
      token: null,
      source: "none",
      reason:
        "لا يوجد DEPLOY_GITHUB_TOKEN في إعدادات الخادم، ولم يُسمح باستخدام جلسة gh في هذه البيئة. " +
        "وفّر الرمز في إعدادات الخادم أو شغّل الخادم في بيئة تطوير مع جلسة gh مصادَقة.",
    };
  }

  try {
    const token = (await (options.runGh ?? readGhAuthToken)()).trim();
    if (TOKEN_SHAPE.test(token)) {
      return { token, source: "gh_cli", reason: null };
    }
    return {
      token: null,
      source: "none",
      reason:
        "جلسة gh موجودة لكنها لم تُرجع رمزًا صالحًا. نفّذ gh auth login أو وفّر DEPLOY_GITHUB_TOKEN.",
    };
  } catch {
    return {
      token: null,
      source: "none",
      reason:
        "لا يوجد DEPLOY_GITHUB_TOKEN، ولا توجد جلسة gh مصادَقة صالحة على الخادم. " +
        "نفّذ gh auth login (بصلاحية actions:write على modii1/rwqan) أو وفّر الرمز في إعدادات الخادم.",
    };
  }
}
