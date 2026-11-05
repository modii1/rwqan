import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  APPROVED_UPLOAD_BRANCH_TEST,
  APPROVED_UPLOAD_BRANCH_LIVE,
  type DeployBranchPushResult,
  type DeployEnvironment,
  type DeployUploadStage,
  type DeployUploadStageResult,
  type DeployUploadStageStatus,
  getApprovedUploadBranch,
  isApprovedUploadBranch,
} from "../../shared/deploySystem";

/**
 * RWQAN DEPLOY — dedicated branch upload (git push) pipeline.
 *
 * The upload action is INDEPENDENT from the publish action:
 *   - Upload  => `git push origin <approved-branch-for-environment>` ONLY
 *                (no workflow_dispatch, no Firebase App Hosting rollout,
 *                no deploy of any kind).
 *   - Publish => the existing GitHub-Actions-backed TEST/LIVE publish flow.
 *
 * The target branch is derived from the selected environment:
 *   - TEST  => `test/unified-gateway-ui-only`
 *   - LIVE  => `main`
 *
 * The pipeline runs a fixed, fail-closed sequence and never reports success
 * before the final read-back verification:
 *   1. connection       : the local Git repository is reachable.
 *   2. branch           : the target branch exists locally for the environment.
 *   3. changes          : target branch commit + working-tree state are captured
 *                        (informational only — NEVER auto-committed).
 *   4. github_connection: a read-only `git ls-remote` proves GitHub reachability.
 *   5. push             : `git push origin <branch>` (skipped when already up-to-date).
 *   6. verify           : re-read the remote ref and compare the SHA (fail closed).
 *   7. final            : outcome aggregation (ok / failed + stage).
 *
 * No secret is ever returned or logged. Failures carry a safe Arabic reason and
 * stop the pipeline at the failing stage (fail closed).
 */

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 8_000;
const LS_REMOTE_TIMEOUT_MS = 15_000;
const GIT_MAX_BUFFER = 1024 * 1024 * 64;

export interface DeployGitPushDependencies {
  /** Local git command (no network). */
  run(args: string[], cwd: string): Promise<string>;
  /** Read-only network query: `git ls-remote` (never fetch/pull/push). */
  lsRemote(args: string[], cwd: string): Promise<string>;
  /** Write command: `git push` (only ever invoked by this pipeline). */
  push(args: string[], cwd: string): Promise<string>;
}

const DEFAULT_DEPLOY_GIT_PUSH_DEPENDENCIES: DeployGitPushDependencies = {
  run: async (args, cwd) =>
    (
      await execFileAsync("git", args, {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: GIT_MAX_BUFFER,
      })
    ).stdout.trim(),
  lsRemote: async (args, cwd) =>
    (
      await execFileAsync("git", args, {
        cwd,
        timeout: LS_REMOTE_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: GIT_MAX_BUFFER,
      })
    ).stdout.trim(),
  push: async (args, cwd) =>
    (
      await execFileAsync("git", args, {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: GIT_MAX_BUFFER,
      })
    ).stdout.trim(),
};

export interface RunBranchUploadInput {
  /** Environment the upload targets: TEST or LIVE. */
  environment: DeployEnvironment;
  /** Override branch (mainly for tests); defaults to environment-approved branch. */
  branch?: string;
  cwd?: string;
  dependencies?: DeployGitPushDependencies;
}

function redactGitText(text: string): string {
  return text
    .replace(/(gh[pousr]_[A-Za-z0-9]{20,})/g, "[محجوب]")
    .replace(/(AIza[0-9A-Za-z_-]{20,})/g, "[محجوب]");
}

function stageResult(stage: DeployUploadStage, status: DeployUploadStageStatus, message: string) {
  return { stage, status, message };
}

/**
 * Run the fixed branch-upload pipeline for the given environment. Never throws:
 * every failure is captured in the stage results (fail closed) and aggregated
 * into the outcome.
 */
