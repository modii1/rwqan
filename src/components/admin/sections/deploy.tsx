"use client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Rocket,
  UploadCloud,
  RotateCcw,
  Loader2,
  AlertTriangle,
  Server,
  ShieldAlert,
  GitBranch,
  ClipboardCheck,
  Anchor,
  History,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type DeployEnvironment = "TEST" | "LIVE";

type DeployReleaseStatus =
  | "draft"
  | "validated"
  | "validation_failed"
  | "saved_to_git"
  | "deploying"
  | "deployed"
  | "failed"
  | "rolled_back"
  | "simulated";

type DeployCheckResult = "PASS" | "FAIL" | "BLOCKED" | "NOT_RUN";

type WorktreeState = "clean" | "dirty" | "unknown";
type GitHubMatch = "match" | "mismatch" | "unavailable";

interface DeployGitInfo {
  available: boolean;
  commitSha: string | null;
  shortSha: string | null;
  branch: string | null;
  worktree: WorktreeState;
  readAt: string;
  reason?: string;
}

interface DeployGitHubInfo {
  available: boolean;
  remoteUrl: string | null;
  remoteSha: string | null;
  match: GitHubMatch;
  source: "local_ref" | "ls_remote" | "none";
  readAt: string;
  reason?: string;
}

interface DeployCheckMeta {
  ranAt: string | null;
  command: string;
  exitCode?: number | null;
  reason?: string;
}

interface DeployCheckRun {
  ranAt: string;
  checks: Record<string, DeployCheckResult>;
  meta?: Record<string, DeployCheckMeta>;
}

interface DeployRestorePreview {
  releaseId: string;
  version: string;
  commitSha: string;
  shortSha: string | null;
  canRestore: boolean;
  blockers: string[];
  targetPath: string | null;
}

interface DeployRestoreResult {
  status: "success" | "failed" | "blocked";
  real: boolean;
  targetPath: string | null;
  fileCount: number;
  verified: boolean;
  detail: string;
  error?: string | null;
}

interface DeployPostDeployVerification {
  attempted: boolean;
  reachable: boolean;
  ok: boolean;
  url: string | null;
  httpStatus: number | null;
  expectedCommit: string;
  reportedCommit: string | null;
  reportedVersion: string | null;
  match: boolean;
  verifiedAt: string;
  reason?: string;
}

interface DeployRelease {
  releaseId: string;
  version: string;
  environment: DeployEnvironment;
  gitCommit: string;
  gitTag: string | null;
  gitBranch: string;
  createdAt: string;
  changeSummary: string;
  status: DeployReleaseStatus;
  checks: Record<string, DeployCheckResult>;
  checkNotes?: Record<string, string>;
  gitShortSha?: string | null;
  worktree?: WorktreeState;
  github?: DeployGitHubInfo;
  checksMeta?: Record<string, DeployCheckMeta>;
  checkRunAt?: string | null;
  savedToGit: boolean;
  deployed: boolean;
  simulated: boolean;
  deployTarget?: string;
  deployRef?: string | null;
  postDeploy?: DeployPostDeployVerification | null;
  error?: string | null;
}

interface DeployAuditEntry {
  id: string;
  action: string;
  actor: "admin";
  at: string;
  environment: DeployEnvironment;
  result: "ok" | "rejected";
  releaseId?: string;
  reason?: string;
}

interface DeployStateDescriptor {
  status: DeployReleaseStatus;
  label: string;
  description: string;
}

type DeployConfidence = "verified" | "partially_verified" | "unknown";

interface DeployStableBaseline {
  site: string;
  hostingSource: string;
  publishedVersionId: string | null;
  publishedSha: string | null;
  verifiedAt: string | null;
  healthChecks: Record<string, DeployCheckResult>;
  confidence: DeployConfidence;
  localHeadSha: string | null;
  headMatchesBaseline: boolean | null;
  notes: string;
}

