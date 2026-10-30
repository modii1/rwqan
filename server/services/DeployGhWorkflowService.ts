import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * RWQAN DEPLOY — TEST publish delegation to GitHub Actions (workflow_dispatch).
 *
 * When the admin publishes with environment=TEST, the app does NOT run the
 * Firebase CLI itself. Instead it asks GitHub to run the TEST deploy workflow,
 * which creates the rollout from the branch's remote tip on
 * `modii1/rwqan @ test/unified-gateway-ui-only` — so GitHub (not this app)
 * performs the deploy and the commit history/current files are untouched.
 *
 * Hard properties:
 *  - NO git push is ever run from this app: pushing needs Git credentials that
 *    must already exist; this service only performs a READ-ONLY
 *    `git ls-remote` (plus a read-only GitHub API branch query fallback) to
 *    confirm the approved commit IS the remote branch tip.
 *  - The only credential used is a token that ALREADY exists in the server
 *    environment (`DEPLOY_GITHUB_TOKEN` from app config, not Git remotes).
 *    Nothing is created, prompted for, or auto-generated. If it is missing the
 *    outcome fails closed with a clear admin-facing reason.
 *  - Loses no commits: if the remote tip does not exactly equal the approved
 *    commit, the request is refused (the workflow checks out and deploys the
 *    branch tip, so a mismatch would deploy a different commit than approved).
 *  - Secrets are never echoed: the token is only sent inside the Authorization
 *    header; GitHub response bodies are never forwarded; any accidental
 *    inclusion is redacted before a reason leaves the server.
 *  - A 202/204-style "accepted" dispatch is NOT proof of a deployment: GitHub
 *    owns the rollout; status is tracked in GitHub Actions.
 */

const execFileAsync = promisify(execFile);

/** The fixed TEST push/deploy destination (may be overridden via env — see below). */
export const DEPLOY_GH_TEST_REPOSITORY = "modii1/rwqan";
export const DEPLOY_GH_TEST_BRANCH = "test/unified-gateway-ui-only";
export const DEPLOY_GH_TEST_WORKFLOW_FILE = "deploy-test.yml";
/** Git remote name that must point at the TEST repository (read-only queries). */
export const DEPLOY_GH_TEST_REMOTE_NAME = "mine";

export const DEPLOY_GH_TEST_REPOSITORY_ENV_KEY = "DEPLOY_GITHUB_TEST_REPOSITORY";
export const DEPLOY_GH_TEST_BRANCH_ENV_KEY = "DEPLOY_GITHUB_TEST_BRANCH";
export const DEPLOY_GH_TEST_WORKFLOW_ENV_KEY = "DEPLOY_GITHUB_TEST_WORKFLOW_FILE";
export const DEPLOY_GH_TEST_REMOTE_ENV_KEY = "DEPLOY_GITHUB_TEST_REMOTE";
export const DEPLOY_GH_TOKEN_ENV_KEY = "DEPLOY_GITHUB_TOKEN";

const GH_API_BASE = "https://api.github.com";
const GH_API_VERSION = "2022-11-28";
const GH_SANE_BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_\-./]{0,250}$/;
const GH_SANE_REPOSITORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/;
const GH_SANE_WORKFLOW_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.ya?ml$/;
const GH_SANE_REMOTE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/;
const LS_REMOTE_TIMEOUT_MS = 15_000;
const DISPATCH_TIMEOUT_MS = 15_000;
const API_READ_TIMEOUT_MS = 15_000;

/** Input of the workflow dispatch delegation. */
export interface GhWorkflowDispatchRequest {
  /** Approved full commit SHA (pre-validated by the executor). */
  commit: string;
  /** Server working directory for the read-only `git ls-remote` probe. */
  cwd: string;
}

/**
 * Accepted-dispatch descriptor embedded in `DeployPublishOutcome.ghDispatch`.
 * It marks a REQUEST sent to GitHub — never a completed deploy.
 */
export interface GhDispatchAccepted {
  accepted: boolean;
  /** The branch GitHub will deploy (workflow checkout ref). */
  ref: string;
  /** Non-secret URL where the admin can watch the run. */
  actionsUrl: string;
}

