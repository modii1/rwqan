"use client";
/**
 * Global development-only deploy bar (Phase B, extended).
 *
 * Rendered once by the app shell (layout-content.tsx) so it appears on every
 * page: home, properties, blog, account, admin, etc. It is visible ONLY when
 * BOTH are true:
 *   - the client build is a development build (NODE_ENV === "development"), and
 *   - the server confirms the current user is an authorized admin by returning
 *     200 from the admin-guarded /api/admin/deploy/state endpoint.
 *
 * In a production build no request is even made and nothing renders, so
 * production behaviour is unchanged. Hiding the bar is NOT the security
 * boundary: every operation stays guarded on the server (requireSameOrigin +
 * requireAdmin + DEV gate).
 *
 * UI surface is intentionally just three options: نشر (publish), تحويل البيئة
 * (TEST/LIVE data-environment switch), and استعادة (isolated restore).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldCheck,
  UploadCloud,
  RotateCcw,
  Loader2,
  X,
} from "lucide-react";
import {
  DEPLOY_GATE_ITEM_STATE_LABELS,
  DEPLOY_GATE_LABELS,
  DEPLOY_STATE_DESCRIPTORS,
  isFullGitSha,
  type DeployCheckResult,
  type DeployCheckRun,
  type DeployGateItem,
  type DeployGateItemState,
  type DeployGateStatus,
  type DeployRelease,
  type DeployReleaseStatus,
  type DeployRestorePreview,
  type DeployState,
} from "@shared/deploySystem";
import type { DataEnvironment, LiveDataStatus } from "@shared/liveData";

/** Server envelope of a real hosting restore (route `restore` response). */
interface DeployRestoreSummary {
  status: "success";
  real: boolean;
  verified: boolean;
  target: string | null;
  releaseRef: string | null;
  detail: string;
}

export const DEPLOY_BAR_HEIGHT_PX = 40;

const STATUS_LABEL: Record<DeployReleaseStatus, string> =
  DEPLOY_STATE_DESCRIPTORS.reduce(
    (acc, entry) => {
      acc[entry.status] = entry.label;
      return acc;
    },
    {} as Record<DeployReleaseStatus, string>,
  );

const NON_RESTORABLE: DeployReleaseStatus[] = ["validation_failed", "failed"];

// The list only ever contains real stable releases, so the remaining guard is
// the immutable source: a real restore is impossible without a full SHA.
function isRestorable(release: DeployRelease): boolean {
  return isFullGitSha(release.gitCommit) && !NON_RESTORABLE.includes(release.status);
}

/** Visual meta for the gate item states (server labels remain the truth). */
const GATE_ITEM_STATE_META: Record<
  DeployGateItemState,
  { symbol: string; className: string; badgeVariant: "default" | "destructive" | "outline" }
> = {
  ok: { symbol: "✓", className: "text-green-700", badgeVariant: "default" },
  blocked: { symbol: "✕", className: "text-red-700", badgeVariant: "destructive" },
  unverified: { symbol: "؟", className: "text-amber-700", badgeVariant: "outline" },
};

/** Tailwind classes for the three (and only three) gate verdicts. */
const GATE_STATUS_CLASS: Record<DeployGateStatus, string> = {
  ready_for_review: "bg-green-700 text-white border-green-700",
  blocked_by_failed_check: "bg-red-700 text-white border-red-700",
  unverified_missing_info: "bg-amber-100 text-amber-900 border-amber-400",
};

const CHECK_RESULT_LABEL: Record<DeployCheckResult, string> = {
  PASS: "ناجح",
  FAIL: "فاشل",
  BLOCKED: "حاجِب",
  NOT_RUN: "لم يُشغَّل",
};

const WORKTREE_LABEL: Record<string, string> = {
  clean: "نظيفة",
  dirty: "تحتوي تعديلات",
  unknown: "غير معروفة",
};

const GITHUB_MATCH_LABEL: Record<string, string> = {
  match: "مطابق",
  mismatch: "غير مطابق (HEAD أقدم)",
  unavailable: "غير متاح",
};

const UNVERIFIED = "غير متحقق";

/**
 * يستخرج رسالة خطأ بالعربية من خطأ خطأ apiRequest.
 * apiRequest يرمي خطأً على الشكل "<status>: <body>"؛ إذا كان الجسم JSONًا
 *ويحوي حقل error تُعاد قيمته (عربية وآمنة للعرض). أخطاء الشبكة تُعاد برسالة
 *اتصال مناسبة. لا تُعرض أي أسرار أو تفاصيل تقنية للعميل.
 */
interface DeployErrorBody {
  error?: string;
  code?: string;
  stage?: string | null;
  via?: string | null;
  commit?: string;
}

const MAX_ERROR_DETAIL = 240;

/** Defensive redaction (the server already sanitises; never show a token). */
function redactErrorDetail(text: string): string {
  return text
    .replace(/(gh[pousr]_[A-Za-z0-9]{20,})/g, "[محجوب]")
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, "$1[محجوب]")
    .replace(/(AIza[0-9A-Za-z_\-]{20,})/g, "[محجوب]");
}

/**
 * The REAL server reason, appended to the plain-Arabic summary. A failed
 * Firebase/GitHub operation must never be hidden behind a generic message: the
 * owner needs the actual cause (e.g. a 403 / permission error) to act on it.
 */
function serverDetail(body: DeployErrorBody): string {
  const raw = typeof body.error === "string" ? body.error.trim() : "";
  if (!raw) return "";
  const safe = redactErrorDetail(raw);
  const capped = safe.length > MAX_ERROR_DETAIL ? `${safe.slice(0, MAX_ERROR_DETAIL)}…` : safe;
  return `\nالتفاصيل: ${capped}`;
}

/**
 * رسالة إدارية بسيطة يفهمها صاحب الموقع غير المبرمج لكل سبب فشل متوقَّع.
 *
 * NOTE: this deliberately does NOT try to classify an error as "the server is
 * old" from text fragments. That heuristic used to match ANY legacy Firebase
 * CLI error (including real permission/IAM failures) and replaced it with a
 * misleading "your server is outdated" message, hiding the actual cause. The
 * real, sanitised server reason is always appended below.
 */
