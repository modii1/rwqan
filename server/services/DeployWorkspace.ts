import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  APPROVED_UPLOAD_BRANCH_LIVE,
  APPROVED_UPLOAD_BRANCH_TEST,
  getApprovedUploadBranch,
  type DeployEnvironment,
  type DeployWorkspaceInfo,
} from "../../shared/deploySystem";

/**
 * RWQAN DEPLOY — isolated per-environment Git worktrees.
 *
 * TEST and LIVE must NEVER share a working tree:
 *   - TEST => the existing checkout on `test/unified-gateway-ui-only`.
 *   - LIVE => a DEDICATED worktree on `main`.
 *
 * This is what prevents uncommitted TEST changes from ever being visible to the
 * LIVE upload flow. The resolver never switches the current branch, never
 * resets, cleans, stashes, merges, or rebases. When LIVE has no worktree yet it
 * creates one in a SIBLING directory (outside the TEST checkout) with
 * `git worktree add <path> main` — a non-destructive operation.
 */

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 15_000;
const GIT_MAX_BUFFER = 1024 * 1024 * 16;

export interface DeployWorkspaceDependencies {
  run(args: string[], cwd: string): Promise<string>;
  worktreeAdd(worktreePath: string, branch: string, cwd: string): Promise<string>;
}

const DEFAULT_DEPENDENCIES: DeployWorkspaceDependencies = {
  run: async (args, cwd) =>
    (
      await execFileAsync("git", args, {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: GIT_MAX_BUFFER,
      })
    ).stdout.trim(),
  worktreeAdd: async (worktreePath, branch, cwd) =>
    (
      await execFileAsync("git", ["worktree", "add", worktreePath, branch], {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: GIT_MAX_BUFFER,
      })
    ).stdout.trim(),
};

export interface ResolveDeployWorkspaceOptions {
  environment: DeployEnvironment;
  /** Repository root where `git worktree list` is run. Defaults to cwd. */
  repoRoot?: string;
  /** Optional explicit LIVE worktree path. Defaults to a sibling directory. */
  liveWorktreePath?: string;
  /**
   * Allow creating a missing LIVE worktree. Defaults to FALSE: no folder is
   * ever created without explicit approval. An existing valid worktree on
   * `main` is always used without creating anything.
   */
  createLiveWorktree?: boolean;
  dependencies?: DeployWorkspaceDependencies;
}

export interface ParsedWorktree {
  path: string;
  branch: string | null;
}

/** Parse `git worktree list --porcelain` into path/branch entries. */
export function parseWorktreeList(output: string): ParsedWorktree[] {
  const entries: ParsedWorktree[] = [];
  let current: ParsedWorktree | null = null;
  for (const rawLine of (output ?? "").split(/\r?\n/)) {
    if (rawLine.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: rawLine.slice("worktree ".length).trim(), branch: null };
    } else if (rawLine.startsWith("branch ") && current) {
      current.branch = rawLine.slice("branch ".length).trim();
    }
  }
  if (current) entries.push(current);
  return entries.filter((entry) => entry.path.length > 0);
}

function defaultLiveWorktreePath(repoRoot: string): string {
  const explicit = process.env.DEPLOY_LIVE_WORKTREE?.trim();
  if (explicit) return path.resolve(explicit);
  return path.resolve(
    repoRoot,
    "..",
    `${path.basename(repoRoot)}-live`
  );
}

function assertOutsideRepo(worktreePath: string, repoRoot: string): void {
  const resolved = path.resolve(worktreePath);
  const root = path.resolve(repoRoot);
  if (resolved === root || resolved.startsWith(root + path.sep)) {
    throw new Error(
      "مسار مساحة LIVE يجب أن يكون خارج مستودع TEST — لا يُسمح بمشاركة شجرة العمل."
    );
  }
}

async function currentBranchOf(
  worktreePath: string,
  deps: DeployWorkspaceDependencies
): Promise<string> {
  return deps.run(["rev-parse", "--abbrev-ref", "HEAD"], worktreePath);
}