/**
 * Result of the delegation. Never contains secrets; `reason` is a
 * human-readable, non-secret explanation in Arabic for the admin/audit log.
 */
export type GhWorkflowDispatchResult =
  | {
      /** GitHub accepted the request. NOT proof of a completed deploy. */
      kind: "accepted";
      detail: string;
      branch: string;
      actionsUrl: string;
    }
  | {
      /** Fail-closed refusal before any API call (missing token/config, tip mismatch). */
      kind: "blocked";
      stage: "auth" | "source" | "target";
      reason: string;
    }
  | {
      /** GitHub API refused the request after being issued. */
      kind: "failed";
      reason: string;
    };

/** Delegation injectable via `RealDeployDependencies` (test seam). */
export type GhWorkflowDispatcher = (
  request: GhWorkflowDispatchRequest,
) => Promise<GhWorkflowDispatchResult>;

interface ResolvedGhTestConfig {
  repository: string;
  branch: string;
  workflowFile: string;
  remoteName: string;
}

function resolveGhTestConfig(
  environment: Record<string, string | undefined> = process.env,
): ResolvedGhTestConfig | { invalid: string } {
  const repository = environment[DEPLOY_GH_TEST_REPOSITORY_ENV_KEY]?.trim() ?? DEPLOY_GH_TEST_REPOSITORY;
  const branch = environment[DEPLOY_GH_TEST_BRANCH_ENV_KEY]?.trim() ?? DEPLOY_GH_TEST_BRANCH;
  const workflowFile = environment[DEPLOY_GH_TEST_WORKFLOW_ENV_KEY]?.trim() ?? DEPLOY_GH_TEST_WORKFLOW_FILE;
  const remoteName = environment[DEPLOY_GH_TEST_REMOTE_ENV_KEY]?.trim() ?? DEPLOY_GH_TEST_REMOTE_NAME;

  if (!GH_SANE_REPOSITORY_PATTERN.test(repository)) {
    return { invalid: `${DEPLOY_GH_TEST_REPOSITORY_ENV_KEY}` };
  }
  if (!GH_SANE_BRANCH_PATTERN.test(branch) || branch.includes("..")) {
    return { invalid: `${DEPLOY_GH_TEST_BRANCH_ENV_KEY}` };
  }
  if (!GH_SANE_WORKFLOW_PATTERN.test(workflowFile)) {
    return { invalid: `${DEPLOY_GH_TEST_WORKFLOW_ENV_KEY}` };
  }
  if (!GH_SANE_REMOTE_PATTERN.test(remoteName)) {
    return { invalid: `${DEPLOY_GH_TEST_REMOTE_ENV_KEY}` };
  }
  return { repository, branch, workflowFile, remoteName };
}

/**
 * READ-ONLY remote branch tip query: `git ls-remote --heads <remote> <ref>`.
 * No fetch/pull/push, no new credentials, prompts disabled so a private or
 * misconfigured remote fails fast instead of hanging. Any failure degrades to
 * a null tip with a generic reason (git stderr is never echoed back because it
 * can embed remote URLs).
 */
export async function readRemoteBranchHead(input: {
  cwd: string;
  remoteName: string;
  branch: string;
}): Promise<{ tip: string | null; reason?: string }> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-remote", "--heads", input.remoteName, `refs/heads/${input.branch}`],
      {
        cwd: input.cwd,
        timeout: LS_REMOTE_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      },
    );
    const lines = (stdout ?? "").split("\n").filter((line) => line.trim().length > 0);
    const sha = lines[0]?.split(/\s+/)[0]?.trim() ?? "";
    if (!/^[0-9a-f]{40}$/i.test(sha)) {
      return {
        tip: null,
        reason: `الفرع ${input.branch} غير موجود على GitHub (استعلام ls-remote قراءة فقط لم يُعِد SHA).`,
      };
    }
    return { tip: sha.toLowerCase() };
  } catch {
    return {
      tip: null,
      reason: `تعذّر القراءة القراءة-فقط tip الفرع على GitHub (الremote باسم ${input.remoteName}) — لا يوجد تفريغ لأدوات Git الجديدة.`,
    };
  }
}

