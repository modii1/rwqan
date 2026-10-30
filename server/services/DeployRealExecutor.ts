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
  clearDeployAuth,
  getDeployAuthStatus,
  getFirebaseCliEnv,
  startDeployAuthFlow,
  verifyFirebaseCliAuth,
  nowMs,
  type DeployAuthStatus,
  type DeployAuthVerifyResult,
} from "./deployAuth";
import {
  createAppHostingVerifyDependency,
  type BuildSourceVerifier,
} from "./DeployBuildSourceService";
import { dispatchTestDeployWorkflow } from "./DeployGhWorkflowService";
import type {
  GhWorkflowDispatchResult,
  GhWorkflowDispatcher,
} from "./DeployGhWorkflowService";

export interface DeployCommandSpec {
  stage: "deploy" | "restore" | "auth-verify";
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
   * TEST publish delegation: dispatch GitHub's TEST deploy workflow
   * (workflow_dispatch) so GITHUB — not this app — creates the rollout.
   * When present, `publish()` for TEST NEVER runs Firebase CLI or any git
   * push; the dispatcher fails closed (blocked) when the pre-existing server
   * token is missing, and refusal happens BEFORE any state-changing call.
   */
  dispatchTestDeploy?: GhWorkflowDispatcher;
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

/**
 * Maximum characters kept from a Firebase CLI error stream before truncation.
 * Keeps the message useful for diagnosis while avoiding large raw dumps.
 */
const DEPLOY_ERROR_MAX_CHARS = 500;

/**
 * Maximum number of lines kept from a Firebase CLI error stream.
 */
const DEPLOY_ERROR_MAX_LINES = 5;

/**
 * Patterns that may indicate secrets, tokens, keys, or credentials in CLI
 * output. These are redacted before any error text leaves the server.
 */
const DEPLOY_ERROR_SECRET_PATTERNS: RegExp[] = [
  /(AIza[0-9A-Za-z_\-]{35,})/g,
  /(sk-[A-Za-z0-9]{20,})/g,
  /(ghp_[A-Za-z0-9]{20,})/g,
  /(gho_[A-Za-z0-9]{20,})/g,
  /(ghu_[A-Za-z0-9]{20,})/g,
  /(ghs_[A-Za-z0-9]{20,})/g,
  /(xox[baprs]-[A-Za-z0-9-]{10,})/g,
  /(eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,})/g,
  /(password|passwd|secret|token|api[_-]?key|private[_-]?key)\s*[:=]\s*\S+/gi,
];

/**
 * Redacts potential credentials embedded in a URL (user:pass@host).
 */
function redactUrlCredentials(text: string): string {
  return text.replace(
    /(https?:\/\/)[^@\/]+(:[^@\/]+)?@/gi,
    "$1redacted@",
  );
}

/**
 * Sanitize a Firebase CLI error stream before it leaves the server.
 *
 * - Redacts potential secrets/tokens/keys/credentials.
 * - Redacts URL-embedded credentials.
 * - Caps total characters and line count.
 * - If sanitization cannot be guaranteed, returns a safe fallback that names
 *   only the exit code and a generic reason.
 *
 * Never returns raw CLI output to the browser or audit log.
 */
function sanitizeDeployError(
  reason: string,
  stderr: string | undefined | null,
  stdout: string | undefined | null,
  exitCode: number,
): string {
  const rawParts: string[] = [];
  if (stderr && stderr.trim().length > 0) rawParts.push(stderr.trim());
  if (stdout && stdout.trim().length > 0) rawParts.push(stdout.trim());

  let combined = rawParts.join("\n").trim();

  // If there is no CLI output at all, the reason + exit code is the safest message.
  if (!combined) {
    return `${reason} (رمز الخروج: ${exitCode})`;
  }

  // Redact URL credentials first.
  combined = redactUrlCredentials(combined);

  // Extract and redact potential secret patterns — keep the rest of the
  // diagnostic text so Firebase CLI error messages are not hidden behind a
  // generic fallback. Secrets are redacted but surrounding text is retained.
  for (const pattern of DEPLOY_ERROR_SECRET_PATTERNS) {
    combined = combined.replace(pattern, (match) => {
      return match.slice(0, 4) + "***REDACTED***";
    });
  }

  const cap = (text: string): string => {
    const lines = text.split(/\r?\n/).slice(0, DEPLOY_ERROR_MAX_LINES);
    let capped = lines.join(" ");
    if (capped.length > DEPLOY_ERROR_MAX_CHARS) {
      capped = capped.slice(0, DEPLOY_ERROR_MAX_CHARS) + "…";
    }
    return capped;
  };

  let result = cap(combined);
  if (!result || result.length < 3) {
    return `${reason} (رمز الخروج: ${exitCode})`;
  }
  return `${reason} — ${result} (رمز الخروج: ${exitCode})`;
}

