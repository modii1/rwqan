import { Router, type Response } from "express";
import { requireAdmin, requireSameOrigin } from "../middleware";
import {
  DEPLOY_STORE_UNAVAILABLE_BODY,
  DEPLOY_SYSTEM_DISABLED_BODY,
  deploySystemEnabled,
} from "../../config/deployEnvironment";
import {
  buildDeployState,
  DEPLOY_SYSTEM_PROTOTYPE_VERSION,
  DeployStoreUnavailableError,
  evaluateRestore,
  getDeploySystemStore,
  type DeploySystemStoreContract,
} from "../../services/DeploySystemStore";
import { resolveStableRelease } from "../../services/StableReleaseService";
import {
  collectDeployChecks,
  type DeployCheckReport,
} from "../../services/DeployChecksService";
import {
  buildChecksMeta,
  runReleaseChecks,
} from "../../services/DeployChecksRunner";
import { readDeployGitInfo } from "../../services/DeployGitInfoService";
import {
  githubLsRemoteEnabled,
  readDeployGitHubInfo,
} from "../../services/DeployGitHubService";
import {
  createDeployExecutor,
  type DeployExecutor,
  type DeployPublishOutcome,
} from "../../services/DeployExecutor";
import { productionDeployEnabled } from "../../config/deployTarget";
import {
  buildRestorePreview as defaultBuildRestorePreview,
} from "../../services/DeployRestoreService";
import {
  DEPLOY_PUBLISH_NOTICE,
  DEPLOY_RESTORE_REAL_NOTICE,
  isFullGitSha,
  type DeployChecks,
  type DeployCheckRun,
  type DeployEnvironment,
  type DeployGitHubInfo,
  type DeployGitInfo,
  type DeployPostDeployVerification,
  type DeployRelease,
  type DeployRestorePreview,
  type DeployToolsInfo,
  type DeployWorktreeState,
} from "../../../shared/deploySystem";
import { readDeployToolsInfo } from "../../services/DeployToolsService";
import {
  getDeployAuthStatus,
  startDeployAuthFlow,
  getAndDeletePendingPublish,
  type DeployAuthStartResult,
} from "../../services/deployAuth";

/**
 * RWQAN DEPLOY — admin release registry (Phase C).
 *
 * Guarded by the central `/api/admin` boundary plus this router's own
 * requireSameOrigin/requireAdmin/DEV gate (fail closed outside development).
 *
 * Every value that matters for trust (status, actor, Git provenance) is derived
 * server-side and can never be supplied by the client:
 *   - Git commit/branch/tag/remote come from a read-only local Git probe;
 *   - the release status comes from the server-side checks;
 *   - `savedToGit`/`deployed` are always false — no commit, push, or deploy;
 *   - the actor is the authenticated admin session.
 *
 * A storage failure is surfaced as 503 and never reported as success.
 */

const VERSION_MAX_LENGTH = 40;
const CHANGE_SUMMARY_MAX_LENGTH = 500;
const RELEASE_ID_MAX_LENGTH = 120;

export interface DeployRouterOptions {
  enabled?: () => boolean;
  /** Test seam: override the server-side checks collection. */
  collectChecks?: () => Promise<DeployCheckReport>;
  /** Test seam: override the explicit release-checks run. */
  runChecks?: () => Promise<DeployCheckRun>;
  /**
   * Deploy/restore executor. Defaults to a fail-closed executor (nothing is
   * built, committed, pushed, or deployed) unless a real deploy is explicitly
   * enabled. A real executor resolves its target from the active environment,
   * requires explicit approval, and never auto-deploys on a plain push.
   */
  executor?: DeployExecutor;
  /** Test seam: decide whether production deploys are enabled (defaults to env). */
  productionDeployEnabled?: () => boolean;
  /** Test seam: override the read-only restore preview (Phase D). */
  restorePreview?: (
    release: DeployRelease,
    context: DeployRestoreContext,
  ) => Promise<DeployRestorePreview>;
  /**
   * Test seam: resolve the verified official stable release for a repo cwd.
   * Defaults to the real, read-only Git verification (fail closed to null).
   */
  resolveStableRelease?: (cwd: string) => Promise<DeployRelease | null>;
  /**
   * Test seam: read-only deploy-tools availability (`firebase --version` probe,
   * cached). Defaults to the real probe; tests inject a stub so no test ever
   * needs the CLI on the machine.
   */
  readTools?: () => Promise<DeployToolsInfo>;
}

