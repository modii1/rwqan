import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DeployToolsInfo } from "../../shared/deploySystem";

/**
 * RWQAN DEPLOY — read-only availability probe for the deploy tools.
 *
 * Answers ONE question for the pre-deploy review gate: is the `firebase` CLI
 * actually executable on this machine? Real rollouts are created with
 * `firebase apphosting:rollouts:create` (see DeployRealExecutor), so a machine
 * without the CLI can never deploy — and the gate must say so instead of
 * guessing.
 *
 * The probe runs `firebase --version`: a strictly LOCAL, read-only invocation
 * with NO project selection, NO network request, and NO authentication. The
 * only output kept is the parsed version string (e.g. "15.34.0").
 *
 * On Windows npm installs ship only a `firebase.cmd` shim — there is no plain
 * `firebase` executable — and Node refuses to spawn `.cmd` files through
 * `execFile` (ENOENT, or EINVAL under the CVE-2024-27980 hardening). The probe
 * therefore launches firebase-tools' own JS entry point through
 * `process.execPath` as a plain argv array: no shell, no command string, no
 * interpolation of dynamic values.
 *
 * Fail closed: any failure (missing binary, timeout, crash) yields
 * `available:false` with a null version — never a thrown error, never a
 * fabricated version, and never a secret.
 */

const execFileAsync = promisify(execFile);

const TOOLS_TIMEOUT_MS = 20_000;
const TOOLS_CACHE_TTL_MS = 5 * 60 * 1000;

/** Runner seam: returns the raw stdout of `firebase --version`, or null. */
export interface DeployToolsDependencies {
  readFirebaseVersion(cwd: string): Promise<string | null>;
}

export interface ResolvedFirebaseCommand {
  /** Executable to spawn WITHOUT any shell (`node` on win32, else `firebase`). */
  file: string;
  /** Fixed argv prepended before the caller's own arguments. */
  prefixArgs: string[];
}

const FIREBASE_PLAIN_FALLBACK: ResolvedFirebaseCommand = {
  file: "firebase",
  prefixArgs: [],
};

/**
 * Resolve how to launch the firebase CLI on this machine WITHOUT a shell.
 *
 * Windows npm installs provide only a `firebase.cmd` shim, and Node refuses to
 * spawn `.cmd` files via `execFile` directly (`ENOENT` for a bare `firebase`,
 * `EINVAL` for `firebase.cmd` under the CVE-2024-27980 hardening). The
 * reliable fix is to run firebase-tools' own JS entry — read from the
 * installed package's `bin` field, located next to the very shim that PATH
 * itself would run — through `process.execPath`. Arguments remain a plain
 * argv array: never a shell string, nothing to interpolate.
 *
 * Fail closed and never throws: any resolution problem returns the plain
 * `firebase` fallback, which every caller already treats as a failure
 * (probe → null → available:false; executor → non-zero exit → refused).
 */
export function resolveFirebaseCommand(
  env: Partial<NodeJS.ProcessEnv> = process.env,
  platform: NodeJS.Platform = process.platform,
): ResolvedFirebaseCommand {
  if (platform !== "win32") return FIREBASE_PLAIN_FALLBACK;
  const rawPath = env.PATH ?? env.Path ?? "";
  for (const dir of rawPath.split(path.delimiter)) {
    if (!dir) continue;
    if (!existsSync(path.join(dir, "firebase.cmd"))) continue;
    // The first PATH match is the very shim the shell would run. npm places
    // the package either directly under the shim dir (global prefix layout) or
    // one level up (node_modules/.bin layout).
    const candidates = [
      path.join(dir, "node_modules", "firebase-tools"),
      path.join(dir, "..", "firebase-tools"),
    ];
    const pkgDir = candidates.find((candidate) =>
      existsSync(path.join(candidate, "package.json")),
    );
    if (!pkgDir) return FIREBASE_PLAIN_FALLBACK;
    let bin: string | Record<string, string> | undefined;
    try {
      const pkg = JSON.parse(
        readFileSync(path.join(pkgDir, "package.json"), "utf8"),
      ) as { bin?: string | Record<string, string> };
      bin = pkg.bin;
    } catch {
      return FIREBASE_PLAIN_FALLBACK;
    }
    const relativeEntry = typeof bin === "string" ? bin : bin?.firebase;
    if (!relativeEntry) return FIREBASE_PLAIN_FALLBACK;
    const entry = path.join(pkgDir, relativeEntry);
    if (!existsSync(entry)) return FIREBASE_PLAIN_FALLBACK;
    return { file: process.execPath, prefixArgs: [entry] };
  }
  return FIREBASE_PLAIN_FALLBACK;
}

const DEFAULT_DEPENDENCIES: DeployToolsDependencies = {
  async readFirebaseVersion(cwd) {
    try {
      const { file, prefixArgs } = resolveFirebaseCommand();
      const { stdout } = await execFileAsync(file, [...prefixArgs, "--version"], {
        cwd,
        timeout: TOOLS_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      return stdout?.toString() ?? "";
    } catch {
      return null;
    }
  },
};

/** Parse a plain version (e.g. "15.34.0") out of the `--version` output. */
export function parseFirebaseCliVersion(stdout: string): string | null {
  const match = stdout.match(/(\d+\.\d+\.\d+[-.\w]*)/);
  return match ? match[1] ?? null : null;
}

let cache: { info: DeployToolsInfo; readAtMs: number } | null = null;

/** Test seam: forget the cached probe result so the next read runs again. */
export function resetDeployToolsCache(): void {
  cache = null;
}

/**
 * Read the deploy-tools availability (cached 5 minutes; tests may inject a
 * runner via `dependencies`). Never throws: an unavailable CLI is a
 * `available:false` result, not an error.
 */
export async function readDeployToolsInfo(
  dependencies: DeployToolsDependencies = DEFAULT_DEPENDENCIES,
  cwd: string = process.cwd(),
): Promise<DeployToolsInfo> {
  const nowMs = Date.now();
  if (cache && nowMs - cache.readAtMs < TOOLS_CACHE_TTL_MS) {
    return cache.info;
  }
  const readAt = new Date(nowMs).toISOString();
  const stdout = await dependencies
    .readFirebaseVersion(cwd)
    .catch(() => null);
  const version = typeof stdout === "string" ? parseFirebaseCliVersion(stdout) : null;
  const info: DeployToolsInfo = {
    firebaseCliAvailable: version !== null,
    firebaseCliVersion: version,
    readAt,
  };
  cache = { info, readAtMs: nowMs };
  return info;
}