function failedPublish(
  target: DeployTarget,
  stage: DeployPublishStage,
  result: DeployCommandResult | null,
  reason: string,
): DeployPublishOutcome {
  const exitCode = result?.exitCode ?? 1;
  return {
    deployed: false,
    savedToGit: false,
    detail: sanitizeDeployError(
      reason,
      result?.stderr ?? undefined,
      result?.stdout ?? undefined,
      exitCode,
    ),
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
    /** Server-side session id used to resolve Firebase CLI credentials (FIREBASE_TOKEN). */
    sessionId?: string;
    /** Admin id that owns the credentials, used to prevent cross-admin credential use. */
    adminId?: string;
    /** Pending publish intent to store for automatic resume after OAuth. */
    pendingPublish?: {
      gitCommit: string;
      environment: string;
      approval: boolean;
      requestedTarget?: string | null;
      worktree?: string;
      sessionId: string;
      adminId?: string;
      createdAt: number;
    };
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

    const cwd = dependencies.cwd();

    // TEST publish DELEGATION (GitHub Actions): instead of the app running the
    // Firebase CLI / apphosting:rollouts:create directly for TEST, it ASKS
    // GitHub to run the TEST deploy workflow, which creates the rollout from
    // the branch's remote tip on `modii1/rwqan @ apphosting/test-secret-isolation`.
    // No git push, no Firebase CLI, no new credentials — a missing pre-existing
    // GitHub token fails closed with a clear admin-facing reason, and a remote
    // tip that differs from the approved commit is refused (GitHub checks out
    // the branch tip, so a mismatch would deploy an unapproved commit).
    if (environment === "TEST" && dependencies.dispatchTestDeploy) {
      const gh: GhWorkflowDispatchResult = await dependencies.dispatchTestDeploy({
        commit: commit.toLowerCase(),
        cwd,
      });
      if (gh.kind === "accepted") {
        return {
          deployed: false, // a dispatch is a request; GitHub owns the rollout
          savedToGit: false,
          detail: gh.detail,
          blocked: false,
          stage: null,
          target: target.projectId,
          releaseRef: releaseRef(target, commit),
          ghDispatch: {
            accepted: true,
            ref: gh.branch,
            actionsUrl: gh.actionsUrl,
          },
        };
      }
      if (gh.kind === "blocked") {
        return blockedPublish(target, gh.stage, gh.reason);
      }
      return {
        deployed: false,
        savedToGit: false,
        detail: gh.reason,
        blocked: false,
        stage: "deploy",
        target: target.projectId,
        releaseRef: releaseRef(target, commit),
      };
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

    // Firebase CLI authentication is required to run apphosting commands.
    // Resolve FIREBASE_TOKEN from the server-side session credentials and
    // inject it into the command environment. Never return the token to the
    // caller or log it.
    let cliEnv: Record<string, string> | undefined;
    if (input.sessionId) {
      const authStatus: DeployAuthStatus = await getDeployAuthStatus(
        input.sessionId,
        input.adminId,
      );
      if (!authStatus.authenticated) {
        // Store the pending publish intent for automatic resume after OAuth.
        // Single-use: deleted after retrieval via getAndDeletePendingPublish.
        if (input.pendingPublish) {
          void startDeployAuthFlow(input.sessionId, input.adminId, {
            ...input.pendingPublish,
            sessionId: input.sessionId,
            adminId: input.adminId,
            createdAt: nowMs(),
          });
        } else {
          void startDeployAuthFlow(input.sessionId, input.adminId);
        }
        return {
          deployed: false,
          savedToGit: false,
          detail:
            "مصادقة Firebase CLI مطلوبة قبل النشر. يُرجى تسجيل الدخول عبر Google ثم المحاولة مجددًا.",
          blocked: false,
          stage: "auth",
          target: target.projectId,
          authRequired: true,
          authUrl: undefined,
        };
      }
      const verified: DeployAuthVerifyResult = await verifyFirebaseCliAuth(
        input.sessionId,
        input.adminId,
        cwd,
      );
      if (!verified.valid) {
        if (input.pendingPublish) {
          void startDeployAuthFlow(input.sessionId, input.adminId, {
            ...input.pendingPublish,
            sessionId: input.sessionId,
            adminId: input.adminId,
            createdAt: nowMs(),
          });
        } else {
          void startDeployAuthFlow(input.sessionId, input.adminId);
        }
        return {
          deployed: false,
          savedToGit: false,
          detail:
            "بيانات اعتماد Firebase CLI غير صالحة أو منتهية. يُرجى تسجيل الدخول عبر Google مرة أخرى.",
          blocked: false,
          stage: "auth",
          target: target.projectId,
          authRequired: true,
          authUrl: undefined,
        };
      }
      cliEnv = (await getFirebaseCliEnv(input.sessionId, input.adminId)) ?? undefined;
      if (!cliEnv) {
        if (input.pendingPublish) {
          void startDeployAuthFlow(input.sessionId, input.adminId, {
            ...input.pendingPublish,
            sessionId: input.sessionId,
            adminId: input.adminId,
            createdAt: nowMs(),
          });
        } else {
          void startDeployAuthFlow(input.sessionId, input.adminId);
        }
        return {
          deployed: false,
          savedToGit: false,
          detail:
            "بيانات اعتماد Firebase CLI غير متوفرة. يُرجى تسجيل الدخول عبر Google ثم المحاولة مجددًا.",
          blocked: false,
          stage: "auth",
          target: target.projectId,
          authRequired: true,
          authUrl: undefined,
        };
      }

      // Pre-flight read-only check: confirm the Firebase CLI can authenticate
      // with the stored credentials BEFORE creating any rollout. This runs
      // `firebase projects:list` which requires no project selection and creates
      // no rollout or deploy. If this fails, refuse the publish with a clear
      // message instead of creating a rollout that will fail.
      const cliProbe = await dependencies.runCommand({
        stage: "auth-verify",
        file: "firebase",
        args: ["projects:list", "--format=json"],
        cwd,
        env: cliEnv,
      });
      if (cliProbe.exitCode !== 0) {
        if (input.pendingPublish) {
          void startDeployAuthFlow(
            input.sessionId,
            input.adminId,
            input.pendingPublish,
          );
        } else {
          void startDeployAuthFlow(input.sessionId, input.adminId);
        }
        return {
          deployed: false,
          savedToGit: false,
          detail:
            "تعذّر المصادقة مع Firebase CLI باستخدام بيانات الاعتماد المخزّنة. يُرجى تسجيل الدخول عبر Google مرة أخرى أو التحقق من صلاحيات الحساب.",
          blocked: false,
          stage: "auth",
          target: target.projectId,
          authRequired: true,
          authUrl: undefined,
        };
      }
    }

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
      env: cliEnv ?? undefined,
    });
    if (rollout.exitCode !== 0) {
      return failedPublish(
        target,
        "deploy",
        rollout,
        `فشل إنشاء rollout للـcommit المحدد على هدف ${environmentLabel(environment)}.`,
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
    /** Server-side session id used to resolve Firebase CLI credentials (FIREBASE_TOKEN). */
    sessionId?: string;
    /** Admin id that owns the credentials, used to prevent cross-admin credential use. */
    adminId?: string;
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

    const rolloutEnv = (() => {
      if (!input.sessionId) return undefined;
      return undefined; // resolved asynchronously below
    })();
    let cliEnvRestore: Record<string, string> | undefined;
    if (input.sessionId) {
      const authStatus = await getDeployAuthStatus(
        input.sessionId,
        input.adminId,
      );
      if (authStatus.authenticated) {
        const verified = await verifyFirebaseCliAuth(
          input.sessionId,
          input.adminId,
          dependencies.cwd(),
        );
        if (verified.valid) {
          cliEnvRestore = (await getFirebaseCliEnv(
            input.sessionId,
            input.adminId,
          )) ?? undefined;
        }
      }
    }

    // Pre-flight read-only check for restore: confirm the Firebase CLI can
    // authenticate before creating any rollout.
    if (cliEnvRestore) {
      const cliProbe = await dependencies.runCommand({
        stage: "auth-verify",
        file: "firebase",
        args: ["projects:list", "--format=json"],
        cwd: dependencies.cwd(),
        env: cliEnvRestore,
      });
      if (cliProbe.exitCode !== 0) {
        return {
          restored: false,
          detail:
            "تعذّر المصادقة مع Firebase CLI باستخدام بيانات الاعتماد المخزّنة. يُرجى تسجيل الدخول عبر Google مرة أخرى أو التحقق من صلاحيات الحساب.",
          blocked: false,
          stage: "auth",
          target: target.projectId,
        };
      }
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
      env: cliEnvRestore ?? undefined,
    });
    if (rollout.exitCode !== 0) {
      return {
        restored: false,
        detail: sanitizeDeployError(
          `فشل إنشاء rollout للاستعادة على ${target.backendId}.`,
          rollout.stderr ?? undefined,
          rollout.stdout ?? undefined,
          rollout.exitCode,
        ),
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
    dispatchTestDeploy: (request) => dispatchTestDeployWorkflow(request),
    now: () => new Date(),
    cwd: () => process.cwd(),
  };
}
