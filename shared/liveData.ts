/**
 * RWQAN — TEST/LIVE data-environment shared model (non-secret).
 *
 * The RWQAN DEPLOY bar flips the WHOLE DEV application between two real data
 * environments. It is not a cosmetic badge and not a separate preview page:
 *
 *   - TEST: every data source and service uses the isolated DEV resources
 *           (Firebase project `rwqan-sa-dev` and the DEV image store).
 *   - LIVE: the same pages, APIs and services run against the real production
 *           resources of rwqan.sa through a DEDICATED server-side connection.
 *
 * LIVE defaults to READ-ONLY so no production data can be mutated by accident;
 * writes are only allowed when the operator explicitly sets `LIVE_WRITE_MODE`.
 * Switching the environment never publishes code and never enables payments.
 *
 * Nothing here stores or transports secrets.
 */

/** Which data source the whole DEV application reads/writes. */
export type DataEnvironment = "TEST" | "LIVE";

/** LIVE write policy. */
export type LiveWriteMode = "read-only" | "enabled";

/** Human-readable labels for the active data sources (never secrets). */
export interface LiveDataSourceLabels {
  properties: string;
  subscriptions: string;
  images: string;
}

/** Server-derived status of the whole-application environment switch. */
export interface LiveDataStatus {
  /** TRUE only in an isolated development runtime (server-enforced). */
  enabled: boolean;
  /** Currently selected data environment (server-side state). */
  environment: DataEnvironment;
  /** TRUE when a safe production configuration is present. */
  liveAvailable: boolean;
  /** Human-readable reason when LIVE is unavailable (never contains secrets). */
  liveUnavailableReason: string;
  /** Production project id when configured (a project id is not a secret). */
  liveProjectId: string | null;
  /** ACTUAL project id of the currently-resolved data source (runtime proof). */
  activeProjectId: string | null;
  /** LIVE write policy (read-only by default). */
  writeMode: LiveWriteMode;
  /** TRUE when LIVE is active in read-only mode and writes are rejected. */
  writeBlocked: boolean;
  /** Labels for the active data sources. */
  dataSources: LiveDataSourceLabels;
  /** Explanation of the active environment. */
  environmentNotice: string;
}

export const DATA_ENVIRONMENT_NOTICE: Record<DataEnvironment, string> = {
  TEST: "بيئة الاختبار: جميع مصادر البيانات والخدمات تستخدم موارد التطوير المعزولة (rwqan-sa-dev). لا اتصال بالإنتاج.",
  LIVE: "بيئة الإنتاج (LIVE): التطبيق يعمل على بيانات وخدمات الإنتاج الحقيقية عبر اتصال خادمي مخصّص.",
};

export const LIVE_READONLY_NOTICE =
  "وضع الإنتاج للقراءة فقط: الطباعة والقراءة تعمل على بيانات الإنتاج الحقيقية، بينما الكتابة والتعديل والحذف محظورة لمنع أي عملية عرضية.";

export const LIVE_WRITE_NOTICE =
  "تنبيه: وضع الكتابة على الإنتاج مُفعَّل. أي إضافة أو تعديل أو حذف سيؤثر على بيانات العملاء الحقيقية.";

/** Response codes shared with the DEV client. */
export const LIVE_DATA_DISABLED_BODY = {
  code: "LIVE_DATA_DISABLED",
  error: "تبديل بيئة البيانات متاح في بيئة التطوير المعزولة فقط.",
} as const;

export const LIVE_DATA_UNAVAILABLE_BODY = {
  code: "LIVE_DATA_UNAVAILABLE",
  error:
    "تعذّر تأكيد اتصال آمن بالإنتاج — أُوقف تبديل بيئة البيانات (فشل مغلق).",
} as const;

export const LIVE_DATA_MAX_ITEMS = 200;
