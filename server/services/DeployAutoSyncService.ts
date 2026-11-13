import { exec, execFile, spawn, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
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
 *   (no secrets, env config, docs, reports, artifacts) -> classify every file
 *   against the LAST SUCCESSFUL SYNC (recorded as a `Sync-Test-SHA:` trailer on
 *   the LIVE sync commit, never the raw fork point) -> transfer TEST-only
 *   files, auto-merge non-overlapping edits, and leave only real same-line
 *   overlaps for review -> run typecheck + tests + build -> commit on main ->
 *   push -> verify.
 *
 * Why it never re-conflicts:
 *   - the three-way base is the last synced TEST commit, not `merge-base`;
 *   - BOM and CRLF/LF differences are canonicalised, so they are never changes;
 *   - safe files are always transferred, even when another file needs review;
 *   - only a genuine overlap of the same lines is reported as a conflict.
 *
 * Hard rules:
 *   - Never creates worktrees/folders.
 *   - Never force-pushes, resets, cleans, stashes, merges, or rebases.
 *   - Never moves uncommitted TEST changes to LIVE.
 *   - Never touches the TEST working tree during a LIVE sync.
 *   - On a failed check/commit, restores only the files it wrote.
 */

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const GIT_TIMEOUT_MS = 20_000;
const GIT_MAX_BUFFER = 1024 * 1024 * 64;
const CHECK_TIMEOUT_MS = 10 * 60_000;
const BUILD_TIMEOUT_MS = 20 * 60_000;

/**
 * Trailer written into LIVE sync commits. It is the ONLY place the sync
 * remembers its baseline: no ledger file, no extra branch, no extra ref.
 */
const SYNC_BASELINE_TRAILER = "Sync-Test-SHA";

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
  writeTextFile(absolutePath: string, content: string): Promise<void>;
  /** Remove a file this request created (used only when rolling back). */
  deleteFile(absolutePath: string): Promise<void>;
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
      return await readFile(absolutePath, "utf8");
    } catch {
      return null;
    }
  },
  writeTextFile: async (absolutePath, content) => {
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  },
  deleteFile: async (absolutePath) => {
    // `git rm` only works on tracked paths, so newly created files must be
    // removed from the filesystem directly. `force` makes a missing file a no-op.
    await rm(absolutePath, { force: true });
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
  counts: DeployUploadChangeCounts,
  syncedTestSha: string | null = null
): string {
  const parts: string[] = [];
  if (counts.modified > 0) parts.push(`${counts.modified} معدّل`);
  if (counts.added > 0) parts.push(`${counts.added} جديد`);
  if (counts.deleted > 0) parts.push(`${counts.deleted} محذوف`);
  if (counts.renamed > 0) parts.push(`${counts.renamed} معاد تسميته`);
  const summary = `sync(${environment}): ${counts.total} ملف${
    parts.length > 0 ? ` — ${parts.join("، ")}` : ""
  }`;
  // The trailer is the durable "last successful sync" reference. It is written
  // only when the whole TEST delta was transferred (no leftover conflicts).
  return syncedTestSha
    ? `${summary}\n\n${SYNC_BASELINE_TRAILER}: ${syncedTestSha}`
    : summary;
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

/**
 * Canonical text used for ALL sync comparisons and writes.
 *
 * BOM and CRLF/CR differences are environmental noise, not code changes, so
 * they must never produce a conflict. Writes use this form (LF, no BOM) so the
 * LIVE tree stays stable across repeated syncs.
 */
function canonicalContent(value: string): string {
  return normalizeText(value).replace(/\r/g, "\n");
}

function isBinaryContent(value: string): boolean {
  return value.includes("\0");
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
  return mergeThreeWay(current, baseContent, testContent).conflict;
}

interface ThreeWayMerge {
  conflict: boolean;
  content: string;
}

/**
 * Real three-way merge on canonical text (BOM stripped, CRLF/CR compared as LF).
 * Returns conflict-marked content for review; the caller MUST NOT write it.
 */
function mergeThreeWay(
  current: string,
  baseContent: string,
  testContent: string
): ThreeWayMerge {
  const dir = mkdtempSync(path.join(tmpdir(), "rwqan-sync-merge-"));
  try {
    const baseFile = path.join(dir, "base");
    const currentFile = path.join(dir, "current");
    const testFile = path.join(dir, "test");
    writeFileSync(baseFile, canonicalContent(baseContent), "utf8");
    writeFileSync(currentFile, canonicalContent(current), "utf8");
    writeFileSync(testFile, canonicalContent(testContent), "utf8");
    const merged = spawnSync(
      "git",
      ["merge-file", "-p", "--diff3", currentFile, baseFile, testFile],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
    const content = merged.stdout ?? "";
    return {
      conflict: merged.status !== 0 || /^<<<<<<< /m.test(content),
      content,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── sync baseline (last successful TEST→LIVE sync) ───────────────────────────

type SyncBaselineSource = "trailer" | "last-sync" | "merge-base";

interface SyncBaseline {
  baseSha: string;
  source: SyncBaselineSource;
  warning: string | null;
}

/**
 * Resolve the three-way base: the state whose content LIVE already contains.
 *
 * 1. newest LIVE commit carrying `Sync-Test-SHA:` (exact TEST commit)
 * 2. newest LIVE `sync(LIVE):` commit (its tree IS the last exported TEST state)
 * 3. `git merge-base main TEST` with an explicit warning
 *
 * Options 1 and 2 are content-equivalent for synced files. Neither is a new
 * file, branch, ref or ledger: they are already in the repository history.
 */
async function resolveLiveBaseline(
  liveCwd: string,
  testCwd: string,
  liveBranch: string,
  testBranch: string,
  deps: DeployAutoSyncDependencies
): Promise<SyncBaseline> {
  const log = await deps
    .run(["log", "-n", "80", "--format=%H%x1f%B%x1e"], liveCwd)
    .catch(() => "");
  // A commit that was not pushed yet must not advance the baseline.
  const remoteRef = `origin/${liveBranch}`;
  const hasRemoteRef = await deps
    .run(["rev-parse", "--verify", remoteRef], liveCwd)
    .then(() => true)
    .catch(() => false);

  let lastSyncCommit: string | null = null;
  const chunks = log.split("\x1e");
  for (const chunk of chunks) {
    const separator = chunk.indexOf("\x1f");
    if (separator < 0) continue;
    const syncCommitSha = chunk.slice(0, separator).trim();
    const message = chunk.slice(separator + 1);
    const match = message.match(
      new RegExp(`^${SYNC_BASELINE_TRAILER}:\\s*([0-9a-f]{40})\\s*$`, "m")
    );
    if (!match) continue;
    const candidate = match[1];
    const exists = await deps
      .run(["cat-file", "-e", `${candidate}^{commit}`], testCwd)
      .then(() => true)
      .catch(() => false);
    if (!exists) continue;
    const isAncestor = await deps
      .run(["merge-base", "--is-ancestor", candidate, testBranch], testCwd)
      .then(() => true)
      .catch(() => false);
    if (!isAncestor) continue;
    if (hasRemoteRef && syncCommitSha) {
      // Verify the LIVE commit that CARRIES the trailer was pushed. The trailer
      // itself points at a TEST commit, which is never an ancestor of main.
      const pushed = await deps
        .run(["merge-base", "--is-ancestor", syncCommitSha, remoteRef], liveCwd)
        .then(() => true)
        .catch(() => false);
      if (!pushed) continue;
    }
    return { baseSha: candidate, source: "trailer", warning: null };
  }

  for (const chunk of chunks) {
    const separator = chunk.indexOf("\x1f");
    if (separator < 0) continue;
    const sha = chunk.slice(0, separator).trim();
    const subject = chunk.slice(separator + 1).split("\n")[0] ?? "";
    if (!/^sync\(LIVE\):/.test(subject)) continue;
    if (!sha) continue;
    if (hasRemoteRef) {
      const pushed = await deps
        .run(["merge-base", "--is-ancestor", sha, remoteRef], liveCwd)
        .then(() => true)
        .catch(() => false);
      if (!pushed) continue;
    }
    lastSyncCommit = sha;
    break;
  }
  if (lastSyncCommit) {
    return {
      baseSha: lastSyncCommit,
      source: "last-sync",
      warning:
        "لم يُسجَّل مرجع TEST السابق في commit المزامنة — استُخدم آخر commit مزامنة في LIVE كأساس (مكافئ للمحتوى المُصدَّر).",
    };
  }

  const fallback = await deps.run(["merge-base", liveBranch, testBranch], liveCwd);
  return {
    baseSha: fallback,
    source: "merge-base",
    warning:
      "لا يوجد مرجع مزامنة سابق — استُخدم merge-base كأساس تقريبي، والتغييرات الآمنة تُصنّف بقواعد الاحتواء.",
  };
}

// ── per-file sync plan ───────────────────────────────────────────────────────

/**
 * LIVE-only security invariants that a TEST transfer must never silently drop.
 * If LIVE currently enforces one and TEST does not, the file needs a human
 * decision instead of an automatic transfer.
 */
const PROTECTED_LIVE_MARKERS: Array<{
  file: string;
  marker: string;
  label: string;
}> = [
  {
    file: "server/services/DeployPrepublishGate.ts",
    marker: "DEPLOY_ALLOW_PRODUCTION",
    label: "شرط DEPLOY_ALLOW_PRODUCTION للنشر الإنتاجي",
  },
  {
    file: "server/services/DeployGhWorkflowService.ts",
    marker: "HARD SEPARATION",
    label: "فصل وجهة LIVE الثابتة",
  },
];

function protectedInvariantLost(
  file: string,
  liveText: string,
  testText: string
): string | null {
  for (const entry of PROTECTED_LIVE_MARKERS) {
    if (entry.file !== file) continue;
    if (liveText.includes(entry.marker) && !testText.includes(entry.marker)) {
      return entry.label;
    }
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Named relative imports/re-exports that must resolve for the file to compile.
 *
 * Uses the TypeScript AST (not regex) so string literals, comments and test
 * fixtures like `'import { x } from "../y"'` are never mistaken for real
 * imports. If TypeScript is unavailable the gate is skipped and the LIVE
 * typecheck + rollback still protect the operation.
 */
async function parseModuleDependencies(
  source: string,
  fileName: string
): Promise<Array<{ module: string; names: string[] }>> {
  try {
    const ts = await import("typescript");
    const sourceFile = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    const found: Array<{ module: string; names: string[] }> = [];
    const visit = (node: import("typescript").Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          const names = bindings.elements.map(
            (element) => (element.propertyName ?? element.name).text
          );
          if (names.length > 0) {
            found.push({ module: node.moduleSpecifier.text, names });
          }
        }
      } else if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.exportClause &&
        ts.isNamedExports(node.exportClause)
      ) {
        const names = node.exportClause.elements.map(
          (element) => (element.propertyName ?? element.name).text
        );
        if (names.length > 0) {
          found.push({ module: node.moduleSpecifier.text, names });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return found;
  } catch {
    return [];
  }
}

/**
 * Static dependency gate.
 *
 * Requirement: never move a file whose imports cannot resolve on the LIVE tree.
 * The most common case is a new export added to an EXCLUDED folder
 * (`server/config/`), which is never synced. Without this gate the transfer
 * only fails later, inside the LIVE typecheck.
 *
 * Rules (conservative to avoid false blocks):
 *  - Only relative imports/re-exports are inspected.
 *  - A module that is part of the same transfer is always accepted.
 *  - An existing LIVE module is accepted unless a named export is provably
 *    absent (`export * from` counts as "cannot prove absence" → accepted).
 *  - A missing module is rejected unless it looks like a non-code asset.
 */
const DEPENDENCY_ASSET_EXTENSION =
  /\.(css|scss|sass|less|json|svg|png|jpe?g|webp|gif|ico|woff2?|ttf|eot|otf|md|txt|ya?ml|html)$/i;

function exportNamePattern(name: string): RegExp {
  const escaped = escapeRegExp(name);
  return new RegExp(
    String.raw`export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+${escaped}\b|export\s*\{[^}]*\b${escaped}\b`
  );
}


type SyncActionKind = "transfer" | "auto-merge" | "conflict";

interface SyncPlanAction {
  path: string;
  kind: SyncActionKind;
  /** Human-readable Arabic reason, safe to expose to the admin. */
  reason: string;
  /** Exact content to write (canonical LF). Absent for conflicts. */
  content?: string;
}

interface LivePlan {
  baseline: SyncBaseline;
  actions: SyncPlanAction[];
  transferPaths: string[];
  mergePaths: string[];
  conflictPaths: string[];
  noopPaths: string[];
}

/**
 * Classify every approved TEST change against LIVE's current content.
 *
 * Safety invariant: no line that exists only in LIVE is ever discarded.
 *  - BOM/CRLF are canonicalised, so they can never be a "change".
 *  - If TEST's lines are all present in LIVE, TEST is already there -> no-op.
 *  - If LIVE's lines are all present in TEST, LIVE has nothing unique -> safe.
 *  - Anything else is a real three-way merge; only overlapping hunks conflict.
 */
async function buildLivePlan(params: {
  testWorkspace: DeployWorkspaceInfo;
  liveWorkspace: DeployWorkspaceInfo;
  testBranch: string;
  baseSha: string;
  forkBaseSha: string;
  baseline: SyncBaseline;
  entries: NameStatusEntry[];
  deps: DeployAutoSyncDependencies;
}): Promise<LivePlan> {
  const {
    testWorkspace,
    liveWorkspace,
    testBranch,
    baseSha,
    forkBaseSha,
    baseline,
    entries,
    deps,
  } = params;
  const actions: SyncPlanAction[] = [];
  const transferPaths: string[] = [];
  const mergePaths: string[] = [];
  const conflictPaths: string[] = [];
  const noopPaths: string[] = [];

  for (const entry of entries) {
    const file = entry.displayPath;

    if (entry.kind === "deleted") {
      const liveContent = await deps.readTextFile(path.join(liveWorkspace.path, file));
      // A file that never existed on TEST is a LIVE-only file, not a deletion.
      const existedOnTest = await deps
        .run(["cat-file", "-e", `${forkBaseSha}:${file}`], testWorkspace.path)
        .then(() => true)
        .catch(() => false);
      if (!existedOnTest || liveContent === null) {
        noopPaths.push(file);
        continue;
      }
      actions.push({
        path: file,
        kind: "conflict",
        reason: "حذف ملف في TEST — يتطلب موافقة صريحة قبل حذفه من LIVE.",
      });
      conflictPaths.push(file);
      continue;
    }
    if (entry.kind === "renamed") {
      actions.push({
        path: file,
        kind: "conflict",
        reason: "إعادة تسمية/نقل ملف — يتطلب مراجعة يدوية.",
      });
      conflictPaths.push(file);
      continue;
    }

    const testContent = await deps
      .showFile(testBranch, file, testWorkspace.path)
      .catch(() => null);
    if (testContent === null) {
      actions.push({
        path: file,
        kind: "conflict",
        reason: "تعذّرت قراءة محتوى TEST.",
      });
      conflictPaths.push(file);
      continue;
    }
    const baseContent = await deps
      .showFile(baseSha, file, testWorkspace.path)
      .catch(() => null);
    const liveContent = await deps.readTextFile(path.join(liveWorkspace.path, file));

    if (isBinaryContent(testContent) || (liveContent && isBinaryContent(liveContent))) {
      actions.push({
        path: file,
        kind: "conflict",
        reason: "ملف ثنائي — لا يمكن دمجه تلقائيًا.",
      });
      conflictPaths.push(file);
      continue;
    }

    const testText = canonicalContent(testContent);
    const liveText = liveContent === null ? null : canonicalContent(liveContent);
    const baseText = baseContent === null ? null : canonicalContent(baseContent);

    // 1) LIVE is already identical to TEST (line endings/BOM ignored).
    if (liveText !== null && liveText === testText) {
      noopPaths.push(file);
      continue;
    }
    // 2) Every TEST line is already in LIVE: TEST is already transferred.
    if (liveText !== null && containsAllLines(liveText, testText)) {
      noopPaths.push(file);
      continue;
    }
    // 3) TEST never touched this file since the baseline: LIVE owns it.
    if (baseText !== null && baseText === testText) {
      noopPaths.push(file);
      continue;
    }
    // 4) New file on TEST.
    if (liveText === null && baseText === null) {
      actions.push({
        path: file,
        kind: "transfer",
        reason: "ملف جديد في TEST — يُنقل كما هو.",
        content: testContent,
      });
      transferPaths.push(file);
      continue;
    }
    // 5) LIVE deleted a file TEST still has: never recreate silently.
    if (liveText === null) {
      actions.push({
        path: file,
        kind: "conflict",
        reason: "الملف محذوف في LIVE — لن يُعاد إنشاؤه دون قرار صريح.",
      });
      conflictPaths.push(file);
      continue;
    }
    // 6) Added on both sides with different content.
    if (baseText === null) {
      actions.push({
        path: file,
        kind: "conflict",
        reason: "أُضيف الملف في TEST وLIVE بمحتوى مختلف — يحتاج قرارًا.",
      });
      conflictPaths.push(file);
      continue;
    }
    // 7) Every LIVE line is still present in TEST: nothing LIVE-specific is lost.
    if (containsAllLines(testText, liveText)) {
      const lostInvariant = protectedInvariantLost(file, liveText, testText);
      if (lostInvariant) {
        actions.push({
          path: file,
          kind: "conflict",
          reason: `نقل TEST سيزيل ${lostInvariant} الموجود في LIVE — يتطلب موافقة صريحة.`,
        });
        conflictPaths.push(file);
        continue;
      }
      actions.push({
        path: file,
        kind: "transfer",
        reason: "TEST فقط تغيّر — نقل آمن دون لمس أي تغيير في LIVE.",
        content: testContent,
      });
      transferPaths.push(file);
      continue;
    }
    // 8) LIVE is byte-identical to the baseline: a clean transfer.
    if (liveText === baseText) {
      const lostInvariant = protectedInvariantLost(file, liveText, testText);
      if (lostInvariant) {
        actions.push({
          path: file,
          kind: "conflict",
          reason: `نقل TEST سيزيل ${lostInvariant} الموجود في LIVE — يتطلب موافقة صريحة.`,
        });
        conflictPaths.push(file);
        continue;
      }
      actions.push({
        path: file,
        kind: "transfer",
        reason: "TEST فقط تغيّر — نقل آمن دون لمس أي تغيير في LIVE.",
        content: testContent,
      });
      transferPaths.push(file);
      continue;
    }

    // 9) Both sides changed: attempt a real three-way merge.
    const merged = mergeThreeWay(liveText, baseText, testText);
    if (merged.conflict) {
      actions.push({
        path: file,
        kind: "conflict",
        reason:
          "TEST وLIVE غيّرا الأسطر نفسها — تعارض حقيقي يحتاج قرارًا (لن يُلمس الملف).",
      });
      conflictPaths.push(file);
      continue;
    }
    actions.push({
      path: file,
      kind: "auto-merge",
      reason: "تعديلات متباعدة في الملف نفسه — تُدمج تلقائيًا مع الحفاظ على تعديلات LIVE.",
      content: merged.content,
    });
    mergePaths.push(file);
  }

  // ── dependency gate (before anything is allowed to move) ──────────────────
  const providedByPlan = new Set(
    actions
      .filter((action) => action.content !== undefined)
      .map((action) => action.path)
  );
  const liveContentCache = new Map<string, string | null>();
  const readLiveContent = async (filePath: string): Promise<string | null> => {
    if (!liveContentCache.has(filePath)) {
      liveContentCache.set(
        filePath,
        await deps.readTextFile(path.join(liveWorkspace.path, filePath))
      );
    }
    return liveContentCache.get(filePath) ?? null;
  };

  for (const action of actions) {
    if (action.kind === "conflict" || action.content === undefined) continue;
    const issues: string[] = [];
    for (const dependency of await parseModuleDependencies(
      action.content,
      action.path
    )) {
      if (!dependency.module.startsWith(".")) continue;
      if (dependency.module.includes("?")) continue;
      const base = path.posix.normalize(
        path.posix.join(path.posix.dirname(action.path), dependency.module)
      );
      const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}/index.ts`,
        `${base}/index.tsx`,
      ];
      let resolved: string | null = null;
      let suppliedByPlan = false;
      for (const candidate of candidates) {
        if (providedByPlan.has(candidate)) {
          suppliedByPlan = true;
          resolved = candidate;
          break;
        }
        if ((await readLiveContent(candidate)) !== null) {
          resolved = candidate;
          break;
        }
      }
      if (suppliedByPlan) continue;
      if (!resolved) {
        const looksLikeCode =
          !DEPENDENCY_ASSET_EXTENSION.test(dependency.module) &&
          !/\.(js|mjs|cjs)$/i.test(dependency.module);
        if (looksLikeCode) {
          issues.push(`${dependency.module} (الوحدة غير موجودة في LIVE)`);
        }
        continue;
      }
      const liveContent = await readLiveContent(resolved);
      if (liveContent === null) {
        issues.push(`${dependency.module} (الوحدة غير موجودة في LIVE)`);
        continue;
      }
      // Cannot prove absence when the module re-exports everything.
      if (/export\s+\*\s+from/.test(liveContent)) continue;
      for (const name of dependency.names) {
        if (!exportNamePattern(name).test(liveContent)) {
          issues.push(`${name} من ${dependency.module}`);
        }
      }
    }
    if (issues.length > 0) {
      action.kind = "conflict";
      action.content = undefined;
      action.reason = `اعتماديات غير متوفرة في LIVE: ${issues
        .slice(0, 3)
        .join("، ")}${issues.length > 3 ? "…" : ""} — لن يُنقل لتفادي فشل الفحص.`;
    }
  }

  // Rebuild the per-kind lists after the gate.
  transferPaths.length = 0;
  mergePaths.length = 0;
  conflictPaths.length = 0;
  for (const action of actions) {
    if (action.kind === "transfer") transferPaths.push(action.path);
    else if (action.kind === "auto-merge") mergePaths.push(action.path);
    else if (action.kind === "conflict") conflictPaths.push(action.path);
  }

  return {
    baseline,
    actions,
    transferPaths,
    mergePaths,
    conflictPaths,
    noopPaths,
  };
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
  baselineSource: SyncBaselineSource;
  baselineWarning: string | null;
  approvedEntries: NameStatusEntry[];
  approvedPaths: string[];
  excludedCount: number;
  counts: DeployUploadChangeCounts;
  actions: SyncPlanAction[];
  conflictPaths: string[];
  noopPaths: string[];
  /** TRUE when every TEST change was transferred/merged with no leftover conflict. */
  fullSync: boolean;
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
    baselineSource: "merge-base",
    baselineWarning: null,
    approvedEntries: [],
    approvedPaths: [],
    excludedCount: 0,
    counts: countsForEntries([]),
    actions: [],
    conflictPaths: [],
    noopPaths: [],
    fullSync: false,
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
  // Base = the TEST commit LIVE already contains (recorded by the previous
  // successful sync commit), never the raw fork point.
  const baseline = await resolveLiveBaseline(
    liveCwd,
    testCwd,
    liveBranch,
    testBranch,
    deps
  );
  const baseSha = baseline.baseSha;
  // Always available (and always an ancestor of TEST) — used only to tell a
  // TEST deletion apart from a file that never existed on TEST.
  const forkBaseSha = await deps.run(
    ["merge-base", liveBranch, testBranch],
    liveCwd
  );

  const nameStatus = await deps.run(
    ["diff", "--name-status", `${baseSha}..${testBranch}`],
    testCwd
  );
  const entries = parseNameStatus(nameStatus);
  const approvedEntries = entries.filter((entry) =>
    entry.paths.every((filePath) => isApprovedLiveSyncPath(filePath))
  );
  const excludedCount = entries.length - approvedEntries.length;

  if (approvedEntries.length === 0) {
    return {
      ...empty,
      testSha,
      liveHead,
      baseSha,
      baselineSource: baseline.source,
      baselineWarning: baseline.warning,
      excludedCount,
      blockedReason:
        baseline.source === "trailer"
          ? "لا توجد تحديثات جديدة منذ آخر مزامنة ناجحة."
          : "لا توجد تحديثات برمجية معتمدة على TEST تستحق النقل إلى LIVE.",
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
        baselineSource: baseline.source,
        baselineWarning: baseline.warning,
        counts: prepared.counts,
        blockedReason: prepared.blockedReason,
      };
    }
    return {
      ...empty,
      testSha,
      liveHead,
      baseSha,
      baselineSource: baseline.source,
      baselineWarning: baseline.warning,
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
      baselineSource: baseline.source,
      baselineWarning: baseline.warning,
      approvedEntries,
      excludedCount,
      counts: countsForEntries(approvedEntries),
      blockedReason:
        "مساحة LIVE لا تحتوي على node_modules — لن يتم تثبيتها تلقائيًا. ثبّت التبعيات في مساحة LIVE يدويًا ثم أعد المحاولة.",
    };
  }

  // Per-file, change-based plan. Line-ending/BOM noise is canonicalised away,
  // so only a genuine overlap in the same lines can be reported as a conflict.
  const plan = await buildLivePlan({
    testWorkspace,
    liveWorkspace,
    testBranch,
    baseSha,
    forkBaseSha,
    baseline,
    entries: approvedEntries,
    deps,
  });

  const plannedPaths = new Set([
    ...plan.transferPaths,
    ...plan.mergePaths,
  ]);
  const approvedPaths = Array.from(plannedPaths);
  const actionableEntries = approvedEntries.filter((entry) =>
    plannedPaths.has(entry.displayPath)
  );
  const counts = countsForEntries(actionableEntries);
  const fullSync = plan.conflictPaths.length === 0;

  if (approvedPaths.length === 0) {
    const conflicts = plan.actions.filter((action) => action.kind === "conflict");
    return {
      ...empty,
      testSha,
      liveHead,
      baseSha,
      baselineSource: baseline.source,
      baselineWarning: baseline.warning,
      approvedEntries,
      excludedCount,
      counts: countsForEntries(approvedEntries),
      actions: plan.actions,
      conflictPaths: plan.conflictPaths,
      noopPaths: plan.noopPaths,
      blockedReason:
        conflicts.length > 0
          ? `تعارض حقيقي في ${conflicts.length} ملف — يحتاج قرارًا قبل النقل: ${conflicts
              .slice(0, 6)
              .map((action) => action.path)
              .join(", ")}${conflicts.length > 6 ? "…" : ""}`
          : "لا توجد تحديثات جديدة منذ آخر مزامنة ناجحة.",
    };
  }

  const contentHashes = plan.actions
    .filter((action) => action.kind !== "conflict")
    .map((action) => `${action.path}:${hash(action.content ?? "")}`)
    .sort()
    .join("\n");
  const token = hash(
    `${testSha}:${liveHead}:${baseSha}:${approvedPaths
      .slice()
      .sort()
      .join("\n")}:${contentHashes}`
  );

  return {
    testSha,
    liveHead,
    baseSha,
    baselineSource: baseline.source,
    baselineWarning: baseline.warning,
    approvedEntries,
    approvedPaths,
    excludedCount,
    counts,
    actions: plan.actions,
    conflictPaths: plan.conflictPaths,
    noopPaths: plan.noopPaths,
    fullSync,
    token,
    prepared: false,
    preparedPaths: [],
    preparedApprovedPaths: [],
    preparedSupportingPaths: [],
    commitMessage: buildSyncMessage("LIVE", counts, fullSync ? testSha : null),
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
  const conflicts = discovery.actions
    .filter((action) => action.kind === "conflict")
    .map((action) => ({ path: action.path, reason: action.reason }));
  return {
    environment: "LIVE",
    branch: getApprovedUploadBranch("LIVE") ?? "",
    workspace: input.liveWorkspace,
    approvedCount: discovery.prepared
      ? discovery.preparedApprovedPaths.length
      : discovery.approvedPaths.length,
    counts: discovery.counts,
    commitMessage: discovery.commitMessage,
    canSync: discovery.blockedReason === null,
    blockedReason: discovery.blockedReason,
    detail:
      discovery.blockedReason ??
      (discovery.prepared
        ? `تم العثور على مزامنة سابقة مُجهّزة (${discovery.preparedPaths.length} ملفًا) — سيتم استئنافها دون إعادة تطبيق.`
        : conflicts.length > 0
          ? `سيُنقل ${discovery.counts.total} ملف، و${conflicts.length} ملف يحتاج مراجعة (لن يتوقف نقل الباقي).`
          : `${discovery.counts.total} ملف برمجي معتمد من TEST (استُثني ${discovery.excludedCount}).`),
    prepared: discovery.prepared,
    preparedCount: discovery.prepared ? discovery.preparedPaths.length : 0,
    token: discovery.token,
    baseSha: discovery.baseSha,
    baseSource: discovery.baselineSource,
    baseWarning: discovery.baselineWarning,
    files: discovery.approvedPaths,
    conflicts,
    partial: !discovery.fullSync,
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
        : discovery.conflictPaths.length > 0
          ? `${discovery.counts.total} ملف جاهز للنقل، و${discovery.conflictPaths.length} ملف يحتاج مراجعة (لن يتوقف الباقي).`
          : `${discovery.counts.total} ملف برمجي معتمد من TEST.`
    )
  );

  // Files we wrote in this request, with their exact previous content so a
  // failed check/commit restores LIVE byte-for-byte (no reset/checkout/stash).
  // `null` means the file did not exist before, so rollback deletes it.
  const backups = new Map<string, string | null>();
  const restoreBackups = async () => {
    for (const [file, previous] of backups) {
      const absolute = path.join(liveCwd, file);
      try {
        if (previous === null) {
          // Untracked/new files cannot be reverted with git; remove them.
          await deps.deleteFile(absolute);
        } else {
          await deps.writeTextFile(absolute, previous);
        }
      } catch {
        // Best-effort restoration; the original failure is reported.
      }
    }
    backups.clear();
  };

  if (!discovery.prepared) {
    try {
      for (const action of discovery.actions) {
        if (action.kind === "conflict" || action.content === undefined) continue;
        const absolute = path.join(liveCwd, action.path);
        backups.set(
          action.path,
          await deps.readTextFile(absolute).catch(() => null)
        );
        await deps.writeTextFile(absolute, action.content);
      }
    } catch (error) {
      await restoreBackups();
      const message = `تعذّر كتابة ملفات المزامنة في LIVE: ${
        error instanceof Error ? shortDetail(error.message) : "خطأ غير معروف"
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

  // All checks run against the UPDATED LIVE working tree.
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
    await restoreBackups();
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
    // No commit was created: restore every file we wrote in this request.
    // In prepared mode the worktree belongs to the previous attempt and must
    // be preserved exactly as it is.
    if (!discovery.prepared) {
      await restoreBackups();
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
      : discovery.conflictPaths.length > 0
        ? `تمت مزامنة ${discovery.counts.total} ملف آمن إلى main. لم يُنقل ${discovery.conflictPaths.length} ملف لتعارض حقيقي: ${discovery.conflictPaths
            .slice(0, 5)
            .join(", ")}${discovery.conflictPaths.length > 5 ? "…" : ""}.`
        : `تمت مزامنة ${discovery.counts.total} ملف برمجي معتمد إلى main.`,
  });
}
