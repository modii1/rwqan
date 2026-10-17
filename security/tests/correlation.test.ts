import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clusterKey, correlate, lineBucket, rankSeverity } from "../src/correlation";
import type { Category, DetectionSource, Finding, Section, Severity } from "../src/types";

function mk(partial: {
  file: string;
  line?: number;
  category: Category;
  section: Section;
  severity: Severity;
  source: DetectionSource;
  title: string;
  id: string;
  fingerprint: string;
  heuristic?: boolean;
}): Finding {
  return {
    id: partial.id,
    severity: partial.severity,
    category: partial.category,
    section: partial.section,
    title: partial.title,
    description: "",
    evidence: "",
    file: partial.file,
    line: partial.line,
    detectionSource: partial.source,
    productionImpact: "UNKNOWN",
    status: "open",
    classification: "new",
    fingerprint: partial.fingerprint,
    heuristic: partial.heuristic,
  };
}

describe("lineBucket + clusterKey", () => {
  it("buckets lines into groups of 5", () => {
    assert.equal(lineBucket(3), "L0");
    assert.equal(lineBucket(6), "L5");
    assert.equal(lineBucket(10), "L10");
  });

  it("line-less findings cluster only by exact title", () => {
    const a = mk({ file: "x.ts", category: "secrets", section: "Secrets", severity: "high", source: "gitleaks", title: "t1", id: "a", fingerprint: "f1" });
    const b = mk({ file: "x.ts", category: "secrets", section: "Secrets", severity: "high", source: "gitleaks", title: "t2", id: "b", fingerprint: "f2" });
    const c = mk({ file: "x.ts", category: "secrets", section: "Secrets", severity: "high", source: "gitleaks", title: "t1", id: "c", fingerprint: "f3" });
    assert.notEqual(clusterKey(a), clusterKey(b));
    assert.equal(clusterKey(a), clusterKey(c));
  });
});

