"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FaWhatsapp } from "react-icons/fa";
import {
  AlertTriangle,
  BellOff,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  Loader2,
  PauseCircle,
  RefreshCw,
  Search,
  WalletCards,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BookingTimeline,
  NotificationSummaryView,
  QuestionnaireFacts,
  StatusBadge,
  formatDateTime,
  formatSarFromHalalas,
  getPaymentReversalStatusLabel,
  getBookingStatusMeta,
  getCommissionStatusMeta,
  getComplianceStatusMeta,
  getPropertyLabel,
  type BookingAdminNotificationJob,
  type BookingAdminPaymentAttempt,
  type BookingDisplayRow,
} from "@/components/booking/booking-display";
import { bookingApiRequest } from "@/components/booking/booking-api";
import {
  notificationKindLabel,
  notificationProviderErrorLabel,
  notificationRecipientLabel,
  notificationStatusMeta,
} from "@/components/booking/booking-admin-history";
import {
  getBookingReversalReviewState,
  type BookingReversalReviewState,
} from "@/components/booking/booking-reversal-state";
import BookingCommissionSettingsCard from "./booking-commission-settings";
import BookingBankTransferReview from "./booking-bank-transfer-review";
import { getAdminCustomerWhatsAppHref } from "./booking-customer-whatsapp";

interface BookingCommissionSummary {
  total: number;
  awaitingResponse: number;
  expired: number;
  declined: number;
  confirmed: number;
  pending: number;
  paid: number;
  overdue: number;
  paused: number;
  reportedValueHalalas: number;
  commissionDueHalalas: number;
  commissionPaidHalalas: number;
  notificationSuppressed: number;
}

interface AdminBookingCommissionsPayload {
  summary: BookingCommissionSummary;
  bookings: BookingDisplayRow[];
}

type StatusFilter = "all" | "awaiting" | "expired" | "declined" | "confirmed" | "pending" | "paid" | "overdue" | "paused" | "disputed";
type DisputeResolution = "resume_collection" | "cancel_commission";
type ReversalResolution = "resume_collection" | "keep_paid";

interface DisputeResolutionResponse {
  id: string;
  disputeStatus: string;
  commissionStatus: string;
  complianceStatus: string;
  propertyReleased: boolean;
}

interface ReversalResolutionResponse {
  id: string;
  attemptId: string;
  reversalTransactionId: string;
  resolution: ReversalResolution;
  commissionStatus: string;
  complianceStatus: string;
  collectionNoticeScheduled: boolean;
  resolvedAt: string | null;
}

