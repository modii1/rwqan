import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  APPROVED_UPLOAD_BRANCH_TEST,
  APPROVED_UPLOAD_BRANCH_LIVE,
  type DeployBranchCommitSummary,
  type DeployBranchPushResult,
  type DeployBranchSwitchAssessment,
  type DeployBranchSwitchResult,
  type DeployEnvironment,
  type DeployUploadChange,
  type DeployUploadChangeCategory,
  type DeployUploadChangeCounts,
  type DeployUploadChangeKind,
  type DeployUploadPreview,
  type DeployUploadStage,
  type DeployUploadStageResult,
  type DeployUploadStageStatus,
  getApprovedUploadBranch,
  isApprovedUploadBranch,
} from "../../shared/deploySystem";
import {
  isSecretFileName,
  secretContentDetectedIn,
  sanitizeGitRemote,
} from "./DeployChecksService";

/**
 * RWQAN DEPLOY — branch upload pipeline.
 *
 * The upload action is INDEPENDENT from the publish action:
 *   - Upload  => inspect the working tree, create ONE commit from the approved
 *                files, then `git push origin <approved-branch-for-environment>`.
 *                It never dispatches a workflow and never deploys anything.
 *   - Publish => the existing GitHub-Actions-backed TEST/LIVE publish flow.
 *
 * Target branches:
 *   - TEST  => `test/unified-gateway-ui-only`
 *   - LIVE  => `main`
 *
 * Safety rules:
 *   - The checked-out branch MUST already be the approved branch. The pipeline
 *     never switches branches.
 *   - Secret-looking files or secret-looking content BLOCK the whole upload.
 *   - The admin must explicitly approve the selection (`approveAll` + paths).
 *   - No force push, no reset, no clean, no ignored/deleted local changes.
 *   - Success is reported only after a read-only re-read proves the remote ref
 *     equals the newly created commit.
 */

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 8_000;
const LS_REMOTE_TIMEOUT_MS = 15_000;
const GIT_MAX_BUFFER = 1024 * 1024 * 64;
const MAX_SCANNED_FILE_BYTES = 1024 * 1024;

export interface DeployGitPushDependencies {
  /** Read-only local git command (no network). */
  run(args: string[], cwd: string): Promise<string>;
  /** Read-only network query: `git ls-remote` (never fetch/pull/push). */
  lsRemote(args: string[], cwd: string): Promise<string>;
  /** Write command: `git push` (no force). */
  push(args: string[], cwd: string): Promise<string>;
  /** Write command: `git add` / `git commit` (only after explicit approval). */
  commit?(args: string[], cwd: string): Promise<string>;
  /** Write command: `git switch` (only after explicit approval, clean tree only). */
  switch?(args: string[], cwd: string): Promise<string>;
  /** Test seam: read one changed file for the secret-content scan. */
  readTextFile?(absolutePath: string): Promise<string | null>;
}

/**
 * Git porcelain output is column-sensitive: the first status line starts with a
 * SPACE (X status), so trimming the whole output would corrupt the first path.
 * Remove only one trailing newline and preserve leading spaces.
 */
export function normalizeGitStdout(text: string): string {
  return text.replace(/\r?\n$/, "");
}

const DEFAULT_DEPLOY_GIT_PUSH_DEPENDENCIES: DeployGitPushDependencies = {
  run: async (args, cwd) =>
    normalizeGitStdout(
      (
        await execFileAsync("git", args, {
          cwd,
          timeout: GIT_TIMEOUT_MS,
          windowsHide: true,
          maxBuffer: GIT_MAX_BUFFER,
        })
      ).stdout
    ),
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
  commit: async (args, cwd) =>
    (
      await execFileAsync("git", args, {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: GIT_MAX_BUFFER,
      })
    ).stdout.trim(),
  switch: async (args, cwd) =>
    (
      await execFileAsync("git", args, {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: GIT_MAX_BUFFER,
      })
    ).stdout.trim(),
  readTextFile: async (absolutePath) => {
    try {
      return (await readFile(absolutePath, "utf8")).slice(0, MAX_SCANNED_FILE_BYTES);
    } catch {
      return null;
    }
  },
};

export interface RunBranchUploadInput {
  /** Environment the upload targets: TEST or LIVE. */
  environment: DeployEnvironment;
  /** Override branch (mainly for tests); defaults to environment-approved branch. */
  branch?: string;
  cwd?: string;
  /** Must be TRUE before any commit/push is attempted. */
  approveAll?: boolean;
  /** Repo-relative paths the admin explicitly approved. */
  includePaths?: string[];
  /** Optional commit message override. */
  commitMessage?: string;
  dependencies?: DeployGitPushDependencies;
}

export type RunBranchUploadPreviewInput = Omit<
  RunBranchUploadInput,
  "approveAll" | "includePaths" | "commitMessage"
>;

export interface RunBranchSwitchInput {
  environment: DeployEnvironment;
  /** Override branch (mainly for tests); defaults to environment-approved branch. */
  branch?: string;
  cwd?: string;
  /** Must be TRUE before any `git switch` is attempted. */
  confirm?: boolean;
  /** Must be TRUE when the current branch has unpushed local commits. */
  acknowledgeUnpushed?: boolean;
  dependencies?: DeployGitPushDependencies;
}

export type RunBranchSwitchPreviewInput = Omit<
  RunBranchSwitchInput,
  "confirm" | "acknowledgeUnpushed"
>;

// ── Parsing and classification ───────────────────────────────────────────────

function unquoteGitPath(value: string): string {
  let text = value.trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1);
    text = text
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\([0-7]{3})/g, (_, octal: string) =>
        String.fromCharCode(parseInt(octal, 8))
      );
  }
  return text.replace(/\\/g, "/");
}

/**
 * Parse `git status --porcelain --untracked-files=all` output into every local
 * change, including deletions, renames, and untracked files.
 */
