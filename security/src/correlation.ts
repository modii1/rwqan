import { computeConfidence, sourcesOf } from "./confidence";
import type { DetectionSource, Finding, Severity } from "./types";

export const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Correlation engine for Phase 6E.
 *
 * The goal is NOT to lower the finding count; it is to avoid showing the same
 * underlying issue N times when N tools/rules report it. Each merged finding
 * keeps:
 *  - the identity (id + fingerprint) of the strongest anchor so baseline
 *    EXISTING/REGRESSED tracking stays stable across runs,
 *  - a `sources` list of every detection source that observed the issue,
 *  - a single `confidence` derived from source agreement.
 */

export function lineBucket(line?: number): string {
  if (line === undefined || line <= 0) return "NL";
  return `L${Math.floor(line / 5) * 5}`;
}

/** Strip the "[Tool]" prefix so OSV/Trivy/Semgrep hits for one advisory match. */
export function titleStem(title: string): string {
  return title.replace(/^\[(?:Gitleaks|Semgrep|CodeQL|OSV|Trivy|ZAP)\]\s*/i, "").trim();
}

export function clusterKey(f: Finding): string {
  const base = `${f.section}|${f.category}|${f.file}`;
  if (lineBucket(f.line) === "NL") {
    // no line info: cluster on the stemmed title + location to compare apples
    // to apples across tools, while still separating different advisories.
    return `${base}|NL|${titleStem(f.title)}`;
  }
  return `${base}|${lineBucket(f.line)}`;
}

export function rankSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

function anchorPriority(f: Finding): number {
  let p = 0;
  if (f.detectionSource === "ruqan-static" || f.detectionSource === "ruqan-structural") {
    p += f.heuristic ? 3 : 4;
  } else if (f.detectionSource === "codeql") {
    p = 2;
  } else if (f.detectionSource === "gitleaks") {
    p = 2;
  } else if (f.detectionSource === "zap") {
    p = 2;
  } else {
    p = 1;
  }
  return p + SEVERITY_RANK[f.severity];
}

export interface MergeRecord {
  anchor: Finding;
  group: Finding[];
}

export interface CorrelationResult {
  findings: Finding[];
  clusters: MergeRecord[];
  duplicatesMerged: number;
  multiSourceCount: number;
}

/**
 * Merge findings that point at the same underlying issue into one finding.
 * Deterministic: ordered by (cluster key, anchor priority desc, id asc).
 *
 * A cluster is merged ONLY when it contains findings from 2+ distinct
 * detection sources (e.g. a Ruqan rule + Gitleaks + CodeQL flagging the same
 * location). Same-source instances — e.g. DEPS-001 flagging two distinct
 * package.json dependencies on adjacent lines — are different findings and are
 * deliberately kept separate so the count reflects real distinct issues.
 */
export function correlate(findings: Finding[]): CorrelationResult {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = clusterKey(f);
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }

  const clusters: MergeRecord[] = [];
  for (const [key, group] of groups) {
    const distinctSources = new Set(group.map((f) => f.detectionSource));
    if (distinctSources.size < 2) {
      // Single-source group: every member is its own distinct finding.
      for (const f of group) {
        clusters.push({ anchor: enrichAnchor(f, [f], key), group: [f] });
      }
      continue;
    }
    const sorted = [...group].sort((a, b) => {
      const pa = anchorPriority(b) - anchorPriority(a);
      if (pa !== 0) return pa;
      return a.id.localeCompare(b.id);
    });
    const anchor = sorted[0];
    const merged = mergeGroup(anchor, sorted, key);
    clusters.push({ anchor: merged, group: sorted });
  }

  const findingsOut = clusters.map((c) => c.anchor);
  const duplicatesMerged = findings.length - findingsOut.length;
  const multiSourceCount = clusters.filter((c) => (c.anchor.sources?.length ?? 0) >= 2).length;

  return { findings: findingsOut, clusters, duplicatesMerged, multiSourceCount };
}

function enrichAnchor(anchor: Finding, _group: Finding[], key: string): Finding {
  const sources = sourcesOf(anchor);
  return {
    ...anchor,
    sources,
    sourceCount: sources.length,
    confidence: computeConfidence(sources, anchor.severity, anchor.heuristic),
    correlationKey: key,
  };
}

function mergeGroup(anchor: Finding, group: Finding[], key: string): Finding {
  const sources: DetectionSource[] = [];
  for (const f of group) {
    for (const s of sourcesOf(f)) {
      if (!sources.includes(s)) sources.push(s);
    }
  }
  const severity = group.reduce<Severity>((acc, f) => rankSeverity(acc, f.severity), anchor.severity);
  const titles = [...new Set(group.map((f) => f.title))];
  const title = titles.length === 1 ? titles[0] : `${anchor.title} [+${titles.length - 1} related]`;

  const merged: Finding = {
    ...anchor,
    severity,
    title,
    description: group.some((f) => f.description) ? group.map((f) => f.description).filter(Boolean).join(" | ") : anchor.description,
    evidence: anchor.evidence,
    sources,
    sourceCount: sources.length,
    confidence: computeConfidence(sources, severity, anchor.heuristic),
  };
  merged.correlationKey = key;
  return merged;
}