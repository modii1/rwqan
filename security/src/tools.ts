import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mapToolSeverity } from "./confidence";
import { redactText } from "./redact";
import { sectionOf } from "./severity";
import {
  assertActiveScanDevOnly,
} from "./guards";
import type {
  Category,
  DetectionSource,
  Finding,
  ScanConfig,
  Severity,
  ToolAvailability,
  ToolScanResult,
} from "./types";
import type { ScanContext } from "./rules/context";

export const TOOL_DEFINITIONS: {
  id: string;
  name: string;
  required: boolean;
  mode: "offline-capable" | "network-required" | "active-only" | "not-installed";
  detect: (env?: NodeJS.ProcessEnv) => string | null;
  versionArgs: string[];
}[] = [
  {
    id: "gitleaks",
    name: "Gitleaks",
    required: false,
    mode: "offline-capable",
    detect: (env) => findOnPath(["gitleaks"], env),
    versionArgs: ["version"],
  },
  {
    id: "semgrep",
    name: "Semgrep (Community)",
    required: false,
    mode: "network-required",
    detect: (env) => findOnPath(["semgrep"], env),
    versionArgs: ["--version"],
  },
  {
    id: "codeql",
    name: "CodeQL",
    required: false,
    mode: "network-required",
    detect: (env) => findOnPath(["codeql"], env),
    versionArgs: ["version"],
  },
  {
    id: "osv",
    name: "OSV Scanner",
    required: false,
    mode: "offline-capable",
    detect: (env) => findOnPath(["osv-scanner"], env),
    versionArgs: ["--version"],
  },
  {
    id: "trivy",
    name: "Trivy",
    required: false,
    mode: "offline-capable",
    detect: (env) => findOnPath(["trivy"], env),
    versionArgs: ["--version"],
  },
  {
    id: "zap",
    name: "OWASP ZAP",
    required: false,
    mode: "active-only",
    detect: (env) => findOnPath(["zap-cli"], env),
    versionArgs: ["--version"],
  },
];

function toolVersion(executable: string, args: string[]): string | undefined {
  if (!executable) return undefined;
  try {
    const res = spawnSync(executable, args, { encoding: "utf8", timeout: 15_000, windowsHide: true });
    if (res.status !== 0) return undefined;
    const first = (res.stdout ?? "").split(/\r?\n/)[0]?.trim();
    if (!first) return undefined;
    return first.slice(0, 120);
  } catch {
    return undefined;
  }
}

function findOnPath(binaries: string[], env?: NodeJS.ProcessEnv): string | null {
  const pathVar = (env ?? process.env).PATH ?? "";
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of pathVar.split(process.platform === "win32" ? ";" : ":")) {
    if (!dir) continue;
    for (const binary of binaries) {
      for (const ext of exts) {
        const candidate = join(dir, `${binary}${ext}`);
        try {
          if (existsSync(candidate)) return candidate;
        } catch {
          /* ignore unreadable dir */
        }
      }
    }
  }
  return null;
}

export function detectTools(env?: NodeJS.ProcessEnv): ToolAvailability[] {
  return TOOL_DEFINITIONS.map((def) => {
    const executable = def.detect(env);
    const installed = executable !== null;
    return {
      name: def.name,
      installed,
      executable: executable ?? undefined,
      version: installed ? toolVersion(executable!, def.versionArgs) : undefined,
      mode: installed ? def.mode : "not-installed",
    };
  });
}

function makeResult(
  tool: string,
  available: boolean,
  ran: boolean,
  version?: string,
): ToolScanResult {
  return { tool, available, ran, findings: [], version };
}

/**
 * Runs every installed tool that is permitted for the given config.
 * - network-required tools are skipped when config.noNetwork is true.
 * - active-only tools (ZAP) additionally require target=development + explicit
 *   active flag; active scanning is refused by guards for production targets.
 * Parsing errors never crash the scan: they are recorded as parseError=true.
 */
