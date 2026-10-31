import { randomUUID } from "node:crypto";
import {
  DEPLOY_AUDIT_HISTORY_LIMIT,
  DEPLOY_ENVIRONMENT_NOTICE,
  DEPLOY_PROTOTYPE_VERSION,
  DEPLOY_RELEASE_HISTORY_LIMIT,
  DEPLOY_STATE_DESCRIPTORS,
  evaluateRestoreEnvironment,
  isStableRelease,
  type DeployAuditAction,
  type DeployAuditEntry,
  type DeployCheckMeta,
  type DeployChecks,
  type DeployCheckRun,
  type DeployEnvironment,
  type DeployGitHubInfo,
  type DeployGitInfo,
  type DeployPostDeployVerification,
  type DeployRelease,
  type DeployState,
  type DeployToolsInfo,
  type DeployWorktreeState,
} from "../../shared/deploySystem";
import { resolveDeployTarget, realDeployEnabled, deployDispatchEnabled, productionDeployEnabled, DEPLOY_PROD_PROJECT_ID, deployTargetBlockers, resolveAppHostingHost } from "../config/deployTarget";
import { buildStableBaseline, resolveProductionBaselineIdentity } from "./DeployBaselineService";
import { resolveAppHostingVerifyConfig } from "./DeployBuildSourceService";
import { evaluatePreDeployGate } from "./DeployPrepublishGate";
import { dataEnvironmentStore } from "./LiveDataEnvironmentStore";
import { RWQAN_STABLE_BASELINE, buildRollbackReadiness } from "../config/stableBaseline";

/**
 * RWQAN DEPLOY — release-registry store contract (Phase C).
 *
 * The contract is intentionally asynchronous so the same shape is served by the
 * durable Firestore DEV store and by the in-memory store used in tests. The
 * contract NEVER deploys, commits, pushes, or touches production: it only
 * records releases/audit entries and answers read queries.
 *
 * Phase C adds a fail-closed rule: if we cannot positively prove we are writing
 * to the isolated DEV project, writes must be rejected. That is modelled by
 * `DeployStoreUnavailableError` + `UnavailableDeploySystemStore` below.
 */

export const DEPLOY_SOURCE_REPO_URL = "https://github.com/modii1/rwqan.git";
export const DEPLOY_DEV_TARGET = "rwqan-sa-dev";

export const DEPLOY_PERSISTENCE_NOTICE_PERSISTENT =
  "السجل دائم في Firestore DEV (rwqan-sa-dev)؛ تبقى الإصدارات وعمليات التدقيق بعد إعادة التشغيل.";
export const DEPLOY_PERSISTENCE_NOTICE_EPHEMERAL =
  "السجل غير دائم: تعذّر تأكيد مشروع Firebase DEV، لذا الكتابة معطّلة (فشل مغلق) والقراءة فارغة.";

export interface CreateReleaseInput {
  version: string;
  environment: DeployEnvironment;
  changeSummary: string;
  /** Server-derived Git provenance; null when Git could not be read. */
  git: {
    commit: string;
    branch: string;
    tag: string | null;
    repoUrl: string;
  } | null;
  /** Read-only local Git identity (short sha + worktree state). */
  gitInfo?: DeployGitInfo | null;
  /** Read-only GitHub comparison (match/mismatch/unavailable). */
  github?: DeployGitHubInfo | null;
  /** Per-check command/time metadata (never a secret). */
  checksMeta?: Partial<Record<keyof DeployChecks, DeployCheckMeta>>;
  /** When the attached checks were last executed (out of request). */
  checkRunAt?: string | null;
  checks: DeployChecks;
  checkNotes?: Partial<Record<keyof DeployChecks, string>>;
  /**
   * Deploy-executor outcome. Undefined = simulation (nothing written or
   * deployed). A real executor may report `deployed: true`; `simulated` is then
   * derived as `!deployed`. Never supplied by the client.
   */
  deployed?: boolean;
  savedToGit?: boolean;
  /** Real DEV deploy target project id (defaults to the isolated DEV target). */
  deployTarget?: string;
  /** Real DEV deploy reference (backend:shortSha) when a real deploy ran. */
  deployRef?: string | null;
  /** Post-deploy verification of the running DEV revision (never a secret). */
  postDeploy?: DeployPostDeployVerification | null;
}

export interface RecordAuditInput {
  action: DeployAuditAction;
  environment: DeployEnvironment;
  /** "accepted" marks a request accepted by an external system (e.g. GitHub). */
  result: "ok" | "accepted" | "rejected";
  releaseId?: string;
  reason?: string;
}

