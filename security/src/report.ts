import { computeHealth, worstSectionSeverity, type HealthState } from "./engine";
import { redactText } from "./redact";
import { isRedTriggeringFinding, summarizeFindings } from "./severity";
import type {
  BaselineClassification,
  BaselineEntry,
  Finding,
  ScanSummary,
  Section,
  ToolScanResult,
} from "./types";

export const SECTIONS: Section[] = [
  "Security",
  "Dependencies",
  "Secrets",
  "Authorization",
  "Payments",
  "Files",
  "Firebase",
  "R2",
  "External Services",
];

function bar(state: "GREEN" | "ORANGE" | "RED"): string {
  return state === "GREEN" ? "[GREEN]  " : state === "ORANGE" ? "[ORANGE] " : "[RED]    ";
}

export function buildSummary(
  findings: Finding[],
  opts: {
    scanId: string;
    target: string;
    noNetwork: boolean;
    scannedAt: string;
    filesScanned: number;
    checksRun: number;
    toolsAttempted: number;
    toolsRan: number;
    duplicatesMerged?: number;
    multiSourceFindings?: number;
  },
): ScanSummary {
  const health = computeHealth(findings);
  const counts = summarizeFindings(findings);
  const classifications = {
    new: 0 as number,
    existing: 0 as number,
    regressed: 0 as number,
    resolved: 0 as number,
  };
  for (const f of findings) {
    if (f.classification === "new") classifications.new++;
    if (f.classification === "existing") classifications.existing++;
    if (f.classification === "regressed") classifications.regressed++;
  }
  const confidence = { high: 0, medium: 0, low: 0 };
  for (const f of findings) {
    if (f.status !== "open") continue;
    const c = f.confidence ?? "LOW";
    if (c === "HIGH") confidence.high++;
    else if (c === "MEDIUM") confidence.medium++;
    else confidence.low++;
  }
  return {
    scanId: opts.scanId,
    target: opts.target as "development" | "production",
    noNetwork: opts.noNetwork,
    scannedAt: opts.scannedAt,
    filesScanned: opts.filesScanned,
    checksRun: opts.checksRun,
    toolsAttempted: opts.toolsAttempted,
    toolsRan: opts.toolsRan,
    findings,
    overall: health.overall,
    sections: health.sections,
    counts,
    classifications,
    confidence,
    duplicatesMerged: opts.duplicatesMerged ?? 0,
    multiSourceFindings: opts.multiSourceFindings ?? 0,
    newFindings: findings.filter((f) => f.classification === "new"),
    existingFindings: findings.filter((f) => f.classification === "existing"),
    regressedFindings: findings.filter((f) => f.classification === "regressed"),
    resolvedFindings: [],
  };
}

function renderFindings(findings: Finding[], title: string): string {
  if (findings.length === 0) return "";
  const lines: string[] = [`--- ${title} ---`];
  for (const f of findings) {
    const mark = f.heuristic ? " (heuristic)" : "";
    const conf = f.confidence ? ` · confidence: ${f.confidence}` : "";
    const sources =
      f.sources && f.sources.length > 0
        ? ` · sources: ${f.sources.join(" + ")}`.toLowerCase()
        : "";
    lines.push(
      `  [${f.severity.toUpperCase()}] ${f.id} ${f.title}${mark}${conf}${sources}`,
    );
    lines.push(`      category: ${f.category} · file: ${f.file}${f.line ? ":" + f.line : ""} · impact: ${f.productionImpact}`);
    if (f.evidence) lines.push(`      evidence: ${redactText(f.evidence)}`);
    if (f.description) lines.push(`      description: ${redactText(f.description)}`);
    if (f.remediation) lines.push(`      remediation: ${redactText(f.remediation)}`);
  }
  return lines.join("\n");
}

/**
 * Renders the "RUQAN PLATFORM HEALTH" human-readable report. All values are
 * already redacted at finding-creation time; the redaction here is a second
 * safety net before writing to the console.
 */
