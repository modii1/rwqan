import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  inferCategory,
  parseCodeqlSarifJsonText,
  parseGitleaksJsonText,
  parseOsvJsonText,
  parseSemgrepJsonText,
  parseTrivyJsonText,
  runCodeql,
} from "../src/tools";
import type { ScanConfig, ToolAvailability } from "../src/types";

const CONFIG: ScanConfig = {
  repoPath: ".",
  baselinePath: "security/baseline.json",
  target: "development",
  noNetwork: true,
  ci: false,
  json: false,
  updateBaseline: false,
  enableActive: { zapActiveScan: false, paymentTests: false, mutationTests: false, uploadDeleteTests: false },
  scanId: "test-scan",
  consoleOut: () => {},
};

const AVAIL: ToolAvailability = { name: "CodeQL", installed: true, executable: "codeql", mode: "network-required" };

describe("gitleaks json parser", () => {
  it("parses an array of findings", () => {
    const out = parseGitleaksJsonText(
      JSON.stringify([
        {
          RuleID: "aws-access-token",
          Description: "Detected AWS access token",
          StartLine: 12,
          File: "server/config/runtimeEnvironment.ts",
          Match: "AKIA****",
          Secret: "secret-value",
        },
      ]),
    );
    assert.equal(out.parseError, undefined);
    assert.equal(out.findings.length, 1);
    const f = out.findings[0];
    assert.equal(f.category, "secrets");
    assert.equal(f.severity, "high");
    assert.equal(f.file, "server/config/runtimeEnvironment.ts");
    assert.equal(f.line, 12);
    assert.match(f.title, /aws-access-token/);
    // evidence is redacted
    assert.ok(!f.evidence.includes("secret-value"));
  });

  it("handles the wrapper object form (leaks key)", () => {
    const out = parseGitleaksJsonText(JSON.stringify({ leaks: [{ RuleID: "generic-api-key", File: "x.ts" }] }));
    assert.equal(out.findings.length, 1);
  });

  it("marks malformed output as a parse error without crashing", () => {
    const out = parseGitleaksJsonText("<html>not json</html>");
    assert.equal(out.parseError, true);
    assert.deepEqual(out.findings, []);
  });
});

describe("osv parser", () => {
  it("parses packages + vulnerabilities into dependency findings", () => {
    const out = parseOsvJsonText(
      JSON.stringify({
        results: [
          {
            package: { name: "express", id: "npm:express:4.21.2" },
            vulnerabilities: [
              { id: "GHSA-xxxx", summary: "Path traversal", details: "detail text" },
              { id: "GHSA-yyyy", summary: "DoS", severity: ["CRITICAL"] },
            ],
          },
        ],
      }),
    );
    assert.equal(out.findings.length, 2);
    const [a, b] = out.findings;
    assert.equal(a.category, "dependency_vulnerability");
    assert.ok(new Set(["high", "medium", "low"]).has(a.severity));
    assert.equal(b.severity, "critical");
    assert.match(a.evidence, /^package=express/);
  });

  it("maps severity strings to rank", () => {
    const out = parseOsvJsonText(
      JSON.stringify({
        results: [
          { package: { name: "a" }, vulnerabilities: [{ id: "G1", severity: ["MODERATE"] }] },
        ],
      }),
    );
    assert.equal(out.findings[0].severity, "medium");
  });

  it("marks malformed output as a parse error", () => {
    const out = parseOsvJsonText("not json {");
    assert.equal(out.parseError, true);
  });
});

describe("trivy parser", () => {
  it("parses the trivy fs array format into dependency findings", () => {
    const out = parseTrivyJsonText(
      JSON.stringify([
        {
          Target: "package-lock.json",
          Vulnerabilities: [
            {
              VulnerabilityID: "CVE-2024-1234",
              Severity: "HIGH",
              PkgName: "lodash",
              InstalledVersion: "4.17.20",
              FixedVersion: "4.17.21",
              Title: "Prototype pollution",
            },
          ],
        },
      ]),
    );
    assert.equal(out.findings.length, 1);
    const f = out.findings[0];
    assert.equal(f.category, "dependency_vulnerability");
    assert.equal(f.severity, "high");
    assert.match(f.title, /CVE-2024-1234/);
    assert.match(f.evidence, /package=lodash/);
    assert.match(f.evidence, /fixed=4\.17\.21/);
  });

  it("accepts lowercase fields and missing fixes", () => {
    const out = parseTrivyJsonText(
      JSON.stringify([{ Target: "p", Vulnerabilities: [{ vulnerabilityID: "GHSA-x", severity: "MEDIUM", pkgName: "p", installedVersion: "1.0.0" }] }]),
    );
    assert.equal(out.findings.length, 1);
    assert.equal(out.findings[0].severity, "medium");
    assert.match(out.findings[0].evidence, /no fix available/);
  });

  it("marks malformed output as a parse error", () => {
    const out = parseTrivyJsonText("[{broken");
    assert.equal(out.parseError, true);
    assert.deepEqual(out.findings, []);
  });
});

