"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  Clock3,
  CreditCard,
  ExternalLink,
  FileCheck2,
  History,
  Inbox,
  Loader2,
  MessageCircleWarning,
  PauseCircle,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  StickyNote,
  UserRoundCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  buildOperationsInbox,
  countOperationsByCategory,
  mergeOperationsMetadata,
  operationCategoryLabels,
  operationSnapshot,
  type ManagedOperationItem,
  type OperationCategory,
  type OperationPriority,
  type OperationsInboxSources,
} from "./operations-inbox-model";
import type {
  AdminOperationAuditAction,
  AdminOperationMetadata,
  AdminOperationMetadataListResponse,
  AdminOperationMetadataResponse,
  AdminOperationSnapshot,
  AdminOperationState,
} from "../../../../shared/adminOperations";

type CategoryFilter = "all" | OperationCategory;
type PriorityFilter = "all" | OperationPriority;
type StateFilter = "all" | AdminOperationState;

const categories: OperationCategory[] = [
  "property_approval",
  "whatsapp_failure",
  "bank_receipt",
  "dispute",
  "overdue_commission",
  "suspended_property",
  "expiring_subscription",
];

const priorityMeta: Record<OperationPriority, {
  label: string;
  badge: string;
  rail: string;
}> = {
  critical: {
    label: "عاجل",
    badge: "border-red-200 bg-red-50 text-red-700",
    rail: "bg-red-500",
  },
  high: {
    label: "مهم",
    badge: "border-amber-200 bg-amber-50 text-amber-800",
    rail: "bg-amber-500",
  },
  medium: {
    label: "متابعة",
    badge: "border-slate-200 bg-slate-50 text-slate-700",
    rail: "bg-slate-400",
  },
};

const categoryIcon: Record<OperationCategory, ReactNode> = {
  property_approval: <Building2 className="h-4 w-4" aria-hidden="true" />,
  whatsapp_failure: <MessageCircleWarning className="h-4 w-4" aria-hidden="true" />,
  bank_receipt: <FileCheck2 className="h-4 w-4" aria-hidden="true" />,
  dispute: <ShieldAlert className="h-4 w-4" aria-hidden="true" />,
  overdue_commission: <CreditCard className="h-4 w-4" aria-hidden="true" />,
  suspended_property: <PauseCircle className="h-4 w-4" aria-hidden="true" />,
  expiring_subscription: <Clock3 className="h-4 w-4" aria-hidden="true" />,
};