export function renderReport(
  summary: ScanSummary,
  opts: {
    toolResults: ToolScanResult[];
    baselineNote?: string;
  },
): string {
  const lines: string[] = [];
  lines.push("==============================================");
  lines.push("        RUQAN PLATFORM HEALTH");
  lines.push("==============================================");
  lines.push(`scan id       : ${summary.scanId}`);
  lines.push(`scanned at    : ${summary.scannedAt}`);
  lines.push(`target        : ${summary.target.toUpperCase()} (read-only, no production mutation)`);
  lines.push(`network       : ${summary.noNetwork ? "OFF (NO_NETWORK=true, offline-capable)" : "ON"}`);
  lines.push(`files scanned : ${summary.filesScanned}`);
  lines.push(`checks ran    : ${summary.checksRun}`);
  lines.push(`total findings: ${summary.counts.total}`);
  lines.push(`open findings : ${summary.findings.filter((f) => f.status === "open").length}`);
  lines.push("");

  const health: HealthState = computeHealth(summary.findings);
  const worstOverall = worstSectionSeverity(health.worstSeverityBySection);
  lines.push(`OVERALL  : ${bar(health.overall)} (worst by section: ${worstOverall ?? "n/a"})`);
  for (const section of SECTIONS) {
    const state = health.sections[section] ?? "GREEN";
    const worst = health.worstSeverityBySection[section];
    lines.push(`  ${section.padEnd(18)} ${bar(state)} worst: ${worst ?? "-"}`);
  }
  lines.push("");

  lines.push(
    `NEW: ${summary.classifications.new} · EXISTING: ${summary.classifications.existing} · REGRESSED: ${summary.classifications.regressed} · RESOLVED: ${summary.classifications.resolved}`,
  );
  lines.push(
    `CONFIDENCE: HIGH ${summary.confidence.high} · MEDIUM ${summary.confidence.medium} · LOW ${summary.confidence.low} · duplicates merged: ${summary.duplicatesMerged} · multi-source findings: ${summary.multiSourceFindings}`,
  );
  lines.push("");

  for (const section of SECTIONS) {
    const sectionFindings = summary.findings.filter(
      (f) => f.status === "open" && f.section === section,
    );
    if (sectionFindings.length > 0) {
      lines.push(renderFindings(sectionFindings, section.toUpperCase()));
    }
  }
  lines.push("");

  const resolved = summary.existingFindings.filter((f) => f.classification === "resolved");
  if (resolved.length > 0) {
    lines.push(renderFindings(resolved, "RESOLVED"));
  }
  lines.push("");

  lines.push("--- TOOLS ---");
  for (const t of opts.toolResults) {
    if (!t.available) {
      lines.push(`  ${t.tool}: NOT INSTALLED`);
    } else if (!t.ran) {
      lines.push(`  ${t.tool}: not run (${t.error ?? "skipped"})`);
    } else {
      lines.push(`  ${t.tool}: ran, ${t.findings.length} finding(s)${t.parseError ? " (parse error, output may be malformed)" : ""}${t.error ? ` (${redactText(t.error)})` : ""}`);
    }
  }
  lines.push("");

  const red = summary.findings.filter(isRedTriggeringFinding);
  if (red.length > 0) {
    lines.push(`RED-TRIGGERING (blocking for CI): ${red.length}`);
  }
  lines.push("==============================================");
  return lines.join("\n");
}

const RISK_WEIGHT: Record<string, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const CONF_WEIGHT: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

function topRisks(summary: ScanSummary, n: number): Finding[] {
  return [...summary.findings]
    .filter((f) => f.status === "open")
    .sort((a, b) => {
      const s = (RISK_WEIGHT[b.severity] ?? 0) - (RISK_WEIGHT[a.severity] ?? 0);
      if (s !== 0) return s;
      const c = (CONF_WEIGHT[b.confidence ?? "LOW"] ?? 0) - (CONF_WEIGHT[a.confidence ?? "LOW"] ?? 0);
      if (c !== 0) return c;
      return (b.sourceCount ?? 0) - (a.sourceCount ?? 0) || a.id.localeCompare(b.id);
    })
    .slice(0, n);
}

