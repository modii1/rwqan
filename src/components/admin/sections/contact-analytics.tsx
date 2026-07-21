"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  LockKeyhole,
  Loader2,
  MessageCircle,
  Monitor,
  MousePointerClick,
  RefreshCw,
  Search,
  Smartphone,
  Tablet,
  TimerOff,
  Users,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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

type ContactOutcome = "accepted" | "cooldown" | "auth_required" | "error";
type ContactAnalyticsData = {
  rangeDays: number | null;
  generatedAt: string;
  summary: {
    totalAttempts: number;
    acceptedAttempts: number;
    uniqueUsers: number;
    uniqueAcceptedUsers: number;
    contactedProperties: number;
    blockedAttempts: number;
    successRate: number;
  };
  outcomes: {
    accepted: number;
    cooldown: number;
    authRequired: number;
    error: number;
  };
  devices: { mobile: number; desktop: number; tablet: number };
  daily: Array<{ date: string; attempts: number; accepted: number }>;
  topProperties: Array<{
    propertyNumber: string;
    propertyName: string;
    city: string;
    attempts: number;
    accepted: number;
    uniqueUsers: number;
    lastContactAt: string;
  }>;
  recentEvents: Array<{
    id: string;
    propertyNumber: string;
    propertyName: string;
    timestamp: string;
    clientPhone: string | null;
    deviceType: "mobile" | "desktop" | "tablet";
    outcome: ContactOutcome;
    requestCode: string | null;
    actorType: "owner" | "admin" | "anonymous" | "legacy";
  }>;
};

const outcomeConfig: Record<ContactOutcome, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  accepted: { label: "مقبولة", className: "border-green-200 bg-green-50 text-green-700", icon: CheckCircle2 },
  cooldown: { label: "تكرار محظور", className: "border-amber-200 bg-amber-50 text-amber-700", icon: TimerOff },
  auth_required: { label: "تحتاج دخول", className: "border-slate-200 bg-slate-50 text-slate-700", icon: LockKeyhole },
  error: { label: "فشلت", className: "border-red-200 bg-red-50 text-red-700", icon: AlertTriangle },
};

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function formatChartDate(value: string): string {
  const [, month, day] = value.split("-");
  return `${day}/${month}`;
}

function formatClientPhone(value: string | null): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^5\d{8}$/.test(digits)) return `0${digits}`;
  return digits || "غير متوفر";
}

function DeviceIcon({ type }: { type: "mobile" | "desktop" | "tablet" }) {
  if (type === "mobile") return <Smartphone className="h-4 w-4" />;
  if (type === "tablet") return <Tablet className="h-4 w-4" />;
  return <Monitor className="h-4 w-4" />;
}