/** DEV root + observed working-tree state + target environment for a restore. */
export interface DeployRestoreContext {
  devRoot: string;
  worktree: DeployWorktreeState | null;
  /** Active environment the restore targets (console env). */
  targetEnvironment: DeployEnvironment;
  /** TRUE only when a LIVE target restore has been explicitly approved. */
  liveRestoreApproved: boolean;
}

function isDeployEnvironment(value: unknown): value is DeployEnvironment {
  return value === "TEST" || value === "LIVE" || value === "LOCAL";
}

function boundedString(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximumLength) return null;
  return trimmed;
}

function optionalBoundedString(value: unknown, maximumLength: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > maximumLength ? trimmed.slice(0, maximumLength) : trimmed;
}

function handleStoreFailure(res: Response, error: unknown): boolean {
  if (error instanceof DeployStoreUnavailableError) {
    res.status(503).json(DEPLOY_STORE_UNAVAILABLE_BODY);
    return true;
  }
  return false;
}

/** Compact, secret-free summary of a checks run for the audit log. */
function describeChecks(checks: DeployChecks): string {
  return (Object.keys(checks) as (keyof DeployChecks)[])
    .map((key) => `${key}=${checks[key]}`)
    .join(", ");
}

export function createAdminDeployRouter(
  storeOverride?: DeploySystemStoreContract,
  options: DeployRouterOptions = {},
) {
  const enabled = options.enabled ?? (() => deploySystemEnabled());
  const collectChecks = options.collectChecks ?? (() => collectDeployChecks(process.cwd()));
  const runChecks = options.runChecks ?? (() => runReleaseChecks(process.cwd()));
  const executor = options.executor ?? createDeployExecutor();
  const productionEnabled = options.productionDeployEnabled ?? (() => productionDeployEnabled());
  const restorePreview =
    options.restorePreview ??
    ((release, context) =>
      defaultBuildRestorePreview({
        release,
        devRoot: context.devRoot,
        worktree: context.worktree,
        targetEnvironment: context.targetEnvironment,
        liveRestoreApproved: context.liveRestoreApproved,
      }));
  const resolveStable =
    options.resolveStableRelease ?? ((cwd: string) => resolveStableRelease({ cwd }));
  const readTools = options.readTools ?? (() => readDeployToolsInfo());
  const getStore = (): DeploySystemStoreContract =>
    storeOverride ?? getDeploySystemStore();
  /** Single-flight guard: a second real restore is refused while one runs. */
  let restoreInFlight = false;
  /**
   * Single-flight guard for publishes (mirrors the restore guard): a second
   * REAL publish is refused with 409 while one runs, so concurrent requests
   * cannot double-create rollouts or present misleading state. The flag is set
   * synchronously before any await and cleared in `finally` on every path.
   */
  let publishInFlight = false;

  /**
   * Read-only Git/GitHub context. Local Git is read always; the GitHub remote
   * SHA is read from a pre-existing local ref (never a token, fetch, or push),
   * with an optional read-only `ls-remote` only when explicitly enabled.
   */
  const readGitContext = async (): Promise<{
    git: DeployGitInfo | null;
    github: DeployGitHubInfo | null;
    stableRelease: DeployRelease | null;
    tools: DeployToolsInfo | null;
  }> => {
    // Verified only when the commit exists AND is reachable locally (read-only).
    const stableRelease = await resolveStable(process.cwd()).catch(() => null);
    // The tools probe is cached and local-only; a failure is never an error,
    // just "could not be adjudged" (the gate renders غير متحقق).
    const tools = await readTools().catch(() => null);
    const git = await readDeployGitInfo(process.cwd()).catch(() => null);
    if (!git) return { git: null, github: null, stableRelease, tools };
    const github = await readDeployGitHubInfo({
      cwd: process.cwd(),
      localSha: git.commitSha,
      branch: git.branch,
      allowLsRemote: githubLsRemoteEnabled(),
    }).catch(() => null);
    return { git, github, stableRelease, tools };
  };

  const router = Router();

  router.use("/api/admin/deploy", requireSameOrigin, requireAdmin);
  router.use("/api/admin/deploy", (_req, res, next) => {
    if (!enabled()) {
      res.status(404).json(DEPLOY_SYSTEM_DISABLED_BODY);
      return;
    }
    next();
  });

  router.get("/api/admin/deploy/state", async (_req, res) => {
    res.set("Cache-Control", "no-store, private");
    try {
      const context = await readGitContext();
      const state = await buildDeployState(getStore(), context);
      res.json({
        prototypeVersion: DEPLOY_SYSTEM_PROTOTYPE_VERSION,
        publishNotice: DEPLOY_PUBLISH_NOTICE,
        state,
      });
    } catch (error) {
      if (!handleStoreFailure(res, error)) {
        res.status(500).json({ code: "DEPLOY_STATE_FAILED", error: "تعذّر تحميل حالة النشر." });
      }
    }
  });

  // Explicit release-checks run (outside the publish request). Executes the
  // DEV-safe local checks (real `tsc --noEmit` + secret scan) and stores the
  // result with run times. Slow checks (tests/build) stay NOT_RUN with a reason.
  router.post("/api/admin/deploy/checks", async (_req, res) => {
    res.set("Cache-Control", "no-store, private");
    const store = getStore();
    try {
      if (!(await store.isPersistent())) {
        res.status(503).json(DEPLOY_STORE_UNAVAILABLE_BODY);
        return;
      }
      const checkRun = await runChecks();
      await store.recordCheckRun(checkRun);
      const environment = await store.getEnvironment();
      const context = await readGitContext();
      await store.recordAudit({
        action: "checks_run",
        environment,
        result: "ok",
        reason: describeChecks(checkRun.checks),
      });
      res.json({
        checkRun,
        publishNotice: DEPLOY_PUBLISH_NOTICE,
        state: await buildDeployState(store, context),
      });
    } catch (error) {
      if (!handleStoreFailure(res, error)) {
        res.status(500).json({ code: "DEPLOY_CHECKS_FAILED", error: "تعذّر تشغيل فحوص الإصدار." });
      }
    }
  });

  router.post("/api/admin/deploy/environment", async (req, res) => {
    res.set("Cache-Control", "no-store, private");
    const environment = (req.body ?? {}).environment;
    if (!isDeployEnvironment(environment)) {
      res.status(400).json({
        code: "INVALID_ENVIRONMENT",
        error: "قيمة البيئة غير صالحة (TEST أو LIVE).",
      });
      return;
    }
    const store = getStore();
    try {
      await store.setEnvironment(environment);
      await store.recordAudit({
        action: "environment_changed",
        environment,
        result: "ok",
      });
      res.json({
        publishNotice: DEPLOY_PUBLISH_NOTICE,
        state: await buildDeployState(store, await readGitContext()),
      });
    } catch (error) {
      if (!handleStoreFailure(res, error)) {
        res.status(500).json({ code: "DEPLOY_ENV_FAILED", error: "تعذّر تبديل البيئة." });
      }
    }
  });

  router.post("/api/admin/deploy/releases", async (req, res) => {
    res.set("Cache-Control", "no-store, private");
    // Single-flight: refuse a second publish while one is running (checked and
    // set synchronously BEFORE any await, so overlapping requests are excluded).
    if (publishInFlight) {
      res.status(409).json({
        code: "DEPLOY_PUBLISH_IN_PROGRESS",
        error: "عملية نشر قيد التنفيذ بالفعل — انتظر انتهاءها قبل المحاولة مجددًا.",
      });
      return;
    }
    publishInFlight = true;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const explicitVersion = boundedString(body.version, VERSION_MAX_LENGTH);
    let version = explicitVersion ?? DEPLOY_SYSTEM_PROTOTYPE_VERSION;
    const changeSummary = optionalBoundedString(
      body.changeSummary,
      CHANGE_SUMMARY_MAX_LENGTH,
    );

    const store = getStore();
    try {
      // Fail closed before doing any work: no durable store, no record.
      if (!(await store.isPersistent())) {
        res.status(503).json(DEPLOY_STORE_UNAVAILABLE_BODY);
        return;
      }
      const storeEnvironment = await store.getEnvironment();
      // The UI environment selector is the client's expression of intent; the
      // server-side store is the source of truth. If the client sends an
      // environment it must match the store's active environment — otherwise
      // the two are out of sync and the publish is refused (fail closed). If
      // the client omits it, the store's active environment is used.
      const bodyEnvironment =
        typeof body.environment === "string" ? body.environment : null;
      if (bodyEnvironment !== null && !isDeployEnvironment(bodyEnvironment)) {
        res.status(400).json({
          code: "INVALID_ENVIRONMENT",
          error: "قيمة البيئة غير صالحة (TEST أو LIVE).",
        });
        return;
      }
      const environment = bodyEnvironment ?? storeEnvironment;
      if (bodyEnvironment !== null && bodyEnvironment !== storeEnvironment) {
        await store.recordAudit({
          action: "publish_failed",
          environment: storeEnvironment,
          result: "rejected",
          reason:
            "تضارب بين البيئة المختارة في الواجهة وحالة الخادم — لم يُنفَّذ أي نشر.",
        });
        res.status(409).json({
          code: "DEPLOY_ENVIRONMENT_MISMATCH",
          error: "تضارب بين البيئة المختارة في الواجهة وحالة الخادم.",
        });
        return;
      }
      const context = await readGitContext();
      const report = await collectChecks();
      // Use the latest explicitly-run checks (real results + run times) where
      // available; the fresh in-request secret scan always wins so a secret
      // added since that run is still caught. Without a stored run the
      // in-request checks (NOT_RUN with reasons) are used as-is.
      const storedRun = await store.getLatestCheckRun().catch(() => null);
      const publishRanAt = new Date().toISOString();
      const checks: DeployChecks = {
        ...(storedRun ? storedRun.checks : report.checks),
        secretScan: report.checks.secretScan,
      };
      const checksMeta =
        storedRun?.meta ??
        buildChecksMeta(report.checks, report.reasons, publishRanAt);
      const failedChecks = checks.secretScan !== "PASS" || checks.typescript === "FAIL";

      // Explicit admin approval + (optional) client-confirmed target. The client
      // can never pick the real target: it is fixed server-side; a mismatch or a
      // production value is refused by the executor.
      const publishBody = (req.body ?? {}) as Record<string, unknown>;
      const approval = publishBody.approve === true || publishBody.approval === true;
      const requestedTarget =
        typeof publishBody.target === "string" ? publishBody.target : null;

      // Ask the REAL executor to perform the publish. There is NO simulation: if
      // the real deploy path is not enabled the executor fails closed (blocked)
      // and NO release record is created. A publish is recorded ONLY when the
      // executor deployed AND the control-plane source proof AND the post-deploy
      // probe both passed.
      let deployed = false;
      let savedToGit = false;
      let deployTarget: string | undefined;
      let deployRef: string | null = null;
      let postDeploy: DeployPostDeployVerification | null = null;
      let deployDetail = DEPLOY_PUBLISH_NOTICE;
      if (!failedChecks) {
        // Firebase CLI authentication is required before any rollout command
        // can run. Check server-side session credentials first (fail closed).
        const sessionId = (req.sessionID ?? "") as string;
        const adminId = sessionId; // Session ID is the admin-scoped identifier.
        const authStatus = await getDeployAuthStatus(sessionId, adminId);
        if (!authStatus.authenticated) {
          // Store the pending publish intent for automatic resume after OAuth.
          // Single-use: deleted after retrieval via getAndDeletePendingPublish.
          const pendingPublish = {
            gitCommit: report.git?.commit ?? "",
            environment: environment as string,
            approval: approval === true,
            requestedTarget,
            worktree: (context.git?.worktree ?? "unknown") as string,
            sessionId,
            adminId,
            createdAt: Date.now(),
          };
          const authStart: DeployAuthStartResult = startDeployAuthFlow(
            sessionId,
            adminId,
            pendingPublish,
          );
          if (authStart.status === "not_configured") {
            await store.recordAudit({
              action: "publish_failed",
              environment,
              result: "rejected",
              reason: "إعدادات OAuth غير مهيأة على الخادم — لا يمكن إنشاء rollout.",
            });
            res.status(503).json({
              code: "DEPLOY_AUTH_NOT_CONFIGURED",
              error: authStart.reason,
            });
            return;
          }
          await store.recordAudit({
            action: "publish_failed",
            environment,
            result: "rejected",
            reason: "مصادقة Firebase CLI مطلوبة قبل النشر.",
          });
          res.status(403).json({
            code: "DEPLOY_AUTH_REQUIRED",
            error: "مصادقة Firebase CLI مطلوبة قبل النشر. يُرجى تسجيل الدخول عبر Google ثم المحاولة مجددًا.",
            authUrl: authStart.authUrl ?? null,
          });
          return;
        }

        let outcome: DeployPublishOutcome;
        try {
          outcome = await executor.publish({
            gitCommit: report.git?.commit ?? "",
            checks,
            approval,
            requestedTarget,
            worktree: context.git?.worktree ?? "unknown",
            environment,
            sessionId,
            adminId,
          });
        } catch (error) {
          await store.recordAudit({
            action: "publish_failed",
            environment,
            result: "rejected",
            reason: `تعذّر تنفيذ النشر: ${error instanceof Error ? error.message : String(error)}`,
          });
          res.status(502).json({
            code: "DEPLOY_EXECUTOR_FAILED",
            error: "تعذّر تنفيذ النشر.",
          });
          return;
        }

        deployDetail = outcome.detail;
        if (outcome.blocked === true) {
          await store.recordAudit({
            action: "publish_blocked",
            environment,
            result: "rejected",
            reason: outcome.detail,
          });
          res.status(409).json({
            code: "DEPLOY_BLOCKED",
            error: outcome.detail,
            stage: outcome.stage ?? null,
            target: outcome.target ?? null,
          });
          return;
        }
        if (outcome.authRequired === true) {
          await store.recordAudit({
            action: "publish_failed",
            environment,
            result: "rejected",
            reason: outcome.detail,
          });
          res.status(403).json({
            code: "DEPLOY_AUTH_REQUIRED",
            error: outcome.detail,
            authUrl: outcome.authUrl ?? null,
          });
          return;
        }
        if (outcome.ghDispatch?.accepted === true) {
          // The TEST publish was delegated to GitHub Actions (workflow_dispatch).
          // GitHub — not this app — creates the rollout, so this is recorded as
          // a REQUEST, never as a deploy; there is no release record here.
          await store.recordAudit({
            action: "publish_dispatched",
            environment,
            result: "accepted",
            reason: outcome.detail,
          });
          res.status(202).json({
            code: "DEPLOY_GITHUB_DISPATCH_ACCEPTED",
            detail: outcome.detail,
            target: outcome.target ?? null,
            branch: outcome.ghDispatch.ref,
            actionsUrl: outcome.ghDispatch.actionsUrl,
          });
          return;
        }
        if (!outcome.deployed) {
          // The executor reached a stage and failed (build/deploy/verify) or
          // returned an ambiguous outcome — never recorded as success.
          await store.recordAudit({
            action: "publish_failed",
            environment,
            result: "rejected",
            reason: outcome.detail,
          });
          res.status(502).json({
            code: "DEPLOY_EXECUTOR_FAILED",
            error: outcome.detail,
            stage: outcome.stage ?? null,
            target: outcome.target ?? null,
          });
          return;
        }
        // The executor CLAIMS a deploy. Require the authoritative evidence: a
        // control-plane source-identity proof AND a reachability probe. A
        // finished command (or a claim of success) is never accepted as proof.
        const sourceProven = outcome.buildSource?.ok === true;
        const reachable = outcome.verify?.ok === true;
        if (!sourceProven || !reachable) {
          await store.recordAudit({
            action: "publish_failed",
            environment,
            result: "rejected",
            reason: `ادّعى المنفّذ النشر دون إثبات كافٍ: ${outcome.detail}`,
          });
          res.status(502).json({
            code: "DEPLOY_UNVERIFIED",
            error: "لم يثبت التحقق من النشر — لا يُسجَّل كنجاح.",
            stage: "verify",
            target: outcome.target ?? null,
          });
          return;
        }
        deployed = true;
        savedToGit = outcome.savedToGit;
        deployTarget = outcome.target ?? undefined;
        deployRef = outcome.releaseRef ?? null;
        postDeploy = outcome.verify ?? null;
      }

      // A REAL deploy always carries a real version. When the client sent none,
      // the prototype placeholder would wrongly keep the record out of the
      // stable list, so derive the version from the deployed commit's short SHA.
      if (deployed && !explicitVersion && report.git?.commit) {
        version = report.git.commit.slice(0, 7);
      }

      const release = await store.createRelease({
        version,
        environment,
        changeSummary,
        git: report.git,
        gitInfo: context.git,
        github: context.github,
        checks,
        checksMeta,
        checkRunAt: storedRun?.ranAt ?? null,
        checkNotes: report.reasons,
        deployed,
        savedToGit,
        deployTarget,
        deployRef,
        postDeploy,
      });
      const failed = release.status === "validation_failed";
      const auditAction = failed ? "publish_failed" : "publish";
      const audit = await store.recordAudit({
        action: auditAction,
        environment,
        result: failed ? "rejected" : "ok",
        releaseId: release.releaseId,
        reason: failed
          ? release.error ?? "فشل فحص إلزامي"
          : deployDetail,
      });

      res.status(201).json({
        release,
        audit,
        checks: release.checks,
        checkNotes: release.checkNotes ?? {},
        publishNotice: DEPLOY_PUBLISH_NOTICE,
        state: await buildDeployState(store, context),
      });
    } catch (error) {
      if (!handleStoreFailure(res, error)) {
        res.status(500).json({ code: "DEPLOY_PUBLISH_FAILED", error: "تعذّر تسجيل الإصدار." });
      }
    } finally {
      publishInFlight = false;
    }
  });

  // Read-only restore PREVIEW. Reports whether a release CAN be restored (valid
  // full SHA, local commit, trustworthy source, safe target, environment rule)
  // without executing anything. The working-tree state is reported for
  // information only — it is NOT a blocker, because the restore is built from an
  // immutable commit and the preview must match the real restore gate exactly.
  router.post(
    "/api/admin/deploy/releases/:releaseId/restore/preview",
    async (req, res) => {
      res.set("Cache-Control", "no-store, private");
      const releaseId = boundedString(req.params.releaseId, RELEASE_ID_MAX_LENGTH);
      if (!releaseId) {
        res.status(400).json({
          code: "INVALID_RELEASE_ID",
          error: "معرّف الإصدار غير صالح",
        });
        return;
      }
      const store = getStore();
      try {
        const environment = await store.getEnvironment();
        const context = await readGitContext();
        // The stable release lives in config (not the registry); resolve it here
        // so a preview is possible for it too.
        const release =
          (await store.getRelease(releaseId)) ??
          (context.stableRelease?.releaseId === releaseId
            ? context.stableRelease
            : undefined);
        if (!release) {
          await store.recordAudit({
            action: "restore_preview",
            environment,
            result: "rejected",
            releaseId,
            reason: "إصدار غير معروف",
          });
          res.status(404).json({ code: "RELEASE_NOT_FOUND", error: "إصدار غير معروف" });
          return;
        }
        const preview = await restorePreview(release, {
          devRoot: process.cwd(),
          worktree: context.git?.worktree ?? null,
          targetEnvironment: environment,
          liveRestoreApproved: environment === "LIVE" && productionEnabled(),
        });
        await store.recordAudit({
          action: "restore_preview",
          environment,
          result: preview.canRestore ? "ok" : "rejected",
          releaseId,
          reason: preview.canRestore
            ? "معاينة استعادة حقيقية معزولة"
            : preview.blockers.join(" "),
        });
        res.json({
          preview,
          restoreNotice: DEPLOY_RESTORE_REAL_NOTICE,
          state: await buildDeployState(store, context),
        });
      } catch (error) {
        if (!handleStoreFailure(res, error)) {
          res.status(500).json({
            code: "DEPLOY_RESTORE_PREVIEW_FAILED",
            error: "تعذّر بناء معاينة الاستعادة.",
          });
        }
      }
    },
  );

  // REAL hosting restore. Creates a new App Hosting rollout for the release's
  // IMMUTABLE full-SHA commit on the TARGET environment's backend (the active
  // console env — TEST is the isolated DEV backend; LIVE additionally requires
  // explicit approval), then proves the serving source from the control plane.
  // Never restores from a mutable local folder or a recorded id that is not a
  // full SHA. The current serving release is saved first. A single-flight lock
  // refuses a second concurrent restore.
  router.post("/api/admin/deploy/releases/:releaseId/restore", async (req, res) => {
    res.set("Cache-Control", "no-store, private");
    const releaseId = boundedString(req.params.releaseId, RELEASE_ID_MAX_LENGTH);
    if (!releaseId) {
      res.status(400).json({
        code: "INVALID_RELEASE_ID",
        error: "معرّف الإصدار غير صالح",
      });
      return;
    }
    if ((req.body ?? {}).confirm !== true) {
      res.status(400).json({
        code: "CONFIRMATION_REQUIRED",
        error: "الاستعادة تتطلب تأكيدًا صريحًا",
      });
      return;
    }
    if (restoreInFlight) {
      res.status(409).json({
        code: "RESTORE_IN_PROGRESS",
        error: "توجد استعادة قيد التنفيذ بالفعل.",
      });
      return;
    }

    restoreInFlight = true;
    const store = getStore();
    try {
      const environment = await store.getEnvironment();
      const context = await readGitContext();
      // Server-side eligibility gate (not found / unknown source / non-immutable
      // / incomplete / environment rule). The environment rule separates the
      // release's SOURCE env from the TARGET env: a LIVE-source release may be
      // restored into TEST, while a LIVE target needs explicit approval AND a
      // LIVE source. A rejection is audited, never success.
      const liveRestoreApproved = environment === "LIVE" && productionEnabled();
      let gate = await store.restoreRelease(releaseId, {
        targetEnvironment: environment,
        liveRestoreApproved,
      });
      // The stable release is config-backed, not in the registry: fall back to it
      // so the same eligibility rules apply.
      if (
        !gate.ok &&
        gate.code === "RELEASE_NOT_FOUND" &&
        context.stableRelease?.releaseId === releaseId
      ) {
        gate = evaluateRestore(context.stableRelease, {
          targetEnvironment: environment,
          liveRestoreApproved,
        });
      }
      if (!gate.ok) {
        await store.recordAudit({
          action: "restore_rejected",
          environment,
          result: "rejected",
          releaseId,
          reason: gate.reason,
        });
        const status = gate.code === "RELEASE_NOT_FOUND" ? 404 : 409;
        res.status(status).json({
          code: gate.code,
          error: gate.reason,
          state: await buildDeployState(store, context),
        });
        return;
      }

      const release = gate.release as DeployRelease;
      // Belt-and-suspenders: the source MUST be an immutable full SHA.
      if (!isFullGitSha(release.gitCommit)) {
        await store.recordAudit({
          action: "restore_rejected",
          environment,
          result: "rejected",
          releaseId,
          reason: "مصدر الاستعادة ليس SHA كاملًا.",
        });
        res.status(409).json({
          code: "RELEASE_SOURCE_NOT_IMMUTABLE",
          error: "الاستعادة تتطلب مصدرًا غير قابل للتغيير (SHA كامل).",
          state: await buildDeployState(store, context),
        });
        return;
      }

      // Save the CURRENT serving release before touching hosting.
      const current = (await store.listReleases()).find((item) => item.deployed === true);
      await store.recordAudit({
        action: "restore_snapshot",
        environment,
        result: "ok",
        releaseId,
        reason: current
          ? `الإصدار الحالي قبل الاستعادة: ${current.releaseId} (${current.gitCommit.slice(0, 7)})`
          : "لا يوجد إصدار منشور حالي مسجَّل قبل الاستعادة.",
      });

      // REAL hosting restore from the immutable commit.
      const restore = await executor.restore({
        gitCommit: release.gitCommit,
        approval: true,
        environment,
        sessionId: (req.sessionID ?? "") as string,
        adminId: (req.sessionID ?? "") as string,
      });

      if (restore.blocked === true) {
        await store.recordAudit({
          action: "restore_rejected",
          environment,
          result: "rejected",
          releaseId,
          reason: restore.detail,
        });
        res.status(409).json({
          code: "RESTORE_BLOCKED",
          error: restore.detail,
          stage: restore.stage ?? null,
          restoreNotice: DEPLOY_RESTORE_REAL_NOTICE,
          state: await buildDeployState(store, context),
        });
        return;
      }

      const sourceProven = restore.buildSource?.ok === true;
      const reachable = restore.verify ? restore.verify.ok === true : true;
      if (!restore.restored || !sourceProven || !reachable) {
        await store.recordAudit({
          action: "restore_rejected",
          environment,
          result: "rejected",
          releaseId,
          reason: restore.detail,
        });
        res.status(502).json({
          code: "RESTORE_FAILED",
          error: restore.detail,
          stage: restore.stage ?? null,
          restoreNotice: DEPLOY_RESTORE_REAL_NOTICE,
          state: await buildDeployState(store, context),
        });
        return;
      }

      await store.recordAudit({
        action: "restore_real",
        environment,
        result: "ok",
        releaseId,
        reason: restore.detail,
      });
      res.json({
        restored: release,
        restore: {
          status: "success" as const,
          real: true,
          verified: sourceProven && reachable,
          target: restore.target ?? null,
          releaseRef: restore.releaseRef ?? null,
          verify: restore.verify ?? null,
          buildSource: restore.buildSource ?? null,
          detail: restore.detail,
        },
        restoreNotice: DEPLOY_RESTORE_REAL_NOTICE,
        state: await buildDeployState(store, context),
      });
    } catch (error) {
      if (!handleStoreFailure(res, error)) {
        res.status(500).json({ code: "DEPLOY_RESTORE_FAILED", error: "تعذّرت الاستعادة." });
      }
    } finally {
      restoreInFlight = false;
    }
  });

  return router;
}

export default createAdminDeployRouter();