export function runAvailableTools(
  config: ScanConfig,
  ctx: ScanContext,
  opEnv?: NodeJS.ProcessEnv,
): ToolScanResult[] {
  const avails = detectTools(opEnv ?? process.env);
  const results: ToolScanResult[] = [];

  for (const avail of avails) {
    if (!avail.installed) {
      results.push(makeResult(avail.name, false, false, avail.version));
      continue;
    }
    const def = TOOL_DEFINITIONS.find((d) => d.name === avail.name)!;
    if (def.mode === "network-required" && config.noNetwork) {
      results.push({
        ...makeResult(avail.name, true, false, avail.version),
        error: `skipped: ${avail.name} requires network (CodeQL/Semgrep rule registry); NO_NETWORK=true`,
      });
      continue;
    }
    if (def.mode === "active-only") {
      assertActiveScanDevOnly(config.target, config.enableActive.zapActiveScan, def.name);
      if (config.noNetwork) {
        results.push({
          ...makeResult(avail.name, true, false, avail.version),
          error: `skipped: ${def.name} requires a live target; NO_NETWORK=true`,
        });
        continue;
      }
      if (!config.activeTargetUrl) {
        results.push({
          ...makeResult(avail.name, true, false, avail.version),
          error: `skipped: ${def.name} active scan requires --active-target-url (DEV only)`,
        });
        continue;
      }
    }
    const result = runTool(def.id, avail, config, ctx);
    if (!result.version) result.version = avail.version;
    results.push(result);
  }
  return results;
}

function runTool(
  id: string,
  avail: ToolAvailability,
  config: ScanConfig,
  ctx: ScanContext,
): ToolScanResult {
  switch (id) {
    case "gitleaks":
      return runGitleaks(avail, config, ctx);
    case "osv":
      return runOsv(avail, config, ctx);
    case "semgrep":
      return runSemgrep(avail, config, ctx);
    case "trivy":
      return runTrivy(avail, config, ctx);
    case "zap":
      return runZap(avail, config, ctx);
    case "codeql":
      return runCodeql(avail, config, ctx);
    default:
      return { ...makeResult(avail.name, true, false, avail.version), error: `unhandled tool: ${id}` };
  }
}

function baseFinding(tool: string, sev: Severity, title: string, file: string, line?: number): Finding {
  return {
    id: `TOOL-${tool.toUpperCase()}-${Math.random().toString(36).slice(2, 8)}`,
    severity: sev,
    category: "external_service_guards",
    section: sectionOf("external_service_guards"),
    title,
    description: "",
    evidence: "",
    file,
    line,
    detectionSource: tool as DetectionSource,
    affectedFlow: undefined,
    productionImpact: "UNKNOWN",
    remediation: undefined,
    status: "open",
    classification: "new",
    fingerprint: "",
    heuristic: false,
  };
}

function finalizeFinding(f: Finding): Finding {
  f.fingerprint = `${f.id}@${f.file}:${f.line ?? 0}`;
  return { ...f, title: redactText(f.title), evidence: redactText(f.evidence), description: redactText(f.description) };
}

/**
 * Tolerant JSON extraction: some tools (Trivy during a first-run DB download,
 * OSV v2 on misconfiguration) print progress/usage lines before the payload.
 * We parse the full text first; on failure we isolate the outermost JSON
 * object/array and re-parse from there.
 */
export function tryParseJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to bounded extraction */
  }
  const firstBrace = trimmed.indexOf("{");
  const firstBracket = trimmed.indexOf("[");
  const start = firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace) ? firstBracket : firstBrace;
  if (start < 0) throw new Error("no JSON payload in output");
  const slice = trimmed.slice(start);
  const end = Math.max(slice.lastIndexOf("}"), slice.lastIndexOf("]"));
  if (end < 0) throw new Error("no JSON payload in output");
  return JSON.parse(slice.slice(0, end + 1));
}

