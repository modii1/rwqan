"use client";
/**
 * RWQAN DEPLOY — global development-only deploy bar (Phase B, extended).
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
 * requireAdmin + DEV gate). Everything here is a SIMULATION.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Rocket,
  UploadCloud,
  RotateCcw,
  Layers,
  Loader2,
  X,
  GitBranch,
  ClipboardCheck,
} from "lucide-react";
import {
  DEPLOY_STATE_DESCRIPTORS,
  type DeployEnvironment,
  type DeployRelease,
  type DeployReleaseStatus,
  type DeployRestorePreview,
  type DeployRestoreResult,
  type DeployState,
} from "@shared/deploySystem";
import type { DataEnvironment, LiveDataStatus } from "@shared/liveData";

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

function isRestorable(release: DeployRelease): boolean {
  return (
    release.environment !== "LIVE" &&
    Boolean(release.gitCommit) &&
    !NON_RESTORABLE.includes(release.status)
  );
}

export function DeployBar() {
  const { toast } = useToast();
  const isDevelopment = process.env.NODE_ENV === "development";
  const [open, setOpen] = useState(false);

  const { data } = useQuery<{ prototypeVersion: string; state: DeployState }>({
    queryKey: ["/api/admin/deploy/state"],
    enabled: isDevelopment,
  });

  const state = data?.state;
  const visible = Boolean(state);
  const environment: DeployEnvironment = state?.environment ?? "TEST";

  // Data-environment toggle (TEST/LIVE). This switches the WHOLE application's
  // data sources and services between the isolated DEV project and real
  // production. It never publishes code or enables payments. LIVE defaults to
  // read-only; writes are rejected unless LIVE_WRITE_MODE=enabled.
  const { data: liveDataStatus } = useQuery<{ status: LiveDataStatus }>({
    queryKey: ["/api/admin/live/status"],
    enabled: isDevelopment,
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

  const publishMutation = useMutation({
    mutationFn: async (approval: boolean) => {
      const res = await apiRequest("POST", "/api/admin/deploy/releases", {
        approve: approval,
      });
      return res.json() as Promise<{ release?: DeployRelease }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deploy/state"] });
      const release = result.release;
      const realDeployed = Boolean(release?.deployed && !release?.simulated);
      toast({
        title: realDeployed ? "نُشر فعليًا إلى DEV" : "نشر تجريبي (محاكاة)",
        description: realDeployed
          ? `تحقّق ما بعد النشر: ${release?.postDeploy?.ok ? "ناجح" : "غير مؤكَّد"}`
          : "تم توليد إصدار تجريبي — لم يُنفَّذ أي نشر فعلي.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "تعذّر النشر التجريبي",
        description: error.message,
        variant: "destructive",
      });
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
      const restore = (result as { restore?: DeployRestoreResult }).restore;
      toast({
        title: restore ? "استعادة فعلية معزولة" : "استعادة الإصدار",
        description: restore
          ? `${restore.detail} (${restore.fileCount} ملفًا، التحقق: ${
              restore.verified ? "ناجح" : "غير مؤكَّد"
            })`
          : "اكتملت عملية الاستعادة.",
      });
    },
    onError: (error: Error) => {
      let reason = error.message;
      try {
        const parsed = JSON.parse(error.message.replace(/^\d+:\s*/, "")) as {
          restore?: { error?: string | null };
          error?: string;
        };
        if (parsed.restore?.error) reason = parsed.restore.error;
        else if (parsed.error) reason = parsed.error;
      } catch {
        // Keep the raw message if it is not the expected JSON envelope.
      }
      toast({
        title: "تعذّرت الاستعادة",
        description: reason,
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
          "سيُعاد بناء ملفات الإصدار من الـSHA داخل مجلد معزول مع تقليم الأسرار والتحقق من المطابقة. لا commit ولا push ولا checkout ولا deploy، ولن تُمسّ ملفات العمل الحالية.",
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

  const dataEnvironmentMutation = useMutation({
    mutationFn: async (environment: DataEnvironment) => {
      const res = await apiRequest("POST", "/api/admin/live/environment", {
        environment,
      });
      return res.json();
    },
    onSuccess: (_result, environment) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/live/status"] });
      toast({
        title: "تم تبديل بيئة البيانات",
        description:
          environment === "LIVE"
            ? "البيئة النشطة: LIVE — التطبيق يعمل على بيانات وخدمات الإنتاج الحقيقية."
            : "البيئة النشطة: TEST — موارد التطوير المعزولة فقط.",
      });
    },
    onError: (error: Error) => {
      // apiRequest throws `"<status>: <json body>"`. Surface the server's real
      // reason (e.g. the exact missing LIVE_* requirement) instead of a raw
      // JSON string, and never leave the control in a stuck loading state.
      let reason = error.message;
      try {
        const parsed = JSON.parse(error.message.replace(/^\d+:\s*/, "")) as {
          reason?: string;
          error?: string;
        };
        if (parsed.reason) reason = parsed.reason;
        else if (parsed.error) reason = parsed.error;
      } catch {
        // Keep the raw message if it is not the expected JSON envelope.
      }
      toast({
        title: "تعذّر تفعيل LIVE",
        description: reason,
        variant: "destructive",
      });
    },
  });

  const checksMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/deploy/checks", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/deploy/state"] });
      toast({
        title: "تم تشغيل فحوصات الإصدار",
        description: "شُغِّلت فحوص TypeScript وفحص الأسرار محليًا (للقراءة فقط) وسُجِّلت النتائج.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "تعذّر تشغيل الفحوصات",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleRestore = (release: DeployRelease) => {
    // Preview first (read-only), then confirm on the preview result.
    previewMutation.mutate(release.releaseId);
  };

  if (!visible || !state) return null;

  return (
    <>
      <div
        role="region"
        aria-label="شريط نشر RWQAN DEPLOY (تجريبي)"
        data-testid="deploy-bar"
        dir="rtl"
        className="fixed inset-x-0 top-0 z-[100] box-border border-b border-amber-300 bg-amber-50/95 text-amber-950 backdrop-blur supports-[backdrop-filter]:bg-amber-50/85"
        style={{ height: DEPLOY_BAR_HEIGHT_PX }}
      >
        <div className="mx-auto flex h-full max-w-7xl items-center gap-2 overflow-x-auto px-2 sm:gap-3 sm:px-4">
          <span className="flex shrink-0 items-center gap-1.5 text-sm font-bold">
            <Rocket className="h-4 w-4 text-amber-700" aria-hidden="true" />
            RWQAN DEPLOY
            <span className="hidden text-[10px] font-medium text-amber-700 md:inline">
              (تجريبي)
            </span>
          </span>

          <Badge
            variant={environment === "TEST" ? "secondary" : "destructive"}
            data-testid="deploy-bar-environment"
            className="shrink-0"
          >
            {environment === "TEST" ? "بيئة النشر: TEST" : "بيئة النشر: LIVE"}
          </Badge>

          {dataEnvironment ? (
            <div
              className="flex shrink-0 items-center gap-2"
              data-testid="deploy-bar-data-environment"
            >
              <span className="hidden text-[10px] font-medium text-amber-700 lg:inline">
                بيئة البيانات:
              </span>
              <div
                className="flex items-center overflow-hidden rounded-md border border-amber-300 bg-white/70"
                dir="ltr"
              >
                <button
                  type="button"
                  onClick={() => dataEnvironmentMutation.mutate("TEST")}
                  disabled={dataEnvironmentMutation.isPending}
                  data-testid="deploy-bar-data-test"
                  className={`h-7 px-3 text-xs font-medium transition-colors ${
                    dataEnvironment.environment === "TEST"
                      ? "bg-amber-600 text-white"
                      : "text-amber-800 hover:bg-amber-100"
                  }`}
                >
                  TEST
                </button>
                <span className="h-4 w-px bg-amber-300" aria-hidden="true" />
                <button
                  type="button"
                  onClick={() => dataEnvironmentMutation.mutate("LIVE")}
                  disabled={
                    dataEnvironmentMutation.isPending ||
                    !dataEnvironment.liveAvailable
                  }
                  title={
                    dataEnvironment.liveAvailable
                      ? dataEnvironment.writeBlocked
                        ? "LIVE قراءة فقط — الكتابة والتعديل والحذف محظورة"
                        : "LIVE — الكتابة على الإنتاج مُفعّلة"
                      : dataEnvironment.liveUnavailableReason
                  }
                  data-testid="deploy-bar-data-live"
                  className={`h-7 px-3 text-xs font-medium transition-colors ${
                    dataEnvironment.environment === "LIVE"
                      ? "bg-red-600 text-white"
                      : "text-amber-800 hover:bg-amber-100"
                  }`}
                >
                  LIVE
                </button>
              </div>
              <span
                className="hidden max-w-[180px] truncate text-[10px] font-medium text-amber-700 xl:inline"
                dir="ltr"
                title={
                  dataEnvironment.activeProjectId ??
                  dataEnvironment.dataSources.properties
                }
              >
                {dataEnvironment.activeProjectId ??
                  dataEnvironment.dataSources.properties}
              </span>
            </div>
          ) : null}

          {state.git ? (
            <span
              className="hidden shrink-0 items-center gap-1 text-[11px] text-amber-700 lg:flex"
              dir="ltr"
              data-testid="deploy-bar-git"
            >
              <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
              {state.git.shortSha ?? "—"}
              <span className={state.git.worktree === "dirty" ? "text-red-600" : ""}>
                {state.git.worktree}
              </span>
              {state.github ? (
                <span className="text-amber-600">· GitHub: {state.github.match}</span>
              ) : null}
            </span>
          ) : null}

          {state.stableBaseline ? (
            <Badge
              variant={
                state.stableBaseline.confidence === "verified"
                  ? "default"
                  : state.stableBaseline.confidence === "partially_verified"
                    ? "secondary"
                    : "outline"
              }
              className="shrink-0 text-[10px]"
              data-testid="deploy-bar-baseline"
            >
              {state.stableBaseline.site}{" "}
              {state.stableBaseline.confidence === "verified"
                ? "· أساس مؤكَّد"
                : state.stableBaseline.confidence === "partially_verified"
                  ? "· أساس جزئي"
                  : "· أساس غير مُثبَت"}
            </Badge>
          ) : null}

          {state.rollback ? (
            <Badge
              variant={state.rollback.readyToRollback ? "default" : "outline"}
              className="shrink-0 text-[10px]"
              data-testid="deploy-bar-rollback"
            >
              {state.rollback.readyToRollback ? "الرجوع: جاهز" : "الرجوع: غير جاهز"}
            </Badge>
          ) : null}

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
            {state.realDeployEnabled ? "نشر DEV" : "نشر"}
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => checksMutation.mutate()}
            disabled={checksMutation.isPending}
            data-testid="deploy-bar-checks"
          >
            {checksMutation.isPending ? (
              <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ClipboardCheck className="ml-1 h-3.5 w-3.5" />
            )}
            فحوصات
          </Button>

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

          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 px-2 text-xs"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            data-testid="deploy-bar-versions"
          >
            <Layers className="ml-1 h-3.5 w-3.5" />
            الإصدارات
          </Button>

          <span
            className="hidden shrink-0 text-[11px] text-amber-700 md:inline"
            dir="ltr"
          >
            {data?.prototypeVersion}
          </span>

          <span className="hidden shrink-0 text-[11px] text-amber-700 lg:inline">
            {dataEnvironment?.environment === "LIVE"
              ? "بيئة البيانات: LIVE (قراءة فقط من الإنتاج)"
              : "بيئة البيانات: TEST — موارد التطوير المعزولة"}
          </span>
        </div>
      </div>

      {open && (
        <div
          data-testid="deploy-bar-panel"
          dir="rtl"
          className="fixed left-2 right-2 top-[40px] z-[100] max-h-[70vh] overflow-y-auto rounded-b-lg border border-amber-300 bg-white p-3 shadow-xl sm:left-auto sm:right-3 sm:w-[460px]"
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold text-amber-950">
              الإصدارات والاستعادة (محاكاة)
            </h3>
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

          <ul className="space-y-1.5">
            {state.releases.length === 0 ? (
              <li
                data-testid="deploy-bar-empty"
                className="rounded-md border border-dashed border-amber-300 p-3 text-center text-xs text-muted-foreground"
              >
                لا توجد إصدارات محفوظة بعد.
              </li>
            ) : (
              state.releases.map((release) => (
              <li
                key={release.releaseId}
                data-testid={`deploy-bar-release-${release.releaseId}`}
                className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50/50 p-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium" dir="ltr">
                      {release.version}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {STATUS_LABEL[release.status]}
                    </Badge>
                    <Badge
                      variant={
                        release.environment === "TEST" ? "secondary" : "destructive"
                      }
                      className="text-[10px]"
                    >
                      {release.environment}
                    </Badge>
                  </div>
                  <div
                    className="mt-0.5 truncate text-[10px] text-muted-foreground"
                    dir="ltr"
                  >
                    {release.gitShortSha ?? release.gitCommit} · {release.gitBranch}
                    {release.worktree ? ` · ${release.worktree}` : ""}
                    {release.github ? ` · GitHub:${release.github.match}` : ""}
                    {release.savedToGit ? " · git" : ""}
                    {release.deployed
                      ? release.simulated
                        ? " · deployed(sim)"
                        : ` · deployed:${release.deployTarget}${
                            release.postDeploy
                              ? release.postDeploy.ok
                                ? " verify:ok"
                                : " verify:failed"
                              : ""
                          }`
                      : ""}
                  </div>
                  {release.checkRunAt ? (
                    <div
                      className="mt-0.5 truncate text-[10px] text-muted-foreground"
                      dir="ltr"
                    >
                      checks: {release.checkRunAt}
                    </div>
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

          {state.latestCheckRun ? (
            <p
              className="mt-2 text-[11px] text-muted-foreground"
              dir="ltr"
              data-testid="deploy-bar-latest-checkrun"
            >
              آخر فحوصات: {state.latestCheckRun.ranAt} — tsc:{" "}
              {state.latestCheckRun.checks.typescript}
            </p>
          ) : null}

          {state.stableBaseline ? (
            <div
              className="mt-2 rounded-md border border-amber-200 bg-amber-50/50 p-2 text-[11px] text-muted-foreground"
              data-testid="deploy-bar-baseline-panel"
            >
              <p>
                النسخة المستقرة المرجعية:{" "}
                <span dir="ltr">{state.stableBaseline.site}</span> — الثقة:{" "}
                {state.stableBaseline.confidence === "verified"
                  ? "مؤكَّدة"
                  : state.stableBaseline.confidence === "partially_verified"
                    ? "جزئية"
                    : "غير معروفة"}
              </p>
              <p dir="ltr">
                published:{" "}
                {state.stableBaseline.publishedSha ??
                  state.stableBaseline.publishedVersionId ??
                  "unproven"}{" "}
                · head: {state.stableBaseline.localHeadSha ?? "—"} ·{" "}
                {state.stableBaseline.headMatchesBaseline === true
                  ? "match"
                  : state.stableBaseline.headMatchesBaseline === false
                    ? "mismatch"
                    : "undetermined"}
              </p>
              {state.rollback ? (
                <p>
                  الرجوع:{" "}
                  {state.rollback.readyToRollback
                    ? "جاهز"
                    : state.rollback.supported
                      ? "مدعوم لكن غير مؤكَّد"
                      : "غير مدعوم"}{" "}
                  — {state.rollback.reason}
                </p>
              ) : null}
            </div>
          ) : null}

          <p className="mt-2 text-[11px] text-muted-foreground">
            {state.realDeployEnabled
              ? `النشر الحقيقي مُفعَّل نحو هدف DEV المعزول: ${state.deployTarget?.projectId ?? "rwqan-sa-dev"} — بلا أي اتصال بالإنتاج، ولا يُعدّ الإصدار منشورًا إلا بعد نجاح التحقق بعد النشر. `
              : "النشر لا يزال محاكاة (بلا commit/push/deploy). "}
            الاستعادة أصبحت فعلية ومعزولة: تُعيد بناء ملفات الإصدار من الـSHA داخل مجلد
            منفصل مع تقليم الأسرار والتحقق، دون المساس بملفات العمل.
          </p>
        </div>
      )}
    </>
  );
}

export default DeployBar;
