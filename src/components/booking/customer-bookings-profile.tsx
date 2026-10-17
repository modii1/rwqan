"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { Property } from "@shared/schema";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Heart,
  History,
  Home,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  Pencil,
  Phone,
  RefreshCw,
  Save,
  Settings2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PriceDisplay } from "@/components/price-display";
import {
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
  customerHistoryQueryKey,
  customerSessionRequestHeaders,
  isCustomerAuthenticationError,
  type CustomerProfile,
  useCustomerProfileQuery,
  useUpdateCustomerProfile,
} from "@/hooks/use-customer-account";
import {
  getCustomerSessionCacheScope,
  hasServerResolvedContactIdentity,
  useContactIdentityQuery,
  useDeleteContactIdentity,
} from "@/hooks/use-contact-identity";
import { PropertyFavoriteButton } from "@/components/customer/property-favorite-button";
import { getPublicPropertyLabel } from "@/lib/public-subscription";
import { getPrimaryPropertyPriceDisplay } from "@shared/propertyPrice";
import { PROPERTY_IMAGE_PLACEHOLDER } from "@/lib/property-images";
import { useToast } from "@/hooks/use-toast";

interface CustomerHistoryPayload {
  history: BookingDisplayRow[];
}

type ProfileSection = "history" | "favorites" | "account";
type HistoryFilter = "all" | "confirmed" | "contacts";

