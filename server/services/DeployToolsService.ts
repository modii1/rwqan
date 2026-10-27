import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

const DEFAULT_DEPENDENCIES: DeployToolsDependencies = {
  async readFirebaseVersion(cwd) {
    try {
      const { stdout } = await execFileAsync("firebase", ["--version"], {
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