function workspaceInfo(
  environment: DeployEnvironment,
  branch: string,
  worktreePath: string,
  created: boolean
): DeployWorkspaceInfo {
  return {
    environment,
    branch,
    path: path.resolve(worktreePath),
    label:
      environment === "LIVE"
        ? "مساحة LIVE المستقلة (main)"
        : "مساحة TEST (test/unified-gateway-ui-only)",
    created,
  };
}

/**
 * Resolve the dedicated workspace for an environment.
 *
 * - TEST: uses the existing worktree checked out on the TEST branch. It never
 *   creates a new TEST worktree (that would be empty and hide the user's work).
 * - LIVE: uses an existing `main` worktree when present; otherwise creates one
 *   in a sibling directory. The current TEST checkout is never switched.
 */
export async function resolveDeployWorkspace(
  options: ResolveDeployWorkspaceOptions
): Promise<DeployWorkspaceInfo> {
  const environment = options.environment;
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const deps = options.dependencies ?? DEFAULT_DEPENDENCIES;
  const targetBranch = getApprovedUploadBranch(environment);

  if (!targetBranch) {
    throw new Error(`لا يوجد فرع معتمد لبيئة ${environment}.`);
  }

  const worktrees = parseWorktreeList(
    await deps.run(["worktree", "list", "--porcelain"], repoRoot)
  );
  const existing = worktrees.find(
    (entry) => entry.branch === `refs/heads/${targetBranch}`
  );

  if (existing) {
    const branch = await currentBranchOf(existing.path, deps);
    if (branch !== targetBranch) {
      throw new Error(
        `مساحة ${environment} موجودة لكنها على الفرع ${branch} بدل ${targetBranch}.`
      );
    }
    return workspaceInfo(environment, targetBranch, existing.path, false);
  }

  // TEST must already exist. Creating an empty TEST worktree would hide the
  // 52+ uncommitted changes that live in the user's current checkout.
  if (environment === "TEST") {
    throw new Error(
      `لا توجد مساحة عمل TEST على الفرع ${APPROVED_UPLOAD_BRANCH_TEST}. ` +
        "لن يتم إنشاء نسخة جديدة لتجنب فقدان تغييراتك — تحقق من الفرع يدويًا."
    );
  }

  const livePath = path.resolve(
    options.liveWorktreePath ?? defaultLiveWorktreePath(repoRoot)
  );
  assertOutsideRepo(livePath, repoRoot);

  if (existsSync(livePath)) {
    // Never delete or reuse an unknown directory. It must already be a valid
    // worktree on the LIVE branch, otherwise fail closed.
    let branch = "";
    try {
      branch = await currentBranchOf(livePath, deps);
    } catch {
      throw new Error(
        `المسار ${livePath} موجود ولكنه ليس Worktree صالحًا — لن يتم حذفه أو استبداله.`
      );
    }
    if (branch !== targetBranch) {
      throw new Error(
        `مساحة LIVE الموجودة على ${livePath} تستخدم الفرع ${branch} بدل ${targetBranch}.`
      );
    }
    return workspaceInfo(environment, targetBranch, livePath, false);
  }

  if (options.createLiveWorktree !== true) {
    // DEFAULT: never create a new folder automatically. Explain exactly what
    // is required and let the operator decide.
    throw new Error(
      "لا توجد مساحة عمل LIVE مستقلة على الفرع main. لم يُنشأ أي مجلد تلقائيًا. " +
        "أنشئ Worktree يدويًا بالأمر `git worktree add <path> main` " +
        "ثم اضبط DEPLOY_LIVE_WORKTREE=<path> — التطبيق لا ينشئ مجلدات تلقائيًا."
    );
  }

  mkdirSync(path.dirname(livePath), { recursive: true });
  await deps.worktreeAdd(livePath, targetBranch, repoRoot);
  const branch = await currentBranchOf(livePath, deps);
  if (branch !== targetBranch) {
    throw new Error(
      `تم إنشاء مساحة LIVE لكن الفرع الحالي ${branch} لا يطابق ${targetBranch}.`
    );
  }
  return workspaceInfo(environment, targetBranch, livePath, true);
}

export {
  APPROVED_UPLOAD_BRANCH_TEST,
  APPROVED_UPLOAD_BRANCH_LIVE,
};