function runGitleaks(avail: ToolAvailability, config: ScanConfig, ctx: ScanContext): ToolScanResult {
  // Primary mode: full repo scan (git tracked files + history, --redact hides
  // secret values). Allowed offline and locally. Gitleaks exits with status 1
  // when leaks ARE found — that is not a scanner failure.
  const outPath = join(tmpdir(), `gitleaks-${config.scanId}.json`);
  let res = spawnSync(
    avail.executable!,
    ["detect", "--source", ctx.repoPath, "--report-format", "json", "--report-path", outPath, "--redact", "--log-level", "error"],
    {
      encoding: "utf8",
      timeout: 300_000,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (res.status !== 0 && !existsSync(outPath)) {
    // Fallback: working-tree-only scan (no git dependency). Non-zero status from
    // gitleaks here also means "leaks found" once the report exists.
    res = spawnSync(
      avail.executable!,
      ["detect", "--source", ctx.repoPath, "--no-git", "--report-format", "json", "--report-path", outPath, "--redact", "--log-level", "error"],
      {
        encoding: "utf8",
        timeout: 300_000,
        windowsHide: true,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  }
  if (res.status !== 0 && !existsSync(outPath)) {
    return {
      ...makeResult(avail.name, true, false, avail.version),
      error: `gitleaks failed (status ${res.status}): ${redactText(res.stderr ?? "")}`,
      exitCode: res.status ?? 1,
    };
  }
  const out = parseGitleaksJson(outPath, res.status !== 0);
  out.exitCode = res.status ?? 0;
  return out;
}

function parseGitleaksJson(path: string, failed: boolean): ToolScanResult {
  const result = makeResult("Gitleaks", true, true);
  if (!existsSync(path)) {
    result.error = failed ? "gitleaks detect found issues" : "gitleaks produced no report";
    result.parseError = !failed;
    return result;
  }
  return parseGitleaksJsonText(readFileSync(path, "utf8"), result);
}

export function parseGitleaksJsonText(raw: string, result?: ToolScanResult): ToolScanResult {
  const out = result ?? makeResult("Gitleaks", true, true);
  try {
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed) ? parsed : parsed.leaks ?? [];
    for (const item of items) {
      const file = item.File ?? item.file ?? "unknown";
      const line = item.StartLine ?? item.startLine;
      const title = `[Gitleaks] ${item.RuleID ?? item.ruleID ?? "secret"}${item.Description ? `: ${item.Description}` : ""}`;
      const f = baseFinding("gitleaks", "high", title, file, line);
      f.category = "secrets";
      f.section = sectionOf("secrets");
      f.evidence = "[redacted: secret value not stored]";
      f.productionImpact = "YES";
      out.findings.push(finalizeFinding(f));
    }
  } catch {
    out.error = "malformed gitleaks output (non-JSON)";
    out.parseError = true;
  }
  return out;
}

function runOsv(avail: ToolAvailability, config: ScanConfig, ctx: ScanContext): ToolScanResult {
  const lockfiles = ctx.files.filter((f) => /package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$|poetry\.lock$/.test(f.rel));
  if (lockfiles.length === 0) {
    return { ...makeResult(avail.name, true, false, avail.version), error: "no lockfile found for OSV scan" };
  }
  // OSV Scanner v2 CLI: `scan source [flags] <dir>`; --data-source native talks
  // to api.osv.dev only (the official OSV database). Offline mode requires a
  // previously downloaded local DB (--offline --offline-vulnerabilities).
  const args = config.noNetwork
    ? ["scan", "source", "--format", "json", "--offline", "--offline-vulnerabilities", ctx.repoPath]
    : ["scan", "source", "--format", "json", "--data-source", "native", "--verbosity", "error", ctx.repoPath];
  const res = spawnSync(avail.executable!, args, {
    cwd: ctx.repoPath,
    encoding: "utf8",
    timeout: 300_000,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0 && !res.stdout) {
    return {
      ...makeResult(avail.name, true, false, avail.version),
      error: `osv-scanner failed (status ${res.status}): ${redactText(res.stderr ?? "")}`,
      exitCode: res.status ?? 1,
    };
  }
  const out = parseOsvJson(res.stdout ?? "{}", res.status !== 0);
  out.exitCode = res.status ?? 0;
  return out;
}

function parseOsvJson(output: string, failed: boolean): ToolScanResult {
  const result = makeResult("OSV Scanner", true, true);
  if (!output?.trim()) {
    result.error = "osv-scanner produced no output";
    result.parseError = true;
    return result;
  }
  return parseOsvJsonText(output, result);
}

export function parseOsvJsonText(raw: string, result?: ToolScanResult): ToolScanResult {
  const out = result ?? makeResult("OSV Scanner", true, true);
  try {
    const data = tryParseJson(raw) as { results?: unknown[] };
    const packages = (data.results ?? []) as {
      package?: { name?: string };
      vulnerabilities?: {
        severity?: string[];
        database_specific?: { severity?: string };
        summary?: string;
        id?: string;
        details?: string;
      }[];
    }[];
    for (const group of packages) {
      const pkg = group.package ?? {};
      const vulns = group.vulnerabilities ?? [];
      for (const v of vulns) {
        const sev = mapOsvSeverity(v);
        const f = baseFinding(
          "osv",
          sev,
          `[OSV] ${v.summary ?? v.id ?? "vulnerability"}`,
          "package-lock.json",
        );
        f.category = "dependency_vulnerability";
        f.section = sectionOf("dependency_vulnerability");
        f.evidence = `package=${pkg.name} details=${redactText(v.details ?? v.id ?? "(details redacted)")}`;
        f.productionImpact = "YES";
        out.findings.push(finalizeFinding(f));
      }
    }
  } catch (err) {
    out.error = `malformed osv output (non-JSON): ${redactText((raw ?? "").replace(/[\r\n]+/g, " ").slice(0, 200))} err=${err instanceof Error ? err.message : String(err)} len=${(raw ?? "").length}`;
    out.parseError = true;
  }
  return out;
}

function mapOsvSeverity(v: { severity?: string[]; database_specific?: { severity?: string } }): Severity {
  const raw = v.severity?.[0] ?? v.database_specific?.severity ?? "";
  return mapToolSeverity(raw);
}

function runSemgrep(avail: ToolAvailability, config: ScanConfig, ctx: ScanContext): ToolScanResult {
  const outPath = join(tmpdir(), `semgrep-${config.scanId}.json`);
  const res = spawnSync(
    avail.executable!,
    [
      "scan",
      "--config=p/security-audit",
      "--config=p/javascript",
      "--metrics=off",
      "--include",
      "*.{js,ts,jsx,tsx}",
      "--json",
      "--output",
      outPath,
    ],
    {
      cwd: ctx.repoPath,
      encoding: "utf8",
      timeout: 420_000,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (res.status !== 0 && !existsSync(outPath)) {
    return { ...makeResult(avail.name, true, false, avail.version), error: `semgrep failed (status ${res.status})`, exitCode: res.status ?? 1 };
  }
  if (existsSync(outPath)) {
    const content = readFileSync(outPath, "utf8");
    if (/^\s*<ERROR:/.test(content)) {
      return {
        ...makeResult(avail.name, true, false, avail.version),
        error: `NOT_RUN: semgrep engine failed to produce results (semgrep-core unavailable): ${redactText(content.trim().slice(0, 200))}`,
        exitCode: res.status ?? 1,
      };
    }
  }
  const out = parseSemgrepJson(outPath);
  out.exitCode = res.status ?? 0;
  return out;
}

function parseSemgrepJson(path: string): ToolScanResult {
  const result = makeResult("Semgrep", true, true);
  if (!existsSync(path)) {
    result.error = "semgrep produced no report";
    result.parseError = true;
    return result;
  }
  return parseSemgrepJsonText(readFileSync(path, "utf8"), result);
}

/** Semgrep util severity levels are ERROR/WARNING/INFO. */
function mapSemgrepSeverity(level: string | undefined): Severity {
  const l = (level ?? "info").toUpperCase();
  if (l === "ERROR") return "high";
  if (l === "WARNING") return "medium";
  return "low";
}

/**
 * Attribute a generic external check id to a known Ruqan domain category.
 * Only explicit keyword matches are mapped; anything else lands on the honest
 * `external_analysis` category rather than a fabricated Ruqan label.
 */
export function inferCategory(checkId: string, message?: string): Category {
  const hay = `${checkId} ${message ?? ""}`.toLowerCase();
  if (/(idor|insecure.?direct.?object|access-control|authorization|authz|missing.?auth|token-validation|missing.?token|anti.?csrf|\bcsrf\b)/.test(hay)) return "idor";
  if (/(api-?key|secret|password|token|credential)/.test(hay)) return "secrets";
  if (/(ssrf|url.*request|open.?redirect|arbitrary-url)/.test(hay)) return "ssrf";
  if (/(authenticate|authn|login|session|weak.?password)/.test(hay)) return "authentication";
  if (/(injection|xss|command|path-traversal|unsafe-dynamic|eval|serialize)/.test(hay)) return "external_analysis";
  if (/(upload|mimetype|content-type|file-extension)/.test(hay)) return "upload_validation";
  if (/(paymob|checkout|subscription|renewal|discount|amount|webhook)/.test(hay)) return "payment_flow";
  return "external_analysis";
}

export function parseSemgrepJsonText(raw: string, result?: ToolScanResult): ToolScanResult {
  const out = result ?? makeResult("Semgrep", true, true);
  try {
    const data = JSON.parse(raw);
    const results = data.results ?? [];
    for (const item of results) {
      const checkId = item.check_id ?? item.rule_id ?? `rule-${item.ruleIndex ?? "unknown"}`;
      const message = typeof item.message === "string" ? item.message : JSON.stringify(item.message ?? "");
      const cat = inferCategory(checkId, message);
      const f = baseFinding(
        "semgrep",
        mapSemgrepSeverity(item?.extra?.severity),
        `[Semgrep] ${checkId}`,
        item.path ?? "unknown",
        item?.start?.line ?? item?.location?.start?.line,
      );
      f.description = redactText(message);
      f.category = cat;
      f.section = sectionOf(cat);
      out.findings.push(finalizeFinding(f));
    }
  } catch {
    out.error = "malformed semgrep output (non-JSON)";
    out.parseError = true;
  }
  return out;
}

export const CODEQL_SUITE_FILE = "javascript-security-extended.qls";

let cachedSuitePath: string | null | undefined;

/**
 * Locates the bundled JavaScript security-extended query suite inside the
 * CodeQL install (no network needed: the suite ships in the official bundle).
 * Memoised; a missing suite yields null and the adapter reports NOT_RUN.
 */
function findCodeqlSuite(executable: string): string | null {
  if (cachedSuitePath !== undefined) return cachedSuitePath;
  cachedSuitePath = null;
  // codeql.exe sits at <bundle-root>/codeql.exe; qlpacks live in the same root.
  const root = join(dirname(executable), "qlpacks");
  const walk = (dir: string, depth: number): string | null => {
    if (depth > 8) return null;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && entry.name === CODEQL_SUITE_FILE) {
        return join(dir, entry.name);
      }
      if (entry.isDirectory() && entry.name !== "test") {
        const found = walk(join(dir, entry.name), depth + 1);
        if (found) return found;
      }
    }
    return null;
  };
  cachedSuitePath = walk(root, 0);
  return cachedSuitePath;
}

export function runCodeql(avail: ToolAvailability, config: ScanConfig, ctx: ScanContext): ToolScanResult {
  const sarifPath = join(tmpdir(), `codeql-${config.scanId}.sarif`);
  // Reuse a freshly supplied SARIF/DB if present (prebuilt analysis path).
  if (existsSync(sarifPath)) return parseCodeqlSarifJson(sarifPath);

  if (config.noNetwork) {
    return {
      ...makeResult(avail.name, true, false, avail.version),
      error: "NOT_RUN: CodeQL requires network to fetch the default query registry; NO_NETWORK=true",
    };
  }

  const suite = findCodeqlSuite(avail.executable!);
  if (!suite) {
    return {
      ...makeResult(avail.name, true, false, avail.version),
      error: `NOT_RUN: bundled ${CODEQL_SUITE_FILE} not found under the CodeQL install; check the official codeql-bundle`,
    };
  }

  // Phase 6F permits a LOCAL database build (never a production mutation).
  // The build + analysis write only under the OS temp directory.
  const dbPath = join(tmpdir(), `codeql-db-${config.scanId}`);
  const build = spawnSync(
    avail.executable!,
    ["database", "create", dbPath, "--language=typescript", "--source-root", ctx.repoPath, "--overwrite"],
    {
      cwd: ctx.repoPath,
      encoding: "utf8",
      timeout: 600_000,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (build.status !== 0) {
    return {
      ...makeResult(avail.name, true, false, avail.version),
      error: `NOT_RUN: codeql database create failed (status ${build.status}): ${redactText((build.stderr ?? "").slice(-500))}`,
      exitCode: build.status ?? 1,
    };
  }

  const analyze = spawnSync(
    avail.executable!,
    ["database", "analyze", dbPath, suite, "--format=sarif-latest", "--output", sarifPath, "--no-group-results"],
    {
      cwd: ctx.repoPath,
      encoding: "utf8",
      timeout: 900_000,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (analyze.status !== 0 && !existsSync(sarifPath)) {
    return {
      ...makeResult(avail.name, true, false, avail.version),
      error: `NOT_RUN: codeql database analyze failed (status ${analyze.status}): ${redactText((analyze.stderr ?? "").slice(-500))}`,
      exitCode: analyze.status ?? 1,
    };
  }
  const out = parseCodeqlSarifJson(sarifPath);
  out.exitCode = analyze.status ?? 0;
  return out;
}

function parseCodeqlSarifJson(path: string): ToolScanResult {
  const result = makeResult("CodeQL", true, true);
  try {
    return parseCodeqlSarifJsonText(readFileSync(path, "utf8"), result);
  } catch {
    result.error = "malformed CodeQL SARIF (non-JSON)";
    result.parseError = true;
    return result;
  }
}

/**
 * Rules stopped because they are incompatible with this project's scope.
 * The reason is surfaced in the tool result so the suppression is auditable
 * (Phase 6F requirement: stop a rule only with a logged reason).
 */
export const EXCLUDED_CODEQL_RULES: Record<string, string> = {
  "js/log-injection":
    "mass informational hits on console logging where no log consumer is in scope; excluded to keep findings actionable",
};

/**
 * Parse a SARIF 2.1.0 report produced by `codeql database analyze`.
 * Each rule result becomes a Finding in the shared Finding model; the SARIF
 * `partialFingerprints.primaryLocationLineHash` (when present) gives a stable
 * per-location hash which the correlation engine reuses as an anchor.
 * Result-level severity falls back to the rule's defaultConfiguration.level so
 * high-severity rules (ERROR) keep their real weight.
 */
export function parseCodeqlSarifJsonText(raw: string, result?: ToolScanResult): ToolScanResult {
  const out = result ?? makeResult("CodeQL", true, true);
  try {
    const data = JSON.parse(raw);
    const runs = Array.isArray(data.runs) ? data.runs : [];
    let excluded = 0;
    for (const run of runs) {
      const tool = run.tool?.driver ?? {};
      const name = tool.name ?? "codeql";
      const rulesById = new Map<string, { id?: string; name?: string; message?: string; defaultLevel?: string }>();
      for (const rule of run.tool?.driver?.rules ?? run.rules ?? []) {
        rulesById.set(rule.id ?? rule.name ?? "", {
          id: rule.id,
          name: rule.name,
          message: rule.message?.text ?? rule.message,
          defaultLevel: rule.defaultConfiguration?.level,
        });
      }
      for (const res of run.results ?? []) {
        const ruleId = res.ruleId ?? "unknown";
        if (EXCLUDED_CODEQL_RULES[ruleId]) {
          excluded++;
          continue;
        }
        const ruleMeta = rulesById.get(ruleId);
        const artifact = res.locations?.[0]?.physicalLocation ?? {};
        const file = artifact.artifactLocation?.uri ?? "unknown";
        const rawLevel = typeof res.level === "string" && res.level ? res.level : (ruleMeta?.defaultLevel ?? "warning");
        const sev: Severity = rawLevel === "error" ? "high" : rawLevel === "note" ? "info" : "medium";
        if (sev === "info") continue;
        const message = typeof res.message?.text === "string" ? res.message.text : "";
        const cat = inferCategory(ruleId, message);
        const f = baseFinding(
          "codeql",
          sev,
          `[CodeQL] ${ruleMeta?.id ?? ruleId}`,
          file.includes("file://") ? file.replace("file://", "") : file,
          artifact.region?.startLine,
        );
        f.description = redactText(message);
        f.productionImpact = "UNKNOWN";
        f.category = cat;
        f.section = sectionOf(cat);
        const pf = res.partialFingerprints ?? {};
        if (pf.primaryLocationLineHash) {
          f.evidence = `sarif-location-hash=${pf.primaryLocationLineHash}`;
        }
        out.findings.push(finalizeFinding(f));
      }
    }
    const exclusions = Object.keys(EXCLUDED_CODEQL_RULES);
    if (excluded > 0) {
      out.error = `excluded ${excluded} result(s) from inactive rule(s) ${exclusions.join(", ")} (reason: ${EXCLUDED_CODEQL_RULES[exclusions[0]]})`;
      out.ran = true;
    }
    if (out.findings.length === 0 && excluded === 0) {
      out.error = "CodeQL SARIF contained no actionable results";
    }
  } catch {
    out.error = "malformed CodeQL SARIF (non-JSON)";
    out.parseError = true;
  }
  return out;
}

function runTrivy(avail: ToolAvailability, config: ScanConfig, ctx: ScanContext): ToolScanResult {
  const lockfiles = ctx.files.filter((f) => /package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$/.test(f.rel));
  if (lockfiles.length === 0) {
    return { ...makeResult(avail.name, true, false, avail.version), error: "no lockfile found for Trivy scan" };
  }
  const args = [
    "fs",
    "--scanners",
    "vuln",
    "--format",
    "json",
    "--no-progress",
    "--skip-dirs",
    "node_modules",
    "--skip-dirs",
    ".next",
    "--skip-dirs",
    "dist",
    "--skip-dirs",
    ".firebase",
  ];
  if (config.noNetwork) {
    const cacheDir = (process.env.TRIVY_CACHE_DIR ?? "").trim();
    if (!cacheDir) {
      return {
        ...makeResult(avail.name, true, false, avail.version),
        error: `NOT_RUN: Trivy requires a local vulnerability DB (set TRIVY_CACHE_DIR) in offline mode`,
      };
    }
    args.push("--skip-db-update", "--offline-scan", "--cache-dir", cacheDir);
  }
  args.push("--quiet", ctx.repoPath);
  const res = spawnSync(avail.executable!, args, {
    cwd: ctx.repoPath,
    encoding: "utf8",
    timeout: 420_000,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0 && !res.stdout) {
    return {
      ...makeResult(avail.name, true, false, avail.version),
      error: `trivy failed (status ${res.status}): ${redactText(res.stderr ?? "")}`,
      exitCode: res.status ?? 1,
    };
  }
  const out = parseTrivyJson(res.stdout ?? "{}", res.status !== 0);
  out.exitCode = res.status ?? 0;
  return out;
}

function parseTrivyJson(output: string, failed: boolean): ToolScanResult {
  const result = makeResult("Trivy", true, true);
  if (!output?.trim()) {
    result.error = "trivy produced no output";
    result.parseError = true;
    return result;
  }
  return parseTrivyJsonText(output, result);
}

export function parseTrivyJsonText(raw: string, result?: ToolScanResult): ToolScanResult {
  const out = result ?? makeResult("Trivy", true, true);
  try {
    const data = tryParseJson(raw) as { Results?: unknown[]; results?: unknown[] };
    const results = Array.isArray(data) ? data : data.Results ?? data.results ?? [];
    for (const target of results) {
      const vulns = target.Vulnerabilities ?? target.vulnerabilities ?? [];
      for (const v of vulns) {
        const vulnId = v.VulnerabilityID ?? v.vulnerabilityID ?? "unknown";
        const sev = mapToolSeverity(v.Severity ?? v.severity ?? "low");
        const f = baseFinding(
          "trivy",
          sev,
          `[Trivy] ${vulnId}: ${v.Title ?? v.title ?? "(no title)"}`,
          "package-lock.json",
        );
        f.category = "dependency_vulnerability";
        f.section = sectionOf("dependency_vulnerability");
        const pkg = v.PkgName ?? v.pkgName ?? "?";
        const installed = v.InstalledVersion ?? v.installedVersion ?? "?";
        const fixed = v.FixedVersion ?? v.fixedVersion;
        f.evidence = `package=${pkg} installed=${installed}${fixed ? ` fixed=${fixed}` : " (no fix available)"}`;
        f.productionImpact = "YES";
        out.findings.push(finalizeFinding(f));
      }
    }
  } catch (err) {
    out.error = `malformed trivy output (non-JSON): ${redactText((raw ?? "").replace(/[\r\n]+/g, " ").slice(0, 200))} err=${err instanceof Error ? err.message : String(err)} len=${(raw ?? "").length}`;
    out.parseError = true;
  }
  return out;
}

function runZap(avail: ToolAvailability, config: ScanConfig, ctx: ScanContext): ToolScanResult {
  assertActiveScanDevOnly(config.target, config.enableActive.zapActiveScan, "ZAP");
  const target = config.activeTargetUrl!;
  const outPath = join(tmpdir(), `zap-${config.scanId}.json`);
  const res = spawnSync(avail.executable!, ["--bogus"], {
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0 && !existsSync(outPath)) {
    return { ...makeResult(avail.name, true, false, avail.version), error: `ZAP active scan not executed (adapter stub: ${redactText(target)})` };
  }
  return parseZapJson(outPath);
}

function parseZapJson(path: string): ToolScanResult {
  const result = makeResult("OWASP ZAP", true, true);
  if (!existsSync(path)) return result;
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    const alerts = data.alerts ?? [];
    for (const a of alerts) {
      const f = baseFinding("zap", "medium", `[ZAP] ${a.alert ?? "alert"}`, a.uri ?? "unknown");
      f.description = redactText(a.description ?? "");
      f.evidence = redactText(a.evidence ?? a.other ?? "");
      f.category = "r2_access"; // placeholder; refined by caller
      f.section = sectionOf("r2_access");
      const risk = String(a.risk ?? "").toLowerCase();
      if (risk.includes("high")) f.severity = "high";
      if (risk.includes("critical")) f.severity = "critical";
      if (risk.includes("low")) f.severity = "low";
      result.findings.push(finalizeFinding(f));
    }
  } catch {
    result.error = "malformed ZAP output (non-JSON)";
    result.parseError = true;
  }
  return result;
}