/**
 * RWQAN DEPLOY — Phase E real deploy executor (DEV only).
 *
 * Performs a REAL, controlled rollout to the isolated development target and
 * PROVES the serving revision from the App Hosting control plane. A finished
 * command (or a reachable app) is never treated as success on its own.
 *
 * Safety properties (all enforced here, independently of the route):
 *   - the target is the fixed DEV target; production/unknown targets are refused
 *     before any command runs;
 *   - an explicit admin `approval` is required (no auto-deploy, ever);
 *   - commands run without a shell (no string interpolation, no injection);
 *   - the rollout is created for the EXACT commit on the GitHub-connected
 *     backend (never a local `firebase deploy` archive that records no commit);
 *   - a deploy is reported `deployed:true` ONLY after a MANDATORY control-plane
 *     source-identity proof whose serving build's `codebase.hash` equals the
 *     commit; the app probe only proves reachability;
 *   - every failure fails closed (`deployed:false`) with a non-secret reason.
 *
 * All side effects live behind injectable `dependencies`, so the whole flow is
 * unit-tested without touching the network, the CLI, or the filesystem.
 */
import { execFile } from "node:child_process";
import type { DeployPublishOutcome, DeployPublishStage } from "./DeployExecutor";
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
  type DeployTarget,
} from "../config/deployTarget";
import { probeDeployHealth } from "./DeployHealthService";
import {
  createAppHostingVerifyDependency,
  type BuildSourceVerifier,
} from "./DeployBuildSourceService";

export interface DeployCommandSpec {
  stage: "deploy";
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
   * MANDATORY for a real deploy: without it the publish is refused, because the
   * app probe alone can NOT prove which commit is serving. When present it must
   * pass (fail closed) before a deploy is ever reported as successful.
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
  }): Promise<DeployPostDeployVerification>;
  now(): Date;
  cwd(): string;
}

export interface RealDeployExecutorOptions {
  target: DeployTarget;
  dependencies: RealDeployDependencies;
  /** Re-checked at publish time: a real deploy must still be explicitly enabled. */
  realDeployEnabled: () => boolean;
}

function releaseRef(target: DeployTarget, commit: string): string {
  return `${target.backendId}:${commit.slice(0, 7)}`;
}

