/**
 * RWQAN DEPLOY — deploy-target policy.
 *
 * This module is the single source of truth for WHICH hosting backend a real
 * publish/restore acts on, and for every guard that must reject anything else.
 * It is pure (no process/network side effects) so it can be unit-tested and
 * reused by the executor, the health probe, and the route.
 *
 * Targets are resolved from the active deploy environment:
 *   - TEST → the approved test backend `rwqan-757` / `rwqan-backend` serving
 *     `https://rwqan-backend--rwqan-757.europe-west4.hosted.app/` (the safe default;
 *     a production host/project is refused);
 *   - LIVE → the production backend `rwqan-757` / `rwqan` serving
 *     `https://rwqan.sa`, and ONLY when production deploys are explicitly
 *     enabled (NODE_ENV=development + DEPLOY_REAL_DEPLOY=enabled +
 *     DEPLOY_ALLOW_PRODUCTION=enabled). Without that final opt-in the LIVE
 *     target is refused exactly as before.
 */

export interface DeployTarget {
  /** GCP/Firebase project id the deploy is scoped to. */
  projectId: string;
  /** App Hosting backend id inside that project. */
  backendId: string;
  /** App base URL used for post-deploy verification. */
  baseUrl: string | null;
  /** App Hosting region/location of the backend (e.g. `us-central1`). */
  location: string | null;
}

/** The active deploy environment selects the target. */
export type DeployTargetEnvironment = "TEST" | "LIVE" | "LOCAL";

/** The approved TEST backend serving the test App Hosting URL. */
export const DEPLOY_DEV_PROJECT_ID = "rwqan-757";
export const DEPLOY_DEV_BACKEND_ID = "rwqan-backend";
export const DEPLOY_DEV_BASE_URL = "https://rwqan-backend--rwqan-757.europe-west4.hosted.app";

/** The real production project/backend serving https://rwqan.sa. */
export const DEPLOY_PROD_PROJECT_ID = "rwqan-757";
export const DEPLOY_PROD_BACKEND_ID = "rwqan";
export const DEPLOY_PROD_BASE_URL = "https://rwqan.sa";

/** The LOCAL deploy target used only for local development builds. */
export const DEPLOY_LOCAL_PROJECT_ID = "rwqan-local";
export const DEPLOY_LOCAL_BACKEND_ID = "rwqan-local-backend";

/** Projects recognised as the production project. */
export const DEPLOY_PRODUCTION_PROJECT_IDS: readonly string[] = [DEPLOY_PROD_PROJECT_ID];

/** Hosts recognised as production hosts. */
export const DEPLOY_PRODUCTION_HOSTS: readonly string[] = ["rwqan.sa", "www.rwqan.sa"];

export const DEPLOY_REAL_DEPLOY_ENV_KEY = "DEPLOY_REAL_DEPLOY";
export const DEPLOY_REAL_DEPLOY_ENABLED_VALUE = "enabled";
export const DEPLOY_DEV_BASE_URL_ENV_KEY = "DEPLOY_DEV_BASE_URL";
export const DEPLOY_PROD_BASE_URL_ENV_KEY = "DEPLOY_PROD_BASE_URL";
/**
 * Second, independent opt-in required before a real deploy may target
 * production. Kept separate from DEPLOY_REAL_DEPLOY so enabling real deploys for
 * the DEV backend never implicitly grants production deploy rights.
 */
export const DEPLOY_ALLOW_PRODUCTION_ENV_KEY = "DEPLOY_ALLOW_PRODUCTION";
export const DEPLOY_ALLOW_PRODUCTION_ENABLED_VALUE = "enabled";
/**
 * App Hosting region of the DEV backend. Required for a controlled rollout
 * (`apphosting:rollouts:create --location`) and for the read-only control-plane
 * verification. Kept here as the single source of truth for that key.
 */
export const DEPLOY_APP_HOSTING_LOCATION_ENV_KEY = "DEPLOY_APP_HOSTING_LOCATION";