export function parseStatusChanges(output: string): Array<{
  path: string;
  kind: DeployUploadChangeKind;
}> {
  const changes: Array<{ path: string; kind: DeployUploadChangeKind }> = [];
  for (const rawLine of (output ?? "").split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.length < 4) continue;
    const indexStatus = rawLine[0] ?? " ";
    const worktreeStatus = rawLine[1] ?? " ";
    let filePart = rawLine.slice(3).trim();
    if (!filePart) continue;

    let kind: DeployUploadChangeKind;
    if (filePart.includes(" -> ")) {
      filePart = filePart.split(" -> ").pop()?.trim() ?? filePart;
      kind = "renamed";
    } else if (indexStatus === "?" && worktreeStatus === "?") {
      kind = "untracked";
    } else if (indexStatus === "A" || worktreeStatus === "A") {
      kind = "added";
    } else if (indexStatus === "D" || worktreeStatus === "D") {
      kind = "deleted";
    } else if (indexStatus === "R" || worktreeStatus === "R") {
      kind = "renamed";
    } else {
      kind = "modified";
    }

    const filePath = unquoteGitPath(filePart);
    if (filePath) changes.push({ path: filePath, kind });
  }
  return changes;
}

const UNMERGED_STATUS_CODES = new Set(["UU", "AA", "DD", "AU", "UA", "DU", "UD"]);

/** TRUE when the working tree contains unresolved merge/rebase conflicts. */
export function hasUnmergedConflicts(output: string): boolean {
  for (const rawLine of (output ?? "").split(/\r?\n/)) {
    if (rawLine.length >= 2 && UNMERGED_STATUS_CODES.has(rawLine.slice(0, 2))) {
      return true;
    }
  }
  return false;
}

const ARTIFACT_PREFIXES = [
  "reports/",
  "test-results/",
  "playwright-report/",
  "coverage/",
  "dist/",
  "build/",
  ".next/",
  "tmp/",
  "logs/",
];

