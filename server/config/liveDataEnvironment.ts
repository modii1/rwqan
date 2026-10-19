/**
 * RWQAN LIVE DATA — configuration + gating (fail closed).
 *
 * The LIVE data preview may only read the real production data through a
 * DEDICATED read-only connection. This module derives that connection from a
 * small, explicit set of environment variables and refuses every ambiguous or
 * unsafe configuration. Nothing here uses the broad primary
 * `FIREBASE_SERVICE_ACCOUNT` and nothing here ever writes.
 *
 * Safety rules enforced by `readLiveDataConfig`:
 *   1. An explicit read-only acknowledgement must be present.
 *   2. A dedicated production project id must be provided, and it must NOT be
 *      the isolated DEV project.
 *   3. A dedicated read-only service account must be provided; its embedded
 *      project_id must match the configured production project id.
 *   4. The dedicated service account must be DISTINCT from the broad primary
 *      `FIREBASE_SERVICE_ACCOUNT` (reusing the broad account is refused).
 *
 * When any rule fails the result is `{ config: null, reason }` and the caller
 * must fail closed. Reasons only ever name the offending variable / rule and
 * never echo a key, token, or service-account body.
 */
import { DEV_FIREBASE_PROJECT_ID, getFirebaseProjectId } from "./runtimeEnvironment";

/** Explicit opt-in marker. Its exact value must be present or LIVE is refused. */
export const LIVE_DATA_ACK_KEY = "LIVE_DATA_READONLY_ACK";
export const LIVE_DATA_ACK_VALUE = "read-only";

export const LIVE_FIREBASE_PROJECT_ID_KEY = "LIVE_FIREBASE_PROJECT_ID";
export const LIVE_FIREBASE_SERVICE_ACCOUNT_KEY =
  "LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT";

export const LIVE_R2_ENDPOINT_KEY = "LIVE_R2_ENDPOINT";
export const LIVE_R2_ACCESS_KEY_ID_KEY = "LIVE_R2_ACCESS_KEY_ID";
export const LIVE_R2_SECRET_ACCESS_KEY_KEY = "LIVE_R2_SECRET_ACCESS_KEY";
export const LIVE_R2_BUCKET_NAME_KEY = "LIVE_R2_BUCKET_NAME";
export const LIVE_R2_PUBLIC_URL_KEY = "LIVE_R2_PUBLIC_URL";
export const LIVE_R2_REGION_KEY = "LIVE_R2_REGION";

/**
 * LIVE write policy. `read-only` is the DEFAULT and safest value: any write,
 * update, or delete attempted against production is rejected in-process. It must
 * be set to `enabled` explicitly to allow the DEV copy to mutate production.
 */
export const LIVE_WRITE_MODE_KEY = "LIVE_WRITE_MODE";
export const LIVE_WRITE_MODE_READONLY = "read-only";
export const LIVE_WRITE_MODE_ENABLED = "enabled";

export function liveWriteMode(
  environment: NodeJS.ProcessEnv = process.env,
): "read-only" | "enabled" {
  return environment[LIVE_WRITE_MODE_KEY]?.trim() === LIVE_WRITE_MODE_ENABLED
    ? "enabled"
    : LIVE_WRITE_MODE_READONLY;
}

export function liveWriteEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return liveWriteMode(environment) === LIVE_WRITE_MODE_ENABLED;
}

export interface LiveFirebaseConfig {
  projectId: string;
  serviceAccount: Record<string, unknown>;
}

export interface LiveR2Config {
  region: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
}

export interface LiveDataConfig {
  firebase: LiveFirebaseConfig;
  /** NULL when the (read-only) production image store is not configured. */
  r2: LiveR2Config | null;
}

export interface LiveDataConfigResult {
  config: LiveDataConfig | null;
  reason: string;
}

export function liveDataToolEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return environment.NODE_ENV === "development";
}

function normalizeHttpUrl(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === "/" || trimmed === "#") return "";
  if (!/^https?:\/\//i.test(trimmed)) return "";
  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
}

function readR2Config(environment: NodeJS.ProcessEnv): LiveR2Config | null {
  const missing = [
    LIVE_R2_ENDPOINT_KEY,
    LIVE_R2_ACCESS_KEY_ID_KEY,
    LIVE_R2_SECRET_ACCESS_KEY_KEY,
    LIVE_R2_BUCKET_NAME_KEY,
    LIVE_R2_PUBLIC_URL_KEY,
  ].filter((key) => !environment[key]?.trim());
  if (missing.length > 0) return null;

  const endpoint = normalizeHttpUrl(environment[LIVE_R2_ENDPOINT_KEY]);
  const publicUrl = normalizeHttpUrl(environment[LIVE_R2_PUBLIC_URL_KEY]);
  if (!endpoint || !publicUrl) return null;

  return {
    region: environment[LIVE_R2_REGION_KEY]?.trim() || "auto",
    endpoint,
    accessKeyId: environment[LIVE_R2_ACCESS_KEY_ID_KEY]!.trim(),
    secretAccessKey: environment[LIVE_R2_SECRET_ACCESS_KEY_KEY]!.trim(),
    bucketName: environment[LIVE_R2_BUCKET_NAME_KEY]!.trim(),
    publicUrl,
  };
}

