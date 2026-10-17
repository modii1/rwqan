/**
 * RWQAN DEPLOY — shared data model (Phase B prototype, Phase C persistent).
 *
 * This module defines the non-secret release-registry and audit-log shapes used
 * by the development-only deploy console. Nothing here performs a real deploy,
 * connects to production, or stores secrets. All records are presentation data.
 */

export type DeployEnvironment = "TEST" | "LIVE";

/**
 * Lifecycle of a release. `simulated` marks prototype/sandbox records.
 */
export type DeployReleaseStatus =
  | "draft"
  | "validated"
  | "validation_failed"
  | "saved_to_git"
  | "deploying"
  | "deployed"
  | "failed"
  | "rolled_back"
  | "simulated";

export type DeployCheckResult = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";

export interface DeployChecks {
  typescript: DeployCheckResult;
  tests: DeployCheckResult;
  build: DeployCheckResult;
  secretScan: DeployCheckResult;
  postDeployHealth: DeployCheckResult;
}

export interface DeployGitSource {
  commit: string;
  branch: string;
  tag: string | null;
  repoUrl: string;
}

/**
 * State of the local working tree relative to the recorded commit. `dirty`
 * means the recorded HEAD does NOT describe the working tree, so the commit SHA
 * must never be presented as "this is exactly what is running".
 */
export type DeployWorktreeState = "clean" | "dirty" | "unknown";

/**
 * Read-only local Git identity captured at a point in time. `commitSha` is the
 * recorded HEAD; it is NOT proof that the working tree matches it (see
 * `worktree`). When Git cannot be read, `available` is false and `reason` holds
 * a safe explanation (never a secret).
 */
export interface DeployGitInfo {
  available: boolean;
  commitSha: string | null;
  shortSha: string | null;
  branch: string | null;
  worktree: DeployWorktreeState;
  readAt: string;
  reason?: string;
}

/** Result of comparing the local HEAD with the GitHub remote tip. */
export type DeployGitHubMatch = "match" | "mismatch" | "unavailable";

/**
 * Read-only GitHub status. `source` records how the remote SHA was obtained:
 *  - `local_ref`  : a pre-existing remote-tracking ref (as last fetched locally),
 *  - `ls_remote`  : a live but read-only `git ls-remote` (only when enabled),
 *  - `none`       : the remote SHA could not be read.
 * No token is created and no fetch/pull/push or GitHub API call is ever made.
 */
export interface DeployGitHubInfo {
  available: boolean;
  remoteUrl: string | null;
  remoteSha: string | null;
  match: DeployGitHubMatch;
  source: "local_ref" | "ls_remote" | "none";
  readAt: string;
  reason?: string;
}

/** Per-check execution metadata (command, time, exit code, safe reason). */
export interface DeployCheckMeta {
  ranAt: string | null;
  command: string;
  exitCode?: number | null;
  reason?: string;
}

/** A stored result of an explicit, out-of-request release-checks run. */
export interface DeployCheckRun {
  ranAt: string;
  checks: DeployChecks;
  meta?: Partial<Record<keyof DeployChecks, DeployCheckMeta>>;
}

/** Outcome of a real (isolated) restore attempt. */
export type DeployRestoreStatus = "success" | "failed" | "blocked";

/**
 * Read-only preview of a proposed restore. It states what WOULD be restored,
 * where the verified source comes from, and every reason the restore is blocked.
 * Nothing is executed to build a preview.
 */
export interface DeployRestorePreview {
  releaseId: string;
  version: string;
  /** Full commit SHA recorded for the release (never a short sha). */
  commitSha: string;
  shortSha: string | null;
  releaseStatus: DeployReleaseStatus;
  environment: DeployEnvironment;
  sourceRepoUrl: string;
  worktree: DeployWorktreeState | null;
  /** TRUE when the recorded commit is a full 40-char hex SHA. */
  shaFormatValid: boolean;
  /** TRUE when the commit object exists in the local repository (no network). */
  commitExists: boolean;
  /** TRUE only when there are zero blockers. */
  canRestore: boolean;
  /** Human-readable, non-secret reasons the restore is refused. */
  blockers: string[];
  /** Isolated target directory (relative under the DEV root), or null if unsafe. */
  targetPath: string | null;
}

/** Result of the pre/post verification of a real restore. */
export interface DeployRestoreVerification {
  /** Number of extracted files whose content hash was checked against the SHA. */
  checked: number;
  /** Paths whose content did NOT match the commit tree (should be empty). */
  mismatches: string[];
  /** Secret-named files that were deliberately NOT copied (names only). */
  prunedSecrets: string[];
}

