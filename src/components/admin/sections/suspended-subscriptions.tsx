"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  CalendarClock,
  ExternalLink,
  Layers3,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type SuspendedSubscription = {
  id: string;
  propertyNumber: string;
  name: string;
  subscriptionType: string;
  status: string;
  suspendedAt?: string | null;
  remainingDays?: number | null;
  remainingDurationMs?: number | null;
  linkedProperty?: string | null;
  linkedProperties?: string[];
  propertyCount?: number;
  isLinkedChild?: boolean;
  linkedGroupName?: string | null;
};

type PropertyAvailabilityHold = {
  propertyNumber: string;
  name: string;
  kind: "manual" | "commission" | "manual_and_commission";
  suspendedAt?: string | null;
  manualHold: boolean;
  commissionHold: boolean;
  commissionObligationCount: number;
  commissionHoldVersion: string | null;
};

type FreePropertyCandidate = {
  propertyNumber: string;
  name: string;
};

type PropertyAvailabilityDashboard = {
  holds: PropertyAvailabilityHold[];
  candidates: FreePropertyCandidate[];
};

function formatDate(value?: string | null): string {
  if (!value) return "غير محدد";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "غير محدد";
  return date.toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
function getPausedDays(value?: string | null): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}

export default function SuspendedSubscriptionsSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const invalidatePropertyAvailabilityQueries = () => {
    for (const queryKey of [
      ["/api/admin/property-availability-holds"],
      ["admin-properties"],
      ["/api/properties"],
      ["/api/search"],
      ["/api/cities"],
      ["/api/occasions/active"],
      ["property-details"],
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSubscription, setSelectedSubscription] = useState<SuspendedSubscription | null>(null);
  const [selectedPropertyHold, setSelectedPropertyHold] = useState<PropertyAvailabilityHold | null>(null);
  const [pauseDialogOpen, setPauseDialogOpen] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [selectedCandidate, setSelectedCandidate] = useState<FreePropertyCandidate | null>(null);

  const { data: subscriptions = [], isLoading, isError, refetch, isFetching } = useQuery<SuspendedSubscription[]>({
    queryKey: ["/api/admin/subscriptions"],
  });
  const {
    data: availabilityDashboard,
    isLoading: holdsLoading,
    isError: holdsError,
    refetch: refetchHolds,
    isFetching: holdsFetching,
  } = useQuery<PropertyAvailabilityDashboard>({
    queryKey: ["/api/admin/property-availability-holds"],
  });
  const propertyHolds = availabilityDashboard?.holds || [];
  const freePropertyCandidates = availabilityDashboard?.candidates || [];

  const suspendedSubscriptions = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    return subscriptions
      .filter((subscription) => subscription.status === "موقوف مؤقتاً")
      .filter((subscription) => !normalizedSearch
        || subscription.propertyNumber.toLowerCase().includes(normalizedSearch)
        || subscription.name.toLowerCase().includes(normalizedSearch)
        || (subscription.linkedGroupName || "").toLowerCase().includes(normalizedSearch))
      .sort((a, b) => new Date(b.suspendedAt || 0).getTime() - new Date(a.suspendedAt || 0).getTime());
  }, [searchQuery, subscriptions]);

  const filteredPropertyHolds = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    return propertyHolds.filter((hold) => !normalizedSearch
      || hold.propertyNumber.toLowerCase().includes(normalizedSearch)
      || hold.name.toLowerCase().includes(normalizedSearch));
  }, [propertyHolds, searchQuery]);

  const filteredCandidates = useMemo(() => {
    const normalizedSearch = candidateSearch.trim().toLowerCase();
    return freePropertyCandidates.filter((candidate) => !normalizedSearch
      || candidate.propertyNumber.toLowerCase().includes(normalizedSearch)
      || candidate.name.toLowerCase().includes(normalizedSearch));
  }, [candidateSearch, freePropertyCandidates]);

  const allSuspended = useMemo(
    () => subscriptions.filter((subscription) => subscription.status === "موقوف مؤقتاً"),
    [subscriptions],
  );
  const totalSavedDays = allSuspended.reduce(
    (total, subscription) => total + Math.max(0, subscription.remainingDays || 0),
    0,
  );
  const longestPause = allSuspended.reduce(
    (longest, subscription) => Math.max(longest, getPausedDays(subscription.suspendedAt)),
    0,
  );
  const totalSuspendedProperties = new Set([
    ...allSuspended.map((subscription) => subscription.propertyNumber),
    ...propertyHolds.map((hold) => hold.propertyNumber),
  ]).size;
  const longestPropertyPause = propertyHolds.reduce(
    (longest, hold) => Math.max(longest, getPausedDays(hold.suspendedAt)),
    0,
  );

  const resumeMutation = useMutation({
    mutationFn: async (subscription: SuspendedSubscription) => {
      const response = await apiRequest(
        "POST",
        `/api/admin/subscriptions/${encodeURIComponent(subscription.id || subscription.propertyNumber)}/resume`,
        {},
      );
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/properties"] });
      toast({
        title: "تم استئناف الاشتراك",
        description: data?.message || "تم احتساب تاريخ نهاية جديد من المدة المحفوظة.",
      });
      setSelectedSubscription(null);
    },
    onError: (error: Error) => {
      toast({
        title: "تعذر استئناف الاشتراك",
        description: error.message || "حدث خطأ أثناء استئناف الاشتراك.",
        variant: "destructive",
      });
    },
  });

  const resumePropertyMutation = useMutation({
    mutationFn: async (hold: PropertyAvailabilityHold) => {
      const response = await apiRequest(
        "POST",
        `/api/admin/property-availability-holds/${encodeURIComponent(hold.propertyNumber)}/resume`,
        {
          expectedCommissionHoldVersion: hold.commissionHoldVersion,
        },
      );
      return response.json();
    },
    onSuccess: (data) => {
      invalidatePropertyAvailabilityQueries();
      toast({
        title: "تم تفعيل إتاحة العقار",
        description: data?.message || "تم إلغاء الإيقاف الإداري عن العقار.",
      });
      setSelectedPropertyHold(null);
    },
    onError: (error: Error) => {
      toast({
        title: "تعذر إلغاء إيقاف العقار",
        description: error.message || "حدث خطأ أثناء تفعيل إتاحة العقار.",
        variant: "destructive",
      });
    },
  });

  const pausePropertyMutation = useMutation({
    mutationFn: async (candidate: FreePropertyCandidate) => {
      const response = await apiRequest(
        "POST",
        `/api/admin/property-availability-holds/${encodeURIComponent(candidate.propertyNumber)}/pause`,
        {},
      );
      return response.json();
    },
    onSuccess: (data) => {
      invalidatePropertyAvailabilityQueries();
      toast({
        title: "تم إيقاف العقار المجاني",
        description: data?.message || "تم إيقاف ظهور العقار والتواصل معه.",
      });
      setPauseDialogOpen(false);
      setCandidateSearch("");
      setSelectedCandidate(null);
    },
    onError: (error: Error) => {
      toast({
        title: "تعذر إيقاف العقار",
        description: error.message || "حدث خطأ أثناء إيقاف العقار.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="flex min-h-72 items-center justify-center" dir="rtl">
        <Loader2 className="h-7 w-7 animate-spin text-slate-600" aria-label="جاري تحميل الاشتراكات الموقوفة" />
      </div>
    );
  }

  return (
    <section className="min-w-0 space-y-5" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-slate-600">
            <PauseCircle className="h-5 w-5" />
            <span className="text-xs font-semibold">إدارة دورة الاشتراك</span>
          </div>
          <h1 className="text-2xl font-bold text-[#34332f]">الاشتراكات الموقوفة</h1>
          <p className="mt-1 text-sm text-muted-foreground">المدة المتبقية محفوظة ولا تنقص حتى استئناف الاشتراك.</p>
          <p className="mt-1 text-sm text-muted-foreground">وتظهر هنا أيضاً العقارات المجانية الموقوفة يدوياً أو بسبب عدم سداد العمولة.</p>
        </div>
        <div className="flex w-full flex-col gap-2 min-[360px]:flex-row sm:w-auto sm:justify-end">
          <Button
            type="button"
            onClick={() => setPauseDialogOpen(true)}
            disabled={holdsLoading || holdsError}
            className="w-full min-w-0 gap-2 bg-[#80621d] text-white hover:bg-[#6f5519] min-[360px]:w-auto"
            data-testid="button-open-pause-free-property"
          >
            <Plus className="h-4 w-4" />
            إيقاف عقار مجاني
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void refetch();
              void refetchHolds();
            }}
            disabled={isFetching || holdsFetching}
            className="w-full min-w-0 gap-2 min-[360px]:w-auto"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching || holdsFetching ? "animate-spin" : ""}`} />
            تحديث
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-semibold text-muted-foreground">العقارات الموقوفة</p>
          <p className="mt-1 text-3xl font-bold text-slate-700">{totalSuspendedProperties}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold text-muted-foreground">إجمالي الأيام المحفوظة</p>
          <p className="mt-1 text-3xl font-bold text-[#80621d]">{totalSavedDays}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold text-muted-foreground">أطول فترة توقف</p>
          <p className="mt-1 text-3xl font-bold text-[#34332f]">{Math.max(longestPause, longestPropertyPause)} <span className="text-sm font-medium">يوم</span></p>
        </Card>
      </div>

      <div className="relative max-w-xl">
        <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="ابحث برقم العقار أو الاسم..."
          className="pr-9"
          data-testid="input-search-suspended-subscriptions"
        />
      </div>

      {isError ? (
        <Card className="p-6 text-center">
          <p className="font-semibold text-destructive">تعذر تحميل الاشتراكات الموقوفة</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void refetch();
              void refetchHolds();
            }}
            className="mt-3"
          >
            إعادة المحاولة
          </Button>
        </Card>
      ) : suspendedSubscriptions.length === 0 &&
        filteredPropertyHolds.length === 0 &&
        !holdsLoading &&
        !holdsError ? (
        <Card className="p-8 text-center">
          <PauseCircle className="mx-auto h-9 w-9 text-slate-400" />
          <p className="mt-3 font-semibold text-[#34332f]">لا توجد اشتراكات موقوفة مطابقة</p>
          <p className="mt-1 text-sm text-muted-foreground">ستظهر هنا الاشتراكات التي تم إيقافها مؤقتاً.</p>
        </Card>
      ) : (
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
          {holdsLoading && (
            <Card className="flex min-h-32 items-center justify-center p-6">
              <Loader2 className="h-6 w-6 animate-spin text-slate-600" aria-label="جاري تحميل العقارات المجانية الموقوفة" />
            </Card>
          )}
          {holdsError && (
            <Card className="p-6 text-center">
              <p className="font-semibold text-destructive">تعذر تحميل العقارات المجانية الموقوفة</p>
              <Button type="button" variant="outline" onClick={() => void refetchHolds()} className="mt-3">
                إعادة المحاولة
              </Button>
            </Card>
          )}
          {suspendedSubscriptions.map((subscription) => {
            const savedDays = Math.max(0, subscription.remainingDays || 0);
            const pausedDays = getPausedDays(subscription.suspendedAt);
            return (
              <Card key={subscription.id || subscription.propertyNumber} className="min-w-0 p-4 sm:p-5">
                <div className="flex min-w-0 flex-col gap-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-[#34332f]">{subscription.name || `عقار ${subscription.propertyNumber}`}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">عقار رقم {subscription.propertyNumber}</p>
                    </div>
                    <Badge className="flex-shrink-0 border border-slate-300 bg-slate-100 text-slate-700">موقوف مؤقتاً</Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div>
                      <p className="text-[11px] font-semibold text-muted-foreground">المدة المحفوظة</p>
                      <p className="mt-1 text-xl font-bold text-[#34332f]">{savedDays} <span className="text-xs font-medium">يوم</span></p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-muted-foreground">مدة التوقف</p>
                      <p className="mt-1 text-xl font-bold text-slate-700">{pausedDays} <span className="text-xs font-medium">يوم</span></p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock className="h-3.5 w-3.5" />
                      أوقف في {formatDate(subscription.suspendedAt)}
                    </span>
                    {(subscription.isLinkedChild || (subscription.linkedProperties?.length || 0) > 0) && (
                      <Badge variant="outline" className="gap-1 border-blue-200 text-blue-700">
                        <Layers3 className="h-3 w-3" />
                        {subscription.isLinkedChild
                          ? `مرتبط بـ ${subscription.linkedGroupName || subscription.linkedProperty || "مجموعة"}`
                          : `${subscription.propertyCount || (subscription.linkedProperties?.length || 0) + 1} عقارات مرتبطة`}
                      </Badge>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                    <Link
                      href={`/property/${encodeURIComponent(subscription.propertyNumber)}`}
                      target="_blank"
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold text-muted-foreground hover:bg-muted"
                    >
                      <ExternalLink className="h-4 w-4" />
                      عرض العقار
                    </Link>
                    <Button
                      type="button"
                      onClick={() => setSelectedSubscription(subscription)}
                      className="gap-2 bg-green-700 text-white hover:bg-green-800"
                      data-testid={`button-resume-suspended-${subscription.propertyNumber}`}
                    >
                      <PlayCircle className="h-4 w-4" />
                      استئناف الاشتراك
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
          {filteredPropertyHolds.map((hold) => {
            const pausedDays = getPausedDays(hold.suspendedAt);
            return (
              <Card
                key={`property-hold-${hold.propertyNumber}`}
                className="min-w-0 overflow-hidden p-4 sm:p-5"
                data-testid={`card-property-hold-${hold.propertyNumber}`}
              >
                <div className="flex min-w-0 flex-col gap-4">
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words font-bold text-[#34332f]">{hold.name || `عقار ${hold.propertyNumber}`}</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">عقار رقم {hold.propertyNumber}</p>
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-2 sm:justify-end">
                      {hold.manualHold && (
                        <Badge className="max-w-full whitespace-normal border border-slate-300 bg-slate-100 text-center text-slate-700">
                          إيقاف إداري
                        </Badge>
                      )}
                      {hold.commissionHold && (
                        <Badge className="max-w-full whitespace-normal border border-red-200 bg-red-50 text-center text-red-700">
                          عمولة غير مسددة
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3 min-[360px]:grid-cols-2">
                    <div>
                      <p className="text-[11px] font-semibold text-muted-foreground">سبب الإيقاف</p>
                      <p className="mt-1 break-words font-bold text-[#34332f]">
                        {hold.manualHold && hold.commissionHold
                          ? "إيقاف إداري وعمولة غير مسددة"
                          : hold.commissionHold
                            ? "عدم سداد العمولة"
                            : "إيقاف يدوي من الإدارة"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-muted-foreground">مدة التوقف</p>
                      <p className="mt-1 text-xl font-bold text-slate-700">{pausedDays} <span className="text-xs font-medium">يوم</span></p>
                    </div>
                    {hold.commissionHold && (
                      <div className="min-[360px]:col-span-2">
                        <p className="text-[11px] font-semibold text-muted-foreground">العمولات التي سببت الإيقاف</p>
                        <p className="mt-1 font-bold text-red-700">{hold.commissionObligationCount}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock className="h-3.5 w-3.5" />
                      أوقف في {formatDate(hold.suspendedAt)}
                    </span>
                  </div>

                  <div className="flex w-full flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                    {hold.commissionHold ? (
                      <Link
                        href="/admin/booking-commissions"
                        className="inline-flex h-9 w-full min-w-0 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold text-muted-foreground hover:bg-muted sm:w-auto"
                      >
                        <ShieldAlert className="h-4 w-4" />
                        إدارة العمولة
                      </Link>
                    ) : (
                      <Link
                        href="/admin/properties"
                        className="inline-flex h-9 w-full min-w-0 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold text-muted-foreground hover:bg-muted sm:w-auto"
                      >
                        <ExternalLink className="h-4 w-4" />
                        إدارة العقار
                      </Link>
                    )}
                    <Button
                      type="button"
                      onClick={() => setSelectedPropertyHold(hold)}
                      className="w-full min-w-0 gap-2 bg-green-700 text-white hover:bg-green-800 sm:w-auto"
                      data-testid={`button-resume-property-hold-${hold.propertyNumber}`}
                    >
                      <PlayCircle className="h-4 w-4" />
                      إلغاء الإيقاف وتفعيل العقار
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={Boolean(selectedSubscription)} onOpenChange={(open) => !open && setSelectedSubscription(null)}>
        <DialogContent dir="rtl" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-right">
              <PlayCircle className="h-5 w-5 text-green-700" />
              استئناف الاشتراك
            </DialogTitle>
            <DialogDescription className="pt-2 text-right leading-7">
              سيبدأ اشتراك العقار {selectedSubscription?.propertyNumber} من المدة المحفوظة، وسيتم إنشاء تاريخ نهاية جديد تلقائياً.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">المدة التي ستُستأنف</span>
              <span className="font-bold">{Math.max(0, selectedSubscription?.remainingDays || 0)} يوم</span>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="button" variant="outline" onClick={() => setSelectedSubscription(null)}>رجوع</Button>
            <Button
              type="button"
              onClick={() => selectedSubscription && resumeMutation.mutate(selectedSubscription)}
              disabled={resumeMutation.isPending}
              className="gap-2 bg-green-700 hover:bg-green-800"
              data-testid="button-confirm-resume-suspended"
            >
              {resumeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              تأكيد الاستئناف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pauseDialogOpen}
        onOpenChange={(open) => {
          setPauseDialogOpen(open);
          if (!open) {
            setCandidateSearch("");
            setSelectedCandidate(null);
          }
        }}
      >
        <DialogContent
          dir="rtl"
          className="max-h-[85svh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-right">
              <PauseCircle className="h-5 w-5 text-[#80621d]" />
              إيقاف عقار مجاني
            </DialogTitle>
            <DialogDescription className="pt-2 text-right leading-7">
              اختر العقار المجاني الذي تريد إيقاف ظهوره ومنع طلبات التواصل الجديدة عنه.
            </DialogDescription>
          </DialogHeader>

          <div className="relative min-w-0">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={candidateSearch}
              onChange={(event) => setCandidateSearch(event.target.value)}
              placeholder="ابحث برقم العقار أو الاسم..."
              className="min-w-0 pr-9"
              data-testid="input-search-free-property-candidates"
            />
          </div>

          <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border p-2">
            {filteredCandidates.length === 0 ? (
              <p className="p-5 text-center text-sm text-muted-foreground">
                لا توجد عقارات مجانية متاحة للإيقاف.
              </p>
            ) : filteredCandidates.map((candidate) => {
              const selected = selectedCandidate?.propertyNumber === candidate.propertyNumber;
              return (
                <button
                  key={candidate.propertyNumber}
                  type="button"
                  onClick={() => setSelectedCandidate(candidate)}
                  className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border p-3 text-right transition ${
                    selected
                      ? "border-[#80621d] bg-amber-50"
                      : "border-slate-200 hover:bg-muted/50"
                  }`}
                  data-testid={`button-select-free-property-${candidate.propertyNumber}`}
                >
                  <span className="min-w-0">
                    <span className="block break-words font-semibold text-[#34332f]">{candidate.name}</span>
                    <span className="block text-xs text-muted-foreground">عقار رقم {candidate.propertyNumber}</span>
                  </span>
                  <span className={`h-4 w-4 flex-shrink-0 rounded-full border-2 ${selected ? "border-[#80621d] bg-[#80621d]" : "border-slate-300"}`} />
                </button>
              );
            })}
          </div>

          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="button" variant="outline" onClick={() => setPauseDialogOpen(false)}>رجوع</Button>
            <Button
              type="button"
              onClick={() => selectedCandidate && pausePropertyMutation.mutate(selectedCandidate)}
              disabled={!selectedCandidate || pausePropertyMutation.isPending}
              className="gap-2 bg-[#80621d] text-white hover:bg-[#6f5519]"
              data-testid="button-confirm-pause-free-property"
            >
              {pausePropertyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />}
              تأكيد إيقاف العقار
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedPropertyHold)}
        onOpenChange={(open) => !open && setSelectedPropertyHold(null)}
      >
        <DialogContent
          dir="rtl"
          className="w-[calc(100vw-1.5rem)] max-w-md"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-right">
              <PlayCircle className="h-5 w-5 text-green-700" />
              إلغاء إيقاف العقار
            </DialogTitle>
            <DialogDescription className="pt-2 text-right leading-7">
              سيتم تفعيل إتاحة العقار {selectedPropertyHold?.propertyNumber} للظهور وطلبات التواصل الجديدة.
            </DialogDescription>
          </DialogHeader>
          {selectedPropertyHold?.commissionHold && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-900">
              العمولة تبقى مسجلة في لوحة العمولات، وهذا الإجراء يتجاوز إيقاف الالتزامات الحالية فقط. أي عمولة جديدة غير مسددة ستوقف العقار مرة أخرى.
            </div>
          )}
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="button" variant="outline" onClick={() => setSelectedPropertyHold(null)}>رجوع</Button>
            <Button
              type="button"
              onClick={() => selectedPropertyHold && resumePropertyMutation.mutate(selectedPropertyHold)}
              disabled={resumePropertyMutation.isPending}
              className="gap-2 bg-green-700 hover:bg-green-800"
              data-testid="button-confirm-resume-property-hold"
            >
              {resumePropertyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              تأكيد التفعيل
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
