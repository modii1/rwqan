import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  DeployChecks,
  DeployCheckResult,
  DeployGitSource,
} from "../../shared/deploySystem";

/**
 * RWQAN DEPLOY — server-side deploy checks (Phase C).
 *
 * Only read-only, local checks run here. Full `tsc`/tests/`next build` are NOT
 * executed inside an HTTP request (they are slow, and a build would disturb the
 * running DEV server), so they are recorded as NOT_RUN with an explicit reason
 * instead of a fake PASS. The only checks executed are:
 *   - secret scan over the working-tree changes (file names + text content), and
 *   - read-only Git source detection (commit / branch / tag / remote).
 *
 * Nothing here performs a write, a `git commit`/`push`, a deploy, or any
 * production/network access. No secret value is ever returned or logged.
 */

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 8_000;
const MAX_SCANNED_FILE_BYTES = 512 * 1024;
const FALLBACK_REPO_URL = "https://github.com/iheeb1/rwqan-sa.git";

export interface DeployCheckReport {
  checks: DeployChecks;
  git: DeployGitSource | null;
  reasons: Partial<Record<keyof DeployChecks, string>>;
}

export interface DeployChecksDependencies {
  gitSource(cwd: string): Promise<DeployGitSource | null>;
  listChangedFiles(cwd: string): Promise<{
    files: string[];
    gitAvailable: boolean;
  }>;
  readTextFile(absolutePath: string): Promise<string | null>;
}

const NOT_RUN_TS =
  "فحص TypeScript لا يُشغَّل داخل طلب HTTP في هذه المرحلة (يُشغَّل في مسار البناء لاحقًا).";
const NOT_RUN_TESTS =
  "مجموعة الاختبارات لا تُشغَّل داخل طلب HTTP في هذه المرحلة (تُشغَّل في مسار CI لاحقًا).";
const NOT_RUN_BUILD =
  "البناء (next build) لا يُشغَّل داخل طلب HTTP ويبقى معطّلًا حتى مسار النشر المعزول.";
const NOT_RUN_HEALTH =
  "فحص ما بعد النشر غير متاح لأن النشر الفعلي غير مُنفَّذ في هذه المرحلة.";

const SKIPPABLE_ENV_FILES = new Set([
  ".env.example",
  ".env.sample",
  ".env.template",
]);

const SECRET_FILE_PATTERNS: RegExp[] = [
  /(^|\/)\.env($|\.)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  /service[-_]?account.*\.json$/i,
  /credentials.*\.json$/i,
];

const SECRET_CONTENT_PATTERNS: RegExp[] = [
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  /"private_key"\s*:\s*"/,
  /sk_live_[0-9a-zA-Z]{20,}/,
  /AIza[0-9A-Za-z\-_]{35}/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[0-9A-Za-z]{36}/,
  /xox[baprs]-[0-9a-zA-Z-]{10,}/,
];

/** File-name based secret detection for a repo-relative path. */
export function isSecretFileName(relativePath: string): boolean {
  const base = path.basename(relativePath).toLowerCase();
  if (SKIPPABLE_ENV_FILES.has(base)) return false;
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(relativePath));
}

/** Content based secret detection (patterns only; the match is never returned). */
export function secretContentDetected(text: string): boolean {
  return SECRET_CONTENT_PATTERNS.some((pattern) => pattern.test(text));
}

/** Strip any userinfo (credentials) from a Git remote URL before storing it. */
export function sanitizeGitRemote(remote: string): string {
  const fallback = FALLBACK_REPO_URL;
  const trimmed = remote.trim();
  if (!trimmed) return fallback;
  const withScheme = trimmed.includes("://")
    ? trimmed
    : trimmed.replace(/^[^@/]+@([^:]+):/, "ssh://$1/");
  try {
    const url = new URL(withScheme);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return fallback;
  }
}