function friendlyDeployFailure(status: number, body: DeployErrorBody): string | null {
  const detail = serverDetail(body);
  if (body.stage === "auth") {
    return (
      "لم يبدأ التحديث: إعداد الربط مع GitHub غير مكتمل على الخادم. يُرجى إضافة رمز GitHub في إعدادات الخادم ثم المحاولة." +
      detail
    );
  }
  if (body.stage === "source") {
    return (
      "لم يبدأ التحديث: تعذّر تأكيد أن النسخة المطلوب نشرها هي النسخة المعتمدة على الفرع." + detail
    );
  }
  if (body.stage === "target") {
    return "لم يبدأ التحديث: إعدادات مسار النشر عبر GitHub غير مكتملة على الخادم." + detail;
  }
  if (body.stage === "deploy") {
    return "فشل بدء التحديث على الخادم قبل إنشاء أي نشر، ولم يتغيّر الموقع." + detail;
  }
  if (body.stage === "verify") {
    return "بدأ التنفيذ لكن لم يتم تأكيد اكتمال التحديث، لذلك لا يُعتبر ناجحًا." + detail;
  }
  if (body.stage === "approval") {
    return "لم يبدأ التحديث: مسار النشر الحقيقي غير مُفعَّل على الخادم." + detail;
  }
  if (status === 502) {
    return "تعذّر إكمال التحديث على الخادم، ولم يُسجَّل أي نشر." + detail;
  }
  if (detail) return detail.trim();
  return null;
}

function deployErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const match = error.message.match(/^(\d{3}):\s*(.*)$/s);
    if (match) {
      const status = Number(match[1]);
      const bodyText = match[2];
      try {
        const body = JSON.parse(bodyText) as DeployErrorBody;
        // الرسالة البسيطة للمشرف أولًا؛ التفاصيل التقنية تبقى في سجل النشر
        // على الخادم ولا تُظهر في نافذة الرسالة.
        const friendly = friendlyDeployFailure(status, body);
        if (friendly) return friendly;
        if (typeof body.error === "string" && body.error.length > 0) {
          return body.error;
        }
      } catch {
        // الجسم ليس JSON — استخدم رسالة افتراضية حسب رمز الحالة أدناه.
      }
      switch (status) {
        case 400:
          return "طلب غير صالح. تأكد من بيانات الطلب وحاول مرة أخرى.";
        case 401:
          return "انتهت جلسة المسؤول أو غير صالحة. يُرجى تسجيل الدخول مجددًا.";
        case 403:
          return "تم رفض الطلب. تأكد من صلاحية المسؤول وأن الطلب من نفس المصدر.";
        case 404:
          return "مسار النشر غير متاح في هذه البيئة.";
        case 409:
          return "تعارض في حالة النشر. تأكد من البيئة وحاول مرة أخرى.";
        case 502:
          return "فشل تنفيذ النشر على الخادم. لم يتم أي نشر.";
        case 503:
          return "خدمة النشر غير متاحة حاليًا. حاول مرة أخرى لاحقًا.";
        case 500:
          return "خطأ داخلي في الخادم. لم يتم أي نشر.";
        default:
          return `تعذّر إكمال النشر (${status}).`;
      }
    }
    // خطأ شبكة أو خطأ غير منiformed من fetch (لا رمز حالة)
    return "تعذّر الاتصال بالخادم. تحقّق من اتصالك وحاول مرة أخرى.";
  }
  return "تعذّر إكمال النشر.";
}

