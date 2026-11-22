"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  OwnerAlert,
  ownerPanelClass,
  ownerPrimaryButtonClass,
  ownerSecondaryButtonClass,
} from "@/components/owner/owner-ui";
import {
  runOwnerManualVerification,
  type OwnerManualVerificationResult,
} from "@/lib/owner-verification";

/**
 * Shared owner verification state.
 *
 * This deliberately reuses the existing, server-authoritative verification
 * action (`POST /api/owner/property/run-verification`). It does not create a
 * second verification mechanism and never treats the button click as success.
 */
export function useOwnerVerification() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<OwnerManualVerificationResult | null>(null);
  const [error, setError] = useState("");
  const [inProgress, setInProgress] = useState(false);

  const verify = useCallback(async () => {
    if (isVerifying) return;
    setIsVerifying(true);
    setError("");
    setInProgress(false);
    try {
      const data = await runOwnerManualVerification();
      setResult(data);
      if (data.verified) {
        toast({
          title: "تم التحقق من العقار",
          description: data.pendingAdminApproval
            ? "تم التحقق من بيانات العقار بنجاح، وبقي اعتماد الإدارة لظهوره للعملاء."
            : "تم التحقق من بيانات العقار بنجاح. يمكنك الآن إدارة البيانات والصور.",
        });
        await queryClient.invalidateQueries({ queryKey: ["/api/owner/property"] });
      }
    } catch (err: any) {
      if (err?.status === 409 || err?.code === "VERIFICATION_IN_PROGRESS") {
        setInProgress(true);
        setError(err?.message || "التحقق قيد المعالجة. انتظر قليلاً ثم حدّث الحالة.");
      } else {
        setError(err?.message || "تعذر إكمال التحقق. حاول مرة أخرى.");
      }
    } finally {
      setIsVerifying(false);
    }
  }, [isVerifying, queryClient, toast]);

  const refreshStatus = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: ["/api/owner/property"] });
    const data = queryClient.getQueryData(["/api/owner/property"]);
    const verified =
      (data as any)?.verificationStatus === "approved" ||
      (data as any)?.verificationStatus === "verified" ||
      (data as any)?.smartVerificationPassed === true;
    if (verified) {
      setInProgress(false);
      setResult({ success: true, verified: true, alreadyVerified: true });
    }
    return verified;
  }, [queryClient]);

  const reset = useCallback(() => {
    setResult(null);
    setError("");
    setInProgress(false);
  }, []);

  return { isVerifying, result, error, inProgress, verify, refreshStatus, reset };
}

export function isOwnerPropertyVerified(property: any): boolean {
  return (
    property?.verificationStatus === "approved" ||
    property?.verificationStatus === "verified" ||
    property?.smartVerificationPassed === true
  );
}

interface OwnerVerificationGateProps {
  property: any;
  /** Human label for the protected page, e.g. «بيانات العقار». */
  pageLabel: string;
  children: ReactNode;
}

/**
 * Blocks owner data/images pages until the existing verification action has
 * actually succeeded. When verification fails because required data/images are
 * missing, it offers a controlled «completion mode» — otherwise the owner could
 * never upload the 3 images the verifier requires (a permanent deadlock).
 */