describe("correlate", () => {
  it("keeps the Ruqan anchor fingerprint so baseline stays stable when tools confirm the same issue", () => {
    const ruqan = mk({ file: "x.ts", line: 10, category: "secrets", section: "Secrets", severity: "high", source: "ruqan-static", title: "SEC-001 .env committed", id: "SEC-001", fingerprint: "fp-sec001" });
    const gitleaks = mk({ file: "x.ts", line: 10, category: "secrets", section: "Secrets", severity: "high", source: "gitleaks", title: "[Gitleaks] private-key", id: "TOOL-abc", fingerprint: "fp-gl" });
    const codeql = mk({ file: "x.ts", line: 11, category: "secrets", section: "Secrets", severity: "medium", source: "codeql", title: "[CodeQL] hardcoded-credential", id: "TOOL-def", fingerprint: "fp-cq" });

    const out = correlate([gitleaks, ruqan, codeql]);
    assert.equal(out.findings.length, 1);
    assert.equal(out.duplicatesMerged, 2);
    assert.equal(out.multiSourceCount, 1);

    const merged = out.findings[0];
    assert.equal(merged.id, "SEC-001");
    assert.equal(merged.fingerprint, "fp-sec001");
    assert.equal(merged.severity, "high");
    assert.equal(merged.confidence, "HIGH");
    assert.deepEqual(merged.sources, ["ruqan-static", "gitleaks", "codeql"]);
    assert.equal(merged.sourceCount, 3);
  });

  it("does not merge distinct line-less same-source hits even with the same title", () => {
    // Two line-less OSV advisories with identical titles are still two distinct
    // findings only when they come from the same source; single-source groups
    // are always kept intact.
    const a = mk({ file: "package-lock.json", category: "dependency_vulnerability", section: "Dependencies", severity: "medium", source: "osv", title: "[OSV] GHSA-xxx", id: "O1", fingerprint: "f1" });
    const b = mk({ file: "package-lock.json", category: "dependency_vulnerability", section: "Dependencies", severity: "medium", source: "osv", title: "[OSV] GHSA-xxx", id: "O2", fingerprint: "f2" });
    const out = correlate([a, b]);
    assert.equal(out.findings.length, 2);
    assert.equal(out.duplicatesMerged, 0);
  });

  it("merges identical line-less hits when the sources differ", () => {
    const a = mk({ file: "package-lock.json", category: "dependency_vulnerability", section: "Dependencies", severity: "medium", source: "osv", title: "[OSV] GHSA-xxx", id: "O1", fingerprint: "f1" });
    const b = mk({ file: "package-lock.json", category: "dependency_vulnerability", section: "Dependencies", severity: "medium", source: "trivy", title: "[Trivy] GHSA-xxx", id: "T1", fingerprint: "f2" });
    const out = correlate([a, b]);
    assert.equal(out.findings.length, 1);
    assert.equal(out.duplicatesMerged, 1);
    assert.equal(out.multiSourceCount, 1);
    assert.deepEqual(out.findings[0].sources, ["osv", "trivy"]);
  });

  it("keeps adjacent-line same-source instances separate (e.g. DEPS-001 deps)", () => {
    // passport (line 97) and passport-local (line 98) are distinct dependencies.
    const passport = mk({ file: "package.json", line: 97, category: "dead_dependencies", section: "Dependencies", severity: "low", source: "ruqan-static", title: "unreferenced dependency: passport", id: "DEPS-001", fingerprint: "fp-p" });
    const passportLocal = mk({ file: "package.json", line: 98, category: "dead_dependencies", section: "Dependencies", severity: "low", source: "ruqan-static", title: "unreferenced dependency: passport-local", id: "DEPS-001", fingerprint: "fp-pl" });
    const turbostile = mk({ file: "package.json", line: 22, category: "dead_dependencies", section: "Dependencies", severity: "low", source: "ruqan-static", title: "unreferenced dependency: turnstile", id: "DEPS-001", fingerprint: "fp-t" });
    const out = correlate([passport, passportLocal, turbostile]);
    assert.equal(out.findings.length, 3);
    assert.equal(out.duplicatesMerged, 0);
  });

  it("does not merge unrelated findings (different category or far location)", () => {
    const a = mk({ file: "x.ts", line: 10, category: "secrets", section: "Secrets", severity: "high", source: "gitleaks", title: "[Gitleaks] key", id: "A", fingerprint: "f1" });
    const b = mk({ file: "x.ts", line: 10, category: "ssrf", section: "Security", severity: "high", source: "codeql", title: "[CodeQL] ssrf", id: "B", fingerprint: "f2" });
    const c = mk({ file: "x.ts", line: 80, category: "secrets", section: "Secrets", severity: "high", source: "gitleaks", title: "[Gitleaks] key", id: "C", fingerprint: "f3" });
    const out = correlate([a, b, c]);
    assert.equal(out.findings.length, 3);
    assert.equal(out.duplicatesMerged, 0);
  });

  it("raises severity to the worst in the cluster", () => {
    const a = mk({ file: "x.ts", line: 5, category: "secrets", section: "Secrets", severity: "medium", source: "semgrep", title: "[Semgrep] keystore", id: "A", fingerprint: "f1" });
    const b = mk({ file: "x.ts", line: 5, category: "secrets", section: "Secrets", severity: "critical", source: "codeql", title: "[CodeQL] credential", id: "B", fingerprint: "f2" });
    const out = correlate([a, b]);
    assert.equal(out.findings[0].severity, "critical");
    assert.equal(out.findings[0].confidence, "HIGH");
  });

  it("single heuristic ruqan finding stays LOW confidence and unmerged", () => {
    const a = mk({ file: "x.ts", line: 3, category: "authentication", section: "Security", severity: "medium", source: "ruqan-structural", title: "AUTH-005 weak", id: "AUTH-005", fingerprint: "fp-auth005", heuristic: true });
    const out = correlate([a]);
    assert.equal(out.findings.length, 1);
    assert.equal(out.duplicatesMerged, 0);
    assert.equal(out.findings[0].confidence, "LOW");
  });

  it("deterministic output order (anchor priority then id)", () => {
    const a = mk({ file: "x.ts", line: 20, category: "secrets", section: "Secrets", severity: "high", source: "ruqan-static", title: "SEC", id: "SEC-002", fingerprint: "f1" });
    const b = mk({ file: "x.ts", line: 20, category: "secrets", section: "Secrets", severity: "high", source: "gitleaks", title: "[Gitleaks] x", id: "TOOL-0001", fingerprint: "f2" });
    const first = correlate([a, b]);
    const second = correlate([b, a]);
    assert.deepEqual(first.findings, second.findings);
    assert.equal(first.findings[0].id, "SEC-002");
  });
});

describe("rankSeverity", () => {
  it("picks the more severe of two values", () => {
    assert.equal(rankSeverity("high", "medium"), "high");
    assert.equal(rankSeverity("critical", "high"), "critical");
    assert.equal(rankSeverity("low", "info"), "low");
  });
});