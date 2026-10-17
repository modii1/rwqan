import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { correlate } from "./correlation";
import { createContext } from "./rules/context";
import { runRuqanStaticChecks } from "./checks";
import { runAvailableTools } from "./tools";
import { computeHealth } from "./engine";
import { buildSummary, renderPhase6fReport, renderReport } from "./report";
import {
  diffBaseline,
  loadBaseline,
  saveBaseline,
  createBaseline,
} from "./baseline";
import {
  assertNoNetworkMode,
  assertSecurityScanTargetSafe,
  resolveNoNetwork,
  resolveTarget,
} from "./guards";
import type {
  ActiveScanFlags,
  ScanConfig,
  Target,
  ToolScanResult,
  Finding,
} from "./types";

export interface CliOptions {
  repoPath: string;
  baselinePath: string;
  target: Target;
  noNetwork: boolean;
  ci: boolean;
  json: boolean;
  updateBaseline: boolean;
  enableActive: ActiveScanFlags;
  activeTargetUrl?: string;
  phase6f?: boolean;
  printHelp?: boolean;
}

export function parseArgv(argv: string[], env?: NodeJS.ProcessEnv): CliOptions {
  const opts: CliOptions = {
    repoPath: ".",
    baselinePath: "security/baseline.json",
    target: "development",
    noNetwork: false,
    ci: false,
    json: false,
    updateBaseline: false,
    enableActive: {
      zapActiveScan: false,
      paymentTests: false,
      mutationTests: false,
      uploadDeleteTests: false,
    },
  };
  let rawTarget: string | undefined;
  let rawNoNetwork: string | undefined;
  let rawActive: string | undefined;
  const unknown: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--repo":
        opts.repoPath = argv[++i] ?? ".";
        break;
      case "--baseline":
        opts.baselinePath = argv[++i] ?? "security/baseline.json";
        break;
      case "--target":
        rawTarget = argv[++i];
        break;
      case "--no-network": {
        const next = argv[i + 1];
        if (next === "true" || next === "false") {
          rawNoNetwork = next;
          i++;
        } else {
          // presence-only form: `--no-network` (as in `--no-network --ci`)
          rawNoNetwork = "true";
        }
        break;
      }
      case "--ci":
        opts.ci = true;
        break;
      case "--json":
        opts.json = true;
        break;
      case "--update-baseline":
        opts.updateBaseline = true;
        break;
      case "--phase6f":
        opts.phase6f = true;
        break;
      case "--enable-active":
        rawActive = argv[++i] ?? "zap";
        break;
      case "--active-target-url":
        opts.activeTargetUrl = argv[++i];
        break;
      default:
        if (arg === "--help" || arg === "-h") {
          opts.printHelp = true;
        } else {
          unknown.push(arg);
        }
    }
  }

  opts.target = resolveTarget(rawTarget);
  opts.noNetwork = resolveNoNetwork(rawNoNetwork, env);
  if (rawActive) {
    const bits = rawActive.split(",").map((s) => s.trim());
    opts.enableActive = {
      zapActiveScan: bits.includes("zap"),
      paymentTests: bits.includes("payment"),
      mutationTests: bits.includes("mutation"),
      uploadDeleteTests: bits.includes("upload-delete"),
    };
  }
  if (unknown.length > 0) {
    opts.printHelp = true;
  }
  return opts;
}

export function toScanConfig(
  opts: CliOptions,
  consoleOut: (line: string) => void,
): ScanConfig {
  return {
    repoPath: resolve(opts.repoPath),
    baselinePath: opts.baselinePath,
    target: opts.target,
    noNetwork: opts.noNetwork,
    ci: opts.ci,
    json: opts.json,
    updateBaseline: opts.updateBaseline,
    enableActive: opts.enableActive,
    activeTargetUrl: opts.activeTargetUrl
      ? resolveTargetUrl(opts.activeTargetUrl)
      : undefined,
    scanId: `scan-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`,
    consoleOut,
  };
}

function resolveTargetUrl(url: string): string {
  // Guards re-check production signatures; do not resolve further here.
  return url;
}