const ARTIFACT_EXTENSIONS = [".log", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf"];

const ENVIRONMENT_FILE_PATTERNS = [
  /^apphosting.*\.ya?ml$/i,
  /^firebase\.json$/i,
  /^\.firebaserc$/i,
  /^server\/config\/liveDataEnvironment\.ts$/i,
  /^server\/config\/dataEnvironment\.ts$/i,
  /^server\/config\/deployTarget\.ts$/i,
  /^server\/config\/stableRelease\.ts$/i,
  /^shared\/liveData\.ts$/i,
  /^\.env\.example$/i,
  /^\.github\/workflows\//i,
];

export function classifyPath(filePath: string, blocked: boolean): DeployUploadChangeCategory {
  if (blocked) return "sensitive";
  const lower = filePath.toLowerCase();
  if (ARTIFACT_PREFIXES.some((prefix) => lower.startsWith(prefix))) return "artifacts";
  if (ARTIFACT_EXTENSIONS.some((ext) => lower.endsWith(ext))) return "artifacts";
  if (ENVIRONMENT_FILE_PATTERNS.some((pattern) => pattern.test(filePath))) {
    return "environment";
  }
  if (
    lower.startsWith("tests/") ||
    lower.includes("/__tests__/") ||
    /\.(test|spec)\.[a-z0-9]+$/i.test(filePath)
  ) {
    return "tests";
  }
  if (lower.startsWith("docs/") || /\.(md|mdx)$/i.test(filePath)) return "docs";
  if (
    lower.startsWith(".github/") ||
    /\.(json|ya?ml|toml|lock)$/i.test(filePath) ||
    /(^|\/)(package\.json|tsconfig[^/]*\.json|next\.config\.[^/]+|vite\.config\.[^/]+|[^/]+\.config\.[^/]+)$/i.test(
      filePath
    )
  ) {
    return "config";
  }
  return "code";
}

export function buildCounts(changes: DeployUploadChange[]): DeployUploadChangeCounts {
  return {
    total: changes.length,
    modified: changes.filter((c) => c.kind === "modified").length,
    added: changes.filter((c) => c.kind === "added").length,
    deleted: changes.filter((c) => c.kind === "deleted").length,
    renamed: changes.filter((c) => c.kind === "renamed").length,
    untracked: changes.filter((c) => c.kind === "untracked").length,
    sensitive: changes.filter((c) => c.category === "sensitive").length,
  };
}

function buildSuggestedMessage(
  environment: DeployEnvironment,
  counts: DeployUploadChangeCounts
): string {
  const parts: string[] = [];
  if (counts.modified > 0) parts.push(`${counts.modified} معدّل`);
  if (counts.added > 0) parts.push(`${counts.added} جديد`);
  if (counts.deleted > 0) parts.push(`${counts.deleted} محذوف`);
  if (counts.renamed > 0) parts.push(`${counts.renamed} معاد تسميته`);
  if (counts.untracked > 0) parts.push(`${counts.untracked} غير متتبع`);
  return `رفع تحديثات ${environment} — ${counts.total} ملف${
    parts.length > 0 ? ` (${parts.join("، ")})` : ""
  }`;
}

function summarizeCounts(counts: DeployUploadChangeCounts): string {
  return `${counts.total} ملف: ${counts.modified} معدّل، ${counts.added} جديد، ${counts.deleted} محذوف، ${counts.untracked} غير متتبع`;
}

/**
 * Scan changed files for secret-looking names/content. Never returns content,
 * only marks the affected change as blocked.
 */
async function scanChanges(
  cwd: string,
  changes: Array<{ path: string; kind: DeployUploadChangeKind }>,
  deps: DeployGitPushDependencies
): Promise<DeployUploadChange[]> {
  const root = path.resolve(cwd);
  const result: DeployUploadChange[] = [];

  for (const change of changes) {
    let blocked = isSecretFileName(change.path);
    if (!blocked && change.kind !== "deleted") {
      const absolute = path.resolve(root, change.path);
      // Defensive: never read outside the repository root.
      if (absolute === root || absolute.startsWith(root + path.sep)) {
        const content = deps.readTextFile
          ? await deps.readTextFile(absolute).catch(() => null)
          : null;
        if (content && secretContentDetectedIn(content, change.path)) {
          blocked = true;
        }
      }
    }
    const category = classifyPath(change.path, blocked);
    result.push({
      path: change.path,
      kind: change.kind,
      category,
      blocked,
      selectedByDefault: !blocked && category !== "artifacts",
    });
  }
  return result;
}

// ── Import inspection ────────────────────────────────────────────────────────

interface InspectResult {
  environment: DeployEnvironment;
  branch: string;
  currentBranch: string | null;
  branchMatches: boolean;
  localSha: string | null;
  remoteSha: string | null;
  aheadCount: number | null;
  behindCount: number | null;
  changes: DeployUploadChange[];
  counts: DeployUploadChangeCounts;
  stages: DeployUploadStageResult[];
  failure: { stage: DeployUploadStage; detail: string } | null;
}

function stageResult(
  stage: DeployUploadStage,
  status: DeployUploadStageStatus,
  message: string
): DeployUploadStageResult {
  return { stage, status, message };
}

async function inspectUpload(
  input: RunBranchUploadInput,
  branch: string,
  deps: DeployGitPushDependencies
): Promise<InspectResult> {
  const environment = input.environment;
  const cwd = input.cwd ?? process.cwd();
  const stages: DeployUploadStageResult[] = [];

  // 1) connection
  const connection = await deps
    .run(["rev-parse", "--git-dir"], cwd)
    .then(() => stageResult("connection", "ok", "اتصال بمستودع Git متاح."))
    .catch(() =>
      stageResult("connection", "failed", "تعذّر فحص الاتصال بمستودع Git — لم يُنفَّذ رفع.")
    );
  stages.push(connection);
  if (connection.status === "failed") {
    return {
      environment,
      branch,
      currentBranch: null,
      branchMatches: false,
      localSha: null,
      remoteSha: null,
      aheadCount: null,
      behindCount: null,
      changes: [],
      counts: buildCounts([]),
      stages,
      failure: { stage: "connection", detail: connection.message },
    };
  }

  // 2) branch — the repository must ALREADY be on the approved branch.
  const currentBranchRaw = await deps
    .run(["rev-parse", "--abbrev-ref", "HEAD"], cwd)
    .catch(() => "");
  const currentBranch =
    currentBranchRaw && currentBranchRaw !== "HEAD" ? currentBranchRaw : null;
  const branchMatches = currentBranch === branch;
  const localSha = await deps.run(["rev-parse", "HEAD"], cwd).catch(() => null);

  const branchStage = branchMatches
    ? stageResult(
        "branch",
        "ok",
        `الفرع الحالي ${branch} مطابق لفرع بيئة ${environment} (Commit ${localSha?.slice(0, 7) ?? "غير معروف"}).`
      )
    : stageResult(
        "branch",
        "failed",
        `الفرع الحالي (${currentBranch ?? "غير معروف"}) لا يطابق فرع بيئة ${environment} (${branch}). لن يتم تبديل الفرع تلقائياً.`
      );
  stages.push(branchStage);
  if (!branchMatches) {
    return {
      environment,
      branch,
      currentBranch,
      branchMatches,
      localSha,
      remoteSha: null,
      aheadCount: null,
      behindCount: null,
      changes: [],
      counts: buildCounts([]),
      stages,
      failure: { stage: "branch", detail: branchStage.message },
    };
  }

  // 3) changes — every modified/added/deleted/renamed/untracked file.
  const statusOutput = await deps
    .run(["status", "--porcelain", "--untracked-files=all"], cwd)
    .catch(() => "");
  const parsed = parseStatusChanges(statusOutput);
  const changes = await scanChanges(cwd, parsed, deps);
  const counts = buildCounts(changes);

  if (hasUnmergedConflicts(statusOutput)) {
    const message =
      "توجد تعارضات غير محلولة في شجرة العمل — لا يُسمح بإنشاء Commit أو رفع حتى تُحل التعارضات.";
    stages.push(stageResult("changes", "failed", message));
    return {
      environment,
      branch,
      currentBranch,
      branchMatches,
      localSha,
      remoteSha: null,
      aheadCount: null,
      behindCount: null,
      changes,
      counts,
      stages,
      failure: { stage: "changes", detail: message },
    };
  }

  const sensitive = changes.filter((change) => change.blocked);
  if (sensitive.length > 0) {
    const message = `توجد ملفات حساسة أو أسرار ضمن التغييرات (${sensitive
      .slice(0, 5)
      .map((change) => change.path)
      .join(", ")}) — لن يتم إنشاء Commit أو رفع.`;
    stages.push(stageResult("changes", "failed", message));
    return {
      environment,
      branch,
      currentBranch,
      branchMatches,
      localSha,
      remoteSha: null,
      aheadCount: null,
      behindCount: null,
      changes,
      counts,
      stages,
      failure: { stage: "changes", detail: message },
    };
  }

  const changesMessage =
    counts.total > 0
      ? `تم العثور على ${summarizeCounts(counts)}.`
      : "لا توجد تغييرات جديدة لرفعها.";
  stages.push(stageResult("changes", "ok", changesMessage));

  // Remote SHA is informational for the preview; failures do not block it.
  const remoteRef = `refs/heads/${branch}`;
  const remoteSha = await deps
    .lsRemote(["ls-remote", "origin", remoteRef], cwd)
    .then((raw) => (raw ?? "").split("\t")[0]?.trim() || null)
    .catch(() => null);

  let aheadCount: number | null = null;
  let behindCount: number | null = null;
  if (remoteSha) {
    const raw = await deps
      .run(["rev-list", "--left-right", "--count", `HEAD...${remoteSha}`], cwd)
      .catch(() => "");
    const [ahead, behind] = (raw ?? "").trim().split(/\s+/).map(Number);
    if (Number.isFinite(ahead) && Number.isFinite(behind)) {
      aheadCount = ahead;
      behindCount = behind;
    }
  }

  return {
    environment,
    branch,
    currentBranch,
    branchMatches,
    localSha,
    remoteSha,
    aheadCount,
    behindCount,
    changes,
    counts,
    stages,
    failure: null,
  };
}

// ── Branch switch assessment (read-only) ─────────────────────────────────────

function parseCommitLog(output: string): DeployBranchCommitSummary[] {
  return (output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      return tab === -1
        ? { sha: line, subject: "" }
        : { sha: line.slice(0, tab).trim(), subject: line.slice(tab + 1).trim() };
    })
    .filter((commit) => /^[0-9a-f]{7,40}$/i.test(commit.sha));
}

