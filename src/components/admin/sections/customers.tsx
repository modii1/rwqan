"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageCircle,
  RefreshCw,
  Search,
  UserRound,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  StatusBadge,
  formatDateTime,
  getBookingStatusMeta,
  getPropertyLabel,
  type BookingDisplayRow,
} from "@/components/booking/booking-display";
import { bookingApiRequest } from "@/components/booking/booking-api";
import { CustomerWhatsAppLink } from "./booking-commissions";
import {
  filterCustomerContacts,
  summarizeCustomerContacts,
  type CustomerContactStatusFilter,
} from "./customers-model";

interface AdminBookingCommissionsPayload {
  customers: Array<BookingDisplayRow & { bookingWorkflowId?: string | null }>;
  total: number;
}

export default function CustomersSection() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CustomerContactStatusFilter>("all");
  const query = useQuery<AdminBookingCommissionsPayload>({
    queryKey: ["/api/admin/customers"],
    queryFn: () => bookingApiRequest<AdminBookingCommissionsPayload>(
      "/api/admin/customers",
    ),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const contacts = useMemo(
    () => filterCustomerContacts(query.data?.customers || [], search, statusFilter),
    [query.data?.customers, search, statusFilter],
  );
  const summary = useMemo(
    () => summarizeCustomerContacts(query.data?.customers || []),
    [query.data?.customers],
  );

  if (query.isLoading) {
    return (
      <div className="flex h-72 items-center justify-center" dir="rtl" role="status" aria-label="جاري تحميل العملاء">
        <Loader2 className="h-7 w-7 animate-spin text-[#8b6b25]" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <Card className="p-8 text-center" dir="rtl">
        <AlertTriangle className="mx-auto h-9 w-9 text-destructive" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-bold">تعذر تحميل العملاء</h1>
        <p className="mt-1 text-sm text-muted-foreground">تحقق من الاتصال ثم أعد المحاولة.</p>
        <Button type="button" variant="outline" onClick={() => query.refetch()} className="mt-4 gap-2">
          <RefreshCw className="h-4 w-4" />
          إعادة المحاولة
        </Button>
      </Card>
    );
  }

  return (
    <section className="min-w-0 space-y-5" dir="rtl">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[#8b6b25]">
            <UserRound className="h-5 w-5" aria-hidden="true" />
            <span className="text-xs font-semibold">سجل عملاء المنصة</span>
          </div>
          <h1 className="text-2xl font-bold text-[#34332f]">العملاء</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
            يعرض كل طلب تواصل عبر المنصة. طلب التواصل لا يُعد حجزًا مؤكدًا إلا بعد تأكيد العميل لنتيجة الحجز.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => query.refetch()} disabled={query.isFetching} className="w-fit gap-2">
          <RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
          تحديث البيانات
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <SummaryCard label="طلبات التواصل" value={summary.total} icon={<MessageCircle className="h-4 w-4" />} tone="slate" />
        <SummaryCard label="تواصل فقط" value={summary.contactOnly} icon={<UserRound className="h-4 w-4" />} tone="blue" />
        <SummaryCard label="بانتظار الرد" value={summary.awaiting} icon={<Clock3 className="h-4 w-4" />} tone="amber" />
        <SummaryCard label="حجز مؤكد" value={summary.confirmed} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" />
        <SummaryCard label="لم يتم الحجز" value={summary.declined} icon={<XCircle className="h-4 w-4" />} tone="slate" />
        <SummaryCard label="انتهت مهلة الرد" value={summary.expired} icon={<AlertTriangle className="h-4 w-4" />} tone="red" />
      </div>

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ابحث برقم العميل أو العقار أو كود الطلب..."
              className="pr-9"
              data-testid="input-search-customers"
            />
          </div>
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as CustomerContactStatusFilter)}>
            <SelectTrigger data-testid="select-customer-contact-status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الحالات</SelectItem>
              <SelectItem value="contact_only">تواصل فقط</SelectItem>
              <SelectItem value="awaiting">بانتظار الرد</SelectItem>
              <SelectItem value="confirmed">حجز مؤكد</SelectItem>
              <SelectItem value="declined">لم يتم الحجز</SelectItem>
              <SelectItem value="expired">انتهت مهلة الرد</SelectItem>
            </SelectContent>
          </Select>
          <Badge variant="outline" className="h-10 justify-center px-3">{contacts.length} طلب تواصل</Badge>
        </div>
      </Card>

      {contacts.length === 0 ? (
        <Card className="border-dashed p-8 text-center">
          <UserRound className="mx-auto h-9 w-9 text-muted-foreground/60" aria-hidden="true" />
          <p className="mt-3 font-semibold text-[#34332f]">لا توجد طلبات تواصل مطابقة</p>
          <p className="mt-1 text-sm text-muted-foreground">غيّر البحث أو الفلتر لعرض نتائج أخرى.</p>
        </Card>
      ) : (
        <>
          <Card className="hidden min-w-0 overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[850px] text-sm">
                <thead className="border-b bg-muted/40 text-right text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3 font-semibold">رقم العميل</th>
                    <th className="p-3 font-semibold">العقار والطلب</th>
                    <th className="p-3 font-semibold">وقت التواصل</th>
                    <th className="p-3 font-semibold">حالة المتابعة</th>
                    <th className="p-3 font-semibold">التواصل</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {contacts.map((row) => (
                    <CustomerContactTableRow
                      key={row.id}
                      row={row}
                      onChanged={() => void query.refetch()}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="space-y-3 md:hidden">
            {contacts.map((row) => (
              <CustomerContactMobileCard
                key={row.id}
                row={row}
                onChanged={() => void query.refetch()}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function CustomerContactTableRow({
  row,
  onChanged,
}: {
  row: BookingDisplayRow;
  onChanged: () => void;
}) {
  const status = getBookingStatusMeta(row.bookingStatus);
  return (
    <tr className="hover:bg-muted/20">
      <td className="p-3 text-xs text-muted-foreground" dir="ltr">{row.customerPhoneMasked || "—"}</td>
      <td className="p-3">
        <p className="max-w-64 truncate font-bold text-[#34332f]">{getPropertyLabel(row)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{row.propertyNumber}{row.requestCode ? ` · ${row.requestCode}` : ""}</p>
      </td>
      <td className="p-3 text-xs text-muted-foreground" dir="auto">{formatDateTime(row.contactAt)}</td>
      <td className="p-3"><StatusBadge label={status.label} tone={status.tone} /></td>
      <td className="p-3">
        {typeof row.bookingWorkflowId === "string" && row.bookingWorkflowId ? (
          <CustomerWhatsAppLink
            bookingId={row.bookingWorkflowId}
            nextAllowedAt={row.customerWhatsAppNextAllowedAt}
            templateVariants={row.adminCustomerWhatsAppTemplateVariants}
            onChanged={onChanged}
          />
        ) : "—"}
      </td>
    </tr>
  );
}

function CustomerContactMobileCard({
  row,
  onChanged,
}: {
  row: BookingDisplayRow;
  onChanged: () => void;
}) {
  const status = getBookingStatusMeta(row.bookingStatus);
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground" dir="ltr">{row.customerPhoneMasked || "—"}</p>
          <p className="mt-2 truncate font-bold text-[#34332f]">{getPropertyLabel(row)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{row.propertyNumber}{row.requestCode ? ` · ${row.requestCode}` : ""}</p>
        </div>
        {typeof row.bookingWorkflowId === "string" && row.bookingWorkflowId ? (
          <CustomerWhatsAppLink
            bookingId={row.bookingWorkflowId}
            nextAllowedAt={row.customerWhatsAppNextAllowedAt}
            templateVariants={row.adminCustomerWhatsAppTemplateVariants}
            onChanged={onChanged}
          />
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <StatusBadge label={status.label} tone={status.tone} />
        <span className="text-xs text-muted-foreground" dir="auto">{formatDateTime(row.contactAt)}</span>
      </div>
    </Card>
  );
}

function SummaryCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: "slate" | "amber" | "green" | "red" | "blue";
}) {
  const tones = {
    slate: "border-slate-200 bg-slate-50 text-slate-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    red: "border-red-200 bg-red-50 text-red-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
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
