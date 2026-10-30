import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * RWQAN DEPLOY — TEST & LIVE publish delegation to GitHub Actions (dispatch).
 *
 * When the admin publishes with environment=TEST or environment=LIVE, the app
 * does NOT run the Firebase CLI itself. Instead it asks GitHub to run that
 * environment's deploy workflow, which creates the rollout from the branch's
 * remote tip:
 *   - TEST → `modii1/rwqan @ test/unified-gateway-ui-only` (deploy-test.yml)
 *   - LIVE → `modii1/rwqan @ main`                        (deploy-live.yml)
 * so GitHub (not this app) performs the deploy and the commit history/current
 * files are untouched.
 *
 * Hard properties:
 *  - NO git push is ever run from this app: pushing needs Git credentials that
 *    must already exist; this service only performs a READ-ONLY
 *    `git ls-remote` (plus a read-only GitHub API branch query fallback) to
 *    confirm the branch exists and (for TEST) that the approved commit IS the
 *    remote branch tip.
 *  - The only credential used is a token that ALREADY exists in the server
 *    environment (`DEPLOY_GITHUB_TOKEN` from app config, not Git remotes).
 *    Nothing is created, prompted for, or auto-generated. If it is missing the
 *    outcome fails closed with a clear admin-facing reason.
 *  - TEST keeps the exact-commit gate: the remote tip must equal the approved
 *    commit, because the deploy is created from the branch tip and a mismatch
 *    would deploy a commit the admin never approved. LIVE per requirement
 *    publishes the LAST version already on `main` — the pre-read tip IS the
 *    recorded source (no local-tree comparison; the panel never pushes).
 *  - Duplicate-rollout prevention: before any dispatch, the latest run of the
 *    environment's workflow on that branch is READ; if one is still queued or
 *    in progress, the request is refused with a plain-Arabic reason instead of
 *    creating a second concurrent rollout. If the status can not be read the
 *    guard is skipped (dispatch still requires the write token).
 *  - Secrets are never echoed: the token is only sent inside the Authorization
 *    header; GitHub response bodies are never forwarded; any accidental
 *    inclusion is redacted before a reason leaves the server.
 *  - A 202/204-style "accepted" dispatch is NOT proof of a deployment: GitHub
 *    owns the rollout; status is tracked in GitHub Actions (see
 *    `readDeployWorkflowRunStatus`).
 */

const execFileAsync = promisify(execFile);

const GH_API_BASE = "https://api.github.com";
const GH_API_VERSION = "2022-11-28";
const GH_SANE_BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_\-./]{0,250}$/;
const GH_SANE_REPOSITORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/;
const GH_SANE_WORKFLOW_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.ya?ml$/;
const GH_SANE_REMOTE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/;
const LS_REMOTE_TIMEOUT_MS = 15_000;
const DISPATCH_TIMEOUT_MS = 15_000;
const API_READ_TIMEOUT_MS = 15_000;

/** Input of the TEST workflow dispatch delegation. */
export interface GhWorkflowDispatchRequest {
  /** Approved full commit SHA (pre-validated by the executor). */
  commit: string;
  /** Server working directory for the read-only `git ls-remote` probe. */
  cwd: string;
}