/**
 * Firebase config file listing ONLY the DEV App Hosting backend. The CLI MUST be
 * pointed at it (`--config`) or it would read the production `firebase.json` and
 * deploy to the production backend. Kept as a constant so the CLI never derives
 * its target from ambient config.
 */
export const DEPLOY_DEV_FIREBASE_CONFIG = "firebase.dev.json";

/**
 * Firebase config file for the PRODUCTION App Hosting backend. Used only for a
 * LIVE target; the production project is configured in the repository's
 * `firebase.json`/`.firebaserc` (project `rwqan-757`, backend `rwqan-backend`).
 */
export const DEPLOY_PROD_FIREBASE_CONFIG = "firebase.json";

export function isProductionProjectId(projectId: string): boolean {
  return DEPLOY_PRODUCTION_PROJECT_IDS.includes(projectId.trim());
}

export function isProductionHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return DEPLOY_PRODUCTION_HOSTS.some(
      (known) => host === known || host.endsWith(`.${known}`),
    );
  } catch {
    return false;
  }
}

/**
 * The fixed deploy target for the given environment (project/backend are
 * constants, never client-supplied data). The environment defaults to TEST so
 * existing callers keep the isolated DEV target.
 */
export function resolveDeployTarget(
  environment: DeployTargetEnvironment = "TEST",
  processEnvironment: NodeJS.ProcessEnv = process.env,
): DeployTarget {
  const location =
    processEnvironment[DEPLOY_APP_HOSTING_LOCATION_ENV_KEY]?.trim() ?? "europe-west4";
  if (environment === "LIVE") {
    const rawBaseUrl =
      processEnvironment[DEPLOY_PROD_BASE_URL_ENV_KEY]?.trim() || DEPLOY_PROD_BASE_URL;
    return {
      projectId: DEPLOY_PROD_PROJECT_ID,
      backendId: DEPLOY_PROD_BACKEND_ID,
      baseUrl: rawBaseUrl || null,
      location: location || null,
    };
  }
  if (environment === "LOCAL") {
    const rawBaseUrl = processEnvironment[DEPLOY_DEV_BASE_URL_ENV_KEY]?.trim() ?? "";
    return {
      projectId: DEPLOY_LOCAL_PROJECT_ID,
      backendId: DEPLOY_LOCAL_BACKEND_ID,
      baseUrl: rawBaseUrl || null,
      location: location || null,
    };
  }
  // TEST → fixed approved backend. baseUrl is explicit and never derived from
  // Firebase CLI default or firebase.json.
  return {
    projectId: DEPLOY_DEV_PROJECT_ID,
    backendId: DEPLOY_DEV_BACKEND_ID,
    baseUrl: DEPLOY_DEV_BASE_URL,
    location: location || null,
  };
}

/**
 * The EXPECTED App Hosting host for a target, derived from the external
 * naming convention `backendId--projectId.location.hosted.app`. This is a
 * prediction, NOT a proof: the real domain must be confirmed against the App
 * Hosting control plane. (Externally reading the control plane on 2026-10-26
 * confirmed exactly this shape for production:
 * `rwqan-backend--rwqan-757.europe-west4.hosted.app`.)
 *
 * Fail closed: with no location, or with any malformed component, no host is
 * invented — null is returned and the caller must present "غير متحقق".
 */
export function resolveAppHostingHost(target: DeployTarget): string | null {
  const projectId = target.projectId?.trim() ?? "";
  const backendId = target.backendId?.trim() ?? "";
  const location = target.location?.trim() ?? "";
  if (!projectId || !backendId || !location) return null;
  const componentIsSafe = /^[a-z0-9][a-z0-9-]+$/i.test(projectId)
    && /^[a-z0-9][a-z0-9-]+$/i.test(backendId)
    && /^[a-z0-9][a-z0-9-]+$/i.test(location);
  if (!componentIsSafe) return null;
  return `https://${backendId}--${projectId}.${location}.hosted.app`;
}

/**
 * Human-readable, non-secret reasons the given target must not be deployed to
 * for the given environment. An empty list means the target matches that
 * environment's fixed target and is allowed.
 */
