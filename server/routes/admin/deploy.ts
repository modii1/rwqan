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
  getDeploySystemStore,
  type DeploySystemStoreContract,
} from "../../services/DeploySystemStore";
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
} from "../../services/DeployExecutor";
import {
  buildRestorePreview as defaultBuildRestorePreview,
  runRestore as defaultRunRestore,
} from "../../services/DeployRestoreService";
import {
  DEPLOY_PUBLISH_NOTICE,
  DEPLOY_RESTORE_REAL_NOTICE,
  type DeployChecks,
  type DeployCheckRun,
  type DeployEnvironment,
  type DeployGitHubInfo,
  type DeployGitInfo,
  type DeployPostDeployVerification,
  type DeployRelease,
  type DeployRestorePreview,
  type DeployRestoreResult,
  type DeployWorktreeState,
} from "../../../shared/deploySystem";

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
   * Deploy/restore executor. Defaults to a safe SIMULATION (nothing is built,
   * committed, pushed, or deployed). A real App Hosting / CI-CD executor can be
   * injected once configured — it must require explicit approval and must never
   * auto-deploy on a plain push.
   */
  executor?: DeployExecutor;
  /** Test seam: override the real, isolated restore-runner (Phase D). */
  restoreRunner?: (
    release: DeployRelease,
    context: DeployRestoreContext,
  ) => Promise<DeployRestoreResult>;
  /** Test seam: override the read-only restore preview (Phase D). */
  restorePreview?: (
    release: DeployRelease,
    context: DeployRestoreContext,
  ) => Promise<DeployRestorePreview>;
}

/** DEV root + observed working-tree state used to scope a real restore. */
export interface DeployRestoreContext {
  devRoot: string;
  worktree: DeployWorktreeState | null;
}

function isDeployEnvironment(value: unknown): value is DeployEnvironment {
  return value === "TEST" || value === "LIVE";
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
  const restorePreview =
    options.restorePreview ??
    ((release, context) =>
      defaultBuildRestorePreview({
        release,
        devRoot: context.devRoot,
        worktree: context.worktree,
      }));
  const restoreRunner =
    options.restoreRunner ??
    ((release, context) =>
      defaultRunRestore({
        release,
        devRoot: context.devRoot,
        worktree: context.worktree,
      }));
  const getStore = (): DeploySystemStoreContract =>
    storeOverride ?? getDeploySystemStore();
  /** Single-flight guard: a second real restore is refused while one runs. */
  let restoreInFlight = false;

  /**
   * Read-only Git/GitHub context. Local Git is read always; the GitHub remote
   * SHA is read from a pre-existing local ref (never a token, fetch, or push),
   * with an optional read-only `ls-remote` only when explicitly enabled.
   */
  const readGitContext = async (): Promise<{
    git: DeployGitInfo | null;
    github: DeployGitHubInfo | null;
  }> => {
    const git = await readDeployGitInfo(process.cwd()).catch(() => null);
    if (!git) return { git: null, github: null };
    const github = await readDeployGitHubInfo({
      cwd: process.cwd(),
      localSha: git.commitSha,
      branch: git.branch,
      allowLsRemote: githubLsRemoteEnabled(),
    }).catch(() => null);
    return { git, github };
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
    const body = (req.body ?? {}) as Record<string, unknown>;
    const version =
      boundedString(body.version, VERSION_MAX_LENGTH) ??
      DEPLOY_SYSTEM_PROTOTYPE_VERSION;
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
      const environment = await store.getEnvironment();
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

      // Ask the executor to perform the (real or simulated) publish. The default
      // executor is a safe simulation: nothing is built, committed, pushed, or
      // deployed. A real executor only runs after the checks pass; it requires an
      // explicit approval, is scoped to the DEV target, and is reported as
      // deployed ONLY when the post-deploy probe confirms the running revision.
      let deployed = false;
      let savedToGit = false;
      let deployTarget: string | undefined;
      let deployRef: string | null = null;
      let postDeploy: DeployPostDeployVerification | null = null;
      let deployDetail = DEPLOY_PUBLISH_NOTICE;
      if (!failedChecks) {
        let outcome;
        try {
          outcome = await executor.publish({
            gitCommit: report.git?.commit ?? "",
            checks,
            approval,
            requestedTarget,
            worktree: context.git?.worktree ?? "unknown",
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
        if (!outcome.deployed && outcome.stage) {
          // A real executor reached a stage and failed (build/deploy/verify).
          await store.recordAudit({
            action: "publish_failed",
            environment,
            result: "rejected",
            reason: outcome.detail,
          });
          res.status(502).json({
            code: "DEPLOY_EXECUTOR_FAILED",
            error: outcome.detail,
            stage: outcome.stage,
            target: outcome.target ?? null,
          });
          return;
        }
        // Success is claimed only when the executor actually deployed AND, when a
        // probe ran, the running revision was verified.
        deployed = outcome.deployed === true && outcome.verify?.ok !== false;
        savedToGit = outcome.savedToGit;
        deployTarget = outcome.target ?? undefined;
        deployRef = outcome.releaseRef ?? null;
        postDeploy = outcome.verify ?? null;
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
      const auditAction = failed
        ? "publish_failed"
        : deployed
          ? "publish"
          : "publish_simulated";
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
    }
  });

  // Read-only restore PREVIEW. Reports whether a release CAN be restored into an
  // isolated DEV directory (valid full SHA, local commit, trustworthy source,
  // clean worktree, safe target) without executing anything.
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
        const release = await store.getRelease(releaseId);
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
        const context = await readGitContext();
        const preview = await restorePreview(release, {
          devRoot: process.cwd(),
          worktree: context.git?.worktree ?? null,
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

  // Real, ISOLATED restore. Re-materializes the release's full SHA tree into
  // `<devRoot>/.deploy-restore/<releaseId>/` (read-only git archive + verify) —
  // never a checkout/reset/commit/push/deploy, and never touching working files.
  // A single-flight lock refuses a second concurrent restore.
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
      // Server-side eligibility gate (not found / unknown source / incomplete /
      // LIVE). A rejection here is audited and never reported as success.
      const outcome = await store.restoreRelease(releaseId);
      if (!outcome.ok) {
        await store.recordAudit({
          action: "restore_rejected",
          environment,
          result: "rejected",
          releaseId,
          reason: outcome.reason,
        });
        const status = outcome.code === "RELEASE_NOT_FOUND" ? 404 : 409;
        res.status(status).json({
          code: outcome.code,
          error: outcome.reason,
          state: await buildDeployState(store, context),
        });
        return;
      }

      const release = outcome.release as DeployRelease;
      const restore = await restoreRunner(release, {
        devRoot: process.cwd(),
        worktree: context.git?.worktree ?? null,
      });

      if (restore.status !== "success") {
        await store.recordAudit({
          action: "restore_real",
          environment,
          result: "rejected",
          releaseId,
          reason: restore.error ?? restore.detail,
        });
        res.status(restore.status === "blocked" ? 409 : 502).json({
          code: restore.status === "blocked" ? "RESTORE_BLOCKED" : "RESTORE_FAILED",
          error: restore.error ?? restore.detail,
          restore,
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
        restore,
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
