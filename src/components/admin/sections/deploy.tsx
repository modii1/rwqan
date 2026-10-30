"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Rocket,
  UploadCloud,
  RotateCcw,
  Loader2,
  ShieldAlert,
  Anchor,
} from "lucide-react";

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
  status: "success";
  real: boolean;
  verified: boolean;
  target: string | null;
  releaseRef: string | null;
  detail: string;
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
  /** TRUE only for the verified official stable release (production reference). */
  stableBaseline?: boolean;
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
  /** ONLY the real, verified stable release(s); prototype/failed are excluded. */
  stableReleases?: DeployRelease[];
  audit: DeployAuditEntry[];
  states: DeployStateDescriptor[];
  git: DeployGitInfo | null;
  github: DeployGitHubInfo | null;
  latestCheckRun: DeployCheckRun | null;
  deployTarget?: { projectId: string; backendId: string; baseUrl: string | null };
  realDeployEnabled?: boolean;
  productionDeployEnabled?: boolean;
  stableBaseline?: DeployStableBaseline;
  rollback?: DeployRollbackReadiness;
}

interface DeployStateResponse {
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

function confidenceLabel(confidence: DeployConfidence): string {
  return confidence === "verified"
    ? "مؤكَّدة"
    : confidence === "partially_verified"
      ? "جزئية"
      : "غير معروفة";
}

export default function DeploySection() {
  const { toast } = useToast();
  // From the provider, not the disconnected singleton in @/lib/queryClient.
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<DeployStateResponse>({
    queryKey: ["/api/admin/deploy/state"],
  });
  const state = data?.state;

  const environmentMutation = useMutation({
    mutationFn: async (environment: DeployEnvironment) => {
      // ONE selection must move BOTH the real data sources and the deploy
      // target, so the app data and the publish/restore target never drift.
      await apiRequest("POST", "/api/admin/live/environment", { environment });
      await apiRequest("POST", "/api/admin/deploy/environment", { environment });
      return environment;
    },
    onSuccess: (_result, environment) => {
      // The switch changes the WHOLE app's data source, so refetch everything.
      queryClient.invalidateQueries();
      toast({
        title: "تم تبديل البيئة",
        description:
          environment === "LIVE"
            ? "البيئة النشطة الآن: LIVE (بيانات الإنتاج الحقيقية)."
            : "البيئة النشطة الآن: TEST (موارد DEV المعزولة).",
      });
    },
    onError: (_error: Error, environment) => {
      // Brief, non-technical failure only.
      toast({
        title:
          environment === "LIVE" ? "تعذّر تفعيل LIVE" : "تعذّر التبديل إلى TEST",
        description: "تعذّر الاتصال بالبيئة المطلوبة. حاول مرة أخرى.",
        variant: "destructive",
      });
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
        code?: string;
        detail?: string;
        actionsUrl?: string;
      };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deploy/state"] });
      if (result.code === "DEPLOY_GITHUB_DISPATCH_ACCEPTED") {
        // The TEST publish was SENT to GitHub (workflow_dispatch) — GitHub
        // creates the rollout, so this is deliberately NOT a deploy-success
        // toast; success is proven only in GitHub Actions.
        toast({
          title: "أُرسل طلب النشر إلى GitHub",
          description: result.actionsUrl
            ? `${result.detail ?? "النشر يُدار من GitHub Actions."} المتابعة: ${result.actionsUrl}`
            : result.detail ?? "النشر يُدار من GitHub Actions.",
        });
        return;
      }
      const release = result.release;
      const failed = release?.status === "validation_failed";
      const realDeployed = Boolean(release?.deployed && !release?.simulated);
      toast({
        title: realDeployed
          ? "نُشر فعليًا وتحقّق منه"
          : failed
            ? "فشل فحص إلزامي — سُجِّل الإصدار كفاشل"
            : "لم يُسجَّل أي نشر",
        description: realDeployed
          ? "اكتمل النشر ونجح التحقق بعد النشر."
          : "لم يُنفَّذ أي نشر فعلي؛ لم يُسجَّل إصدار منشور.",
        variant: failed ? "destructive" : "default",
      });
    },
    onError: (error: Error) => {
      // Surface the server's own Arabic reason (single source of truth for the
      // failure text), falling back to a brief non-technical message only when
      // the server response cannot be read.
      let description = "لم يكتمل النشر. تحقّق من الاتصال وحاول مرة أخرى.";
      try {
        const match = error.message.match(/^(\d{3}):\s*(.*)$/s);
        if (match) {
          const body = JSON.parse(match[2]) as { error?: string };
          if (typeof body.error === "string" && body.error.length > 0) {
            description = body.error;
          }
        }
      } catch {
        // Keep the generic fallback description.
      }
      toast({
        title: "تعذّر النشر",
        description,
        variant: "destructive",
      });
    },
  });

