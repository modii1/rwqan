import { isFullGitSha } from "../../shared/deploySystem";
import type { DeployGateItemState } from "../../shared/deploySystem";
import {
  DEPLOY_GATE_LABELS,
  type DeployGateItem,
  type DeployGateState,
  type DeployGateStatus,
  type DeployCheckRun,
  type DeployEnvironment,
  type DeployGitHubInfo,
  type DeployGitInfo,
  type DeployToolsInfo,
} from "../../shared/deploySystem";
import type { DeployTarget } from "../config/deployTarget";

/**
 * RWQAN DEPLOY — pre-deploy review gate (presentation of enforced rules).
 *
 * This classifier answers, in Arabic and WITHOUT secrets: "هل يمكن أن تُبدأ
 * مراجعة نشر حقيقي من هذه الحالة؟" — and produces one of exactly three
 * verdicts:
 *   - `ready_for_review`   : كل شروط التنفيذ مثبتة (لا يزال النشر يتطلب  موافقة صريحة).
 *   - `blocked_by_failed_check` : شرط سيعرف الرفض من المنفّذ/الراوت (فشل فحص، شجرة عمل متسخة،
 *     تفعيل مفقود...). النشر سيرفض حتى لو حاول المستخدم.
 *   - `unverified_missing_info` : معلومة أو صلاحية ناقصة — قد يكون النشر ممكنًا لاحقًا لكن
 *     لا يمكن تأكيد الجاهزية الآن.
 *
 * IMPORTANT: this is a STATUS DISPLAY, NOT an enforcement point. It classifies
 * the same conditions the executor (DeployRealExecutor) and the route already
 * enforce; it never grants permission, never bypasses a guard, and the real
 * publish always runs through the executor's own fail-closed checks. The two
 * never drift because every blocked/unverified decision here mirrors a
 * specific executor precondition named in the reason string.
 *
 * Pure: no environment access, no network, no filesystem, no child process.
 */

export interface DeployGateInput {
  environment: DeployEnvironment;
  git: DeployGitInfo | null;
  github: DeployGitHubInfo | null;
  latestCheckRun: DeployCheckRun | null;
  /** TRUE only when NODE_ENV=development AND DEPLOY_REAL_DEPLOY=enabled. */
  realDeployEnabled: boolean;
  /** TRUE only when real deploys may target production (second opt-in). */
  productionDeployEnabled: boolean;
  /** Resolved control-plane source verification config (fail-closed shape). */
  verifySourceConfig: { enabled: boolean; reason?: string } | null;
  /** The fixed target for the active environment (never client data). */
  target: DeployTarget;
  /** Non-empty when the target policy itself refuses this deploy. */
  targetBlockers: string[];
  /** The DEV runtime's current data source (TEST = isolated DEV resources). */
  dataEnvironment: DeployEnvironment;
  /** Availability of the deploy tools (null = the probe could not be adjudged). */
  tools: DeployToolsInfo | null;
}

function item(
  key: string,
  label: string,
  state: DeployGateItemState,
  reason?: string,
): DeployGateItem {
  return {
    key,
    label,
    state,
    ...(reason ? { reason } : {}),
    ...(reason ? { testId: `gate-item-${key}` } : {}),
  };
}

