import { exec, execFile, spawn, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type DeployBranchPushResult,
  type DeployEnvironment,
  type DeploySyncPreflight,
  type DeployUploadChange,
  type DeployUploadChangeCounts,
  type DeployUploadChangeKind,
  type DeployUploadStage,
  type DeployUploadStageResult,
  type DeployUploadStageStatus,
  type DeployWorkspaceInfo,
  getApprovedUploadBranch,
} from "../../shared/deploySystem";
import {
  isSecretFileName,
  secretContentDetectedIn,
  sanitizeGitRemote,
} from "./DeployChecksService";
import {
  buildCounts,
  classifyPath,
  parseStatusChanges,
} from "./DeployGitPushService";

/**
 * RWQAN DEPLOY — one-click TEST/LIVE synchronisation.
 *
 * TEST:
 *   detect local changes -> run typecheck + tests -> commit -> push -> verify.
 *
 * LIVE:
 *   discover APPROVED commits on the TEST branch -> filter to code paths only
 *   (no secrets, env config, docs, reports, artifacts) -> apply the filtered
 *   patch to the existing isolated LIVE worktree -> run typecheck + tests +
 *   build -> commit on main -> push -> verify.
 *
 * Hard rules:
 *   - Never creates worktrees/folders.
 *   - Never force-pushes, resets, cleans, stashes, merges, or rebases.
 *   - Never moves uncommitted TEST changes to LIVE.
 *   - Never touches the TEST working tree during a LIVE sync.
 *   - On a failed check/conflict, reverses only the patch it applied.
 */

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const GIT_TIMEOUT_MS = 20_000;
const GIT_MAX_BUFFER = 1024 * 1024 * 64;
const CHECK_TIMEOUT_MS = 10 * 60_000;
const BUILD_TIMEOUT_MS = 20 * 60_000;

export interface DeploySyncCheckResult {
  ok: boolean;
  detail: string;
  /** Full command output on failure (never truncated for the admin log). */
  log?: string;
}

export interface DeploySyncChecks {
  typecheck(cwd: string): Promise<DeploySyncCheckResult>;
  tests(cwd: string): Promise<DeploySyncCheckResult>;
  build(cwd: string): Promise<DeploySyncCheckResult>;
}

export interface DeployAutoSyncDependencies {
  run(args: string[], cwd: string): Promise<string>;
  /** EXACT file content at a revision (no trailing-newline trimming). */
  showFile(rev: string, file: string, cwd: string): Promise<string>;
  runWithInput(args: string[], cwd: string, input: string): Promise<string>;
  push(args: string[], cwd: string): Promise<string>;
  lsRemote(args: string[], cwd: string): Promise<string>;
  readTextFile(absolutePath: string): Promise<string | null>;
  checks: DeploySyncChecks;
}

export interface RunTestSyncInput {
  workspace: DeployWorkspaceInfo;
  dependencies?: Partial<DeployAutoSyncDependencies>;
}

export interface RunLivePreflightInput {
  testWorkspace: DeployWorkspaceInfo;
  liveWorkspace: DeployWorkspaceInfo;
  dependencies?: Partial<DeployAutoSyncDependencies>;
}

export interface RunLiveSyncInput extends RunLivePreflightInput {
  token: string;
  confirm?: boolean;
}

// ── small helpers ────────────────────────────────────────────────────────────

function stage(
  name: DeployUploadStage,
  status: DeployUploadStageStatus,
  message: string
): DeployUploadStageResult {
  return { stage: name, status, message };
}

function redact(text: string): string {
  return text
    .replace(/(gh[pousr]_[A-Za-z0-9]{20,})/g, "[محجوب]")
    .replace(/(AIza[0-9A-Za-z_-]{20,})/g, "[محجوب]")
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1[محجوب]");
}

function shortDetail(text: string, max = 320): string {
  const cleaned = redact(text ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

/**
 * Pick the FIRST REAL error line from a command log. Taking the first N chars
 * of the log only shows the command/warnings (e.g. "Compiled successfully"),
 * which hides the actual failure that appears later.
 */
function extractErrorLine(text: string): string {
  const lines = (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const patterns: RegExp[] = [
    /TypeError:/i,
    /Error occurred prerendering/i,
    /error TS\d+/i,
    /^⨯/,
    /Build failed/i,
    /Cannot read properties/i,
    /ERR_|EINVAL|ELIFECYCLE|Command failed/i,
    /Error:/i,
  ];
  for (const pattern of patterns) {
    const found = lines.find((line) => pattern.test(line));
    if (found) return redact(found).slice(0, 500);
  }
  return lines.length > 0
    ? redact(lines[lines.length - 1]).slice(0, 500)
    : "فشل التنفيذ";
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeOutput(text: string): string {
  return text.replace(/\r?\n$/, "");
}

async function runGit(
  args: string[],
  cwd: string,
  timeout = GIT_TIMEOUT_MS
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout,
    windowsHide: true,
    maxBuffer: GIT_MAX_BUFFER,
  });
  return normalizeOutput(stdout);
}

async function runGitWithInput(
  args: string[],
  cwd: string,
  input: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        // `git apply --check --3way` reports clean/conflicting files on stderr
        // while still exiting 0. Return the combined output so the caller can
        // distinguish a real conflict from a whitespace warning.
        const combined = `${stdout}${stderr ? `\n${stderr}` : ""}`;
        resolve(normalizeOutput(combined));
      } else {
        reject(new Error(shortDetail(stderr || stdout || `git exited ${code}`)));
      }
    });
    child.stdin.write(input);
    child.stdin.end();
  });
}

/**
 * Quote one argument for `cmd.exe /d /s /c`. The check commands are fixed
 * literals, but this keeps paths with spaces and shell metacharacters safe.
 */