function blockedOutcome(
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

function failedOutcome(
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

  async publish(input: {
    gitCommit: string;
    checks: DeployChecks;
    approval?: boolean;
    requestedTarget?: string | null;
    worktree?: "clean" | "dirty" | "unknown";
  }): Promise<DeployPublishOutcome> {
    const { target, dependencies } = this.options;

    // 1) Real deploy must still be explicitly enabled.
    if (!this.options.realDeployEnabled()) {
      return blockedOutcome(
        target,
        "approval",
        "النشر الحقيقي غير مُفعَّل — الوضع الآمن محاكاة فقط.",
      );
    }

    // 2) Explicit admin approval is mandatory.
    if (input.approval !== true) {
      return blockedOutcome(
        target,
        "approval",
        "النشر الحقيقي يتطلب موافقة إدارية صريحة.",
      );
    }

    // 3) The target must be the isolated DEV target (never production/unknown).
    const blockers = deployTargetBlockers(target);
    if (blockers.length > 0) {
      return blockedOutcome(target, "target", blockers.join(" "));
    }

    // 4) A client-confirmed target, if sent, must match the fixed DEV target.
    const requested = input.requestedTarget?.trim();
    if (requested && requested !== target.projectId) {
      return blockedOutcome(
        target,
        "target",
        isProductionProjectId(requested)
          ? "الهدف المطلوب هو مشروع الإنتاج — يُرفض."
          : "الهدف المطلوب لا يطابق هدف التطوير المعزول.",
      );
    }

    // 5) The source identity must be provable before anything is deployed:
    //    a full 40-char SHA (a short/branch form cannot assert what was built)
    //    and a clean worktree (uncommitted changes mean the artifact would not
    //    correspond to the SHA). Anything else is refused.
    const commit = input.gitCommit?.trim() ?? "";
    if (!isFullGitSha(commit)) {
      return blockedOutcome(
        target,
        "source",
        "مرجع المصدر ليس SHA كاملًا (40 خانة سداسية) — لا يمكن تأكيد ما تم بناؤه.",
      );
    }
    const worktree = input.worktree ?? "unknown";
    if (worktree !== "clean") {
      return blockedOutcome(
        target,
        "source",
        worktree === "dirty"
          ? "شجرة العمل تحتوي تغييرات غير مُثبَّتة — لا يمكن تأكيد أن البناء يطابق الـcommit."
          : "حالة شجرة العمل غير معروفة — يجب التأكد من نظافتها قبل النشر الحقيقي.",
      );
    }

    // 6) A controlled rollout needs an explicit App Hosting region and a
    //    trustworthy control-plane verifier. BOTH are mandatory: without them we
    //    cannot create a GitHub rollout for the exact commit, nor prove the
    //    serving build came from it. We refuse rather than degrade to a weaker
    //    claim.
    const location = target.location?.trim() ?? "";
    if (!location) {
      return blockedOutcome(
        target,
        "target",
        `النشر المتحكَّم به يتطلب منطقة App Hosting (${DEPLOY_APP_HOSTING_LOCATION_ENV_KEY}).`,
      );
    }
    if (!dependencies.verifyBuildSource) {
      return blockedOutcome(
        target,
        "verify",
        "التحقق الموثوق من مصدر البناء إلزامي وغير مُفعَّل — يُرفض النشر الحقيقي.",
      );
    }

    const cwd = dependencies.cwd();

    // 7) Create a rollout from the EXACT commit on the GitHub-connected backend.
    //    The local `firebase deploy` path is intentionally NOT used: it uploads
    //    an archive with NO recorded commit, so source identity could never be
    //    proven. A finished command is still NOT proof (see steps 8-9).
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
        DEPLOY_DEV_FIREBASE_CONFIG,
      ],
      cwd,
    });
    if (rollout.exitCode !== 0) {
      return failedOutcome(
        target,
        "deploy",
        "فشل إنشاء rollout للـcommit المحدد على هدف التطوير.",
        rollout.exitCode,
      );
    }

    // 8) Authoritative source-identity proof — MANDATORY. The App Hosting control
    //    plane must confirm the build serving LIVE traffic was created from the
    //    SAME commit. This is the only trustworthy link; the app endpoint cannot
    //    prove it. Never assume the newest rollout is serving.
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

    // 9) Reachability probe — a finished command and a source match are not proof
    //    that the app answers. This only proves liveness (HTTP 200); the commit
    //    identity is proven above by the control plane, never by the app endpoint.
    if (!target.baseUrl) {
      return {
        deployed: false,
        savedToGit: false,
        detail:
          "ثبت مصدر البناء لكن تعذّر فحص حياة التطبيق: لا يوجد رابط تحقق مُهيَّأ (DEPLOY_DEV_BASE_URL).",
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

  async restore(_input: { gitCommit: string }) {
    return {
      restored: false,
      detail:
        "استعادة النشر الحقيقي غير مُفعَّلة في المرحلة E — الاستعادة المعزولة (المرحلة D) هي المسار المتاح.",
    };
  }
}

/**
 * Default real dependencies: `execFile` (no shell) for the build/deploy commands
 * and the HTTP health probe. Used only when a real deploy is explicitly enabled.
 */
export function createRealDeployDependencies(): RealDeployDependencies {
  return {
    runCommand(spec) {
      return new Promise<DeployCommandResult>((resolve) => {
        execFile(
          spec.file,
          spec.args,
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
    probeHealth({ baseUrl, expectedCommit, expectedVersion, requireCommitProof }) {
      return probeDeployHealth({
        baseUrl,
        expectedCommit,
        expectedVersion,
        requireCommitProof,
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
