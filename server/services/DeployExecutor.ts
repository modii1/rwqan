/**
 * RWQAN DEPLOY — deploy/restore executor seam.
 *
 * The release registry records what to deploy; the executor decides what actually
 * happens. The DEFAULT executor is a SIMULATION (nothing is built, committed,
 * pushed, or deployed) so the DEV copy is always safe. A real executor (an
 * App Hosting / CI-CD path) can be supplied later WITHOUT changing the registry,
 * the route, or the data model — it only changes the outcome fields.
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
  realDeployEnabled as defaultRealDeployEnabled,
  resolveDeployTarget,
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
  /** The real deploy target project id (DEV only), when known. */
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
  /** TRUE only when a real restore/redeploy actually happened. */
  restored: boolean;
  /** Non-secret, human-readable explanation for the audit log. */
  detail: string;
}

/**
 * Performs the real publish/restore. The simulation implementation is the safe
 * default; a real implementation is injected only when explicitly configured.
 */
export interface DeployExecutor {
  publish(input: {
    gitCommit: string;
    checks: DeployChecks;
    /** Explicit admin approval; a real deploy MUST require it. */
    approval?: boolean;
    /** Client-confirmed target project id (validated, never trusted blindly). */
    requestedTarget?: string | null;
    /** Local worktree cleanliness; a real deploy requires "clean". */
    worktree?: "clean" | "dirty" | "unknown";
  }): Promise<DeployPublishOutcome>;
  restore(input: { gitCommit: string }): Promise<DeployRestoreOutcome>;
}

export interface DeployExecutorOptions {
  publishNotice: string;
  restoreNotice: string;
  /** Test seam: decide whether a real deploy is enabled (defaults to env). */
  realDeployEnabled?: () => boolean;
}

/**
 * The default, safe executor. It never builds, commits, pushes, or deploys and
 * always reports `deployed: false` / `restored: false` so no record can be
 * mistaken for a real deploy.
 */
export class SimulationDeployExecutor implements DeployExecutor {
  constructor(private readonly options: DeployExecutorOptions) {}

  async publish(input: {
    gitCommit: string;
    checks: DeployChecks;
    approval?: boolean;
    requestedTarget?: string | null;
    worktree?: "clean" | "dirty" | "unknown";
  }): Promise<DeployPublishOutcome> {
    return {
      deployed: false,
      savedToGit: false,
      detail: this.options.publishNotice,
      blocked: false,
      stage: null,
    };
  }

  async restore(input: { gitCommit: string }): Promise<DeployRestoreOutcome> {
    return {
      restored: false,
      detail: this.options.restoreNotice,
    };
  }
}

/**
 * Build the executor. Returns the simulation executor unless a real DEV deploy
 * is explicitly enabled (NODE_ENV=development AND DEPLOY_REAL_DEPLOY=enabled).
 * The real executor is scoped to the fixed DEV target and always requires an
 * explicit approval; it never auto-deploys on a plain `push`.
 */
export function createDeployExecutor(
  options: DeployExecutorOptions = {
    publishNotice: DEPLOY_PUBLISH_NOTICE,
    restoreNotice: DEPLOY_RESTORE_NOTICE,
  },
): DeployExecutor {
  const realEnabled = options.realDeployEnabled ?? defaultRealDeployEnabled;
  if (!realEnabled()) {
    return new SimulationDeployExecutor(options);
  }
  return new RealDeployExecutor({
    target: resolveDeployTarget(),
    dependencies: createRealDeployDependencies(),
    realDeployEnabled: realEnabled,
  });
}
