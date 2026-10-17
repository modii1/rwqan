import {
  SEVERITY_ORDER,
  type Category,
  type Finding,
  type Section,
  type Severity,
} from "./types";

export function rankSeverity(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

export function worstSeverity(a: Severity, b: Severity): Severity {
  return rankSeverity(a) >= rankSeverity(b) ? a : b;
}

export function severityAtLeast(severity: Severity, threshold: Severity): boolean {
  return rankSeverity(severity) >= rankSeverity(threshold);
}

/**
 * A finding forces RED health when it is critical, or high-severity AND part of
 * a breach-of-trust category (authorization/IDOR, secrets, production resource
 * usage from DEV, or payment/business-logic manipulation).
 */
export const RED_TRIGGER_CATEGORIES: ReadonlySet<Category> = new Set([
  "authorization",
  "idor",
  "admin_authorization",
  "owner_authorization",
  "customer_isolation",
  "secrets",
  "production_resource_from_dev",
  "payment_flow",
  "subscription_flow",
  "renewal_flow",
  "webhook_validation",
  "amount_discount_validation",
]);

export const CATEGORY_TO_SECTION: Record<Category, Section> = {
  authentication: "Security",
  authorization: "Authorization",
  idor: "Authorization",
  admin_authorization: "Authorization",
  owner_authorization: "Authorization",
  customer_isolation: "Authorization",
  firestore_access: "Firebase",
  r2_access: "R2",
  public_private_files: "Files",
  upload_validation: "Files",
  payment_flow: "Payments",
  subscription_flow: "Payments",
  renewal_flow: "Payments",
  webhook_validation: "Payments",
  amount_discount_validation: "Payments",
  feature_flags: "Security",
  external_service_guards: "External Services",
  secrets: "Secrets",
  logging: "Security",
  error_handling: "Security",
  ssrf: "Security",
  hardcoded_fallbacks: "External Services",
  production_resource_from_dev: "External Services",
  dead_dependencies: "Dependencies",
  dependency_vulnerability: "Dependencies",
  external_analysis: "Security",
  firebase_isolation: "Firebase",
};

export function sectionOf(category: Category): Section {
  return CATEGORY_TO_SECTION[category];
}

export function isRedTriggeringFinding(f: Finding): boolean {
  if (f.status !== "open") return false;
  if (f.severity === "critical") return true;
  if (
    f.severity === "high" &&
    RED_TRIGGER_CATEGORIES.has(f.category)
  ) {
    return true;
  }
  return false;
}

export type Health = "GREEN" | "ORANGE" | "RED";

export interface SectionHealth {
  state: Health;
  worst: Severity | null;
  total: number;
}

export function computeSectionHealth(findings: Finding[]): SectionHealth {
  const open = findings.filter((f) => f.status === "open");
  if (open.length === 0) return { state: "GREEN", worst: null, total: 0 };
  let worst: Severity = "info";
  for (const f of open) worst = worstSeverity(worst, f.severity);
  if (open.some(isRedTriggeringFinding)) {
    return { state: "RED", worst, total: open.length };
  }
  if (open.some((f) => severityAtLeast(f.severity, "medium"))) {
    return { state: "ORANGE", worst, total: open.length };
  }
  return { state: "GREEN", worst, total: open.length };
}

export function computeOverallHealth(findings: Finding[]): Health {
  const open = findings.filter((f) => f.status === "open");
  if (open.some(isRedTriggeringFinding)) return "RED";
  if (open.some((f) => severityAtLeast(f.severity, "medium"))) return "ORANGE";
  return "GREEN";
}

export function groupBySection(
  findings: Finding[],
): Partial<Record<Section, Finding[]>> {
  const out: Partial<Record<Section, Finding[]>> = {};
  for (const f of findings) {
    if (f.status !== "open") continue;
    (out[f.section] ??= []).push(f);
  }
  return out;
}

export function summarizeFindings(findings: Finding[]) {
  const counts = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
    total: findings.length,
  };
  for (const f of findings) {
    if (f.status !== "open") continue;
    counts[f.severity]++;
  }
  return counts;
}