async function fetchAdminValue<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function writeAdminValue<T>(
  url: string,
  method: "PUT" | "POST",
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function formatRelativeAge(value?: string | null): string {
  if (!value) return "الوقت غير محدد";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "الوقت غير محدد";

  const differenceMs = Date.now() - timestamp;
  const isFuture = differenceMs < 0;
  const minutes = Math.max(0, Math.round(Math.abs(differenceMs) / 60_000));
  if (minutes < 1) return "الآن";
  if (minutes < 60) return isFuture ? `بعد ${minutes} دقيقة` : `منذ ${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return isFuture ? `بعد ${hours} ساعة` : `منذ ${hours} ساعة`;
  const days = Math.round(hours / 24);
  return isFuture ? `بعد ${days} يوم` : `منذ ${days} يوم`;
}

function itemMatchesSearch(item: ManagedOperationItem, search: string): boolean {
  if (!search) return true;
  const normalizedSearch = search.trim().toLowerCase();
  return [
    item.title,
    item.description,
    item.reference,
    item.propertyNumber,
    item.propertyName,
    item.statusLabel,
    item.workflow.assignee,
    ...item.workflow.notes.map((note) => note.body),
  ].some((value) => String(value || "").toLowerCase().includes(normalizedSearch));
}

export default function AdminOperationsInbox() {
  const queryClient = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [stateFilter, setStateFilter] = useState<StateFilter>("open");
  const [search, setSearch] = useState("");

  const propertiesQuery = useQuery<NonNullable<OperationsInboxSources["properties"]>>({
    queryKey: ["admin-operations", "properties"],
    queryFn: () => fetchAdminValue("/api/admin/properties"),
    refetchOnWindowFocus: false,
  });
  const additionalPropertiesQuery = useQuery<NonNullable<OperationsInboxSources["additionalProperties"]>>({
    queryKey: ["admin-operations", "additional-properties"],
    queryFn: () => fetchAdminValue("/api/admin/additional-property-requests"),
    refetchOnWindowFocus: false,
  });
  const whatsappQuery = useQuery<NonNullable<OperationsInboxSources["whatsappLogs"]>>({
    queryKey: ["admin-operations", "whatsapp-logs"],
    queryFn: () => fetchAdminValue("/api/whatsapp/logs"),
    refetchOnWindowFocus: false,
  });
  const bookingsQuery = useQuery<NonNullable<OperationsInboxSources["bookingDashboard"]>>({
    queryKey: ["admin-operations", "booking-commissions"],
    queryFn: () => fetchAdminValue("/api/admin/booking-commissions"),
    refetchOnWindowFocus: false,
  });
  const paymentsQuery = useQuery<NonNullable<OperationsInboxSources["payments"]>>({
    queryKey: ["admin-operations", "payments"],
    queryFn: () => fetchAdminValue("/api/admin/payments"),
    refetchOnWindowFocus: false,
  });
  const availabilityQuery = useQuery<NonNullable<OperationsInboxSources["availability"]>>({
    queryKey: ["admin-operations", "property-availability"],
    queryFn: () => fetchAdminValue("/api/admin/property-availability-holds"),
    refetchOnWindowFocus: false,
  });
  const subscriptionsQuery = useQuery<NonNullable<OperationsInboxSources["subscriptions"]>>({
    queryKey: ["admin-operations", "subscriptions"],
    queryFn: () => fetchAdminValue("/api/admin/subscriptions"),
    refetchOnWindowFocus: false,
  });
  const metadataQuery = useQuery<AdminOperationMetadataListResponse>({
    queryKey: ["admin-operations", "metadata"],
    queryFn: () => fetchAdminValue("/api/admin/operations/metadata"),
    refetchOnWindowFocus: false,
  });

  const queries = [
    propertiesQuery,
    additionalPropertiesQuery,
    whatsappQuery,
    bookingsQuery,
    paymentsQuery,
    availabilityQuery,
    subscriptionsQuery,
    metadataQuery,
  ];
  const isInitialLoading = queries.some((query) => query.isLoading);
  const isFetching = queries.some((query) => query.isFetching);
  const failedSourceCount = queries.filter((query) => query.isError).length;

  const items = useMemo(() => mergeOperationsMetadata(buildOperationsInbox({
    properties: propertiesQuery.data,
    additionalProperties: additionalPropertiesQuery.data,
    whatsappLogs: whatsappQuery.data,
    bookingDashboard: bookingsQuery.data,
    payments: paymentsQuery.data,
    availability: availabilityQuery.data,
    subscriptions: subscriptionsQuery.data,
  }), metadataQuery.data?.metadata), [
    additionalPropertiesQuery.data,
    availabilityQuery.data,
    bookingsQuery.data,
    metadataQuery.data?.metadata,
    paymentsQuery.data,
    propertiesQuery.data,
    subscriptionsQuery.data,
    whatsappQuery.data,
  ]);

  const stateFilteredItems = useMemo(() => items.filter((item) => (
    stateFilter === "all" || item.workflow.state === stateFilter
  )), [items, stateFilter]);
  const counts = useMemo(
    () => countOperationsByCategory(stateFilteredItems),
    [stateFilteredItems],
  );
  const filteredItems = useMemo(() => items.filter((item) => (
    (stateFilter === "all" || item.workflow.state === stateFilter)
    && (categoryFilter === "all" || item.category === categoryFilter)
    && (priorityFilter === "all" || item.priority === priorityFilter)
    && itemMatchesSearch(item, search)
  )), [categoryFilter, items, priorityFilter, search, stateFilter]);

  const openItems = items.filter((item) => item.workflow.state === "open");
  const resolvedCount = items.length - openItems.length;
  const criticalCount = openItems.filter((item) => item.priority === "critical").length;
  const financialCount = openItems.filter((item) => [
    "bank_receipt",
    "dispute",
    "overdue_commission",
  ].includes(item.category)).length;

  const refreshAll = async () => {
    await Promise.all(queries.map((query) => query.refetch()));
  };

  const storeMetadata = useCallback((metadata: AdminOperationMetadata) => {
    queryClient.setQueryData<AdminOperationMetadataListResponse>(
      ["admin-operations", "metadata"],
      (current) => ({
        metadata: [
          ...(current?.metadata || []).filter(
            (entry) => entry.operationId !== metadata.operationId,
          ),
          metadata,
        ],
      }),
    );
  }, [queryClient]);

  const updateOperation = useCallback(async (
    operationId: string,
    patch: { assignee?: string | null; state?: AdminOperationState },
    snapshot: AdminOperationSnapshot,
  ) => {
    const response = await writeAdminValue<AdminOperationMetadataResponse>(
      `/api/admin/operations/${encodeURIComponent(operationId)}`,
      "PUT",
      { ...patch, snapshot },
    );
    storeMetadata(response.metadata);
    return response.metadata;
  }, [storeMetadata]);

  const addOperationNote = useCallback(async (
    operationId: string,
    body: string,
    snapshot: AdminOperationSnapshot,
  ) => {
    const response = await writeAdminValue<AdminOperationMetadataResponse>(
      `/api/admin/operations/${encodeURIComponent(operationId)}/notes`,
      "POST",
      { body, snapshot },
    );
    storeMetadata(response.metadata);
    return response.metadata;
  }, [storeMetadata]);

  if (isInitialLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center" dir="rtl" role="status">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#8b6b25]" />
          <p className="mt-3 text-sm text-muted-foreground">جاري تحميل صندوق العمليات...</p>
        </div>
      </div>
    );
  }

  return (
    <section className="min-w-0 max-w-full space-y-5" dir="rtl" data-testid="admin-operations-inbox">
      <header className="flex min-w-0 flex-col gap-4 border-b border-[#d8c795] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-[#8b6b25]">
            <Inbox className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="text-xs font-semibold">متابعة الأعمال التي تحتاج تدخلاً</span>
          </div>
          <h1 className="text-2xl font-bold text-[#34332f]">صندوق العمليات</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            يجمع المراجعات والتنبيهات المهمة من الأقسام الحالية مع إبقاء كل إجراء في صفحته الأصلية.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void refreshAll()}
          disabled={isFetching}
          className="w-full gap-2 sm:w-auto"
          data-testid="button-refresh-operations"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          تحديث البيانات
        </Button>
      </header>

      {failedSourceCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>تعذر تحميل {failedSourceCount} من مصادر البيانات. النتائج المعروضة جزئية ويمكن إعادة المحاولة.</p>
        </div>
      )}

      <div className="grid grid-cols-2 overflow-hidden rounded-xl border bg-card sm:grid-cols-4">
        <SummaryFact label="إجمالي المفتوح" value={openItems.length} icon={<Inbox className="h-4 w-4" />} />
        <SummaryFact label="العاجل" value={criticalCount} icon={<ShieldAlert className="h-4 w-4" />} tone="red" />
        <SummaryFact label="المالي" value={financialCount} icon={<CreditCard className="h-4 w-4" />} tone="amber" />
        <SummaryFact label="المكتمل" value={resolvedCount} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" />
      </div>

      <div className="space-y-3">
        <div className="max-w-full overflow-x-auto pb-1">
          <div className="flex min-w-max gap-2" role="group" aria-label="تصفية حسب نوع العملية">
            <FilterButton
              active={categoryFilter === "all"}
              count={stateFilteredItems.length}
              label="الكل"
              onClick={() => setCategoryFilter("all")}
            />
            {categories.map((category) => (
              <FilterButton
                key={category}
                active={categoryFilter === category}
                count={counts[category] || 0}
                label={operationCategoryLabels[category]}
                onClick={() => setCategoryFilter(category)}
              />
            ))}
          </div>
        </div>

        <div className="grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_180px_180px]">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث برقم العقار أو الطلب أو السجل..."
              className="w-full pr-9"
              data-testid="input-search-operations"
            />
          </div>
          <Select value={priorityFilter} onValueChange={(value) => setPriorityFilter(value as PriorityFilter)}>
            <SelectTrigger className="w-full" data-testid="select-operation-priority">
              <SelectValue placeholder="درجة الأهمية" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل درجات الأهمية</SelectItem>
              <SelectItem value="critical">عاجل</SelectItem>
              <SelectItem value="high">مهم</SelectItem>
              <SelectItem value="medium">متابعة</SelectItem>
            </SelectContent>
          </Select>
          <Select value={stateFilter} onValueChange={(value) => setStateFilter(value as StateFilter)}>
            <SelectTrigger className="w-full" data-testid="select-operation-state">
              <SelectValue placeholder="حالة المتابعة" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">المفتوحة</SelectItem>
              <SelectItem value="resolved">المكتملة</SelectItem>
              <SelectItem value="all">كل الحالات</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2" aria-live="polite">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{filteredItems.length} عملية ظاهرة</span>
          {(categoryFilter !== "all" || priorityFilter !== "all" || stateFilter !== "open" || search) && (
            <button
              type="button"
              onClick={() => {
                setCategoryFilter("all");
                setPriorityFilter("all");
                setStateFilter("open");
                setSearch("");
              }}
              className="font-semibold text-[#8b6b25] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              مسح التصفية
            </button>
          )}
        </div>

        {filteredItems.map((item) => (
          <OperationRow
            key={item.id}
            item={item}
            onAddNote={addOperationNote}
            onUpdate={updateOperation}
          />
        ))}

        {filteredItems.length === 0 && (
          <Card className="border-dashed p-8 text-center">
            <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-600" aria-hidden="true" />
            <h2 className="mt-3 text-base font-bold text-[#34332f]">لا توجد عمليات مطابقة</h2>
            <p className="mt-1 text-sm text-muted-foreground">غيّر التصفية أو حدّث البيانات لعرض أحدث الحالات.</p>
          </Card>
        )}
      </div>
    </section>
  );
}

function SummaryFact({
  label,
  value,
  icon,
  tone = "slate",
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: "slate" | "red" | "amber" | "green";
}) {
  const toneClass = tone === "red"
    ? "text-red-700"
    : tone === "amber"
      ? "text-amber-700"
      : tone === "green"
        ? "text-emerald-700"
      : "text-[#34332f]";
  return (
    <div className="min-w-0 border-l p-3 last:border-l-0 sm:p-4">
      <div className={`flex items-center gap-1.5 text-[11px] sm:text-xs ${toneClass}`}>
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <p className={`mt-1 text-2xl font-bold tabular-nums sm:text-3xl ${toneClass}`}>{value}</p>
    </div>
  );
}

function FilterButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active
        ? "border-[#8b6b25] bg-[#8b6b25] text-white"
        : "border-border bg-card text-muted-foreground hover:border-[#d8c795] hover:text-foreground"
      }`}
    >
      <span>{label}</span>
      <span className={`rounded-full px-1.5 py-0.5 tabular-nums ${active ? "bg-white/20" : "bg-muted"}`}>{count}</span>
    </button>
  );
}

