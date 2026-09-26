"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageCircle,
  Search,
  UserRound,
  XCircle,
  Save,
  StickyNote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { QuestionnaireFacts } from "@/components/booking/booking-display";
import {
  OwnerLoadingState,
  OwnerMobileNavigation,
  OwnerPageHeader,
  OwnerPageMain,
  OwnerSectionHeading,
  ownerPanelClass,
} from "@/components/owner/owner-page";
import { formatDateTime } from "@/lib/dateUtils";
import { getOwnerLoginUrl } from "@/lib/owner-login-redirect";
import type {
  OwnerInquiryResponse,
  OwnerInquiryRow,
} from "@shared/owner-inquiries";

type Filter = "all" | "awaiting" | "confirmed" | "declined" | "commission";

const filterOptions: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "الكل" },
  { value: "awaiting", label: "بانتظار الرد" },
  { value: "confirmed", label: "تم الحجز" },
  { value: "declined", label: "لم يتم الحجز" },
  { value: "commission", label: "تحتاج متابعة" },
];

function bookingStatus(row: OwnerInquiryRow) {
  if (row.bookingStatus === "confirmed") {
    return { label: "تم الحجز", className: "border-[#b8dec3] bg-[#f3fbf5] text-[#126b38]", icon: CheckCircle2 };
  }
  if (row.bookingStatus === "declined") {
    return { label: "لم يتم الحجز", className: "border-[#dfe2dc] bg-[#f8f9f7] text-[#687064]", icon: XCircle };
  }
  if (row.bookingStatus === "expired") {
    return { label: "انتهت مهلة الرد", className: "border-[#ecd8ae] bg-[#fff9ec] text-[#80621d]", icon: Clock3 };
  }
  if (row.bookingStatus === "awaiting_response") {
    return { label: "بانتظار رد العميل", className: "border-[#c9d9eb] bg-[#f4f8fc] text-[#315f92]", icon: Clock3 };
  }
  return { label: "طلب تواصل", className: "border-[#dfe2dc] bg-white text-[#687064]", icon: MessageCircle };
}

function commissionStatus(row: OwnerInquiryRow) {
  if (row.commissionStatus === "paid") return "تم سداد العمولة";
  if (row.commissionStatus === "pending") return "العمولة بانتظار السداد";
  if (row.commissionStatus === "overdue") return "العمولة متأخرة";
  if (row.commissionStatus === "waived") return "تم إعفاء العمولة";
  return null;
}

function matchesFilter(row: OwnerInquiryRow, filter: Filter) {
  if (filter === "all") return true;
  if (filter === "awaiting") return row.bookingStatus === "awaiting_response" || row.bookingStatus === "contact_only";
  if (filter === "confirmed") return row.bookingStatus === "confirmed";
  if (filter === "declined") return row.bookingStatus === "declined" || row.bookingStatus === "expired";
  return row.commissionStatus === "pending" || row.commissionStatus === "overdue";
}

