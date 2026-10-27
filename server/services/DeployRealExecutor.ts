/**
 * RWQAN DEPLOY — real deploy executor.
 *
 * Performs a REAL, controlled rollout to the target selected by the active
 * deploy environment and PROVES the serving revision from the App Hosting
 * control plane. A finished command (or a reachable app) is never treated as
 * success on its own.
 *
 * Safety properties (all enforced here, independently of the route):
 *   - the target is the fixed target for the environment; a mismatched or
 *     unknown target is refused before any command runs;
 *   - a TEST deploy can NEVER touch production; a LIVE deploy to the production
 *     backend requires a SECOND explicit opt-in (DEPLOY_ALLOW_PRODUCTION);
 *   - an explicit admin `approval` is required (no auto-deploy, ever);
 *   - commands run without a shell (no string interpolation, no injection);
 *   - the rollout is created for the EXACT commit on the GitHub-connected
 *     backend (never a local `firebase deploy` archive that records no commit);
 *   - a deploy/restore is reported successful ONLY after a MANDATORY
 *     control-plane source-identity proof whose serving build's `codebase.hash`
 *     equals the commit; the app probe only proves reachability;
 *   - every failure fails closed (`deployed:false` / `restored:false`).
 *
 * All side effects live behind injectable `dependencies`, so the whole flow is
 * unit-tested without touching the network, the CLI, or the filesystem.
 */
import { execFile } from "node:child_process";
import type {
  DeployPublishOutcome,
  DeployPublishStage,
  DeployRestoreOutcome,
} from "./DeployExecutor";
import {
  isFullGitSha,
  type DeployChecks,
  type DeployPostDeployVerification,
} from "../../shared/deploySystem";
import {
  deployTargetBlockers,
  isProductionProjectId,
  DEPLOY_APP_HOSTING_LOCATION_ENV_KEY,
  DEPLOY_DEV_FIREBASE_CONFIG,
  DEPLOY_PROD_FIREBASE_CONFIG,
  type DeployTarget,
  type DeployTargetEnvironment,
} from "../config/deployTarget";
import { probeDeployHealth } from "./DeployHealthService";
import { resolveFirebaseCommand } from "./DeployToolsService";
import {
  createAppHostingVerifyDependency,
  type BuildSourceVerifier,
} from "./DeployBuildSourceService";

export interface DeployCommandSpec {
  stage: "deploy" | "restore";
  file: string;
  args: string[];
  cwd: string;
  /** Extra environment variables merged over `process.env` for this command. */
  env?: Record<string, string>;
}

export interface DeployCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RealDeployDependencies {
  runCommand(spec: DeployCommandSpec): Promise<DeployCommandResult>;
  /**
   * Authoritative source-identity check (App Hosting control plane). It is
   * MANDATORY for a real deploy/restore: without it the operation is refused,
   * because the app probe alone can NOT prove which commit is serving. When
   * present it must pass (fail closed) before success is reported.
   */
  verifyBuildSource?: BuildSourceVerifier;
  /**
   * Post-deploy reachability probe. With `requireCommitProof:false` it proves
   * only that the app is reachable (a stronger proof is mandatory elsewhere).
   */
  probeHealth(input: {
    baseUrl: string;
    expectedCommit: string;
    expectedVersion: string | null;
    requireCommitProof?: boolean;
    /** Permit the production host for a LIVE target. */
    allowProductionHost?: boolean;
  }): Promise<DeployPostDeployVerification>;
  now(): Date;
  cwd(): string;
}

export interface RealDeployExecutorOptions {
  /** Resolve the fixed target for the active environment (never client data). */
  resolveTarget: (environment: DeployTargetEnvironment) => DeployTarget;
  dependencies: RealDeployDependencies;
  /** Re-checked at call time: a real deploy must still be explicitly enabled. */
  realDeployEnabled: () => boolean;
  /** Re-checked at call time: production deploys must be separately enabled. */
  productionDeployEnabled: () => boolean;
}

function releaseRef(target: DeployTarget, commit: string): string {
  return `${target.backendId}:${commit.slice(0, 7)}`;
}

/** Firebase config file the CLI must read for the environment. */
function firebaseConfigFor(environment: DeployTargetEnvironment): string {
  return environment === "LIVE" ? DEPLOY_PROD_FIREBASE_CONFIG : DEPLOY_DEV_FIREBASE_CONFIG;
}

function environmentLabel(environment: DeployTargetEnvironment): string {
  return environment === "LIVE" ? "الإنتاج" : "التطوير المعزول";
}