export interface DeployRestoreOutcome {
  ok: boolean;
  release?: DeployRelease;
  code?: string;
  reason?: string;
}

/**
 * Options for a restore-eligibility check. `targetEnvironment` is the
 * console's ACTIVE environment (where the rollout would land) and is kept
 * separate from the release's own SOURCE environment. `liveRestoreApproved` is
 * TRUE only when a LIVE target has been explicitly approved.
 */
export interface RestoreEligibilityOptions {
  targetEnvironment?: DeployEnvironment;
  liveRestoreApproved?: boolean;
}

export interface DeploySystemStoreContract {
  /** TRUE only when backed by the durable DEV registry. */
  isPersistent(): Promise<boolean>;
  getEnvironment(): Promise<DeployEnvironment>;
  setEnvironment(environment: DeployEnvironment): Promise<DeployEnvironment>;
  listReleases(): Promise<DeployRelease[]>;
  listAudit(): Promise<DeployAuditEntry[]>;
  getRelease(releaseId: string): Promise<DeployRelease | undefined>;
  recordAudit(entry: RecordAuditInput): Promise<DeployAuditEntry>;
  createRelease(input: CreateReleaseInput): Promise<DeployRelease>;
  restoreRelease(
    releaseId: string,
    options?: RestoreEligibilityOptions,
  ): Promise<DeployRestoreOutcome>;
  /** Persist the latest out-of-request release-checks run. */
  recordCheckRun(run: DeployCheckRun): Promise<DeployCheckRun>;
  /** Latest stored release-checks run, or null when none was ever recorded. */
  getLatestCheckRun(): Promise<DeployCheckRun | null>;
}

/** Thrown by the fail-closed store when a write is attempted without DEV proof. */
export class DeployStoreUnavailableError extends Error {
  readonly code = "DEPLOY_STORE_UNAVAILABLE";
  constructor(message = "سجل الإصدارات الدائم غير متاح (فشل مغلق).") {
    super(message);
    this.name = "DeployStoreUnavailableError";
  }
}

/**
 * Pure record builder shared by the Firestore and in-memory stores.
 *
 * The release status is derived ONLY from the server-side checks:
 *  - a failed/blocked secret scan OR a real TypeScript FAIL → `validation_failed`
 *    (recorded, not hidden);
 *  - otherwise → `simulated` (a saved record — never `deployed`).
 * A passing TypeScript check is never treated as a passing test/build. Git
 * provenance is captured read-only; a `dirty` worktree is recorded so the SHA is
 * never presented as proof of the working tree contents. `savedToGit`/`deployed`
 * stay false: this phase never writes to Git or deploys.
 */
export function buildReleaseRecord(
  input: CreateReleaseInput,
  now: Date = new Date(),
): DeployRelease {
  const notes = input.checkNotes ?? {};
  const secretFailed = input.checks.secretScan !== "PASS";
  const typeFailed = input.checks.typescript === "FAIL";
  const failed = secretFailed || typeFailed;
  const errorReason = secretFailed
    ? notes.secretScan ?? "فشل فحص إلزامي — سُجِّل الإصدار دون أي نشر."
    : typeFailed
      ? notes.typescript ?? "فشل فحص TypeScript — سُجِّل الإصدار دون أي نشر."
      : null;

  const commit = input.git?.commit ?? "unknown";
  const deriveShortSha = (): string | null => {
    if (input.gitInfo?.shortSha) return input.gitInfo.shortSha;
    if (commit && commit !== "unknown") return commit.slice(0, 7);
    return null;
  };
  const worktree: DeployWorktreeState = input.gitInfo?.worktree ?? "unknown";
  const deployed = input.deployed ?? false;
  const defaultTarget =
    input.environment === "LIVE" ? DEPLOY_PROD_PROJECT_ID : DEPLOY_DEV_TARGET;

  return {
    releaseId: `rel-${randomUUID()}`,
    version: input.version,
    environment: input.environment,
    gitCommit: commit,
    gitTag: input.git?.tag ?? null,
    gitBranch: input.git?.branch ?? "unknown",
    sourceRepoUrl: input.git?.repoUrl ?? DEPLOY_SOURCE_REPO_URL,
    createdAt: now.toISOString(),
    createdBy: "admin",
    changeSummary: input.changeSummary,
    status: failed ? "validation_failed" : deployed ? "deployed" : "validated",
    checks: { ...input.checks },
    ...(Object.keys(notes).length > 0 ? { checkNotes: { ...notes } } : {}),
    gitShortSha: deriveShortSha(),
    worktree,
    ...(input.github ? { github: input.github } : {}),
    ...(input.checksMeta ? { checksMeta: input.checksMeta } : {}),
    checkRunAt: input.checkRunAt ?? null,
    savedToGit: input.savedToGit ?? false,
    deployed,
    simulated: false,
    deployTarget: input.deployTarget ?? defaultTarget,
    ...(input.deployRef ? { deployRef: input.deployRef } : {}),
    ...(input.postDeploy ? { postDeploy: input.postDeploy } : {}),
    error: errorReason,
  };
}

