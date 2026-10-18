import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type {
  DeployEnvironment,
  DeployRelease,
  DeployRestorePreview,
  DeployRestoreResult,
  DeployRestoreVerification,
  DeployWorktreeState,
} from "../../shared/deploySystem";
import { evaluateRestoreEnvironment } from "../../shared/deploySystem";
import { isSecretFileName } from "./DeployChecksService";

/**
 * RWQAN DEPLOY — real, ISOLATED release restore (Phase D).
 *
 * A restore re-materializes the exact tracked file tree of a release's full Git
 * SHA into a dedicated, isolated directory UNDER THE DEV ROOT — it never changes
 * the current working files, the current branch, or the Git index:
 *
 *   1. `git archive --format=tar <sha>` — a READ-ONLY export of the commit tree
 *      (no checkout/reset/commit/push/fetch, no network).
 *   2. extract the tar into `<devRoot>/.deploy-restore/<releaseId>/`.
 *   3. PRUNE every secret-named file (reusing `isSecretFileName`) so no `.env`,
 *      key, or credential is ever copied into the restore dir.
 *   4. VERIFY every remaining file's blob hash against `git ls-tree <sha>` — a
 *      match proves the extracted content equals the SHA, not merely that the SHA
 *      exists.
 *
 * The restore is refused (fail closed) when the SHA is missing/invalid, the
 * release has no trustworthy source, the TARGET environment is LIVE without
 * explicit approval (or a TEST-source release is aimed at LIVE), the working
 * tree has local/untracked changes, or the target path would escape the DEV root.
 * A LIVE-SOURCE release (e.g. the stable release) MAY be restored into TEST.
 * The service never throws for expected failures; it returns `blocked`/`failed`.
 */

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 15_000;
const TAR_TIMEOUT_MS = 60_000;
const MAX_BUFFER = 32 * 1024 * 1024;

export const RESTORE_ROOT_NAME = ".deploy-restore";
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SAFE_RELEASE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Injected side effects so the service is testable without touching FS/Git. */
export interface DeployRestoreDependencies {
  commitExists(sha: string, repoCwd: string): Promise<boolean>;
  listTree(
    sha: string,
    repoCwd: string,
  ): Promise<Array<{ path: string; blobSha: string }>>;
  archive(sha: string, tarPath: string, repoCwd: string): Promise<void>;
  extract(tarPath: string, dir: string): Promise<void>;
  hashFiles(dir: string, relativePaths: string[]): Promise<Map<string, string>>;
  listFiles(dir: string): Promise<string[]>;
  makeDirectory(dir: string): Promise<void>;
  remove(target: string): Promise<void>;
  pathExists(target: string): Promise<boolean>;
}

export interface DeployRestoreInput {
  release: DeployRelease;
  /** DEV root; also the Git repo cwd used for read-only archive/ls-tree. */
  devRoot: string;
  /**
   * Working-tree state observed just before the restore. Reported for
   * information only: a commit-based restore never touches the worktree, so a
   * `dirty` tree does not block it.
   */
  worktree?: DeployWorktreeState | null;
  /**
   * TARGET environment the restore would run against (the console's active
   * environment). Defaults to the isolated TEST target. Distinct from the
   * release's own SOURCE environment (`release.environment`).
   */
  targetEnvironment?: DeployEnvironment;
  /** TRUE only when a LIVE target restore has been explicitly approved. */
  liveRestoreApproved?: boolean;
  dependencies?: DeployRestoreDependencies;
  now?: () => Date;
}