function blockedPublish(
  target: DeployTarget,
  stage: DeployPublishStage,
  reason: string,
): DeployPublishOutcome {
  return {
    deployed: false,
    savedToGit: false,
    detail: reason,
    blocked: true,
    stage,
    target: target.projectId,
  };
}

function failedPublish(
  target: DeployTarget,
  stage: DeployPublishStage,
  reason: string,
  exitCode: number,
): DeployPublishOutcome {
  return {
    deployed: false,
    savedToGit: false,
    detail: `${reason} (رمز الخروج: ${exitCode})`,
    blocked: false,
    stage,
    target: target.projectId,
  };
}

export class RealDeployExecutor {
  constructor(private readonly options: RealDeployExecutorOptions) {}

  private preflight(
    environment: DeployTargetEnvironment,
    stage: DeployPublishStage,
  ): { target: DeployTarget } | { blocked: DeployPublishOutcome } {
    const target = this.options.resolveTarget(environment);

    if (!this.options.realDeployEnabled()) {
      return {
        blocked: blockedPublish(
          target,
          "approval",
          "النشر الحقيقي غير مُفعَّل — لا يوجد مسار محاكاة بديل.",
        ),
      };
    }

    if (environment === "LIVE" && !this.options.productionDeployEnabled()) {
      return {
        blocked: blockedPublish(
          target,
          "target",
          "النشر إلى الإنتاج يتطلب تفعيلًا صريحًا منفصلًا (DEPLOY_ALLOW_PRODUCTION=enabled).",
        ),
      };
    }

    const blockers = deployTargetBlockers(target, environment);
    if (blockers.length > 0) {
      return { blocked: blockedPublish(target, stage, blockers.join(" ")) };
    }

    return { target };
  }

  async publish(input: {
    gitCommit: string;
    checks: DeployChecks;
    approval?: boolean;
    requestedTarget?: string | null;
    worktree?: "clean" | "dirty" | "unknown";
    environment?: DeployTargetEnvironment;
  }): Promise<DeployPublishOutcome> {
    const environment = input.environment ?? "TEST";
    const preflight = this.preflight(environment, "target");
    if ("blocked" in preflight) return preflight.blocked;
    const { target } = preflight;
    const { dependencies } = this.options;

    // Explicit admin approval is mandatory.
    if (input.approval !== true) {
      return blockedPublish(target, "approval", "النشر الحقيقي يتطلب موافقة إدارية صريحة.");
    }

    // A client-confirmed target, if sent, must match the fixed target.
    const requested = input.requestedTarget?.trim();
    if (requested && requested !== target.projectId) {
      return blockedPublish(
        target,
        "target",
        isProductionProjectId(requested) && environment === "TEST"
          ? "الهدف المطلوب هو مشروع الإنتاج — يُرفض من بيئة الاختبار."
          : "الهدف المطلوب لا يطابق هدف البيئة المحددة.",
      );
    }

    // The source identity must be provable before anything is deployed: a full
    // 40-char SHA and a clean worktree. Anything else is refused.
    const commit = input.gitCommit?.trim() ?? "";
    if (!isFullGitSha(commit)) {
      return blockedPublish(
        target,
        "source",
        "مرجع المصدر ليس SHA كاملًا (40 خانة سداسية) — لا يمكن تأكيد ما تم بناؤه.",
      );
    }
    const worktree = input.worktree ?? "unknown";
    if (worktree !== "clean") {
      return blockedPublish(
        target,
        "source",
        worktree === "dirty"
          ? "شجرة العمل تحتوي تغييرات غير مُثبَّتة — لا يمكن تأكيد أن البناء يطابق الـcommit."
          : "حالة شجرة العمل غير معروفة — يجب التأكد من نظافتها قبل النشر الحقيقي.",
      );
    }

    // A controlled rollout needs an explicit App Hosting region and a
    // trustworthy control-plane verifier. BOTH are mandatory.
    const location = target.location?.trim() ?? "";
    if (!location) {
      return blockedPublish(
        target,
        "target",
        `النشر المتحكَّم به يتطلب منطقة App Hosting (${DEPLOY_APP_HOSTING_LOCATION_ENV_KEY}).`,
      );
    }
    if (!dependencies.verifyBuildSource) {
      return blockedPublish(
        target,
        "verify",
        "التحقق الموثوق من مصدر البناء إلزامي وغير مُفعَّل — يُرفض النشر الحقيقي.",
      );
    }

    const cwd = dependencies.cwd();

    // Create a rollout from the EXACT commit on the GitHub-connected backend.
    const rollout = await dependencies.runCommand({
      stage: "deploy",
      file: "firebase",
      args: [
        "apphosting:rollouts:create",
        target.backendId,
        "--git-commit",
        commit.toLowerCase(),
        "--location",
        location,
        "--project",
        target.projectId,
        "--config",
        firebaseConfigFor(environment),
      ],
      cwd,
    });
    if (rollout.exitCode !== 0) {
      return failedPublish(
        target,
        "deploy",
        `فشل إنشاء rollout للـcommit المحدد على هدف ${environmentLabel(environment)}.`,
        rollout.exitCode,
      );
    }

    // Authoritative source-identity proof — MANDATORY.
    const buildSource = await dependencies.verifyBuildSource({
      expectedCommit: commit.toLowerCase(),
      projectId: target.projectId,
      backendId: target.backendId,
    });
    if (!buildSource.ok) {
      return {
        deployed: false,
        savedToGit: false,
        detail: `فشل التحقق من هوية مصدر البناء: ${buildSource.reason ?? "لا يوجد إثبات مصدر."}`,
        blocked: false,
        stage: "verify",
        target: target.projectId,
        releaseRef: releaseRef(target, commit),
        buildSource,
      };
    }

    if (!target.baseUrl) {
      return {
        deployed: false,
        savedToGit: false,
        detail: `ثبت مصدر البناء لكن تعذّر فحص حياة التطبيق: لا يوجد رابط تحقق مُهيَّأ لهدف ${environmentLabel(environment)}.`,
        blocked: false,
        stage: "verify",
        target: target.projectId,
        releaseRef: releaseRef(target, commit),
        buildSource,
      };
    }

    const verify = await dependencies.probeHealth({
      baseUrl: target.baseUrl,
      expectedCommit: commit.toLowerCase(),
      expectedVersion: null,
      requireCommitProof: false,
      allowProductionHost: environment === "LIVE",
    });
    if (!verify.ok) {
      return {
        deployed: false,
        savedToGit: false,
        detail: `فشل فحص حياة التطبيق بعد النشر: ${verify.reason ?? "التطبيق غير مُتاح."}`,
        blocked: false,
        stage: "verify",
        target: target.projectId,
        releaseRef: releaseRef(target, commit),
        verify,
        buildSource,
      };
    }

    return {
      deployed: true,
      savedToGit: false,
      detail: `نشر متحكَّم به لـcommit محدد إلى ${target.projectId} (${target.backendId}) مع إثبات مصدر البناء ومطابقة الـcommit.`,
      blocked: false,
      stage: null,
      target: target.projectId,
      releaseRef: releaseRef(target, commit),
      verify,
      buildSource,
    };
  }