function quoteForCmd(value: string): string {
  if (!/[\s"&|<>^()%!]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Build a single Windows command line for `cmd.exe`.
 *
 * Windows specifics: `npm`/`npx` are `.cmd` batch files. Node's `execFile`
 * cannot execute a `.cmd` directly without a shell and fails with `EINVAL`
 * ("spawn EINVAL"). `child_process.exec` runs the line through `ComSpec`
 * (`cmd.exe`) and handles quoted paths/args correctly. The cwd is passed as an
 * option, so spaces in the workspace path are handled by Node.
 */
function buildWindowsCommandLine(command: string, args: string[]): string {
  return [command, ...args].map(quoteForCmd).join(" ");
}

/**
 * Run a check command (npm/npx/node) with the same options in TEST and LIVE.
 * On Windows, commands go through `cmd.exe` via `exec` so `.cmd` files work.
 */
export async function runCheckCommand(
  command: string,
  args: string[],
  cwd: string,
  timeout: number,
  extraEnv: Record<string, string> = {}
): Promise<DeploySyncCheckResult> {
  try {
    const options = {
      cwd,
      timeout,
      windowsHide: true,
      maxBuffer: GIT_MAX_BUFFER,
      // The server runs with NODE_ENV=development; Next.js requires a
      // production NODE_ENV for `next build`. Callers that need it (the LIVE
      // build check) pass an explicit override instead of changing global env.
      env: { ...process.env, CI: "1", ...extraEnv },
    };
    const { stdout, stderr } =
      process.platform === "win32"
        ? await execAsync(buildWindowsCommandLine(command, args), options)
        : await execFileAsync(command, args, options);
    const output = `${stdout}\n${stderr}`.trim();
    return { ok: true, detail: output ? shortDetail(output) : "نجح" };
  } catch (error: any) {
    const output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}\n${error?.message ?? ""}`.trim();
    return {
      ok: false,
      detail: extractErrorLine(output),
      // Keep the full log (bounded only to avoid an unbounded HTTP payload).
      log: output.slice(0, 200_000),
    };
  }
}

function npmBin(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function npxBin(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function assertNodeModules(cwd: string): DeploySyncCheckResult | null {
  if (!existsSync(path.join(cwd, "node_modules"))) {
    return {
      ok: false,
      detail:
        "node_modules غير موجودة في مساحة العمل هذه — لن يتم تثبيتها تلقائيًا. ثبّت التبعيات يدويًا ثم أعد المحاولة.",
    };
  }
  return null;
}

const DEFAULT_CHECKS: DeploySyncChecks = {
  async typecheck(cwd) {
    const missing = assertNodeModules(cwd);
    if (missing) return missing;
    return runCheckCommand(npxBin(), ["tsc", "--noEmit"], cwd, CHECK_TIMEOUT_MS);
  },
  async tests(cwd) {
    const missing = assertNodeModules(cwd);
    if (missing) return missing;
    return runCheckCommand(npmBin(), ["test"], cwd, CHECK_TIMEOUT_MS);
  },
  async build(cwd) {
    const missing = assertNodeModules(cwd);
    if (missing) return missing;
    return runCheckCommand(
      npmBin(),
      ["run", "build"],
      cwd,
      BUILD_TIMEOUT_MS,
      { NODE_ENV: "production" }
    );
  },
};

const DEFAULT_DEPENDENCIES: DeployAutoSyncDependencies = {
  run: (args, cwd) => runGit(args, cwd),
  showFile: async (rev, file, cwd) => {
    const { stdout } = await execFileAsync("git", ["show", `${rev}:${file}`], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: GIT_MAX_BUFFER,
    });
    // Exact content: `git apply`/`git merge-file` are newline-sensitive.
    return stdout;
  },
  runWithInput: (args, cwd, input) => runGitWithInput(args, cwd, input),
  push: async (args, cwd) => {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: GIT_MAX_BUFFER,
    });
    return normalizeOutput(stdout);
  },
  lsRemote: async (args, cwd) => {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: GIT_MAX_BUFFER,
    });
    return normalizeOutput(stdout);
  },
  readTextFile: async (absolutePath) => {
    try {
      return (await readFile(absolutePath, "utf8")).slice(0, 1024 * 1024);
    } catch {
      return null;
    }
  },
  checks: DEFAULT_CHECKS,
};

function withDeps(partial?: Partial<DeployAutoSyncDependencies>): DeployAutoSyncDependencies {
  return { ...DEFAULT_DEPENDENCIES, ...(partial ?? {}) };
}

// ── path filtering for LIVE ──────────────────────────────────────────────────

const LIVE_EXCLUDED_PREFIXES = [
  "docs/",
  "reports/",
  "test-results/",
  "playwright-report/",
  "coverage/",
  "dist/",
  "build/",
  ".next/",
  "tmp/",
  "logs/",
  "node_modules/",
  ".github/",
  "server/config/",
];

const LIVE_EXCLUDED_PATTERNS = [
  /^apphosting.*\.ya?ml$/i,
  /^firebase\.json$/i,
  /^\.firebaserc$/i,
  /^shared\/liveData\.ts$/i,
  /^readme.*$/i,
  /\.log$/i,
  /\.(png|jpe?g|webp|gif|pdf)$/i,
];

/**
 * TRUE only for approved application code. Environment configuration, docs,
 * reports, artifacts, and secret-looking paths are NEVER moved to LIVE.
 */
export function isApprovedLiveSyncPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.startsWith(".env")) return false;
  if (isSecretFileName(normalized)) return false;
  if (LIVE_EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }
  return !LIVE_EXCLUDED_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Extract REAL three-way conflict files from `git apply --3way --check`
 * output. Whitespace warnings are intentionally NOT treated as conflicts.
 */
export function parseApplyConflicts(output: string): string[] {
  const files = new Set<string>();
  for (const match of (output ?? "").matchAll(
    /Applied patch to '([^']+)' with conflicts\./g
  )) {
    files.add(match[1]);
  }
  for (const match of (output ?? "").matchAll(
    /^CONFLICT \([^)]+\): .* in (.+)$/gm
  )) {
    files.add(match[1].trim());
  }
  return [...files];
}

interface NameStatusEntry {
  kind: DeployUploadChangeKind;
  paths: string[];
  displayPath: string;
}

function parseNameStatus(output: string): NameStatusEntry[] {
  const entries: NameStatusEntry[] = [];
  for (const line of (output ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0] ?? "";
    if (status.startsWith("R") || status.startsWith("C")) {
      const oldPath = parts[1] ?? "";
      const newPath = parts[2] ?? oldPath;
      if (newPath) {
        entries.push({ kind: "renamed", paths: [oldPath, newPath], displayPath: newPath });
      }
    } else if (status.startsWith("A")) {
      const file = parts[1] ?? "";
      if (file) entries.push({ kind: "added", paths: [file], displayPath: file });
    } else if (status.startsWith("D")) {
      const file = parts[1] ?? "";
      if (file) entries.push({ kind: "deleted", paths: [file], displayPath: file });
    } else {
      const file = parts[1] ?? "";
      if (file) entries.push({ kind: "modified", paths: [file], displayPath: file });
    }
  }
  return entries;
}

function countsForEntries(entries: NameStatusEntry[]): DeployUploadChangeCounts {
  return {
    total: entries.length,
    modified: entries.filter((entry) => entry.kind === "modified").length,
    added: entries.filter((entry) => entry.kind === "added").length,
    deleted: entries.filter((entry) => entry.kind === "deleted").length,
    renamed: entries.filter((entry) => entry.kind === "renamed").length,
    untracked: 0,
    sensitive: 0,
  };
}

function buildSyncMessage(
  environment: DeployEnvironment,
  counts: DeployUploadChangeCounts
): string {
  const parts: string[] = [];
  if (counts.modified > 0) parts.push(`${counts.modified} معدّل`);
  if (counts.added > 0) parts.push(`${counts.added} جديد`);
  if (counts.deleted > 0) parts.push(`${counts.deleted} محذوف`);
  if (counts.renamed > 0) parts.push(`${counts.renamed} معاد تسميته`);
  return `sync(${environment}): ${counts.total} ملف${
    parts.length > 0 ? ` — ${parts.join("، ")}` : ""
  }`;
}

function commitUrlFor(remote: string, sha: string): string | null {
  const clean = sanitizeGitRemote(remote).replace(/\.git$/i, "");
  if (/^https?:\/\/github\.com\//i.test(clean)) return `${clean}/commit/${sha}`;
  if (/^ssh:\/\/github\.com\//i.test(clean)) {
    return `${clean.replace(/^ssh:\/\//i, "https://")}/commit/${sha}`;
  }
  return null;
}

async function currentBranch(cwd: string, deps: DeployAutoSyncDependencies): Promise<string> {
  return deps.run(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

async function remoteShaFor(
  cwd: string,
  branch: string,
  deps: DeployAutoSyncDependencies
): Promise<string | null> {
  const raw = await deps
    .lsRemote(["ls-remote", "origin", `refs/heads/${branch}`], cwd)
    .catch(() => "");
  return raw.split("\t")[0]?.trim() || null;
}

async function commitPaths(
  cwd: string,
  paths: string[],
  message: string,
  deps: DeployAutoSyncDependencies
): Promise<string> {
  await deps.run(["add", "-A", "--", ...paths], cwd);
  const userName = await deps.run(["config", "--get", "user.name"], cwd).catch(() => "");
  const userEmail = await deps.run(["config", "--get", "user.email"], cwd).catch(() => "");
  const identity: string[] = [];
  if (!userName.trim()) identity.push("-c", "user.name=RWQAN Deploy");
  if (!userEmail.trim()) identity.push("-c", "user.email=deploy@rwqan.sa");
  await deps.run([...identity, "commit", "-m", message, "--", ...paths], cwd);
  const sha = await deps.run(["rev-parse", "HEAD"], cwd);
  if (!sha) throw new Error("تعذّر قراءة SHA بعد إنشاء Commit.");
  return sha;
}

async function pushAndVerify(
  cwd: string,
  branch: string,
  sha: string,
  deps: DeployAutoSyncDependencies
): Promise<{ ok: boolean; remoteSha: string | null; detail: string }> {
  try {
    await deps.push(["push", "origin", branch], cwd);
  } catch (error) {
    return {
      ok: false,
      remoteSha: null,
      detail: `فشل Push: ${
        error instanceof Error ? shortDetail(error.message) : "خطأ غير معروف"
      }`,
    };
  }
  const remoteSha = await remoteShaFor(cwd, branch, deps);
  if (!remoteSha || remoteSha !== sha) {
    return {
      ok: false,
      remoteSha,
      detail: "فشل التحقق: SHA البعيد لا يساوي Commit المحلي.",
    };
  }
  return { ok: true, remoteSha, detail: `تم التحقق من Commit ${sha.slice(0, 7)} على GitHub.` };
}

// ── TEST sync ────────────────────────────────────────────────────────────────

export async function runTestAutoSync(
  input: RunTestSyncInput
): Promise<DeployBranchPushResult> {
  const deps = withDeps(input.dependencies);
  const cwd = input.workspace.path;
  const environment: DeployEnvironment = "TEST";
  const branch = getApprovedUploadBranch("TEST") ?? "";
  const stages: DeployUploadStageResult[] = [];

  const finalize = (outcome: {
    ok: boolean;
    pushed: boolean;
    skipped: boolean;
    commitSha: string | null;
    remoteSha: string | null;
    commitMessage: string | null;
    commitUrl: string | null;
    changeCount: number;
    detail: string;
  }): DeployBranchPushResult => {
    const failed = stages.find((entry) => entry.status === "failed");
    return {
      environment,
      ok: outcome.ok && !failed,
      pushed: outcome.pushed,
      skipped: outcome.skipped,
      branch,
      localSha: outcome.commitSha,
      remoteSha: outcome.remoteSha,
      pushedSha: outcome.pushed ? outcome.commitSha : null,
      commitSha: outcome.commitSha,
      commitMessage: outcome.commitMessage,
      commitUrl: outcome.commitUrl,
      changeCount: outcome.changeCount,
      detail: outcome.detail,
      stage: failed ? failed.stage : "final",
      stages,
    };
  };

  try {
    if ((await currentBranch(cwd, deps)) !== branch) {
      stages.push(stage("branch", "failed", `الفرع الحالي ليس ${branch}.`));
      return finalize({
        ok: false,
        pushed: false,
        skipped: false,
        commitSha: null,
        remoteSha: null,
        commitMessage: null,
        commitUrl: null,
        changeCount: 0,
        detail: `الفرع الحالي ليس ${branch}.`,
      });
    }
    stages.push(stage("connection", "ok", "اتصال بمستودع Git متاح."));
    stages.push(stage("branch", "ok", `الفرع ${branch} مطابق.`));

    const statusOutput = await deps.run(
      ["status", "--porcelain", "--untracked-files=all"],
      cwd
    );
    const parsed = parseStatusChanges(statusOutput);

    const changes: DeployUploadChange[] = [];
    for (const change of parsed) {
      let blocked = isSecretFileName(change.path);
      if (!blocked && change.kind !== "deleted") {
        const content = await deps
          .readTextFile(path.resolve(cwd, change.path))
          .catch(() => null);
        if (content && secretContentDetectedIn(content, change.path)) blocked = true;
      }
      const category = classifyPath(change.path, blocked);
      changes.push({
        path: change.path,
        kind: change.kind,
        category,
        blocked,
        selectedByDefault: !blocked && category !== "artifacts",
      });
    }

    const sensitive = changes.filter((change) => change.blocked);
    if (sensitive.length > 0) {
      const message = `توجد ملفات حساسة (${sensitive
        .slice(0, 3)
        .map((change) => change.path)
        .join(", ")}) — أُوقفت المزامنة.`;
      stages.push(stage("changes", "failed", message));
      return finalize({
        ok: false,
        pushed: false,
        skipped: false,
        commitSha: null,
        remoteSha: null,
        commitMessage: null,
        commitUrl: null,
        changeCount: 0,
        detail: message,
      });
    }

    const selected = changes.filter(
      (change) => change.category !== "artifacts" && !change.blocked
    );
    const excludedArtifacts = changes.length - selected.length;
    const counts = buildCounts(selected);

    const remoteSha = await remoteShaFor(cwd, branch, deps);
    let aheadCount = 0;
    if (remoteSha) {
      const raw = await deps
        .run(["rev-list", "--left-right", "--count", `HEAD...${remoteSha}`], cwd)
        .catch(() => "");
      const [ahead] = raw.trim().split(/\s+/).map(Number);
      if (Number.isFinite(ahead)) aheadCount = ahead;
    }

    if (selected.length === 0 && aheadCount === 0) {
      stages.push(stage("changes", "ok", "لا توجد تحديثات جديدة."));
      return finalize({
        ok: true,
        pushed: false,
        skipped: true,
        commitSha: null,
        remoteSha,
        commitMessage: null,
        commitUrl: null,
        changeCount: 0,
        detail: "لا توجد تحديثات جديدة.",
      });
    }

    stages.push(
      stage(
        "changes",
        "ok",
        `${counts.total} ملف${excludedArtifacts > 0 ? ` (استُثني ${excludedArtifacts} مخرجًا)` : ""}.`
      )
    );

    const typecheck = await deps.checks.typecheck(cwd);
    const tests = await deps.checks.tests(cwd);
    if (!typecheck.ok || !tests.ok) {
      const failed = !typecheck.ok ? typecheck : tests;
      const message = `فشل الفحص: ${failed.detail}`;
      stages.push(stage("checks", "failed", message));
      return finalize({
        ok: false,
        pushed: false,
        skipped: false,
        commitSha: null,
        remoteSha,
        commitMessage: null,
        commitUrl: null,
        changeCount: 0,
        detail: message,
      });
    }
    stages.push(stage("checks", "ok", "نجح Typecheck والاختبارات."));

    let commitSha = remoteSha;
    let commitMessage: string | null = null;
    let changeCount = 0;
    if (selected.length > 0) {
      commitMessage = buildSyncMessage(environment, counts);
      commitSha = await commitPaths(
        cwd,
        selected.map((change) => change.path),
        commitMessage,
        deps
      );
      changeCount = selected.length;
      stages.push(stage("commit", "ok", `تم إنشاء Commit ${commitSha.slice(0, 7)}.`));
    } else {
      commitSha = await deps.run(["rev-parse", "HEAD"], cwd);
      stages.push(stage("commit", "skipped", "لا توجد تغييرات جديدة — رفع Commits موجودة."));
    }

    if (!commitSha) {
      const message = "تعذّر تحديد Commit للرفع.";
      stages.push(stage("commit", "failed", message));
      return finalize({
        ok: false,
        pushed: false,
        skipped: false,
        commitSha: null,
        remoteSha,
        commitMessage,
        commitUrl: null,
        changeCount,
        detail: message,
      });
    }

    const pushed = await pushAndVerify(cwd, branch, commitSha, deps);
    stages.push(
      stage("push", pushed.ok ? "ok" : "failed", pushed.detail)
    );
    if (!pushed.ok) {
      return finalize({
        ok: false,
        pushed: false,
        skipped: false,
        commitSha,
        remoteSha: pushed.remoteSha,
        commitMessage,
        commitUrl: null,
        changeCount,
        detail: pushed.detail,
      });
    }
    stages.push(stage("verify", "ok", pushed.detail));

    const remoteUrl = await deps
      .run(["config", "--get", "remote.origin.url"], cwd)
      .catch(() => "");
    return finalize({
      ok: true,
      pushed: true,
      skipped: false,
      commitSha,
      remoteSha: pushed.remoteSha,
      commitMessage,
      commitUrl: commitUrlFor(remoteUrl, commitSha),
      changeCount,
      detail: `تمت مزامنة TEST ورفع Commit ${commitSha.slice(0, 7)}.`,
    });
  } catch (error) {
    const message =
      error instanceof Error ? shortDetail(error.message) : "خطأ غير معروف";
    stages.push(stage("final", "failed", message));
    return finalize({
      ok: false,
      pushed: false,
      skipped: false,
      commitSha: null,
      remoteSha: null,
      commitMessage: null,
      commitUrl: null,
      changeCount: 0,
      detail: message,
    });
  }
}

// ── Prepared LIVE state recognition ──────────────────────────────────────────

const SUPPORTING_SYNC_PATHS = new Set([
  "server/services/DeployExecutor.ts",
  "server/services/GitHubAuthService.ts",
  "server/config/runtimeEnvironment.ts",
  "package.json",
]);

function normalizeText(value: string): string {
  const withoutBom =
    value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
  return withoutBom.replace(/\r\n/g, "\n");
}

function lineMultiset(value: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const line of normalizeText(value).split("\n")) {
    map.set(line, (map.get(line) ?? 0) + 1);
  }
  return map;
}

function containsAllLines(current: string, testContent: string): boolean {
  const currentLines = lineMultiset(current);
  for (const [line, count] of lineMultiset(testContent)) {
    if ((currentLines.get(line) ?? 0) < count) return false;
  }
  return true;
}

function mergeHasConflicts(
  current: string,
  baseContent: string,
  testContent: string
): boolean {
  const dir = mkdtempSync(path.join(tmpdir(), "rwqan-sync-merge-"));
  try {
    const baseFile = path.join(dir, "base");
    const currentFile = path.join(dir, "current");
    const testFile = path.join(dir, "test");
    writeFileSync(baseFile, normalizeText(baseContent), "utf8");
    writeFileSync(currentFile, normalizeText(current), "utf8");
    writeFileSync(testFile, normalizeText(testContent), "utf8");
    const merged = spawnSync(
      "git",
      ["merge-file", "-p", "--diff3", currentFile, baseFile, testFile],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    return /^<<<<<<< /m.test(merged.stdout ?? "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function countsForPaths(
  changes: Array<{ path: string; kind: DeployUploadChangeKind }>,
  paths: Set<string>
): DeployUploadChangeCounts {
  const selected: DeployUploadChange[] = changes
    .filter((change) => paths.has(change.path))
    .map((change) => ({
      path: change.path,
      kind: change.kind,
      category: classifyPath(change.path, false),
      blocked: false,
      selectedByDefault: true,
    }));
  return buildCounts(selected);
}

interface PreparedLiveAnalysis {
  prepared: boolean;
  paths: string[];
  approvedPaths: string[];
  supportingPaths: string[];
  counts: DeployUploadChangeCounts;
  token: string;
  blockedReason: string | null;
}

async function analyzePreparedLiveState(
  testWorkspace: DeployWorkspaceInfo,
  liveWorkspace: DeployWorkspaceInfo,
  testBranch: string,
  baseSha: string,
  liveHead: string,
  liveStatus: string,
  deps: DeployAutoSyncDependencies
): Promise<PreparedLiveAnalysis> {
  const parsed = parseStatusChanges(liveStatus);
  if (parsed.length === 0) {
    return {
      prepared: false,
      paths: [],
      approvedPaths: [],
      supportingPaths: [],
      counts: countsForPaths([], new Set()),
      token: "",
      blockedReason: null,
    };
  }

  const nameStatus = await deps
    .run(["diff", "--name-status", `${baseSha}..${testBranch}`], testWorkspace.path)
    .catch(() => "");
  const approved = new Set<string>();
  for (const line of nameStatus.split(/\r?\n/).filter(Boolean)) {
    const parts = line.split("\t");
    const status = parts[0] ?? "";
    const paths =
      status.startsWith("R") || status.startsWith("C")
        ? [parts[1] ?? "", parts[2] ?? ""]
        : [parts[1] ?? ""];
    for (const file of paths.filter(Boolean)) {
      if (isApprovedLiveSyncPath(file)) approved.add(file);
    }
  }

  const blocked: string[] = [];
  const supporting: string[] = [];
  const approvedChanged: string[] = [];

  for (const change of parsed) {
    const file = change.path;
    if (SUPPORTING_SYNC_PATHS.has(file)) {
      supporting.push(file);
      continue;
    }
    if (!approved.has(file)) {
      blocked.push(`${file} (غير معتمد)`);
      continue;
    }

    approvedChanged.push(file);
    const current = await deps
      .readTextFile(path.join(liveWorkspace.path, file))
      .catch(() => null);
    const testContent = await deps
      .showFile(testBranch, file, testWorkspace.path)
      .catch(() => null);
    if (current === null || testContent === null) {
      blocked.push(`${file} (تعذّرت قراءة المحتوى)`);
      continue;
    }
    const baseContent = await deps
      .showFile(baseSha, file, testWorkspace.path)
      .catch(() => null);
    const conflict =
      baseContent === null
        ? !containsAllLines(current, testContent)
        : mergeHasConflicts(current, baseContent, testContent);
    if (conflict) blocked.push(`${file} (تعارض غير محلول)`);
  }

  // Supporting files: verify they are exactly the known, intentional changes.
  for (const file of supporting) {
    const current = await deps
      .readTextFile(path.join(liveWorkspace.path, file))
      .catch(() => null);
    if (current === null) {
      blocked.push(`${file} (تعذّرت قراءة المحتوى)`);
      continue;
    }
    if (file === "server/services/GitHubAuthService.ts") {
      const expected = await deps
        .readTextFile(path.join(testWorkspace.path, file))
        .catch(() => null);
      if (!expected || normalizeText(current) !== normalizeText(expected)) {
        blocked.push(`${file} (تغيير غير معروف)`);
      }
    } else if (file === "server/services/DeployExecutor.ts") {
      const committed = await deps
        .showFile(testBranch, file, testWorkspace.path)
        .catch(() => null);
      const working = await deps
        .readTextFile(path.join(testWorkspace.path, file))
        .catch(() => null);
      const ok =
        (committed && normalizeText(current) === normalizeText(committed)) ||
        (working && normalizeText(current) === normalizeText(working));
      if (!ok) blocked.push(`${file} (تغيير غير معروف)`);
    } else if (file === "server/config/runtimeEnvironment.ts") {
      const mainContent = await deps
        .showFile("main", file, liveWorkspace.path)
        .catch(() => null);
      const testContent = await deps
        .readTextFile(path.join(testWorkspace.path, file))
        .catch(() => null);
      const anchor =
        'const ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT_KEY =\n  "ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT";';
      const paymobMarker = "\n/**\n * Paymob-only development opt-in.";
      let ok = false;
      if (mainContent && testContent) {
        const normalizedTest = normalizeText(testContent);
        const blockStart = normalizedTest.indexOf(anchor);
        const blockEnd = normalizedTest.indexOf(paymobMarker);
        if (blockStart >= 0 && blockEnd > blockStart) {
          // The extracted block ends with a newline; the main file already
          // supplies the separator before the next comment. Drop one newline
          // so the expected content matches the exact inserted block.
          const block = normalizedTest
            .slice(blockStart + anchor.length, blockEnd)
            .replace(/\n$/, "");
          const expected = normalizeText(mainContent).replace(
            anchor,
            `${anchor}${block}`
          );
          ok = normalizeText(current) === expected;
        }
      }
      if (!ok) blocked.push(`${file} (تغيير غير معروف)`);
    } else if (file === "package.json") {
      const mainContent = await deps
        .showFile("main", file, liveWorkspace.path)
        .catch(() => null);
      let ok = false;
      if (mainContent) {
        try {
          const currentJson = JSON.parse(current);
          const mainJson = JSON.parse(mainContent);
          const currentScripts = { ...(currentJson.scripts ?? {}) };
          const testScript = currentScripts.test;
          delete currentScripts.test;
          const mainScripts = { ...(mainJson.scripts ?? {}) };
          delete mainScripts.test;
          ok =
            JSON.stringify(currentScripts) === JSON.stringify(mainScripts) &&
            typeof testScript === "string" &&
            testScript.includes("--import tsx --test");
        } catch {
          ok = false;
        }
      }
      if (!ok) blocked.push(`${file} (تغيير غير معروف)`);
    }
  }

  const counts = countsForPaths(parsed, new Set(approvedChanged));
  const paths = parsed.map((change) => change.path);
  const contentHashes: string[] = [];
  for (const file of paths) {
    const content = await deps
      .readTextFile(path.join(liveWorkspace.path, file))
      .catch(() => null);
    contentHashes.push(
      content === null
        ? "deleted"
        : createHash("sha256").update(content).digest("hex")
    );
  }
  const token = hash(
    `${liveHead}:${paths.slice().sort().join("\n")}:${contentHashes
      .slice()
      .sort()
      .join("\n")}`
  );

  if (blocked.length > 0) {
    return {
      prepared: false,
      paths,
      approvedPaths: approvedChanged,
      supportingPaths: supporting,
      counts,
      token: "",
      blockedReason: `تغييرات محلية غير معتمدة أو تعارض غير محلول في LIVE: ${blocked
        .slice(0, 6)
        .join(", ")}${blocked.length > 6 ? "…" : ""} — لم يتم تغيير أي ملف.`,
    };
  }

  return {
    prepared: true,
    paths,
    approvedPaths: approvedChanged,
    supportingPaths: supporting,
    counts,
    token,
    blockedReason: null,
  };
}

// ── LIVE discovery ───────────────────────────────────────────────────────────

interface LiveDiscovery {
  testSha: string;
  liveHead: string;
  baseSha: string;
  approvedEntries: NameStatusEntry[];
  approvedPaths: string[];
  excludedCount: number;
  counts: DeployUploadChangeCounts;
  patch: string;
  token: string;
  commitMessage: string;
  blockedReason: string | null;
  /** TRUE when the LIVE worktree already contains a recognized prepared sync. */
  prepared: boolean;
  preparedPaths: string[];
  preparedApprovedPaths: string[];
  preparedSupportingPaths: string[];
}

async function discoverLive(
  testWorkspace: DeployWorkspaceInfo,
  liveWorkspace: DeployWorkspaceInfo,
  deps: DeployAutoSyncDependencies
): Promise<LiveDiscovery> {
  const testBranch = getApprovedUploadBranch("TEST") ?? "";
  const liveBranch = getApprovedUploadBranch("LIVE") ?? "";
  const testCwd = testWorkspace.path;
  const liveCwd = liveWorkspace.path;

  const empty: LiveDiscovery = {
    testSha: "",
    liveHead: "",
    baseSha: "",
    approvedEntries: [],
    approvedPaths: [],
    excludedCount: 0,
    counts: countsForEntries([]),
    patch: "",
    token: "",
    commitMessage: "",
    blockedReason: null,
    prepared: false,
    preparedPaths: [],
    preparedApprovedPaths: [],
    preparedSupportingPaths: [],
  };

  if ((await currentBranch(testCwd, deps)) !== testBranch) {
    return { ...empty, blockedReason: `مساحة TEST ليست على ${testBranch}.` };
  }
  if ((await currentBranch(liveCwd, deps)) !== liveBranch) {
    return { ...empty, blockedReason: `مساحة LIVE ليست على ${liveBranch}.` };
  }

  const testSha = await deps.run(["rev-parse", testBranch], testCwd);
  const liveHead = await deps.run(["rev-parse", "HEAD"], liveCwd);
  const baseSha = await deps.run(["merge-base", liveBranch, testBranch], liveCwd);

  const nameStatus = await deps.run(
    ["diff", "--name-status", `${baseSha}..${testBranch}`],
    testCwd
  );
  const entries = parseNameStatus(nameStatus);
  const approvedEntries = entries.filter((entry) =>
    entry.paths.every((filePath) => isApprovedLiveSyncPath(filePath))
  );
  const excludedCount = entries.length - approvedEntries.length;
  const approvedPaths = Array.from(
    new Set(approvedEntries.flatMap((entry) => entry.paths))
  );
  const counts = countsForEntries(approvedEntries);

  if (approvedEntries.length === 0) {
    return {
      ...empty,
      testSha,
      liveHead,
      baseSha,
      excludedCount,
      counts,
      blockedReason:
        "لا توجد تحديثات برمجية معتمدة على TEST تستحق النقل إلى LIVE.",
    };
  }

  const liveStatus = await deps.run(
    ["status", "--porcelain", "--untracked-files=all"],
    liveCwd
  );
  if (liveStatus.trim().length > 0) {
    const prepared = await analyzePreparedLiveState(
      testWorkspace,
      liveWorkspace,
      testBranch,
      baseSha,
      liveHead,
      liveStatus,
      deps
    );
    if (prepared.blockedReason) {
      return {
        ...empty,
        testSha,
        liveHead,
        baseSha,
        counts: prepared.counts,
        blockedReason: prepared.blockedReason,
      };
    }
    return {
      ...empty,
      testSha,
      liveHead,
      baseSha,
      counts: prepared.counts,
      token: prepared.token,
      commitMessage: buildSyncMessage("LIVE", prepared.counts),
      prepared: true,
      preparedPaths: prepared.paths,
      preparedApprovedPaths: prepared.approvedPaths,
      preparedSupportingPaths: prepared.supportingPaths,
      blockedReason: null,
    };
  }

  if (!existsSync(path.join(liveCwd, "node_modules"))) {
    return {
      ...empty,
      testSha,
      liveHead,
      baseSha,
      approvedEntries,
      approvedPaths,
      excludedCount,
      counts,
      blockedReason:
        "مساحة LIVE لا تحتوي على node_modules — لن يتم تثبيتها تلقائيًا. ثبّت التبعيات في مساحة LIVE يدويًا ثم أعد المحاولة.",
    };
  }

  // Generate a patch containing ONLY approved paths. `--full-index` is required
  // so `git apply --3way` can perform a real three-way merge when both TEST and
  // LIVE changed the same file since the merge base.
  const chunks: string[] = [];
  for (let index = 0; index < approvedPaths.length; index += 40) {
    const chunk = approvedPaths.slice(index, index + 40);
    const part = await deps.run(
      [
        "diff",
        "--binary",
        "--full-index",
        `${baseSha}..${testBranch}`,
        "--",
        ...chunk,
      ],
      testCwd
    );
    if (part) chunks.push(part);
  }
  const patch = chunks.length > 0 ? `${chunks.join("\n")}\n` : "";
  if (!patch.trim()) {
    return {
      ...empty,
      testSha,
      liveHead,
      baseSha,
      approvedEntries,
      approvedPaths,
      excludedCount,
      counts,
      blockedReason: "لم يُنتج أي فرق قابل للتطبيق على LIVE.",
    };
  }

  // `--whitespace=nowarn` suppresses trailing-whitespace warnings without
  // modifying content. `--3way` merges files changed on both branches. The
  // check exits 0 even when it would produce conflicts, so parse its output.
  let checkOutput = "";
  try {
    checkOutput = await deps.runWithInput(
      ["apply", "--check", "--3way", "--whitespace=nowarn", "-"],
      liveCwd,
      patch
    );
  } catch (error) {
    return {
      ...empty,
      testSha,
      liveHead,
      baseSha,
      approvedEntries,
      approvedPaths,
      excludedCount,
      counts,
      blockedReason: `تعارض حقيقي عند تطبيق تحديثات TEST على LIVE: ${
        error instanceof Error ? shortDetail(error.message) : "تعذّر التحقق"
      }`,
    };
  }

  const conflicts = parseApplyConflicts(checkOutput);
  if (conflicts.length > 0) {
    return {
      ...empty,
      testSha,
      liveHead,
      baseSha,
      approvedEntries,
      approvedPaths,
      excludedCount,
      counts,
      blockedReason: `تعارض حقيقي في ${conflicts.length} ملف: ${conflicts
        .slice(0, 6)
        .join(", ")}${conflicts.length > 6 ? "…" : ""} — لم يُطبَّق أي تغيير.`,
    };
  }

  const token = hash(
    `${testSha}:${liveHead}:${baseSha}:${approvedPaths.slice().sort().join("\n")}:${hash(patch)}`
  );
  return {
    testSha,
    liveHead,
    baseSha,
    approvedEntries,
    approvedPaths,
    excludedCount,
    counts,
    patch,
    token,
    prepared: false,
    preparedPaths: [],
    preparedApprovedPaths: [],
    preparedSupportingPaths: [],
    commitMessage: buildSyncMessage("LIVE", counts),
    blockedReason: null,
  };
}

export async function runLiveSyncPreflight(
  input: RunLivePreflightInput
): Promise<DeploySyncPreflight> {
  const deps = withDeps(input.dependencies);
  const discovery = await discoverLive(
    input.testWorkspace,
    input.liveWorkspace,
    deps
  );
  return {
    environment: "LIVE",
    branch: getApprovedUploadBranch("LIVE") ?? "",
    workspace: input.liveWorkspace,
    approvedCount: discovery.prepared
      ? discovery.preparedApprovedPaths.length
      : discovery.approvedEntries.length,
    counts: discovery.counts,
    commitMessage: discovery.commitMessage,
    canSync: discovery.blockedReason === null,
    blockedReason: discovery.blockedReason,
    detail:
      discovery.blockedReason ??
      (discovery.prepared
        ? `تم العثور على مزامنة سابقة مُجهّزة (${discovery.preparedPaths.length} ملفًا) — سيتم استئنافها دون إعادة تطبيق.`
        : `${discovery.counts.total} ملف برمجي معتمد من TEST (استُثني ${discovery.excludedCount}).`),
    prepared: discovery.prepared,
    preparedCount: discovery.prepared ? discovery.preparedPaths.length : 0,
    token: discovery.token,
  };
}

// ── LIVE sync ────────────────────────────────────────────────────────────────

export async function runLiveSync(
  input: RunLiveSyncInput
): Promise<DeployBranchPushResult> {
  const deps = withDeps(input.dependencies);
  const liveCwd = input.liveWorkspace.path;
  const branch = getApprovedUploadBranch("LIVE") ?? "";
  const stages: DeployUploadStageResult[] = [];

  const finalize = (outcome: {
    ok: boolean;
    pushed: boolean;
    skipped: boolean;
    commitSha: string | null;
    remoteSha: string | null;
    commitMessage: string | null;
    commitUrl: string | null;
    changeCount: number;
    detail: string;
    failureLog?: string | null;
  }): DeployBranchPushResult => {
    const failed = stages.find((entry) => entry.status === "failed");
    return {
      environment: "LIVE",
      ok: outcome.ok && !failed,
      pushed: outcome.pushed,
      skipped: outcome.skipped,
      branch,
      localSha: outcome.commitSha,
      remoteSha: outcome.remoteSha,
      pushedSha: outcome.pushed ? outcome.commitSha : null,
      commitSha: outcome.commitSha,
      commitMessage: outcome.commitMessage,
      commitUrl: outcome.commitUrl,
      changeCount: outcome.changeCount,
      failureLog: outcome.failureLog ?? null,
      detail: outcome.detail,
      stage: failed ? failed.stage : "final",
      stages,
    };
  };

  if (input.confirm !== true) {
    stages.push(stage("changes", "failed", "لم يتم تأكيد المزامنة."));
    return finalize({
      ok: false,
      pushed: false,
      skipped: false,
      commitSha: null,
      remoteSha: null,
      commitMessage: null,
      commitUrl: null,
      changeCount: 0,
      detail: "لم يتم تأكيد المزامنة.",
    });
  }

  const discovery = await discoverLive(
    input.testWorkspace,
    input.liveWorkspace,
    deps
  );
  if (discovery.blockedReason) {
    stages.push(stage("changes", "failed", discovery.blockedReason));
    return finalize({
      ok: false,
      pushed: false,
      skipped: false,
      commitSha: null,
      remoteSha: null,
      commitMessage: null,
      commitUrl: null,
      changeCount: 0,
      detail: discovery.blockedReason,
    });
  }
  if (discovery.token !== input.token) {
    const message =
      "تغيّرت حالة Git بعد التأكيد — أعد فتح المزامنة للمراجعة من جديد.";
    stages.push(stage("changes", "failed", message));
    return finalize({
      ok: false,
      pushed: false,
      skipped: false,
      commitSha: null,
      remoteSha: null,
      commitMessage: null,
      commitUrl: null,
      changeCount: 0,
      detail: message,
    });
  }

  stages.push(stage("connection", "ok", "اتصال بمستودع Git متاح."));
  stages.push(stage("branch", "ok", `الفرع ${branch} مطابق.`));
  stages.push(
    stage(
      "changes",
      "ok",
      discovery.prepared
        ? `تم التعرف على مزامنة سابقة مُجهّزة (${discovery.preparedPaths.length} ملفًا) — لن تُعاد.`
        : `${discovery.counts.total} ملف برمجي معتمد من TEST.`
    )
  );

  if (!discovery.prepared) {
    try {
      await deps.runWithInput(["apply", "--check", "--3way", "--whitespace=nowarn", "-"], liveCwd, discovery.patch);
      await deps.runWithInput(["apply", "--3way", "--whitespace=nowarn", "-"], liveCwd, discovery.patch);
    } catch (error) {
      const message = `تعارض عند تطبيق تحديثات TEST على LIVE: ${
        error instanceof Error ? shortDetail(error.message) : "تعذّر التطبيق"
      }`;
      stages.push(stage("changes", "failed", message));
      return finalize({
        ok: false,
        pushed: false,
        skipped: false,
        commitSha: null,
        remoteSha: null,
        commitMessage: null,
        commitUrl: null,
        changeCount: 0,
        detail: message,
      });
    }
  }

  // All checks run against the PATCHED LIVE working tree.
  const typecheck: DeploySyncCheckResult = await deps.checks.typecheck(liveCwd);
  const tests: DeploySyncCheckResult = typecheck.ok
    ? await deps.checks.tests(liveCwd)
    : { ok: false, detail: "لم تُشغَّل الاختبارات بعد فشل Typecheck." };
  const build: DeploySyncCheckResult =
    typecheck.ok && tests.ok
      ? await deps.checks.build(liveCwd)
      : { ok: false, detail: "لم يُشغَّل البناء بعد فشل الفحوص." };

  if (!typecheck.ok || !tests.ok || !build.ok) {
    const failed = !typecheck.ok ? typecheck : !tests.ok ? tests : build;
    const failedStage: DeployUploadStage =
      typecheck.ok && tests.ok ? "build" : "checks";
    const label = failedStage === "build" ? "فشل البناء في LIVE" : "فشل الفحص";
    try {
      await deps.runWithInput(["apply", "-R", "--3way", "--whitespace=nowarn", "-"], liveCwd, discovery.patch);
    } catch {
      // Best-effort reversal; the failure is reported below.
    }
    const message = `${label}: ${failed.detail}`;
    stages.push(stage(failedStage, "failed", message));
    return finalize({
      ok: false,
      pushed: false,
      skipped: false,
      commitSha: null,
      remoteSha: null,
      commitMessage: null,
      commitUrl: null,
      changeCount: 0,
      detail: message,
      failureLog: failed.log ?? null,
    });
  }
  stages.push(stage("checks", "ok", "نجح Typecheck والاختبارات."));
  stages.push(stage("build", "ok", "نجح بناء LIVE."));

  let commitSha: string;
  const commitTargets = discovery.prepared
    ? discovery.preparedPaths
    : discovery.approvedPaths;
  try {
    commitSha = await commitPaths(
      liveCwd,
      commitTargets,
      discovery.commitMessage,
      deps
    );
  } catch (error) {
    // No commit was created: reverse only a patch WE applied in this request.
    // In prepared mode there is no patch to reverse; the prepared worktree must
    // be preserved exactly as it is.
    if (!discovery.prepared) {
      try {
        await deps.runWithInput(["apply", "-R", "--3way", "--whitespace=nowarn", "-"], liveCwd, discovery.patch);
      } catch {
        // Best-effort reversal; the failure is reported below.
      }
    }
    const message = `فشل إنشاء Commit: ${
      error instanceof Error ? shortDetail(error.message) : "خطأ غير معروف"
    }`;
    stages.push(stage("commit", "failed", message));
    return finalize({
      ok: false,
      pushed: false,
      skipped: false,
      commitSha: null,
      remoteSha: null,
      commitMessage: discovery.commitMessage,
      commitUrl: null,
      changeCount: discovery.prepared
        ? discovery.preparedPaths.length
        : discovery.counts.total,
      detail: message,
    });
  }
  stages.push(stage("commit", "ok", `تم إنشاء Commit ${commitSha.slice(0, 7)}.`));

  const pushed = await pushAndVerify(liveCwd, branch, commitSha, deps);
  stages.push(stage("push", pushed.ok ? "ok" : "failed", pushed.detail));
  if (!pushed.ok) {
    return finalize({
      ok: false,
      pushed: false,
      skipped: false,
      commitSha,
      remoteSha: pushed.remoteSha,
      commitMessage: discovery.commitMessage,
      commitUrl: null,
      changeCount: discovery.prepared
        ? discovery.preparedPaths.length
        : discovery.counts.total,
      detail: pushed.detail,
    });
  }
  stages.push(stage("verify", "ok", pushed.detail));

  const remoteUrl = await deps
    .run(["config", "--get", "remote.origin.url"], liveCwd)
    .catch(() => "");
  return finalize({
    ok: true,
    pushed: true,
    skipped: false,
    commitSha,
    remoteSha: pushed.remoteSha,
    commitMessage: discovery.commitMessage,
    commitUrl: commitUrlFor(remoteUrl, commitSha),
    changeCount: discovery.prepared
      ? discovery.preparedPaths.length
      : discovery.counts.total,
    detail: discovery.prepared
      ? `تم استئناف مزامنة LIVE المُجهّزة (${discovery.preparedPaths.length} ملفًا) ورفعها إلى main.`
      : `تمت مزامنة ${discovery.counts.total} ملف برمجي معتمد إلى main.`,
  });
}