const auditActionLabels: Record<AdminOperationAuditAction, string> = {
  assigned: "تعيين المسؤول",
  unassigned: "إلغاء تعيين المسؤول",
  resolved: "إغلاق العملية",
  reopened: "إعادة فتح العملية",
  note_added: "إضافة ملاحظة",
};

function formatAdminTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12",
  }).format(date);
}

function OperationRow({
  item,
  onUpdate,
  onAddNote,
}: {
  item: ManagedOperationItem;
  onUpdate: (
    operationId: string,
    patch: { assignee?: string | null; state?: AdminOperationState },
    snapshot: AdminOperationSnapshot,
  ) => Promise<AdminOperationMetadata>;
  onAddNote: (
    operationId: string,
    body: string,
    snapshot: AdminOperationSnapshot,
  ) => Promise<AdminOperationMetadata>;
}) {
  const priority = priorityMeta[item.priority];
  const assigneeId = useId();
  const noteId = useId();
  const [assignee, setAssignee] = useState(item.workflow.assignee || "");
  const [note, setNote] = useState("");
  const [pendingAction, setPendingAction] = useState<
    "assignee" | "state" | "note" | null
  >(null);
  const [feedback, setFeedback] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    setAssignee(item.workflow.assignee || "");
  }, [item.workflow.assignee]);

  const runAction = async (
    action: "assignee" | "state" | "note",
    callback: () => Promise<unknown>,
    successText: string,
  ) => {
    setPendingAction(action);
    setFeedback(null);
    try {
      await callback();
      setFeedback({ tone: "success", text: successText });
    } catch (error) {
      setFeedback({
        tone: "error",
        text: error instanceof Error ? error.message : "تعذر حفظ التغيير",
      });
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <article className="relative min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm" data-testid={`operation-${item.id}`}>
      <span className={`absolute inset-y-0 right-0 w-1 ${priority.rail}`} aria-hidden="true" />
      <div className="min-w-0 p-4 pr-5">
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={`gap-1.5 ${priority.badge}`}>
                {priority.label}
              </Badge>
              <Badge variant="outline" className="gap-1.5 bg-background text-muted-foreground">
                {categoryIcon[item.category]}
                {operationCategoryLabels[item.category]}
              </Badge>
              <Badge
                variant="outline"
                className={item.workflow.state === "resolved"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-blue-200 bg-blue-50 text-blue-700"}
              >
                {item.workflow.state === "resolved" ? "مكتملة" : "مفتوحة"}
              </Badge>
              <span className="text-[11px] text-muted-foreground">{formatRelativeAge(item.occurredAt)}</span>
            </div>

            <div className="mt-2 min-w-0">
              <h2 className="break-words text-sm font-bold text-[#34332f] sm:text-base">{item.title}</h2>
              <p className="mt-1 break-words text-xs leading-5 text-muted-foreground sm:text-sm">{item.description}</p>
            </div>

            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span className="break-all">المرجع: <bdi className="font-semibold text-foreground">{item.reference}</bdi></span>
              {item.propertyNumber && (
                <span>رقم العقار: <bdi className="font-semibold text-foreground">{item.propertyNumber}</bdi></span>
              )}
              <span className="font-semibold text-foreground">{item.statusLabel}</span>
              {item.workflow.assignee && (
                <span className="inline-flex min-w-0 items-center gap-1">
                  <UserRoundCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  المسؤول: <bdi className="break-words font-semibold text-foreground">{item.workflow.assignee}</bdi>
                </span>
              )}
            </div>
          </div>

          <Button asChild type="button" variant="outline" className="w-full shrink-0 gap-2 lg:w-auto">
            <Link href={item.href}>
              {item.actionLabel}
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </div>

        <details className="group mt-4 border-t pt-3" data-testid={`operation-management-${item.id}`}>
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-2 text-sm font-semibold text-[#6f5723] outline-none hover:bg-[#faf7ef] focus-visible:ring-2 focus-visible:ring-[#8b6b25] [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2">
              <UserRoundCheck className="h-4 w-4" aria-hidden="true" />
              إدارة العملية
            </span>
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>

          <div className="mt-3 grid min-w-0 gap-4 rounded-xl border border-[#e2d8bb] bg-[#fdfbf6] p-3 sm:p-4 lg:grid-cols-2">
            <div className="min-w-0 space-y-3">
              <div>
                <label htmlFor={assigneeId} className="mb-1.5 block text-xs font-bold text-[#34332f]">
                  المسؤول عن المتابعة
                </label>
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                  <Input
                    id={assigneeId}
                    value={assignee}
                    onChange={(event) => setAssignee(event.target.value)}
                    maxLength={80}
                    placeholder="اسم الموظف أو الفريق"
                    className="min-w-0 flex-1 bg-white"
                    data-testid={`operation-assignee-${item.id}`}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pendingAction !== null || assignee.trim() === (item.workflow.assignee || "")}
                    onClick={() => void runAction(
                      "assignee",
                      () => onUpdate(
                        item.id,
                        { assignee: assignee.trim() || null },
                        operationSnapshot(item),
                      ),
                      "تم حفظ المسؤول",
                    )}
                    className="w-full gap-2 sm:w-auto"
                  >
                    {pendingAction === "assignee"
                      ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      : <Save className="h-4 w-4" aria-hidden="true" />}
                    حفظ المسؤول
                  </Button>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#34332f]">حالة العملية</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.workflow.state === "resolved"
                      ? "هذه العملية مكتملة ويمكن إعادة فتحها عند الحاجة."
                      : "أغلق العملية بعد انتهاء المتابعة."}
                  </p>
                </div>
                <Button
                  type="button"
                  variant={item.workflow.state === "resolved" ? "outline" : "default"}
                  disabled={pendingAction !== null}
                  onClick={() => void runAction(
                    "state",
                    () => onUpdate(
                      item.id,
                      { state: item.workflow.state === "resolved" ? "open" : "resolved" },
                      operationSnapshot(item),
                    ),
                    item.workflow.state === "resolved"
                      ? "تمت إعادة فتح العملية"
                      : "تم إغلاق العملية",
                  )}
                  className="w-full shrink-0 sm:w-auto"
                  data-testid={`operation-state-action-${item.id}`}
                >
                  {pendingAction === "state" && (
                    <Loader2 className="ml-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  )}
                  {item.workflow.state === "resolved" ? "إعادة فتح" : "إغلاق العملية"}
                </Button>
              </div>
            </div>

            <div className="min-w-0">
              <label htmlFor={noteId} className="mb-1.5 block text-xs font-bold text-[#34332f]">
                ملاحظة داخلية
              </label>
              <Textarea
                id={noteId}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="اكتب ما تم أو الخطوة التالية"
                className="min-h-24 resize-y bg-white"
                data-testid={`operation-note-${item.id}`}
              />
              <Button
                type="button"
                variant="outline"
                disabled={pendingAction !== null || !note.trim()}
                onClick={() => void runAction(
                  "note",
                  async () => {
                    await onAddNote(item.id, note.trim(), operationSnapshot(item));
                    setNote("");
                  },
                  "تمت إضافة الملاحظة",
                )}
                className="mt-2 w-full gap-2 sm:w-auto"
              >
                {pendingAction === "note"
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : <StickyNote className="h-4 w-4" aria-hidden="true" />}
                إضافة الملاحظة
              </Button>
            </div>

            {feedback && (
              <p
                role={feedback.tone === "error" ? "alert" : "status"}
                className={`text-xs font-semibold lg:col-span-2 ${feedback.tone === "error"
                  ? "text-red-700"
                  : "text-emerald-700"}`}
              >
                {feedback.text}
              </p>
            )}

            {(item.workflow.notes.length > 0 || item.workflow.audit.length > 0) && (
              <div className="grid min-w-0 gap-3 border-t border-[#e2d8bb] pt-4 lg:col-span-2 lg:grid-cols-2">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-2 text-xs font-bold text-[#34332f]">
                    <StickyNote className="h-4 w-4" aria-hidden="true" />
                    الملاحظات الداخلية
                  </h3>
                  <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                    {[...item.workflow.notes].reverse().map((entry) => (
                      <div key={entry.id} className="min-w-0 rounded-lg border bg-white p-2.5">
                        <p className="whitespace-pre-wrap break-words text-xs leading-5 text-[#34332f]">{entry.body}</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">{formatAdminTimestamp(entry.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <details className="min-w-0 rounded-lg border bg-white p-2.5">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-bold text-[#34332f] outline-none focus-visible:ring-2 focus-visible:ring-[#8b6b25] [&::-webkit-details-marker]:hidden">
                    <History className="h-4 w-4" aria-hidden="true" />
                    سجل الإجراءات
                  </summary>
                  <ol className="mt-2 max-h-48 space-y-2 overflow-y-auto border-r pr-3">
                    {[...item.workflow.audit].reverse().map((entry) => (
                      <li key={entry.id} className="min-w-0 text-[11px] leading-5 text-muted-foreground">
                        <span className="font-semibold text-[#34332f]">{auditActionLabels[entry.action]}</span>
                        {entry.assignee && <> — <bdi className="break-words">{entry.assignee}</bdi></>}
                        <span className="block">{formatAdminTimestamp(entry.at)}</span>
                      </li>
                    ))}
                  </ol>
                </details>
              </div>
            )}
          </div>
        </details>
      </div>
    </article>
  );
}
