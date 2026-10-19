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

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { UploadCloud, RotateCcw, Loader2, X } from "lucide-react";
import {
  DEPLOY_STATE_DESCRIPTORS,
  isFullGitSha,
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

export function DeployBar() {
  const { toast } = useToast();
  // MUST come from the provider: the app is wrapped by QueryProvider, whose
  // client is NOT the singleton in @/lib/queryClient. Invalidating the wrong
  // client silently no-ops and the bar never reflects a real switch.
  const queryClient = useQueryClient();
  const isDevelopment = process.env.NODE_ENV === "development";
  const [open, setOpen] = useState(false);

  const { data } = useQuery<{ prototypeVersion: string; state: DeployState }>({
    queryKey: ["/api/admin/deploy/state"],
    enabled: isDevelopment,
  });

  const state = data?.state;
  const visible = Boolean(state);

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
    onError: () => {
      // Brief, non-technical failure: never surface server/credential internals.
      toast({
        title: "تعذّر النشر",
        description: "لم يكتمل النشر. تحقّق من الاتصال وحاول مرة أخرى.",
        variant: "destructive",
      });
    },
  });

  const handlePublish = () => {
    if (!state) return;
    if (!state.realDeployEnabled) {
      publishMutation.mutate(false);
      return;
    }
    const target = state.deployTarget;
    // LIVE publishes to production and needs a SECOND server-side opt-in; without
    // it the executor fails closed, so refuse before asking for confirmation.
    if (state.environment === "LIVE") {
      if (!state.productionDeployEnabled) {
        toast({
          title: "النشر إلى الإنتاج مُعطَّل",
          description:
            "يتطلب تفعيلًا صريحًا منفصلًا على الخادم (DEPLOY_ALLOW_PRODUCTION=enabled).",
          variant: "destructive",
        });
        return;
      }
      const confirmed = window.confirm(
        "نشر حقيقي إلى بيئة الإنتاج (rwqan.sa)؟\n\n" +
          `المشروع: ${target?.projectId ?? "rwqan-757"}\n` +
          `الخدمة: ${target?.backendId ?? "rwqan-backend"}\n\n` +
          "سيُنشأ rollout من الـcommit الحالي، ولن يُسجَّل الإصدار كمنشور إلا بعد إثبات هوية مصدر البناء ونجاح فحص ما بعد النشر.",
      );
      if (!confirmed) return;
      publishMutation.mutate(true);
      return;
    }
    const confirmed = window.confirm(
      "نشر حقيقي إلى بيئة التطوير المعزولة؟\n\n" +
        `المشروع: ${target?.projectId ?? "rwqan-sa-dev"}\n` +
        `الخدمة: ${target?.backendId ?? "rwqan-dev-backend"}\n\n` +
        "لن يتم أي اتصال بالإنتاج. يُسجَّل الإصدار كمنشور فقط بعد نجاح التحقق بعد النشر.",
    );
    if (!confirmed) return;
    publishMutation.mutate(true);
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
            : "البيئة النشطة: TEST — موارد التطوير المعزولة (rwqan-sa-dev) فقط.",
      });
    },
    onError: (_error: Error, target: DataEnvironment) => {
      // Brief, non-technical failure only: never surface server/credential
      // internals. The environment is NOT changed locally, so the previous one
      // stays active and the control never sticks in a loading state.
      toast({
        title: target === "LIVE" ? "تعذّر تفعيل LIVE" : "تعذّر التبديل إلى TEST",
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

          <div
            dir="ltr"
            role="group"
            aria-label="البيئة"
            data-testid="deploy-bar-environment"
            className="flex shrink-0 items-stretch overflow-hidden rounded-md border border-amber-300 text-xs font-semibold"
          >
            {/* PERMANENT two-option switch: BOTH environments are always shown and
                the active one is highlighted. Selecting the OTHER option performs
                the real switch. Never a single button whose text changes. */}
            {(["LIVE", "TEST"] as const).map((option) => {
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
                        : "bg-amber-600 text-white"
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
          className="fixed left-2 right-2 top-[40px] z-[100] max-h-[70vh] overflow-y-auto rounded-b-lg border border-amber-300 bg-white p-3 shadow-xl sm:left-auto sm:right-3 sm:w-[460px]"
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
              ? `النشر الحقيقي مُفعَّل نحو: ${state.deployTarget?.projectId ?? "rwqan-sa-dev"} — ولا يُسجَّل الإصدار كمنشور إلا بعد نجاح التحقق بعد النشر. `
              : "مسار النشر مُعطَّل حتى تُضبط بيانات الاعتماد صراحةً. "}
            الاستعادة تنفّذ rollout حقيقيًا من الـcommit الثابت بعد التحقق من المصدر والوصول.
          </p>
        </div>
      )}
    </>
  );
}

export default DeployBar;
