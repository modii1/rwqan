import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createBaseline,
  diffBaseline,
  fingerprintOf,
  loadBaseline,
  saveBaseline,
} from "../src/baseline";
import type { Finding } from "../src/types";

let tmp: string;

function mkFinding(extra: Partial<Finding> = {}): Finding {
  return {
    id: "SEC-001",
    severity: "critical",
    category: "secrets",
    section: "Secrets",
    title: "x",
    description: "",
    evidence: "",
    file: "a.ts",
    line: 3,
    detectionSource: "ruqan-static",
    affectedFlow: undefined,
    productionImpact: "YES",
    remediation: "fix",
    status: "open",
    classification: "new",
    fingerprint: "",
    heuristic: false,
    ...extra,
  };
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("fingerprintOf", () => {
  it("is deterministic and location-sensitive", () => {
    const f = mkFinding();
    assert.equal(fingerprintOf(f), fingerprintOf(f));
    assert.notEqual(
      fingerprintOf(f),
      fingerprintOf({ ...f, line: 4 }),
    );
  });
});

describe("baseline io", () => {
  it("loadBaseline returns null for missing/garbage files", () => {
    tmp = mkdtempSync(join(tmpdir(), "ruqan-baseline-"));
    const bad = join(tmp, "bad.json");
    writeFileSync(bad, "not json");
    assert.equal(loadBaseline(bad), null);
    assert.equal(loadBaseline(join(tmp, "missing.json")), null);
  });

  it("round-trips save -> load", () => {
    tmp = mkdtempSync(join(tmpdir(), "ruqan-baseline-"));
    const path = join(tmp, "baseline.json");
    const file = createBaseline([{ fingerprint: fp("a"), checkId: "A", severity: "low", category: "logging", title: "a", status: "open", firstDetected: "2026-01-01", provenance: "p", lastSeen: "2026-01-01", file: "a.ts" }]);
    saveBaseline(file, path);
    const loaded = loadBaseline(path)!;
    assert.equal(loaded.entries.length, 1);
    assert.equal(loaded.entries[0].checkId, "A");
  });

  function fp(id: string): string {
    return fingerprintOf(mkFinding({ id, file: id + ".ts", line: 1 }));
  }
});

describe("diffBaseline", () => {
  it("classifies a brand-new finding as NEW", () => {
    const today = "2026-10-07T00:00:00Z";
    const d = diffBaseline(null, [mkFinding()], today, "test-provenance");
    assert.equal(d.counts.new, 1);
    assert.equal(d.newFindings.length, 1);
    assert.equal(d.newFindings[0].classification, "new");
    assert.equal(d.entries.length, 1);
    assert.equal(d.entries[0].firstDetected, today);
  });

  it("classifies a known open finding as EXISTING and preserves firstDetected", () => {
    const created = "2026-01-01T00:00:00Z";
    const baseline = createBaseline([
      {
        fingerprint: fingerprintOf(mkFinding()),
        checkId: "SEC-001",
        severity: "critical",
        category: "secrets",
        title: "x",
        status: "open",
        firstDetected: created,
        provenance: "old",
        lastSeen: created,
        file: "a.ts",
      },
    ]);
    const d = diffBaseline(baseline, [mkFinding()], "2026-10-07T00:00:00Z", "new-provenance");
    assert.equal(d.counts.new, 0);
    assert.equal(d.counts.existing, 1);
    assert.equal(d.existingFindings.length, 1);
    assert.equal(d.existingFindings[0].classification, "existing");
    assert.equal(d.entries[0].firstDetected, created);
    assert.equal(d.entries[0].provenance, "old");
    assert.equal(d.entries[0].lastSeen, "2026-10-07T00:00:00Z");
  });

  it("classifies a reappearing resolved finding as REGRESSED", () => {
    const baseline = createBaseline([
      {
        fingerprint: fingerprintOf(mkFinding()),
        checkId: "SEC-001",
        severity: "critical",
        category: "secrets",
        title: "x",
        status: "resolved",
        firstDetected: "2026-01-01T00:00:00Z",
        provenance: "old",
        lastSeen: "2026-02-01T00:00:00Z",
        file: "a.ts",
      },
    ]);
    const d = diffBaseline(baseline, [mkFinding()], "2026-10-07T00:00:00Z", "new-provenance");
    assert.equal(d.counts.regressed, 1);
    assert.equal(d.regressedFindings.length, 1);
    assert.equal(d.regressedFindings[0].classification, "regressed");
  });

  it("marks baseline open findings not seen now as RESOLVED", () => {
    const baseline = createBaseline([
      {
        fingerprint: fingerprintOf(mkFinding({ id: "SEC-001" })),
        checkId: "SEC-001",
        severity: "critical",
        category: "secrets",
        title: "x",
        status: "open",
        firstDetected: "2026-01-01T00:00:00Z",
        provenance: "old",
        lastSeen: "2026-01-01T00:00:00Z",
        file: "a.ts",
      },
    ]);
    const d = diffBaseline(baseline, [], "2026-10-07T00:00:00Z", "new-provenance");
    assert.equal(d.counts.resolved, 1);
    assert.equal(d.resolvedFindings.length, 1);
    assert.equal(d.resolvedFindings[0].status, "resolved");
    const merged = d.entries.find((e) => e.fingerprint && e.status === "resolved");
    assert.ok(merged);
  });

  it("keeps already-resolved baseline entries stable (no double-count)", () => {
    const baseline = createBaseline([
      {
        fingerprint: fingerprintOf(mkFinding({ id: "GONE" })),
        checkId: "GONE",
        severity: "low",
        category: "logging",
        title: "gone",
        status: "resolved",
        firstDetected: "2026-01-01T00:00:00Z",
        provenance: "old",
        lastSeen: "2026-01-01T00:00:00Z",
        file: "g.ts",
      },
    ]);
    const d = diffBaseline(baseline, [], "2026-10-07T00:00:00Z", "p");
    assert.equal(d.counts.resolved, 0);
    assert.equal(d.entries.length, 1);
    assert.equal(d.entries[0].status, "resolved");
  });

  it("handles round trip with real files", () => {
    tmp = mkdtempSync(join(tmpdir(), "ruqan-baseline-"));
    const path = join(tmp, "baseline.json");
    const d = diffBaseline(null, [mkFinding()], "2026-10-07T00:00:00Z", "p");
    const file = createBaseline(d.entries);
    saveBaseline(file, path);
    const loaded = loadBaseline(path)!;
    assert.equal(loaded.entries.length, 1);
    assert.equal(readFileSync(path, "utf8").includes("SEC-001"), true);
  });
});