interface DeployRollbackReadiness {
  mechanism: string;
  supported: boolean;
  confirmed: boolean;
  readyToRollback: boolean;
  codeOnly: boolean | null;
  requirements: string[];
  postRollbackVerification: string[];
  risks: string[];
  reason: string;
}

interface DeployState {
  environment: DeployEnvironment;
  environmentNotice: string;
  livePreviewImplemented: boolean;
  experimental: boolean;
  persistent: boolean;
  persistenceNotice: string;
  releases: DeployRelease[];
  audit: DeployAuditEntry[];
  states: DeployStateDescriptor[];
  git: DeployGitInfo | null;
  github: DeployGitHubInfo | null;
  latestCheckRun: DeployCheckRun | null;
  deployTarget?: { projectId: string; backendId: string; baseUrl: string | null };
  realDeployEnabled?: boolean;
  stableBaseline?: DeployStableBaseline;
  rollback?: DeployRollbackReadiness;
}

interface DeployStateResponse {
  prototypeVersion: string;
  publishNotice?: string;
  state: DeployState;
}

const STATUS_BADGE: Record<DeployReleaseStatus, string> = {
  draft: "secondary",
  validated: "default",
  validation_failed: "destructive",
  saved_to_git: "default",
  deploying: "secondary",
  deployed: "default",
  failed: "destructive",
  rolled_back: "secondary",
  simulated: "outline",
};

function statusLabel(state: DeployState | undefined, status: DeployReleaseStatus): string {
  return state?.states.find((entry) => entry.status === status)?.label ?? status;
}

