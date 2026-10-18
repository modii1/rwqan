import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeOverallHealth,
  computeSectionHealth,
  isRedTriggeringFinding,
  rankSeverity,
  severityAtLeast,
  summarizeFindings,
  worstSeverity,
} from "../src/severity";
import { computeHealth } from "../src/engine";
import type { Finding, Severity } from "../src/types";

function finding(partial: Partial<Finding>): Finding {
  return {
    id: "T",
    severity: "medium",
    category: "authorization",
    section: "Authorization",
    title: "t",
    description: "",
    evidence: "",
    file: "a.ts",
    line: 1,
    detectionSource: "ruqan-static",
    affectedFlow: undefined,
    productionImpact: "NO",
    remediation: undefined,
    status: "open",
    classification: "new",
    fingerprint: "fp",
    heuristic: false,
    ...partial,
  };
}

describe("severity", () => {
  it("ranks severities in order info<low<medium<high<critical", () => {
    assert.ok(rankSeverity("info") < rankSeverity("low"));
    assert.ok(rankSeverity("low") < rankSeverity("medium"));
    assert.ok(rankSeverity("medium") < rankSeverity("high"));
    assert.ok(rankSeverity("high") < rankSeverity("critical"));
  });

  it("worstSeverity picks the stronger of two", () => {
    assert.equal(worstSeverity("low", "high"), "high");
    assert.equal(worstSeverity("high", "low"), "high");
    assert.equal(worstSeverity("medium", "medium"), "medium");
  });

  it("severityAtLeast thresholds", () => {
    assert.equal(severityAtLeast("high", "medium"), true);
    assert.equal(severityAtLeast("low", "medium"), false);
  });
});

describe("health classification", () => {
  it("GREEN when no open findings", () => {
    assert.equal(computeOverallHealth([]), "GREEN");
    const sh = computeSectionHealth([finding({ status: "resolved" })]);
    assert.equal(sh.state, "GREEN");
  });

  it("ORANGE for open medium+ without red-trigger", () => {
    const f = finding({ severity: "high", category: "logging" });
    assert.equal(computeOverallHealth([f]), "ORANGE");
    assert.equal(computeSectionHealth([f]).state, "ORANGE");
  });

  it("RED for critical regardless of category", () => {
    const f = finding({ severity: "critical", category: "logging" });
    assert.equal(computeOverallHealth([f]), "RED");
    assert.equal(isRedTriggeringFinding(f), true);
  });

  it("RED for high in a red-trigger category", () => {
    const f = finding({ severity: "high", category: "idor" });
    assert.equal(isRedTriggeringFinding(f), true);
    assert.equal(computeOverallHealth([f]), "RED");
  });

  it("NOT red for high in a non-red-trigger category (e.g. logging)", () => {
    const f = finding({ severity: "high", category: "logging" });
    assert.equal(isRedTriggeringFinding(f), false);
  });

  it("computeHealth returns overall + per-section state", () => {
    const findings = [
      finding({ severity: "medium", category: "logging", section: "Security" }),
      finding({ severity: "high", category: "idor", section: "Authorization" }),
    ];
    const h = computeHealth(findings);
    assert.equal(h.overall, "RED");
    assert.equal(h.sections.Security, "ORANGE");
    assert.equal(h.sections.Authorization, "RED");
    assert.equal(h.redCount, 0);
    assert.equal(h.openCount, 2);
  });

  it("computeHealth with a critical counts redCount", () => {
    const h = computeHealth([finding({ severity: "critical", category: "secrets" })]);
    assert.equal(h.overall, "RED");
    assert.equal(h.redCount, 1);
  });
});

describe("summarizeFindings", () => {
  it("counts each severity bucket and total", () => {
    const counts = summarizeFindings([
      finding({ severity: "high" }),
      finding({ severity: "medium" }),
      finding({ severity: "low", status: "resolved" }),
    ]);
    assert.equal(counts.high, 1);
    assert.equal(counts.medium, 1);
    assert.equal(counts.low, 0);
    assert.equal(counts.total, 3);
  });
});

describe("bad inputs", () => {
  it("handles empty input safely", () => {
    assert.deepEqual(computeHealth([]), {
      overall: "GREEN",
      sections: {},
      worstSeverityBySection: {},
      openCount: 0,
      redCount: 0,
    });
  });

  it("severityAtLeast with unknown value does not crash", () => {
    assert.equal(severityAtLeast("info" as Severity, "medium"), false);
  });
});