  /**
   * REAL restore: create a new rollout on the SAME backend from an earlier
   * release's immutable commit, then prove the serving revision from the control
   * plane. Restoring from a mutable local folder or a recorded id that is not a
   * full commit SHA is impossible here.
   */
  async restore(input: {
    gitCommit: string;
    approval?: boolean;
    requestedTarget?: string | null;
    environment?: DeployTargetEnvironment;
  }): Promise<DeployRestoreOutcome> {
    const environment = input.environment ?? "TEST";
    const preflight = this.preflight(environment, "target");
    if ("blocked" in preflight) {
      return {
        restored: false,
        detail: preflight.blocked.detail,
        blocked: true,
        stage: preflight.blocked.stage ?? null,
        target: preflight.blocked.target ?? null,
      };
    }
    const { target } = preflight;
    const { dependencies } = this.options;

    if (input.approval !== true) {
      return {
        restored: false,
        detail: "استعادة النشر الحقيقي تتطلب تأكيدًا إداريًا صريحًا.",
        blocked: true,
        stage: "approval",
        target: target.projectId,
      };
    }

    const commit = input.gitCommit?.trim() ?? "";
    if (!isFullGitSha(commit)) {
      return {
        restored: false,
        detail: "مصدر الاستعادة ليس SHA كاملًا — لا يمكن استعادة إصدار غير ثابت.",
        blocked: true,
        stage: "source",
        target: target.projectId,
      };
    }

    const location = target.location?.trim() ?? "";
    if (!location) {
      return {
        restored: false,
        detail: `الاستعادة المتحكَّم بها تتطلب منطقة App Hosting (${DEPLOY_APP_HOSTING_LOCATION_ENV_KEY}).`,
        blocked: true,
        stage: "target",
        target: target.projectId,
      };
    }
    if (!dependencies.verifyBuildSource) {
      return {
        restored: false,
        detail: "التحقق الموثوق من مصدر البناء إلزامي وغير مُفعَّل — تُرفض الاستعادة الحقيقية.",
        blocked: true,
        stage: "verify",
        target: target.projectId,
      };
    }

    const rollout = await dependencies.runCommand({
      stage: "restore",
      file: "firebase",
      args: [
        "apphosting:rollouts:create",
        target.backendId,
        "--git-commit",
        commit.toLowerCase(),
        "--location",
        location,
        "--project",
        target.projectId,
        "--config",
        firebaseConfigFor(environment),
      ],
      cwd: dependencies.cwd(),
    });
    if (rollout.exitCode !== 0) {
      return {
        restored: false,
        detail: `فشل إنشاء rollout للاستعادة على ${target.backendId} (رمز الخروج: ${rollout.exitCode}).`,
        blocked: false,
        stage: "deploy",
        target: target.projectId,
        releaseRef: releaseRef(target, commit),
      };
    }

    const buildSource = await dependencies.verifyBuildSource({
      expectedCommit: commit.toLowerCase(),
      projectId: target.projectId,
      backendId: target.backendId,
    });
    if (!buildSource.ok) {
      return {
        restored: false,
        detail: `فشل التحقق من هوية مصدر البناء بعد الاستعادة: ${buildSource.reason ?? "لا يوجد إثبات مصدر."}`,
        blocked: false,
        stage: "verify",
        target: target.projectId,
        releaseRef: releaseRef(target, commit),
        buildSource,
      };
    }

    const verify = target.baseUrl
      ? await dependencies.probeHealth({
          baseUrl: target.baseUrl,
          expectedCommit: commit.toLowerCase(),
          expectedVersion: null,
          requireCommitProof: false,
          allowProductionHost: environment === "LIVE",
        })
      : null;
    if (verify && !verify.ok) {
      return {
        restored: false,
        detail: `فشل فحص حياة التطبيق بعد الاستعادة: ${verify.reason ?? "التطبيق غير مُتاح."}`,
        blocked: false,
        stage: "verify",
        target: target.projectId,
        releaseRef: releaseRef(target, commit),
        verify,
        buildSource,
      };
    }

    return {
      restored: true,
      detail: `استعادة متحكَّم بها لـcommit ${commit.slice(0, 7)} إلى ${target.projectId} (${target.backendId}).`,
      blocked: false,
      stage: null,
      target: target.projectId,
      releaseRef: releaseRef(target, commit),
      verify,
      buildSource,
    };
  }
}