async function listUnpushedCommits(
  branch: string,
  cwd: string,
  deps: DeployGitPushDependencies
): Promise<DeployBranchCommitSummary[]> {
  const remoteRef = `refs/heads/${branch}`;
  const remoteSha = await deps
    .lsRemote(["ls-remote", "origin", remoteRef], cwd)
    .then((raw) => (raw ?? "").split("\t")[0]?.trim() || null)
    .catch(() => null);

  if (remoteSha) {
    const byRemote = await deps
      .run(
        ["log", "--format=%H%x09%s", `${remoteSha}..${branch}`, "-n", "30"],
        cwd
      )
      .catch(() => "");
    const commits = parseCommitLog(byRemote);
    if (commits.length > 0) return commits;
  }

  // Fallback: commits reachable from the local branch but from no origin ref.
  const fallback = await deps
    .run(
      ["log", "--format=%H%x09%s", branch, "--not", "--remotes=origin", "-n", "30"],
      cwd
    )
    .catch(() => "");
  return parseCommitLog(fallback);
}

async function inspectBranchSwitch(
  input: RunBranchSwitchInput,
  targetBranch: string,
  deps: DeployGitPushDependencies
): Promise<DeployBranchSwitchAssessment> {
  const environment = input.environment;
  const cwd = input.cwd ?? process.cwd();

  const currentBranchRaw = await deps
    .run(["rev-parse", "--abbrev-ref", "HEAD"], cwd)
    .catch(() => "");
  const currentBranch =
    currentBranchRaw && currentBranchRaw !== "HEAD" ? currentBranchRaw : null;
  const branchMatches = currentBranch === targetBranch;

  const targetBranchExists = Boolean(
    await deps
      .run(["rev-parse", "--verify", `refs/heads/${targetBranch}`], cwd)
      .catch(() => "")
  );

  const statusOutput = await deps
    .run(["status", "--porcelain", "--untracked-files=all"], cwd)
    .catch(() => "");
  const parsed = parseStatusChanges(statusOutput);
  const workingTreeChanges = await scanChanges(cwd, parsed, deps);
  const workingTreeCounts = buildCounts(workingTreeChanges);

  const unpushedCurrentCommits = currentBranch
    ? await listUnpushedCommits(currentBranch, cwd, deps)
    : [];
  const unpushedTargetCommits = targetBranchExists
    ? await listUnpushedCommits(targetBranch, cwd, deps)
    : [];

  let blockedReason: string | null = null;
  if (!branchMatches) {
    if (!targetBranchExists) {
      blockedReason = `الفرع المستهدف ${targetBranch} غير موجود محليًا — لا يمكن الانتقال إليه دون إنشائه يدويًا.`;
    } else if (workingTreeCounts.total > 0) {
      blockedReason = `توجد ${workingTreeCounts.total} تغييرات غير محفوظة في شجرة العمل — لن يتم الانتقال أو استخدام stash/clean. احفظ التغييرات على الفرع الحالي أولاً.`;
    }
  }

  const canSwitch =
    !branchMatches && targetBranchExists && workingTreeCounts.total === 0;
  const requiresUnpushedAck = unpushedCurrentCommits.length > 0;

  const safeOptions: string[] = [];
  if (branchMatches) {
    safeOptions.push("الفرع الحالي مطابق للفرع المستهدف — لا حاجة للانتقال.");
  } else if (!targetBranchExists) {
    safeOptions.push(
      "أنشئ الفرع المستهدف يدويًا أو اسحبه من GitHub ثم أعد المحاولة."
    );
    safeOptions.push("ألغِ العملية وأبقِ الفرع الحالي كما هو.");
  } else if (workingTreeCounts.total > 0) {
    safeOptions.push(
      "أنشئ Commit للتغييرات على الفرع الحالي أولاً (عبر نفس لوحة الرفع) ثم أعد المحاولة."
    );
    safeOptions.push(
      "ألغِ العملية وأبقِ الفرع الحالي وتغييراته كما هي."
    );
    safeOptions.push("لا يتم استخدام stash أو reset أو clean تلقائيًا.");
  } else {
    safeOptions.push(
      "الانتقال إلى الفرع المستهدف لا ينقل أي تغييرات غير محفوظة (شجرة العمل نظيفة)."
    );
    safeOptions.push("لا يتم دمج الفروع أو نقل تغييرات TEST إلى LIVE تلقائيًا.");
    safeOptions.push("لا يتم استخدام reset أو clean أو stash.");
    if (requiresUnpushedAck) {
      safeOptions.push(
        "توجد Commits محلية غير مرفوعة على الفرع الحالي — ستبقى عليه ولن تُنقل."
      );
    }
  }

  return {
    environment,
    targetBranch,
    currentBranch,
    branchMatches,
    targetBranchExists,
    workingTreeChanges,
    workingTreeCounts,
    unpushedCurrentCommits,
    unpushedTargetCommits,
    canSwitch,
    requiresUnpushedAck,
    blockedReason,
    safeOptions,
  };
}

/** Read-only branch-switch assessment. Never switches, resets, cleans, or stashes. */
export async function runBranchSwitchPreview(
  input: RunBranchSwitchPreviewInput
): Promise<DeployBranchSwitchAssessment> {
  const environment = input.environment;
  const deps = input.dependencies ?? DEFAULT_DEPLOY_GIT_PUSH_DEPENDENCIES;
  const targetBranch =
    (input.branch && input.branch.trim().length > 0 ? input.branch.trim() : null) ??
    getApprovedUploadBranch(environment);

  if (!targetBranch || !isApprovedUploadBranch(environment, targetBranch)) {
    return {
      environment,
      targetBranch: targetBranch ?? "",
      currentBranch: null,
      branchMatches: false,
      targetBranchExists: false,
      workingTreeChanges: [],
      workingTreeCounts: buildCounts([]),
      unpushedCurrentCommits: [],
      unpushedTargetCommits: [],
      canSwitch: false,
      requiresUnpushedAck: false,
      blockedReason: `الفرع غير معتمد لبيئة ${environment} — لا يُسمح بالانتقال إلى فرع غير مرخص.`,
      safeOptions: ["اختر بيئة TEST أو LIVE فقط.", "ألغِ العملية."],
    };
  }

  return inspectBranchSwitch(input, targetBranch, deps);
}