export function evaluateChecks(input: {
  gitAvailable: boolean;
  secretFiles: string[];
  secretContentMatch: boolean;
}): {
  checks: DeployChecks;
  reasons: Partial<Record<keyof DeployChecks, string>>;
} {
  let secretScan: DeployCheckResult;
  const reasons: Partial<Record<keyof DeployChecks, string>> = {};

  if (!input.gitAvailable) {
    secretScan = "BLOCKED";
    reasons.secretScan =
      "تعذّر تشغيل فحص الأسرار (git غير متاح) — لم يُثبَت أن التغييرات خالية من الأسرار.";
  } else if (input.secretFiles.length > 0) {
    secretScan = "FAIL";
    reasons.secretScan = `ملفات قد تحوي أسرارًا ضمن التغييرات: ${input.secretFiles
      .slice(0, 5)
      .join(", ")}`;
  } else if (input.secretContentMatch) {
    secretScan = "FAIL";
    reasons.secretScan = "نمط سرّي وُجد داخل محتوى أحد الملفات المُغيَّرة.";
  } else {
    secretScan = "PASS";
  }

  reasons.typescript = NOT_RUN_TS;
  reasons.tests = NOT_RUN_TESTS;
  reasons.build = NOT_RUN_BUILD;
  reasons.postDeployHealth = NOT_RUN_HEALTH;

  return {
    checks: {
      typescript: "NOT_RUN",
      tests: "NOT_RUN",
      build: "NOT_RUN",
      secretScan,
      postDeployHealth: "NOT_RUN",
    },
    reasons,
  };
}

/**
 * Parse `git status --porcelain` output into changed file paths. Deleted files
 * (status contains `D`) are skipped: a deletion removes content from the working
 * tree, so it cannot leak a secret.
 */
export function parseChangedFiles(output: string): string[] {
  const files: string[] = [];
  for (const line of output.split("\n")) {
    if (line.length < 3) continue;
    const status = line.slice(0, 2);
    const file = line.slice(3).trim();
    if (!file) continue;
    if (status.includes("D")) continue;
    files.push(file);
  }
  return files;
}

const DEFAULT_DEPENDENCIES: DeployChecksDependencies = {
  async gitSource(cwd) {
    try {
      const commit = await runGit(["rev-parse", "HEAD"], cwd);
      if (!commit) return null;
      const branch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd).catch(
        () => "",
      );
      const remote = await runGit(["config", "--get", "remote.origin.url"], cwd).catch(
        () => "",
      );
      const tag = await runGit(["describe", "--tags", "--exact-match", "HEAD"], cwd).catch(
        () => "",
      );
      return {
        commit,
        branch: branch && branch !== "HEAD" ? branch : "detached",
        tag: tag || null,
        repoUrl: sanitizeGitRemote(remote),
      };
    } catch {
      return null;
    }
  },
  async listChangedFiles(cwd) {
    try {
      const output = await runGit(
        ["status", "--porcelain", "--untracked-files=all"],
        cwd,
      );
      return { files: parseChangedFiles(output ?? ""), gitAvailable: true };
    } catch {
      return { files: [], gitAvailable: false };
    }
  },
  async readTextFile(absolutePath) {
    try {
      const info = await stat(absolutePath);
      if (!info.isFile() || info.size > MAX_SCANNED_FILE_BYTES) return null;
      return await readFile(absolutePath, "utf8");
    } catch {
      return null;
    }
  },
};

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * Collect read-only deploy checks. Never throws: on any failure the affected
 * check becomes BLOCKED/NOT_RUN rather than a silent PASS.
 */
export async function collectDeployChecks(
  cwd: string,
  dependencies: DeployChecksDependencies = DEFAULT_DEPENDENCIES,
): Promise<DeployCheckReport> {
  const git = await dependencies.gitSource(cwd).catch(() => null);
  const { files, gitAvailable } = await dependencies
    .listChangedFiles(cwd)
    .catch(() => ({ files: [] as string[], gitAvailable: false }));

  const secretFiles: string[] = [];
  let secretContentMatch = false;

  for (const relativeFile of files) {
    if (isSecretFileName(relativeFile)) {
      secretFiles.push(relativeFile);
      continue;
    }
    if (secretContentMatch) continue;
    const absolutePath = path.resolve(cwd, relativeFile);
    const content = await dependencies.readTextFile(absolutePath).catch(() => null);
    if (content && SECRET_CONTENT_PATTERNS.some((pattern) => pattern.test(content))) {
      secretContentMatch = true;
    }
  }

  const { checks, reasons } = evaluateChecks({
    gitAvailable,
    secretFiles,
    secretContentMatch,
  });

  return { checks, git, reasons };
}
