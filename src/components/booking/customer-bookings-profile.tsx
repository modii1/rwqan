"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CalendarCheck2,
  CheckCircle2,
  ChevronDown,
  Home,
  Loader2,
  Phone,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  BookingPageShell,
  StatusBadge,
  formatDateTime,
  getBookingStatusMeta,
  getPropertyLabel,
  type BookingDisplayRow,
} from "./booking-display";
import { CustomerQuestionnaireFacts } from "./customer-questionnaire-facts";
import { BookingApiError, bookingApiRequest } from "./booking-api";
import { ContactPhoneDialog } from "@/components/contact/contact-phone-dialog";
import {
  CUSTOMER_BOOKINGS_QUERY_KEY,
} from "@/hooks/use-contact-identity";

interface CustomerBookingsPayload {
  identity: { maskedPhone?: string | null };
  bookings: BookingDisplayRow[];
}

function normalized(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export default function CustomerBookingsProfile() {
  const [isVerificationOpen, setIsVerificationOpen] = useState(false);
  const query = useQuery<CustomerBookingsPayload>({
    queryKey: CUSTOMER_BOOKINGS_QUERY_KEY,
    queryFn: () => bookingApiRequest<CustomerBookingsPayload>("/api/customer/bookings"),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });

  const stats = useMemo(() => {
    const bookings = query.data?.bookings || [];
    return {
      total: bookings.length,
      confirmed: bookings.filter((booking) => ["confirmed", "completed", "reported", "booking_confirmed"].includes(normalized(booking.bookingStatus))).length,
    };
  }, [query.data?.bookings]);

  if (query.isLoading || query.isFetching) {
    return (
      <BookingPageShell>
        <div className="flex min-h-[420px] items-center justify-center" role="status" aria-label="جاري تحميل الحجوزات">
          <div className="text-center text-muted-foreground">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#8b6b25]" />
            <p className="mt-3 text-sm">جاري تحميل حجوزاتك...</p>
          </div>
        </div>
      </BookingPageShell>
    );
  }

  if (query.isError || !query.data) {
    const unauthorized = query.error instanceof BookingApiError && query.error.status === 401;
    return (
      <>
        <BookingPageShell>
          <Card className="mx-auto max-w-xl p-6 text-center sm:p-8">
            {unauthorized ? (
              <Phone className="mx-auto h-10 w-10 text-[#8b6b25]" aria-hidden="true" />
            ) : (
              <AlertTriangle className="mx-auto h-10 w-10 text-amber-600" aria-hidden="true" />
            )}
            <h1 className="mt-4 text-xl font-bold text-[#34332f]">
              {unauthorized ? "يلزم التحقق من رقم التواصل" : "تعذر تحميل الحجوزات"}
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {unauthorized
                ? "افتح رابط المتابعة المرسل إلى واتساب لإثبات ملكية الرقم وعرض حجوزاتك بأمان."
                : "تحقق من اتصالك ثم حاول مرة أخرى."}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {unauthorized ? (
                <Button type="button" onClick={() => setIsVerificationOpen(true)}>
                  التحقق من رقم التواصل
                </Button>
              ) : (
                <Button type="button" variant="outline" onClick={() => query.refetch()} className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  إعادة المحاولة
                </Button>
              )}
              <Button asChild variant="outline">
                <Link href="/">العودة للرئيسية</Link>
              </Button>
            </div>
          </Card>
        </BookingPageShell>
        {unauthorized && (
          <ContactPhoneDialog
            open={isVerificationOpen}
            onOpenChange={setIsVerificationOpen}
            onSubmit={async () => {
              setIsVerificationOpen(false);
              await query.refetch();
            }}
            mode="profile"
          />
        )}
      </>
    );
  }

  const { bookings, identity } = query.data;

  return (
    <BookingPageShell>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold text-[#8b6b25]">حساب العميل</p>
          <h1 className="mt-1 text-2xl font-bold text-[#34332f] sm:text-3xl">حجوزاتي</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">سجل طلبات التواصل والحجوزات التي أكدت تفاصيلها.</p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700" dir="ltr">
          <Phone className="h-3.5 w-3.5" aria-hidden="true" />
          {identity.maskedPhone || "رقم موثّق"}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ProfileStat icon={<CalendarCheck2 className="h-4 w-4" />} label="كل الطلبات" value={stats.total} tone="blue" />
        <ProfileStat icon={<CheckCircle2 className="h-4 w-4" />} label="حجوزات مؤكدة" value={stats.confirmed} tone="green" />
      </div>

      <div className="mt-6 space-y-4">
        {bookings.length === 0 ? (
          <Card className="border-dashed p-8 text-center sm:p-10">
            <Home className="mx-auto h-10 w-10 text-muted-foreground/60" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-bold text-[#34332f]">لا توجد حجوزات مسجلة</h2>
            <p className="mt-2 text-sm text-muted-foreground">ستظهر هنا طلبات التواصل ونتائج الحجز عند تسجيلها.</p>
            <Button asChild className="mt-5">
              <Link href="/properties">استعراض العقارات</Link>
            </Button>
          </Card>
        ) : bookings.map((booking) => (
          <CustomerBookingCard key={booking.id} booking={booking} />
        ))}
      </div>
    </BookingPageShell>
  );
}

function ProfileStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: "blue" | "green";
}) {
  const tones = {
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  } as const;
  return (
    <Card className={`p-4 ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/70">{icon}</span>
        <span className="text-2xl font-bold">{value}</span>
      </div>
      <p className="mt-2 text-xs font-semibold">{label}</p>
    </Card>
  );
}

function CustomerBookingCard({ booking }: { booking: BookingDisplayRow }) {
  const bookingMeta = getBookingStatusMeta(booking.bookingStatus);

  return (
    <Card className="overflow-hidden">
      <div className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-[#34332f]">{getPropertyLabel(booking)}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>رقم العقار: {booking.propertyNumber}</span>
              {booking.requestCode && <span>كود الطلب: {booking.requestCode}</span>}
              {booking.contactAt && <span>{formatDateTime(booking.contactAt)}</span>}
            </div>
          </div>
          <StatusBadge label={bookingMeta.label} tone={bookingMeta.tone} />
        </div>
      </div>

      <details className="group border-t bg-[#fffdf8]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-[#62532f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-5">
          تفاصيل الحجز والمتابعة
          <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-5 border-t px-4 py-5 sm:px-5">
          <section aria-labelledby={`facts-${booking.id}`}>
            <h3 id={`facts-${booking.id}`} className="mb-3 text-sm font-bold text-[#34332f]">بيانات الحجز</h3>
            <CustomerQuestionnaireFacts questionnaire={booking.questionnaire || booking.confirmationFacts} />
          </section>
          <Button asChild variant="outline" size="sm">
            <Link href={`/property/${encodeURIComponent(booking.propertyNumber)}`}>عرض العقار</Link>
          </Button>
        </div>
      </details>
    </Card>
  );
}