/** Input of the LIVE workflow dispatch delegation. */
export interface GhLiveWorkflowDispatchRequest {
  /**
   * Server working directory for the read-only `git ls-remote` probe. No local
   * commit is compared for LIVE: the panel publishes the LAST version already
   * on `main` (never a commit or push of its own).
   */
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
  /**
   * The full remote-tip SHA the workflow will build (the exact source read
   * read-only BEFORE dispatch). Recorded so the panel never reports the local
   * HEAD as the deployed revision.
   */
  commit: string;
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
      /** Full remote-tip SHA GitHub will build. */
      commit: string;
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

/** Delegation injectable via `RealDeployDependencies` (test seam) for LIVE. */
export type GhLiveWorkflowDispatcher = (
  request: GhLiveWorkflowDispatchRequest,
) => Promise<GhWorkflowDispatchResult>;

/** The fixed TEST push/deploy destination (may be overridden via env). */
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

/**
 * The fixed LIVE deploy destination — the environment's OWN branch and its own
 * workflow file. The panel NEVER dispatches the TEST workflow for LIVE or the
 * other way around, so the two environments cannot cross.
 */
export const DEPLOY_GH_LIVE_REPOSITORY = "modii1/rwqan";
export const DEPLOY_GH_LIVE_BRANCH = "main";
export const DEPLOY_GH_LIVE_WORKFLOW_FILE = "deploy-live.yml";
export const DEPLOY_GH_LIVE_REMOTE_NAME = "mine";

export const DEPLOY_GH_LIVE_REPOSITORY_ENV_KEY = "DEPLOY_GITHUB_LIVE_REPOSITORY";
export const DEPLOY_GH_LIVE_BRANCH_ENV_KEY = "DEPLOY_GITHUB_LIVE_BRANCH";
export const DEPLOY_GH_LIVE_WORKFLOW_ENV_KEY = "DEPLOY_GITHUB_LIVE_WORKFLOW_FILE";
export const DEPLOY_GH_LIVE_REMOTE_ENV_KEY = "DEPLOY_GITHUB_LIVE_REMOTE";

interface ResolvedGhEnvConfig {
  repository: string;
  branch: string;
  workflowFile: string;
  remoteName: string;
}

export type DeployGhEnvironment = "TEST" | "LIVE";

function resolveGhConfig(
  environment: DeployGhEnvironment,
  env: Record<string, string | undefined>,
): ResolvedGhEnvConfig | { invalid: string } {
  const keys =
    environment === "TEST"
      ? {
          repository: DEPLOY_GH_TEST_REPOSITORY_ENV_KEY,
          branch: DEPLOY_GH_TEST_BRANCH_ENV_KEY,
          workflowFile: DEPLOY_GH_TEST_WORKFLOW_ENV_KEY,
          remoteName: DEPLOY_GH_TEST_REMOTE_ENV_KEY,
          fallbacks: {
            repository: DEPLOY_GH_TEST_REPOSITORY,
            branch: DEPLOY_GH_TEST_BRANCH,
            workflowFile: DEPLOY_GH_TEST_WORKFLOW_FILE,
            remoteName: DEPLOY_GH_TEST_REMOTE_NAME,
          },
        }
      : {
          repository: DEPLOY_GH_LIVE_REPOSITORY_ENV_KEY,
          branch: DEPLOY_GH_LIVE_BRANCH_ENV_KEY,
          workflowFile: DEPLOY_GH_LIVE_WORKFLOW_ENV_KEY,
          remoteName: DEPLOY_GH_LIVE_REMOTE_ENV_KEY,
          fallbacks: {
            repository: DEPLOY_GH_LIVE_REPOSITORY,
            branch: DEPLOY_GH_LIVE_BRANCH,
            workflowFile: DEPLOY_GH_LIVE_WORKFLOW_FILE,
            remoteName: DEPLOY_GH_LIVE_REMOTE_NAME,
          },
        };

  const repository = env[keys.repository]?.trim() ?? keys.fallbacks.repository;
  const branch = env[keys.branch]?.trim() ?? keys.fallbacks.branch;
  const workflowFile = env[keys.workflowFile]?.trim() ?? keys.fallbacks.workflowFile;
  const remoteName = env[keys.remoteName]?.trim() ?? keys.fallbacks.remoteName;

  if (!GH_SANE_REPOSITORY_PATTERN.test(repository)) {
    return { invalid: keys.repository };
  }
  if (!GH_SANE_BRANCH_PATTERN.test(branch) || branch.includes("..")) {
    return { invalid: keys.branch };
  }
  if (!GH_SANE_WORKFLOW_PATTERN.test(workflowFile)) {
    return { invalid: keys.workflowFile };
  }
  if (!GH_SANE_REMOTE_PATTERN.test(remoteName)) {
    return { invalid: keys.remoteName };
  }
  // HARD SEPARATION: TEST can never be pointed at the LIVE branch or the LIVE
  // workflow file, even through an environment override. Without this guard a
  // misconfigured DEPLOY_GITHUB_TEST_BRANCH=main would dispatch the TEST button
  // to production. LIVE keeps its own fixed branch/workflow (main/deploy-live).
  if (environment === "TEST") {
    if (/^(main|master)$/i.test(branch)) {
      return { invalid: keys.branch };
    }
    if (workflowFile === DEPLOY_GH_LIVE_WORKFLOW_FILE) {
      return { invalid: keys.workflowFile };
    }
  }
  return { repository, branch, workflowFile, remoteName };
}

function environmentLabel(environment: DeployGhEnvironment): string {
  return environment === "LIVE" ? "الموقع الرسمي" : "بيئة التجربة";
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

/** Conclusion of the workflow step that actually creates the rollout. */
export type DeployRolloutStepState = "success" | "failed" | "not_run" | "unknown";

interface LatestRunState {
  state: "running" | "success" | "failed" | "none" | "unknown";
  runUrl: string | null;
  headSha: string | null;
  runId: number | null;
}

/**
 * READ-ONLY state probe: the latest run of the environment's workflow on its
 * branch. Used (a) as a duplicate-rollout guard right before any dispatch and
 * (b) by the admin status endpoint to show the REAL deployment state. GitHub
 * response bodies are never echoed — only the run state/URL fields the UI
 * needs. When GitHub can not be read the state is reported as "unknown"
 * instead of guessing, and a duplicate guard caller skips that guard.
 */
async function fetchLatestRunState(
  environment: DeployGhEnvironment,
  config: ResolvedGhEnvConfig,
  token: string,
  fetchImpl: typeof fetch,
): Promise<LatestRunState> {
  const url =
    `${GH_API_BASE}/repos/${config.repository}/actions/workflows/${config.workflowFile}/runs` +
    `?branch=${encodeURIComponent(config.branch)}&per_page=1`;
  const fallbackState: LatestRunState = {
    state: "unknown",
    runUrl: `https://github.com/${config.repository}/actions/workflows/${config.workflowFile}`,
    headSha: null,
    runId: null,
  };
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GH_API_VERSION,
        "User-Agent": "rwqan-deploy-bar",
      },
      signal: AbortSignal.timeout(API_READ_TIMEOUT_MS),
    });
    if (response.status !== 200) {
      return fallbackState;
    }
    const body = (await response.json()) as {
      workflow_runs?: Array<{
        id?: unknown;
        status?: unknown;
        conclusion?: unknown;
        html_url?: unknown;
        head_sha?: unknown;
      }>;
    };
    const run = Array.isArray(body.workflow_runs) ? body.workflow_runs[0] : undefined;
    if (!run || typeof run !== "object") {
      return { state: "none", runUrl: fallbackState.runUrl, headSha: null, runId: null };
    }
    const status = typeof run.status === "string" ? run.status : "";
    const conclusion = typeof run.conclusion === "string" ? run.conclusion : null;
    const runUrl = typeof run.html_url === "string" ? run.html_url : fallbackState.runUrl;
    const headSha =
      typeof run.head_sha === "string" && /^[0-9a-f]{40}$/.test(run.head_sha.trim().toLowerCase())
        ? run.head_sha.trim().toLowerCase()
        : null;
    const runId =
      typeof run.id === "number" && Number.isSafeInteger(run.id) && run.id > 0
        ? run.id
        : null;
    if (status === "queued" || status === "in_progress" || status === "waiting") {
      return { state: "running", runUrl, headSha, runId };
    }
    if (status === "completed") {
      if (conclusion === "success") {
        return { state: "success", runUrl, headSha, runId };
      }
      if (conclusion === "failure" || conclusion === "timed_out" || conclusion === "cancelled") {
        return { state: "failed", runUrl, headSha, runId };
      }
    }
    return fallbackState;
  } catch {
    void environment;
    return fallbackState;
  }
}