function normalized(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isConfirmedBooking(booking: BookingDisplayRow): boolean {
  return ["confirmed", "completed", "reported", "booking_confirmed"]
    .includes(normalized(booking.bookingStatus));
}

function parseProfileSection(section: string | null): ProfileSection {
  return section === "favorites" || section === "account" ? section : "history";
}

export default function CustomerBookingsProfile() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [isVerificationOpen, setIsVerificationOpen] = useState(false);
  const [section, setSection] = useState<ProfileSection>(() =>
    parseProfileSection(searchParams.get("section")));
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const identityQuery = useContactIdentityQuery();
  const hasResolvedIdentity = hasServerResolvedContactIdentity(identityQuery);
  const customerSessionScope = getCustomerSessionCacheScope(identityQuery);
  const isCustomer = hasResolvedIdentity
    && identityQuery.data?.kind === "client"
    && Boolean(customerSessionScope);
  const profileQuery = useCustomerProfileQuery(isCustomer, customerSessionScope);
  const favoritePropertyNumbers = profileQuery.data?.favoritePropertyNumbers || [];
  const historyQuery = useQuery<CustomerHistoryPayload>({
    queryKey: customerHistoryQueryKey(customerSessionScope),
    queryFn: () => bookingApiRequest<CustomerHistoryPayload>(
      "/api/customer/history",
      { headers: customerSessionRequestHeaders(customerSessionScope) },
    ),
    enabled: isCustomer,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const propertiesQuery = useQuery<Property[]>({
    queryKey: ["/api/properties"],
    queryFn: async () => {
      const response = await fetch("/api/properties", { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to load properties");
      return response.json();
    },
    staleTime: 60_000,
    enabled: section === "favorites" && favoritePropertyNumbers.length > 0,
  });

  useEffect(() => {
    setSection(parseProfileSection(searchParams.get("section")));
  }, [searchParams]);

  const history = historyQuery.data?.history || [];
  const confirmedBookings = useMemo(
    () => history.filter(isConfirmedBooking),
    [history],
  );
  const filteredHistory = useMemo(() => {
    if (historyFilter === "confirmed") return confirmedBookings;
    if (historyFilter === "contacts") {
      return history.filter((item) => normalized(item.bookingStatus) === "contact_only");
    }
    return history;
  }, [confirmedBookings, history, historyFilter]);

  const selectSection = (nextSection: ProfileSection) => {
    setSection(nextSection);
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    if (nextSection === "history") nextSearchParams.delete("section");
    else nextSearchParams.set("section", nextSection);
    const query = nextSearchParams.toString();
    router.replace(query ? `/profile?${query}` : "/profile", { scroll: false });
  };

  const isLoading = !hasResolvedIdentity
    ? identityQuery.isPending || identityQuery.isFetching
    : isCustomer && (profileQuery.isLoading || historyQuery.isLoading);
  if (isLoading) {
    return (
      <ProfileCanvas>
        <div className="flex min-h-[420px] items-center justify-center" role="status" aria-label="جاري تحميل الحجوزات">
          <div className="text-center text-muted-foreground">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#8b6b25]" />
            <p className="mt-3 text-sm">جاري تحميل حجوزاتك...</p>
          </div>
        </div>
      </ProfileCanvas>
    );
  }

  const unauthorized = (hasResolvedIdentity && !isCustomer)
    || isCustomerAuthenticationError(profileQuery.error)
    || (historyQuery.error instanceof BookingApiError && historyQuery.error.status === 401);
  if (
    !hasResolvedIdentity
    || !isCustomer
    || profileQuery.isError
    || historyQuery.isError
    || !profileQuery.data
    || !historyQuery.data
  ) {
    return (
      <>
        <ProfileCanvas>
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
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => Promise.all([profileQuery.refetch(), historyQuery.refetch()])}
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  إعادة المحاولة
                </Button>
              )}
              <Button asChild variant="outline">
                <Link href="/">العودة للرئيسية</Link>
              </Button>
            </div>
          </Card>
        </ProfileCanvas>
        {unauthorized && (
          <ContactPhoneDialog
            open={isVerificationOpen}
            onOpenChange={setIsVerificationOpen}
            onSubmit={async () => {
              setIsVerificationOpen(false);
            }}
            mode="profile"
          />
        )}
      </>
    );
  }

  const profile = profileQuery.data;
  const favoriteIds = favoritePropertyNumbers;
  const availableFavoriteProperties = (propertiesQuery.data || [])
    .filter((property) => favoriteIds.includes(property.propertyNumber));
  const visibleFavoriteIds = new Set(
    availableFavoriteProperties.map((property) => property.propertyNumber),
  );
  const unavailableFavoriteIds = favoriteIds.filter((id) => !visibleFavoriteIds.has(id));

  return (
    <ProfileCanvas>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
        <aside className="overflow-hidden rounded-2xl border border-[#ded3bc] bg-[#fffdf8] lg:sticky lg:top-24">
          <div className="border-b border-[#eadfc8] bg-[#f7eed9] p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[#9a7623] text-xl font-bold text-white">
                {profile.fullName.trim().charAt(0) || <UserRound className="h-6 w-6" />}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[#8b6b25]">حساب العميل</p>
                <p className="mt-1 truncate font-bold text-[#2f2a1f]">
                  {profile.fullName || "عميل روقان"}
                </p>
                <p className="mt-1 text-xs text-[#6f6249]" dir="ltr">
                  {profile.maskedPhone || "رقم موثّق"}
                </p>
              </div>
            </div>
          </div>

          <nav className="grid grid-cols-3 border-b border-[#eadfc8] lg:grid-cols-1 lg:border-b-0" aria-label="أقسام حساب العميل">
            <ProfileNavButton active={section === "history"} icon={History} onClick={() => selectSection("history")}>حجوزاتي</ProfileNavButton>
            <ProfileNavButton active={section === "favorites"} icon={Heart} onClick={() => selectSection("favorites")}>المفضلة</ProfileNavButton>
            <ProfileNavButton active={section === "account"} icon={Settings2} onClick={() => selectSection("account")}>بيانات الحساب</ProfileNavButton>
          </nav>
        </aside>

        <main className="min-w-0">
          <div className="mb-5 grid grid-cols-3 gap-2 sm:gap-3">
            <ProfileStat icon={<History className="h-4 w-4" />} label="كل الطلبات" value={history.length} tone="blue" />
            <ProfileStat icon={<CheckCircle2 className="h-4 w-4" />} label="حجوزات مؤكدة" value={confirmedBookings.length} tone="green" />
            <ProfileStat icon={<Heart className="h-4 w-4" />} label="المفضلة" value={favoriteIds.length} tone="gold" />
          </div>

          {section === "history" && (
            <section aria-labelledby="customer-history-heading">
              <SectionHeading
                id="customer-history-heading"
                title="حجوزاتي"
                description="سجل طلبات التواصل والحجوزات التي أكدت تفاصيلها."
              />
              <div className="mb-4 flex gap-2 overflow-x-auto pb-1" aria-label="تصفية سجل الحجوزات">
                <HistoryFilterButton active={historyFilter === "all"} onClick={() => setHistoryFilter("all")}>الكل</HistoryFilterButton>
                <HistoryFilterButton active={historyFilter === "confirmed"} onClick={() => setHistoryFilter("confirmed")}>حجوزات مؤكدة</HistoryFilterButton>
                <HistoryFilterButton active={historyFilter === "contacts"} onClick={() => setHistoryFilter("contacts")}>طلبات تواصل</HistoryFilterButton>
              </div>

              <div className="relative space-y-4 before:absolute before:bottom-5 before:right-[1.15rem] before:top-5 before:w-px before:bg-[#d9bd72] sm:before:right-[1.4rem]">
                {filteredHistory.length === 0 ? (
                  <Card className="relative border-dashed p-8 text-center sm:p-10">
                    <Home className="mx-auto h-10 w-10 text-muted-foreground/60" aria-hidden="true" />
                    <h2 className="mt-4 text-lg font-bold text-[#34332f]">لا توجد حجوزات مسجلة</h2>
                    <p className="mt-2 text-sm text-muted-foreground">ستظهر هنا طلبات التواصل ونتائج الحجز عند تسجيلها.</p>
                    <Button asChild className="mt-5">
                      <Link href="/properties">استعراض العقارات</Link>
                    </Button>
                  </Card>
                ) : filteredHistory.map((booking) => (
                  <CustomerBookingCard key={booking.id} booking={booking} />
                ))}
              </div>
            </section>
          )}

          {section === "favorites" && (
            <section aria-labelledby="customer-favorites-heading">
              <SectionHeading
                id="customer-favorites-heading"
                title="المفضلة"
                description="العقارات التي حفظتها للرجوع إليها بسهولة."
              />
              {propertiesQuery.isLoading ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[0, 1, 2].map((item) => <div key={item} className="h-64 animate-pulse rounded-2xl bg-[#eee7d8]" />)}
                </div>
              ) : propertiesQuery.isError && favoriteIds.length > 0 ? (
                <Card className="border-dashed p-8 text-center sm:p-10">
                  <AlertTriangle className="mx-auto h-10 w-10 text-amber-600" aria-hidden="true" />
                  <h2 className="mt-4 text-lg font-bold text-[#34332f]">تعذر تحميل العقارات المحفوظة</h2>
                  <Button type="button" variant="outline" className="mt-5 gap-2" onClick={() => propertiesQuery.refetch()}>
                    <RefreshCw className="h-4 w-4" />
                    إعادة المحاولة
                  </Button>
                </Card>
              ) : favoriteIds.length === 0 ? (
                <Card className="border-dashed p-8 text-center sm:p-10">
                  <Heart className="mx-auto h-10 w-10 text-[#b9a77e]" aria-hidden="true" />
                  <h2 className="mt-4 text-lg font-bold text-[#34332f]">لا توجد عقارات في المفضلة</h2>
                  <p className="mt-2 text-sm text-muted-foreground">احفظ العقارات المناسبة لك لتجدها هنا لاحقًا.</p>
                  <Button asChild className="mt-5"><Link href="/properties">استعراض العقارات</Link></Button>
                </Card>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {availableFavoriteProperties.map((property) => (
                    <FavoritePropertyCard key={property.propertyNumber} property={property} />
                  ))}
                  {unavailableFavoriteIds.map((propertyNumber) => (
                    <UnavailableFavoriteCard key={propertyNumber} propertyNumber={propertyNumber} />
                  ))}
                </div>
              )}
            </section>
          )}

          {section === "account" && (
            <AccountDetails
              profile={profile}
              customerSessionScope={customerSessionScope!}
              onLoggedOut={() => router.replace("/")}
              onSaved={() => toast({ title: "تم حفظ بيانات الحساب" })}
            />
          )}
        </main>
      </div>
    </ProfileCanvas>
  );
}

