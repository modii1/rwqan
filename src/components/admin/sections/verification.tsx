"use client";
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  AdminActionError,
  getAdminActionErrorMessage,
  readAdminActionResponse,
} from "@/lib/admin-action-response";
import {
  buildWhatsAppUrl,
  closeReservedWhatsAppTab,
  navigateReservedWhatsAppTab,
  reserveWhatsAppTab,
  type ReservedWhatsAppTab,
} from "@/lib/whatsapp-navigation";
import { Loader2, PauseCircle, RefreshCw, Search } from "lucide-react";
import { normalizeWhatsAppDestination } from "@shared/phone";
import type { Property } from "@shared/schema";
import {
  isSubscriptionStatusActive,
  isSubscriptionStatusSuspended,
} from "@shared/subscriptionType";
import {
  getFreeCommissionConsentAdminStatus,
  getVerificationStatus,
  type VerificationLevel,
} from "./verification-status";
import { getAdminVerificationRefetchInterval } from "@/lib/workflow-query-refresh";

type FilterType =
  | VerificationLevel
  | "all"
  | "noImages"
  | "pending"
  | "approved"
  | "rejected";

type PropertyActionFailure = {
  action: "approval" | "rejection" | "suspension";
  message: string;
  partial: boolean;
};

type VerificationProperty = Property & {
  subscriptionStatus?: string | null;
  isSubscriptionExpired?: boolean;
};