function InquiryCard({
  row,
  onSaved,
}: {
  row: OwnerInquiryRow;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [note, setNote] = useState(row.ownerNote || "");
  const [savingNote, setSavingNote] = useState(false);
  const status = bookingStatus(row);
  const StatusIcon = status.icon;
  const commission = commissionStatus(row);
  const questionnaire = row.bookingDate && row.timing && row.pricePaidHalalas
    ? {
        timing: row.timing,
        bookingDate: row.bookingDate,
        pricePaidHalalas: row.pricePaidHalalas,
      }
    : null;

  const saveNote = async () => {
    setSavingNote(true);
    try {
      const response = await fetch(
        `/api/owner/requests/${encodeURIComponent(row.id)}/note`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "تعذر حفظ الملاحظة");
      toast({ title: note.trim() ? "تم حفظ الملاحظة" : "تم حذف الملاحظة" });
      onSaved();
    } catch (error) {
      toast({
        title: "تعذر حفظ الملاحظة",
        description: error instanceof Error ? error.message : "حاول مرة أخرى",
        variant: "destructive",
      });
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <article className="relative overflow-hidden rounded-lg border border-[#dfe2dc] bg-white" data-testid={`owner-request-${row.requestCode}`}>
      <div className={`absolute inset-y-0 right-0 w-1 ${row.bookingStatus === "confirmed" ? "bg-[#128c47]" : row.bookingStatus === "awaiting_response" ? "bg-[#315f92]" : row.bookingStatus === "expired" ? "bg-[#b4861f]" : "bg-[#c7cbc4]"}`} />
      <div className="p-4 pr-5 sm:p-5 sm:pr-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="break-all text-sm font-bold text-[#242822]">{row.requestCode}</p>
              <Badge variant="outline" className={`gap-1 rounded-md ${status.className}`}>
                <StatusIcon className="h-3 w-3" />
                {status.label}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-[#687064]">{formatDateTime(row.contactedAt)}</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#e2e5df] bg-[#f8f9f7] px-3 py-2 text-sm">
            <UserRound className="h-4 w-4 text-[#80621d]" />
            <span className="font-bold text-[#242822]" dir="ltr">{row.clientPhoneMasked || "رقم غير متاح"}</span>
          </div>
        </div>

        {questionnaire ? (
          <div className="mt-4 border-t border-[#edf0eb] pt-4">
            <QuestionnaireFacts questionnaire={questionnaire} />
          </div>
        ) : (
          <p className="mt-4 border-t border-[#edf0eb] pt-4 text-sm text-[#687064]">
            لم تُسجل تفاصيل الحجز بعد.
          </p>
        )}

        {commission && (
          <div className={`mt-4 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${row.commissionStatus === "overdue" ? "border-[#f1c8c8] bg-[#fff5f5] text-red-700" : row.commissionStatus === "paid" || row.commissionStatus === "waived" ? "border-[#b8dec3] bg-[#f3fbf5] text-[#126b38]" : "border-[#ecd8ae] bg-[#fff9ec] text-[#80621d]"}`}>
            <span className="font-bold">{commission}</span>
            {row.commissionDueAt && row.commissionStatus !== "paid" && (
              <span className="text-xs">المهلة: {formatDateTime(row.commissionDueAt)}</span>
            )}
          </div>
        )}

        {row.customerOwnerNoResponseReportedAt && (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">
            أبلغ العميل بأنه لم يتلقّ ردًا على طلب التواصل.
          </div>
        )}

        <div className="mt-4 border-t border-[#edf0eb] pt-4">
          <label className="mb-2 flex items-center gap-2 text-sm font-bold text-[#493a1d]" htmlFor={`owner-note-${row.id}`}>
            <StickyNote className="h-4 w-4" aria-hidden="true" />
            ملاحظة خاصة
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <textarea
              id={`owner-note-${row.id}`}
              value={note}
              onChange={(event) => setNote(event.target.value.slice(0, 1_000))}
              rows={2}
              maxLength={1_000}
              placeholder="أضف ملاحظة للمتابعة..."
              className="min-h-20 min-w-0 flex-1 resize-y rounded-lg border border-[#dfe2dc] bg-white p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#80621d]"
            />
            <Button
              type="button"
              size="sm"
              onClick={() => void saveNote()}
              disabled={savingNote || note.trim() === (row.ownerNote || "")}
              className="min-h-10 gap-2 sm:flex-none"
            >
              {savingNote
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Save className="h-4 w-4" />}
              حفظ الملاحظة
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

export default function OwnerRequestsPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const {
    data: session,
    isLoading: sessionLoading,
    isError: sessionError,
    refetch: refetchSession,
  } = useQuery<{ isLoggedIn: boolean }>({
    queryKey: ["/api/owner/session"],
    retry: false,
    refetchOnWindowFocus: false,
  });
  const { data, isLoading, isError, refetch } = useQuery<OwnerInquiryResponse>({
    queryKey: ["/api/owner/requests"],
    enabled: session?.isLoggedIn === true,
    queryFn: async () => {
      const response = await fetch("/api/owner/requests", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("فشل في جلب الطلبات");
      return response.json();
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!sessionLoading && session && !session.isLoggedIn) {
      router.replace(getOwnerLoginUrl("/owner/requests"));
    }
  }, [router, session, sessionLoading]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.requests || []).filter((row) => {
      if (!matchesFilter(row, filter)) return false;
      if (!term) return true;
      return row.requestCode.toLowerCase().includes(term) ||
        (row.clientPhoneMasked || "").toLowerCase().includes(term);
    });
  }, [data?.requests, filter, search]);

  if (sessionLoading || (!session && !sessionError)) {
    return <OwnerLoadingState text="جاري التحقق من الجلسة..." />;
  }

  return (
    <div className="min-h-screen bg-[#f5f6f3] text-[#242822]" dir="rtl">
      <OwnerPageHeader
        eyebrow="متابعة التواصل والحجوزات"
        title="طلبات العملاء"
        description="عرض نتيجة كل طلب وحالة الحجز والعمولة"
      />
      <OwnerPageMain className="space-y-5">
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <SummaryTile label="كل الطلبات" value={data?.summary.total || 0} />
          <SummaryTile label="طلبات اليوم" value={data?.summary.today || 0} />
          <SummaryTile label="بانتظار الرد" value={data?.summary.awaitingResponse || 0} tone="blue" />
          <SummaryTile label="حجوزات مؤكدة" value={data?.summary.confirmed || 0} tone="green" />
          <SummaryTile label="لم يتم الحجز" value={data?.summary.declined || 0} />
          <SummaryTile label="عمولات للمتابعة" value={data?.summary.commissionAttention || 0} tone="amber" />
        </section>

        <Card className={`${ownerPanelClass} p-4 sm:p-5`}>
          <OwnerSectionHeading
            icon={<MessageCircle className="h-4 w-4" />}
            title="صندوق الطلبات"
            description="ابحث برقم الطلب أو رقم العميل وتابع حالة كل تواصل."
          />
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#687064]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث برقم الطلب أو رقم العميل..."
              className="h-11 w-full rounded-lg border border-[#dfe2dc] bg-white pr-10 pl-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[#80621d]"
            />
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="تصفية الطلبات">
            {filterOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={filter === option.value}
                onClick={() => setFilter(option.value)}
                className={`min-h-10 flex-none rounded-lg border px-3 text-sm font-bold ${filter === option.value ? "border-[#242822] bg-[#242822] text-white" : "border-[#dfe2dc] bg-white text-[#687064]"}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Card>

        <section className="space-y-3" aria-live="polite">
          {isLoading ? (
            <Card className={`${ownerPanelClass} p-8 text-center`}>
              <Loader2 className="mx-auto h-7 w-7 animate-spin text-[#80621d]" />
              <p className="mt-3 text-sm font-medium text-[#687064]">جاري تحميل الطلبات...</p>
            </Card>
          ) : sessionError || isError ? (
            <Card className={`${ownerPanelClass} p-8 text-center`}>
              <AlertTriangle className="mx-auto h-7 w-7 text-red-600" />
              <p className="mt-3 font-bold">تعذر تحميل الطلبات</p>
              <button
                type="button"
                onClick={() => void (sessionError ? refetchSession() : refetch())}
                className="mt-4 rounded-lg bg-[#242822] px-4 py-2 text-sm font-bold text-white"
              >
                إعادة المحاولة
              </button>
            </Card>
          ) : rows.length === 0 ? (
            <Card className={`${ownerPanelClass} p-8 text-center`}>
              <CalendarDays className="mx-auto h-8 w-8 text-[#9da39a]" />
              <p className="mt-3 font-bold">لا توجد طلبات مطابقة</p>
              <p className="mt-1 text-sm text-[#687064]">غيّر البحث أو الفلتر لعرض نتائج أخرى.</p>
            </Card>
          ) : rows.map((row) => (
            <InquiryCard key={row.id} row={row} onSaved={() => void refetch()} />
          ))}
        </section>
      </OwnerPageMain>
      <OwnerMobileNavigation />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "blue" | "green" | "amber";
}) {
  const toneClass = {
    neutral: "border-[#dfe2dc] bg-white text-[#242822]",
    blue: "border-[#c9d9eb] bg-[#f4f8fc] text-[#315f92]",
    green: "border-[#b8dec3] bg-[#f3fbf5] text-[#126b38]",
    amber: "border-[#ecd8ae] bg-[#fff9ec] text-[#80621d]",
  }[tone];
  return (
    <div className={`rounded-lg border p-3 sm:p-4 ${toneClass}`}>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs font-semibold leading-5">{label}</p>
    </div>
  );
}