/**
 * READ-ONLY remote branch tip query via the GitHub REST API
 * (`GET /repos/{repo}/branches/{branch}`), using the SAME pre-existing token.
 * No write call ever: this only reads the current SHA. Used as a fallback when
 * the local `git ls-remote` cannot run (e.g. a deployed container without a
 * `.git` directory or without the `mine` remote). The response body is never
 * echoed; only the 40-hex commit SHA is extracted.
 */
async function readRemoteTipViaApi(
  input: { repository: string; branch: string; token: string },
  fetchImpl: typeof fetch,
): Promise<{ tip: string | null; status: number | null }> {
  const url = `${GH_API_BASE}/repos/${input.repository}/branches/${encodeURIComponent(input.branch)}`;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GH_API_VERSION,
        "User-Agent": "rwqan-deploy-bar",
      },
      signal: AbortSignal.timeout(API_READ_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      return { tip: null, status: response.status };
    }
    const body = (await response.json()) as { commit?: { sha?: unknown } };
    const sha =
      typeof body?.commit?.sha === "string" ? body.commit.sha.trim().toLowerCase() : "";
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      return { tip: null, status: null };
    }
    return { tip: sha, status: 200 };
  } catch {
    return { tip: null, status: null };
  }
}

/**
 * Redact the configured token from any text, defensively, before it leaves the
 * server; also cap length. Reasons are constant strings today, but this keeps
 * that property enforced instead of merely assumed.
 */
