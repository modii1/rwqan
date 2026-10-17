import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { hashValue } from "./redact";
import { sectionOf } from "./severity";
import type {
  BaselineClassification,
  BaselineEntry,
  BaselineFile,
  Finding,
  FindingStatus,
} from "./types";

export const BASELINE_VERSION = 1;

export interface BaselineDiff {
  entries: BaselineEntry[];
  newFindings: Finding[];
  existingFindings: Finding[];
  regressedFindings: Finding[];
  resolvedFindings: BaselineEntry[];
  counts: Record<BaselineClassification, number>;
}

/**
 * Deterministic fingerprint for a finding. Derived from a short hash of the
 * finding id + file + line so the baseline stays stable across runs even when
 * heuristic tilte/phrases drift.
 */
export function fingerprintOf(f: Pick<Finding, "id" | "file" | "line" | "title">): string {
  return hashValue(`${f.id}|${f.file}|${f.line ?? 0}|${f.title}`);
}

export function loadBaseline(path: string): BaselineFile | null {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as BaselineFile;
    if (!parsed || typeof parsed.version !== "number" || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function createBaseline(entries: BaselineEntry[] = []): BaselineFile {
  const now = new Date().toISOString();
  return {
    version: BASELINE_VERSION,
    createdAt: now,
    updatedAt: now,
    scanId: "",
    entries,
  };
}

export function saveBaseline(file: BaselineFile, path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(file, null, 2), "utf8");
}

/**
 * Diffs the current scan findings against the stored baseline and returns
 * the four classification buckets plus the merged baseline entry list.
 *
 * Semantics:
 *  - NEW: fingerprint not present in the baseline at all.
 *  - EXISTING: fingerprint present and was already open (status "open").
 *  - REGRESSED: fingerprint present but marked resolved earlier; open again now.
 *  - RESOLVED: fingerprint present and open in baseline, but no longer detected.
 */
export function diffBaseline(
  baseline: BaselineFile | null,
  findings: Finding[],
  today: string,
  provenance: string,
): BaselineDiff {
  const prev = new Map<string, BaselineEntry>();
  for (const entry of baseline?.entries ?? []) {
    prev.set(entry.fingerprint, entry);
  }

  const newFindings: Finding[] = [];
  const existingFindings: Finding[] = [];
  const regressedFindings: Finding[] = [];
  const entries: BaselineEntry[] = [];
  const counts: Record<BaselineClassification, number> = {
    new: 0,
    existing: 0,
    regressed: 0,
    resolved: 0,
  };

  const seen = new Set<string>();
  for (const f of findings) {
    const fp = fingerprintOf(f);
    seen.add(fp);
    const prior = prev.get(fp);
    let classification: BaselineClassification;
    let status: FindingStatus = "open";
    if (!prior) {
      classification = "new";
    } else if (prior.status === "resolved") {
      classification = "regressed";
    } else {
      classification = "existing";
    }
    counts[classification]++;
    entries.push({
      fingerprint: fp,
      checkId: f.id,
      severity: f.severity,
      category: f.category,
      title: f.title,
      status,
      firstDetected: prior?.firstDetected ?? today,
      provenance: prior?.provenance ?? provenance,
      lastSeen: today,
      file: f.file,
    });
    const withClass: Finding = {
      ...f,
      fingerprint: fp,
      classification,
    };
    if (classification === "new") newFindings.push(withClass);
    if (classification === "existing") existingFindings.push(withClass);
    if (classification === "regressed") regressedFindings.push(withClass);
  }

  const resolvedFindings: BaselineEntry[] = [];
  for (const [fp, entry] of prev) {
    if (seen.has(fp)) continue;
    if (entry.status !== "resolved") {
      counts.resolved++;
      resolvedFindings.push({ ...entry, status: "resolved", lastSeen: today });
      entries.push({ ...entry, status: "resolved", lastSeen: today });
    } else {
      entries.push(entry);
    }
  }

  return {
    entries,
    newFindings,
    existingFindings,
    regressedFindings,
    resolvedFindings,
    counts,
  };
}

export function entryToFinding(entry: BaselineEntry): Finding | null {
  if (!entry.checkId) return null;
  return {
    id: entry.checkId,
    severity: entry.severity,
    category: entry.category,
    section: sectionOf(entry.category),
    title: entry.title,
    description: "",
    evidence: "",
    file: entry.file ?? "",
    detectionSource: "baseline-context",
    affectedFlow: undefined,
    productionImpact: "UNKNOWN",
    remediation: undefined,
    status: entry.status,
    classification: entry.status === "resolved" ? "resolved" : "existing",
    fingerprint: entry.fingerprint,
  };
}