export async function runBranchUpload(
  input: RunBranchUploadInput,
): Promise<DeployBranchPushResult> {
  const environment = input.environment;
  const cwd = input.cwd ?? process.cwd();
  const deps = input.dependencies ?? DEFAULT_DEPLOY_GIT_PUSH_DEPENDENCIES;

  // Resolve the approved branch for this environment. Fail closed if none.
  const resolvedBranch =
    (input.branch && input.branch.trim().length > 0 ? input.branch.trim() : null) ??
    getApprovedUploadBranch(environment);

  if (!isApprovedUploadBranch(environment, resolvedBranch)) {
    return {
      ok: false,
      pushed: false,
      skipped: false,
      environment,
      branch: resolvedBranch ?? "",
      localSha: null,
      remoteSha: null,
      pushedSha: null,
      detail: `الفرع غير معتمد لبيئة ${environment} — لا يُسمح بالرفع لفرع غير مرخص.`,
      stage: "branch",
      stages: [],
    };
  }

  const branch = resolvedBranch;
  if (!branch) {
    return {
      ok: false,
      pushed: false,
      skipped: false,
      environment,
      branch: "",
      localSha: null,
      remoteSha: null,
      pushedSha: null,
      detail: `لا يوجد فرع معتمد لبيئة ${environment} — الرفع غير ممكن.`,
      stage: "branch",
      stages: [],
    };
  }
  const finalize = (outcome: {
    pushed: boolean;
    skipped: boolean;
    localSha: string | null;
    remoteSha: string | null;
    detail: string;
    stage: DeployUploadStage;
  }): DeployBranchPushResult => {
    const failed = stages.find((entry) => entry.status === "failed");
    const ok = !failed;
    return {
      ok,
      pushed: outcome.pushed,
      skipped: outcome.skipped,
      environment,
      branch,
      localSha: outcome.localSha,
      remoteSha: outcome.remoteSha,
      pushedSha: outcome.pushed ? outcome.localSha : null,
      detail: outcome.detail,
      stage: failed ? failed.stage : "final",
      stages,
    };
  };

  const stages: DeployUploadStageResult[] = [];

  // Stage 1 — connection.
  const connection = await deps
    .run(["rev-parse", "--git-dir"], cwd)
    .then(() => stageResult("connection", "ok", "اتصال بمستودع Git متاح."))
    .catch(() =>
      stageResult("connection", "failed", "تعذّر فحص الاتصال بمستودع Git — لم يُنفَّذ رفع."),
    );
  stages.push(connection);
  if (connection.status === "failed") {
    return finalize({
      pushed: false,
      skipped: false,
      localSha: null,
      remoteSha: null,
      detail: connection.message,
      stage: "connection",
    });
  }

  // Stage 2 — the target branch must exist locally for this environment.
  // We read its commit SHA directly (no checkout, no branch switching).
  const targetLocalShaRaw = await deps.run(["rev-parse", branch], cwd).catch(() => null);
  const targetLocalSha = targetLocalShaRaw
    ? stageResult(
        "branch",
        "ok",
        `الفرع المستهدف لبيئة ${environment}: ${branch} (Commit ${targetLocalShaRaw.slice(0, 7)}).`,
      )
    : stageResult(
        "branch",
        "failed",
        `الفرع (${branch}) غير موجود محليًا — لا يمكن رفع فرع غير موجود.`,
      );
  stages.push(targetLocalSha);
  if (targetLocalSha.status === "failed") {
    return finalize({
      pushed: false,
      skipped: false,
      localSha: null,
      remoteSha: null,
      detail: targetLocalSha.message,
      stage: "branch",
    });
  }

  const localSha = targetLocalShaRaw;

  // Stage 3 — working-tree state (informational only — never auto-committed).
  const statusOutput = await deps
    .run(["status", "--porcelain", "--untracked-files=all"], cwd)
    .catch(() => "");
  const changedLines = (statusOutput ?? "").split("\n").filter(
    (line) => line.trim().length > 0,
  );
  const changes = stageResult(
    "changes",
    "ok",
    localSha
      ? `Commit الفرع ${branch}: ${localSha.slice(0, 7)}` +
        (changedLines.length > 0
          ? ` — يوجد ${changedLines.length} تعديلات غير محفوظة في شجرة العمل (لم تُنفَّذ أي عملية تعديل تلقائية).`
          : " — شجرة العمل نظيفة.")
      : "commit الفرع غير معروف.",
  );
  stages.push(changes);

  // Stage 4 — read-only GitHub reachability (`git ls-remote`, no fetch/push).
  const remoteRef = `refs/heads/${branch}`;
  let remoteSha: string | null = null;
  const githubConnection = await deps
    .lsRemote(["ls-remote", "origin", remoteRef], cwd)
    .then((raw) => {
      const sha = (raw ?? "").split("\t")[0].trim();
      if (sha) remoteSha = sha;
      if (!sha) {
        return stageResult("github_connection", "failed", "فرع GitHub غير موجود — لا يُنفَّذ رفع.");
      }
      return stageResult(
        "github_connection",
        "ok",
        `اتصال بـ GitHub متاح. فرع ${branch} موجود في المستودع البعيد.`,
      );
    })
    .catch(() =>
      stageResult("github_connection", "failed", "تعذّر التحقق من الاتصال بـ GitHub — لم يُنفَّذ رفع."),
    );
  stages.push(githubConnection);
  if (githubConnection.status === "failed") {
    return finalize({
      pushed: false,
      skipped: false,
      localSha: null,
      remoteSha: null,
      detail: githubConnection.message,
      stage: "github_connection",
    });
  }

  // Re-read remote SHA for comparison (single source of truth).
  const finalRemoteSha = await deps
    .lsRemote(["ls-remote", "origin", remoteRef], cwd)
    .then((raw) => (raw ?? "").split("\t")[0].trim())
    .catch(() => null);

  // Stage 5 — push the target branch (skip when already up-to-date).
  let pushStage: DeployUploadStageResult;
  let pushed = false;
  let skipped = false;
  if (finalRemoteSha && localSha && finalRemoteSha === localSha) {
    skipped = true;
    pushStage = stageResult(
      "push",
      "skipped",
      `الفرع ${branch} محدّث بالفعل على GitHub (Commit ${localSha?.slice(0, 7) ?? "غير معروف"}) — لا يوجد رفع جديد.`,
    );
  } else {
    try {
      await deps.push(["push", "origin", branch], cwd);
      pushed = true;
      pushStage = stageResult(
        "push",
        "ok",
        `تم رفع Commit ${(localSha ?? "").slice(0, 7)} من فرع ${branch} إلى GitHub.`,
      );
    } catch (error) {
      const message = redactGitText(error instanceof Error ? error.message : String(error));
      pushStage = stageResult("push", "failed", `فشل رفع الفرع ${branch} إلى GitHub: ${message}`);
    }
  }
  stages.push(pushStage);

  // Stage 6 — verify the pushed SHA via a read-only re-read.
  let verifyStage: DeployUploadStageResult;
  let verifiedRemoteSha: string | null = null;
  if (pushStage.status === "failed") {
    verifyStage = stageResult("verify", "skipped", "لم يُنفَّذ التحقق لأن رفع الفرع فشل.");
  } else if (skipped) {
    verifyStage = stageResult("verify", "ok", "تم التحقق: فرق غير موجود بين الحالة المحلية والبعيدة.");
  } else {
    try {
      verifiedRemoteSha = (
        await deps.lsRemote(["ls-remote", "origin", remoteRef], cwd)
      )
        .split("\t")[0]
        .trim();
      const verified =
        Boolean(verifiedRemoteSha) &&
        Boolean(localSha) &&
        verifiedRemoteSha === localSha;
      verifyStage = verified
        ? stageResult(
            "verify",
            "ok",
            `تم التحقق من نزول Commit ${localSha.slice(0, 7)} من فرع ${branch} إلى GitHub.`,
          )
        : stageResult(
            "verify",
            "failed",
            "فشل التحقق من نزول Commit إلى GitHub — لم يُعتبر الرفع ناجحًا.",
          );
    } catch {
      verifyStage = stageResult("verify", "failed", "تعذّر التحقق من نزول Commit — لم يُعتبر الرفع ناجحًا.");
    }
  }
  stages.push(verifyStage);

  const failed = stages.find((entry) => entry.status === "failed");
  const ok = !failed;

  const detail =
    pushStage.status === "failed"
      ? pushStage.message
      : skipped
        ? `تم رفع الفرع ${branch}: لم يكن هناك تغييرات جديدة للرفع.`
        : ok
          ? `تم رفع الفرع ${branch} إلى GitHub بنجاح لبيئة ${environment}.`
          : verifyStage.message;

  return finalize({
    pushed,
    skipped,
    localSha: localSha ?? null,
    remoteSha: verifiedRemoteSha ?? finalRemoteSha ?? null,
    detail,
    stage: failed ? failed.stage : "final",
  });
}

export {
  APPROVED_UPLOAD_BRANCH_TEST,
  APPROVED_UPLOAD_BRANCH_LIVE,
  getApprovedUploadBranch,
  isApprovedUploadBranch,
};
