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
  realDeployEnabled as defaultRealDeployEnabled,
  resolveDeployTarget,
  type DeployTargetEnvironment,
} from "../config/deployTarget";
import {
  RealDeployExecutor,
  createRealDeployDependencies,
} from "./DeployRealExecutor";

/** Stage a real publish stopped at (used for a precise audit reason). */
export type DeployPublishStage =
  | "approval"
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
}

export interface DeployRestoreInput {
  gitCommit: string;
  /** Explicit admin confirmation; a real restore MUST require it. */
  approval?: boolean;
  requestedTarget?: string | null;
  /** Active deploy environment selecting the target (defaults to TEST). */
  environment?: DeployTargetEnvironment;
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
 * Build the executor. Returns the fail-closed executor unless a real deploy is
 * explicitly enabled (NODE_ENV=development AND DEPLOY_REAL_DEPLOY=enabled). The
 * real executor resolves its target per call from the active environment and
 * always requires an explicit approval; it never auto-deploys.
 */
export function createDeployExecutor(
  options: DeployExecutorOptions = {
    publishNotice: DEPLOY_PUBLISH_NOTICE,
    restoreNotice: DEPLOY_RESTORE_NOTICE,
  },
): DeployExecutor {
  const realEnabled = options.realDeployEnabled ?? defaultRealDeployEnabled;
  const prodEnabled = options.productionDeployEnabled ?? defaultProductionDeployEnabled;
  if (!realEnabled()) {
    return new DisabledDeployExecutor(options);
  }
  return new RealDeployExecutor({
    resolveTarget: (environment: DeployTargetEnvironment) => resolveDeployTarget(environment),
    dependencies: createRealDeployDependencies(),
    realDeployEnabled: realEnabled,
    productionDeployEnabled: prodEnabled,
  });
}
