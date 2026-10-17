import {
  computeOverallHealth,
  computeSectionHealth,
  groupBySection,
} from "./severity";
import type { Finding, Health, Section, Severity } from "./types";

export interface HealthState {
  overall: Health;
  sections: Partial<Record<Section, Health>>;
  worstSeverityBySection: Partial<Record<Section, Severity | null>>;
  openCount: number;
  redCount: number;
}

/**
 * Produces the overall + per-section health state. Section granularity follows
 * the report areas (Security, Dependencies, Secrets, Authorization, Payments,
 * Files, Firebase, R2, External Services).
 */
export function computeHealth(findings: Finding[]): HealthState {
  const open = findings.filter((f) => f.status === "open");
  const bySection = groupBySection(open);
  const sections: Partial<Record<Section, Health>> = {};
  const worstSeverityBySection: Partial<Record<Section, Severity | null>> = {};
  for (const [section, list] of Object.entries(bySection)) {
    const sh = computeSectionHealth(list);
    sections[section as Section] = sh.state;
    worstSeverityBySection[section as Section] = sh.worst;
  }
  return {
    overall: computeOverallHealth(open),
    sections,
    worstSeverityBySection,
    openCount: open.length,
    redCount: open.filter((f) => f.status === "open" && f.severity === "critical").length,
  };
}

export function worstSectionSeverity(sections: Partial<Record<Section, Severity | null>>): Severity | null {
  let worst: Severity | null = null;
  for (const s of Object.values(sections)) {
    if (!s) continue;
    if (worst === null || (SEVERITY_RANK[s] ?? 0) > (SEVERITY_RANK[worst] ?? 0)) worst = s;
  }
  return worst;
}

const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};