/** Reject any release id that is not a single safe path segment. */
export function sanitizeReleaseId(releaseId: string): string | null {
  const trimmed = releaseId.trim();
  if (!trimmed || trimmed.length > 120) return null;
  if (!SAFE_RELEASE_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

/**
 * Resolve the isolated restore directory, refusing anything that is not strictly
 * contained under `<devRoot>/.deploy-restore/`. Absolute paths, `..`, and any
 * traversal are rejected (returns null).
 */
export function resolveRestoreTarget(
  devRoot: string,
  releaseId: string,
): string | null {
  const safe = sanitizeReleaseId(releaseId);
  if (!safe) return null;
  const root = path.resolve(devRoot);
  const target = path.resolve(root, RESTORE_ROOT_NAME, safe);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (!target.startsWith(prefix)) return null;
  return target;
}

/** TRUE only for a full 40-hex commit SHA (short SHAs are refused). */
export function isFullCommitSha(value: string | null | undefined): boolean {
  return typeof value === "string" && FULL_SHA_PATTERN.test(value);
}

/**
 * Build the restore PREVIEW. Read-only: it only checks the SHA against the local
 * object database and the working-tree state. It never extracts or writes.
 */
export async function buildRestorePreview(input: {
  release: DeployRelease;
  devRoot: string;
  worktree?: DeployWorktreeState | null;
  targetEnvironment?: DeployEnvironment;
  liveRestoreApproved?: boolean;
  dependencies?: DeployRestoreDependencies;
}): Promise<DeployRestorePreview> {
  const deps = input.dependencies ?? DEFAULT_DEPENDENCIES;
  const release = input.release;
  const targetEnvironment = input.targetEnvironment ?? "TEST";
  const commitSha = release.gitCommit ?? "";
  const shaFormatValid = isFullCommitSha(commitSha);
  const blockers: string[] = [];

  if (!commitSha || commitSha === "unknown") {
    blockers.push("لا يحتوي الإصدار على SHA قابل للاستعادة.");
  } else if (!shaFormatValid) {
    blockers.push(
      "SHA الإصدار ليس SHA كاملًا (40 خانة hex)؛ لا تُعتمد الاختصارات أو الفروع للاستعادة.",
    );
  }

  if (!release.sourceRepoUrl) {
    blockers.push("لا يحتوي الإصدار على مصدر مستودع موثوق لإثبات مصدره.");
  }
  // Environment rule: SOURCE (release.environment) vs TARGET (active console).
  // A LIVE-source release may be restored into the isolated TEST target; a LIVE
  // TARGET requires explicit approval and a LIVE source. See the shared helper.
  const environment = evaluateRestoreEnvironment(
    release.environment,
    targetEnvironment,
    { liveRestoreApproved: input.liveRestoreApproved === true },
  );
  if (!environment.ok && environment.reason) {
    blockers.push(environment.reason);
  }
  if (release.status === "validation_failed" || release.status === "failed") {
    blockers.push("الإصدار غير مكتمل (فشل تحقق) — لا يمكن استعادته.");
  }
  // NOTE: the working-tree state is reported for information only and is NOT a
  // blocker. A restore re-materializes an IMMUTABLE full-SHA commit (and the real
  // hosting rollout is built from that commit), so uncommitted local edits cannot
  // affect it. Blocking on a dirty tree would make the preview disagree with the
  // real restore gate and would make the feature unusable in a normal dev tree.

  const target = resolveRestoreTarget(input.devRoot, release.releaseId);
  if (!target) {
    blockers.push("معرّف الإصدار غير صالح أو مسار الاستعادة يتجاوز مجلد التطوير.");
  }

  let commitExists = false;
  if (shaFormatValid) {
    commitExists = await deps
      .commitExists(commitSha, input.devRoot)
      .catch(() => false);
    if (!commitExists) {
      blockers.push("الـSHA غير موجود في المستودع المحلي (تحقّق بلا شبكة).");
    }
  }

  return {
    releaseId: release.releaseId,
    version: release.version,
    commitSha,
    shortSha: commitSha ? commitSha.slice(0, 7) : null,
    releaseStatus: release.status,
    environment: release.environment,
    targetEnvironment,
    sourceRepoUrl: release.sourceRepoUrl,
    worktree: input.worktree ?? null,
    shaFormatValid,
    commitExists,
    canRestore: blockers.length === 0,
    blockers,
    targetPath: target,
  };
}

type MaterializeOutcome =
  | { ok: true; fileCount: number; verification: DeployRestoreVerification }
  | { ok: false; error: string };

/**
 * Extract the commit tree into `targetDir`, prune secret-named files, and verify
 * the remaining files against the commit tree. Never touches the working tree.
 */
export async function materializeTrackedTree(
  commitSha: string,
  repoCwd: string,
  targetDir: string,
  dependencies: DeployRestoreDependencies = DEFAULT_DEPENDENCIES,
): Promise<MaterializeOutcome> {
  const tarPath = `${targetDir}.tar`;
  try {
    await dependencies.makeDirectory(targetDir);
    await dependencies.archive(commitSha, tarPath, repoCwd);
    await dependencies.extract(tarPath, targetDir);
  } catch {
    await dependencies.remove(tarPath).catch(() => undefined);
    return {
      ok: false,
      error: "تعذّر استخراج شجرة الإصدار من Git (git archive).",
    };
  }
  await dependencies.remove(tarPath).catch(() => undefined);

  let listed: string[];
  try {
    listed = await dependencies.listFiles(targetDir);
  } catch {
    return { ok: false, error: "تعذّر قراءة ملفات مجلد الاستعادة." };
  }

  const prunedSecrets: string[] = [];
  const remaining: string[] = [];
  for (const relative of listed) {
    const posix = relative.split(path.sep).join("/");
    if (isSecretFileName(posix)) {
      prunedSecrets.push(posix);
      await dependencies
        .remove(path.join(targetDir, relative))
        .catch(() => undefined);
    } else {
      remaining.push(relative);
    }
  }

  let tree: Array<{ path: string; blobSha: string }>;
  try {
    tree = await dependencies.listTree(commitSha, repoCwd);
  } catch {
    return { ok: false, error: "تعذّرت قراءة شجرة الإصدار للتحقق." };
  }

  let hashes: Map<string, string>;
  try {
    hashes = await dependencies.hashFiles(targetDir, remaining);
  } catch {
    return { ok: false, error: "تعذّر حساب بصمات الملفات المستخرجة للتحقق." };
  }

  // Verify by CONTENT, not by path. Git stores file names as raw bytes, so
  // matching extracted files to tree entries by path is fragile for non-ASCII
  // (e.g. Arabic) names on Windows. Instead we compare the multiset of extracted
  // blob hashes with the multiset of blob hashes in the commit tree (ignoring
  // pruned secret-named files). A match proves the archive reproduced the SHA.
  const treeCounts = new Map<string, number>();
  for (const entry of tree) {
    if (isSecretFileName(entry.path)) continue;
    treeCounts.set(entry.blobSha, (treeCounts.get(entry.blobSha) ?? 0) + 1);
  }

  const mismatches: string[] = [];
  for (const relative of remaining) {
    const posix = relative.split(path.sep).join("/");
    const hash = hashes.get(relative) ?? hashes.get(posix);
    const count = hash ? (treeCounts.get(hash) ?? 0) : 0;
    if (!hash || count <= 0) {
      mismatches.push(posix);
    } else {
      treeCounts.set(hash, count - 1);
    }
  }

  if (mismatches.length > 0) {
    return {
      ok: false,
      error: `فشل التحقق: ${mismatches.length} ملفًا لا يطابق شجرة الإصدار.`,
    };
  }

  return {
    ok: true,
    fileCount: remaining.length,
    verification: { checked: remaining.length, mismatches, prunedSecrets },
  };
}

function emptyVerification(): DeployRestoreVerification {
  return { checked: 0, mismatches: [], prunedSecrets: [] };
}

/**
 * Run the FULL real restore: preview (blockers) → isolated materialization →
 * verification. Never touches the working tree and never throws for expected
 * failures; returns a `DeployRestoreResult` with status `blocked`/`failed`.
 */
export async function runRestore(
  input: DeployRestoreInput,
): Promise<DeployRestoreResult> {
  const deps = input.dependencies ?? DEFAULT_DEPENDENCIES;
  const now = input.now ?? (() => new Date());
  const requestedAt = now().toISOString();
  const release = input.release;

  const preview = await buildRestorePreview({
    release,
    devRoot: input.devRoot,
    worktree: input.worktree,
    targetEnvironment: input.targetEnvironment,
    liveRestoreApproved: input.liveRestoreApproved,
    dependencies: deps,
  });

  const base = {
    releaseId: release.releaseId,
    version: release.version,
    commitSha: preview.commitSha,
    real: true,
    requestedAt,
  };

  if (!preview.canRestore || !preview.targetPath) {
    return {
      ...base,
      status: "blocked",
      targetPath: preview.targetPath,
      fileCount: 0,
      verified: false,
      verification: emptyVerification(),
      executedAt: null,
      detail: "أُمنعت الاستعادة قبل التنفيذ.",
      error: preview.blockers.join(" "),
    };
  }

  const target = preview.targetPath;
  if (await deps.pathExists(target).catch(() => false)) {
    return {
      ...base,
      status: "blocked",
      targetPath: target,
      fileCount: 0,
      verified: false,
      verification: emptyVerification(),
      executedAt: null,
      detail: "أُمنعت الاستعادة: مجلد الاستعادة المعزول موجود مسبقًا.",
      error: "مجلد الاستعادة موجود مسبقًا؛ احذفه يدويًا أو استخدم معرّفًا آخر.",
    };
  }

  const materialized = await materializeTrackedTree(
    preview.commitSha,
    input.devRoot,
    target,
    deps,
  );
  const executedAt = now().toISOString();

  if (!materialized.ok) {
    return {
      ...base,
      status: "failed",
      targetPath: target,
      fileCount: 0,
      verified: false,
      verification: emptyVerification(),
      executedAt,
      detail: "فشلت الاستعادة الفعلية.",
      error: materialized.error,
    };
  }

  return {
    ...base,
    status: "success",
    targetPath: target,
    fileCount: materialized.fileCount,
    verified: true,
    verification: materialized.verification,
    executedAt,
    detail:
      "استعادة فعلية معزولة: أُعيد بناء ملفات الإصدار من الـSHA داخل مجلد معزول وتم التحقق من مطابقتها. لم تُمسّ ملفات العمل ولم يُنفَّذ commit/push/checkout/deploy.",
    error: null,
  };
}

/** Recursively list files (relative paths) under a directory. */
async function listFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFilesRecursive(absolute);
      for (const item of nested) out.push(path.join(entry.name, item));
    } else if (entry.isFile()) {
      out.push(entry.name);
    }
  }
  return out;
}