export const HELP_TEXT = `
RUQAN Platform Health Scanner (Phase 6F) — read-only; tools run locally,
offline-capable with official rule/vuln databases only.

Usage:
  tsx security/src/cli.ts [options]

Options:
  --repo <path>           Repo to scan (default: current dir)
  --baseline <path>      Baseline file path (default: security/baseline.json)
  --target <env>         development | production  (default: development; production = passive only)
  --no-network [bool]    Force offline mode. Active/network tools are skipped. (default: env NO_NETWORK)
  --enable-active <set>  Comma list, DEV only: zap,payment,mutation,upload-delete
  --active-target-url <url>  Live DEV target URL for active tools (never production)
  --ci                   Exit nonzero on RED-triggering findings (CI mode)
  --json                 Emit machine-readable JSON report
  --update-baseline      Persist this scan's findings as the new baseline
  --phase6f              Emit the Phase 6F real-toolchain report
  --help                 Show this help
`.trimStart();

export const CI_RED_EXIT = 2;
export const CI_GREEN_EXIT = 0;
export const CI_ORANGE_EXIT = 1;

export async function runScan(
  opts: CliOptions,
  env?: NodeJS.ProcessEnv,
): Promise<number> {
  if (opts.printHelp) {
    process.stdout.write(HELP_TEXT + "\n");
    return 0;
  }

  const consoleOut = (line: string) => process.stdout.write(line + "\n");
  const config = toScanConfig(opts, consoleOut);

  // Central safety guard — refuses production mutation / active scans on prod.
  assertSecurityScanTargetSafe(config.target, {
    enableActive: config.enableActive,
    targetUrl: config.activeTargetUrl,
    noNetwork: config.noNetwork,
  });
  assertNoNetworkMode(config);

  const ctx = createContext(config.repoPath, consoleOut);
  consoleOut(`[security] scanning ${ctx.repoPath} (files read: ${ctx.files.length})`);
  consoleOut(`[security] target=${config.target} noNetwork=${config.noNetwork} ci=${config.ci}`);

  const findings: Finding[] = runRuqanStaticChecks(ctx);
  const toolResults: ToolScanResult[] = runAvailableTools(config, ctx, env);

  for (const t of toolResults) {
    for (const f of t.findings) findings.push(f);
  }

  // Phase 6E correlation: collapse duplicates across sources into one finding
  // while preserving the anchor fingerprint for baseline stability.
  const correlation = correlate(findings);

  const baseline = loadBaseline(config.baselinePath);
  const today = new Date().toISOString();
  const diff = diffBaseline(baseline, correlation.findings, today, "ruqan-scan");

  const summary = buildSummary(diff.newFindings.concat(diff.existingFindings, diff.regressedFindings), {
    scanId: config.scanId,
    target: config.target,
    noNetwork: config.noNetwork,
    scannedAt: today,
    filesScanned: ctx.files.length,
    checksRun: ctx.files.length + 1, // static checks over the file set
    toolsAttempted: toolResults.length,
    toolsRan: toolResults.filter((t) => t.ran).length,
    duplicatesMerged: correlation.duplicatesMerged,
    multiSourceFindings: correlation.multiSourceCount,
  });

  const health = computeHealth(diff.newFindings.concat(diff.existingFindings, diff.regressedFindings));

  consoleOut(
    `[security] correlation: ${correlation.duplicatesMerged} duplicate(s) merged across sources, ${correlation.multiSourceCount} finding(s) with 2+ sources`,
  );

  const report = opts.phase6f
    ? renderPhase6fReport(summary, toolResults, diff.resolvedFindings, baseline?.entries ?? [])
    : renderReport(summary, {
        toolResults,
        baselineNote: baseline
          ? `baseline: ${config.baselinePath}`
          : "no baseline yet (run with --update-baseline after review)",
      });

  if (config.json) {
    process.stdout.write(JSON.stringify({ summary, health }, null, 2) + "\n");
  } else {
    process.stdout.write(report + "\n");
  }

  if (config.updateBaseline) {
    const file = baseline ?? createBaseline();
    file.entries = diff.entries;
    file.updatedAt = today;
    file.scanId = config.scanId;
    saveBaseline(file, config.baselinePath);
    consoleOut(`[security] baseline updated: ${config.baselinePath}`);
  }

  if (config.ci) {
    if (health.overall === "RED") return CI_RED_EXIT;
    if (health.overall === "ORANGE") return CI_ORANGE_EXIT;
  }
  return 0;
}

async function main(): Promise<void> {
  const opts = parseArgv(process.argv.slice(2));
  const code = await runScan(opts);
  process.exitCode = code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}