  const handlePublish = () => {
    if (state?.realDeployEnabled) {
      const target = state.deployTarget;
      const toProduction =
        state.environment === "LIVE" && state.productionDeployEnabled === true;
      const confirmed = window.confirm(
        (toProduction
          ? "نشر حقيقي إلى الإنتاج؟\n\n"
          : "نشر حقيقي إلى بيئة التطوير المعزولة؟\n\n") +
          `المشروع: ${target?.projectId ?? "rwqan-sa-dev"}\n` +
          `الخدمة: ${target?.backendId ?? "—"}\n\n` +
          (toProduction
            ? "تحذير: هذا الهدف هو الإنتاج."
            : "لن يتم أي اتصال بالإنتاج.") +
          " يُسجَّل الإصدار كمنشور فقط بعد نجاح التحقق بعد النشر.",
      );
      if (!confirmed) return;
      publishMutation.mutate(true);
      return;
    }
    publishMutation.mutate(false);
  };

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
        title: restore ? "استعادة فعلية" : "استعادة الإصدار",
        description: restore
          ? `${restore.detail} (تحقّق: ${restore.verified ? "ناجح" : "غير مؤكَّد"})`
          : "اكتملت عملية الاستعادة.",
      });
    },
    onError: () => {
      // Brief, non-technical failure only.
      toast({
        title: "تعذّرت الاستعادة",
        description: "لم تكتمل الاستعادة. تحقّق من الاتصال وحاول مرة أخرى.",
        variant: "destructive",
      });
    },
  });

  const previewMutation = useMutation({
    mutationFn: async (releaseId: string) => {
      const res = await apiRequest(
        "POST",
        `/api/admin/deploy/releases/${encodeURIComponent(releaseId)}/restore/preview`,
        {},
      );
      return (await res.json()) as {
        preview?: DeployRestorePreview;
        restoreNotice?: string;
      };
    },
    onSuccess: (result, releaseId) => {
      const preview = result.preview;
      if (!preview) {
        toast({
          title: "تعذّرت المعاينة",
          description: "لم تُرجِع الخدمة معاينة الاستعادة.",
          variant: "destructive",
        });
        return;
      }
      if (!preview.canRestore) {
        // Brief only: the server's blocker codes are technical, not user-facing.
        toast({
          title: "تعذّرت الاستعادة",
          description: "هذه النسخة غير قابلة للاستعادة.",
          variant: "destructive",
        });
        return;
      }
      const confirmed = window.confirm(
        `استعادة النسخة المستقرة ${preview.version}؟\n\n` +
          "استعادة حقيقية (rollout) من الـcommit الثابت على خدمة البيئة النشطة، مع التحقق بعد الاستعادة.",
      );
      if (confirmed) restoreMutation.mutate(releaseId);
    },
    onError: () => {
      // Brief, non-technical failure only.
      toast({
        title: "تعذّرت الاستعادة",
        description: "تعذّر الاتصال. حاول مرة أخرى.",
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
      <div className="flex min-h-[40vh] items-center justify-center" dir="rtl">
        <p className="text-sm text-muted-foreground">
          تعذّر تحميل «إدارة النشر». حدّث الصفحة أو أعد تسجيل الدخول.
        </p>
      </div>
    );
  }

  const environment = state.environment;
  const restoreBusy = previewMutation.isPending || restoreMutation.isPending;

  return (
    <div className="space-y-4" dir="rtl" data-testid="deploy-section">
      {/* العنوان + شارة البيئة الحالية (شارة واحدة فقط) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">إدارة النشر</h2>
        </div>
        <Badge
          variant={environment === "TEST" ? "secondary" : "destructive"}
          data-testid="deploy-environment-badge"
        >
          البيئة الحالية: {environment}
        </Badge>
      </div>

      <Tabs defaultValue="deploy" dir="rtl">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="deploy">نشر</TabsTrigger>
          <TabsTrigger value="environment">تحويل البيئة</TabsTrigger>
          <TabsTrigger value="restore">استعادة</TabsTrigger>
        </TabsList>

        {/* ── تبويب نشر ── */}
        <TabsContent value="deploy" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">نشر</CardTitle>
              <CardDescription>
                النشر ينفّذ فعليًا إلى هدف البيئة المحددة (TEST ← DEV المعزول،
                LIVE ← الإنتاج عند التفعيل). يُسجَّل الإصدار كمنشور فقط بعد نجاح التحقق بعد النشر.
              </CardDescription>
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
                  {state.realDeployEnabled ? "نشر" : "نشر (المسار مُعطَّل)"}
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">{state.persistenceNotice}</p>
            </CardContent>
          </Card>

          {state.realDeployEnabled ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldAlert className="h-4 w-4 text-amber-600" />
                  النشر الحقيقي مُفعَّل
                </CardTitle>
                <CardDescription>
                  {state.environment === "LIVE" && state.productionDeployEnabled
                    ? "الهدف الحالي هو الإنتاج"
                    : "الهدف الحالي DEV المعزول"}
                  {state.deployTarget ? ` (${state.deployTarget.projectId})` : ""}.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}
        </TabsContent>

        {/* ── تبويب تحويل البيئة ── */}
        <TabsContent value="environment" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">تحويل البيئة</CardTitle>
              <CardDescription>{state.environmentNotice}</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Permanent two-option switch: both are always shown, the active
                  one is highlighted, and selecting the other performs the switch. */}
              <div
                dir="ltr"
                role="group"
                aria-label="البيئة"
                className="inline-flex items-stretch overflow-hidden rounded-md border"
                data-testid="button-deploy-environment"
              >
                {(["LIVE", "TEST"] as const).map((option) => {
                  const active = environment === option;
                  return (
                    <Button
                      key={option}
                      type="button"
                      size="sm"
                      variant={active ? "default" : "ghost"}
                      className={`rounded-none ${
                        active && option === "LIVE" ? "bg-red-600 hover:bg-red-700" : ""
                      }`}
                      onClick={() => environmentMutation.mutate(option)}
                      disabled={environmentMutation.isPending || active}
                      aria-pressed={active}
                      data-testid={`deploy-environment-${option.toLowerCase()}`}
                    >
                      {environmentMutation.isPending && active ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : null}
                      {option}
                    </Button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                اضغط الخيار الآخر للتبديل الفعلي بين LIVE و TEST.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── تبويب استعادة ── */}
        <TabsContent value="restore" className="space-y-4">
          {state.stableBaseline ? (
            <Card data-testid="stable-baseline">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Anchor className="h-4 w-4 text-primary" />
                  النسخة المستقرة المرجعية
                </CardTitle>
                <CardDescription>مرجع قراءة فقط؛ لا يُفترض أن HEAD المحلي هو المنشور.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-3 text-sm">
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
                  الثقة: {confidenceLabel(state.stableBaseline.confidence)}
                </Badge>
                <span className="text-muted-foreground">{state.stableBaseline.hostingSource}</span>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">النسخة المستقرة القابلة للاستعادة</CardTitle>
              <CardDescription>
                تُعرض النسخة المستقرة الحقيقية فقط؛ الاستعادة تنفّذ نشرًا حقيقيًا (rollout) من الـcommit الثابت.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(state.stableReleases?.length ?? 0) === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  لا توجد نسخة مستقرة حقيقية بعد.
                </p>
              ) : (
                <ul className="space-y-2">
                  {(state.stableReleases ?? []).map((release) => (
                    <li
                      key={release.releaseId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{release.version}</span>
                        {release.gitShortSha ? (
                          <code
                            dir="ltr"
                            className="font-mono text-xs text-muted-foreground"
                          >
                            {release.gitShortSha}
                          </code>
                        ) : null}
                        {release.stableBaseline ? (
                          <Badge variant="outline">مرجع مستقر</Badge>
                        ) : (
                          <Badge variant={STATUS_BADGE[release.status] as never}>
                            {statusLabel(state, release.status)}
                          </Badge>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRestore(release)}
                        disabled={restoreBusy}
                        data-testid={`restore-${release.releaseId}`}
                      >
                        <RotateCcw className="ml-1 h-4 w-4" />
                        استعادة
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