export default function ContactAnalyticsSection() {
  const [range, setRange] = useState<"7" | "30" | "90" | "all">("30");
  const [propertySearch, setPropertySearch] = useState("");

  const { data, isLoading, isError, isFetching, refetch } = useQuery<ContactAnalyticsData>({
    queryKey: ["/api/admin/contact-analytics", range],
    queryFn: async () => {
      const response = await fetch(`/api/admin/contact-analytics?days=${range}`, { credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "فشل تحميل تحليلات التواصل");
      return payload;
    },
  });

  const filteredProperties = useMemo(() => {
    const query = propertySearch.trim().toLowerCase();
    if (!query) return data?.topProperties || [];
    return (data?.topProperties || []).filter((property) =>
      property.propertyNumber.toLowerCase().includes(query)
      || property.propertyName.toLowerCase().includes(query)
      || property.city.toLowerCase().includes(query));
  }, [data?.topProperties, propertySearch]);

  if (isLoading) {
    return (
      <div className="space-y-4" dir="rtl" role="status" aria-label="جاري تحميل تحليلات التواصل">
        <div className="h-8 w-56 animate-pulse rounded-md bg-muted" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => <div key={item} className="h-28 animate-pulse rounded-lg bg-muted" />)}
        </div>
        <div className="flex h-72 items-center justify-center rounded-lg border bg-card">
          <Loader2 className="h-7 w-7 animate-spin text-green-700" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <Card className="p-8 text-center" dir="rtl">
        <AlertTriangle className="mx-auto h-9 w-9 text-destructive" />
        <h1 className="mt-3 text-lg font-bold">تعذر تحميل تحليلات التواصل</h1>
        <Button type="button" variant="outline" onClick={() => refetch()} className="mt-4 gap-2">
          <RefreshCw className="h-4 w-4" />
          إعادة المحاولة
        </Button>
      </Card>
    );
  }

  const totalDevices = data.devices.mobile + data.devices.desktop + data.devices.tablet;
  const deviceRows = [
    { key: "mobile" as const, label: "جوال", value: data.devices.mobile, color: "bg-green-600" },
    { key: "desktop" as const, label: "مكتبي", value: data.devices.desktop, color: "bg-[#b88d2b]" },
    { key: "tablet" as const, label: "لوحي", value: data.devices.tablet, color: "bg-slate-500" },
  ];

  return (
    <section className="min-w-0 space-y-5" dir="rtl">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-green-700">
            <MousePointerClick className="h-5 w-5" />
            <span className="text-xs font-semibold">زر التواصل في صفحات العقارات</span>
          </div>
          <h1 className="text-2xl font-bold text-[#34332f]">تحليلات التواصل</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            تقيس ضغطات زر واتساب والطلبات المقبولة والتكرارات المحظورة، مع رقم جوال العميل للسجلات الجديدة.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={range} onValueChange={(value) => setRange(value as typeof range)}>
            <SelectTrigger className="w-40" data-testid="select-contact-range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">آخر 7 أيام</SelectItem>
              <SelectItem value="30">آخر 30 يوماً</SelectItem>
              <SelectItem value="90">آخر 90 يوماً</SelectItem>
              <SelectItem value="all">كل الفترة</SelectItem>
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching} title="تحديث البيانات" aria-label="تحديث البيانات">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Card className="min-w-0 p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-50 text-green-700"><MousePointerClick className="h-4 w-4" /></div>
          <p className="mt-3 text-2xl font-bold text-[#34332f]">{data.summary.totalAttempts}</p>
          <p className="text-xs font-semibold text-muted-foreground">محاولات التواصل</p>
        </Card>
        <Card className="min-w-0 p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Users className="h-4 w-4" /></div>
          <p className="mt-3 text-2xl font-bold text-[#34332f]">{data.summary.uniqueUsers}</p>
          <p className="text-xs font-semibold text-muted-foreground">مستخدمون فريدون تقريبياً</p>
        </Card>
        <Card className="min-w-0 p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><MessageCircle className="h-4 w-4" /></div>
          <p className="mt-3 text-2xl font-bold text-[#34332f]">{data.summary.acceptedAttempts}</p>
          <p className="text-xs font-semibold text-muted-foreground">طلبات مقبولة</p>
        </Card>
        <Card className="min-w-0 p-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><Building2 className="h-4 w-4" /></div>
          <p className="mt-3 text-2xl font-bold text-[#34332f]">{data.summary.contactedProperties}</p>
          <p className="text-xs font-semibold text-muted-foreground">عقارات تم التواصل معها</p>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "مقبولة", value: data.outcomes.accepted, className: "border-green-200 bg-green-50 text-green-700" },
          { label: "تكرار محظور", value: data.outcomes.cooldown, className: "border-amber-200 bg-amber-50 text-amber-700" },
          { label: "تحتاج دخول", value: data.outcomes.authRequired, className: "border-slate-200 bg-slate-50 text-slate-700" },
          { label: "فشلت", value: data.outcomes.error, className: "border-red-200 bg-red-50 text-red-700" },
        ].map((item) => (
          <div key={item.label} className={`rounded-lg border px-3 py-2.5 ${item.className}`}>
            <p className="text-lg font-bold">{item.value}</p>
            <p className="text-[11px] font-semibold">{item.label}</p>
          </div>
        ))}
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0 p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-bold text-[#34332f]">نشاط التواصل اليومي</h2>
              <p className="text-xs text-muted-foreground">المحاولات مقابل الطلبات المقبولة</p>
            </div>
            <Badge variant="outline">نجاح {data.summary.successRate}%</Badge>
          </div>
          <div className="h-64 min-w-0" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.daily} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8e2d5" />
                <XAxis dataKey="date" tickFormatter={formatChartDate} tick={{ fontSize: 10 }} interval={Math.max(0, Math.ceil(data.daily.length / 7) - 1)} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip
                  labelFormatter={(label) => formatChartDate(String(label))}
                  formatter={(value, name) => [value, name === "accepted" ? "مقبولة" : "المحاولات"]}
                  contentStyle={{ direction: "rtl", borderRadius: 8, borderColor: "#ded4bf" }}
                />
                <Bar dataKey="attempts" name="attempts" fill="#c9b98f" radius={[3, 3, 0, 0]} />
                <Bar dataKey="accepted" name="accepted" fill="#16804b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="font-bold text-[#34332f]">الأجهزة</h2>
          <p className="mb-5 text-xs text-muted-foreground">توزيع محاولات التواصل</p>
          <div className="space-y-4">
            {deviceRows.map((device) => {
              const percentage = totalDevices ? Math.round((device.value / totalDevices) * 100) : 0;
              return (
                <div key={device.key}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="inline-flex items-center gap-2 text-muted-foreground"><DeviceIcon type={device.key} />{device.label}</span>
                    <span className="font-bold">{device.value} <span className="text-xs font-medium text-muted-foreground">({percentage}%)</span></span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full rounded-full ${device.color}`} style={{ width: `${percentage}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card className="min-w-0 overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h2 className="font-bold text-[#34332f]">العقارات الأكثر طلباً</h2>
            <p className="text-xs text-muted-foreground">مرتبة حسب عدد الطلبات التي فُتح لها واتساب</p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={propertySearch} onChange={(event) => setPropertySearch(event.target.value)} placeholder="ابحث عن عقار..." className="pr-9" />
          </div>
        </div>
        <div className="divide-y">
          {filteredProperties.length ? filteredProperties.map((property, index) => (
            <div key={property.propertyNumber} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 p-4 sm:px-5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-xs font-bold text-muted-foreground">{index + 1}</div>
              <div className="min-w-0">
                <p className="truncate font-semibold text-[#34332f]">{property.propertyName}</p>
                <p className="truncate text-xs text-muted-foreground">{property.propertyNumber} · {property.city} · {property.uniqueUsers} مستخدم</p>
              </div>
              <div className="text-left">
                <p className="text-xl font-bold text-[#34332f]">{property.accepted}</p>
                <p className="text-[10px] text-muted-foreground">من {property.attempts} محاولة</p>
              </div>
            </div>
          )) : (
            <p className="p-6 text-center text-sm text-muted-foreground">لا توجد عقارات مطابقة.</p>
          )}
        </div>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <div className="border-b p-4 sm:p-5">
          <h2 className="font-bold text-[#34332f]">آخر محاولات التواصل</h2>
          <p className="text-xs text-muted-foreground">رقم العميل متاح للسجلات الجديدة فقط، ولا يتم عرض رقم المالك أو عنوان IP.</p>
        </div>
        <div className="divide-y">
          {data.recentEvents.length ? data.recentEvents.slice(0, 20).map((event) => {
            const config = outcomeConfig[event.outcome];
            const OutcomeIcon = config.icon;
            return (
              <div key={event.id} className="flex min-w-0 items-center gap-3 p-4 sm:px-5">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <DeviceIcon type={event.deviceType} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#34332f]">{event.propertyName} <span className="font-normal text-muted-foreground">({event.propertyNumber})</span></p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {formatDateTime(event.timestamp)}{event.requestCode ? ` · ${event.requestCode}` : ""}
                  </p>
                  <p className="mt-0.5 truncate text-right text-xs font-semibold text-[#5f543f]" dir={event.clientPhone ? "ltr" : "rtl"}>
                    {formatClientPhone(event.clientPhone)}
                  </p>
                </div>
                <Badge variant="outline" className={`flex-shrink-0 gap-1 ${config.className}`}>
                  <OutcomeIcon className="h-3 w-3" />
                  <span className="hidden sm:inline">{config.label}</span>
                </Badge>
              </div>
            );
          }) : (
            <p className="p-6 text-center text-sm text-muted-foreground">لا توجد محاولات تواصل في هذه الفترة.</p>
          )}
        </div>
      </Card>

      <p className="text-xs leading-5 text-muted-foreground">
        الطلب المقبول يعني أن النظام سمح بفتح واتساب بعد الضغط، ولا يؤكد أن المستخدم أرسل الرسالة فعلياً. السجلات القديمة تُحتسب من طلبات واتساب المحفوظة سابقاً.
      </p>
    </section>
  );
}
