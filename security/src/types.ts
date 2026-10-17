export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type FindingStatus = "open" | "resolved";

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export type BaselineClassification = "new" | "existing" | "regressed" | "resolved";

export type Category =
  | "authentication"
  | "authorization"
  | "idor"
  | "admin_authorization"
  | "owner_authorization"
  | "customer_isolation"
  | "firestore_access"
  | "r2_access"
  | "public_private_files"
  | "upload_validation"
  | "payment_flow"
  | "subscription_flow"
  | "renewal_flow"
  | "webhook_validation"
  | "amount_discount_validation"
  | "feature_flags"
  | "external_service_guards"
  | "secrets"
  | "logging"
  | "error_handling"
  | "ssrf"
  | "hardcoded_fallbacks"
  | "production_resource_from_dev"
  | "dead_dependencies"
  | "dependency_vulnerability"
  | "external_analysis"
  | "firebase_isolation";

export type Section =
  | "Security"
  | "Dependencies"
  | "Secrets"
  | "Authorization"
  | "Payments"
  | "Files"
  | "Firebase"
  | "R2"
  | "External Services";

export type DetectionSource =
  | "ruqan-static"
  | "ruqan-structural"
  | "gitleaks"
  | "semgrep"
  | "codeql"
  | "osv"
  | "trivy"
  | "zap"
  | "baseline-context";

export interface Finding {
  id: string;
  severity: Severity;
  category: Category;
  section: Section;
  title: string;
  description: string;
  evidence: string;
  file: string;
  line?: number;
  detectionSource: DetectionSource;
  confidence?: Confidence;
  sources?: string[];
  sourceCount?: number;
  correlationKey?: string;
  affectedFlow?: string;
  productionImpact: "YES" | "NO" | "UNKNOWN";
  devImpact?: string;
  remediation?: string;
  status: FindingStatus;
  classification: BaselineClassification;
  fingerprint: string;
  heuristic?: boolean;
}

export interface BaselineEntry {
  fingerprint: string;
  checkId: string;
  severity: Severity;
  category: Category;
  title: string;
  status: FindingStatus;
  firstDetected: string;
  provenance: string;
  lastSeen: string;
  file?: string;
}

export interface BaselineFile {
  version: number;
  createdAt: string;
  updatedAt: string;
  scanId: string;
  entries: BaselineEntry[];
}

export type Target = "development" | "production";

export interface ActiveScanFlags {
  zapActiveScan: boolean;
  paymentTests: boolean;
  mutationTests: boolean;
  uploadDeleteTests: boolean;
}

export interface ScanConfig {
  repoPath: string;
  baselinePath: string;
  target: Target;
  noNetwork: boolean;
  ci: boolean;
  json: boolean;
  updateBaseline: boolean;
  enableActive: ActiveScanFlags;
  activeTargetUrl?: string;
  scanId: string;
  consoleOut: (line: string) => void;
}

export interface ToolAvailability {
  name: string;
  installed: boolean;
  executable?: string;
  version?: string;
  mode: "offline-capable" | "network-required" | "active-only" | "not-installed";
  skippedReason?: string;
}

export interface ToolScanResult {
  tool: string;
  available: boolean;
  ran: boolean;
  findings: Finding[];
  error?: string;
  parseError?: boolean;
  version?: string;
  exitCode?: number;
}

export interface ScanSummary {
  scanId: string;
  target: Target;
  noNetwork: boolean;
  scannedAt: string;
  filesScanned: number;
  checksRun: number;
  toolsAttempted: number;
  toolsRan: number;
  findings: Finding[];
  overall: Health;
  sections: Partial<Record<Section, Health>>;
  counts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    total: number;
  };
  classifications: Record<BaselineClassification, number>;
  confidence: { high: number; medium: number; low: number };
  duplicatesMerged: number;
  multiSourceFindings: number;
  newFindings: Finding[];
  existingFindings: Finding[];
  regressedFindings: Finding[];
  resolvedFindings: BaselineEntry[];
}

export type Health = "GREEN" | "ORANGE" | "RED";

export const SEVERITY_ORDER: Severity[] = [
  "info",
  "low",
  "medium",
  "high",
  "critical",
];