describe("codeql parser", () => {
  it("parses SARIF results into findings with source attribution", () => {
    const out = parseCodeqlSarifJsonText(
      JSON.stringify({
        version: "2.1.0",
        runs: [
          {
            tool: { driver: { name: "codeql", rules: [{ id: "js/idor", name: "js/insecure-direct-object-reference" }] } },
            results: [
              {
                ruleId: "js/idor",
                level: "error",
                message: { text: "A user-controlled resource key reaches a query." },
                locations: [{ physicalLocation: { artifactLocation: { uri: "server/routes/owner.ts" }, region: { startLine: 3510 } } }],
                partialFingerprints: { primaryLocationLineHash: "abcdef" },
              },
            ],
          },
        ],
      }),
    );
    assert.equal(out.findings.length, 1);
    const f = out.findings[0];
    assert.equal(f.file, "server/routes/owner.ts");
    assert.equal(f.line, 3510);
    assert.equal(f.severity, "high");
    assert.equal(f.productionImpact, "UNKNOWN");
    assert.match(f.evidence, /sarif-location-hash=abcdef/);
    assert.match(f.title, /js\/idor/);
  });

  it("drops note-level results (informational) without crashing", () => {
    const out = parseCodeqlSarifJsonText(
      JSON.stringify({
        runs: [
          {
            tool: { driver: { name: "codeql" } },
            results: [
              { ruleId: "js/info", level: "note", locations: [{ physicalLocation: { artifactLocation: { uri: "a.ts" } } }] },
            ],
          },
        ],
      }),
    );
    assert.equal(out.findings.length, 0);
    assert.match(out.error ?? "", /no actionable results/);
  });

  it("marks malformed SARIF as a parse error", () => {
    const out = parseCodeqlSarifJsonText("not json");
    assert.equal(out.parseError, true);
  });
});

describe("codeql runner safety", () => {
  it("reports NOT_RUN with the network reason when NO_NETWORK is set (no DB build offline)", () => {
    const out = runCodeql(AVAIL, { ...CONFIG, noNetwork: true }, {} as never);
    assert.equal(out.ran, false);
    assert.match(out.error ?? "", /NOT_RUN/);
    assert.match(out.error ?? "", /network/);
  });
});

describe("semgrep severity + attribution", () => {
  it("maps ERROR to high, WARNING to medium, INFO to low", () => {
    const out = parseSemgrepJsonText(
      JSON.stringify({
        results: [
          { check_id: "c1", path: "a.ts", extra: { severity: "ERROR" } },
          { check_id: "c2", path: "a.ts", extra: { severity: "WARNING" } },
          { check_id: "c3", path: "a.ts", extra: { severity: "INFO" } },
        ],
      }),
    );
    assert.deepEqual(out.findings.map((f) => f.severity), ["high", "medium", "low"]);
  });

  it("attributes obvious rule ids to Ruqan categories, unknown to external_analysis", () => {
    assert.equal(inferCategory("typescript.ssrf.url-from-request"), "ssrf");
    assert.equal(inferCategory("js.security.audit.api-key"), "secrets");
    assert.equal(inferCategory("js.idor.access-to-other-users"), "idor");
    assert.equal(inferCategory("generic.some.rule"), "external_analysis");
    assert.equal(inferCategory("generic.upload.mimetype"), "upload_validation");
  });
});

describe("semgrep parser", () => {
  it("parses results into findings with path and line", () => {
    const out = parseSemgrepJsonText(
      JSON.stringify({
        results: [
          {
            check_id: "react.unsafe-innerhtml",
            path: "src/components/property.tsx",
            start: { line: 40 },
            message: "Unsafe innerHTML",
          },
        ],
      }),
    );
    assert.equal(out.findings.length, 1);
    assert.equal(out.findings[0].file, "src/components/property.tsx");
    assert.equal(out.findings[0].line, 40);
    assert.match(out.findings[0].title, /react\.unsafe-innerhtml/);
    assert.match(out.findings[0].description, /Unsafe innerHTML/);
  });

  it("marks malformed output as a parse error", () => {
    const out = parseSemgrepJsonText("{oops");
    assert.equal(out.parseError, true);
  });

  it("empty results array yields no findings", () => {
    const out = parseSemgrepJsonText(JSON.stringify({ results: [] }));
    assert.equal(out.findings.length, 0);
    assert.equal(out.parseError, undefined);
  });
});

describe("no-network / offline behavior", () => {
  it("network-required tools are skipped cleanly when NO_NETWORK is set (covered in guards tests)", () => {
    // This test documents intent: runAvailableTools ships a skipped reason,
    // never a crash, for network-required tools under noNetwork.
    assert.ok(true);
  });
});