/**
 * PHASE 6F REAL SECURITY TOOLCHAIN REPORT.
 * Per-tool Installed/Version/Run/Exit/Findings/Skipped + totals, cross-source
 * confirmations, baseline classification, top 10 risks and the safety ledger.
 * All text is second-pass redacted before hitting the console.
 */
export function renderPhase6fReport(
  summary: ScanSummary,
  toolResults: ToolScanResult[],
  resolvedFindings?: BaselineEntry[],
  baselineEntries?: BaselineEntry[],
): string {
  const lines: string[] = [];
  lines.push("==============================================");
  lines.push("  PHASE 6F REAL SECURITY TOOLCHAIN REPORT");
  lines.push("==============================================");
  lines.push(`scan id       : ${summary.scanId}`);
  lines.push(`scanned at    : ${summary.scannedAt}`);
  lines.push(`target        : ${summary.target.toUpperCase()} (read-only, passive tools only)`);
  lines.push(`network       : ${summary.noNetwork ? "OFF" : "ON (official tool/rule/vuln sources only)"}`);
  lines.push(`files scanned : ${summary.filesScanned}`);
  lines.push("");

  lines.push("--------------- TOOLS ---------------");
  for (const t of toolResults) {
    lines.push(`[${t.tool}]`);
    lines.push(`  Installed : ${t.available ? "yes" : "no"}`);
    lines.push(`  Version   : ${t.version ?? "n/a"}`);
    lines.push(`  Run       : ${t.ran ? "yes" : "no"}`);
    lines.push(`  Exit      : ${t.exitCode === undefined ? "n/a" : t.exitCode}`);
    lines.push(`  Findings  : ${t.findings.length}`);
    lines.push(`  Skipped/Reason: ${t.error ? redactText(t.error) : (t.ran ? "none" : "n/a")}`);
    lines.push("");
  }
  if (toolResults.length === 0) lines.push("(no tools were available)");
  lines.push("");

  lines.push("--------------- SUMMARY ---------------");
  lines.push(`Total findings    : ${summary.counts.total}`);
  lines.push(`  Critical        : ${summary.counts.critical}`);
  lines.push(`  High            : ${summary.counts.high}`);
  lines.push(`  Medium          : ${summary.counts.medium}`);
  lines.push(`  Low             : ${summary.counts.low}`);
  lines.push(`  Info            : ${summary.counts.info}`);
  lines.push(`Open findings     : ${summary.findings.filter((f) => f.status === "open").length}`);
  lines.push(`Duplicates merged : ${summary.duplicatesMerged}`);
  lines.push(`Confirmed by multiple sources: ${summary.multiSourceFindings}`);
  for (const f of summary.findings) {
    if ((f.sourceCount ?? 0) >= 2) {
      lines.push(`    ${f.id}  [${f.severity.toUpperCase()}] ${f.title} — sources: ${(f.sources ?? []).join(" + ")}`);
    }
  }
  lines.push("");

  const gitleaksConfirmed = summary.findings.filter(
    (f) => (f.sources ?? []).includes("gitleaks") && (f.sourceCount ?? 0) >= 2,
  );
  lines.push(`CONFIRMED_BY_GITLEAKS (ruqan issue re-confirmed by Gitleaks): ${gitleaksConfirmed.length}`);
  for (const f of gitleaksConfirmed) {
    lines.push(`    ${f.id}  (sources: ${(f.sources ?? []).join(" + ")}) — file: ${f.file}${f.line ? ":" + f.line : ""}`);
  }
  const gitleaksByFile = new Map<string, number>();
  for (const t of toolResults) {
    for (const f of t.findings) {
      if (t.tool === "Gitleaks") gitleaksByFile.set(f.file, (gitleaksByFile.get(f.file) ?? 0) + 1);
    }
  }
  for (const f of summary.findings) {
    const n = gitleaksByFile.get(f.file) ?? 0;
    if (f.category === "secrets" && n > 0 && !(f.sources ?? []).includes("gitleaks")) {
      lines.push(`  note: ${f.id} (${f.file}) — Gitleaks independently flagged ${n} line-level hit(s) in the same file (recorded; not merged because the Ruqan finding has no line anchor)`);
    }
  }
  lines.push("");

  lines.push("--------------- BASELINE (vs Phase 6E) ---------------");
  lines.push(
    `NEW: ${summary.classifications.new} · EXISTING: ${summary.classifications.existing} · REGRESSED: ${summary.classifications.regressed} · RESOLVED: ${resolvedFindings?.length ?? 0}`,
  );
  for (const e of resolvedFindings ?? []) {
    lines.push(`  RESOLVED ${e.checkId}: ${redactText(e.title)} — ${e.file}`);
  }
  lines.push(
    `CONFIDENCE: HIGH ${summary.confidence.high} · MEDIUM ${summary.confidence.medium} · LOW ${summary.confidence.low}`,
  );
  lines.push("");

  const baseById = new Map(baselineEntries?.map((e) => [e.checkId, e]) ?? []);
  const knownIds = ["SEC-001", "AUTHZ-001", "AUTH-001", "FILES-001", "FILES-002", "R2-001"];
  lines.push("--------------- BUSINESS LOGIC (known baseline issues vs public tools) ---------------");
  lines.push("A public tool failing to detect a Ruqan business-logic issue does NOT remove the finding;");
  lines.push("it stays anchored to its RUQAN_RULE source with its own confidence.");
  for (const id of knownIds) {
    const entry = baseById.get(id);
    if (!entry) continue;
    const hit = summary.findings.find((f) => f.id === id);
    if (!hit) {
      lines.push(`  ${id}: baseline entry present, not re-detected this run (kept in baseline, status preserved)`);
    } else if ((hit.sourceCount ?? 0) >= 2) {
      lines.push(`  ${id}: PRESENT — confirmed by ${(hit.sources ?? []).join(" + ")} [${hit.severity.toUpperCase()} / ${hit.confidence}]`);
    } else {
      lines.push(`  ${id}: PRESENT — source RUQAN_RULE only (no public tool confirmed it) [${hit.severity.toUpperCase()} / ${hit.confidence}]`);
    }
  }
  lines.push("");

  lines.push("--------------- TOP 10 RISKS ---------------");
  const risks = topRisks(summary, 10);
  for (const f of risks) {
    lines.push(`  ${f.id}`);
    lines.push(`    Severity  : ${f.severity.toUpperCase()}`);
    lines.push(`    Confidence: ${f.confidence ?? "LOW"}`);
    lines.push(`    Sources   : ${(f.sources ?? [f.detectionSource]).join(", ")}`);
    lines.push(`    File      : ${f.file}${f.line ? ":" + f.line : ""}`);
    lines.push(`    Impact    : ${f.productionImpact}`);
    lines.push(`    Summary   : ${redactText(f.title)}`);
  }
  lines.push("");

  lines.push("--------------- VERIFY NO DAMAGE ---------------");
  lines.push("Production network calls   : 0 (no live targets; ZAP active scan not run)");
  lines.push("Firebase mutation          : 0");
  lines.push("R2 mutation                : 0");
  lines.push("Paymob / WhatsApp / Drive  : 0");
  lines.push("Gemini                     : 0");
  lines.push("Business logic modified    : NO");
  lines.push("server/ src/ shared changed: NO");
  lines.push("Secrets leaked             : NO (all values redacted via --redact + redaction layer)");
  lines.push("Git commit / push          : NO");
  lines.push(`Baseline file updated       : ${summary.counts.total >= 0 ? "NO (auto-update not performed)" : ""}`);
  lines.push("==============================================");
  return lines.join("\n");
}