export default function AdminVerificationSection() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [loadingApprove, setLoadingApprove] = useState<string | null>(null);
  const [loadingReject, setLoadingReject] = useState<string | null>(null);
  const [loadingSuspend, setLoadingSuspend] = useState<string | null>(null);
  // Query refreshes never clear these; only a deliberate retry/success does.
  const [approvalErrors, setApprovalErrors] = useState<
    Record<string, PropertyActionFailure>
  >({});
  const approvalInFlightRef = useRef<string | null>(null);
  const rejectionInFlightRef = useRef<string | null>(null);
  const suspensionInFlightRef = useRef<string | null>(null);
  const { toast } = useToast();

  const {
    data,
    isLoading,
    isError: isPropertiesError,
    refetch,
  } = useQuery<VerificationProperty[]>({
    queryKey: ["/api/admin/properties"],
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchInterval: (query) =>
      getAdminVerificationRefetchInterval(
        query.state.data as VerificationProperty[] | undefined,
      ),
    refetchIntervalInBackground: false,
  });

  // جلب عدد صور R2 لكل عقار
  const {
    data: r2CountsData,
    isLoading: isLoadingR2,
    isError: isR2CountsError,
    refetch: refetchR2Counts,
  } = useQuery<{
    available: boolean;
    counts: Record<string, number>;
  }>({
    queryKey: ["/api/admin/r2-images-count"],
    // R2 listing is intentionally manual-only after the initial load. Property
    // workflow polling must not multiply object-storage list operations.
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });

  const r2Counts = r2CountsData?.counts || {};
  const areR2CountsUnavailable =
    isR2CountsError || r2CountsData?.available === false;

  const handleApprove = async (
    property: VerificationProperty,
    whatsappTab: ReservedWhatsAppTab | null,
    whatsappDestination: string | null,
  ) => {
    const propertyNumber = property.propertyNumber;
    setLoadingApprove(propertyNumber);
    setApprovalErrors((current) => {
      const next = { ...current };
      delete next[propertyNumber];
      return next;
    });

    try {
      try {
        const response = await fetch(
          `/api/admin/properties/${propertyNumber}/approve`,
          { method: "PUT", credentials: "include" },
        );
        await readAdminActionResponse(response, "لم يتم قبول العقار");
      } catch (error) {
        closeReservedWhatsAppTab(whatsappTab);
        const reason = getAdminActionErrorMessage(error, "لم يتم قبول العقار");
        const partial = error instanceof AdminActionError && error.partial;
        setApprovalErrors((current) => ({
          ...current,
          [propertyNumber]: { action: "approval", message: reason, partial },
        }));
        toast({
          title: partial ? "اكتمل القبول جزئياً" : "تعذر قبول العقار",
          description: reason,
          variant: "destructive",
        });
        await refetch();
        return;
      }

      const message = `
شريكنا العزيز،
تم *قبول عقاركم* رقم ${propertyNumber} (${property.name || ""}).

العقار الآن ظاهر للعملاء في منصة روقـان ✔✨
`;
      let whatsappOpened = false;
      if (whatsappTab && whatsappDestination) {
        whatsappOpened = navigateReservedWhatsAppTab(
          whatsappTab,
          buildWhatsAppUrl(whatsappDestination, message),
        );
      }

      toast({
        title: "✔️ تم قبول العقار",
        description: !whatsappDestination
          ? `تم قبول #${propertyNumber}، لكن لا يوجد رقم واتساب صالح للمالك`
          : whatsappOpened
            ? `تم قبول #${propertyNumber} بنجاح وفتح واتساب في علامة جديدة`
            : `تم قبول #${propertyNumber}، لكن المتصفح منع فتح واتساب في علامة جديدة`,
      });
      await refetch();
    } finally {
      approvalInFlightRef.current = null;
      setLoadingApprove(null);
    }
  };

  const startApproval = (property: VerificationProperty) => {
    if (
      approvalInFlightRef.current ||
      rejectionInFlightRef.current ||
      suspensionInFlightRef.current
    ) return;

    approvalInFlightRef.current = property.propertyNumber;
    const whatsappDestination = normalizeWhatsAppDestination(
      property.whatsappNumber,
    );
    const whatsappTab = whatsappDestination ? reserveWhatsAppTab() : null;

    void handleApprove(property, whatsappTab, whatsappDestination);
  };

  const startSuspension = async (property: VerificationProperty) => {
    if (
      approvalInFlightRef.current ||
      rejectionInFlightRef.current ||
      suspensionInFlightRef.current
    ) {
      return;
    }

    const propertyNumber = property.propertyNumber;
    const whatsappDestination = normalizeWhatsAppDestination(
      property.whatsappNumber,
    );
    const whatsappTab = whatsappDestination ? reserveWhatsAppTab() : null;
    suspensionInFlightRef.current = propertyNumber;
    setLoadingSuspend(propertyNumber);
    setApprovalErrors((current) => {
      const next = { ...current };
      delete next[propertyNumber];
      return next;
    });

    try {
      const response = await fetch(
        `/api/admin/subscriptions/${encodeURIComponent(propertyNumber)}/suspend`,
        { method: "POST", credentials: "include" },
      );
      await readAdminActionResponse(
        response,
        "لم يتم إيقاف الاشتراك مؤقتاً",
      );

      const message = `
شريكنا العزيز،
تم *إيقاف اشتراك عقاركم مؤقتاً* رقم ${propertyNumber} (${property.name || ""}) من قبل الإدارة.

خلال فترة الإيقاف لن تصلكم إشعارات الاشتراك، ولن يمكن تشغيل التحقق أو تفعيل الاشتراك حتى تعيد الإدارة استئنافه.

للاستفسار يرجى التواصل مع الإدارة.
`;
      const whatsappOpened = Boolean(
        whatsappTab &&
          whatsappDestination &&
          navigateReservedWhatsAppTab(
            whatsappTab,
            buildWhatsAppUrl(whatsappDestination, message),
          ),
      );

      toast({
        title: "تم إيقاف الاشتراك مؤقتاً",
        description: !whatsappDestination
          ? `تم إيقاف اشتراك #${propertyNumber}، لكن لا يوجد رقم واتساب صالح للمالك`
          : whatsappOpened
            ? `تم الإيقاف وفتح رسالة واتساب للمالك في علامة جديدة`
            : `تم الإيقاف، لكن المتصفح منع فتح واتساب في علامة جديدة`,
      });
      await refetch();
    } catch (error) {
      closeReservedWhatsAppTab(whatsappTab);
      const reason = getAdminActionErrorMessage(
        error,
        "لم يتم إيقاف الاشتراك مؤقتاً",
      );
      const partial = error instanceof AdminActionError && error.partial;
      setApprovalErrors((current) => ({
        ...current,
        [propertyNumber]: {
          action: "suspension",
          message: reason,
          partial,
        },
      }));
      toast({
        title: partial ? "اكتمل الإيقاف جزئياً" : "تعذر إيقاف الاشتراك",
        description: reason,
        variant: "destructive",
      });
      await refetch();
    } finally {
      suspensionInFlightRef.current = null;
      setLoadingSuspend(null);
    }
  };

  const propertiesWithStatus = useMemo(() => {
    if (!data) return [];
    return data.map((p) => {
      const imageCount = areR2CountsUnavailable
        ? null
        : (r2Counts[p.propertyNumber] ?? null);
      return {
        property: p,
        status: getVerificationStatus(p, imageCount),
        freeCommissionConsentStatus: getFreeCommissionConsentAdminStatus(p),
        imageCount,
      };
    });
  }, [areR2CountsUnavailable, data, r2Counts]);

  const filtered = useMemo(() => {
    return propertiesWithStatus.filter(({ property, status, imageCount }) => {
      // فلتر حسب حالة التحقق (pending, approved, rejected)
      if (filter === "pending") {
        const vStatus = property.verificationStatus;
        if (vStatus !== "pending") return false;
      } else if (filter === "approved") {
        const vStatus = property.verificationStatus;
        if (vStatus !== "approved" && vStatus !== "verified") return false;
      } else if (filter === "rejected") {
        const vStatus = property.verificationStatus;
        if (vStatus !== "rejected") return false;
      } else if (filter === "noImages") {
        if (imageCount !== 0) return false;
      } else if (filter !== "all" && status.level !== filter) {
        return false;
      } else if (filter !== "all" && imageCount === null) {
        return false;
      }

      const q = search.trim();
      if (!q) return true;

      const qLower = q.toLowerCase();
      return (
        property.propertyNumber?.toString().includes(q) ||
        property.name?.toLowerCase().includes(qLower) ||
        property.city?.toLowerCase().includes(qLower)
      );
    });
  }, [propertiesWithStatus, search, filter]);

  const stats = useMemo(() => {
    const total = propertiesWithStatus.length;
    const ok = propertiesWithStatus.filter(
      (p) => p.imageCount !== null && p.status.level === "ok",
    ).length;
    const warn = propertiesWithStatus.filter(
      (p) => p.imageCount !== null && p.status.level === "warning",
    ).length;
    const danger = propertiesWithStatus.filter(
      (p) => p.imageCount !== null && p.status.level === "danger",
    ).length;

    const noWhatsapp = propertiesWithStatus.filter(
      (p) => !normalizeWhatsAppDestination(p.property.whatsappNumber),
    ).length;

    const noImages = propertiesWithStatus.filter(
      (p) => p.imageCount === 0,
    ).length;

    // Stats based on verificationStatus
    const pending = propertiesWithStatus.filter(
      (p) => p.property.verificationStatus === "pending",
    ).length;
    const approved = propertiesWithStatus.filter(
      (p) => p.property.verificationStatus === "approved" || p.property.verificationStatus === "verified",
    ).length;
    const rejected = propertiesWithStatus.filter(
      (p) => p.property.verificationStatus === "rejected",
    ).length;

    return { total, ok, warn, danger, noWhatsapp, noImages, pending, approved, rejected };
  }, [propertiesWithStatus]);

  if (isLoading || isLoadingR2) {
    return (
      <div
        className="flex flex-col items-center justify-center h-64 gap-2"
        dir="rtl"
      >
        <Loader2 className="w-6 h-6 animate-spin" />
        <p className="text-sm text-muted-foreground">
          {isLoadingR2 ? "جاري تحميل بيانات الصور..." : "جاري التحميل..."}
        </p>
      </div>
    );
  }

  if (isPropertiesError && !data) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center h-64 gap-3 text-sm text-destructive"
        dir="rtl"
      >
        <p>تعذر تحميل العقارات. تحقق من الاتصال ثم حاول مرة أخرى.</p>
        <Button size="sm" variant="outline" onClick={() => void refetch()}>
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6" dir="rtl">
      {isPropertiesError && data && (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"
        >
          تعذر تحديث قائمة العقارات؛ البيانات الحالية ما زالت معروضة. حاول
          إعادة التحميل بعد التحقق من الاتصال.
        </div>
      )}
      {areR2CountsUnavailable && (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"
        >
          تعذر تحميل عدد الصور من التخزين حالياً؛ لن تُعرض العقارات على أنها بلا
          صور حتى تنجح إعادة المحاولة.
        </div>
      )}
      {/* 📊 الإحصائيات */}
      <Card className="p-4">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-bold text-xl">نظام التحقق من بيانات العقار</h2>

          <div className="flex items-center gap-2">
            {/* زر سجل التحقق */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                (window.location.href = "/admin/verification-logs")
              }
              className="flex items-center gap-1 bg-yellow-600 hover:bg-yellow-700 text-white"
            >
              📄 سجل التحقق
            </Button>

            {/* زر تحديث */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void refetch();
                void refetchR2Counts();
              }}
              className="flex items-center gap-1"
            >
              <RefreshCw className="w-4 h-4" />
              تحديث
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-9 gap-3 text-center">
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">إجمالي العقارات</p>
            <p className="font-bold text-lg">{stats.total}</p>
          </Card>

          <Card className="p-3">
            <p className="text-xs text-muted-foreground">مكتملة</p>
            <p className="font-bold text-lg text-green-600">{stats.ok}</p>
          </Card>

          <Card className="p-3">
            <p className="text-xs text-muted-foreground">تحتاج بيانات</p>
            <p className="font-bold text-lg text-yellow-600">{stats.warn}</p>
          </Card>

          <Card className="p-3">
            <p className="text-xs text-muted-foreground">مراجعة</p>
            <p className="font-bold text-lg text-orange-600">{stats.danger}</p>
          </Card>

          <Card className="p-3">
            <p className="text-xs text-muted-foreground">بدون واتساب</p>
            <p className="font-bold text-lg text-red-500">{stats.noWhatsapp}</p>
          </Card>

          <Card className="p-3">
            <p className="text-xs text-muted-foreground">بدون صور (R2)</p>
            <p className="font-bold text-lg text-red-500">{stats.noImages}</p>
          </Card>

          <Card className="p-3 bg-blue-50 border-blue-200">
            <p className="text-xs text-blue-600">قيد المراجعة</p>
            <p className="font-bold text-lg text-blue-600">{stats.pending}</p>
          </Card>

          <Card className="p-3 bg-green-50 border-green-200">
            <p className="text-xs text-green-600">معتمد</p>
            <p className="font-bold text-lg text-green-600">{stats.approved}</p>
          </Card>

          <Card className="p-3 bg-red-50 border-red-200">
            <p className="text-xs text-red-600">مرفوض</p>
            <p className="font-bold text-lg text-red-600">{stats.rejected}</p>
          </Card>
        </div>
      </Card>

      {/* 🔎 البحث / الفلترة */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="flex-1 flex items-center gap-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="بحث برقم العقار، الاسم أو المدينة…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          <Button
            variant={filter === "all" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("all")}
          >
            الكل
          </Button>
          <Button
            variant={filter === "ok" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("ok")}
          >
            مكتملة
          </Button>
          <Button
            variant={filter === "warning" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("warning")}
          >
            تحتاج بيانات
          </Button>
          <Button
            variant={filter === "danger" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("danger")}
          >
            مراجعة
          </Button>
          <Button
            variant={filter === "noImages" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("noImages")}
            className={
              filter === "noImages"
                ? "bg-red-600 hover:bg-red-700"
                : "border-red-300 text-red-600 hover:bg-red-50"
            }
          >
            بدون صور
          </Button>
          <Button
            variant={filter === "pending" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("pending")}
            className={
              filter === "pending"
                ? "bg-blue-600 hover:bg-blue-700"
                : "border-blue-300 text-blue-600 hover:bg-blue-50"
            }
          >
            قيد المراجعة
          </Button>
          <Button
            variant={filter === "approved" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("approved")}
            className={
              filter === "approved"
                ? "bg-green-600 hover:bg-green-700"
                : "border-green-300 text-green-600 hover:bg-green-50"
            }
          >
            معتمد
          </Button>
          <Button
            variant={filter === "rejected" ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter("rejected")}
            className={
              filter === "rejected"
                ? "bg-red-600 hover:bg-red-700"
                : "border-red-300 text-red-600 hover:bg-red-50"
            }
          >
            مرفوض
          </Button>
        </div>
      </div>

      {/* 🏡 قائمة العقارات */}
      <Card className="p-4">
        <div className="space-y-3 max-h-[520px] overflow-auto">
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">
              لا توجد عقارات مطابقة للبحث.
            </p>
          )}

          {filtered.map(({
            property,
            status,
            freeCommissionConsentStatus,
            imageCount,
          }) => (
            <Card
              key={property.propertyNumber}
              className="p-3 flex flex-col gap-2"
            >
              {/* ———————————— معلومات العقار ———————————— */}
              <div className="flex justify-between flex-wrap gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">
                      عقار #{property.propertyNumber}
                    </span>
                    <Badge variant="outline">
                      {property.city || "غير محدد"}
                    </Badge>
                    {/* حالة التحقق الفعلية */}
                    <Badge
                      className={
                        property.verificationStatus === "approved" || property.verificationStatus === "verified"
                          ? "bg-green-600 text-white"
                          : property.verificationStatus === "rejected"
                            ? "bg-red-600 text-white"
                            : "bg-blue-600 text-white"
                      }
                    >
                      {property.verificationStatus === "approved" || property.verificationStatus === "verified"
                        ? "معتمد"
                        : property.verificationStatus === "rejected"
                          ? "مرفوض"
                          : "قيد المراجعة"}
                    </Badge>
                    {freeCommissionConsentStatus && (
                      <Badge
                        variant="outline"
                        className={
                          freeCommissionConsentStatus === "accepted"
                            ? "border-green-300 bg-green-50 text-green-700"
                            : "border-red-300 bg-red-50 text-red-700"
                        }
                        data-testid={`free-commission-consent-${property.propertyNumber}`}
                      >
                        {freeCommissionConsentStatus === "accepted"
                          ? "موافقة العمولة مسجلة"
                          : "موافقة العمولة غير مسجلة"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {property.name || "بدون اسم"}
                  </p>
                </div>

                {/* الحالة + أزرار التحكم */}
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    className={
                      imageCount === null
                        ? "bg-amber-500 text-black"
                        : status.level === "ok"
                        ? "bg-green-600 text-white"
                        : status.level === "warning"
                          ? "bg-yellow-500 text-black"
                          : "bg-orange-600 text-white"
                    }
                  >
                    {imageCount === null ? "حالة الصور غير متاحة" : status.label}
                  </Badge>

                  {/* ——— أزرار التحكم حسب الحالة ——— */}
                  {(() => {
                    const vStatus = property.verificationStatus;
                    const isApproved = vStatus === "approved" || vStatus === "verified";
                    const isRejected = vStatus === "rejected";
                    const isSuspended = isSubscriptionStatusSuspended(
                      property.subscriptionStatus,
                    );
                    const canSuspend =
                      property.isSubscriptionExpired !== true &&
                      isSubscriptionStatusActive(property.subscriptionStatus);

                    return (
                      <>
                        {/* ——— زر قبول ——— (لا يظهر إذا مقبول أصلاً) */}
                        {!isApproved && (
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white"
                            disabled={
                              loadingApprove !== null ||
                              loadingReject !== null ||
                              loadingSuspend !== null
                            }
                            onClick={() => startApproval(property)}
                          >
                            {loadingApprove === property.propertyNumber ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              "قبول"
                            )}
                          </Button>
                        )}

                        {/* ——— زر رفض ——— (لا يظهر إذا مرفوض أصلاً) */}
                        {!isRejected && (
                          <Button
                            size="sm"
                            className="bg-red-600 hover:bg-red-700 text-white"
                            disabled={
                              loadingApprove !== null ||
                              loadingReject !== null ||
                              loadingSuspend !== null
                            }
                            onClick={async () => {
                              if (
                                approvalInFlightRef.current ||
                                rejectionInFlightRef.current ||
                                suspensionInFlightRef.current
                              ) {
                                return;
                              }

                              const hasRejectionBlockers =
                                status.blockers.length > 0;
                              const manualReason = hasRejectionBlockers
                                ? null
                                : window.prompt(
                                    status.warnings.length > 0
                                      ? `أدخل سبب الرفض بوضوح. التنبيهات الحالية: ${status.warnings.join("، ")}`
                                      : "أدخل سبب رفض العقار بوضوح",
                                    "",
                                  );
                              if (!hasRejectionBlockers && manualReason === null) {
                                return;
                              }
                              const autoReason = hasRejectionBlockers
                                ? status.blockers
                                    .map((blocker) => `- ${blocker}`)
                                    .join("\n")
                                : manualReason?.trim() || "";
                              if (!autoReason) {
                                toast({
                                  title: "سبب الرفض مطلوب",
                                  description:
                                    "أدخل سبباً واضحاً ليظهر في السجل ورسالة المالك.",
                                  variant: "destructive",
                                });
                                return;
                              }
                              const rejectionFollowUp = hasRejectionBlockers
                                ? "نرجو استكمال البيانات ثم طلب التحقق مرة أخرى."
                                : "يمكنكم مراجعة الإدارة لمزيد من التفاصيل.";

                              rejectionInFlightRef.current =
                                property.propertyNumber;
                              setLoadingReject(property.propertyNumber);
                              setApprovalErrors((current) => {
                                const next = { ...current };
                                delete next[property.propertyNumber];
                                return next;
                              });

                              const whatsappDestination =
                                normalizeWhatsAppDestination(
                                  property.whatsappNumber,
                                );
                              const whatsappTab = whatsappDestination
                                ? reserveWhatsAppTab()
                                : null;

                              try {
                                const msg = `
شريكنا العزيز،
تم *رفض عقاركم* رقم ${property.propertyNumber} (${property.name || ""}).

أسباب الرفض:
${autoReason}

${rejectionFollowUp}
`;
                                const res = await fetch(
                                  `/api/admin/properties/${property.propertyNumber}/reject`,
                                  {
                                    method: "PUT",
                                    credentials: "include",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ reason: autoReason }),
                                  },
                                );

                                await readAdminActionResponse(
                                  res,
                                  "لم يتم رفض العقار",
                                );

                                const whatsappOpened = Boolean(
                                  whatsappTab &&
                                    whatsappDestination &&
                                    navigateReservedWhatsAppTab(
                                      whatsappTab,
                                      buildWhatsAppUrl(
                                        whatsappDestination,
                                        msg,
                                      ),
                                    ),
                                );

                                toast({
                                  title: "❌ تم رفض العقار",
                                  description: !whatsappDestination
                                    ? `تم رفض #${property.propertyNumber}، لكن لا يوجد رقم واتساب صالح للمالك`
                                    : whatsappOpened
                                      ? `تم رفض #${property.propertyNumber} وفتح واتساب في علامة جديدة`
                                      : `تم رفض #${property.propertyNumber}، لكن المتصفح منع فتح واتساب في علامة جديدة`,
                                  variant: "destructive",
                                });

                                await refetch();
                              } catch (error) {
                                closeReservedWhatsAppTab(whatsappTab);
                                const reason = getAdminActionErrorMessage(
                                  error,
                                  "لم يتم رفض العقار",
                                );
                                const partial =
                                  error instanceof AdminActionError &&
                                  error.partial;
                                setApprovalErrors((current) => ({
                                  ...current,
                                  [property.propertyNumber]: {
                                    action: "rejection",
                                    message: reason,
                                    partial,
                                  },
                                }));
                                toast({
                                  title: partial
                                    ? "اكتمل الرفض جزئياً"
                                    : "تعذر رفض العقار",
                                  description: reason,
                                  variant: "destructive",
                                });
                                await refetch();
                              } finally {
                                rejectionInFlightRef.current = null;
                                setLoadingReject(null);
                              }
                            }}
                          >
                            {loadingReject === property.propertyNumber ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              "رفض"
                            )}
                          </Button>
                        )}

                        {canSuspend && (
                          <Button
                            size="sm"
                            type="button"
                            className="bg-amber-600 text-white hover:bg-amber-700"
                            disabled={
                              loadingApprove !== null ||
                              loadingReject !== null ||
                              loadingSuspend !== null
                            }
                            onClick={() => void startSuspension(property)}
                          >
                            {loadingSuspend === property.propertyNumber ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <PauseCircle className="ml-1 h-4 w-4" />
                                إيقاف الاشتراك
                              </>
                            )}
                          </Button>
                        )}

                        {isSuspended && (
                          <Button
                            size="sm"
                            type="button"
                            variant="outline"
                            disabled
                            className="border-slate-400 bg-slate-100 text-slate-700"
                          >
                            <PauseCircle className="ml-1 h-4 w-4" />
                            الاشتراك موقوف مؤقتاً
                          </Button>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>

              {approvalErrors[property.propertyNumber] && (
                <div
                  role="alert"
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium leading-6 text-red-700"
                  data-testid={
                    approvalErrors[property.propertyNumber].action ===
                    "approval"
                      ? `property-approval-error-${property.propertyNumber}`
                      : approvalErrors[property.propertyNumber].action ===
                          "rejection"
                        ? `property-rejection-error-${property.propertyNumber}`
                        : `property-suspension-error-${property.propertyNumber}`
                  }
                >
                  <span className="font-bold">
                    {approvalErrors[property.propertyNumber].action ===
                    "suspension"
                      ? approvalErrors[property.propertyNumber].partial
                        ? "تنبيه حالة الإيقاف: "
                        : "سبب تعذر الإيقاف: "
                      : approvalErrors[property.propertyNumber].partial
                        ? approvalErrors[property.propertyNumber].action ===
                          "approval"
                          ? "تنبيه حالة القبول: "
                          : "تنبيه حالة الرفض: "
                        : approvalErrors[property.propertyNumber].action ===
                            "approval"
                          ? "سبب تعذر القبول: "
                          : "سبب تعذر الرفض: "}
                  </span>
                  {approvalErrors[property.propertyNumber].message}
                </div>
              )}

              {imageCount === null && (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                  حالة الصور غير معروفة حالياً بسبب تعذر الاتصال بالتخزين.
                </p>
              )}

              {status.blockers.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-bold text-red-700">
                    متطلبات تمنع القبول
                  </p>
                  <ul className="list-disc pr-5 text-xs text-red-600 space-y-1">
                    {status.blockers.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}
              {status.warnings.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-bold text-amber-800">
                    تنبيهات لا تمنع القبول
                  </p>
                  <ul className="list-disc pr-5 text-xs text-amber-700 space-y-1">
                    {status.warnings.map((warning, i) => (
                      <li key={i}>{warning}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          ))}
        </div>
      </Card>
    </div>
  );
}