function GateVerdictBadge({ status }: { status: DeployGateStatus }) {
  return (
    <span
      data-testid="deploy-gate-status"
      dir="rtl"
      className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${GATE_STATUS_CLASS[status]}`}
    >
      {DEPLOY_GATE_LABELS[status]}
    </span>
  );
}

function GateItemsList({ items }: { items: DeployGateItem[] }) {
  if (items.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        البوابة غير محسوبة في هذه اللقطة.
      </p>
    );
  }
  return (
    <ul className="space-y-1" data-testid="deploy-gate-items">
      {items.map((item) => {
        const meta = GATE_ITEM_STATE_META[item.state];
        return (
          <li
            key={item.key}
            data-testid={`gate-item-${item.key}`}
            className="flex items-start gap-1.5 text-[11px] leading-5"
          >
            <span className={`mt-0.5 shrink-0 font-bold ${meta.className}`}>
              {meta.symbol}
            </span>
            <span className="min-w-0">
              <span className="font-medium">
                {item.label}
                {" — "}
                <span dir="ltr">{DEPLOY_GATE_ITEM_STATE_LABELS[item.state]}</span>
              </span>
              {item.reason ? (
                <span className="block text-muted-foreground">{item.reason}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function InfoRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-[11px] font-medium">{children}</span>
    </div>
  );
}

export function DeployBar() {
  const { toast } = useToast();
  // MUST come from the provider: the app is wrapped by QueryProvider, whose
  // client is NOT the singleton in @/lib/queryClient. Invalidating the wrong
  // client silently no-ops and the bar never reflects a real switch.
  const queryClient = useQueryClient();
  // يُعرض الشريط فقط عندما نعرف بيقين أن البيئة ليست إنتاجًا.
  // على App Hosting، NODE_ENV تكون "production" دائمًا حتى على TEST، لذا لا
  // يمكن الاعتماد عليها وحدها. NEXT_PUBLIC_BASE_URL متاح للعميل عبر Next.js
  // ويشير إلى رابط الاختبار أو الإنتاج أو localhost، وهو مؤشر آمن للتمييز.
  // الفشل مغلق: إذا كان المتغير مفقودًا أو فارغًا أو غير معروف، لا يظهر الشريط.
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const isProductionOrigin = baseUrl === "https://rwqan.sa";
  const hasKnownBaseUrl = baseUrl.length > 0;
  const isDevOrTest = hasKnownBaseUrl && !isProductionOrigin;
  const [open, setOpen] = useState(false);

  const { data } = useQuery<{ prototypeVersion: string; state: DeployState }>({
    queryKey: ["/api/admin/deploy/state"],
    enabled: isDevOrTest,
  });

  const state = data?.state;
  const visible = Boolean(state);
  const trackedEnv: "TEST" | "LIVE" | null =
    state?.environment === "LIVE" ? "LIVE" : state?.environment === "TEST" ? "TEST" : null;

  // REAL deployment status for the tracked environment — read straight from
  // GitHub Actions through a read-only server endpoint. An accepted request is
  // NEVER displayed as "اكتمل": only the actual run state can become one, and a
  // successful run is only shown as a confirmed update when the server also
  // verified that the step which CREATES the rollout succeeded.
  const { data: publishRunStatus } = useQuery<{
    environment: string;
    status: {
      state: string;
      runUrl: string | null;
      headSha?: string | null;
      runId?: number | null;
      rolloutStep?: string;
      rolloutVerified?: boolean;
    };
  }>({
    queryKey: ["/api/admin/deploy/status", trackedEnv],
    queryFn: async ({ queryKey }) => {
      const res = await apiRequest(
        "GET",
        `/api/admin/deploy/status?environment=${queryKey[1] as string}`,
      );
      return res.json() as Promise<{
        environment: string;
        status: {
          state: string;
          runUrl: string | null;
          headSha?: string | null;
          runId?: number | null;
          rolloutStep?: string;
          rolloutVerified?: boolean;
        };
      }>;
    },
    enabled: visible && trackedEnv !== null,
    refetchInterval: 20_000,
  });
  const runStatusLabel: Record<string, string> = {
    running: "جارٍ التحديث الآن",
    success: "تم إنشاء التحديث وتأكّد",
    failed: "فشل آخر تحديث",
    none: "لم يبدأ أي تحديث بعد",
    unconfirmed: "انتهى التنفيذ دون تأكيد إنشاء التحديث",
    unknown: "حالة التحديث غير معروفة حاليًا",
  };
  // A green GitHub run is NOT proof of a deployment. Only downgrade to
  // "unconfirmed" when the server explicitly says the rollout step was not
  // confirmed; a missing field (older server) keeps the previous behaviour.
  const rawRunState = publishRunStatus?.status?.state ?? "";
  const runState =
    rawRunState === "success" &&
    publishRunStatus?.status?.rolloutVerified === false
      ? "unconfirmed"
      : rawRunState;

  // Data-environment toggle (LOCAL/TEST/LIVE). This switches the WHOLE
  // application's data sources and services between local resources, isolated
  // DEV project, and real production. It never publishes code or enables
  // payments. LIVE defaults to read-only; writes are rejected unless
  // LIVE_WRITE_MODE=enabled.
  const { data: liveDataStatus } = useQuery<{ status: LiveDataStatus }>({
    queryKey: ["/api/admin/live/status"],
    enabled: isDevOrTest,
  });
  const dataEnvironment = liveDataStatus?.status;

  // Offset the app (body + all top sticky headers) only while the bar shows.
  useEffect(() => {
    const root = document.documentElement;
    if (visible) root.classList.add("rwqan-deploy-active");
    else root.classList.remove("rwqan-deploy-active");
    return () => root.classList.remove("rwqan-deploy-active");
  }, [visible]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const [authPending, setAuthPending] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [autoResumePending, setAutoResumePending] = useState<boolean>(false);

  // The TEST publish is delegated to GitHub Actions: the deployment itself is
  // deployment itself is created by the deploy-test workflow from the remote
  // branch tip, so the follow-up lives in GitHub Actions, not in this panel.
  // LIVE uses its OWN workflow (deploy-live.yml on main) — the two buttons
  // below dispatch two DIFFERENT workflows and never cross.
  const GH_TEST_ACTIONS_URL =
    "https://github.com/modii1/rwqan/actions/workflows/deploy-test.yml";
  const GH_LIVE_ACTIONS_URL =
    "https://github.com/modii1/rwqan/actions/workflows/deploy-live.yml";
  const actionsUrlFor = (environment: "TEST" | "LIVE"): string =>
    environment === "LIVE" ? GH_LIVE_ACTIONS_URL : GH_TEST_ACTIONS_URL;
  /** Remembers the environment of the next publish request (auto-resume uses this). */
  const lastPublishEnvRef = useRef<"TEST" | "LIVE">("TEST");

  const publishMutation = useMutation({
    mutationFn: async (input: { environment: "TEST" | "LIVE"; approval: boolean }) => {
      if (!state) throw new Error("لا توجد حالة نشر جاهزة للخادم.");
      const res = await apiRequest("POST", "/api/admin/deploy/releases", {
        approve: input.approval,
        environment: input.environment,
      });
      return res.json() as Promise<{
        release?: DeployRelease;
        code?: string;
        detail?: string;
        actionsUrl?: string;
        branch?: string;
        commit?: string;
        via?: string;
      }>;
    },
    onSuccess: (result) => {
      setAuthUrl(null);
      setAutoResumePending(false);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deploy/state"] });
      if (result.code === "DEPLOY_GITHUB_DISPATCH_ACCEPTED") {
        // طلب أُرسل فقط: النشر يبدأ ويكتمل في GitHub — لا ادعاء للنجاح قبل
        // اكتمال التنفيذ هناك. لغة بسيطة للمشرف دون مصطلحات تقنية.
        const dispatchedEnv: "TEST" | "LIVE" = result.branch === "main" ? "LIVE" : "TEST";
        const shortSha =
          typeof result.commit === "string" && result.commit.length >= 7
            ? result.commit.slice(0, 7)
            : null;
        toast({
          title:
            dispatchedEnv === "LIVE"
              ? "تم إرسال طلب تحديث الموقع الرسمي إلى GitHub"
              : "تم إرسال طلب التحديث إلى GitHub",
          description:
            "التحديث يبدأ تلقائيًا في GitHub، وسيظهر تقدّمه في صفحة المتابعة:\n" +
            (result.actionsUrl ?? actionsUrlFor(dispatchedEnv)) +
            (shortSha ? `\nالنسخة المطلوبة: ${shortSha}` : "") +
            "\n(الحالة هنا لا تعني أن التحديث اكتمل)",
        });
        return;
      }
      const release = result.release;
      // Success is claimed ONLY after the route recorded a real deploy AND the
      // post-deploy verification passed — never on an unfinished/unsound deploy.
      const realDeployed = Boolean(
        release?.deployed && !release?.simulated && release?.postDeploy?.ok === true,
      );
      toast({
        title: realDeployed
          ? "نُشر فعليًا وتحقّق منه"
          : release?.status === "validation_failed"
            ? "فشل فحص إلزامي"
            : "لم يتم النشر",
        description: realDeployed
          ? `التحقق بعد النشر: ${release?.postDeploy?.ok ? "ناجح" : "غير مؤكَّد"}`
          : "لم يُسجَّل أي إصدار منشور.",
      });
    },
    onError: (error: unknown) => {
      if (error instanceof Error) {
        const match = error.message.match(/^(\d{3}):\s*(.*)$/s);
        if (match) {
          const status = Number(match[1]);
          if (status === 403) {
            try {
              const body = JSON.parse(match[2]) as {
                code?: string;
                error?: string;
                authUrl?: string | null;
                pendingPublish?: boolean;
              };
              if (body.code === "DEPLOY_AUTH_REQUIRED" && body.authUrl) {
                setAuthUrl(body.authUrl);
                // Mark that we are waiting for OAuth to complete before
                // automatic resume. The publish will be retried once after
                // successful authentication.
                setAutoResumePending(!!body.pendingPublish);
                toast({
                  title: "مصادقة Firebase مطلوبة",
                  description: body.pendingPublish
                    ? "سيتم فتح صفحة مصادقة Google. بعد الانتهاء، سيُستأنف النشر تلقائيًا."
                    : "يرجى تسجيل الدخول إلى Google للمصادقة مع Firebase CLI، ثم انقر نشر مرة أخرى.",
                  variant: "destructive",
                });
                return;
              }
            } catch {
              // Not JSON — fall through to default handling.
            }
          }
        }
      }
      // رسالة error مأخوذة من استجابة الخادم الفعلية (رمز الحالة + نص الخطأ
      // بالعربية)، أو خطأ اتصال للشبكة فقط. لا تُعرض تفاصيل داخلية أو أسرار.
      // لا إعادة محاولة تلقائية: قد تكون العملية قد بدأت بالفعل على الخادم.
      toast({
        title: "تعذّر النشر",
        description: deployErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  // Real, explicit release checks (POST /api/admin/deploy/checks): runs the
  // DEV-safe local checks (tsc --noEmit + secret scan) on the SERVER and stores
  // them. Nothing is built/deployed; no production connection is made.
  const checksMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/deploy/checks", {});
      return res.json() as Promise<{ checkRun?: DeployCheckRun }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deploy/state"] });
      const checks = result.checkRun?.checks;
      // Mirrors the route's failing predicate exactly:
      // secretScan !== "PASS" || typescript === "FAIL".
      const failed =
        !checks ||
        checks.secretScan !== "PASS" ||
        checks.typescript === "FAIL";
      toast({
        title: failed
          ? "فحوصات ما قبل النشر: فشل"
          : "فحوصات ما قبل النشر انتهت",
        description: failed
          ? "فحص فاشل يمنع أي نشر — راجع بطاقة الحالة."
          : "نتائج الفحص محفوظة في سجل الإصدارات.",
      });
    },
    onError: () => {
      toast({
        title: "تعذّر تشغيل الفحوصات",
        description: "لم تُسجَّل نتائج. حاول مرة أخرى.",
        variant: "destructive",
      });
    },
  });

  // Shared entry for BOTH publish buttons and the main publish button: the
  // server publishes the environment it currently tracks, so a request for the
  // other environment is refused with a plain-Arabic hint instead of a
  // technical mismatch error. Each environment can only ever reach its OWN
  // workflow file and branch — the executor resolves them separately.
  const startPublish = (targetEnv: "TEST" | "LIVE") => {
    if (!state) return;
    if (state.environment !== targetEnv) {
      toast({
        title: targetEnv === "LIVE" ? "لتحديث الموقع الرسمي" : "لتحديث بيئة التجربة",
        description: `الخادم مضبوط حاليًا على بيئة ${state.environment}. استخدم مبدّل البيئة أو زر تبديل البيئة للتحويل أولًا ثم أعد المحاولة.`,
        variant: "destructive",
      });
      return;
    }
    lastPublishEnvRef.current = targetEnv;
    // LIVE is dispatched through GitHub Actions, so it needs only the
    // GitHub-dispatch opt-in (DEPLOY_REAL_DEPLOY=enabled). TEST also uses the
    // same dispatch path. The separate productionDeployEnabled opt-in is only
    // for LOCAL production deploys via Firebase CLI, which neither TEST nor
    // LIVE dispatch uses.
    const dispatchReady = state.deployDispatchEnabled;
    if (!dispatchReady) {
      publishMutation.mutate({ environment: targetEnv, approval: false });
      return;
    }
    const target = state.deployTarget;
    const domain =
      target?.expectedDomain ??
      (targetEnv === "LIVE"
        ? "https://rwqan.sa"
        : "https://rwqan-backend--rwqan-757.europe-west4.hosted.app/");
    if (targetEnv === "LIVE") {
      const confirmed = window.confirm(
        "هل تريد تحديث الموقع الرسمي بآخر نسخة موجودة على فرعه؟\n\n" +
          `رابط الموقع الرسمي: ${domain}\n` +
          `متابعة تقدّم التحديث: ${GH_LIVE_ACTIONS_URL}\n\n` +
          "التحديث يبدأ من GitHub تلقائيًا، وهو لا يمس بيئة التجربة إطلاقًا.\n" +
          "الموافقة هنا طلب بدء التحديث فقط — اكتمال التحديث يظهر في صفحة المتابعة أعلاه.",
      );
      if (!confirmed) return;
      publishMutation.mutate({ environment: "LIVE", approval: true });
      return;
    }
    const confirmed = window.confirm(
      "هل تريد تحديث بيئة التجربة بآخر نسخة من الموقع؟\n\n" +
        `رابط بيئة التجربة: ${domain}\n` +
        `متابعة تقدّم التحديث: ${GH_TEST_ACTIONS_URL}\n\n` +
        "يبدأ التحديث من GitHub تلقائيًا، وهو لا يمس الموقع الرسمي إطلاقًا.\n" +
        "الموافقة هنا طلب بدء التحديث فقط — اكتمال التحديث يظهر في صفحة المتابعة أعلاه.",
    );
    if (!confirmed) return;
    publishMutation.mutate({ environment: "TEST", approval: true });
  };

  // The main publish button publishes the environment the server tracks now.
  const handlePublish = () => {
    if (!state) return;
    // If Firebase CLI authentication is required, open Google OAuth in a
    // popup window. When autoResumePending is true, poll for auth completion
    // and automatically resume the original publish once after success.
    if (authUrl) {
      setAuthPending(true);
      const popup = window.open(authUrl, "_blank", "width=600,height=700");
      if (!popup) {
        // Fallback: open in new tab if popup is blocked.
        window.open(authUrl, "_blank");
        toast({
          title: "افتح صفحة مصادقة Google",
          description:
            "تم فتح صفحة مصادقة Google في علامة تبويب جديدة. بعد إتمام المصادقة، ارجع إلى هذه الصفحة وانقر نشر مرة أخرى.",
        });
        setAuthPending(false);
        return;
      }
      // Poll the auth status endpoint to detect when OAuth completes.
      // Auto-resume only once when autoResumePending is true.
      let pollCount = 0;
      const maxPolls = 60; // ~60 seconds at 1s intervals
      const pollInterval = setInterval(async () => {
        pollCount++;
        try {
          const statusRes = await fetch("/api/admin/deploy/auth/status", {
            method: "GET",
            headers: {
              "content-type": "application/json",
              "sec-fetch-site": "same-origin",
            },
          });
          if (statusRes.ok) {
            const status = await statusRes.json();
            if (status.authenticated) {
              clearInterval(pollInterval);
              setAuthPending(false);
              setAuthUrl(null);
              if (autoResumePending) {
                setAutoResumePending(false);
                // Automatically resume the original publish once.
                publishMutation.mutate({ environment: lastPublishEnvRef.current, approval: true });
              } else {
                toast({
                  title: "تمت المصادقة بنجاح",
                  description:
                    "يمكنك الآن النقر على زر نشر لمتابعة عملية النشر.",
                });
              }
              return;
            }
          }
        } catch {
          // Ignore poll errors; keep polling.
        }
        if (popup.closed || pollCount >= maxPolls) {
          clearInterval(pollInterval);
          setAuthPending(false);
          if (popup.closed && pollCount < maxPolls) {
            // User closed the popup before completing OAuth.
            toast({
              title: "تم إغلاق صفحة المصادقة",
              description: "لم يتم استكمال المصادقة مع Google. لم يُنفّذ أي نشر.",
              variant: "destructive",
            });
          }
        }
      }, 1000);
      return;
    }
    const trackedEnv: "TEST" | "LIVE" = state.environment === "LIVE" ? "LIVE" : "TEST";
    startPublish(trackedEnv);
  };

  const restoreMutation = useMutation({
    mutationFn: async (releaseId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/deploy/releases/${encodeURIComponent(releaseId)}/restore`,
        { confirm: true },
      );
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deploy/state"] });
      const restore = (result as { restore?: DeployRestoreSummary }).restore;
      toast({
        title: restore ? "استعادة فعلية" : "استعادة الإصدار",
        description: restore
          ? `${restore.detail} (التحقق: ${restore.verified ? "ناجح" : "غير مؤكَّد"})`
          : "اكتملت عملية الاستعادة.",
      });
    },
    onError: () => {
      // Brief, non-technical failure: never surface server internals.
      toast({
        title: "تعذّرت الاستعادة",
        description: "لم تكتمل الاستعادة. تحقّق من الاتصال وحاول مرة أخرى.",
        variant: "destructive",
      });
    },
  });

  // A quick preview first: it reports exactly what WOULD be restored and every
  // reason it is blocked, WITHOUT executing anything. Only a restorable preview
  // asks for explicit confirmation and then runs the real, isolated restore.
  const previewMutation = useMutation({
    mutationFn: async (releaseId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/deploy/releases/${encodeURIComponent(releaseId)}/restore/preview`,
        {},
      );
      return res.json();
    },
    onSuccess: (result, releaseId) => {
      const preview = (result as { preview?: DeployRestorePreview }).preview;
      if (!preview) return;
      if (!preview.canRestore) {
        // Brief only: the server's blocker codes are technical, not user-facing.
        toast({
          title: "لا يمكن الاستعادة الفعلية",
          description: "هذه النسخة غير قابلة للاستعادة.",
          variant: "destructive",
        });
        return;
      }
      const environment = state?.environment ?? "TEST";
      const confirmed = window.confirm(
        `استعادة فعلية للإصدار ${preview.version} إلى بيئة ${environment}؟\n\n` +
          "سيُنشأ rollout من الـcommit الثابت على نفس الـbackend، مع التحقق من هوية مصدر البناء وفحص الوصول بعد الاستعادة. لا تُمسّ ملفات العمل المحلية.",
      );
      if (confirmed) restoreMutation.mutate(releaseId);
    },
    onError: () => {
      // Brief, non-technical failure: never surface server internals.
      toast({
        title: "تعذّرت الاستعادة",
        description: "تعذّر الاتصال. تحقّق من الاتصال وحاول مرة أخرى.",
        variant: "destructive",
      });
    },
  });

  const environmentMutation = useMutation({
    mutationFn: async (environment: DataEnvironment) => {
      // ONE environment selection drives BOTH the data sources and the real
      // publish/restore target, so the two never drift apart. The data switch
      // (which carries the safe LIVE gate) runs first; only then do we move the
      // deploy target.
      await apiRequest("POST", "/api/admin/live/environment", { environment });
      await apiRequest("POST", "/api/admin/deploy/environment", { environment });
      return environment;
    },
    onSuccess: (_result, environment) => {
      // The switch changes the WHOLE app's data source, so refetch everything
      // (not just the admin views) so the visible data reflects the selection.
      queryClient.invalidateQueries();
      toast({
        title: "تم تبديل البيئة",
        description:
          environment === "LIVE"
            ? "البيئة النشطة: LIVE — بيانات الإنتاج الحقيقية (rwqan.sa)، والنشر والاستعادة يستهدفان الإنتاج."
            : environment === "LOCAL"
            ? "البيئة النشطة: LOCAL — الموارد المحلية فقط، لا اتصال بالتطوير المعزول أو بالإنتاج."
            : "البيئة النشطة: TEST — موارد التطوير المعزولة (rwqan-sa-dev) فقط.",
      });
    },
    onError: (_error: Error, target: DataEnvironment) => {
      // Brief, non-technical failure only: never surface server/credential
      // internals. The environment is NOT changed locally, so the previous one
      // stays active and the control never sticks in a loading state.
      const title =
        target === "LIVE"
          ? "تعذّر تفعيل LIVE"
          : target === "LOCAL"
          ? "تعذّر التبديل إلى LOCAL"
          : "تعذّر التبديل إلى TEST";
      toast({
        title,
        description: "تعذّر الاتصال بالبيئة المطلوبة. حاول مرة أخرى.",
        variant: "destructive",
      });
    },
  });

  // ONE permanent two-option switch (LIVE | TEST). Both options are always
  // shown; the active one is highlighted. Selecting the OTHER option performs
  // the real switch (both data sources and the deploy target move together).
  // The current environment is server-side state: the UI only reflects it and
  // only advances after a successful API response (a failure keeps the prior
  // environment). Switching never publishes code and never enables production
  // writes — LIVE is refused unless the server confirms a safe (read-only)
  // production connection is configured.
  const handleSelectEnvironment = (target: DataEnvironment) => {
    if (!dataEnvironment || dataEnvironment.environment === target) return;
    if (target === "LIVE") {
      if (!dataEnvironment.liveAvailable) {
        // Brief only: the server reason names credentials/variables, which must
        // never be shown to the user. Fail closed with a short message.
        toast({
          title: "تعذّر تفعيل LIVE",
          description: "تعذّر الاتصال ببيئة الإنتاج.",
          variant: "destructive",
        });
        return;
      }
      // A half-configured LIVE (Firestore only) would show production data with
      // no images. Explain and refuse instead of switching into a broken state.
      if (!dataEnvironment.liveImagesAvailable) {
        toast({
          title: "تعذّر تفعيل LIVE",
          description:
            "صور الإنتاج غير مُهيَّأة — لن يتم التبديل إلى LIVE حتى يُضبط تخزين صور الإنتاج (قراءة فقط).",
          variant: "destructive",
        });
        return;
      }
      const confirmed = window.confirm(
        "تبديل بيئة البيانات إلى LIVE (الإنتاج)؟\n\n" +
          "سيقرأ التطبيق بيانات الإنتاج الحقيقية عبر اتصال خادمي مخصّص.\n" +
          (dataEnvironment.writeBlocked
            ? "الوضع: قراءة فقط — الكتابة والتعديل والحذف محظورة."
            : "تنبيه: وضع الكتابة على الإنتاج مُفعَّل."),
      );
      if (!confirmed) return;
    }
    // LOCAL و TEST لا تتطلب تأكيدًا خارجيًا — كلاهما معزول عن الإنتاج.
    environmentMutation.mutate(target);
  };

  const handleRestore = (release: DeployRelease) => {
    // Preview first (read-only), then confirm on the preview result.
    previewMutation.mutate(release.releaseId);
  };

  if (!visible || !state) return null;

  return (
    <>
      <div
        role="region"
        aria-label="شريط إدارة النشر"
        data-testid="deploy-bar"
        dir="rtl"
        className="fixed inset-x-0 top-0 z-[100] box-border border-b border-amber-300 bg-amber-50/95 text-amber-950 backdrop-blur supports-[backdrop-filter]:bg-amber-50/85"
        style={{ height: DEPLOY_BAR_HEIGHT_PX }}
      >
        <div className="mx-auto flex h-full max-w-7xl items-center gap-2 overflow-x-auto px-2 sm:gap-3 sm:px-4">
          {authUrl && (
            <div
              data-testid="deploy-bar-auth-required"
              className="flex shrink-0 items-center gap-2 px-3 py-1.5 rounded-md border border-orange-300 bg-orange-50/90 text-orange-900 text-xs font-medium"
            >
              <span>مصادقة Firebase مطلوبة —</span>
              <Button
                size="sm"
                variant="default"
                onClick={() => {
                  setAuthPending(true);
                  window.open(authUrl, "_blank");
                }}
                disabled={authPending}
                data-testid="deploy-bar-open-auth"
              >
                {authPending ? (
                  <Loader2 className="ml-1 h-3 w-3 animate-spin" />
                ) : (
                  "تسجيل الدخول إلى Google"
                )}
              </Button>
            </div>
          )}
          <Button
            size="sm"
            variant="default"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={handlePublish}
            disabled={publishMutation.isPending}
            data-testid="deploy-bar-publish"
          >
            {publishMutation.isPending ? (
              <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <UploadCloud className="ml-1 h-3.5 w-3.5" />
            )}
            نشر
          </Button>

          {/* Independent publish button for each environment: TEST and LIVE each
              target ONLY their own GitHub workflow and their own Firebase
              backend; the server enforces the same separation (each request
              goes to the executor with the environment it names, and a
              cross-environment request is refused). Plain Arabic labels and
              prompts — no technical jargon for the site owner. */}
          <Button
            size="sm"
            variant="default"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => startPublish("TEST")}
            disabled={publishMutation.isPending}
            data-testid="deploy-bar-publish-test"
          >
            نشر نسخة التجربة
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => startPublish("LIVE")}
            disabled={publishMutation.isPending}
            data-testid="deploy-bar-publish-live"
          >
            نشر الموقع الرسمي
          </Button>

          {trackedEnv && runState && (
            <a
              href={publishRunStatus?.status?.runUrl ?? actionsUrlFor(trackedEnv)}
              target="_blank"
              rel="noreferrer"
              data-testid="deploy-bar-publish-status"
              className={`flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold border ${
                runState === "running"
                  ? "border-sky-300 bg-sky-50 text-sky-900"
                  : runState === "failed"
                    ? "border-red-300 bg-red-50 text-red-900"
                    : runState === "success"
                      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                      : "border-amber-300 bg-white text-amber-900"
              }`}
            >
              {runStatusLabel[runState] ?? runStatusLabel.unknown}
            </a>
          )}

          <div
            dir="ltr"
            role="group"
            aria-label="البيئة"
            data-testid="deploy-bar-environment"
            className="flex shrink-0 items-stretch overflow-hidden rounded-md border border-amber-300 text-xs font-semibold"
          >
            {/* PERMANENT three-option switch: LOCAL, TEST, and LIVE are always
                shown and the active one is highlighted. Selecting a different
                option performs the real switch. Never a single button whose text
                changes. TEST never targets LIVE, and LOCAL never targets any
                remote backend. */}
            {(["LOCAL", "TEST", "LIVE"] as const).map((option) => {
              const active = dataEnvironment?.environment === option;
              const disabled = environmentMutation.isPending || !dataEnvironment;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleSelectEnvironment(option)}
                  disabled={disabled}
                  aria-pressed={active}
                  aria-label={`تبديل البيئة إلى ${option}`}
                  data-testid={`deploy-bar-environment-${option.toLowerCase()}`}
                  className={`flex h-7 items-center justify-center gap-1 px-3 transition-colors ${
                    active
                      ? option === "LIVE"
                        ? "bg-red-600 text-white"
                        : option === "TEST"
                        ? "bg-amber-600 text-white"
                        : "bg-emerald-600 text-white"
                      : "bg-white text-amber-900 hover:bg-amber-100"
                  }`}
                >
                  {environmentMutation.isPending && active ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : null}
                  {option}
                </button>
              );
            })}
          </div>

          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => setOpen(true)}
            data-testid="deploy-bar-restore"
          >
            <RotateCcw className="ml-1 h-3.5 w-3.5" />
            استعادة
          </Button>
        </div>
      </div>

      {open && (
        <div
          data-testid="deploy-bar-panel"
          dir="rtl"
          className="fixed left-2 right-2 top-[40px] z-[100] max-h-[70vh] overflow-y-auto rounded-b-lg border border-amber-300 bg-white p-3 shadow-xl sm:left-auto sm:right-3 sm:w-[520px]"
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold text-amber-950">استعادة</h3>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              onClick={() => setOpen(false)}
              aria-label="إغلاق"
              data-testid="deploy-bar-panel-close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* STATUS CARD: the pre-deploy gate + target + Git identity +
              check results. All values come straight from the server snapshot;
              the gate is presentation of already-enforced rules, never a new
              permission source. */}
          <div
            data-testid="deploy-bar-status"
            className="mb-3 rounded-md border border-amber-200 bg-amber-50/60 p-2.5"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-amber-700" />
                <span className="text-xs font-bold">بوابة ما قبل النشر</span>
              </div>
              <GateVerdictBadge
                status={state.gate?.status ?? "unverified_missing_info"}
              />
            </div>

            <div className="mb-2">
              <GateItemsList items={state.gate?.items ?? []} />
            </div>

            {/* Checks: the REAL stored run + the wired button that runs it. */}
            <div className="mb-2 rounded border border-amber-200 bg-white/70 p-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 shrink-0 px-2 text-[11px]"
                  onClick={() => checksMutation.mutate()}
                  disabled={checksMutation.isPending}
                  data-testid="deploy-bar-checks"
                >
                  {checksMutation.isPending ? (
                    <Loader2 className="ml-1 h-3 w-3 animate-spin" />
                  ) : (
                    <ShieldCheck className="ml-1 h-3 w-3" />
                  )}
                  فحص ما قبل النشر
                </Button>
                {state.latestCheckRun ? (
                  <>
                    <Badge
                      data-testid="deploy-check-typescript"
                      variant={
                        state.latestCheckRun.checks.typescript === "FAIL"
                          ? "destructive"
                          : "outline"
                      }
                      className="text-[10px]"
                    >
                      TypeScript: {CHECK_RESULT_LABEL[state.latestCheckRun.checks.typescript]}
                    </Badge>
                    <Badge
                      data-testid="deploy-check-secret-scan"
                      variant={
                        state.latestCheckRun.checks.secretScan === "FAIL" ||
                        state.latestCheckRun.checks.secretScan === "BLOCKED"
                          ? "destructive"
                          : "outline"
                      }
                      className="text-[10px]"
                    >
                      فحص الأسرار: {CHECK_RESULT_LABEL[state.latestCheckRun.checks.secretScan]}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {state.latestCheckRun.ranAt?.slice(11, 19)} UTC
                    </span>
                  </>
                ) : (
                  <span className="text-[10px] text-muted-foreground">
                    لم تُشغَّل فحوص محفوظة بعد.
                  </span>
                )}
              </div>
            </div>

            {/* Deploy target: fixed server-side (never client-chosen). */}
            <div className="space-y-0.5 border-t border-amber-200 pt-2">
              <InfoRow label="بيئة النشر الحالية">{state.environment}</InfoRow>
              <InfoRow label="المشروع المستهدف">
                <span dir="ltr" className="font-mono">
                  {state.deployTarget?.projectId ?? UNVERIFIED}
                </span>
              </InfoRow>
              <InfoRow label="Backend">
                <span dir="ltr" className="font-mono">
                  {state.deployTarget?.backendId ?? UNVERIFIED}
                </span>
              </InfoRow>
              <InfoRow label="المنطقة">
                <span dir="ltr" className="font-mono">
                  {state.deployTarget?.location ?? UNVERIFIED}
                </span>
              </InfoRow>
              <InfoRow label="الدومين المتوقع (توقّع، لا إثبات)">
                <span
                  dir="ltr"
                  className="font-mono"
                  data-testid="deploy-bar-expected-domain"
                >
                  {state.deployTarget?.expectedDomain ?? UNVERIFIED}
                </span>
              </InfoRow>
            </div>

            {/* Git identity + capabilities. */}
            <div className="mt-2 space-y-0.5 border-t border-amber-200 pt-2">
              <InfoRow label="commit الحالي (كامل)">
                <span dir="ltr" className="font-mono" data-testid="deploy-bar-commit">
                  {state.git?.commitSha ?? UNVERIFIED}
                </span>
              </InfoRow>
              <InfoRow label="الفرع">
                {state.git?.branch ?? UNVERIFIED}
              </InfoRow>
              <InfoRow label="شجرة العمل">
                {state.git
                  ? WORKTREE_LABEL[state.git.worktree] ?? state.git.worktree
                  : UNVERIFIED}
              </InfoRow>
              <InfoRow label="تطابق GitHub">
                {state.github?.match
                  ? GITHUB_MATCH_LABEL[state.github.match] ?? state.github.match
                  : UNVERIFIED}
              </InfoRow>
            </div>

            <div className="mt-2 flex flex-wrap gap-1 border-t border-amber-200 pt-2">
              <Badge
                variant="outline"
                className="text-[10px]"
                data-testid="deploy-bar-cap-real-deploy"
              >
                النشر الحقيقي: {state.realDeployEnabled ? "مفعَّل" : "معطَّل"}
              </Badge>
              <Badge
                variant="outline"
                className="text-[10px]"
                data-testid="deploy-bar-cap-production"
              >
                الإنتاج: {state.productionDeployEnabled ? "مفعَّل" : "مغلق"}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                المخزن: {state.persistent ? "مستقر" : "مؤقت (ذاكرة)"}
              </Badge>
              <Badge
                variant="outline"
                className="text-[10px]"
                data-testid="deploy-bar-cap-data-environment"
              >
                بيانات التشغيل: {state.dataEnvironment ?? UNVERIFIED}
              </Badge>
              <Badge
                variant="outline"
                className="text-[10px]"
                data-testid="deploy-bar-cap-tools"
              >
                Firebase CLI:{" "}
                {state.tools === null || state.tools === undefined
                  ? UNVERIFIED
                  : state.tools.firebaseCliAvailable
                    ? `${state.tools.firebaseCliVersion ?? "متاح"}`
                    : "غير متاح"}
              </Badge>
            </div>
          </div>

          <ul className="space-y-1.5">
            {/* ONLY the real stable release(s): old/prototype/failed records stay
                in the registry but are deliberately never listed here. */}
            {state.stableReleases.length === 0 ? (
              <li
                data-testid="deploy-bar-empty"
                className="rounded-md border border-dashed border-amber-300 p-3 text-center text-xs text-muted-foreground"
              >
                لا توجد نسخة مستقرة حقيقية بعد.
              </li>
            ) : (
              state.stableReleases.map((release) => (
                <li
                  key={release.releaseId}
                  data-testid={`deploy-bar-release-${release.releaseId}`}
                  className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50/50 p-2"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium">{release.version}</span>
                    {release.gitShortSha ? (
                      <span
                        dir="ltr"
                        className="font-mono text-[10px] text-muted-foreground"
                      >
                        {release.gitShortSha}
                      </span>
                    ) : null}
                    <Badge variant="outline" className="text-[10px]">
                      {release.stableBaseline
                        ? "مرجع مستقر"
                        : STATUS_LABEL[release.status]}
                    </Badge>
                    <Badge
                      variant={
                        release.environment === "TEST" ? "secondary" : "destructive"
                      }
                      className="text-[10px]"
                    >
                      {release.environment}
                    </Badge>
                    {release.deployed && !release.simulated && release.postDeploy?.ok === true ? (
                      <Badge
                        variant="default"
                        className="text-[10px] bg-green-700 text-white"
                        data-testid={`deploy-bar-postdeploy-${release.releaseId}`}
                      >
                        تحقق بعد النشر: ناجح
                      </Badge>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 px-2 text-xs"
                    onClick={() => handleRestore(release)}
                    disabled={
                      !isRestorable(release) ||
                      previewMutation.isPending ||
                      restoreMutation.isPending
                    }
                    data-testid={`deploy-bar-restore-${release.releaseId}`}
                  >
                    <RotateCcw className="ml-1 h-3.5 w-3.5" />
                    استعادة
                  </Button>
                </li>
              ))
            )}
          </ul>

          <p className="mt-2 text-[11px] text-muted-foreground">
            {state.realDeployEnabled
              ? `النشر الحقيقي مُفعَّل نحو: ${state.deployTarget?.projectId ?? "rwqan-local"} — ولا يُسجَّل الإصدار كمنشور إلا بعد نجاح التحقق بعد النشر. `
              : "مسار النشر مُعطَّل حتى تُضبط بيانات الاعتماد صراحةً. "}
            الاستعادة تنفّذ rollout حقيقيًا من الـcommit الثابت بعد التحقق من المصدر والوصول.
          </p>
        </div>
      )}
    </>
  );
}

export default DeployBar;
