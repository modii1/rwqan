/**
 * RWQAN DEPLOY — deploy/restore executor seam.
 *
 * The release registry records what to deploy; the executor decides what actually
 * happens. There is NO simulation: when a real deploy is not enabled the executor
 * fails closed (`blocked: true`, nothing built/deployed) so no record can ever be
 * mistaken for a completed operation. When a real deploy is enabled the executor
 * performs a controlled rollout to the target selected by the active environment
 * and proves the serving revision from the App Hosting control plane.
 *
 * The executor NEVER returns secrets, and its `detail` is a human-readable,
 * non-secret explanation recorded in the audit log.
 */
import {
  DEPLOY_PUBLISH_NOTICE,
  DEPLOY_RESTORE_NOTICE,
  type DeployChecks,
  type DeployPostDeployVerification,
} from "../../shared/deploySystem";
import type { BuildSourceVerification } from "./DeployBuildSourceService";
import {
  productionDeployEnabled as defaultProductionDeployEnabled,
  deployDispatchEnabled as defaultDeployDispatchEnabled,
  realDeployEnabled as defaultRealDeployEnabled,
  resolveDeployTarget,
  type DeployTargetEnvironment,
} from "../config/deployTarget";
import {
  RealDeployExecutor,
  createRealDeployDependencies,
} from "./DeployRealExecutor";
import type { GhDispatchAccepted } from "./DeployGhWorkflowService";

/** Stage a real publish stopped at (used for a precise audit reason). */
export type DeployPublishStage =
  | "approval"
  | "auth"
  | "target"
  | "source"
  | "build"
  | "deploy"
  | "verify";

/** Result of asking the executor to publish. */
export interface DeployPublishOutcome {
  /** TRUE only when a real deploy actually happened AND was verified. */
  deployed: boolean;
  /** TRUE only when the release was durably saved to the Git remote. */
  savedToGit: boolean;
  /** Non-secret, human-readable explanation for the audit log. */
  detail: string;
  /** TRUE when a real deploy was refused before/while running (fail closed). */
  blocked?: boolean;
  /** Stage reached when the outcome is not a success (approval/target/build/...). */
  stage?: DeployPublishStage | null;
  /** The real deploy target project id, when known. */
  target?: string | null;
  /** Non-secret release reference, e.g. `backend:shortSha`. */
  releaseRef?: string | null;
  /** Post-deploy verification of the running revision (real deploys only). */
  verify?: DeployPostDeployVerification | null;
  /** Authoritative source-identity check from the App Hosting control plane. */
  buildSource?: BuildSourceVerification | null;
  /** TRUE when Firebase CLI authentication is required before deploy can proceed. */
  authRequired?: boolean;
  /** Google OAuth authorization URL to open (when authRequired === true). */
  authUrl?: string | null;
  /**
   * Present when the TEST publish was DELEGATED to GitHub Actions
   * (workflow_dispatch). GitHub — not this app — creates the rollout, so this
   * outcome never claims `deployed: true`; the dispatch is only a request.
   */
  ghDispatch?: GhDispatchAccepted | null;
  /**
   * The path that actually executed. Recorded so the panel/audit can PROVE
   * whether the request went to GitHub Actions or to a local Firebase CLI —
   * never inferred from the message text.
   */
  via?: "github_actions" | "firebase_cli" | null;
}

/** Result of asking the executor to restore a previous release. */
export interface DeployRestoreOutcome {
  /** TRUE only when a real restore/redeploy actually happened AND was verified. */
  restored: boolean;
  /** Non-secret, human-readable explanation for the audit log. */
  detail: string;
  /** TRUE when a real restore was refused (fail closed). */
  blocked?: boolean;
  /** Stage reached when the outcome is not a success. */
  stage?: DeployPublishStage | null;
  /** The real restore target project id, when known. */
  target?: string | null;
  /** Non-secret release reference, e.g. `backend:shortSha`. */
  releaseRef?: string | null;
  /** Post-restore verification of the running revision. */
  verify?: DeployPostDeployVerification | null;
  /** Authoritative source-identity check from the App Hosting control plane. */
  buildSource?: BuildSourceVerification | null;
  /** The path that actually executed (see DeployPublishOutcome.via). */
  via?: "github_actions" | "firebase_cli" | null;
}

