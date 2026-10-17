import type { ActiveScanFlags, ScanConfig, Target } from "./types";

export class SecurityScanGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityScanGuardError";
  }
}

const PRODUCTION_HOST_MARKERS: readonly string[] = [
  "rwqan.sa",
  "rwqan.com",
  "firestore.googleapis.com",
  "projects/rwqan-757",
  "pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev",
];

export function isProductionishUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return PRODUCTION_HOST_MARKERS.some((marker) => lower.includes(marker.toLowerCase()));
}

/**
 * Central production guard. Called before any scan/tool runs.
 * - target=production: only passive, read-only analysis is allowed;
 *   active scanning, mutation, payment tests and upload/delete tests are refused.
 * - target=development: active testing is allowed LATER but only with explicit flags.
 * The scanner in this phase is always passive (source-code analysis); active
 * scanning requires a live DEV target AND explicit enable flags.
 */
export function assertSecurityScanTargetSafe(
  target: Target,
  opts: {
    enableActive: ActiveScanFlags;
    targetUrl?: string;
    noNetwork?: boolean;
  } = { enableActive: { zapActiveScan: false, paymentTests: false, mutationTests: false, uploadDeleteTests: false } },
): void {
  const { enableActive, targetUrl } = opts;

  if (targetUrl && isProductionishUrl(targetUrl)) {
    throw new SecurityScanGuardError(
      `Refusing to scan production host: ${targetUrl}. Production scanning is not permitted (RUQAN-6D-SAFETY).`,
    );
  }

  if (target === "production") {
    if (enableActive.zapActiveScan) {
      throw new SecurityScanGuardError(
        "REFUSED: OWASP ZAP active scan is not allowed against production. DEV-only.",
      );
    }
    if (enableActive.paymentTests || enableActive.mutationTests || enableActive.uploadDeleteTests) {
      throw new SecurityScanGuardError(
        "REFUSED: mutation/payment/upload-delete tests are not allowed against production.",
      );
    }
    return;
  }

  // development target: active scans allowed only with explicit flags AND
  // only against a non-production URL.
  const anyActive =
    enableActive.zapActiveScan ||
    enableActive.paymentTests ||
    enableActive.mutationTests ||
    enableActive.uploadDeleteTests;

  if (anyActive && targetUrl && isProductionishUrl(targetUrl)) {
    throw new SecurityScanGuardError(
      `REFUSED: active testing targeted a production-looking host: ${targetUrl}.`,
    );
  }

  if (enableActive.zapActiveScan && opts.noNetwork) {
    throw new SecurityScanGuardError(
      "REFUSED: active ZAP scanning requires network; NO_NETWORK mode forbids it.",
    );
  }
}

/**
 * Active scan DEV-only guard: OWASP ZAP and other active scanners may only run
 * against an explicitly-flagged DEV target.
 */
export function assertActiveScanDevOnly(
  target: Target,
  enabled: boolean,
  context: string,
): void {
  if (!enabled) return;
  if (target !== "development") {
    throw new SecurityScanGuardError(
      `REFUSED: ${context} requires target=development (got ${target}).`,
    );
  }
}

export function assertNoNetworkMode(config: ScanConfig): void {
  if (!config.noNetwork) return;
  if (config.enableActive.zapActiveScan) {
    throw new SecurityScanGuardError(
      "REFUSED: NO_NETWORK=true forbids active scanning; disable it or drop --enable-active.",
    );
  }
}

export function resolveTarget(raw: string | undefined): Target {
  if (raw === "production") return "production";
  return "development";
}

export function resolveNoNetwork(
  raw: string | undefined,
  env?: Record<string, string | undefined>,
): boolean {
  if (raw === "true" || raw === "1") return true;
  const envValue = (env ?? process.env).NO_NETWORK;
  return envValue === "true" || envValue === "1";
}