/**
 * Post-deploy verification of the running DEV revision. This is a read-only HTTP
 * probe of the deployed app; a deploy is NOT reported as successful unless this
 * probe confirms the running revision matches the deployed commit. Never carries
 * a secret — only the commit/version the app reports.
 */
export interface DeployPostDeployVerification {
  attempted: boolean;
  reachable: boolean;
  ok: boolean;
  url: string | null;
  httpStatus: number | null;
  expectedCommit: string;
  reportedCommit: string | null;
  /** Where the reported commit came from (`env` = build-injected, trusted). */
  reportedCommitSource?: string | null;
  reportedVersion: string | null;
  /** TRUE only when the reported commit equals the expected commit (full SHA). */
  match: boolean;
  verifiedAt: string;
  reason?: string;
}

/** Outcome of a real restore attempt (materialization + verification). */
export interface DeployRestoreResult {
  releaseId: string;
  version: string;
  commitSha: string;
  status: DeployRestoreStatus;
  /** TRUE for the real isolated restore; FALSE only for a simulation. */
  real: boolean;
  /** Isolated directory the release was materialized into (relative path). */
  targetPath: string | null;
  fileCount: number;
  verified: boolean;
  verification: DeployRestoreVerification;
  requestedAt: string;
  executedAt: string | null;
  /** Non-secret, human-readable summary for the audit log / UI. */
  detail: string;
  error?: string | null;
}

/**
 * A single release record. `savedToGit` and `deployed` are intentionally
 * distinct: saving a release to GitHub is NOT the same as deploying it, and
 * success of one must never be reported as success of the other.
 */
export interface DeployRelease {
  releaseId: string;
  version: string;
  environment: DeployEnvironment;
  gitCommit: string;
  gitTag: string | null;
  gitBranch: string;
  sourceRepoUrl: string;
  createdAt: string;
  createdBy: "admin";
  /** Free-text summary of the change (operator supplied, never a status/actor). */
  changeSummary: string;
  status: DeployReleaseStatus;
  checks: DeployChecks;
  /** Per-check explanation, e.g. why a check is NOT_RUN or FAIL. */
  checkNotes?: Partial<Record<keyof DeployChecks, string>>;
  /** Short SHA of the recorded commit (read-only Git probe). */
  gitShortSha?: string | null;
  /** Working-tree state at publish time (clean/dirty/unknown). */
  worktree?: DeployWorktreeState;
  /** Read-only GitHub comparison at publish time. */
  github?: DeployGitHubInfo;
  /** Per-check command/time metadata (never a secret). */
  checksMeta?: Partial<Record<keyof DeployChecks, DeployCheckMeta>>;
  /** When the release checks were last executed (out of request). */
  checkRunAt?: string | null;
  savedToGit: boolean;
  deployed: boolean;
  /** Prototype marker: true until a real CI/CD pipeline exists (Phase E). */
  simulated: boolean;
  deployTarget: string;
  /** Real DEV deploy reference (e.g. `backend:shortSha`) when a real deploy ran. */
  deployRef?: string | null;
  /** Post-deploy verification of the running DEV revision (never a secret). */
  postDeploy?: DeployPostDeployVerification | null;
  error?: string | null;
}

export type DeployAuditAction =
  | "environment_changed"
  | "checks_run"
  | "publish"
  | "publish_simulated"
  | "publish_blocked"
  | "publish_failed"
  | "restore_preview"
  | "restore_real"
  | "restore"
  | "restore_simulated"
  | "restore_rejected";

export interface DeployAuditEntry {
  id: string;
  action: DeployAuditAction;
  actor: "admin";
  at: string;
  environment: DeployEnvironment;
  result: "ok" | "rejected";
  releaseId?: string;
  reason?: string;
}

/**
 * How strongly the identity of a release/baseline was actually proven.
 *  - `verified`:           the running revision was confirmed to match by a probe.
 *  - `partially_verified`: some evidence exists, but not an end-to-end proof.
 *  - `unknown`:            no proof could be obtained.
 */
export type DeployVerificationConfidence = "verified" | "partially_verified" | "unknown";

/** TRUE only for a full 40-char hex Git SHA (the only SHA shape we treat as proof). */
export function isFullGitSha(value: string | null | undefined): boolean {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
}