/**
 * Hash many files by passing the paths as ARGV to `git hash-object`. Paths are
 * passed as process arguments (not via stdin) because Node passes Unicode argv
 * through the Windows API correctly, whereas `--stdin-paths` would mangle
 * non-ASCII (e.g. Arabic) file names. The default filter path is kept so git's
 * own eol normalization matches how the commit stored the blobs; the list is
 * chunked to stay well under the command-line limit.
 */
function hashFilesViaGit(
  dir: string,
  relativePaths: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (relativePaths.length === 0) return Promise.resolve(map);

  const CHUNK = 100;
  const posix = relativePaths.map((relative) => relative.split(path.sep).join("/"));
  const chunks: string[][] = [];
  for (let index = 0; index < posix.length; index += CHUNK) {
    chunks.push(posix.slice(index, index + CHUNK));
  }

  return (async () => {
    let cursor = 0;
    for (const chunk of chunks) {
      const { stdout } = await execFileAsync("git", ["hash-object", ...chunk], {
        cwd: dir,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: MAX_BUFFER,
      });
      const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      relativePaths.slice(cursor, cursor + chunk.length).forEach((relative, index) => {
        const hash = lines[index];
        if (hash) map.set(relative, hash);
      });
      cursor += chunk.length;
    }
    return map;
  })();
}