/**
 * Safely switch to the environment's approved branch.
 *
 * Hard safety rules:
 *   - The working tree MUST be completely clean (no modified/untracked files).
 *   - The target branch MUST already exist locally.
 *   - Unpushed local commits require explicit acknowledgment.
 *   - No reset, clean, stash, merge, rebase, or force switch is ever used.
 */
export async function runBranchSwitch(
  input: RunBranchSwitchInput
): Promise<DeployBranchSwitchResult> {
  const environment = input.environment;
  const deps = input.dependencies ?? DEFAULT_DEPLOY_GIT_PUSH_DEPENDENCIES;
  const targetBranch =
    (input.branch && input.branch.trim().length > 0 ? input.branch.trim() : null) ??
    getApprovedUploadBranch(environment);

  if (!targetBranch || !isApprovedUploadBranch(environment, targetBranch)) {
    return {
      environment,
      targetBranch: targetBranch ?? "",
      currentBranch: null,
      branchMatches: false,
      targetBranchExists: false,
      workingTreeChanges: [],
      workingTreeCounts: buildCounts([]),
      unpushedCurrentCommits: [],
      unpushedTargetCommits: [],
      canSwitch: false,
      requiresUnpushedAck: false,
      blockedReason: `الفرع غير معتمد لبيئة ${environment} — لا يُسمح بالانتقال إلى فرع غير مرخص.`,
      safeOptions: ["اختر بيئة TEST أو LIVE فقط.", "ألغِ العملية."],
      ok: false,
      switched: false,
      detail: "البيئة أو الفرع غير معتمد.",
    };
  }

  const assessment = await inspectBranchSwitch(input, targetBranch, deps);
  const base = { ...assessment };

  if (assessment.branchMatches) {
    return {
      ...base,
      ok: true,
      switched: false,
      detail: `الفرع الحالي ${targetBranch} مطابق للفرع المستهدف — لم يُنفَّذ أي تبديل.`,
    };
  }

  if (!assessment.targetBranchExists) {
    return {
      ...base,
      ok: false,
      switched: false,
      detail:
        assessment.blockedReason ??
        `الفرع المستهدف ${targetBranch} غير موجود محليًا.`,
    };
  }

  if (assessment.workingTreeCounts.total > 0) {
    return {
      ...base,
      ok: false,
      switched: false,
      detail:
        assessment.blockedReason ??
        "توجد تغييرات غير محفوظة — لن يتم الانتقال.",
    };
  }

  if (assessment.requiresUnpushedAck && input.acknowledgeUnpushed !== true) {
    return {
      ...base,
      ok: false,
      switched: false,
      requiresAck: true,
      detail:
        "توجد Commits محلية غير مرفوعة على الفرع الحالي — أكّد أنك تفهم أنها ستبقى عليه قبل الانتقال.",
    };
  }

  if (input.confirm !== true) {
    return {
      ...base,
      ok: false,
      switched: false,
      needsConfirm: true,
      detail: `يتطلب تأكيدًا صريحًا قبل الانتقال من ${assessment.currentBranch ?? "الفرع الحالي"} إلى ${targetBranch}.`,
    };
  }

  // Final race check: the tree must still be clean immediately before switching.
  const finalStatus = await deps
    .run(["status", "--porcelain", "--untracked-files=all"], input.cwd ?? process.cwd())
    .catch(() => "");
  if ((finalStatus ?? "").trim().length > 0) {
    return {
      ...base,
      ok: false,
      switched: false,
      detail:
        "ظهرت تغييرات جديدة في شجرة العمل قبل الانتقال — أُوقف التبديل لحماية تغييراتك.",
    };
  }

  try {
    if (!deps.switch) {
      throw new Error("switch dependency is not available");
    }
    await deps.switch(["switch", "--no-guess", targetBranch], input.cwd ?? process.cwd());
  } catch (error) {
    const detail = redactGitText(
      error instanceof Error ? error.message : String(error)
    );
    return {
      ...base,
      ok: false,
      switched: false,
      detail: `تعذّر الانتقال إلى ${targetBranch}: ${detail}`,
    };
  }

  const afterBranchRaw = await deps
    .run(["rev-parse", "--abbrev-ref", "HEAD"], input.cwd ?? process.cwd())
    .catch(() => "");
  const switched = afterBranchRaw === targetBranch;
  return {
    ...base,
    currentBranch: afterBranchRaw && afterBranchRaw !== "HEAD" ? afterBranchRaw : null,
    branchMatches: switched,
    ok: switched,
    switched,
    detail: switched
      ? `تم الانتقال بأمان إلى الفرع ${targetBranch} دون نقل أي تغييرات غير محفوظة.`
      : "تم تنفيذ أمر الانتقال لكن تعذّر تأكيد الفرع الحالي — راجع الحالة قبل المتابعة.",
  };
}

// ── Preview (read-only) ──────────────────────────────────────────────────────

