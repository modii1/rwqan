/**
 * RWQAN DEPLOY — official stable baseline + hosting rollback capability.
 *
 * This is a DOCUMENTATION/config record (read-only, non-secret). It does NOT
 * perform a deploy or a rollback, and it does not connect to production.
 *
 * HONESTY RULE: the published revision of the public site cannot currently be
 * proven — there is no App Hosting / Cloud Run CLI here, the app exposes no
 * version/health endpoint (probed: 404), and no rollout metadata is reachable.
 * Therefore the published version id and SHA are recorded as `null` with
 * `confidence: "unknown"`, and `headMatchesBaseline` is left undetermined. The
 * local HEAD is NEVER assumed to be the published version.
 *
 * See `docs/STABLE_RELEASE_BASELINE_AR.md` for the evidence trail.
 */

import type {
  DeployChecks,
  DeployRollbackMechanism,
  DeployRollbackReadiness,
  DeployVerificationConfidence,
} from "../../shared/deploySystem";

/** Public site whose stable baseline is recorded. */
export const RWQAN_SITE = "rwqan.sa";

/** Hosting that serves the site, as evidenced by config + live HTTP headers. */
export const RWQAN_HOSTING_SOURCE =
  "Firebase App Hosting (Cloud Run) — backend rwqan-backend، مشروع rwqan-757، خلف Google Cloud CDN/LB";

/** Recorded baseline identity. Nulls mean "could not be proven", not "empty". */
export interface StableBaselineConfig {
  site: string;
  hostingSource: string;
  publishedVersionId: string | null;
  publishedSha: string | null;
  /** When the baseline identity was last verified (ISO), or null. */
  verifiedAt: string | null;
  healthChecks: DeployChecks;
  confidence: DeployVerificationConfidence;
  /** Optional release id adopted as the official baseline (none yet). */
  baselineReleaseId: string | null;
  notes: string;
}

const NOT_RUN_CHECKS: DeployChecks = {
  typescript: "NOT_RUN",
  tests: "NOT_RUN",
  build: "NOT_RUN",
  secretScan: "NOT_RUN",
  postDeployHealth: "NOT_RUN",
};

export const RWQAN_STABLE_BASELINE: StableBaselineConfig = {
  site: RWQAN_SITE,
  hostingSource: RWQAN_HOSTING_SOURCE,
  // Unproven: no CLI, no version endpoint, no reachable rollout metadata.
  publishedVersionId: null,
  publishedSha: null,
  verifiedAt: null,
  healthChecks: { ...NOT_RUN_CHECKS },
  confidence: "unknown",
  baselineReleaseId: null,
  notes:
    "الموقع https://rwqan.sa يعمل (HTTP 200، Next.js خلف Google CDN) لكن إصداره المنشور غير مُثبَت: " +
    "لا Firebase/gcloud CLI، ولا نقطة نهاية إصدار (‎/api/deploy-version‎ ⇒ 404)، ولا بيانات Rollout متاحة. " +
    "لذلك لا يُعتمد أي SHA منشور، ولا يُفترض أن HEAD المحلي هو الإصدار المنشور.",
};

/** Recorded hosting rollback capability. `confirmed` stays false until proven. */
export interface RollbackCapabilityConfig {
  mechanism: DeployRollbackMechanism;
  supported: boolean;
  confirmed: boolean;
  codeOnly: boolean | null;
  requirements: string[];
  postRollbackVerification: string[];
  risks: string[];
}

export const RWQAN_ROLLBACK_CAPABILITY: RollbackCapabilityConfig = {
  mechanism: "hosting_native_rollout",
  // Firebase App Hosting exposes past rollouts (and auto-rolls back a failed
  // rollout), so the capability is documented — but NOT proven from here.
  supported: true,
  confirmed: false,
  // Code rollback does NOT undo Firestore data / schema / storage migrations.
  codeOnly: false,
  requirements: [
    "تثبيت/مصادقة Firebase CLI (أو gcloud) على مشروع rwqan-757 للاطلاع على الـRollouts.",
    "حصر الـRollout السابق السليم ومعرّف إصداره/الـSHA الذي بُني منه.",
    "إثبات أن الـRollout السابق ما زال قابلًا لإعادة البث (roll out) ولم يُحذف."],
  postRollbackVerification: [
    "فحص HTTP أن الموقع يعمل (200) وأن النسخة المعروضة هي الإصدار السليم المتوقع.",
    "نقطة نهاية إصدار تقرأ commit وتطابقه مع الإصدار المستهدف.",
    "فحص الوظائف الحرجة يدويًا (الحجوزات/الدفع/الرسائل) للنسخة المُعاد بثها."],
  risks: [
    "الرجوع يعيد الكود فقط؛ لا يتراجع عن هجرات Firestore أو تغييرات البيانات أو الملفات في R2.",
    "قد تحتاج بعض الميزات المنشورة حديثًا توافقًا مع الخادم (mismatch بين العميل والواجهة).",
    "غياب نقطة نهاية إصدار يمنع التحقق الآلي بعد الرجوع."],
};

/** Derive the client-facing rollback readiness. Never ready without proof. */
export function buildRollbackReadiness(
  capability: RollbackCapabilityConfig = RWQAN_ROLLBACK_CAPABILITY,
): DeployRollbackReadiness {
  return {
    mechanism: capability.mechanism,
    supported: capability.supported,
    confirmed: capability.confirmed,
    readyToRollback: capability.supported && capability.confirmed,
    codeOnly: capability.codeOnly,
    requirements: [...capability.requirements],
    postRollbackVerification: [...capability.postRollbackVerification],
    risks: [...capability.risks],
    reason:
      capability.supported && capability.confirmed
        ? "مسار الرجوع مُثبَت ومتاح."
        : "الرجوع غير جاهز: القدرة موثّقة لكن لم تُثبَت هنا بعد (لا CLI/لا Rollout محصور).",
  };
}