/**
 * READ-ONLY verification that the run REALLY created a rollout. The overall run
 * conclusion is not enough: a workflow can be green while the rollout step was
 * skipped or renamed. This reads the run's jobs and requires the step whose name
 * contains "rollout" to have concluded `success`. Cached briefly per run so the
 * 20-second status poll does not hammer the API. Unknown stays uncached so a
 * transient failure is retried on the next poll.
 */
const ROLLOUT_STEP_CACHE_TTL_MS = 60_000;
const rolloutStepCache = new Map<string, { value: DeployRolloutStepState; readAtMs: number }>();

/** Test seam: forget cached rollout-step conclusions. */
export function resetDeployWorkflowStatusCache(): void {
  rolloutStepCache.clear();
}

async function fetchRolloutStepState(
  config: ResolvedGhEnvConfig,
  token: string,
  runId: number,
  fetchImpl: typeof fetch,
): Promise<DeployRolloutStepState> {
  const key = `${config.repository}:${config.workflowFile}:${runId}`;
  const cached = rolloutStepCache.get(key);
  if (cached && Date.now() - cached.readAtMs < ROLLOUT_STEP_CACHE_TTL_MS) {
    return cached.value;
  }
  let value: DeployRolloutStepState = "unknown";
  try {
    const response = await fetchImpl(
      `${GH_API_BASE}/repos/${config.repository}/actions/runs/${runId}/jobs?per_page=100`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": GH_API_VERSION,
          "User-Agent": "rwqan-deploy-bar",
        },
        signal: AbortSignal.timeout(API_READ_TIMEOUT_MS),
      },
    );
    if (response.status === 200) {
      const body = (await response.json()) as {
        jobs?: Array<{
          steps?: Array<{ name?: unknown; conclusion?: unknown }>;
        }>;
      };
      const steps = (Array.isArray(body.jobs) ? body.jobs : []).flatMap((job) =>
        Array.isArray(job?.steps) ? job.steps : [],
      );
      const rolloutStep = steps.find(
        (step) => typeof step?.name === "string" && /rollout/i.test(step.name),
      );
      if (!rolloutStep) {
        value = "not_run";
      } else if (rolloutStep.conclusion === "success") {
        value = "success";
      } else if (
        rolloutStep.conclusion === "failure" ||
        rolloutStep.conclusion === "cancelled" ||
        rolloutStep.conclusion === "timed_out"
      ) {
        value = "failed";
      } else if (rolloutStep.conclusion === "skipped") {
        value = "not_run";
      }
    }
  } catch {
    value = "unknown";
  }
  if (value !== "unknown") {
    rolloutStepCache.set(key, { value, readAtMs: Date.now() });
  }
  return value;
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
 * Shared tail of both dispatch flows: POST the dispatch and map the response
 * to safe, admin-facing Arabic outcomes. Never echoes the response body.
 */
