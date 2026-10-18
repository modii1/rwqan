/**
 * RWQAN DEPLOY — environment gate.
 *
 * The deploy console is a development-only tool. It must fail closed everywhere
 * else: production, CI, staging, or any runtime whose NODE_ENV is not exactly
 * "development". The server (not the browser) enforces this, so a hidden UI
 * control can never expose the endpoints.
 */
import {
  DEV_FIREBASE_PROJECT_ID,
  getFirebaseProjectId,
} from "./runtimeEnvironment";

export function deploySystemEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.NODE_ENV === "development";
}

/**
 * The durable release registry may only be written when we can positively prove
 * the active Firebase project is the isolated DEV project `rwqan-sa-dev`. When
 * the project cannot be proven (missing/unparseable service account, or any
 * other project id), persistence fails closed: callers must not write anywhere.
 */
export function deployPersistenceProjectConfirmed(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return getFirebaseProjectId(environment) === DEV_FIREBASE_PROJECT_ID;
}

export const DEPLOY_STORE_UNAVAILABLE_BODY = {
  code: "DEPLOY_STORE_UNAVAILABLE",
  error:
    "تعذّر تأكيد مشروع Firebase DEV (rwqan-sa-dev) — أوقِفت عملية سجل الإصدارات (فشل مغلق).",
} as const;

export const DEPLOY_SYSTEM_DISABLED_BODY = {
  code: "DEPLOY_SYSTEM_DISABLED",
  error: "نظام النشر متاح في بيئة التطوير المعزولة فقط.",
} as const;
