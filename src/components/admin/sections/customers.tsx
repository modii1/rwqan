"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Heart,
  History,
  Loader2,
  Mail,
  MessageCircle,
  RefreshCw,
  Search,
  UserCheck,
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
  filterCustomerAccounts,
  filterCustomerContacts,
  summarizeCustomerContacts,
  type AdminCustomerAccountRow,
  type AdminCustomerAccountSummary,
  type CustomerContactStatusFilter,
} from "./customers-model";

interface AdminBookingCommissionsPayload {
  customers: Array<BookingDisplayRow & { bookingWorkflowId?: string | null }>;
  total: number;
  accounts: AdminCustomerAccountRow[];
  accountSummary: AdminCustomerAccountSummary;
}

export default function CustomersSection() {
  const [search, setSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
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
  const accounts = useMemo(
    () => filterCustomerAccounts(query.data?.accounts || [], accountSearch),
    [accountSearch, query.data?.accounts],
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

      <section className="space-y-3" aria-labelledby="registered-customer-accounts-title">
        <div>
          <div className="mb-1 flex items-center gap-2 text-emerald-700">
            <UserCheck className="h-5 w-5" aria-hidden="true" />
            <span className="text-xs font-semibold">الحسابات الموثقة برقم التواصل</span>
          </div>
          <h2 id="registered-customer-accounts-title" className="text-xl font-bold text-[#34332f]">
            حسابات العملاء المسجلة
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            بيانات الحساب والمفضلة وسجل التواصل المرتبط بالرقم بعد التحقق فقط.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <SummaryCard label="الحسابات المسجلة" value={query.data.accountSummary.total} icon={<UserRound className="h-4 w-4" />} tone="blue" />
          <SummaryCard label="بيانات محدثة" value={query.data.accountSummary.withProfile} icon={<UserCheck className="h-4 w-4" />} tone="green" />
          <SummaryCard label="العقارات المفضلة" value={query.data.accountSummary.favoriteProperties} icon={<Heart className="h-4 w-4" />} tone="amber" />
          <SummaryCard label="طلبات مرتبطة بالتحقق" value={query.data.accountSummary.verifiedContacts} icon={<History className="h-4 w-4" />} tone="slate" />
          <SummaryCard label="حجوزات مؤكدة" value={query.data.accountSummary.confirmedBookings} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" />
        </div>

        <Card className="p-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={accountSearch}
                onChange={(event) => setAccountSearch(event.target.value)}
                placeholder="ابحث بالاسم أو البريد أو الرقم أو العقار..."
                className="pr-9"
                data-testid="input-search-customer-accounts"
              />
            </div>
            <Badge variant="outline" className="h-10 justify-center px-3">{accounts.length} حساب</Badge>
          </div>
        </Card>

        {accounts.length === 0 ? (
          <Card className="border-dashed p-8 text-center">
            <UserRound className="mx-auto h-9 w-9 text-muted-foreground/60" aria-hidden="true" />
            <p className="mt-3 font-semibold text-[#34332f]">لا توجد حسابات عملاء مطابقة</p>
          </Card>
        ) : (
          <div className="grid min-w-0 gap-3 xl:grid-cols-2">
            {accounts.map((account) => (
              <CustomerAccountCard
                key={account.id}
                account={account}
                onChanged={() => void query.refetch()}
              />
            ))}
          </div>
        )}
      </section>

      <div className="border-t" aria-hidden="true" />

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

function CustomerAccountCard({
  account,
  onChanged,
}: {
  account: AdminCustomerAccountRow;
  onChanged: () => void;
}) {
  const shownFavorites = account.favoritePropertyNumbers.slice(0, 8);
  const remainingFavorites = account.favoritePropertyNumbers.length - shownFavorites.length;
  return (
    <Card className="min-w-0 overflow-hidden p-4" data-testid="customer-account-card">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-sm font-bold text-emerald-700">
              {(account.fullName.trim().charAt(0) || "ع").toUpperCase()}
            </span>
            <div className="min-w-0">
              <h3 className="truncate font-bold text-[#34332f]">{account.fullName || "عميل مسجل"}</h3>
              <p className="text-xs text-muted-foreground" dir="ltr">{account.customerPhoneMasked || "—"}</p>
            </div>
          </div>
          {account.email ? (
            <p className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" dir="ltr">
              <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-all">{account.email}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5 sm:max-w-[55%] sm:justify-end">
          <Badge variant="outline">{account.favoritePropertyNumbers.length} مفضلة</Badge>
          <Badge variant="outline">{account.contactCount} طلب موثق</Badge>
          <Badge variant="outline">{account.confirmedBookingCount} حجز مؤكد</Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-2 rounded-xl bg-muted/30 p-3 text-xs text-muted-foreground sm:grid-cols-2">
        <p>تاريخ التسجيل: <span dir="auto">{formatDateTime(account.createdAt)}</span></p>
        <p>آخر دخول: <span dir="auto">{formatDateTime(account.lastLoginAt)}</span></p>
      </div>

      {shownFavorites.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-semibold text-[#34332f]">العقارات المفضلة</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {shownFavorites.map((propertyNumber) => (
              <Badge key={propertyNumber} variant="secondary" dir="ltr">{propertyNumber}</Badge>
            ))}
            {remainingFavorites > 0 ? <Badge variant="secondary">+{remainingFavorites}</Badge> : null}
          </div>
        </div>
      ) : null}

      <details className="group mt-4 rounded-xl border bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 text-sm font-semibold text-[#34332f]">
          <span className="flex items-center gap-2"><History className="h-4 w-4 text-[#8b6b25]" aria-hidden="true" />سجل التواصل الموثق</span>
          <span className="text-xs text-muted-foreground">{account.contacts.length}</span>
        </summary>
        <div className="space-y-2 border-t p-3">
          {account.contacts.length === 0 ? (
            <p className="text-xs text-muted-foreground">لا توجد طلبات مرتبطة بهذا الحساب بعد التحقق.</p>
          ) : account.contacts.map((contact) => {
            const status = getBookingStatusMeta(contact.bookingStatus);
            return (
              <div key={contact.id} className="min-w-0 rounded-lg border bg-muted/20 p-3">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-[#34332f]">{getPropertyLabel(contact)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {contact.propertyNumber}{contact.requestCode ? ` · ${contact.requestCode}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <StatusBadge label={status.label} tone={status.tone} />
                    {typeof contact.bookingWorkflowId === "string" && contact.bookingWorkflowId ? (
                      <CustomerWhatsAppLink
                        bookingId={contact.bookingWorkflowId}
                        nextAllowedAt={contact.customerWhatsAppNextAllowedAt}
                        templateVariants={contact.adminCustomerWhatsAppTemplateVariants}
                        onChanged={onChanged}
                      />
                    ) : null}
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground" dir="auto">{formatDateTime(contact.contactAt)}</p>
              </div>
            );
          })}
        </div>
      </details>
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