export function readLiveDataConfig(
  environment: NodeJS.ProcessEnv = process.env,
): LiveDataConfigResult {
  if (environment[LIVE_DATA_ACK_KEY]?.trim() !== LIVE_DATA_ACK_VALUE) {
    return {
      config: null,
      reason: `متطلَّب: ${LIVE_DATA_ACK_KEY}="${LIVE_DATA_ACK_VALUE}" للتأكيد الصريح على أن الاتصال قراءة فقط.`,
    };
  }

  const projectId = environment[LIVE_FIREBASE_PROJECT_ID_KEY]?.trim();
  if (!projectId) {
    return { config: null, reason: `متطلَّب: ${LIVE_FIREBASE_PROJECT_ID_KEY} (معرّف مشروع الإنتاج).` };
  }
  if (projectId === DEV_FIREBASE_PROJECT_ID) {
    return {
      config: null,
      reason: `${LIVE_FIREBASE_PROJECT_ID_KEY} يطابق مشروع التطوير المعزول؛ يجب استخدام مشروع الإنتاج الحقيقي.`,
    };
  }

  const serviceAccountJson = environment[LIVE_FIREBASE_SERVICE_ACCOUNT_KEY]?.trim();
  if (!serviceAccountJson) {
    return {
      config: null,
      reason: `متطلَّب: ${LIVE_FIREBASE_SERVICE_ACCOUNT_KEY} (حساب خدمة مخصَّص بصلاحية قراءة فقط).`,
    };
  }

  const primaryRaw = environment.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (primaryRaw && projectId === getFirebaseProjectId(environment)) {
    return {
      config: null,
      reason: "معرّف مشروع الإنتاج يطابق مشروع الحساب الأساسي؛ يجب استخدام اتصال قراءة فقط منفصل.",
    };
  }

  let parsed: Record<string, unknown>;
  try {
    const parsedValue = JSON.parse(serviceAccountJson);
    if (!parsedValue || typeof parsedValue !== "object" || Array.isArray(parsedValue)) {
      throw new Error("not an object");
    }
    parsed = parsedValue as Record<string, unknown>;
  } catch {
    return {
      config: null,
      reason: `${LIVE_FIREBASE_SERVICE_ACCOUNT_KEY} ليس JSON صالحًا لكيان خدمة.`,
    };
  }

  const saProjectId = typeof parsed.project_id === "string" ? parsed.project_id : "";
  if (saProjectId !== projectId) {
    return {
      config: null,
      reason: `project_id داخل ${LIVE_FIREBASE_SERVICE_ACCOUNT_KEY} لا يطابق ${LIVE_FIREBASE_PROJECT_ID_KEY}.`,
    };
  }

  if (environment.FIREBASE_SERVICE_ACCOUNT?.trim() === environment[LIVE_FIREBASE_SERVICE_ACCOUNT_KEY]?.trim()) {
    return {
      config: null,
      reason: `يجب أن يكون ${LIVE_FIREBASE_SERVICE_ACCOUNT_KEY} حساب خدمة منفصلًا عن FIREBASE_SERVICE_ACCOUNT (قراءة فقط).`,
    };
  }

  const primaryProjectId = getFirebaseProjectId(environment);
  if (primaryProjectId !== null && primaryProjectId === projectId) {
    return {
      config: null,
      reason: `يجب أن يختلف ${LIVE_FIREBASE_PROJECT_ID_KEY} عن مشروع FIREBASE_SERVICE_ACCOUNT الأساسي.`,
    };
  }

  return {
    config: {
      firebase: { projectId, serviceAccount: parsed },
      r2: readR2Config(environment),
    },
    reason: "",
  };
}

export function liveDataConfigAvailable(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return readLiveDataConfig(environment).config !== null;
}

/**
 * Non-secret explanation used when LIVE is configured for Firestore but its
 * read-only production image store (R2) is missing. Names variables only — never
 * a key, token, or service-account body.
 */
export const LIVE_IMAGES_UNAVAILABLE_REASON = `متطلَّب: ${LIVE_R2_ENDPOINT_KEY}, ${LIVE_R2_ACCESS_KEY_ID_KEY}, ${LIVE_R2_SECRET_ACCESS_KEY_KEY}, ${LIVE_R2_BUCKET_NAME_KEY}, ${LIVE_R2_PUBLIC_URL_KEY} (مخزن صور الإنتاج، قراءة فقط).`;

/**
 * TRUE when a complete LIVE configuration exists AND its production image store
 * is configured. A Firestore-only LIVE configuration is intentionally rejected
 * so the DEV app never switches into a state whose images cannot load.
 */
export function liveImagesConfigAvailable(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return readLiveDataConfig(environment).config?.r2 != null;
}