export async function runBranchUploadPreview(
  input: RunBranchUploadPreviewInput
): Promise<DeployUploadPreview> {
  const environment = input.environment;
  const deps = input.dependencies ?? DEFAULT_DEPLOY_GIT_PUSH_DEPENDENCIES;
  const resolvedBranch =
    (input.branch && input.branch.trim().length > 0 ? input.branch.trim() : null) ??
    getApprovedUploadBranch(environment);

  if (!resolvedBranch || !isApprovedUploadBranch(environment, resolvedBranch)) {
    return {
      environment,
      branch: resolvedBranch ?? "",
      currentBranch: null,
      branchMatches: false,
      localSha: null,
      remoteSha: null,
      aheadCount: null,
      behindCount: null,
      changes: [],
      counts: buildCounts([]),
      canCommit: false,
      canPushExistingCommits: false,
      blockedReason: `الفرع غير معتمد لبيئة ${environment} — لا يُسمح بالرفع لفرع غير مرخص.`,
      suggestedMessage: "",
      detail: `لا يوجد فرع معتمد لبيئة ${environment}.`,
    };
  }

  const inspection = await inspectUpload(input, resolvedBranch, deps);
  const counts = inspection.counts;
  const branchSwitch = !inspection.branchMatches
    ? await runBranchSwitchPreview({
        environment,
        branch: resolvedBranch,
        cwd: input.cwd,
        dependencies: deps,
      })
    : undefined;

  let blockedReason: string | null = null;
  if (!inspection.branchMatches) {
    if (branchSwitch?.canSwitch) {
      blockedReason = `الفرع الحالي (${inspection.currentBranch ?? "غير معروف"}) لا يطابق فرع بيئة ${environment} (${resolvedBranch}). يمكن الانتقال إليه بعد التأكيد — لن تُنقل أي تغييرات.`;
    } else {
      blockedReason =
        branchSwitch?.blockedReason ??
        inspection.failure?.detail ??
        "الفرع الحالي لا يطابق الفرع المستهدف.";
    }
  } else if (inspection.failure) {
    blockedReason = inspection.failure.detail;
  } else if (inspection.behindCount !== null && inspection.behindCount > 0) {
    blockedReason = `الفرع المحلي خلف GitHub بـ ${inspection.behindCount} Commit — لا يمكن الرفع قبل الدمج. لن يتم تغيير الفرع تلقائياً.`;
  } else if (counts.total === 0 && (inspection.aheadCount ?? 0) === 0) {
    blockedReason = "لا توجد تغييرات جديدة لرفعها.";
  }

  const canPushExistingCommits =
    inspection.branchMatches &&
    !inspection.failure &&
    counts.total === 0 &&
    (inspection.aheadCount ?? 0) > 0;
  const canCommit = blockedReason === null && counts.total > 0;

  return {
    environment,
    branch: resolvedBranch,
    currentBranch: inspection.currentBranch,
    branchMatches: inspection.branchMatches,
    localSha: inspection.localSha,
    remoteSha: inspection.remoteSha,
    aheadCount: inspection.aheadCount,
    behindCount: inspection.behindCount,
    changes: inspection.changes,
    counts,
    canCommit,
    canPushExistingCommits,
    blockedReason,
    suggestedMessage:
      counts.total > 0 ? buildSuggestedMessage(environment, counts) : "",
    detail: !inspection.branchMatches
      ? branchSwitch?.canSwitch
        ? `الفرع الحالي (${inspection.currentBranch ?? "غير معروف"}) مختلف عن ${resolvedBranch}. الانتقال الآمن متاح بعد التأكيد (شجرة العمل نظيفة).`
        : branchSwitch?.blockedReason ??
          inspection.failure?.detail ??
          "الفرع الحالي لا يطابق الفرع المستهدف."
      : inspection.failure
        ? inspection.failure.detail
        : counts.total > 0
          ? `${summarizeCounts(counts)} على فرع ${resolvedBranch}.`
          : (inspection.aheadCount ?? 0) > 0
            ? `لا توجد تغييرات في شجرة العمل، لكن هناك ${inspection.aheadCount} Commits محلية غير مرفوعة على ${resolvedBranch}.`
            : "لا توجد تغييرات جديدة لرفعها.",
    branchSwitch,
  };
}

// ── Upload (commit + push) ───────────────────────────────────────────────────

function redactGitText(text: string): string {
  return text
    .replace(/(gh[pousr]_[A-Za-z0-9]{20,})/g, "[محجوب]")
    .replace(/(AIza[0-9A-Za-z_-]{20,})/g, "[محجوب]");
}

function normalizeRepoPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function buildCommitUrl(remote: string, sha: string): string | null {
  const clean = sanitizeGitRemote(remote).replace(/\.git$/i, "");
  if (/^https?:\/\/github\.com\//i.test(clean)) {
    return `${clean}/commit/${sha}`;
  }
  if (/^ssh:\/\/github\.com\//i.test(clean)) {
    return `${clean.replace(/^ssh:\/\//i, "https://")}/commit/${sha}`;
  }
  return null;
}

function skippedTail(from: "commit" | "github_connection" | "push" | "verify", message: string) {
  const order: DeployUploadStage[] = [
    "commit",
    "github_connection",
    "push",
    "verify",
  ];
  const start = order.indexOf(from);
  return order.slice(start).map((stage) => stageResult(stage, "skipped", message));
}