async function postDispatch(
  config: ResolvedGhEnvConfig,
  token: string,
  dispatchDetail: string,
  commit: string,
  fetchImpl: typeof fetch,
): Promise<GhWorkflowDispatchResult> {
  const actionsUrl = `https://github.com/${config.repository}/actions/workflows/${config.workflowFile}`;
  const url = `${GH_API_BASE}/repos/${config.repository}/actions/workflows/${config.workflowFile}/dispatches`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": GH_API_VERSION,
        "Content-Type": "application/json",
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
      detail: sanitizeReason(dispatchDetail, token),
      branch: config.branch,
      actionsUrl,
      commit,
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
  const config = resolveGhConfig("TEST", environment);
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

  // Duplicate-rollout prevention: refuse when this environment's workflow is
  // already running on the same branch (read-only status probe). If GitHub can
  // not report the state the guard is skipped; the dispatch itself still
  // requires the write token, so nothing bypasses the credential gate.
  const testRunningNow = await fetchLatestRunState("TEST", config, token, fetchImpl);
  if (testRunningNow.state === "running") {
    return {
      kind: "blocked",
      stage: "target",
      reason: `يوجد تحديث قيد التنفيذ الآن على ${environmentLabel("TEST")} (فرع ${config.branch}) — انتظر اكتماله قبل طلب تحديث آخر.`,
    };
  }

  return postDispatch(
    config,
    token,
    `أُرسل طلب النشر إلى GitHub (workflow_dispatch على ${config.workflowFile} للفرع ${config.branch}).` +
      " سيُنشأ الـRollout من الفرع البعيد ويُدار من GitHub Actions — هذا الطلب لا يثبت نجاح النشر نفسه.",
    remoteTip,
    fetchImpl,
  );
}