function normalize(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function matchesStatusFilter(row: BookingDisplayRow, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  const booking = normalize(row.bookingStatus);
  const commission = normalize(row.commissionStatus);
  const compliance = normalize(row.complianceStatus);
  if (filter === "awaiting") {
    return ["awaiting_response", "scheduled", "sent", "pending"].includes(booking)
      && !hasBookingEvent(row, "customer_followup_expired");
  }
  if (filter === "expired") return booking === "expired" || hasBookingEvent(row, "customer_followup_expired");
  if (filter === "declined") return ["declined", "not_booked", "no_booking"].includes(booking);
  if (filter === "confirmed") return ["confirmed", "completed", "reported", "booking_confirmed"].includes(booking);
  if (filter === "pending") return ["pending", "due", "awaiting_payment", "payment_pending"].includes(commission);
  if (filter === "paid") return ["paid", "completed", "settled"].includes(commission);
  if (filter === "overdue") return ["overdue", "late"].includes(commission);
  if (filter === "disputed") return normalize(row.disputeStatus) === "pending" || Boolean(row.disputedAt);
  return ["paused", "suspended", "property_paused"].includes(compliance);
}

function paymentAttemptStatusLabel(value: unknown): string {
  const status = normalize(value);
  if (status === "creating") return "جاري إنشاء رابط الدفع";
  if (status === "created") return "رابط الدفع جاهز";
  if (status === "pending_review") return "إيصال بانتظار المراجعة";
  if (status === "review_required") return "مراجعة مالية مطلوبة";
  if (status === "unknown") return "تحتاج مراجعة حالة المزود";
  if (status === "failed") return "فشل إنشاء رابط الدفع";
  if (status === "paid") return "تم الدفع";
  if (status === "duplicate_paid") return "دفعة مكررة تحتاج مراجعة";
  return String(value || "—");
}

function paymentMethodLabel(value: unknown): string {
  const method = normalize(value);
  if (method === "cards") return "بطاقة";
  if (method === "applepay") return "Apple Pay";
  if (method === "bank_transfer") return "تحويل بنكي";
  return String(value || "—");
}

function paymentFailureReasonLabel(value: unknown): string {
  const reason = normalize(value);
  if (reason === "duplicate_financial_success") return "نجاح مالي مكرر؛ يلزم مراجعة الاسترداد.";
  if (reason === "provider_callback_failure") return "أبلغ مزود الدفع عن فشل العملية.";
  if (["refunded", "voided", "errored", "authorization_only", "other_nonpayable"].includes(reason)) {
    return getPaymentReversalStatusLabel(reason);
  }
  return String(value || "—");
}

function receiptFileSizeLabel(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function bankReviewDecisionLabel(value: unknown): string {
  const decision = normalize(value);
  if (decision === "approved") return "معتمد";
  if (decision === "rejected") return "مرفوض";
  if (decision === "refund_review") return "مراجعة استرداد";
  return "—";
}

function hasBookingEvent(row: BookingDisplayRow, type: string): boolean {
  return [...(row.events || []), ...(row.timeline || [])]
    .some((event) => normalize(event.type) === type);
}

function findBookingEventDetail(row: BookingDisplayRow, type: string): string | null {
  const event = [...(row.events || []), ...(row.timeline || [])]
    .find((entry) => normalize(entry.type) === type);
  return String(event?.detail || "").trim() || null;
}

function findLatestBookingEvent(row: BookingDisplayRow, types: string[]) {
  const entries = row.timeline?.length ? row.timeline : row.events || [];
  return [...entries].reverse()
    .find((entry) => types.includes(normalize(entry.type))) || null;
}

function reversalReviewState(row: BookingDisplayRow): BookingReversalReviewState {
  const latestReversalEvent = findLatestBookingEvent(row, [
    "commission_payment_reversal_reported",
    "commission_payment_reversal_collection_resumed",
    "commission_payment_reversal_kept_paid",
  ]);
  return getBookingReversalReviewState({
    reversalStatus: row.paymentAttempt?.reversalStatus,
    reversalResolution: row.paymentAttempt?.reversalResolution,
    latestEventType: latestReversalEvent?.type,
    reportedEventDetail: normalize(latestReversalEvent?.type) === "commission_payment_reversal_reported"
      ? latestReversalEvent?.detail
      : findBookingEventDetail(row, "commission_payment_reversal_reported"),
    hasReportedEvent: hasBookingEvent(row, "commission_payment_reversal_reported"),
    hasCollectionResumedEvent: hasBookingEvent(row, "commission_payment_reversal_collection_resumed"),
    hasKeptPaidEvent: hasBookingEvent(row, "commission_payment_reversal_kept_paid"),
  });
}

function reversalResolutionLabel(value: unknown): string {
  const resolution = normalize(value);
  if (resolution === "resume_collection") return "استئناف التحصيل";
  if (resolution === "keep_paid") return "إبقاء العمولة مدفوعة";
  return String(value || "—");
}

function enforcementIssueMessage(value: unknown): string {
  const reason = normalize(value);
  if (reason.startsWith("commission_payment_") && reason.endsWith("_requires_admin_review")) {
    return getPaymentReversalStatusLabel(
      reason.slice("commission_payment_".length, -"_requires_admin_review".length),
    );
  }
  if (reason === "payment_attempt_identity_incomplete") return "بيانات محاولة الدفع لم تكتمل بعد.";
  if (reason === "payment_attempt_reconciliation_required") return "محاولة الدفع تحتاج مطابقة مع مزود الدفع.";
  if (reason === "required_owner_notice_not_delivered") return "لم يقبل مزود واتساب الإشعار المطلوب للإرسال، لذلك أُجل الإيقاف.";
  if (reason === "owner_identity_changed") return "تغيرت هوية مالك العقار وتوقفت الإشعارات والإجراءات لحين التحقق من المالك الحالي.";
  if (reason === "paymob_identity_mismatch") return "بيانات العملية لدى Paymob لا تطابق محاولة الدفع المسجلة.";
  if (reason === "paymob_paid_without_exact_signed_transaction") return "تظهر العملية مدفوعة لدى Paymob لكن بيانات التسوية الموقعة غير مكتملة.";
  if (reason.startsWith("paymob_")) return "تعذر إكمال المطابقة مع Paymob وتحتاج العملية مراجعة.";
  return String(value || "—");
}

export default function BookingCommissionsSection() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolutionPending, setResolutionPending] = useState<DisputeResolution | null>(null);
  const [resolutionError, setResolutionError] = useState("");
  const [resolutionNotice, setResolutionNotice] = useState("");
  const [reversalPending, setReversalPending] = useState<ReversalResolution | null>(null);
  const [reversalError, setReversalError] = useState("");
  const [reversalNotice, setReversalNotice] = useState("");

  const query = useQuery<AdminBookingCommissionsPayload>({
    queryKey: ["/api/admin/booking-commissions"],
    queryFn: () => bookingApiRequest<AdminBookingCommissionsPayload>("/api/admin/booking-commissions"),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const filteredBookings = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return (query.data?.bookings || []).filter((row) => {
      if (!matchesStatusFilter(row, statusFilter)) return false;
      if (!normalizedSearch) return true;
      return [row.propertyNumber, row.propertyName, row.requestCode, row.customerPhoneMasked, row.id]
        .some((value) => String(value || "").toLowerCase().includes(normalizedSearch));
    });
  }, [query.data?.bookings, search, statusFilter]);

  const selected = filteredBookings.find((row) => row.id === selectedId)
    || query.data?.bookings.find((row) => row.id === selectedId)
    || null;

  const selectBooking = (bookingId: string) => {
    if (resolutionPending !== null || reversalPending !== null) return;
    setSelectedId(selectedId === bookingId ? null : bookingId);
    setResolutionError("");
    setResolutionNotice("");
    setReversalError("");
    setReversalNotice("");
  };

  const resolveDispute = async (bookingId: string, resolution: DisputeResolution) => {
    setResolutionPending(resolution);
    setResolutionError("");
    setResolutionNotice("");
    try {
      const result = await bookingApiRequest<DisputeResolutionResponse>(
        `/api/admin/booking-commissions/${encodeURIComponent(bookingId)}/dispute`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resolution }),
        },
      );
      setResolutionNotice(resolution === "resume_collection"
        ? "تم رفض الاعتراض واستئناف تحصيل العمولة."
        : result.propertyReleased
          ? "تم قبول الاعتراض وإلغاء العمولة ورفع إيقاف العقار."
          : "تم قبول الاعتراض وإلغاء العمولة.");
      await query.refetch();
    } catch (error) {
      setResolutionError(error instanceof Error ? error.message : "تعذر معالجة الاعتراض. حاول مرة أخرى.");
    } finally {
      setResolutionPending(null);
    }
  };

  const resolveReversal = async (
    bookingId: string,
    attemptId: string,
    reversalTransactionId: string,
    resolution: ReversalResolution,
  ) => {
    setReversalPending(resolution);
    setReversalError("");
    setReversalNotice("");
    try {
      const result = await bookingApiRequest<ReversalResolutionResponse>(
        `/api/admin/booking-commissions/${encodeURIComponent(bookingId)}/reversal`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptId, reversalTransactionId, resolution }),
        },
      );
      setReversalNotice(resolution === "resume_collection"
        ? result.collectionNoticeScheduled
          ? "تم اعتماد عكس الدفعة وجدولة إشعار جديد لبدء تحصيل العمولة."
          : "تم اعتماد عكس الدفعة واستئناف تحصيل العمولة."
        : "تمت مراجعة العكس وإبقاء العمولة في حالة مدفوعة.");
      await query.refetch();
    } catch (error) {
      setReversalError(error instanceof Error ? error.message : "تعذر حسم مراجعة عكس الدفعة. حاول مرة أخرى.");
    } finally {
      setReversalPending(null);
    }
  };

  if (query.isLoading) {
    return (
      <div className="space-y-4" dir="rtl" role="status" aria-label="جاري تحميل الحجوزات والعمولات">
        <div className="h-8 w-64 animate-pulse rounded-md bg-muted" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-lg bg-muted" />)}
        </div>
        <div className="flex h-72 items-center justify-center rounded-lg border bg-card">
          <Loader2 className="h-7 w-7 animate-spin text-[#8b6b25]" />
        </div>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card className="p-8 text-center" dir="rtl">
        <AlertTriangle className="mx-auto h-9 w-9 text-destructive" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-bold">تعذر تحميل الحجوزات والعمولات</h1>
        <p className="mt-1 text-sm text-muted-foreground">تحقق من الاتصال ثم أعد المحاولة.</p>
        <Button type="button" variant="outline" onClick={() => query.refetch()} className="mt-4 gap-2">
          <RefreshCw className="h-4 w-4" />
          إعادة المحاولة
        </Button>
      </Card>
    );
  }

  const { summary } = query.data;
  const disputedCount = query.data.bookings.filter((row) => normalize(row.disputeStatus) === "pending").length;

  return (
    <section className="min-w-0 space-y-5" dir="rtl">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[#8b6b25]">
            <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
            <span className="text-xs font-semibold">متابعة ما بعد طلب واتساب</span>
          </div>
          <h1 className="text-2xl font-bold text-[#34332f]">الحجوزات والعمولات</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            تعرض نتيجة كل متابعة، بيانات الحجز المبلغ عنها، الرسائل، مهلة السداد، وحالة إيقاف العقار أو استمراره.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => query.refetch()} disabled={query.isFetching} className="w-fit gap-2">
          <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
          تحديث البيانات
        </Button>
      </div>

      <BookingCommissionSettingsCard />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
        <KpiCard label="الإجمالي" value={summary.total} icon={<ClipboardCheck className="h-4 w-4" />} tone="slate" />
        <KpiCard label="بانتظار الرد" value={summary.awaitingResponse} icon={<Clock3 className="h-4 w-4" />} tone="amber" />
        <KpiCard label="انتهت مهلة الرد" value={summary.expired} icon={<AlertTriangle className="h-4 w-4" />} tone="red" />
        <KpiCard label="لم يتم الحجز" value={summary.declined} icon={<XCircle className="h-4 w-4" />} tone="slate" />
        <KpiCard label="حجز مؤكد" value={summary.confirmed} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" />
        <KpiCard label="بانتظار السداد" value={summary.pending} icon={<CalendarClock className="h-4 w-4" />} tone="blue" />
        <KpiCard label="مسددة" value={summary.paid} icon={<WalletCards className="h-4 w-4" />} tone="green" />
        <KpiCard label="متأخرة" value={summary.overdue} icon={<AlertTriangle className="h-4 w-4" />} tone="red" />
        <KpiCard label="عقارات موقوفة" value={summary.paused} icon={<PauseCircle className="h-4 w-4" />} tone="red" />
        <KpiCard label="اعتراضات معلقة" value={disputedCount} icon={<AlertTriangle className="h-4 w-4" />} tone="violet" />
      </div>

      <div className="grid gap-3 lg:grid-cols-4">
        <MoneyCard label="قيمة الحجوزات المبلغ عنها" value={summary.reportedValueHalalas} note="بيانات مبلغ عنها من العملاء" />
        <MoneyCard label="العمولة المستحقة" value={summary.commissionDueHalalas} note="إجمالي ما لم يُسدد" />
        <MoneyCard label="العمولة المسددة" value={summary.commissionPaidHalalas} note="دفعات مؤكدة" success />
        <Card className="border-amber-200 bg-amber-50 p-4 text-amber-800">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold">رسائل منعها الحد</p>
              <p className="mt-2 text-2xl font-bold">{summary.notificationSuppressed}</p>
              <p className="mt-1 text-[11px]">لم تُحسب كرسائل مرسلة</p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/70"><BellOff className="h-5 w-5" /></span>
          </div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ابحث بالعقار أو كود الطلب..."
              className="pr-9"
              data-testid="input-search-booking-commissions"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
            <SelectTrigger data-testid="select-booking-commission-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              <SelectItem value="awaiting">بانتظار الرد</SelectItem>
              <SelectItem value="expired">انتهت مهلة الرد</SelectItem>
              <SelectItem value="declined">لم يتم الحجز</SelectItem>
              <SelectItem value="confirmed">حجز مؤكد</SelectItem>
              <SelectItem value="pending">بانتظار السداد</SelectItem>
              <SelectItem value="paid">مسددة</SelectItem>
              <SelectItem value="overdue">متأخرة</SelectItem>
              <SelectItem value="paused">العقار موقوف</SelectItem>
              <SelectItem value="disputed">اعتراضات</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="outline" className="h-10 justify-center px-3">{filteredBookings.length} سجل</Badge>
        </div>
      </Card>

      {filteredBookings.length === 0 ? (
        <Card className="border-dashed p-8 text-center">
          <ClipboardCheck className="mx-auto h-9 w-9 text-muted-foreground/60" aria-hidden="true" />
          <p className="mt-3 font-semibold text-[#34332f]">لا توجد سجلات مطابقة</p>
          <p className="mt-1 text-sm text-muted-foreground">غيّر البحث أو الفلتر لعرض نتائج أخرى.</p>
        </Card>
      ) : (
        <>
          <Card className="hidden min-w-0 overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] text-sm">
                <thead className="border-b bg-muted/40 text-right text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 font-semibold">العقار والطلب</th>
                    <th className="p-3 font-semibold">العميل</th>
                    <th className="p-3 font-semibold">نتيجة الحجز</th>
                    <th className="p-3 font-semibold">العمولة</th>
                    <th className="p-3 font-semibold">المهلة</th>
                    <th className="p-3 font-semibold">حالة العقار</th>
                    <th className="p-3 font-semibold">الرسائل</th>
                    <th className="p-3 font-semibold">التفاصيل</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredBookings.map((row) => <BookingTableRow key={row.id} row={row} selected={selectedId === row.id} onSelect={() => selectBooking(row.id)} selectionDisabled={resolutionPending !== null || reversalPending !== null} />)}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="space-y-3 md:hidden">
            {filteredBookings.map((row) => <BookingMobileRow key={row.id} row={row} selected={selectedId === row.id} onSelect={() => selectBooking(row.id)} selectionDisabled={resolutionPending !== null || reversalPending !== null} />)}
          </div>

          {selected && (
            <BookingAdminDetails
              row={selected}
              onClose={() => {
                setSelectedId(null);
                setResolutionError("");
                setResolutionNotice("");
                setReversalError("");
                setReversalNotice("");
              }}
              onResolveDispute={resolveDispute}
              onResolveReversal={resolveReversal}
              onNotificationResent={async () => {
                await query.refetch();
              }}
              resolutionPending={resolutionPending}
              resolutionError={resolutionError}
              resolutionNotice={resolutionNotice}
              reversalPending={reversalPending}
              reversalError={reversalError}
              reversalNotice={reversalNotice}
            />
          )}
        </>
      )}
    </section>
  );
}

function KpiCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: "slate" | "amber" | "green" | "blue" | "red" | "violet" }) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    red: "border-red-200 bg-red-50 text-red-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
  } as const;
  return (
    <Card className={`min-w-0 p-3 ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/70">{icon}</span>
        <span className="text-2xl font-bold">{value}</span>
      </div>
      <p className="mt-2 truncate text-[11px] font-semibold">{label}</p>
    </Card>
  );
}

function MoneyCard({ label, value, note, success = false }: { label: string; value: number; note: string; success?: boolean }) {
  return (
    <Card className={`p-4 ${success ? "border-emerald-200 bg-emerald-50" : "border-[#ded2b5] bg-[#fffdf7]"}`}>
      <p className={`text-xs font-semibold ${success ? "text-emerald-700" : "text-[#77663a]"}`}>{label}</p>
      <p className={`mt-2 text-xl font-bold ${success ? "text-emerald-700" : "text-[#34332f]"}`}>{formatSarFromHalalas(value)}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>
    </Card>
  );
}

function BookingTableRow({ row, selected, onSelect, selectionDisabled }: { row: BookingDisplayRow; selected: boolean; onSelect: () => void; selectionDisabled: boolean }) {
  const booking = getBookingStatusMeta(row.bookingStatus);
  const commission = getCommissionStatusMeta(row.commissionStatus);
  const compliance = getComplianceStatusMeta(row.complianceStatus);
  const disputed = normalize(row.disputeStatus) === "pending";
  const duplicatePayment = hasBookingEvent(row, "commission_duplicate_payment") || normalize(row.paymentAttempt?.status) === "duplicate_paid";
  const reversalState = reversalReviewState(row);
  const authorizationReported = hasBookingEvent(row, "commission_payment_authorized")
    || Boolean(row.paymentAttempt?.authorizationTransactionId || row.paymentAttempt?.authorizedAt)
    || normalize(row.paymentAttempt?.reversalStatus) === "authorization_only";
  const responseExpired = normalize(row.bookingStatus) === "expired"
    || hasBookingEvent(row, "customer_followup_expired");
  const ownerIdentityChanged = normalize(row.disputeReason) === "owner_identity_changed"
    || normalize(row.enforcementLastError) === "owner_identity_changed"
    || hasBookingEvent(row, "owner_identity_changed");
  return (
    <tr className={selected ? "bg-[#fff9e9]" : "hover:bg-muted/20"}>
      <td className="p-3">
        <p className="max-w-52 truncate font-bold text-[#34332f]">{getPropertyLabel(row)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{row.propertyNumber}{row.requestCode ? ` · ${row.requestCode}` : ""}</p>
      </td>
      <td className="p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground" dir="ltr">{row.customerPhoneMasked || "—"}</span>
          <CustomerWhatsAppLink bookingId={row.id} />
        </div>
      </td>
      <td className="p-3"><StatusBadge label={booking.label} tone={booking.tone} /></td>
      <td className="p-3">
        <StatusBadge label={commission.label} tone={commission.tone} />
        {disputed && !ownerIdentityChanged && <div className="mt-1"><StatusBadge label="اعتراض معلق" tone="violet" /></div>}
        {ownerIdentityChanged && <div className="mt-1"><StatusBadge label="تغيرت هوية المالك" tone="violet" /></div>}
        {responseExpired && normalize(row.bookingStatus) !== "expired" && <div className="mt-1"><StatusBadge label="انتهت مهلة الرد" tone="red" /></div>}
        {authorizationReported && <div className="mt-1"><StatusBadge label="تفويض دفع" tone="blue" /></div>}
        {duplicatePayment && <div className="mt-1"><StatusBadge label="دفعة مكررة" tone="red" /></div>}
        {reversalState === "unresolved" && <div className="mt-1"><StatusBadge label="عكس دفعة يحتاج مراجعة" tone="red" /></div>}
        {reversalState === "kept_paid" && <div className="mt-1"><StatusBadge label="تمت مراجعة العكس" tone="green" /></div>}
        {reversalState === "collection_resumed" && <div className="mt-1"><StatusBadge label="استؤنف التحصيل" tone="blue" /></div>}
        {Number(row.commissionAmountHalalas) > 0 && <p className="mt-1 text-xs font-bold">{formatSarFromHalalas(row.commissionAmountHalalas)}</p>}
      </td>
      <td className="p-3 text-xs text-muted-foreground">{formatDateTime(row.dueAt)}</td>
      <td className="p-3"><StatusBadge label={compliance.label} tone={compliance.tone} /></td>
      <td className="p-3"><NotificationSummaryView summary={row.notificationSummary} /></td>
      <td className="p-3">
        <Button type="button" size="sm" variant="outline" onClick={onSelect} disabled={selectionDisabled} aria-expanded={selected} data-testid={`button-booking-details-${row.id}`}>
          {selected ? "إخفاء" : "عرض"}
        </Button>
      </td>
    </tr>
  );
}

function BookingMobileRow({ row, selected, onSelect, selectionDisabled }: { row: BookingDisplayRow; selected: boolean; onSelect: () => void; selectionDisabled: boolean }) {
  const booking = getBookingStatusMeta(row.bookingStatus);
  const commission = getCommissionStatusMeta(row.commissionStatus);
  const disputed = normalize(row.disputeStatus) === "pending";
  const duplicatePayment = hasBookingEvent(row, "commission_duplicate_payment") || normalize(row.paymentAttempt?.status) === "duplicate_paid";
  const reversalState = reversalReviewState(row);
  const authorizationReported = hasBookingEvent(row, "commission_payment_authorized")
    || Boolean(row.paymentAttempt?.authorizationTransactionId || row.paymentAttempt?.authorizedAt)
    || normalize(row.paymentAttempt?.reversalStatus) === "authorization_only";
  const responseExpired = normalize(row.bookingStatus) === "expired"
    || hasBookingEvent(row, "customer_followup_expired");
  const ownerIdentityChanged = normalize(row.disputeReason) === "owner_identity_changed"
    || normalize(row.enforcementLastError) === "owner_identity_changed"
    || hasBookingEvent(row, "owner_identity_changed");
  return (
    <Card className={selected ? "border-[#cdb46e] bg-[#fffdf6]" : ""}>
      <div className="p-4">
        <button type="button" onClick={onSelect} disabled={selectionDisabled} aria-expanded={selected} className="w-full text-right disabled:cursor-not-allowed disabled:opacity-60">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-bold text-[#34332f]">{getPropertyLabel(row)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{row.propertyNumber}{row.requestCode ? ` · ${row.requestCode}` : ""}</p>
            </div>
            <ChevronDown className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${selected ? "rotate-180" : ""}`} aria-hidden="true" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <StatusBadge label={booking.label} tone={booking.tone} />
            <StatusBadge label={commission.label} tone={commission.tone} />
            {disputed && !ownerIdentityChanged && <StatusBadge label="اعتراض معلق" tone="violet" />}
            {ownerIdentityChanged && <StatusBadge label="تغيرت هوية المالك" tone="violet" />}
            {responseExpired && normalize(row.bookingStatus) !== "expired" && <StatusBadge label="انتهت مهلة الرد" tone="red" />}
            {authorizationReported && <StatusBadge label="تفويض دفع" tone="blue" />}
            {duplicatePayment && <StatusBadge label="دفعة مكررة" tone="red" />}
            {reversalState === "unresolved" && <StatusBadge label="عكس دفعة يحتاج مراجعة" tone="red" />}
            {reversalState === "kept_paid" && <StatusBadge label="تمت مراجعة العكس" tone="green" />}
            {reversalState === "collection_resumed" && <StatusBadge label="استؤنف التحصيل" tone="blue" />}
          </div>
          {Number(row.commissionAmountHalalas) > 0 && <p className="mt-3 text-sm font-bold text-[#34332f]">{formatSarFromHalalas(row.commissionAmountHalalas)}</p>}
        </button>
        <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
          <span className="text-xs text-muted-foreground"><span>رقم العميل: </span><span dir="ltr">{row.customerPhoneMasked || "—"}</span></span>
          <CustomerWhatsAppLink bookingId={row.id} />
        </div>
      </div>
    </Card>
  );
}