/**
 * DISTINCT lifecycle labels for a release. They are deliberately NOT synonyms:
 *  - `candidate`:       a validated release proposed for testing (not deployed).
 *  - `deployed`:        a release that actually ran (deployed === true).
 *  - `verified`:        a release whose required (runnable) checks passed.
 *  - `stable_baseline`: the ONE release adopted as the official reference; only
 *                       when it is deployed AND verified AND its SHA is known.
 *  - `rollback_ready`:  a PRIOR release proven safe to roll back to (deployed,
 *                       verified, full SHA, and hosting rollback supported).
 * A release may carry several flags at once; `stable_baseline` and
 * `rollback_ready` are never treated as equivalent.
 */
export type DeployReleaseMaturity =
  | "stable_baseline"
  | "candidate"
  | "deployed"
  | "verified"
  | "rollback_ready";

export interface DeployReleaseMaturityFlags {
  verified: boolean;
  deployed: boolean;
  candidate: boolean;
  stableBaseline: boolean;
  rollbackReady: boolean;
}

export interface DeployMaturityContext {
  /** The release id adopted as the official stable baseline (none by default). */
  baselineReleaseId?: string | null;
  /** TRUE only when the hosting rollback mechanism is proven to work here. */
  rollbackSupported?: boolean;
}

/**
 * Classify a stored release into the distinct maturity flags. Pure and
 * conservative: an unverified release is never `stable_baseline`, and a release
 * is never `rollback_ready` unless it was deployed, verified, has a full SHA,
 * AND hosting rollback is positively supported.
 */
export function classifyReleaseMaturity(
  release: DeployRelease,
  context: DeployMaturityContext = {},
): DeployReleaseMaturityFlags {
  const failed = release.status === "validation_failed" || release.status === "failed";
  const verified =
    !failed &&
    release.checks.secretScan === "PASS" &&
    release.checks.typescript === "PASS";
  const deployed = release.deployed === true;
  const candidate =
    !deployed && (release.status === "validated" || release.status === "saved_to_git");
  const shaKnown = isFullGitSha(release.gitCommit);
  const stableBaseline =
    verified &&
    deployed &&
    shaKnown &&
    Boolean(context.baselineReleaseId) &&
    release.releaseId === context.baselineReleaseId;
  const rollbackReady =
    deployed && verified && shaKnown && context.rollbackSupported === true && !stableBaseline;
  return { verified, deployed, candidate, stableBaseline, rollbackReady };
}

/** The official stable baseline for the public site (read-only, never a secret). */
export interface DeployStableBaseline {
  site: string;
  hostingSource: string;
  /** Proven published version id, or null when it could not be proven. */
  publishedVersionId: string | null;
  /** Proven published commit SHA, or null when it could not be proven. */
  publishedSha: string | null;
  /** When the baseline identity was last verified, or null. */
  verifiedAt: string | null;
  /** Health-check results observed for the published revision. */
  healthChecks: DeployChecks;
  confidence: DeployVerificationConfidence;
  /** Read-only local HEAD SHA (never used as proof of the published version). */
  localHeadSha: string | null;
  /** TRUE/FALSE when both SHAs are known; null when it cannot be determined. */
  headMatchesBaseline: boolean | null;
  /** Human-readable, non-secret explanation. */
  notes: string;
}

export type DeployRollbackMechanism =
  | "hosting_native_rollout"
  | "redeploy_prior_revision"
  | "unknown";

export interface DeployRollbackReadiness {
  mechanism: DeployRollbackMechanism;
  /** Hosting capability as documented (does NOT mean proven here). */
  supported: boolean;
  /** TRUE only when the capability was positively confirmed in this environment. */
  confirmed: boolean;
  /** TRUE only when a real, proven rollback path exists right now. */
  readyToRollback: boolean;
  /** Whether rollback only restores code, or needs extra steps. null = unknown. */
  codeOnly: boolean | null;
  requirements: string[];
  postRollbackVerification: string[];
  risks: string[];
  reason: string;
}

export interface DeployStateDescriptor {
  status: DeployReleaseStatus;
  label: string;
  description: string;
}