function buildAuditEntry(
  input: RecordAuditInput,
  at: Date,
): DeployAuditEntry {
  return {
    id: randomUUID(),
    at: at.toISOString(),
    actor: "admin",
    action: input.action,
    environment: input.environment,
    result: input.result,
    ...(input.releaseId ? { releaseId: input.releaseId } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

/**
 * Shared restore-eligibility rules. Never performs a restore by itself.
 *
 * The environment decision is derived from the TARGET environment (where the
 * rollout would land) with the release's SOURCE environment only gating the
 * cross-environment case, so the stable LIVE-source release can be restored into
 * the isolated TEST target while a LIVE target still requires explicit approval.
 */
export function evaluateRestore(
  release: DeployRelease | undefined,
  options: RestoreEligibilityOptions = {},
): DeployRestoreOutcome {
  if (!release) {
    return { ok: false, code: "RELEASE_NOT_FOUND", reason: "إصدار غير معروف" };
  }
  if (!release.gitCommit || release.gitCommit === "unknown") {
    return {
      ok: false,
      code: "RELEASE_UNKNOWN_SOURCE",
      reason: "لا يمكن استعادة إصدار مجهول المصدر",
    };
  }
  if (release.status === "validation_failed" || release.status === "failed") {
    return {
      ok: false,
      code: "RELEASE_INCOMPLETE",
      reason: "لا يمكن استعادة إصدار غير مكتمل",
    };
  }
  if (!/^[0-9a-fA-F]{40}$/.test(release.gitCommit)) {
    return {
      ok: false,
      code: "RELEASE_SOURCE_NOT_IMMUTABLE",
      reason: "مصدر الاستعادة ليس SHA كاملًا — الاستعادة تتطلب إصدارًا ثابتًا.",
    };
  }
  const environment = evaluateRestoreEnvironment(
    release.environment,
    options.targetEnvironment ?? "TEST",
    { liveRestoreApproved: options.liveRestoreApproved === true },
  );
  if (!environment.ok) {
    return { ok: false, code: environment.code, reason: environment.reason };
  }
  return { ok: true, release };
}

function seededReleases(): DeployRelease[] {
  const base = {
    createdBy: "admin" as const,
    sourceRepoUrl: DEPLOY_SOURCE_REPO_URL,
    simulated: true,
    deployTarget: DEPLOY_DEV_TARGET,
    changeSummary: "بيانات عرض أولية للاختبارات (ليست سجلات حقيقية).",
    error: null as string | null,
  };
  const pass: DeployChecks = {
    typescript: "NOT_RUN",
    tests: "NOT_RUN",
    build: "NOT_RUN",
    secretScan: "PASS",
    postDeployHealth: "NOT_RUN",
  };
  return [
    {
      ...base,
      releaseId: "rel-seed-0003",
      version: "0.1.2",
      environment: "TEST",
      gitCommit: "seed00003",
      gitTag: null,
      gitBranch: "release/rwqan-test",
      createdAt: "2026-10-13T09:15:00.000Z",
      status: "simulated",
      checks: { ...pass },
      savedToGit: false,
      deployed: false,
    },
    {
      ...base,
      releaseId: "rel-seed-0002",
      version: "0.1.1",
      environment: "TEST",
      gitCommit: "seed00002",
      gitTag: null,
      gitBranch: "release/rwqan-test",
      createdAt: "2026-10-12T14:40:00.000Z",
      status: "validation_failed",
      checks: { ...pass, secretScan: "FAIL", postDeployHealth: "NOT_RUN" },
      checkNotes: { secretScan: "نمط سرّي وُجد داخل محتوى أحد الملفات المُغيَّرة." },
      savedToGit: false,
      deployed: false,
      error: "نمط سرّي وُجد داخل محتوى أحد الملفات المُغيَّرة.",
    },
    {
      ...base,
      releaseId: "rel-seed-0001",
      version: "0.1.0",
      environment: "TEST",
      gitCommit: "seed00001",
      gitTag: null,
      gitBranch: "release/rwqan-test",
      createdAt: "2026-10-11T07:00:00.000Z",
      status: "simulated",
      checks: { ...pass },
      savedToGit: false,
      deployed: false,
    },
  ];
}

export class InMemoryDeploySystemStore implements DeploySystemStoreContract {
  private environment: DeployEnvironment = "TEST";
  private releases: DeployRelease[];
  private audit: DeployAuditEntry[] = [];
  private latestCheckRun: DeployCheckRun | null = null;
  private now: () => Date;

  constructor(options: { seed?: boolean; now?: () => Date } = {}) {
    this.releases = options.seed ? seededReleases() : [];
    this.now = options.now ?? (() => new Date());
  }

  isPersistent(): Promise<boolean> {
    return Promise.resolve(true);
  }

  getEnvironment(): Promise<DeployEnvironment> {
    return Promise.resolve(this.environment);
  }

  setEnvironment(environment: DeployEnvironment): Promise<DeployEnvironment> {
    this.environment = environment;
    return Promise.resolve(this.environment);
  }

  listReleases(): Promise<DeployRelease[]> {
    return Promise.resolve(
      [...this.releases]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, DEPLOY_RELEASE_HISTORY_LIMIT),
    );
  }

  listAudit(): Promise<DeployAuditEntry[]> {
    return Promise.resolve(this.audit.slice(0, DEPLOY_AUDIT_HISTORY_LIMIT));
  }

  getRelease(releaseId: string): Promise<DeployRelease | undefined> {
    return Promise.resolve(
      this.releases.find((release) => release.releaseId === releaseId),
    );
  }

  recordAudit(entry: RecordAuditInput): Promise<DeployAuditEntry> {
    const next = buildAuditEntry(entry, this.now());
    this.audit = [next, ...this.audit].slice(0, DEPLOY_AUDIT_HISTORY_LIMIT);
    return Promise.resolve(next);
  }

  createRelease(input: CreateReleaseInput): Promise<DeployRelease> {
    const release = buildReleaseRecord(input, this.now());
    this.releases = [release, ...this.releases].slice(
      0,
      DEPLOY_RELEASE_HISTORY_LIMIT,
    );
    return Promise.resolve(release);
  }

  restoreRelease(
    releaseId: string,
    options?: RestoreEligibilityOptions,
  ): Promise<DeployRestoreOutcome> {
    return Promise.resolve(
      evaluateRestore(
        this.releases.find((release) => release.releaseId === releaseId),
        options,
      ),
    );
  }

  recordCheckRun(run: DeployCheckRun): Promise<DeployCheckRun> {
    this.latestCheckRun = run;
    return Promise.resolve(run);
  }

  getLatestCheckRun(): Promise<DeployCheckRun | null> {
    return Promise.resolve(this.latestCheckRun);
  }
}

/**
 * Fail-closed store used whenever the durable DEV registry cannot be proven
 * available. Reads return empty data and `isPersistent()` is false; every write
 * throws `DeployStoreUnavailableError` so a failure can never be reported as
 * success.
 */
export class UnavailableDeploySystemStore implements DeploySystemStoreContract {
  constructor(private readonly reason = DEPLOY_PERSISTENCE_NOTICE_EPHEMERAL) {}

  isPersistent(): Promise<boolean> {
    return Promise.resolve(false);
  }

  getEnvironment(): Promise<DeployEnvironment> {
    return Promise.resolve("TEST");
  }

  setEnvironment(): Promise<DeployEnvironment> {
    return Promise.reject(new DeployStoreUnavailableError(this.reason));
  }

  listReleases(): Promise<DeployRelease[]> {
    return Promise.resolve([]);
  }

  listAudit(): Promise<DeployAuditEntry[]> {
    return Promise.resolve([]);
  }

  getRelease(): Promise<DeployRelease | undefined> {
    return Promise.resolve(undefined);
  }

  recordAudit(): Promise<DeployAuditEntry> {
    return Promise.reject(new DeployStoreUnavailableError(this.reason));
  }

  createRelease(): Promise<DeployRelease> {
    return Promise.reject(new DeployStoreUnavailableError(this.reason));
  }

  restoreRelease(): Promise<DeployRestoreOutcome> {
    return Promise.reject(new DeployStoreUnavailableError(this.reason));
  }

  recordCheckRun(): Promise<DeployCheckRun> {
    return Promise.reject(new DeployStoreUnavailableError(this.reason));
  }

  getLatestCheckRun(): Promise<DeployCheckRun | null> {
    return Promise.resolve(null);
  }
}

/** Read-only Git/GitHub context attached to the state snapshot (never a secret). */
export interface DeployStateContext {
  git?: DeployGitInfo | null;
  github?: DeployGitHubInfo | null;
  /**
   * Read-only deploy-tools probe (`firebase --version`, cached server-side).
   * Null/undefined = "could not be adjudged in this snapshot" (the gate renders
   * غير متحقق for the tools item instead of guessing).
   */
  tools?: DeployToolsInfo | null;
  /**
   * Verified official stable release (commit existence + reachability proven),
   * or null/undefined when it could not be verified. Merged into the state's
   * restored-eligible list; it is a read-only reference, never a fake publish.
   */
  stableRelease?: DeployRelease | null;
}

/**
 * Build the immutable client-facing state snapshot. Never includes secrets. The
 * Git/GitHub context is computed by the caller (a read-only probe) and passed
 * in so the store stays free of process/Git concerns.
 */
export async function buildDeployState(
  store: DeploySystemStoreContract,
  context: DeployStateContext = {},
): Promise<DeployState> {
  const environment = await store.getEnvironment();
  const persistent = await store.isPersistent();
  const deployTarget = resolveDeployTarget(environment);
  const releases = await store.listReleases();
  // Only real, stable releases are surfaced for restore; old/prototype/failed
  // records stay in the registry but are never shown as restorable. The verified
  // official stable release is included so the restore source always carries the
  // real production reference (it is never a fabricated publish).
  const stableRelease = context.stableRelease ?? null;
  const stableCandidates = stableRelease ? [stableRelease, ...releases] : releases;
  const stableReleases = stableCandidates.filter(isStableRelease);
  const verifyConfig = resolveAppHostingVerifyConfig();
  const dataEnvironment = dataEnvironmentStore.get();
  const latestCheckRun = await store.getLatestCheckRun();
  const gate = evaluatePreDeployGate({
    environment,
    git: context.git ?? null,
    github: context.github ?? null,
    latestCheckRun,
    realDeployEnabled: realDeployEnabled(),
    productionDeployEnabled: productionDeployEnabled(),
    verifySourceConfig: {
      enabled: verifyConfig.enabled,
      ...(verifyConfig.reason ? { reason: verifyConfig.reason } : {}),
    },
    target: deployTarget,
    targetBlockers: deployTargetBlockers(deployTarget, environment),
    dataEnvironment,
    tools: context.tools ?? null,
  });
  const resolvedBaseline = await resolveProductionBaselineIdentity({
    releases,
    location: verifyConfig.location,
    enabled: verifyConfig.enabled,
  });
  return {
    environment,
    environmentNotice: DEPLOY_ENVIRONMENT_NOTICE[environment],
    livePreviewImplemented: true,
    experimental: false,
    persistent,
    persistenceNotice: persistent
      ? DEPLOY_PERSISTENCE_NOTICE_PERSISTENT
      : DEPLOY_PERSISTENCE_NOTICE_EPHEMERAL,
    releases,
    stableReleases,
    audit: await store.listAudit(),
    states: DEPLOY_STATE_DESCRIPTORS,
    git: context.git ?? null,
    github: context.github ?? null,
    latestCheckRun,
    deployTarget: {
      projectId: deployTarget.projectId,
      backendId: deployTarget.backendId,
      baseUrl: deployTarget.baseUrl,
      location: deployTarget.location ?? null,
      expectedDomain: resolveAppHostingHost(deployTarget),
    },
    realDeployEnabled: realDeployEnabled(),
    deployDispatchEnabled: deployDispatchEnabled(),
    productionDeployEnabled: productionDeployEnabled(),
    dataEnvironment,
    gate,
    tools: context.tools ?? null,
    stableBaseline: buildStableBaseline(
      context.git ?? null,
      RWQAN_STABLE_BASELINE,
      resolvedBaseline,
    ),
    rollback: buildRollbackReadiness(),
  };
}

export const DEPLOY_SYSTEM_PROTOTYPE_VERSION = DEPLOY_PROTOTYPE_VERSION;

/**
 * The active store is resolved lazily through a registered factory so that the
 * Firestore-specific module (and the Firebase SDK) is only loaded by the server
 * entrypoint, never by unit tests. Until a factory is registered the store is
 * fail-closed.
 */
let deployStoreFactory: () => DeploySystemStoreContract = () =>
  new UnavailableDeploySystemStore();

export function setDeploySystemStoreFactory(
  factory: () => DeploySystemStoreContract,
): void {
  deployStoreFactory = factory;
}

export function getDeploySystemStore(): DeploySystemStoreContract {
  return deployStoreFactory();
}
