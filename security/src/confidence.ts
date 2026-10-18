import type { Confidence, DetectionSource, Finding, Severity } from "./types";

/**
 * Confidence model for Phase 6E enrichment.
 *
 * Confidence is a synthesis of:
 *  - source fidelity (committed detection source),
 *  - cross-source agreement (how many distinct tools/rules flag the same
 *    underlying issue),
 *  - heuristics (a regex/local rule is weaker than a dataflow/IOU result),
 *  - severity.
 *
 * Rules (locked by tests):
 *  - critical => HIGH (never downgraded).
 *  - >= 2 distinct detection sources agree on the same issue => HIGH.
 *  - A single dedicated but deterministic auto-detector
 *    (gitleaks with a `--no-git` working-tree hit, codeql dataflow rule,
 *    zap active confirmation) is treated as HIGH.
 *  - A single generic/broad detector (semgrep p/security-audit hit,
 *    advisory scanner osv/trivy) is MEDIUM.
 *  - A ruqan heuristic/local rule alone is LOW unless severity >= high.
 */

const DEDICATED_SOURCES: ReadonlySet<DetectionSource> = new Set([
  "gitleaks",
  "codeql",
  "zap",
]);

const ADVISORY_SOURCES: ReadonlySet<DetectionSource> = new Set([
  "osv",
  "trivy",
]);

const GENERIC_SOURCES: ReadonlySet<DetectionSource> = new Set(["semgrep"]);

export function baseSourceStrength(source: DetectionSource): 0 | 1 | 2 | 3 {
  switch (source) {
    case "codeql":
      return 3; // dataflow / taint, highest fidelity
    case "gitleaks":
      return 2; // deterministic secret scan
    case "zap":
      return 2; // active confirmation
    case "ruqan-static":
      return 2; // evidence-backed local rule
    case "ruqan-structural":
      return 1; // structural/heuristic local rule
    case "semgrep":
      return 1; // generic registry rules
    case "osv":
      return 1; // advisory DB lookup
    case "trivy":
      return 1; // advisory DB lookup
    case "baseline-context":
      return 0; // inherited prior state, no new evidence
    default:
      return 1;
  }
}

/**
 * Compute a single confidence for a finding carrying evidence from zero or
 * more detection sources.
 */
export function computeConfidence(
  sources: DetectionSource[],
  severity: Severity,
  heuristic?: boolean,
): Confidence {
  const distinct = new Set(sources);
  if (severity === "critical") return "HIGH";
  if (distinct.size >= 2) return "HIGH";
  if (distinct.size === 0) return "LOW";

  const only = [...distinct][0];
  if (DEDICATED_SOURCES.has(only)) return "HIGH";
  if (ADVISORY_SOURCES.has(only)) return "MEDIUM";
  if (GENERIC_SOURCES.has(only)) return "MEDIUM";
  // ruqan sources
  if (only === "baseline-context") return "LOW";
  if (heuristic) return severity === "high" ? "HIGH" : "LOW";
  return "HIGH";
}

/**
 * Normalise a raw security severity string from an external tool into our
 * Severity model, without letting the util invent evidence.
 */
export function mapToolSeverity(raw: string | number | undefined | null): Severity {
  if (raw === undefined || raw === null) return "low";
  const s = String(raw).toLowerCase();
  if (typeof raw === "number") {
    if (raw >= 9) return "critical";
    if (raw >= 7) return "high";
    if (raw >= 4) return "medium";
    if (raw >= 1) return "low";
    return "info";
  }
  if (s.includes("critical") || s.includes("9.0")) return "critical";
  if (s.includes("high") || s.startsWith("7.") || s.startsWith("8.")) return "high";
  if (s.includes("medium") || s.includes("moderate") || s.startsWith("4.") || s.startsWith("5.") || s.startsWith("6.")) return "medium";
  if (s.includes("low") || s.includes("info")) return "low";
  return "low";
}

export function sourcesOf(finding: Finding): DetectionSource[] {
  const out = [finding.detectionSource];
  for (const s of finding.sources ?? []) {
    const d = s as DetectionSource;
    if (!out.includes(d)) out.push(d);
  }
  return out;
}