/**
 * Fire the LIVE deploy workflow the same way, for the environment's OWN branch
 * (`main`) and its own workflow file (`deploy-live.yml`). The panel never
 * pushes or commits: the deployed source is the LAST version already on
 * `main` — the pre-read remote tip is recorded, never the local tree. Like
 * TEST it fails closed without the pre-existing token and refuses to run when
 * the same workflow is already running on the branch.
 */
export async function dispatchLiveDeployWorkflow(
  request: GhLiveWorkflowDispatchRequest,
  environment: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
  readTipImpl: typeof readRemoteBranchHead = readRemoteBranchHead,
): Promise<GhWorkflowDispatchResult> {
  const config = resolveGhConfig("LIVE", environment);
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

  // Read-only source probe: for LIVE the deployed source is the branch tip
  // itself. If the tip can not be read the deploy is refused — never guessed.
  const tip = await readTipImpl({
    cwd: request.cwd,
    remoteName: config.remoteName,
    branch: config.branch,
  });
  let remoteTip = tip.tip;
  if (!remoteTip) {
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
  // Duplicate-rollout prevention (same mechanism as TEST, per environment).
  const runningNow = await fetchLatestRunState("LIVE", config, token, fetchImpl);
  if (runningNow.state === "running") {
    return {
      kind: "blocked",
      stage: "target",
      reason: `يوجد تحديث قيد التنفيذ الآن على الموقع الرسمي (فرع ${config.branch}) — انتظر اكتماله قبل طلب تحديث آخر.`,
    };
  }

  return postDispatch(
    config,
    token,
    `أُرسل طلب تحديث الموقع الرسمي إلى GitHub (workflow_dispatch على ${config.workflowFile} للفرع ${config.branch}).` +
      " سيُنشأ الـRollout من آخر نسخة موجودة على الفرع البعيد ويُدار من GitHub Actions — هذا الطلب لا يثبت نجاح النشر نفسه.",
    remoteTip,
    fetchImpl,
  );
}

/** Public read-only status shape used by the admin status endpoint. */
export interface DeployRunStatus {
  state: "running" | "success" | "failed" | "none" | "unknown";
  runUrl: string | null;
  headSha: string | null;
  runId: number | null;
  /**
   * Conclusion of the workflow step that creates the rollout — NOT the overall
   * run conclusion. A green run with a skipped/failed rollout step is not a
   * deployment.
   */
  rolloutStep: DeployRolloutStepState;
  /** TRUE only when the run completed AND its rollout step succeeded. */
  rolloutVerified: boolean;
}

const UNKNOWN_RUN_STATUS: DeployRunStatus = {
  state: "unknown",
  runUrl: null,
  headSha: null,
  runId: null,
  rolloutStep: "unknown",
  rolloutVerified: false,
};

export async function readDeployWorkflowRunStatus(
  environment: DeployGhEnvironment,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<DeployRunStatus> {
  const config = resolveGhConfig(environment, env);
  if ("invalid" in config) {
    return UNKNOWN_RUN_STATUS;
  }
  const token = env[DEPLOY_GH_TOKEN_ENV_KEY]?.trim() ?? "";
  if (!token) {
    return UNKNOWN_RUN_STATUS;
  }
  const latest = await fetchLatestRunState(environment, config, token, fetchImpl);
  const rolloutStep =
    latest.state === "success" && latest.runId !== null
      ? await fetchRolloutStepState(config, token, latest.runId, fetchImpl)
      : "unknown";
  return {
    ...latest,
    rolloutStep,
    // A dispatch is never proof; even a successful run is only accepted after
    // the exact rollout step is confirmed successful.
    rolloutVerified: latest.state === "success" && rolloutStep === "success",
  };
}