export function evaluatePreDeployGate(
  input: DeployGateInput,
): DeployGateState {
  const items: DeployGateItem[] = [];

  // 1) Permissions: the state endpoint itself only answers an authenticated
  //    admin on a same-origin request (route-level guards). Reaching this
  //    classifier at all IS the proof.
  items.push(
    item(
      "admin_permissions",
      "صلاحية المستخدم ونفس المصدر",
      "ok",
      "تُفرض على الخادم لكل نقطة نشر (جلسة مسؤول + أصل نفسه) — التوصُّل إلى هذه الحالة يثبهما.",
    ),
  );

  // 2) Git worktree state (the executor refuses a publish from a dirty/unknown tree).
  const git = input.git;
  if (!git) {
    items.push(
      item(
        "git_worktree",
        "حالة شجرة العمل (Git)",
        "unverified",
        "تعذّرت قراءة مستودع Git المحلي — لا يمكن تأكيد مصدر البناء.",
      ),
    );
  } else if (git.available === false) {
    items.push(
      item("git_worktree", "حالة شجرة العمل (Git)", "unverified", git.reason ?? "Git غير متاح."),
    );
  } else if (git.worktree === "clean") {
    items.push(item("git_worktree", "حالة شجرة العمل (Git)", "ok"));
  } else if (git.worktree === "dirty") {
    items.push(
      item(
        "git_worktree",
        "حالة شجرة العمل (Git)",
        "blocked",
        "شجرة العمل تحتوي تغييرات غير مُثبّتة — النشر الحقيقي يُرفض.",
      ),
    );
  } else {
    items.push(
      item(
        "git_worktree",
        "حالة شجرة العمل (Git)",
        "unverified",
        "حالة شجرة العمل غير معروفة — يجب تأكيد نظافتها قبل أي نشر حقيقي.",
      ),
    );
  }

  // 3) The target commit must be an immutable full SHA (executor precondition).
  const commit = git?.commitSha ?? null;
  if (commit === null) {
    items.push(
      item(
        "commit_sha",
        "صلاحية commit المستهدف",
        "unverified",
        "لا يوجد commit معروف — لا يمكن تحديد ما سيُبنى.",
      ),
    );
  } else if (isFullGitSha(commit)) {
    items.push(item("commit_sha", "صلاحية commit المستهدف", "ok"));
  } else {
    items.push(
      item(
        "commit_sha",
        "صلاحية commit المستهدف",
        "blocked",
        "المرجع ليس SHA كاملًا (40 خانة سداسية) — يُرفض النشر الحقيقي.",
      ),
    );
  }

  // 4) Pre-publish checks (mirrors the route's `failedChecks` exactly).
  const run = input.latestCheckRun;
  const secretScan = run?.checks.secretScan ?? "NOT_RUN";
  const typescript = run?.checks.typescript ?? "NOT_RUN";
  if (run === null) {
    items.push(
      item(
        "release_checks",
        "فحوصات ما قبل النشر",
        "unverified",
        "لم تُشغَّل فحوصات الإصدار بعد (زر: فحص ما قبل النشر).",
      ),
    );
  } else if (secretScan === "FAIL") {
    items.push(
      item(
        "release_checks",
        "فحوصات ما قبل النشر",
        "blocked",
        "فشل فحص الأسرار — النشر ممنوع فورًا ولا يُتجاوز فحص فاشل.",
      ),
    );
  } else if (secretScan === "BLOCKED") {
    items.push(
      item(
        "release_checks",
        "فحوصات ما قبل النشر",
        "blocked",
        "فحص الأسرار تعذّر تشغيله (فشل مغلق) — النشر ممنوع حتى يعمل.",
      ),
    );
  } else if (typescript === "FAIL") {
    items.push(
      item(
        "release_checks",
        "فحوصات ما قبل النشر",
        "blocked",
        "فشل فحص TypeScript — النشر ممنوع كما يفرض الخادم.",
      ),
    );
  } else {
    const pending: string[] = [];
    if (typescript === "BLOCKED" || typescript === "NOT_RUN") {
      pending.push("TypeScript");
    }
    items.push(
      item(
        "release_checks",
        "فحوصات ما قبل النشر",
        pending.length > 0 ? "unverified" : "ok",
        pending.length
          ? `فحص ${pending.join(" و")} غير نهائي حتى الآن (في طلب HTTP لا يُشغَّل بناء اختباري بطيء).`
          : "فحص الأسرار ناجح وفحص TypeScript ناجح.",
      ),
    );
  }

  // 5) Target policy (same pure predicate the executor passes to its preflight).
  if (input.targetBlockers.length === 0) {
    items.push(
      item(
        "target_config",
        "مطابقة هدف البيئة (المشروع/الخدمة)",
        "ok",
      ),
    );
  } else {
    items.push(
      item(
        "target_config",
        "مطابقة هدف البيئة (المشروع/الخدمة)",
        "blocked",
        input.targetBlockers.join(" "),
      ),
    );
  }

  // 6) Real-deploy master opt-in (executor precondition).
  items.push(
    item(
      "real_deploy_opt_in",
      "تفعيل مسار النشر الحقيقي (DEPLOY_REAL_DEPLOY)",
      input.realDeployEnabled ? "ok" : "blocked",
      input.realDeployEnabled
        ? "مفعّل — يظل النشر مشروطًا بموافقة إدارية صريحة."
        : "مسار النشر الحقيقي مغلق — أي طلب نشر يستقبل رفضًا فشلًا مغلقًا.",
    ),
  );

  // 7) Production opt-in (only the SECOND gate for a LIVE target).
  if (input.environment === "TEST" || input.environment === "LOCAL") {
    items.push(
      item(
        "production_opt_in",
        "تفعيل النشر إلى الإنتاج (DEPLOY_ALLOW_PRODUCTION)",
        "ok",
        "غير مطلوب في بيئة الاختبار أو المحلية — الهدف الثابت معزول عن الإنتاج.",
      ),
    );
  } else if (input.productionDeployEnabled) {
    items.push(
      item(
        "production_opt_in",
        "تفعيل النشر إلى الإنتاج (DEPLOY_ALLOW_PRODUCTION)",
        "ok",
        "مفعّل — تحذير: الهدف الحالي هو الإنتاج.",
      ),
    );
  } else {
    items.push(
      item(
        "production_opt_in",
        "تفعيل النشر إلى الإنتاج (DEPLOY_ALLOW_PRODUCTION)",
        "blocked",
        "مطلوب تفعيل إنتاجي صريح مستقل قبل السماح بأي rollout إلى الإنتاج.",
      ),
    );
  }

  // 8) App Hosting region — mandatory for a controlled rollout (executor precondition).
  if (input.target.location?.trim()) {
    items.push(
      item(
        "apphosting_location",
        "منطقة App Hosting (DEPLOY_APP_HOSTING_LOCATION)",
        "ok",
        `المنطقة مضبوطة (${input.target.location}).`,
      ),
    );
  } else {
    items.push(
      item(
        "apphosting_location",
        "منطقة App Hosting (DEPLOY_APP_HOSTING_LOCATION)",
        "unverified",
        "غير مضبوطة — أمر rollout يُرفض الآن حتى تُضبط منطقة الـbackend الفعلية.",
      ),
    );
  }

  // 9) Verification URL (mandatory for the successful success path).
  if (input.target.baseUrl?.trim()) {
    items.push(item("verify_url", "رابط التحقق بعد النشر", "ok"));
  } else {
    items.push(
      item(
        "verify_url",
        "رابط التحقق بعد النشر",
        "unverified",
        "لم يُضبط (DEPLOY_DEV_BASE_URL) — لا يمكن تأكيد جاهزية ما بعد النشر.",
      ),
    );
  }

  // 10) Mandatory build-source proof config (executor precondition).
  if (input.verifySourceConfig?.enabled) {
    items.push(item("build_source_verify", "إثبات هوية مصدر البناء (App Hosting)", "ok"));
  } else {
    items.push(
      item(
        "build_source_verify",
        "إثبات هوية مصدر البناء (App Hosting)",
        "unverified",
        input.verifySourceConfig?.reason
          ?? "غير مُفعّل (DEPLOY_BUILD_SOURCE_VERIFY) — النشر الحقيقي لن يُسجَّل بنجاح دون إثبات مصدر.",
      ),
    );
  }

  // 11) Deploy tools availability (a real, local CLI probe).
  if (input.tools === null) {
    items.push(
      item(
        "firebase_cli",
        "توفر أدوات النشر (firebase CLI)",
        "unverified",
        "لم يُحسم توفرها في هذه اللقطة — أعد تحميل الحالة.",
      ),
    );
  } else if (input.tools.firebaseCliAvailable) {
    items.push(
      item(
        "firebase_cli",
        "توفر أدوات النشر (firebase CLI)",
        "ok",
        input.tools.firebaseCliVersion
          ? `متاح (الإصدار ${input.tools.firebaseCliVersion}).`
          : "متاح.",
      ),
    );
  } else {
    items.push(
      item(
        "firebase_cli",
        "توفر أدوات النشر (firebase CLI)",
        "blocked",
        "الـCLI غير قابل للتشغيل — لا يمكن أي rollout حقيقي على هذا الجهاز.",
      ),
    );
  }

  // 12) Data isolation honesty check (NOT a claim — it reports what IS provable).
  if (input.environment === "TEST" && input.dataEnvironment === "TEST") {
    items.push(
      item(
        "data_isolation",
        "عزل قاعدة البيانات",
        "ok",
        "موارد DEV المعزولة نشطة (فحص الإقلاع على الخادم يفرض مشروع التطوير rwqan-sa-dev).",
      ),
    );
  } else if (input.environment === "LOCAL" && input.dataEnvironment === "LOCAL") {
    items.push(
      item(
        "data_isolation",
        "عزل قاعدة البيانات",
        "ok",
        "الموارد المحلية نشطة — لا اتصال بالإنتاج أو بالتطوير المعزول.",
      ),
    );
  } else if (input.environment === "TEST" && input.dataEnvironment === "LIVE") {
    items.push(
      item(
        "data_isolation",
        "عزل قاعدة البيانات",
        "unverified",
        "معاينة بيانات الإنتاج نشطة (قراءة فقط) — لا تمنع النشر لكن التقييم أنظف بعد التبديل إلى TEST.",
      ),
    );
  } else {
    items.push(
      item(
        "data_isolation",
        "عزل قاعدة البيانات",
        "unverified",
        "النشر الحي: عزل البيانات لا يُثبت تلقائيًا هنا — يبقى النشر إلى الإنتاج مشروطًا بموافقة صريحة.",
      ),
    );
  }

  // GitHub mismatch is informational only (a stale HEAD) — it stays OUT of the
  // verdict because the executor does not precondition on it; the UI shows the
  // github badge straight from DeployState.github. The control plane proves what
  // actually serves after any rollout.
  const hasBlocked = items.some((entry) => entry.state === "blocked");
  const hasUnverified = items.some((entry) => entry.state === "unverified");
  const status: DeployGateStatus = hasBlocked
    ? "blocked_by_failed_check"
    : hasUnverified
      ? "unverified_missing_info"
      : "ready_for_review";

  return { status, items };
}

export const DEPLOY_GATE_STATUS_LABELS = DEPLOY_GATE_LABELS;
