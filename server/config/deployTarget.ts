/**
 * RWQAN DEPLOY — Phase E deploy-target policy (DEV only).
 *
 * A real deploy is allowed ONLY to the isolated development target. This module
 * is the single source of truth for what "the DEV target" is and for every guard
 * that must reject anything else. It is pure (no process/network side effects) so
 * it can be unit-tested and reused by the executor and the route.
 *
 * Hard rules encoded here:
 *   - the ONLY deployable project is `rwqan-sa-dev` (never the production
 *     project `rwqan-757`, an unknown id, or an empty id);
 *   - a real deploy requires an explicit opt-in AND NODE_ENV=development;
 *   - a DEV base URL may never point at a production host.
 */

export interface DeployTarget {
  /** GCP/Firebase project id the deploy is scoped to. */
  projectId: string;
  /** App Hosting backend id inside that project. */
  backendId: string;
  /** Optional DEV app base URL used for post-deploy verification. */
  baseUrl: string | null;
  /** App Hosting region/location of the backend (e.g. `us-central1`). */
  location: string | null;
}

export const DEPLOY_DEV_PROJECT_ID = "rwqan-sa-dev";
export const DEPLOY_DEV_BACKEND_ID = "rwqan-dev-backend";

/** Projects that must NEVER be a deploy target from DEV. */
export const DEPLOY_PRODUCTION_PROJECT_IDS: readonly string[] = ["rwqan-757"];

/** Hosts that must NEVER be used as a DEV verification base URL. */
export const DEPLOY_PRODUCTION_HOSTS: readonly string[] = ["rwqan.sa", "www.rwqan.sa"];

export const DEPLOY_REAL_DEPLOY_ENV_KEY = "DEPLOY_REAL_DEPLOY";
export const DEPLOY_REAL_DEPLOY_ENABLED_VALUE = "enabled";
export const DEPLOY_DEV_BASE_URL_ENV_KEY = "DEPLOY_DEV_BASE_URL";
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

/** The fixed DEV deploy target (project/backend are constants, never client data). */
export function resolveDeployTarget(
  environment: NodeJS.ProcessEnv = process.env,
): DeployTarget {
  const rawBaseUrl = environment[DEPLOY_DEV_BASE_URL_ENV_KEY]?.trim() ?? "";
  const rawLocation =
    environment[DEPLOY_APP_HOSTING_LOCATION_ENV_KEY]?.trim() ?? "";
  return {
    projectId: DEPLOY_DEV_PROJECT_ID,
    backendId: DEPLOY_DEV_BACKEND_ID,
    baseUrl: rawBaseUrl || null,
    location: rawLocation || null,
  };
}

/**
 * Human-readable, non-secret reasons the given target must not be deployed to.
 * An empty list means the target is the isolated DEV target and is allowed.
 */
export function deployTargetBlockers(target: DeployTarget): string[] {
  const blockers: string[] = [];
  const projectId = target.projectId?.trim() ?? "";

  if (!projectId) {
    blockers.push("معرّف مشروع النشر غير محدد.");
  } else if (isProductionProjectId(projectId)) {
    blockers.push("المشروع المستهدف هو مشروع الإنتاج — يُرفض النشر من بيئة التطوير.");
  } else if (projectId !== DEPLOY_DEV_PROJECT_ID) {
    blockers.push("المشروع المستهدف غير معروف — يُسمح فقط بمشروع التطوير المعزول.");
  }

  if (!target.backendId?.trim()) {
    blockers.push("معرّف خدمة الاستضافة غير محدد.");
  }

  if (target.baseUrl && isProductionHost(target.baseUrl)) {
    blockers.push("رابط التحقق يشير إلى مضيف الإنتاج — يُرفض.");
  }

  return blockers;
}

/**
 * TRUE only when a real deploy is explicitly enabled for this process. Requires
 * BOTH NODE_ENV=development AND the explicit opt-in flag, so a real deploy can
 * never happen by accident (the default stays a safe simulation).
 */
export function realDeployEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    environment.NODE_ENV === "development" &&
    environment[DEPLOY_REAL_DEPLOY_ENV_KEY]?.trim() === DEPLOY_REAL_DEPLOY_ENABLED_VALUE
  );
}