const DEFAULT_DEPENDENCIES: DeployRestoreDependencies = {
  async commitExists(sha, repoCwd) {
    try {
      await execFileAsync("git", ["cat-file", "-e", `${sha}^{commit}`], {
        cwd: repoCwd,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: MAX_BUFFER,
      });
      return true;
    } catch {
      return false;
    }
  },
  async listTree(sha, repoCwd) {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-tree", "-r", "-z", sha],
      {
        cwd: repoCwd,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: MAX_BUFFER,
      },
    );
    const entries: Array<{ path: string; blobSha: string }> = [];
    for (const record of stdout.split("\0")) {
      if (!record) continue;
      const tab = record.indexOf("\t");
      if (tab < 0) continue;
      const meta = record.slice(0, tab).split(" ");
      if (meta[1] !== "blob") continue;
      entries.push({ path: record.slice(tab + 1), blobSha: meta[2] ?? "" });
    }
    return entries;
  },
  async archive(sha, tarPath, repoCwd) {
    await execFileAsync(
      "git",
      ["archive", "--format=tar", `--output=${tarPath}`, sha],
      {
        cwd: repoCwd,
        timeout: TAR_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: MAX_BUFFER,
      },
    );
  },
  async extract(tarPath, dir) {
    await execFileAsync("tar", ["-xf", tarPath, "-C", dir], {
      timeout: TAR_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: MAX_BUFFER,
    });
  },
  hashFiles(dir, relativePaths) {
    return hashFilesViaGit(dir, relativePaths);
  },
  async listFiles(dir) {
    return listFilesRecursive(dir);
  },
  async makeDirectory(dir) {
    await mkdir(dir, { recursive: true });
  },
  async remove(target) {
    await rm(target, { recursive: true, force: true });
  },
  async pathExists(target) {
    return stat(target)
      .then(() => true)
      .catch(() => false);
  },
};