function BookingAdminDetails({
  row,
  onClose,
  onResolveDispute,
  onResolveReversal,
  onNotificationResent,
  resolutionPending,
  resolutionError,
  resolutionNotice,
  reversalPending,
  reversalError,
  reversalNotice,
}: {
  row: BookingDisplayRow;
  onClose: () => void;
  onResolveDispute: (bookingId: string, resolution: DisputeResolution) => Promise<void>;
  onResolveReversal: (
    bookingId: string,
    attemptId: string,
    reversalTransactionId: string,
    resolution: ReversalResolution,
  ) => Promise<void>;
  onNotificationResent: () => Promise<void>;
  resolutionPending: DisputeResolution | null;
  resolutionError: string;
  resolutionNotice: string;
  reversalPending: ReversalResolution | null;
  reversalError: string;
  reversalNotice: string;
}) {
  const booking = getBookingStatusMeta(row.bookingStatus);
  const commission = getCommissionStatusMeta(row.commissionStatus);
  const compliance = getComplianceStatusMeta(row.complianceStatus);
  const disputeStatus = normalize(row.disputeStatus);
  const hasDispute = ["pending", "rejected", "accepted"].includes(disputeStatus) || Boolean(row.disputedAt);
  const paymentAttempt = row.paymentAttempt;
  const ownerIdentityChanged = normalize(row.disputeReason) === "owner_identity_changed"
    || normalize(row.enforcementLastError) === "owner_identity_changed"
    || hasBookingEvent(row, "owner_identity_changed");
  const responseExpired = normalize(row.bookingStatus) === "expired"
    || hasBookingEvent(row, "customer_followup_expired");
  const authorizationReported = hasBookingEvent(row, "commission_payment_authorized")
    || Boolean(paymentAttempt?.authorizationTransactionId || paymentAttempt?.authorizedAt)
    || normalize(paymentAttempt?.reversalStatus) === "authorization_only";
  const duplicatePaymentReported = hasBookingEvent(row, "commission_duplicate_payment")
    || normalize(paymentAttempt?.status) === "duplicate_paid";
  const reversalEventDetail = findLatestBookingEvent(row, ["commission_payment_reversal_reported"])?.detail || null;
  const reversalStatus = paymentAttempt?.reversalStatus || reversalEventDetail;
  const reversalState = reversalReviewState(row);
  const unresolvedReversal = reversalState === "unresolved";
  const resolvedReversalEvent = reversalState === "kept_paid"
    ? findLatestBookingEvent(row, ["commission_payment_reversal_kept_paid"])
    : reversalState === "collection_resumed"
      ? findLatestBookingEvent(row, ["commission_payment_reversal_collection_resumed"])
      : null;
  const reversalResolvedAt = paymentAttempt?.reversalResolvedAt
    || resolvedReversalEvent?.at
    || resolvedReversalEvent?.timestamp
    || resolvedReversalEvent?.createdAt;
  const isCanonicalPaidAttempt = Boolean(
    paymentAttempt?.id
      && row.paidAttemptId
      && paymentAttempt.id === row.paidAttemptId
      && normalize(row.commissionStatus) === "paid"
      && ["paid", "duplicate_paid"].includes(normalize(paymentAttempt.status)),
  );
  const hasReversalIdentity = Boolean(paymentAttempt?.id && paymentAttempt?.reversalTransactionId);
  const canKeepPaid = unresolvedReversal
    && isCanonicalPaidAttempt
    && hasReversalIdentity
    && normalize(reversalStatus) !== "authorization_only";
  const canResumeCollection = canKeepPaid && normalize(paymentAttempt?.status) !== "duplicate_paid";
  const financialReviewRequired = unresolvedReversal
    && normalize(row.enforcementLastError).startsWith("commission_payment_");
  const hideResolvedFinancialError = reversalState !== "none"
    && reversalState !== "unresolved"
    && normalize(row.enforcementLastError).startsWith("commission_payment_");
  const hideInformationalAuthorizationError = authorizationReported
    && normalize(row.enforcementLastError) === "commission_payment_authorization_only_requires_admin_review";
  const showEnforcementIssue = Boolean(row.enforcementLastError || row.enforcementDeferredUntil)
    && !hideResolvedFinancialError
    && !hideInformationalAuthorizationError
    && !ownerIdentityChanged;
  return (
    <Card className="overflow-hidden border-[#d6c18a]" data-testid="booking-commission-details">
      <div className="flex items-start justify-between gap-3 border-b bg-[#fff9e9] p-4 sm:p-5">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#8b6b25]">تفاصيل المتابعة</p>
          <h2 className="mt-1 truncate text-lg font-bold text-[#34332f]">{getPropertyLabel(row)}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{row.propertyNumber}{row.requestCode ? ` · ${row.requestCode}` : ""}</p>
        </div>
        <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={resolutionPending !== null || reversalPending !== null}>إغلاق</Button>
      </div>
      <div className="grid gap-6 p-4 sm:p-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,.85fr)]">
        <div className="min-w-0 space-y-6">
          <section>
            <h3 className="mb-3 text-sm font-bold text-[#34332f]">ما الذي حدث؟</h3>
            <div className="flex flex-wrap gap-2">
              <StatusBadge label={booking.label} tone={booking.tone} />
              <StatusBadge label={commission.label} tone={commission.tone} />
              <StatusBadge label={compliance.label} tone={compliance.tone} />
              {disputeStatus === "pending" && !ownerIdentityChanged && <StatusBadge label="اعتراض معلق" tone="violet" />}
              {disputeStatus === "rejected" && <StatusBadge label="اعتراض مرفوض" tone="red" />}
              {disputeStatus === "accepted" && <StatusBadge label="اعتراض مقبول" tone="green" />}
              {ownerIdentityChanged && <StatusBadge label="تغيرت هوية المالك" tone="violet" />}
              {responseExpired && normalize(row.bookingStatus) !== "expired" && <StatusBadge label="انتهت مهلة الرد" tone="red" />}
              {authorizationReported && <StatusBadge label="تفويض دفع" tone="blue" />}
              {reversalState === "unresolved" && <StatusBadge label="عكس دفعة يحتاج مراجعة" tone="red" />}
              {reversalState === "kept_paid" && <StatusBadge label="تمت مراجعة العكس" tone="green" />}
              {reversalState === "collection_resumed" && <StatusBadge label="استؤنف التحصيل" tone="blue" />}
            </div>
          </section>
          <section className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">رقم العميل</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="break-words text-sm font-bold text-[#34332f]" dir="ltr">{row.customerPhoneMasked || "—"}</p>
                <CustomerWhatsAppLink bookingId={row.id} />
              </div>
            </div>
            <AdminFact label="نوع العقار" value={row.isFreeProperty ? "عقار مجاني" : "عقار باشتراك"} />
          </section>
          <section>
            <h3 className="mb-3 text-sm font-bold text-[#34332f]">الحقائق المسجلة من العميل</h3>
            <QuestionnaireFacts questionnaire={row.questionnaire || row.confirmationFacts} />
          </section>
          <section className="grid gap-3 sm:grid-cols-3">
            <AdminFact label="طلب التواصل" value={formatDateTime(row.contactAt)} />
            <AdminFact label="موعد متابعة العميل" value={formatDateTime(row.followUpDueAt)} />
            <AdminFact label="تأكيد النتيجة" value={formatDateTime(row.confirmedAt || row.declinedAt || row.answeredAt)} />
            <AdminFact label="العمولة" value={formatSarFromHalalas(row.commissionAmountHalalas)} />
            <AdminFact label="بداية مهلة السداد" value={formatDateTime(row.commissionNoticeSentAt)} />
            <AdminFact label="نهاية المهلة" value={formatDateTime(row.dueAt)} />
            <AdminFact label="تاريخ السداد" value={formatDateTime(row.commissionPaidAt)} />
            <AdminFact
              label="تذكيرات الأيام المرسلة"
              value={row.commissionReminderOffsetsSent?.length
                ? row.commissionReminderOffsetsSent.map((day) => `اليوم ${day}`).join("، ")
                : "—"}
            />
          </section>
          {responseExpired && (
            <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
              <h3 className="text-sm font-bold">انتهت مهلة رد العميل</h3>
              <p className="mt-2 text-xs leading-5">لم تُسجل إجابة العميل قبل انتهاء صلاحية رابط المتابعة، ولا يمكن استخدام الرابط لتأكيد نتيجة الحجز بعد ذلك.</p>
            </section>
          )}
          {authorizationReported && (
            <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-800">
              <h3 className="text-sm font-bold">تم تسجيل تفويض دفع فقط</h3>
              <p className="mt-2 text-xs leading-5">التفويض وحده لا يُعد تحصيلاً نهائياً للعمولة ولا يحتاج إلى إجراء حسم عكس دفعة.</p>
              {paymentAttempt?.authorizationTransactionId && <p className="mt-2 break-words text-[11px]">رقم عملية التفويض: {paymentAttempt.authorizationTransactionId}</p>}
              {paymentAttempt?.authorizedAt && <p className="mt-1 text-[11px]">تاريخ التفويض: {formatDateTime(paymentAttempt.authorizedAt)}</p>}
            </section>
          )}
          {ownerIdentityChanged && !hasDispute && (
            <section className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-violet-800">
              <h3 className="text-sm font-bold">تغيرت هوية مالك العقار</h3>
              <p className="mt-2 text-xs leading-5">توقفت الإشعارات والإجراءات المرتبطة بهذا الحجز بعد تغير بيانات المالك. تحقق من المالك الحالي قبل أي متابعة يدوية.</p>
            </section>
          )}
          {hasDispute && (
            <section className={`rounded-xl border p-4 ${disputeStatus === "rejected"
              ? "border-red-200 bg-red-50 text-red-800"
              : disputeStatus === "accepted"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-violet-200 bg-violet-50 text-violet-800"}`}>
              <h3 className="text-sm font-bold">
                {ownerIdentityChanged
                  ? disputeStatus === "rejected"
                    ? "تم التحقق من المالك واستئناف التحصيل"
                    : disputeStatus === "accepted"
                      ? "تم إلغاء العمولة بعد مراجعة هوية المالك"
                      : "تغيرت هوية مالك العقار وتحتاج مراجعة"
                  : disputeStatus === "rejected"
                    ? "تم رفض الاعتراض"
                    : disputeStatus === "accepted"
                      ? "تم قبول الاعتراض وإلغاء العمولة"
                      : "اعتراض بانتظار مراجعة الإدارة"}
              </h3>
              {row.disputeReason && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-5">
                {ownerIdentityChanged
                  ? "تغيرت بيانات مالك العقار منذ إنشاء طلب التواصل، لذلك توقفت الإشعارات وإجراءات التحصيل لحين التحقق."
                  : row.disputeReason}
              </p>}
              {row.disputedAt && <p className="mt-2 text-[11px]">تاريخ الاعتراض: {formatDateTime(row.disputedAt)}</p>}
              {disputeStatus === "pending" && (
                <>
                  <p className="mt-2 text-[11px] font-semibold">
                    {ownerIdentityChanged
                      ? "لا يمكن استئناف التحصيل من هذا السجل ما دامت هوية المالك الحالي لا تطابق لقطة المالك الأصلية المسجلة عند إنشاء طلب التواصل."
                      : normalize(row.complianceStatus) === "paused"
                      ? "العقار موقوف بالفعل، ولن تُرسل تذكيرات جديدة أثناء المراجعة."
                      : "تذكيرات التحصيل وإيقاف العقار مؤجلة أثناء المراجعة."}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {!ownerIdentityChanged && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button type="button" size="sm" variant="outline" disabled={resolutionPending !== null || reversalPending !== null}>
                            {resolutionPending === "resume_collection" && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                            رفض الاعتراض واستئناف التحصيل
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent dir="rtl">
                          <AlertDialogHeader className="text-right sm:text-right">
                            <AlertDialogTitle>تأكيد استئناف تحصيل العمولة</AlertDialogTitle>
                            <AlertDialogDescription>
                              سيُرفض اعتراض المالك وتعود تذكيرات التحصيل. إذا انتهت المهلة دون سداد فقد يتم إيقاف العقار.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter className="gap-2 sm:space-x-0">
                            <AlertDialogCancel>رجوع</AlertDialogCancel>
                            <AlertDialogAction onClick={() => void onResolveDispute(row.id, "resume_collection")}>
                              تأكيد الاستئناف
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" size="sm" variant="destructive" disabled={resolutionPending !== null || reversalPending !== null}>
                          {resolutionPending === "cancel_commission" && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                          {ownerIdentityChanged ? "إلغاء العمولة لهذه الحالة" : "قبول الاعتراض وإلغاء العمولة"}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent dir="rtl">
                        <AlertDialogHeader className="text-right sm:text-right">
                          <AlertDialogTitle>{ownerIdentityChanged ? "تأكيد إلغاء العمولة لهذه الحالة" : "تأكيد إلغاء العمولة"}</AlertDialogTitle>
                          <AlertDialogDescription>
                            {ownerIdentityChanged
                              ? "ستُلغى العمولة ويُرفع هذا الالتزام عن العقار لأن التحصيل لا يمكن استئنافه من سجل لا تطابق لقطة مالكه الأصلية المالك الحالي. لا يمكن تنفيذ الإلغاء عند وجود محاولة دفع تحتاج مراجعة مالية."
                              : "سيُقبل الاعتراض وتُلغى العمولة ويُرفع هذا الالتزام عن العقار. لا يمكن تنفيذ الإلغاء عند وجود محاولة دفع تحتاج مراجعة مالية."}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="gap-2 sm:space-x-0">
                          <AlertDialogCancel>رجوع</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => void onResolveDispute(row.id, "cancel_commission")}
                          >
                            تأكيد إلغاء العمولة
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </>
              )}
            </section>
          )}
          {resolutionNotice && <p className="rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-800" role="status">{resolutionNotice}</p>}
          {resolutionError && <p className="rounded-lg bg-red-50 p-3 text-sm font-medium text-destructive" role="alert">{resolutionError}</p>}
          {duplicatePaymentReported && (
            <section className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900" role="alert">
              <h3 className="text-sm font-bold">مراجعة دفعة مكررة مطلوبة</h3>
              <p className="mt-2 text-xs leading-5">تم رصد نجاح مالي إضافي لهذا الحجز. راجع العملية وحدد إجراء الاسترداد المناسب.</p>
            </section>
          )}
          {unresolvedReversal && (
            <section className="rounded-xl border border-orange-300 bg-orange-50 p-4 text-orange-900" role="alert">
              <h3 className="text-sm font-bold">مراجعة عكس دفعة مطلوبة</h3>
              <p className="mt-2 text-xs leading-5">{getPaymentReversalStatusLabel(reversalStatus)}. طابق العملية مع كشف مزود الدفع قبل حسم الحالة.</p>
              {paymentAttempt?.reversalTransactionId && <p className="mt-2 break-words text-[11px]">رقم عملية العكس: {paymentAttempt.reversalTransactionId}</p>}
              {paymentAttempt?.reversedAt && <p className="mt-1 text-[11px]">تاريخ العكس: {formatDateTime(paymentAttempt.reversedAt)}</p>}
              {canKeepPaid ? (
                <>
                  {!canResumeCollection && normalize(paymentAttempt?.status) === "duplicate_paid" && (
                    <p className="mt-3 rounded-lg bg-white/70 p-3 text-xs font-semibold leading-5">لا يمكن استئناف التحصيل من محاولة مصنفة كدفعة مكررة. يمكن إبقاء العمولة مدفوعة بعد مطابقة التسوية، أو إكمال المراجعة المالية يدوياً.</p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {canResumeCollection && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button type="button" size="sm" variant="destructive" disabled={reversalPending !== null || resolutionPending !== null}>
                            {reversalPending === "resume_collection" && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                            اعتماد العكس واستئناف التحصيل
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent dir="rtl">
                          <AlertDialogHeader className="text-right sm:text-right">
                            <AlertDialogTitle>تأكيد استئناف تحصيل العمولة بعد العكس</AlertDialogTitle>
                            <AlertDialogDescription>
                              نفّذ هذا الإجراء فقط بعد مطابقة عكس العملية مع كشف مزود الدفع. ستتغير العمولة من مدفوعة إلى بانتظار السداد ويُجدول إشعار جديد للمالك. تبدأ مهلة الخمسة أيام بعد قبول مزود واتساب للإشعار الجديد للإرسال، وقد يتم إيقاف العقار إذا انتهت المهلة دون سداد.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter className="gap-2 sm:space-x-0">
                            <AlertDialogCancel>رجوع</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              onClick={() => void onResolveReversal(
                                row.id,
                                paymentAttempt?.id || "",
                                paymentAttempt?.reversalTransactionId || "",
                                "resume_collection",
                              )}
                            >
                              تأكيد العكس واستئناف التحصيل
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" size="sm" variant="outline" disabled={reversalPending !== null || resolutionPending !== null}>
                          {reversalPending === "keep_paid" && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                          إبقاء العمولة مدفوعة
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent dir="rtl">
                        <AlertDialogHeader className="text-right sm:text-right">
                          <AlertDialogTitle>تأكيد إبقاء العمولة مدفوعة</AlertDialogTitle>
                          <AlertDialogDescription>
                            نفّذ هذا الإجراء فقط بعد التحقق من التسوية المالية لدى مزود الدفع. سيُغلق تنبيه العكس وتبقى العمولة مدفوعة، ولن يبدأ تحصيل جديد لهذا العكس.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="gap-2 sm:space-x-0">
                          <AlertDialogCancel>رجوع</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void onResolveReversal(
                            row.id,
                            paymentAttempt?.id || "",
                            paymentAttempt?.reversalTransactionId || "",
                            "keep_paid",
                          )}>
                            تأكيد إبقاء الحالة مدفوعة
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </>
              ) : (
                <p className="mt-3 rounded-lg bg-white/70 p-3 text-xs font-semibold leading-5">لا تتوفر مطابقة كاملة مع محاولة الدفع الأساسية لهذا الحجز. لا تنفذ تغييراً من هذه الشاشة وأكمل المراجعة المالية يدوياً.</p>
              )}
            </section>
          )}
          {reversalState === "kept_paid" && (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800" role="status">
              <h3 className="text-sm font-bold">تمت معالجة العكس وإبقاء العمولة مدفوعة</h3>
              <p className="mt-2 text-xs leading-5">أُغلقت المراجعة المالية لهذا العكس دون بدء تحصيل جديد.</p>
              {(paymentAttempt?.reversalTransactionId || resolvedReversalEvent?.detail) && <p className="mt-2 break-words text-[11px]">رقم عملية العكس: {paymentAttempt?.reversalTransactionId || resolvedReversalEvent?.detail}</p>}
              {reversalResolvedAt && <p className="mt-1 text-[11px]">تاريخ الحسم: {formatDateTime(reversalResolvedAt)}</p>}
            </section>
          )}
          {reversalState === "collection_resumed" && (
            <section className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-800" role="status">
              <h3 className="text-sm font-bold">تمت معالجة العكس واستئناف التحصيل</h3>
              <p className="mt-2 text-xs leading-5">أُغلقت المراجعة المالية وبدأت دورة تحصيل جديدة. تبدأ مهلة السداد بعد قبول مزود واتساب للإشعار الجديد للإرسال.</p>
              {(paymentAttempt?.reversalTransactionId || resolvedReversalEvent?.detail) && <p className="mt-2 break-words text-[11px]">رقم عملية العكس: {paymentAttempt?.reversalTransactionId || resolvedReversalEvent?.detail}</p>}
              {reversalResolvedAt && <p className="mt-1 text-[11px]">تاريخ الحسم: {formatDateTime(reversalResolvedAt)}</p>}
            </section>
          )}
          {reversalNotice && <p className="rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-800" role="status">{reversalNotice}</p>}
          {reversalError && <p className="rounded-lg bg-red-50 p-3 text-sm font-medium text-destructive" role="alert">{reversalError}</p>}
          {showEnforcementIssue && (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800">
              <h3 className="text-sm font-bold">{financialReviewRequired ? "مراجعة مالية مطلوبة" : "تعذر تنفيذ الإيقاف تلقائياً"}</h3>
              {row.enforcementLastError && <p className="mt-2 break-words text-xs leading-5">{enforcementIssueMessage(row.enforcementLastError)}</p>}
              {row.enforcementDeferredUntil && <p className="mt-2 text-[11px]">المحاولة التالية: {formatDateTime(row.enforcementDeferredUntil)}</p>}
            </section>
          )}
          {paymentAttempt && (
            <section>
              <h3 className="mb-3 text-sm font-bold text-[#34332f]">آخر محاولة دفع</h3>
              <BookingBankTransferReview
                bookingId={row.id}
                attempt={paymentAttempt}
                onChanged={onNotificationResent}
              />
              {(row.paymentAttempts?.length || 0) > 1 && <p className="mb-3 text-xs leading-5 text-muted-foreground">هذه هي المحاولة التي اختارها النظام للعرض المباشر والمراجعة. يظهر السجل الكامل أدناه.</p>}
              <div className="grid gap-3 rounded-xl border bg-muted/15 p-4 sm:grid-cols-2">
                <AdminFact label="حالة المحاولة" value={paymentAttemptStatusLabel(paymentAttempt.status)} />
                <AdminFact label="مبلغ المحاولة" value={formatSarFromHalalas(paymentAttempt.amountCents)} />
                <AdminFact label="طريقة الدفع" value={paymentMethodLabel(paymentAttempt.paymentMethod)} />
                <AdminFact label="طريقة التسوية الفعلية" value={paymentAttempt.exactPaymentMethod || "—"} />
                <AdminFact label="رقم المحاولة" value={paymentAttempt.id || "—"} />
                <AdminFact label="رقم نية الدفع" value={paymentAttempt.intentionId || "—"} />
                <AdminFact label="رقم طلب المزود" value={paymentAttempt.paymobOrderId || "—"} />
                <AdminFact label="رقم العملية" value={paymentAttempt.transactionId || "—"} />
                <AdminFact label="تاريخ العملية لدى المزود" value={formatDateTime(paymentAttempt.providerCreatedAt)} />
                <AdminFact label="تاريخ الدفع" value={formatDateTime(paymentAttempt.paidAt)} />
                <AdminFact label="رقم عملية التفويض" value={paymentAttempt.authorizationTransactionId || "—"} />
                <AdminFact label="تاريخ التفويض" value={formatDateTime(paymentAttempt.authorizedAt)} />
                <AdminFact label="الحالة غير القابلة للاحتساب" value={paymentAttempt.nonPayableStatus ? getPaymentReversalStatusLabel(paymentAttempt.nonPayableStatus) : "—"} />
                <AdminFact label="رقم العملية غير المحتسبة" value={paymentAttempt.nonPayableTransactionId || "—"} />
                <AdminFact label="تاريخ الحالة غير المحتسبة" value={formatDateTime(paymentAttempt.nonPayableAt)} />
                <AdminFact label="حالة عكس الدفعة" value={paymentAttempt.reversalStatus ? getPaymentReversalStatusLabel(paymentAttempt.reversalStatus) : "—"} />
                <AdminFact label="رقم عملية العكس" value={paymentAttempt.reversalTransactionId || "—"} />
                <AdminFact label="تاريخ العكس" value={formatDateTime(paymentAttempt.reversedAt)} />
                <AdminFact label="قرار مراجعة العكس" value={reversalResolutionLabel(paymentAttempt.reversalResolution)} />
                <AdminFact label="تاريخ حسم العكس" value={formatDateTime(paymentAttempt.reversalResolvedAt)} />
                <AdminFact label="آخر تحديث" value={formatDateTime(paymentAttempt.updatedAt)} />
              </div>
              {paymentAttempt.failureReason && <p className="mt-2 rounded-lg bg-red-50 p-3 text-xs text-red-800">{paymentFailureReasonLabel(paymentAttempt.failureReason)}</p>}
            </section>
          )}
          {(row.paymentAttempts?.length || 0) > 0 && (
            <AdminPaymentAttemptHistory
              key={`payment-history-${row.id}`}
              attempts={row.paymentAttempts || []}
              selectedAttemptId={row.paymentAttempt?.id || null}
              activeAttemptId={row.activeAttemptId || null}
              paidAttemptId={row.paidAttemptId || null}
            />
          )}
          <section>
            <h3 className="mb-2 text-sm font-bold text-[#34332f]">نتيجة إرسال الرسائل</h3>
            <NotificationSummaryView summary={row.notificationSummary} />
          </section>
          {(row.notificationJobs?.length || 0) > 0 && (
            <AdminNotificationHistory
              key={`notification-history-${row.id}`}
              bookingId={row.id}
              jobs={row.notificationJobs || []}
              onResent={onNotificationResent}
            />
          )}
        </div>
        <section className="min-w-0 rounded-xl border bg-muted/15 p-4">
          <h3 className="mb-4 text-sm font-bold text-[#34332f]">التسلسل الزمني والإجراءات</h3>
          <BookingTimeline row={row} />
        </section>
      </div>
    </Card>
  );
}

function createNotificationResendKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (!globalThis.crypto) {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function AdminNotificationHistory({
  bookingId,
  jobs,
  onResent,
}: {
  bookingId: string;
  jobs: BookingAdminNotificationJob[];
  onResent: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(10);
  const [resendPendingId, setResendPendingId] = useState<string | null>(null);
  const [resendError, setResendError] = useState("");
  const [resendNotice, setResendNotice] = useState("");
  const resendKeys = useRef<Record<string, string>>({});
  const visibleJobs = jobs.slice(0, visibleCount);
  const remaining = Math.max(0, jobs.length - visibleJobs.length);

  const resend = async (job: BookingAdminNotificationJob) => {
    if (!job.id || resendPendingId) return;
    const idempotencyKey = resendKeys.current[job.id] ||
      createNotificationResendKey();
    resendKeys.current[job.id] = idempotencyKey;
    setResendPendingId(job.id);
    setResendError("");
    setResendNotice("");
    try {
      await bookingApiRequest(
        `/api/admin/booking-commissions/${encodeURIComponent(bookingId)}/notifications/resend`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceJobId: job.id,
            idempotencyKey,
          }),
        },
      );
      await onResent();
      delete resendKeys.current[job.id];
      setResendNotice("تمت جدولة نسخة إضافية من الرسالة للإرسال.");
    } catch (error) {
      setResendError(
        error instanceof Error
          ? error.message
          : "تعذر جدولة إعادة الإرسال. حاول مرة أخرى.",
      );
    } finally {
      setResendPendingId(null);
    }
  };

  return (
    <section className="overflow-hidden rounded-xl border">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 bg-muted/20 p-4 text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span>
          <span className="block text-sm font-bold text-[#34332f]">سجل إشعارات واتساب</span>
          <span className="mt-1 block text-[11px] text-muted-foreground">{jobs.length} رسالة مجدولة أو منفذة</span>
        </span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="space-y-3 border-t p-3 sm:p-4">
          {resendNotice && (
            <p className="rounded-lg bg-emerald-50 p-3 text-xs font-medium text-emerald-800" role="status">
              {resendNotice}
            </p>
          )}
          {resendError && (
            <p className="rounded-lg bg-red-50 p-3 text-xs font-medium text-destructive" role="alert">
              {resendError}
            </p>
          )}
          {visibleJobs.map((job, index) => {
            const status = notificationStatusMeta(job.status);
            const canResend = [
              "sent",
              "failed",
              "cancelled",
              "suppressed_quota",
            ].includes(normalize(job.status));
            return (
              <article key={job.id || `${job.kind || "notification"}-${index}`} className="rounded-lg border bg-background p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h4 className="text-sm font-bold text-[#34332f]">{notificationKindLabel(job.kind)}</h4>
                    <p className="mt-1 break-all text-[11px] text-muted-foreground">رقم السجل: {job.id || "—"}</p>
                  </div>
                  <StatusBadge label={status.label} tone={status.tone} />
                </div>
                {job.manualResendOfJobId && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusBadge label="إعادة إرسال يدوية" tone="violet" />
                    <span className="break-all text-[11px] text-muted-foreground">
                      الرسالة الأصلية: {job.manualResendOfJobId}
                    </span>
                  </div>
                )}
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <AdminFact label="المستلم" value={notificationRecipientLabel(job.recipientRole)} />
                  <AdminFact label="الموعد المجدول" value={formatDateTime(job.scheduledAt)} />
                  <AdminFact label="عدد محاولات الإرسال" value={String(job.attempts ?? 0)} />
                  <AdminFact label="وقت بدء المعالجة" value={formatDateTime(job.claimedAt)} />
                  <AdminFact label="وقت الإرسال" value={formatDateTime(job.sentAt)} />
                  <AdminFact label="وقت الفشل" value={formatDateTime(job.failedAt)} />
                  <AdminFact label="وقت منع الرسالة" value={formatDateTime(job.suppressedAt)} />
                  <AdminFact label="وقت إنشاء السجل" value={formatDateTime(job.createdAt)} />
                  {job.manualResendRequestedAt && (
                    <AdminFact label="وقت طلب إعادة الإرسال" value={formatDateTime(job.manualResendRequestedAt)} />
                  )}
                  <AdminFact label="آخر تحديث للسجل" value={formatDateTime(job.updatedAt)} />
                </div>
                {job.providerError && (
                  <p className="mt-3 break-words rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                    سبب المزود أو سير العمل: {notificationProviderErrorLabel(job.providerError)}
                  </p>
                )}
                {canResend && (
                  <div className="mt-3 border-t pt-3">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={resendPendingId !== null}
                          data-testid={`button-resend-notification-${job.id}`}
                        >
                          {resendPendingId === job.id && (
                            <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                          )}
                          إعادة إرسال الرسالة
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent dir="rtl">
                        <AlertDialogHeader className="text-right sm:text-right">
                          <AlertDialogTitle>تأكيد إرسال نسخة إضافية</AlertDialogTitle>
                          <AlertDialogDescription>
                            هذا إجراء يدوي مقصود وسيُنشئ رسالة إضافية جديدة من قالب {notificationKindLabel(job.kind)} إلى {notificationRecipientLabel(job.recipientRole)}. لن يتغير سجل الرسالة الأصلية.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter className="gap-2 sm:space-x-0">
                          <AlertDialogCancel>رجوع</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void resend(job)}>
                            تأكيد إعادة الإرسال
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                )}
              </article>
            );
          })}
          {remaining > 0 && (
            <Button type="button" size="sm" variant="outline" onClick={() => setVisibleCount((count) => count + 10)}>
              عرض {Math.min(10, remaining)} سجلات إضافية
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function AdminPaymentAttemptHistory({
  attempts,
  selectedAttemptId,
  activeAttemptId,
  paidAttemptId,
}: {
  attempts: BookingAdminPaymentAttempt[];
  selectedAttemptId: string | null;
  activeAttemptId: string | null;
  paidAttemptId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(5);
  const visibleAttempts = attempts.slice(0, visibleCount);
  const remaining = Math.max(0, attempts.length - visibleAttempts.length);

  return (
    <section className="overflow-hidden rounded-xl border">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 bg-muted/20 p-4 text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span>
          <span className="block text-sm font-bold text-[#34332f]">سجل محاولات الدفع</span>
          <span className="mt-1 block text-[11px] text-muted-foreground">{attempts.length} محاولة محفوظة</span>
        </span>
        <ChevronDown className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="space-y-3 border-t p-3 sm:p-4">
          {visibleAttempts.map((attempt, index) => (
            <details key={attempt.id || `${attempt.createdAt || "attempt"}-${index}`} className="group overflow-hidden rounded-lg border bg-background">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <span className="min-w-0">
                  <span className="flex flex-wrap gap-1.5">
                    <StatusBadge label={paymentAttemptStatusLabel(attempt.status)} tone={normalize(attempt.status) === "paid" ? "green" : normalize(attempt.status) === "duplicate_paid" || normalize(attempt.status) === "failed" ? "red" : "slate"} />
                    {attempt.id === selectedAttemptId && <StatusBadge label="المحاولة المعروضة" tone="violet" />}
                    {attempt.id === activeAttemptId && <StatusBadge label="المحاولة النشطة" tone="blue" />}
                    {attempt.id === paidAttemptId && <StatusBadge label="محاولة السداد الأساسية" tone="green" />}
                  </span>
                  <span className="mt-2 block text-sm font-bold text-[#34332f]">{formatSarFromHalalas(attempt.amountCents)}</span>
                  <span className="mt-1 block break-all text-[11px] text-muted-foreground">{attempt.id || "—"} · {formatDateTime(attempt.updatedAt)}</span>
                </span>
                <ChevronDown className="mt-1 h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="border-t bg-muted/10 p-3">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <AdminFact label="حالة المحاولة" value={paymentAttemptStatusLabel(attempt.status)} />
                  <AdminFact label="مبلغ المحاولة" value={formatSarFromHalalas(attempt.amountCents)} />
                  <AdminFact label="العملة" value={attempt.currency || "—"} />
                  <AdminFact label="طريقة الدفع" value={paymentMethodLabel(attempt.paymentMethod)} />
                  <AdminFact label="طريقة التسوية الفعلية" value={attempt.exactPaymentMethod || "—"} />
                  <AdminFact label="رقم المحاولة" value={attempt.id || "—"} />
                  <AdminFact label="مفتاح محاولة التاجر" value={attempt.merchantAttemptKey || "—"} />
                  <AdminFact label="رقم نية الدفع" value={attempt.intentionId || "—"} />
                  <AdminFact label="رقم طلب المزود" value={attempt.paymobOrderId || "—"} />
                  <AdminFact label="رقم العملية" value={attempt.transactionId || "—"} />
                  <AdminFact label="تاريخ العملية لدى المزود" value={formatDateTime(attempt.providerCreatedAt)} />
                  <AdminFact label="تاريخ الدفع" value={formatDateTime(attempt.paidAt)} />
                  <AdminFact label="وقت رفع الإيصال" value={formatDateTime(attempt.receiptSubmittedAt)} />
                  <AdminFact label="نوع ملف الإيصال" value={attempt.receiptContentType || "—"} />
                  <AdminFact label="حجم ملف الإيصال" value={receiptFileSizeLabel(attempt.receiptSizeBytes)} />
                  <AdminFact label="قرار مراجعة الإيصال" value={bankReviewDecisionLabel(attempt.bankReviewDecision)} />
                  <AdminFact label="سبب مراجعة الإيصال" value={attempt.bankReviewReason || "—"} />
                  <AdminFact label="وقت مراجعة الإيصال" value={formatDateTime(attempt.bankReviewedAt)} />
                  <AdminFact label="حالة المراجعة المالية" value={bankReviewDecisionLabel(attempt.financialReviewDecision)} />
                  <AdminFact label="سبب المراجعة المالية" value={attempt.financialReviewReason || "—"} />
                  <AdminFact label="رقم عملية التفويض" value={attempt.authorizationTransactionId || "—"} />
                  <AdminFact label="تاريخ التفويض" value={formatDateTime(attempt.authorizedAt)} />
                  <AdminFact label="الحالة غير القابلة للاحتساب" value={attempt.nonPayableStatus ? getPaymentReversalStatusLabel(attempt.nonPayableStatus) : "—"} />
                  <AdminFact label="رقم العملية غير المحتسبة" value={attempt.nonPayableTransactionId || "—"} />
                  <AdminFact label="تاريخ الحالة غير المحتسبة" value={formatDateTime(attempt.nonPayableAt)} />
                  <AdminFact label="حالة عكس الدفعة" value={attempt.reversalStatus ? getPaymentReversalStatusLabel(attempt.reversalStatus) : "—"} />
                  <AdminFact label="رقم عملية العكس" value={attempt.reversalTransactionId || "—"} />
                  <AdminFact label="تاريخ العكس" value={formatDateTime(attempt.reversedAt)} />
                  <AdminFact label="قرار مراجعة العكس" value={reversalResolutionLabel(attempt.reversalResolution)} />
                  <AdminFact label="تاريخ حسم العكس" value={formatDateTime(attempt.reversalResolvedAt)} />
                  <AdminFact label="وقت إنشاء المحاولة" value={formatDateTime(attempt.createdAt)} />
                  <AdminFact label="آخر تحديث" value={formatDateTime(attempt.updatedAt)} />
                </div>
                {attempt.failureReason && <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-800">{paymentFailureReasonLabel(attempt.failureReason)}</p>}
              </div>
            </details>
          ))}
          {remaining > 0 && (
            <Button type="button" size="sm" variant="outline" onClick={() => setVisibleCount((count) => count + 5)}>
              عرض {Math.min(5, remaining)} محاولات إضافية
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function AdminFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-bold text-[#34332f]">{value}</p>
    </div>
  );
}

function CustomerWhatsAppLink({ bookingId }: { bookingId: string }) {
  return (
    <a
      href={getAdminCustomerWhatsAppHref(bookingId)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="فتح محادثة واتساب مع العميل"
      title="فتح محادثة واتساب مع العميل"
      className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-100 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
      data-testid={`link-customer-whatsapp-${bookingId}`}
    >
      <FaWhatsapp className="h-5 w-5" aria-hidden="true" />
    </a>
  );
}