export default function DeploySection() {
  const { toast } = useToast();

  const { data, isLoading, isError } = useQuery<DeployStateResponse>({
    queryKey: ["/api/admin/deploy/state"],
  });
  const state = data?.state;

  const environmentMutation = useMutation({
    mutationFn: async (environment: DeployEnvironment) => {
      const res = await apiRequest("POST", "/api/admin/deploy/environment", {
        environment,
      });
      return res.json();
    },
    onSuccess: (_result, environment) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deploy/state"] });
      toast({
        title: "تم تبديل مفتاح البيئة",
        description:
          environment === "LIVE"
            ? "مفتاح العرض LIVE — معاينة الإنتاج غير مُنفَّذة ولن يُحدث أي اتصال."
            : "البيئة النشطة الآن: TEST (موارد DEV المعزولة).",
      });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  const publishMutation = useMutation({
    mutationFn: async (approval: boolean) => {
      const res = await apiRequest("POST", "/api/admin/deploy/releases", {
        approve: approval,
      });
      return (await res.json()) as {
        release?: DeployRelease;
        publishNotice?: string;
        blocked?: boolean;
        reason?: string;
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deploy/state"] });
      const release = result.release;
      const failed = release?.status === "validation_failed";
      const realDeployed = Boolean(release?.deployed && !release?.simulated);
      toast({
        title: realDeployed
          ? "نُشر فعليًا إلى DEV المعزول"
          : failed
            ? "فشل فحص إلزامي — سُجِّل الإصدار (محاكاة)"
            : "تم حفظ سجل الإصدار (محاكاة)",
        description: realDeployed
          ? `الهدف: ${release?.deployTarget ?? "rwqan-sa-dev"} — تحقّق ما بعد النشر: ${
              release?.postDeploy?.ok ? "ناجح" : "غير مؤكَّد"
            }`
          : (result.publishNotice ??
            "تم حفظ السجل فقط؛ لم يُنفَّذ أي commit أو push أو نشر فعلي."),
        variant: failed ? "destructive" : "default",
      });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  const handlePublish = () => {
    if (state?.realDeployEnabled) {
      const target = state.deployTarget;
      const confirmed = window.confirm(
        "نشر حقيقي إلى بيئة التطوير المعزولة فقط؟\n\n" +
          `المشروع: ${target?.projectId ?? "rwqan-sa-dev"}\n` +
          `الخدمة: ${target?.backendId ?? "—"}\n\n` +
          "لن يتم أي اتصال بالإنتاج. يُسجَّل الإصدار كمنشور فقط بعد نجاح التحقق بعد النشر.",
      );
      if (!confirmed) return;
      publishMutation.mutate(true);
      return;
    }
    publishMutation.mutate(false);
  };

  const checksMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/deploy/checks", {});
      return (await res.json()) as { checkRun: DeployCheckRun };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deploy/state"] });
      toast({
        title: "تم تشغيل فحوصات الإصدار",
        description: `TypeScript: ${result.checkRun?.checks?.typescript ?? "—"} · فحص الأسرار: ${
          result.checkRun?.checks?.secretScan ?? "—"
        }`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "تعذّر تشغيل الفحوصات", description: error.message, variant: "destructive" });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (releaseId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/deploy/releases/${encodeURIComponent(releaseId)}/restore`,
        { confirm: true },
      );
      return (await res.json()) as {
        restore?: DeployRestoreResult;
        restoreNotice?: string;
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deploy/state"] });
      const restore = result.restore;
      toast({
        title: restore && restore.status === "success"
          ? "استعادة فعلية معزولة"
          : "استعادة الإصدار",
        description: restore
          ? `${restore.detail} (${restore.fileCount} ملفًا، تحقّق: ${
              restore.verified ? "ناجح" : "غير مؤكَّد"
            })`
          : "اكتملت عملية الاستعادة.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "تعذّرت الاستعادة", description: error.message, variant: "destructive" });
    },
  });

  const previewMutation = useMutation({
    mutationFn: async (releaseId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/deploy/releases/${encodeURIComponent(releaseId)}/restore/preview`,
        {},
      );
      return (await res.json()) as { preview?: DeployRestorePreview };
    },
    onSuccess: (result, releaseId) => {
      const preview = result.preview;
      if (!preview) return;
      if (!preview.canRestore) {
        toast({
          title: "لا يمكن الاستعادة الفعلية",
          description: preview.blockers.join(" ") || "الإصدار غير قابل للاستعادة.",
          variant: "destructive",
        });
        return;
      }
      const confirmed = window.confirm(
        `استعادة فعلية معزولة للإصدار ${preview.version} (${preview.shortSha ?? preview.commitSha})؟\n\n` +
          `الهدف: ${preview.targetPath ?? "—"}\n` +
          "تُعاد ملفات الإصدار للبناء من الـSHA داخل مجلد معزول مع تقليم الأسرار والتحقق، بلا commit/push/checkout/deploy ودون المساس بملفات العمل.",
      );
      if (confirmed) restoreMutation.mutate(releaseId);
    },
    onError: (error: Error) => {
      toast({
        title: "تعذّر بناء معاينة الاستعادة",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleRestore = (release: DeployRelease) => {
    // Read-only preview first; a real restore only runs after explicit confirm.
    previewMutation.mutate(release.releaseId);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" dir="rtl">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError || !state) {
    return (
      <Card className="m-4" dir="rtl">
        <CardContent className="pt-6 text-center text-muted-foreground">
          تعذّر تحميل نظام النشر. تأكد من أنك في نسخة التطوير المعزولة وأنك مسجّل كمسؤول.
        </CardContent>
      </Card>
    );
  }

  const environment = state.environment;

  return (
    <div className="space-y-4" dir="rtl" data-testid="deploy-section">
      {/* شريط تجريبي */}
      <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
        <CardContent className="flex items-start gap-3 pt-6">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
          <div>
            <p className="font-semibold text-amber-800 dark:text-amber-200">
              نظام النشر — وضع تجريبي (المرحلة C/D/E)
            </p>
            <p className="text-sm text-muted-foreground">
              جميع عمليات <strong>النشر</strong> هنا <strong>محاكاة</strong>: زر «نشر»{" "}
              <strong>يحفظ سجل الإصدار فقط</strong> ولا يُنفِّذ أي commit أو push أو نشر فعلي، ولا أي
              اتصال بالإنتاج أو بقاعدة بياناته. أما <strong>الاستعادة</strong> فهي فعلية لكن{" "}
              <strong>معزولة</strong> داخل مجلد بناء منفصل.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              مسار النشر الحقيقي إلى هدف DEV المعزول (<code dir="ltr">rwqan-sa-dev</code>) مُنفَّذ
              لكنه <strong>معطَّل افتراضيًا</strong>: لا يُفعَّل إلا داخل بيئة التطوير مع
              <code dir="ltr"> DEPLOY_REAL_DEPLOY=enabled</code> وموافقة إدارية صريحة، ولا يُعدّ
              الإصدار منشورًا إلا بعد نجاح التحقق بعد النشر.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              <strong>التخزين:</strong> {state.persistenceNotice}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* شريط التحكم: نشر / استعادة / مفتاح البيئة */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Rocket className="h-5 w-5 text-primary" />
              <CardTitle>نظام النشر</CardTitle>
            </div>
            <div className="flex items-center gap-2" data-testid="deploy-environment-switch">
              <span className="text-sm text-muted-foreground">مفتاح البيئة:</span>
              <Button
                size="sm"
                variant={environment === "TEST" ? "default" : "outline"}
                onClick={() => environmentMutation.mutate("TEST")}
                disabled={environmentMutation.isPending}
                data-testid="env-test"
              >
                TEST
              </Button>
              <Button
                size="sm"
                variant={environment === "LIVE" ? "destructive" : "outline"}
                onClick={() => environmentMutation.mutate("LIVE")}
                disabled={environmentMutation.isPending}
                data-testid="env-live"
              >
                LIVE
              </Button>
              <Badge variant={environment === "TEST" ? "secondary" : "destructive"}>
                {environment === "TEST" ? "البيئة النشطة: TEST" : "البيئة النشطة: LIVE"}
              </Badge>
            </div>
          </div>
          <CardDescription>{state.environmentNotice}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={handlePublish}
              disabled={publishMutation.isPending}
              data-testid="button-deploy-publish"
            >
              {publishMutation.isPending ? (
                <Loader2 className="ml-1 h-4 w-4 animate-spin" />
              ) : (
                <UploadCloud className="ml-1 h-4 w-4" />
              )}
              {state.realDeployEnabled ? "نشر حقيقي إلى DEV" : "نشر (محاكاة)"}
            </Button>

            <Button
              variant="outline"
              onClick={() => checksMutation.mutate()}
              disabled={checksMutation.isPending}
              data-testid="button-deploy-checks"
            >
              {checksMutation.isPending ? (
                <Loader2 className="ml-1 h-4 w-4 animate-spin" />
              ) : (
                <ClipboardCheck className="ml-1 h-4 w-4" />
              )}
              تشغيل الفحوصات
            </Button>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Server className="h-4 w-4" />
              <span>رقم الإصدار الحالي:</span>
              <code className="rounded bg-muted px-2 py-0.5" dir="ltr">
                {data?.prototypeVersion}
              </code>
              <Badge
                variant={state.persistent ? "default" : "destructive"}
                data-testid="deploy-persistence"
              >
                {state.persistent ? "سجل دائم (Firestore DEV)" : "سجل غير دائم (فشل مغلق)"}
              </Badge>
            </div>

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              <span>
                معاينة الإنتاج (LIVE):{" "}
                {state.livePreviewImplemented ? "مُفعّلة" : "غير مُنفَّذة"}
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            «نشر» و«حفظ في GitHub» عمليتان مختلفتان: حالة <code>saved_to_git</code> لا تعني أن
            الإصدار <code>deployed</code>، والعكس. يعرض الجدول أعلاه كلا الحالتين منفصلتين.
          </div>
        </CardContent>
      </Card>

      {/* حالة المصدر Git/GitHub الحية (قراءة فقط) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <GitBranch className="h-4 w-4 text-primary" />
            حالة المصدر (Git / GitHub) — قراءة فقط
          </CardTitle>
          <CardDescription>
            تُقرأ محليًا بلا commit/push. لا يُعتبر HEAD دليلًا على مطابقة شجرة العمل.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {state.git?.available ? (
            <div className="flex flex-wrap items-center gap-3" data-testid="deploy-git-status">
              <span dir="ltr" className="font-mono">
                {state.git.shortSha}
              </span>
              <span dir="ltr">{state.git.branch ?? "detached"}</span>
              <Badge variant={state.git.worktree === "dirty" ? "destructive" : "secondary"}>
                شجرة العمل:{" "}
                {state.git.worktree === "dirty"
                  ? "غير نظيفة"
                  : state.git.worktree === "clean"
                    ? "نظيفة"
                    : "غير معروفة"}
              </Badge>
              <span className="text-xs text-muted-foreground" dir="ltr">
                {state.git.readAt}
              </span>
            </div>
          ) : (
            <p className="text-muted-foreground">
              Git غير متاح: {state.git?.reason ?? "تعذّرت القراءة"}
            </p>
          )}
          {state.github ? (
            <div className="flex flex-wrap items-center gap-3" data-testid="deploy-github-status">
              <Badge
                variant={
                  state.github.match === "match"
                    ? "default"
                    : state.github.match === "mismatch"
                      ? "destructive"
                      : "outline"
                }
              >
                GitHub:{" "}
                {state.github.match === "match"
                  ? "مطابق"
                  : state.github.match === "mismatch"
                    ? "غير مطابق"
                    : "غير متاح"}
              </Badge>
              <span dir="ltr" className="text-xs text-muted-foreground">
                {state.github.remoteSha ?? "—"}
              </span>
              <span className="text-xs text-muted-foreground">المصدر: {state.github.source}</span>
              {state.github.remoteUrl ? (
                <span dir="ltr" className="text-xs text-muted-foreground">
                  {state.github.remoteUrl}
                </span>
              ) : null}
            </div>
          ) : null}
          {state.latestCheckRun ? (
            <div className="text-xs text-muted-foreground" data-testid="deploy-latest-checkrun">
              آخر تشغيل فحوصات: <span dir="ltr">{state.latestCheckRun.ranAt}</span> —{" "}
              <span dir="ltr">
                {Object.entries(state.latestCheckRun.checks)
                  .map(([key, value]) => `${key}=${value}`)
                  .join(", ")}
              </span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">لم يُشغَّل أي فحص صريح بعد.</p>
          )}
        </CardContent>
      </Card>

      {/* النسخة المستقرة المرجعية (Stable Baseline) */}
      {state.stableBaseline ? (
        <Card data-testid="stable-baseline">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Anchor className="h-4 w-4 text-primary" />
              النسخة المستقرة المرجعية — {state.stableBaseline.site}
            </CardTitle>
            <CardDescription>
              مرجع رسمي للقراءة فقط. لا يُفترض أن HEAD المحلي هو الإصدار المنشور.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <Badge
                variant={
                  state.stableBaseline.confidence === "verified"
                    ? "default"
                    : state.stableBaseline.confidence === "partially_verified"
                      ? "secondary"
                      : "destructive"
                }
                data-testid="baseline-confidence"
              >
                الثقة:{" "}
                {state.stableBaseline.confidence === "verified"
                  ? "مؤكَّدة"
                  : state.stableBaseline.confidence === "partially_verified"
                    ? "جزئية"
                    : "غير معروفة"}
              </Badge>
              <span className="text-muted-foreground" dir="ltr">
                {state.stableBaseline.hostingSource}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                الإصدار المنشور:{" "}
                <code dir="ltr">
                  {state.stableBaseline.publishedVersionId ?? "غير مُثبَت"}
                </code>
              </span>
              <span>
                SHA المنشور:{" "}
                <code dir="ltr">{state.stableBaseline.publishedSha ?? "غير مُثبَت"}</code>
              </span>
              <span>
                وقت التحقق: <code dir="ltr">{state.stableBaseline.verifiedAt ?? "—"}</code>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                HEAD المحلي:{" "}
                <code dir="ltr">{state.stableBaseline.localHeadSha ?? "—"}</code>
              </span>
              <Badge
                variant={
                  state.stableBaseline.headMatchesBaseline === true
                    ? "default"
                    : state.stableBaseline.headMatchesBaseline === false
                      ? "destructive"
                      : "outline"
                }
              >
                {state.stableBaseline.headMatchesBaseline === true
                  ? "HEAD مطابق للمنشور"
                  : state.stableBaseline.headMatchesBaseline === false
                    ? "HEAD مختلف عن المنشور"
                    : "المطابقة غير قابلة للتحديد"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">{state.stableBaseline.notes}</p>
          </CardContent>
        </Card>
      ) : null}

      {/* جاهزية الرجوع السريع (Rollback Readiness) */}
      {state.rollback ? (
        <Card data-testid="rollback-readiness">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-primary" />
              جاهزية الرجوع السريع
            </CardTitle>
            <CardDescription>لا تُعرض «جاهزية» قبل إثبات الآلية الفعلية.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <Badge
                variant={state.rollback.readyToRollback ? "default" : "outline"}
                data-testid="rollback-ready"
              >
                {state.rollback.readyToRollback ? "جاهز للرجوع" : "غير جاهز للرجوع"}
              </Badge>
              <Badge variant={state.rollback.supported ? "secondary" : "outline"}>
                {state.rollback.supported ? "مدعوم" : "غير مدعوم"}
              </Badge>
              <Badge variant={state.rollback.confirmed ? "default" : "outline"}>
                {state.rollback.confirmed ? "مؤكَّد" : "غير مؤكَّد"}
              </Badge>
              <Badge variant={state.rollback.codeOnly === false ? "destructive" : "outline"}>
                {state.rollback.codeOnly === false ? "ليس كودًا فقط" : "كود فقط / غير معروف"}
              </Badge>
              <span className="text-xs text-muted-foreground" dir="ltr">
                {state.rollback.mechanism}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{state.rollback.reason}</p>
            {state.rollback.requirements.length > 0 ? (
              <div className="text-xs text-muted-foreground">
                <p className="font-medium">المتطلبات:</p>
                <ul className="list-inside list-disc">
                  {state.rollback.requirements.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {state.rollback.risks.length > 0 ? (
              <div className="text-xs text-muted-foreground">
                <p className="font-medium">المخاطر:</p>
                <ul className="list-inside list-disc">
                  {state.rollback.risks.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* سجل آخر 5 إصدارات */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">آخر 5 إصدارات</CardTitle>
          <CardDescription>أحدث الإصدارات المسجّلة (محاكاة) مع حالتها ومصدرها.</CardDescription>
        </CardHeader>
        <CardContent>
          {state.releases.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">لا توجد إصدارات بعد.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">الإصدار</TableHead>
                    <TableHead className="text-right">البيئة</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-right">ملخص التغيير</TableHead>
                    <TableHead className="text-right">الفحوصات</TableHead>
                    <TableHead className="text-right">المصدر (Git)</TableHead>
                    <TableHead className="text-center">محفوظ في GitHub</TableHead>
                    <TableHead className="text-center">منشور</TableHead>
                    <TableHead className="text-center">إجراء</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.releases.map((release) => (
                    <TableRow key={release.releaseId} data-testid={`release-${release.releaseId}`}>
                      <TableCell className="font-medium" dir="ltr">
                        {release.version}
                      </TableCell>
                      <TableCell>
                        <Badge variant={release.environment === "TEST" ? "secondary" : "destructive"}>
                          {release.environment}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_BADGE[release.status] as never}>
                          {statusLabel(state, release.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[16rem] text-xs text-muted-foreground">
                        {release.changeSummary || "—"}
                      </TableCell>
                      <TableCell className="max-w-[14rem] text-xs">
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(release.checks).map(([key, value]) => (
                            <span key={key} dir="ltr" className="text-[10px]">
                              {key}: {value}
                            </span>
                          ))}
                        </div>
                        {release.checkRunAt ? (
                          <p className="mt-0.5 text-[10px] text-muted-foreground" dir="ltr">
                            ranAt: {release.checkRunAt}
                          </p>
                        ) : null}
                        {release.checkNotes?.secretScan && !release.deployed ? (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            {release.checkNotes.secretScan}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                          <code dir="ltr">{release.gitShortSha ?? release.gitCommit}</code>
                          <span dir="ltr">{release.gitBranch}</span>
                          {release.gitTag ? <code dir="ltr">{release.gitTag}</code> : null}
                          {release.worktree ? (
                            <span dir="rtl">
                              شجرة العمل:{" "}
                              {release.worktree === "dirty"
                                ? "غير نظيفة"
                                : release.worktree === "clean"
                                  ? "نظيفة"
                                  : "غير معروفة"}
                            </span>
                          ) : null}
                          {release.github ? (
                            <span dir="rtl">
                              GitHub:{" "}
                              {release.github.match === "match"
                                ? "مطابق"
                                : release.github.match === "mismatch"
                                  ? "غير مطابق"
                                  : "غير متاح"}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {release.savedToGit ? "نعم" : "لا"}
                      </TableCell>
                      <TableCell className="text-center">
                        {release.deployed ? (
                          release.simulated ? (
                            "نعم (محاكاة)"
                          ) : (
                            <div className="flex flex-col gap-0.5 text-xs">
                              <span>نعم (حقيقي)</span>
                              <span dir="ltr" className="text-[10px] text-muted-foreground">
                                {release.deployTarget}
                              </span>
                              {release.deployRef ? (
                                <span dir="ltr" className="text-[10px] text-muted-foreground">
                                  {release.deployRef}
                                </span>
                              ) : null}
                              {release.postDeploy ? (
                                <span
                                  dir="ltr"
                                  className="text-[10px] text-muted-foreground"
                                  data-testid={`postdeploy-${release.releaseId}`}
                                >
                                  verify: {release.postDeploy.ok ? "ok" : "failed"}
                                </span>
                              ) : null}
                            </div>
                          )
                        ) : (
                          "لا"
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRestore(release)}
                          disabled={previewMutation.isPending || restoreMutation.isPending}
                          data-testid={`restore-${release.releaseId}`}
                        >
                          <RotateCcw className="ml-1 h-4 w-4" />
                          استعادة فعلية
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* حالات النشر */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">حالات النشر والاستعادة والتحقق</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {state.states.map((entry) => (
              <li key={entry.status} className="rounded-lg border border-border p-2 text-sm">
                <Badge variant={STATUS_BADGE[entry.status] as never}>{entry.label}</Badge>
                <p className="mt-1 text-muted-foreground">{entry.description}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* سجل التدقيق */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">سجل التدقيق</CardTitle>
          <CardDescription>كل العمليات الإدارية (بلا أسرار).</CardDescription>
        </CardHeader>
        <CardContent>
          {state.audit.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">لا توجد عمليات بعد.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">الوقت</TableHead>
                    <TableHead className="text-right">الإجراء</TableHead>
                    <TableHead className="text-right">البيئة</TableHead>
                    <TableHead className="text-right">النتيجة</TableHead>
                    <TableHead className="text-right">السبب/المرجع</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.audit.map((entry) => (
                    <TableRow key={entry.id} data-testid={`audit-${entry.action}`}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground" dir="ltr">
                        {entry.at}
                      </TableCell>
                      <TableCell dir="ltr">{entry.action}</TableCell>
                      <TableCell>
                        <Badge variant={entry.environment === "TEST" ? "secondary" : "destructive"}>
                          {entry.environment}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={entry.result === "ok" ? "default" : "destructive"}>
                          {entry.result === "ok" ? "نجاح" : "مرفوض"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {releaseOrReason(releaseReason(state, entry))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function releaseReason(_state: DeployState, entry: DeployAuditEntry): string {
  const parts: string[] = [];
  if (entry.releaseId) parts.push(entry.releaseId);
  if (entry.reason) parts.push(entry.reason);
  return parts.join(" — ");
}

function releaseOrReason(value: string): string {
  return value || "—";
}