function sanitizeReason(reason: string, token?: string): string {
  let text = reason;
  if (token) {
    // Escape only what matters (the token itself) by splitting, not regex.
    text = text.split(token).join("[SANITIZED]");
  }
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

/**
 * Fire the TEST deploy workflow via `workflow_dispatch` using ONLY an
 * already-existing server token (`DEPLOY_GITHUB_TOKEN`). Fails closed with a
 * clear admin-facing reason when that credential does not exist.
 */
export async function dispatchTestDeployWorkflow(
  request: GhWorkflowDispatchRequest,
  environment: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
  readTipImpl: typeof readRemoteBranchHead = readRemoteBranchHead,
): Promise<GhWorkflowDispatchResult> {
  const config = resolveGhTestConfig(environment);
  if ("invalid" in config) {
    return {
      kind: "blocked",
      stage: "target",
      reason: `إعداد GitHub المطلوب غير متوفر: قيمة ${config.invalid} غير صالحة. التصحيح يتطلب تعديل إعدادات البيئة يدويًا.`,
    };
  }

  const token = environment[DEPLOY_GH_TOKEN_ENV_KEY]?.trim() ?? "";
  if (!token) {
    return {
      kind: "blocked",
      stage: "auth",
      reason:
        "إعداد GitHub المطلوب غير متوفر: لا يوجد رمز وصول GitHub (" +
        DEPLOY_GH_TOKEN_ENV_KEY +
        ") في إعدادات الخادم لاستدعاء GitHub API. لا يُنشئ التطبيق أي رمز تلقائيًا — يجب أن يوفّره المشرف بصلاحية actions:write على " +
        config.repository +
        ".",
    };
  }

  // Identity gate: the workflow deploys the REMOTE branch tip, so it must be
  // EXACTLY the approved commit — otherwise GitHub would deploy something the
  // admin never approved. Read-only check (git ls-remote, with a read-only
  // GitHub API fallback for servers without a git remote), no push, preserves
  // commit history.
  const tip = await readTipImpl({
    cwd: request.cwd,
    remoteName: config.remoteName,
    branch: config.branch,
  });
  let remoteTip = tip.tip;
  if (!remoteTip) {
    // ls-remote could not run (no local git remote / private / no .git on the
    // deployed container). Fall back to a READ-ONLY GitHub API branch query
    // with the same pre-existing token — still no push, no new credentials.
    const apiTip = await readRemoteTipViaApi(
      { repository: config.repository, branch: config.branch, token },
      fetchImpl,
    );
    if (!apiTip.tip) {
      const branchUnavailable =
        apiTip.status === 404
          ? `الفرع ${config.branch} غير موجود على ${config.repository} — لا تنفيذ أمر push من التطبيق؛ يجب أن يرفعه المشرف بنفسه أولًا.`
          : apiTip.status === 401 || apiTip.status === 403
            ? `رمز DEPLOY_GITHUB_TOKEN لا يملك صلاحية قراءة الفرع ${config.branch} على ${config.repository} (رُفض الاستعلام القراءة-فقط). لا تنفيذ أمر push من التطبيق.`
            : "تعذّر الوصول إلى GitHub API (شبكة/انتهاء مهلة) — لا تنفيذ أمر push من التطبيق؛ يجب أن يرفعه المشرف بنفسه أولًا.";
      return {
        kind: "blocked",
        stage: "source",
        reason: `${branchUnavailable} (تعذّر أيضًا استعلام القراءة-فقط عبر git: ${tip.reason ?? "بلا تفسير"}).`,
      };
    }
    remoteTip = apiTip.tip;
  }
  if (remoteTip !== request.commit.toLowerCase()) {
    return {
      kind: "blocked",
      stage: "source",
      reason:
        `tip الفرع ${config.branch} على ${config.repository} لا يطابق الـcommit المعتمد ` +
        `(${remoteTip.slice(0, 7)} ≠ ${request.commit.slice(0, 7)}) — رُفض الطلب حفاظًا عليه من نشر commit غير معتمد.`,
    };
  }

  const actionsUrl = `https://github.com/${config.repository}/actions/workflows/${config.workflowFile}`;
  const url = `${GH_API_BASE}/repos/${config.repository}/actions/workflows/${config.workflowFile}/dispatches`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": GH_API_VERSION,
        "User-Agent": "rwqan-deploy-bar",
      },
      body: JSON.stringify({ ref: config.branch }),
      signal: AbortSignal.timeout(DISPATCH_TIMEOUT_MS),
    });
  } catch {
    return {
      kind: "failed",
      reason: sanitizeReason("تعذّر الوصول إلى GitHub API (شبكة/انتهاء مهلة) — لم يُرسل الطلب.", token),
    };
  }

  if (response.status === 204) {
    return {
      kind: "accepted",
      detail: sanitizeReason(
        `أُرسل طلب النشر إلى GitHub (workflow_dispatch على ${config.workflowFile} للفرع ${config.branch}).` +
          " سيُنشأ الـRollout من الفرع البعيد ويُدار من GitHub Actions — هذا الطلب لا يثبت نجاح النشر نفسه.",
        token,
      ),
      branch: config.branch,
      actionsUrl,
    };
  }

  // Never echo the response body; map known statuses to safe reasons, then
  // apply the defensive token redaction before returning anything.
  const reasonByStatus: Record<number, string> = {
    401: "رفض GitHub الطلب (401): رمز DEPLOY_GITHUB_TOKEN غير صالح أو منتهي.",
    403:
      `رفض GitHub الطلب (403): الرمز لا يملك صلاحية actions:write على ${config.repository}` +
      " (أو قيد فرعي على السياسة/النطاق). إعداد GitHub المطلوب غير متوفر.",
    404:
      `رفض GitHub الطلب (404): ملف workflow أو الفرع ${config.branch} غير موجودين على ${config.repository}` +
      " — لا يُنشئ التطبيق أي شيء تلقائيًا.",
    422:
      `رفض GitHub الطلب (422): الفرع ${config.branch} غير مُفعّل للتشغيل اليدوي أو مصادر الطلب غير صالحة.`,
    429: "رفض GitHub الطلب (429): تجاوز نطاق المعدل — حاول لاحقًا.",
  };
  const failedReason =
    reasonByStatus[response.status] ??
    `استجابة غير متوقعة من GitHub API (رمز ${response.status}).`;
  return { kind: "failed", reason: sanitizeReason(failedReason, token) };
}