function ProfileCanvas({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-70px)] bg-[#faf8f1] px-3 py-6 sm:px-4 sm:py-10" dir="rtl">
      <div className="mx-auto w-full max-w-6xl">{children}</div>
    </div>
  );
}

function ProfileNavButton({
  active,
  icon: Icon,
  onClick,
  children,
}: {
  active: boolean;
  icon: typeof History;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 border-l border-[#eadfc8] px-1 py-2 text-xs font-bold transition-colors last:border-l-0 lg:min-h-14 lg:flex-row lg:justify-start lg:gap-2 lg:border-b lg:border-l-0 lg:px-5 lg:py-3 lg:text-sm lg:last:border-b-0 ${
        active ? "bg-[#fff8e7] text-[#80601b]" : "bg-white text-[#5f543f] hover:bg-[#fbf7ee]"
      }`}
    >
      <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <span className="max-w-full text-center leading-4 lg:truncate lg:text-right">{children}</span>
    </button>
  );
}

function SectionHeading({ id, title, description }: { id: string; title: string; description: string }) {
  return (
    <div className="mb-5">
      <h1 id={id} className="text-2xl font-bold text-[#34332f] sm:text-3xl">{title}</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function HistoryFilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-10 flex-shrink-0 rounded-full border px-4 text-sm font-semibold ${
        active
          ? "border-[#9a7623] bg-[#9a7623] text-white"
          : "border-[#ded3bc] bg-white text-[#62532f] hover:bg-[#fff8e7]"
      }`}
    >
      {children}
    </button>
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
  tone: "blue" | "green" | "gold";
}) {
  const tones = {
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    gold: "border-[#e2cd92] bg-[#fff8e7] text-[#80601b]",
  } as const;
  return (
    <Card className={`min-w-0 p-3 sm:p-4 ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-1 sm:gap-2">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white/70 sm:h-8 sm:w-8">{icon}</span>
        <span className="text-xl font-bold tabular-nums sm:text-2xl">{value}</span>
      </div>
      <p className="mt-2 truncate text-[10px] font-semibold sm:text-xs">{label}</p>
    </Card>
  );
}

function CustomerBookingCard({ booking }: { booking: BookingDisplayRow }) {
  const bookingMeta = getBookingStatusMeta(booking.bookingStatus);
  const isContactOnly = normalized(booking.bookingStatus) === "contact_only";

  return (
    <div className="relative mr-9 sm:mr-11">
      <span className="absolute -right-[2.4rem] top-5 h-3 w-3 rounded-full border-2 border-[#9a7623] bg-[#fffdf8] sm:-right-[2.9rem]" aria-hidden="true" />
      <Card className="overflow-hidden border-[#ded3bc] bg-white">
        <div className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-[#34332f]">{getPropertyLabel(booking)}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="break-all">رقم العقار: {booking.propertyNumber}</span>
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
              {isContactOnly ? (
                <p className="text-sm text-muted-foreground">لم تُسجل تفاصيل الحجز بعد.</p>
              ) : (
                <CustomerQuestionnaireFacts questionnaire={booking.questionnaire || booking.confirmationFacts} />
              )}
            </section>
            <Button asChild variant="outline" size="sm">
              <Link href={`/property/${encodeURIComponent(booking.propertyNumber)}`}>عرض العقار</Link>
            </Button>
          </div>
        </details>
      </Card>
    </div>
  );
}

function FavoritePropertyCard({ property }: { property: Property }) {
  const image = property.imageUrls?.[0] || PROPERTY_IMAGE_PLACEHOLDER;
  return (
    <Card className="group min-w-0 overflow-hidden border-[#ded3bc] bg-white">
      <div className="relative aspect-[4/3] bg-[#eee7d8]">
        <Link href={`/property/${encodeURIComponent(property.propertyNumber)}`} className="block h-full w-full">
          <img
            src={image}
            alt={getPublicPropertyLabel(property)}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            onError={(event) => { event.currentTarget.src = PROPERTY_IMAGE_PLACEHOLDER; }}
          />
        </Link>
        <PropertyFavoriteButton propertyNumber={property.propertyNumber} className="absolute left-2 top-2 z-10" />
      </div>
      <div className="p-3">
        <Link href={`/property/${encodeURIComponent(property.propertyNumber)}`} className="block">
          <h2 className="truncate text-sm font-bold text-[#2f2a1f]">{getPublicPropertyLabel(property)}</h2>
          <p className="mt-1 flex items-center gap-1 truncate text-xs text-[#6f6249]">
            <MapPin className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            <span className="truncate">{property.location || property.city}</span>
          </p>
          <div className="mt-3"><PriceDisplay amount={getPrimaryPropertyPriceDisplay(property.prices)} size="sm" /></div>
        </Link>
      </div>
    </Card>
  );
}

function UnavailableFavoriteCard({ propertyNumber }: { propertyNumber: string }) {
  return (
    <Card className="relative flex min-h-56 min-w-0 flex-col items-center justify-center border-dashed p-4 text-center">
      <PropertyFavoriteButton propertyNumber={propertyNumber} className="absolute left-2 top-2" />
      <Home className="h-8 w-8 text-[#b9a77e]" aria-hidden="true" />
      <p className="mt-3 max-w-full break-all text-sm font-bold text-[#34332f]">عقار رقم {propertyNumber}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">العقار غير متاح حاليًا.</p>
    </Card>
  );
}

function AccountDetails({
  profile,
  customerSessionScope,
  onLoggedOut,
  onSaved,
}: {
  profile: CustomerProfile;
  customerSessionScope: string;
  onLoggedOut: () => void;
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState(profile.fullName);
  const [email, setEmail] = useState(profile.email || "");
  const [error, setError] = useState("");
  const [isChangeDialogOpen, setIsChangeDialogOpen] = useState(false);
  const updateProfile = useUpdateCustomerProfile(customerSessionScope);
  const logout = useDeleteContactIdentity();

  useEffect(() => {
    setFullName(profile.fullName);
    setEmail(profile.email || "");
  }, [profile.email, profile.fullName]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (fullName.trim().length < 2) {
      setError("أدخل الاسم الكامل.");
      return;
    }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("أدخل بريدًا إلكترونيًا صحيحًا.");
      return;
    }
    setError("");
    try {
      await updateProfile.mutateAsync({ fullName: fullName.trim(), email: email.trim() || null });
      onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "تعذر حفظ البيانات.");
    }
  };

  return (
    <>
      <section aria-labelledby="customer-account-heading">
        <SectionHeading id="customer-account-heading" title="بيانات الحساب" description="حدّث بياناتك الأساسية وأدر جلسة دخولك." />
        <Card className="border-[#ded3bc] bg-white p-5 sm:p-7">
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="space-y-2">
            <Label htmlFor="profile-full-name">الاسم الكامل</Label>
            <div className="relative">
              <UserRound className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b7140]" aria-hidden="true" />
              <Input id="profile-full-name" value={fullName} onChange={(event) => setFullName(event.target.value.slice(0, 100))} className="pr-10" autoComplete="name" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-email">البريد الإلكتروني (اختياري)</Label>
            <div className="relative">
              <Mail className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b7140]" aria-hidden="true" />
              <Input id="profile-email" type="email" dir="ltr" value={email} onChange={(event) => setEmail(event.target.value.slice(0, 254))} className="pr-10" autoComplete="email" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>رقم الجوال الموثق</Label>
            <div className="flex min-h-10 items-center rounded-md border border-[#ded3bc] bg-[#faf8f1] px-3 text-sm font-semibold text-[#5f543f]" dir="ltr">
              {profile.maskedPhone || "رقم موثّق"}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsChangeDialogOpen(true)}
              className="gap-2"
            >
              <Pencil className="h-4 w-4" />
              تغيير رقم التواصل
            </Button>
          </div>
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" disabled={updateProfile.isPending} className="gap-2">
            {updateProfile.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            حفظ التغييرات
          </Button>
        </form>

        <div className="mt-7 border-t border-[#eadfc8] pt-5">
          <p className="text-xs leading-5 text-[#6f6249]">تاريخ إنشاء الحساب: {formatDateTime(profile.createdAt)}</p>
          <p className="mt-1 text-xs leading-5 text-[#6f6249]">آخر تسجيل دخول: {formatDateTime(profile.lastLoginAt)}</p>
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              setError("");
              try {
                await logout.mutateAsync();
                onLoggedOut();
              } catch (logoutError) {
                setError(logoutError instanceof Error ? logoutError.message : "تعذر تسجيل الخروج");
              }
            }}
            disabled={logout.isPending}
            className="mt-4 gap-2 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
          >
            {logout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            تسجيل الخروج
          </Button>
        </div>
        </Card>
      </section>
      <ContactPhoneDialog
        open={isChangeDialogOpen}
        onOpenChange={setIsChangeDialogOpen}
        onSubmit={async () => setIsChangeDialogOpen(false)}
        mode="change"
        currentMaskedPhone={profile.maskedPhone}
      />
    </>
  );
}
