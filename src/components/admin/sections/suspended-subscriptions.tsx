"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  CalendarClock,
  ExternalLink,
  Layers3,
  Loader2,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
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
import { apiRequest, queryClient } from "@/lib/queryClient";

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

function formatDate(value?: string | null): string {
  if (!value) return "غير محدد";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "غير محدد";
  return date.toLocaleDateString("ar-SA", {
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
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSubscription, setSelectedSubscription] = useState<SuspendedSubscription | null>(null);

  const { data: subscriptions = [], isLoading, isError, refetch, isFetching } = useQuery<SuspendedSubscription[]>({
    queryKey: ["/api/admin/subscriptions"],
  });

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
        </div>
        <Button type="button" variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-2 self-start sm:self-auto">
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          تحديث
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-semibold text-muted-foreground">العقارات الموقوفة</p>
          <p className="mt-1 text-3xl font-bold text-slate-700">{allSuspended.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold text-muted-foreground">إجمالي الأيام المحفوظة</p>
          <p className="mt-1 text-3xl font-bold text-[#80621d]">{totalSavedDays}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-semibold text-muted-foreground">أطول فترة توقف</p>
          <p className="mt-1 text-3xl font-bold text-[#34332f]">{longestPause} <span className="text-sm font-medium">يوم</span></p>
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
          <Button type="button" variant="outline" onClick={() => refetch()} className="mt-3">إعادة المحاولة</Button>
        </Card>
      ) : suspendedSubscriptions.length === 0 ? (
        <Card className="p-8 text-center">
          <PauseCircle className="mx-auto h-9 w-9 text-slate-400" />
          <p className="mt-3 font-semibold text-[#34332f]">لا توجد اشتراكات موقوفة مطابقة</p>
          <p className="mt-1 text-sm text-muted-foreground">ستظهر هنا الاشتراكات التي تم إيقافها مؤقتاً.</p>
        </Card>
      ) : (
        <div className="grid min-w-0 gap-3 xl:grid-cols-2">
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
    </section>
  );
}