export function deployTargetBlockers(
  target: DeployTarget,
  environment: DeployTargetEnvironment = "TEST",
): string[] {
  const blockers: string[] = [];
  const projectId = target.projectId?.trim() ?? "";
  const backendId = target.backendId?.trim() ?? "";
  const baseUrl = target.baseUrl?.trim() ?? "";

  if (!projectId) {
    blockers.push("معرّف مشروع النشر غير محدد.");
  }
  if (!backendId) {
    blockers.push("معرّف خدمة الاستضافة غير محدد.");
  }
  if (!baseUrl) {
    blockers.push("رابط التحقق بعد النشر غير محدد.");
  }

  if (environment === "LIVE") {
    if (projectId !== DEPLOY_PROD_PROJECT_ID) {
      blockers.push(
        "بيئة الإنتاج تتطلب مشروع الإنتاج الرسمي rwqan-757 — يُرفض أي مشروع آخر.",
      );
    }
    if (backendId !== DEPLOY_PROD_BACKEND_ID) {
      blockers.push(
        "بيئة الإنتاج تتطلب خدمة الاستضافة rwqan — يُرفض أي خدمة أخرى.",
      );
    }
    if (baseUrl !== DEPLOY_PROD_BASE_URL) {
      blockers.push(
        "رابط التحقق في بيئة الإنتاج يجب أن يكون https://rwqan.sa — يُرفض أي رابط آخر.",
      );
    }
  } else if (environment === "TEST") {
    if (projectId !== DEPLOY_DEV_PROJECT_ID) {
      blockers.push(
        "بيئة الاختبار تتطلب مشروع rwqan-757 — يُرفض أي مشروع آخر.",
      );
    }
    if (backendId !== DEPLOY_DEV_BACKEND_ID) {
      blockers.push(
        "بيئة الاختبار تتطلب خدمة الاستضافة rwqan-backend — يُرفض أي خدمة أخرى.",
      );
    }
    if (baseUrl !== DEPLOY_DEV_BASE_URL) {
      blockers.push(
        "رابط التحقق في بيئة الاختبار يجب أن يكون https://rwqan-backend--rwqan-757.europe-west4.hosted.app/ — يُرفض أي رابط آخر.",
      );
    }
    if (backendId === DEPLOY_PROD_BACKEND_ID) {
      blockers.push(
        "بيئة الاختبار لا تُستهدف لخدمة الإنتاج rwqan — يُرفض.",
      );
    }
    if (baseUrl === DEPLOY_PROD_BASE_URL) {
      blockers.push(
        "بيئة الاختبار لا تُستهدف لرابط الإنتاج https://rwqan.sa — يُرفض.",
      );
    }
  } else if (environment === "LOCAL") {
    if (projectId !== DEPLOY_LOCAL_PROJECT_ID) {
      blockers.push("المشروع المستهدف غير معروف — يُسمح فقط بمشروع التطوير المحلي.");
    }
    if (backendId !== DEPLOY_LOCAL_BACKEND_ID) {
      blockers.push("الخدمة المستهدفة غير معروفة — يُسمح فقط بخدمة التطوير المحلي.");
    }
  }

  return blockers;
}

/**
 * TRUE only when a real deploy is explicitly enabled for this process. Requires
 * BOTH NODE_ENV=development AND the explicit opt-in flag, so a real deploy can
 * never happen by accident.
 */
export function realDeployEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    environment.NODE_ENV === "development" &&
    environment[DEPLOY_REAL_DEPLOY_ENV_KEY]?.trim() === DEPLOY_REAL_DEPLOY_ENABLED_VALUE
  );
}

/**
 * TRUE only when a real deploy may target PRODUCTION. Requires the base real
 * deploy opt-in AND a SECOND, independent production opt-in, so enabling real
 * DEV deploys never implicitly grants production deploy rights.
 */
export function productionDeployEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    realDeployEnabled(environment) &&
    environment[DEPLOY_ALLOW_PRODUCTION_ENV_KEY]?.trim() ===
      DEPLOY_ALLOW_PRODUCTION_ENABLED_VALUE
  );
}