export function OwnerVerificationGate({
  property,
  pageLabel,
  children,
}: OwnerVerificationGateProps) {
  const { isVerifying, result, error, inProgress, verify, refreshStatus } =
    useOwnerVerification();
  const [allowCompletion, setAllowCompletion] = useState(false);

  if (isOwnerPropertyVerified(property)) {
    return <>{children}</>;
  }

  const missingFields = result?.missingFields || [];

  if (allowCompletion) {
    return (
      <div className="space-y-4">
        <OwnerAlert
          tone="warning"
          icon={<AlertTriangle className="w-5 h-5" />}
          title="وضع استكمال البيانات"
        >
          أكمل الحقول والصور المطلوبة ثم اضغط «إعادة التحقق». لن يُفتح الوصول الكامل
          إلى {pageLabel} قبل نجاح التحقق.
        </OwnerAlert>

        {missingFields.length > 0 && (
          <OwnerAlert tone="info" icon={<Clock className="w-5 h-5" />} title="المطلوب استكماله">
            <ul className="list-disc space-y-1 pr-4">
              {missingFields.map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          </OwnerAlert>
        )}

        {children}

        <div className="sticky bottom-24 z-10 flex flex-col gap-2 rounded-2xl border border-[#e6ddc9] bg-white/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between lg:bottom-6">
          <p className="text-xs text-[#6f685b]">
            بعد حفظ البيانات والصور المطلوبة، أعد التحقق لإكمال الوصول.
          </p>
          <Button
            type="button"
            onClick={verify}
            disabled={isVerifying}
            className={`h-11 ${ownerPrimaryButtonClass}`}
            data-testid="button-reverify"
          >
            {isVerifying ? (
              <>
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                جارٍ التحقق...
              </>
            ) : (
              <>
                <ShieldCheck className="ml-2 h-4 w-4" />
                إعادة التحقق
              </>
            )}
          </Button>
        </div>

        {error && (
          <OwnerAlert tone="danger" icon={<AlertTriangle className="w-5 h-5" />} title="تعذر التحقق">
            {error}
          </OwnerAlert>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl py-6">
      <div className={`${ownerPanelClass} overflow-hidden`}>
        <div className="bg-[#29372f] px-5 py-6 text-white sm:px-6">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-[#f0ddaa]">
            <Lock className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-xl font-bold sm:text-2xl">تحقق من عقارك أولًا</h1>
          <p className="mt-2 text-sm leading-6 text-[#cfd6d0]">
            تمت إضافة عقارك بنجاح. لإتاحة إدارة بيانات العقار والصور، يجب إكمال خطوة
            التحقق أولًا. تساعد هذه الخطوة على التأكد من صحة بيانات العقار وربطها
            بالعقار الصحيح.
          </p>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          <p className="rounded-xl border border-[#e2d3a6] bg-[#fdf6e3] p-3 text-xs leading-6 text-[#80621d]">
            لن تتمكن من فتح {pageLabel} أو إدارة صوره حتى إكمال إجراء التحقق المطلوب.
          </p>

          {(property?.verificationStatus === "rejected" ||
            property?.verificationStatus === "incomplete") && (
            <OwnerAlert
              tone="danger"
              icon={<AlertTriangle className="w-5 h-5" />}
              title={
                property?.verificationStatus === "rejected"
                  ? "تم رفض اعتماد العقار"
                  : "بيانات العقار غير مكتملة"
              }
            >
              {property?.verificationStatus === "rejected"
                ? "راجع بيانات العقار وحدّثها ثم أعد التحقق."
                : "أكمل الحقول والصور المطلوبة ثم أعد التحقق."}
            </OwnerAlert>
          )}

          {error && (
            <OwnerAlert
              tone={inProgress ? "info" : "danger"}
              icon={
                inProgress ? <Clock className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />
              }
              title={inProgress ? "التحقق قيد المعالجة" : "تعذر التحقق"}
            >
              {error}
              {inProgress && (
                <div className="mt-3">
                  <Button
                    type="button"
                    variant="outline"
                    className={ownerSecondaryButtonClass}
                    onClick={refreshStatus}
                    data-testid="button-refresh-verification"
                  >
                    تحديث الحالة
                  </Button>
                </div>
              )}
            </OwnerAlert>
          )}

          {missingFields.length > 0 && (
            <OwnerAlert
              tone="warning"
              icon={<AlertTriangle className="w-5 h-5" />}
              title="بيانات العقار تحتاج إلى استكمال"
            >
              <ul className="list-disc space-y-1 pr-4">
                {missingFields.map((field) => (
                  <li key={field}>{field}</li>
                ))}
              </ul>
              <div className="mt-3">
                <Button
                  type="button"
                  className={`h-11 w-full sm:w-auto ${ownerPrimaryButtonClass}`}
                  onClick={() => setAllowCompletion(true)}
                  data-testid="button-complete-required-data"
                >
                  استكمال البيانات المطلوبة
                </Button>
              </div>
            </OwnerAlert>
          )}

          {result?.verified && (
            <OwnerAlert
              tone="success"
              icon={<CheckCircle2 className="w-5 h-5" />}
              title="تم التحقق من العقار"
            >
              {result.pendingAdminApproval
                ? "تم التحقق من بيانات العقار بنجاح، وبقي اعتماد الإدارة لظهوره للعملاء."
                : "تم التحقق من بيانات العقار بنجاح. يمكنك الآن إدارة البيانات والصور."}
            </OwnerAlert>
          )}

          {!result?.verified && (
            <Button
              type="button"
              onClick={verify}
              disabled={isVerifying || inProgress}
              className={`h-12 w-full ${ownerPrimaryButtonClass}`}
              data-testid="button-run-verification"
            >
              {isVerifying ? (
                <>
                  <Loader2 className="ml-2 h-5 w-5 animate-spin" />
                  جارٍ التحقق...
                </>
              ) : inProgress ? (
                <>
                  <Clock className="ml-2 h-5 w-5" />
                  التحقق قيد المعالجة
                </>
              ) : (
                <>
                  <ShieldCheck className="ml-2 h-5 w-5" />
                  التحقق من العقار
                </>
              )}
            </Button>
          )}

          <p className="text-center text-[11px] leading-5 text-[#9c9382]">
            يعتمد نجاح التحقق على نتيجة النظام الفعلية، وليس على الضغط على الزر.
          </p>
        </div>
      </div>
    </div>
  );
}