export async function runBranchUpload(
  input: RunBranchUploadInput
): Promise<DeployBranchPushResult> {
  const environment = input.environment;
  const cwd = input.cwd ?? process.cwd();
  const deps = input.dependencies ?? DEFAULT_DEPLOY_GIT_PUSH_DEPENDENCIES;
  const resolvedBranch =
    (input.branch && input.branch.trim().length > 0 ? input.branch.trim() : null) ??
    getApprovedUploadBranch(environment);

  if (!resolvedBranch || !isApprovedUploadBranch(environment, resolvedBranch)) {
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

  const finalize = (outcome: {
    pushed: boolean;
    skipped: boolean;
    localSha: string | null;
    remoteSha: string | null;
    commitSha: string | null;
    commitMessage: string | null;
    commitUrl: string | null;
    changeCount: number;
    detail: string;
    stages: DeployUploadStageResult[];
  }): DeployBranchPushResult => {
    const failed = outcome.stages.find((entry) => entry.status === "failed");
    return {
      ok: !failed,
      pushed: outcome.pushed,
      skipped: outcome.skipped,
      environment,
      branch,
      localSha: outcome.localSha,
      remoteSha: outcome.remoteSha,
      pushedSha: outcome.pushed ? outcome.commitSha : null,
      commitSha: outcome.commitSha,
      commitMessage: outcome.commitMessage,
      commitUrl: outcome.commitUrl,
      changeCount: outcome.changeCount,
      detail: outcome.detail,
      stage: failed ? failed.stage : "final",
      stages: outcome.stages,
    };
  };

  // Explicit approval is mandatory before any write.
  if (input.approveAll !== true) {
    const message =
      "لم يتم تأكيد التغييرات المحلية — لن يُنشأ Commit ولن يُنفَّذ رفع. أعد المحاولة بعد مراجعة التغييرات.";
    return finalize({
      pushed: false,
      skipped: false,
      localSha: null,
      remoteSha: null,
      commitSha: null,
      commitMessage: null,
      commitUrl: null,
      changeCount: 0,
      detail: message,
      stages: [stageResult("changes", "failed", message), ...skippedTail("commit", message)],
    });
  }

  const inspection = await inspectUpload(input, branch, deps);
  const stages = [...inspection.stages];

  if (inspection.failure) {
    const message = inspection.failure.detail;
    return finalize({
      pushed: false,
      skipped: false,
      localSha: inspection.localSha,
      remoteSha: inspection.remoteSha,
      commitSha: null,
      commitMessage: null,
      commitUrl: null,
      changeCount: 0,
      detail: message,
      stages: [...stages, ...skippedTail("commit", "لم يُنفَّذ لأن الفحص توقف.")],
    });
  }

  const hasWorkingTreeChanges = inspection.counts.total > 0;
  const hasExistingCommitsToPush = (inspection.aheadCount ?? 0) > 0;

  if (!hasWorkingTreeChanges && !hasExistingCommitsToPush) {
    const message = "لا توجد تغييرات جديدة لرفعها.";
    return finalize({
      pushed: false,
      skipped: true,
      localSha: inspection.localSha,
      remoteSha: inspection.remoteSha,
      commitSha: null,
      commitMessage: null,
      commitUrl: null,
      changeCount: 0,
      detail: message,
      stages: [
        ...stages,
        stageResult("commit", "skipped", "لا توجد تغييرات جديدة — لم يُنشأ Commit."),
        stageResult("github_connection", "skipped", "لا حاجة للاتصال بـ GitHub."),
        stageResult("push", "skipped", "لا يوجد Commit جديد للرفع."),
        stageResult("verify", "skipped", "لا يوجد Commit جديد للتحقق منه."),
      ],
    });
  }

  if (inspection.behindCount !== null && inspection.behindCount > 0) {
    const message = `الفرع المحلي خلف GitHub بـ ${inspection.behindCount} Commit — لا يمكن الرفع قبل الدمج. لن يتم تغيير الفرع تلقائياً.`;
    return finalize({
      pushed: false,
      skipped: false,
      localSha: inspection.localSha,
      remoteSha: inspection.remoteSha,
      commitSha: null,
      commitMessage: null,
      commitUrl: null,
      changeCount: 0,
      detail: message,
      stages: [
        ...stages,
        stageResult("commit", "failed", message),
        ...skippedTail("github_connection", "الفرع متأخر عن GitHub."),
      ],
    });
  }

  let commitSha: string | null = inspection.localSha;
  let commitMessage: string | null = null;
  let changeCount = 0;

  if (hasWorkingTreeChanges) {
  // Validate the admin-approved selection.
  const allowed = new Map(inspection.changes.map((change) => [change.path, change]));
  const requested = Array.isArray(input.includePaths)
    ? Array.from(new Set(input.includePaths.map(normalizeRepoPath).filter(Boolean)))
    : [];
  if (requested.length === 0) {
    const message =
      "لم يتم اختيار أي ملفات — لن يُنشأ Commit. راجع التغييرات واختر الملفات المطلوبة.";
    return finalize({
      pushed: false,
      skipped: false,
      localSha: inspection.localSha,
      remoteSha: inspection.remoteSha,
      commitSha: null,
      commitMessage: null,
      commitUrl: null,
      changeCount: 0,
      detail: message,
      stages: [
        ...stages,
        stageResult("commit", "failed", message),
        ...skippedTail("github_connection", "لم يتم تأكيد أي ملفات."),
      ],
    });
  }

  const invalid: string[] = [];
  const blocked: string[] = [];
  for (const filePath of requested) {
    const change = allowed.get(filePath);
    if (!change) {
      invalid.push(filePath);
    } else if (change.blocked) {
      blocked.push(filePath);
    }
  }
  if (invalid.length > 0) {
    const message = `ملفات غير موجودة ضمن التغييرات الحالية: ${invalid
      .slice(0, 5)
      .join(", ")} — لم يُنشأ Commit.`;
    return finalize({
      pushed: false,
      skipped: false,
      localSha: inspection.localSha,
      remoteSha: inspection.remoteSha,
      commitSha: null,
      commitMessage: null,
      commitUrl: null,
      changeCount: 0,
      detail: message,
      stages: [
        ...stages,
        stageResult("commit", "failed", message),
        ...skippedTail("github_connection", "قائمة الملفات غير صالحة."),
      ],
    });
  }
  if (blocked.length > 0) {
    const message = `ملفات حساسة لا يمكن تضمينها: ${blocked
      .slice(0, 5)
      .join(", ")} — لم يُنشأ Commit.`;
    return finalize({
      pushed: false,
      skipped: false,
      localSha: inspection.localSha,
      remoteSha: inspection.remoteSha,
      commitSha: null,
      commitMessage: null,
      commitUrl: null,
      changeCount: 0,
      detail: message,
      stages: [
        ...stages,
        stageResult("commit", "failed", message),
        ...skippedTail("github_connection", "ملفات حساسة مرفوضة."),
      ],
    });
  }

  const selected = requested
    .map((filePath) => allowed.get(filePath))
    .filter((change): change is DeployUploadChange => Boolean(change));
  changeCount = selected.length;
  const message =
    (input.commitMessage ?? "").trim() ||
    buildSuggestedMessage(environment, inspection.counts);
  commitMessage = message;

  // Stage the selected paths and create ONE commit containing only them.
  commitSha = null;
  try {
    if (!deps.commit) {
      throw new Error("commit dependency is not available");
    }
    await deps.commit(["add", "-A", "--", ...requested], cwd);

    const userName = await deps.run(["config", "--get", "user.name"], cwd).catch(() => "");
    const userEmail = await deps.run(["config", "--get", "user.email"], cwd).catch(() => "");
    const identityArgs: string[] = [];
    if (!userName.trim()) identityArgs.push("-c", "user.name=RWQAN Deploy");
    if (!userEmail.trim()) identityArgs.push("-c", "user.email=deploy@rwqan.sa");

    await deps.commit(
      [...identityArgs, "commit", "-m", message, "--", ...requested],
      cwd
    );
    commitSha = await deps.run(["rev-parse", "HEAD"], cwd);
    if (!commitSha) throw new Error("could not read the new commit SHA");
    stages.push(
      stageResult(
        "commit",
        "ok",
        `تم إنشاء Commit ${commitSha.slice(0, 7)} يضم ${changeCount} ملف.`
      )
    );
  } catch (error) {
    const detail = redactGitText(
      error instanceof Error ? error.message : String(error)
    );
    const failure = stageResult(
      "commit",
      "failed",
      `فشل إنشاء Commit: ${detail}`
    );
    return finalize({
      pushed: false,
      skipped: false,
      localSha: inspection.localSha,
      remoteSha: inspection.remoteSha,
      commitSha: null,
      commitMessage: null,
      commitUrl: null,
      changeCount: 0,
      detail: failure.message,
      stages: [...stages, failure, ...skippedTail("github_connection", "لم يُنفَّذ لأن الـCommit فشل.")],
    });
  }
  } else {
    commitSha = inspection.localSha;
    commitMessage = null;
    changeCount = 0;
    stages.push(
      stageResult(
        "commit",
        "skipped",
        `لا توجد تغييرات جديدة — سيتم رفع ${inspection.aheadCount ?? 0} Commit محلي موجود دون إنشاء Commit جديد.`
      )
    );
  }

  if (!commitSha) {
    const message = "تعذّر تحديد Commit المحلي المطلوب رفعه.";
    return finalize({
      pushed: false,
      skipped: false,
      localSha: null,
      remoteSha: inspection.remoteSha,
      commitSha: null,
      commitMessage: null,
      commitUrl: null,
      changeCount: 0,
      detail: message,
      stages: [
        ...stages,
        stageResult("commit", "failed", message),
        ...skippedTail("github_connection", "لا يوجد Commit للرفع."),
      ],
    });
  }

  const remoteUrl = await deps
    .run(["config", "--get", "remote.origin.url"], cwd)
    .catch(() => "");
  const commitUrl = remoteUrl ? buildCommitUrl(remoteUrl, commitSha) : null;

  // Read-only GitHub reachability check.
  const remoteRef = `refs/heads/${branch}`;
  let remoteShaBeforePush: string | null = null;
  const githubConnection = await deps
    .lsRemote(["ls-remote", "origin", remoteRef], cwd)
    .then((raw) => {
      const sha = (raw ?? "").split("\t")[0]?.trim() ?? "";
      if (sha) remoteShaBeforePush = sha;
      return sha
        ? stageResult(
            "github_connection",
            "ok",
            `اتصال بـ GitHub متاح. فرع ${branch} موجود في المستودع البعيد.`
          )
        : stageResult("github_connection", "failed", "فرع GitHub غير موجود — لا يُنفَّذ رفع.");
    })
    .catch(() =>
      stageResult("github_connection", "failed", "تعذّر التحقق من الاتصال بـ GitHub — لم يُنفَّذ رفع.")
    );
  stages.push(githubConnection);
  if (githubConnection.status === "failed") {
    return finalize({
      pushed: false,
      skipped: false,
      localSha: commitSha,
      remoteSha: remoteShaBeforePush,
      commitSha,
      commitMessage,
      commitUrl,
      changeCount,
      detail: githubConnection.message,
      stages: [...stages, ...skippedTail("push", "لم يُنفَّذ الرفع.")],
    });
  }

  // Push the approved branch. Never force.
  let pushStage: DeployUploadStageResult;
  try {
    await deps.push(["push", "origin", branch], cwd);
    pushStage = stageResult(
      "push",
      "ok",
      `تم رفع Commit ${commitSha.slice(0, 7)} من فرع ${branch} إلى GitHub.`
    );
  } catch (error) {
    const detail = redactGitText(
      error instanceof Error ? error.message : String(error)
    );
    pushStage = stageResult(
      "push",
      "failed",
      `فشل رفع الفرع ${branch} إلى GitHub: ${detail}`
    );
  }
  stages.push(pushStage);

  if (pushStage.status === "failed") {
    return finalize({
      pushed: false,
      skipped: false,
      localSha: commitSha,
      remoteSha: remoteShaBeforePush,
      commitSha,
      commitMessage,
      commitUrl,
      changeCount,
      detail: pushStage.message,
      stages: [...stages, stageResult("verify", "skipped", "لم يُنفَّذ التحقق لأن رفع الفرع فشل.")],
    });
  }

  // Verify the remote ref points at the new commit.
  let verifiedRemoteSha: string | null = null;
  try {
    verifiedRemoteSha = (await deps.lsRemote(["ls-remote", "origin", remoteRef], cwd))
      .split("\t")[0]
      ?.trim() || null;
  } catch {
    verifiedRemoteSha = null;
  }

  const verified = Boolean(verifiedRemoteSha) && verifiedRemoteSha === commitSha;
  const verifyStage = verified
    ? stageResult(
        "verify",
        "ok",
        `تم التحقق من نزول Commit ${commitSha.slice(0, 7)} من فرع ${branch} إلى GitHub.`
      )
    : stageResult(
        "verify",
        "failed",
        "فشل التحقق من نزول Commit إلى GitHub — لم يُعتبر الرفع ناجحًا."
      );
  stages.push(verifyStage);

  return finalize({
    pushed: verified,
    skipped: false,
    localSha: commitSha,
    remoteSha: verifiedRemoteSha,
    commitSha,
    commitMessage,
    commitUrl,
    changeCount,
    detail: verified
      ? hasWorkingTreeChanges
        ? `تم إنشاء Commit ${commitSha.slice(0, 7)} ورفعه إلى فرع ${branch} لبيئة ${environment}.`
        : `تم رفع ${inspection.aheadCount ?? 0} Commit محلي موجود إلى فرع ${branch} لبيئة ${environment} دون إنشاء Commit جديد.`
      : verifyStage.message,
    stages,
  });
}

export {
  APPROVED_UPLOAD_BRANCH_TEST,
  APPROVED_UPLOAD_BRANCH_LIVE,
  getApprovedUploadBranch,
  isApprovedUploadBranch,
};