export interface DeployPublishInput {
  gitCommit: string;
  checks: DeployChecks;
  /** Explicit admin approval; a real deploy MUST require it. */
  approval?: boolean;
  /** Client-confirmed target project id (validated, never trusted blindly). */
  requestedTarget?: string | null;
  /** Local worktree cleanliness; a real deploy requires "clean". */
  worktree?: "clean" | "dirty" | "unknown";
  /** Active deploy environment selecting the target (defaults to TEST). */
  environment?: DeployTargetEnvironment;
  /** Server-side session id used to resolve Firebase CLI credentials (FIREBASE_TOKEN). */
  sessionId?: string;
  /** Admin id that owns the credentials, used to prevent cross-admin credential use. */
  adminId?: string;
}

export interface DeployRestoreInput {
  gitCommit: string;
  /** Explicit admin confirmation; a real restore MUST require it. */
  approval?: boolean;
  requestedTarget?: string | null;
  /** Active deploy environment selecting the target (defaults to TEST). */
  environment?: DeployTargetEnvironment;
  /** Server-side session id used to resolve Firebase CLI credentials (FIREBASE_TOKEN). */
  sessionId?: string;
  /** Admin id that owns the credentials, used to prevent cross-admin credential use. */
  adminId?: string;
}

/**
 * Performs the real publish/restore. The disabled implementation fails closed;
 * the real implementation is injected only when explicitly configured.
 */
export interface DeployExecutor {
  publish(input: DeployPublishInput): Promise<DeployPublishOutcome>;
  restore(input: DeployRestoreInput): Promise<DeployRestoreOutcome>;
}

export interface DeployExecutorOptions {
  publishNotice: string;
  restoreNotice: string;
  /** Test seam: decide whether a real deploy is enabled (defaults to env). */
  realDeployEnabled?: () => boolean;
  /** Test seam: decide whether the GitHub-dispatch path is enabled (defaults to env). */
  deployDispatchEnabled?: () => boolean;
  /** Test seam: decide whether production deploys are enabled (defaults to env). */
  productionDeployEnabled?: () => boolean;
}

/**
 * The fail-closed executor used whenever a real deploy is not explicitly
 * enabled. It never builds, commits, pushes, or deploys; it reports
 * `blocked: true` so no success record can be written.
 */
export class DisabledDeployExecutor implements DeployExecutor {
  constructor(private readonly options: DeployExecutorOptions) {}

  async publish(_input: DeployPublishInput): Promise<DeployPublishOutcome> {
    return {
      deployed: false,
      savedToGit: false,
      detail: this.options.publishNotice,
      blocked: true,
      stage: "approval",
    };
  }

  async restore(_input: DeployRestoreInput): Promise<DeployRestoreOutcome> {
    return {
      restored: false,
      detail: this.options.restoreNotice,
      blocked: true,
      stage: "approval",
    };
  }
}

/**
 * Build the executor.
 *
 * IMPORTANT (TEST remediation): this ALWAYS returns the real executor. The
 * previous version returned `DisabledDeployExecutor` unless
 * `NODE_ENV=development` AND `DEPLOY_REAL_DEPLOY=enabled`, which made the TEST
 * button unusable on the deployed App Hosting runtime (NODE_ENV is always
 * `production` there) and forced the panel to depend on the local machine being
 * a development checkout. Environment-specific safety is now enforced INSIDE
 * the executor:
 *   - TEST  → GitHub Actions dispatch only (no Firebase CLI). It needs the
 *             server-side GitHub token + admin approval; it can never touch
 *             production or `main`.
 *   - LIVE  → still requires the real-deploy opt-in AND the separate production
 *             opt-in before anything is dispatched.
 *   - LOCAL → still requires the real-deploy opt-in (Firebase CLI path).
 * A missing GitHub token still fails closed with a clear reason.
 */
export function createDeployExecutor(
  options: DeployExecutorOptions = {
    publishNotice: DEPLOY_PUBLISH_NOTICE,
    restoreNotice: DEPLOY_RESTORE_NOTICE,
  },
): DeployExecutor {
  const realEnabled = options.realDeployEnabled ?? defaultRealDeployEnabled;
  const dispatchEnabled = options.deployDispatchEnabled ?? defaultDeployDispatchEnabled;
  const prodEnabled = options.productionDeployEnabled ?? defaultProductionDeployEnabled;
  return new RealDeployExecutor({
    resolveTarget: (environment: DeployTargetEnvironment) => resolveDeployTarget(environment),
    dependencies: createRealDeployDependencies(),
    realDeployEnabled: realEnabled,
    deployDispatchEnabled: dispatchEnabled,
    productionDeployEnabled: prodEnabled,
  });
}