export interface DeployState {
  /** Active environment selector. TEST is the safe default. */
  environment: DeployEnvironment;
  environmentNotice: string;
  /** FALSE in Phase B: LIVE read-only preview is not implemented yet. */
  livePreviewImplemented: boolean;
  /** TRUE in Phase B: every operation is experimental / not really executed. */
  experimental: boolean;
  /** TRUE when the registry is backed by a durable DEV Firestore store. */
  persistent: boolean;
  /** Human-readable note about where records are stored (never a secret). */
  persistenceNotice: string;
  /** Newest first, limited to DEPLOY_RELEASE_HISTORY_LIMIT. */
  releases: DeployRelease[];
  /** Newest first, limited to DEPLOY_AUDIT_HISTORY_LIMIT. */
  audit: DeployAuditEntry[];
  states: DeployStateDescriptor[];
  /** Read-only local Git identity of the running checkout (may be unavailable). */
  git: DeployGitInfo | null;
  /** Read-only comparison of local HEAD vs the GitHub remote tip. */
  github: DeployGitHubInfo | null;
  /** Latest stored out-of-request check run (if any). */
  latestCheckRun: DeployCheckRun | null;
  /** Fixed isolated DEV deploy target (never client-selectable, never production). */
  deployTarget: {
    projectId: string;
    backendId: string;
    baseUrl: string | null;
  };
  /** TRUE only when NODE_ENV=development AND DEPLOY_REAL_DEPLOY=enabled. */
  realDeployEnabled: boolean;
  /** Official stable baseline for the public site (read-only reference). */
  stableBaseline: DeployStableBaseline;
  /** Rollback mechanism + readiness (never claims readiness without proof). */
  rollback: DeployRollbackReadiness;
}

/** Shown to the operator so nobody mistakes a saved record for a real deploy. */
export const DEPLOY_PUBLISH_NOTICE =
  "تم حفظ سجل الإصدار فقط. لم يُنفَّذ أي commit أو push أو نشر فعلي، ولا أي اتصال بالإنتاج.";

/** Shown after a real restore materializes an isolated tree inside DEV. */
export const DEPLOY_RESTORE_REAL_NOTICE =
  "استعادة فعلية معزولة داخل بيئة التطوير: أُعيد بناء ملفات الإصدار من الـSHA محليًا وتم التحقق من مطابقتها. لم يُنفَّذ أي commit/push/checkout/deploy، ولم تُمسّ ملفات العمل الحالية.";

/** Shown for a (currently simulated) restore. */
export const DEPLOY_RESTORE_NOTICE =
  "تم تسجيل استعادة الإصدار فقط. لم يُنفَّذ أي نشر/استعادة فعلية.";

/** Clarifies that a recorded commit does not by itself prove the worktree matches. */
export const DEPLOY_GIT_SOURCE_NOTICE =
  "مصدر Git يُقرأ للقراءة فقط من المستودع المحلي (بلا commit/push)، ولا يُعتبر HEAD دليلًا على مطابقة شجرة العمل.";

export const DEPLOY_RELEASE_HISTORY_LIMIT = 5;
export const DEPLOY_AUDIT_HISTORY_LIMIT = 50;
export const DEPLOY_PROTOTYPE_VERSION = "0.0.0-prototype";

export const DEPLOY_ENVIRONMENT_NOTICE: Record<DeployEnvironment, string> = {
  TEST: "بيئة الاختبار: موارد DEV المعزولة فقط. لا اتصال بالإنتاج.",
  LIVE: "بيئة الإنتاج (معاينة قراءة فقط): غير مُنفَّذة في هذه المرحلة — لن يتم أي اتصال بالإنتاج.",
};

export const DEPLOY_STATE_DESCRIPTORS: DeployStateDescriptor[] = [
  { status: "draft", label: "مسودة", description: "إصدار مُهيَّأ ولم تُشغَّل الفحوصات بعد." },
  { status: "validated", label: "تم التحقق", description: "نجحت فحوص TypeScript والاختبارات والبناء وفحص الأسرار." },
  { status: "validation_failed", label: "فشل التحقق", description: "فشل فحص إلزامي — لا يُسمح بالنشر." },
  { status: "saved_to_git", label: "محفوظ في Git", description: "حُفظ الإصدار في GitHub (لا يعني أنه نُشر)." },
  { status: "deploying", label: "قيد النشر", description: "جارٍ إنشاء النشر عبر مسار CI/CD." },
  { status: "deployed", label: "منشور", description: "اكتمل النشر ونجحت فحوص ما بعد النشر." },
  { status: "failed", label: "فشل النشر", description: "فشل النشر أو فحوص الصحة — تتوفر استعادة." },
  { status: "rolled_back", label: "تمت الاستعادة", description: "أُعيد الإصدار السابق المتوافق." },
  { status: "simulated", label: "محاكاة (تجريبي)", description: "عملية تجريبية داخلية — لم يُنفَّذ نشر فعلي." },
];