/**
 * Default real dependencies: `execFile` (no shell) for the deploy commands and
 * the HTTP health probe. Used only when a real deploy is explicitly enabled.
 *
 * Windows: `firebase` exists only as a `.cmd` shim that Node refuses to spawn
 * directly, so the launch helper runs firebase-tools' JS entry through
 * `process.execPath` instead — still no shell, still a plain argv array. An
 * unresolvable entry falls back to the plain `firebase` spawn, preserving
 * every existing fail-closed failure path.
 */
export function createRealDeployDependencies(): RealDeployDependencies {
  return {
    runCommand(spec) {
      return new Promise<DeployCommandResult>((resolve) => {
        const launch =
          spec.file === "firebase"
            ? resolveFirebaseCommand()
            : { file: spec.file, prefixArgs: [] as string[] };
        execFile(
          launch.file,
          [...launch.prefixArgs, ...spec.args],
          {
            cwd: spec.cwd,
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
            env: spec.env ? { ...process.env, ...spec.env } : process.env,
          },
          (error, stdout, stderr) => {
            const exitCode =
              error && typeof (error as { code?: unknown }).code === "number"
                ? (error as { code: number }).code
                : error
                  ? 1
                  : 0;
            resolve({
              exitCode,
              stdout: stdout?.toString() ?? "",
              stderr: stderr?.toString() ?? "",
            });
          },
        );
      });
    },
    probeHealth({
      baseUrl,
      expectedCommit,
      expectedVersion,
      requireCommitProof,
      allowProductionHost,
    }) {
      return probeDeployHealth({
        baseUrl,
        expectedCommit,
        expectedVersion,
        requireCommitProof,
        allowProductionHost,
      });
    },
    // Present only when DEPLOY_BUILD_SOURCE_VERIFY=enabled AND a location is set.
    // The executor treats its ABSENCE as a hard block, so a real deploy can never
    // succeed without this proof.
    verifyBuildSource: createAppHostingVerifyDependency(),
    now: () => new Date(),
    cwd: () => process.cwd(),
  };
}
