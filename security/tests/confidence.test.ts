import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeConfidence, mapToolSeverity, sourcesOf, baseSourceStrength } from "../src/confidence";
import type { DetectionSource, Finding, Severity } from "../src/types";

function mk(source: DetectionSource, severity: Severity, heuristic?: boolean): Finding {
  return {
    id: "T",
    severity,
    category: "secrets",
    section: "Secrets",
    title: "t",
    description: "",
    evidence: "",
    file: "a.ts",
    detectionSource: source,
    productionImpact: "UNKNOWN",
    status: "open",
    classification: "new",
    fingerprint: "x",
    heuristic,
  };
}

describe("computeConfidence", () => {
  it("critical is always HIGH", () => {
    assert.equal(computeConfidence(["semgrep"], "critical"), "HIGH");
  });

  it("single dedicated detector is HIGH", () => {
    assert.equal(computeConfidence(["gitleaks"], "high"), "HIGH");
    assert.equal(computeConfidence(["codeql"], "medium"), "HIGH");
    assert.equal(computeConfidence(["zap"], "high"), "HIGH");
  });

  it("single generic/advisory detector is MEDIUM", () => {
    assert.equal(computeConfidence(["semgrep"], "medium"), "MEDIUM");
    assert.equal(computeConfidence(["osv"], "medium"), "MEDIUM");
    assert.equal(computeConfidence(["trivy"], "high"), "MEDIUM");
  });

  it("ruqan static evidence-backed rule is HIGH, heuristic low is LOW", () => {
    assert.equal(computeConfidence(["ruqan-static"], "high"), "HIGH");
    assert.equal(computeConfidence(["ruqan-static"], "medium"), "HIGH");
    assert.equal(computeConfidence(["ruqan-structural"], "low", true), "LOW");
    assert.equal(computeConfidence(["ruqan-static"], "high", true), "HIGH");
    assert.equal(computeConfidence(["ruqan-structural"], "medium", true), "LOW");
  });

  it("two distinct sources agree => HIGH", () => {
    assert.equal(computeConfidence(["ruqan-static", "semgrep"], "medium"), "HIGH");
    assert.equal(computeConfidence(["semgrep", "gitleaks"], "medium"), "HIGH");
  });

  it("baseline-context is LOW and empty sources is LOW", () => {
    assert.equal(computeConfidence(["baseline-context"], "medium"), "LOW");
    assert.equal(computeConfidence([], "low"), "LOW");
  });
});

describe("mapToolSeverity", () => {
  it("maps numeric CVSS ranges", () => {
    assert.equal(mapToolSeverity(9.1), "critical");
    assert.equal(mapToolSeverity(8), "high");
    assert.equal(mapToolSeverity(5), "medium");
    assert.equal(mapToolSeverity(3), "low");
    assert.equal(mapToolSeverity(0), "info");
  });

  it("maps label strings case-insensitively", () => {
    assert.equal(mapToolSeverity("CRITICAL"), "critical");
    assert.equal(mapToolSeverity("High"), "high");
    assert.equal(mapToolSeverity("MODERATE"), "medium");
    assert.equal(mapToolSeverity("Medium"), "medium");
    assert.equal(mapToolSeverity("INFO"), "low");
    assert.equal(mapToolSeverity("LOW"), "low");
  });

  it("unknown/undefined never crash and default to low", () => {
    assert.equal(mapToolSeverity(undefined), "low");
    assert.equal(mapToolSeverity(null), "low");
    assert.equal(mapToolSeverity("nonsense"), "low");
  });
});

describe("sourcesOf", () => {
  it("merges detectionSource with extra sources without duplicates", () => {
    const f: Finding = { ...mk("ruqan-static", "high"), sources: ["ruqan-static", "codeql"] };
    const s = sourcesOf(f);
    assert.deepEqual(s, ["ruqan-static", "codeql"]);
  });

  it("single source lists only the detectionSource", () => {
    assert.deepEqual(sourcesOf(mk("osv", "medium")), ["osv"]);
  });
});

describe("baseSourceStrength", () => {
  it("ranks codeql above semgrep above baseline-context", () => {
    assert.ok(baseSourceStrength("codeql") > baseSourceStrength("semgrep"));
    assert.ok(baseSourceStrength("semgrep") > baseSourceStrength("baseline-context"));
    assert.ok(baseSourceStrength("gitleaks") === baseSourceStrength("zap"));
  });
});