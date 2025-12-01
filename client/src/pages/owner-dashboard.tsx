import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Property } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CreditCard,
  Image as ImageIcon,
  Home,
  Crown,
  BarChart2,
  MessageCircle,
  Edit3,
  Activity,
  AlertTriangle,
  Eye,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PriceDisplay } from "@/components/price-display";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function OwnerDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  // 1) Session check
  const { data: sessionData, isLoading: isSessionLoading } = useQuery<{
    isLoggedIn: boolean;
    propertyNumber?: string;
  }>({
    queryKey: ["/api/owner/session"],
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 2) Property fetch
  const {
    data: property,
    isLoading: isPropertyLoading,
    error: propertyError,
  } = useQuery<Property>({
    queryKey: ["/api/owner/property"],
    enabled: sessionData?.isLoggedIn === true,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 3) جلب الإحصائيات
  const {
    data: analytics,
    isLoading: analyticsLoading,
  } = useQuery<any>({
    queryKey: ["/api/owner/analytics"],
    enabled: sessionData?.isLoggedIn === true,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 4) جلب الطلبات
  const {
    data: requestsData,
    isLoading: requestsLoading,
  } = useQuery<any>({
    queryKey: ["/api/owner/requests"],
    enabled: sessionData?.isLoggedIn === true,
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!isSessionLoading && sessionData) {
      if (!sessionData.isLoggedIn) {
        setLocation("/owner/login");
      } else {
        setIsAuthenticated(true);
      }
    }
  }, [sessionData, isSessionLoading, setLocation]);

  const handleLogout = async () => {
    try {
      await fetch("/api/owner/logout", {
        method: "POST",
        credentials: "include",
      });

      toast({
        title: "تم تسجيل الخروج",
        description: "نراك قريباً!",
      });
      // Force full page reload to clear all state
      window.location.href = "/owner/login";
    } catch (e) {
      console.error(e);
      toast({
        title: "خطأ في تسجيل الخروج",
        description: "حدث خطأ، يرجى المحاولة مرة أخرى",
        variant: "destructive",
      });
    }
  };

  if (isSessionLoading || isAuthenticated === null)
    return <Loader text="جاري التحقق من الجلسة..." />;
  if (isPropertyLoading) return <Loader text="جاري تحميل بيانات العقار..." />;
  if (propertyError || !property) return <ErrorView setLocation={setLocation} />;

  // ================== من هنا يبدأ الذكاء البصري للوحة ==================

  const isVip = property.subscriptionType === "موثوق";

  // Calculate subscription progress
  const totalDays = 90;
  const remainingDays = isVip ? 25 : null;
  const usedDays =
    remainingDays !== null ? Math.max(totalDays - remainingDays, 0) : null;
  const progressPercent =
    usedDays !== null
      ? Math.max(0, Math.min(100, (usedDays / totalDays) * 100))
      : null;

  const isNearExpiry =
    remainingDays !== null && remainingDays <= 7 && remainingDays >= 0;

  // زر واحد ذكي للاشتراك (ترقية / إدارة)
  const subscriptionButtonLabel = isVip ? "إدارة الاشتراك" : "ترقية الاشتراك";

  const handleComingSoon = () => {
    toast({
      title: "قريباً",
      description: "سيتم توفير هذه الميزة في التحديثات القادمة.",
    });
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* ===== تنبيه أعلى الصفحة عند قرب انتهاء الاشتراك ===== */}
      {isNearExpiry && (
        <div className="bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-900">
          <div className="max-w-7xl mx-auto px-3 md:px-4 py-3 flex items-center gap-2 text-xs md:text-sm">
            <AlertTriangle className="w-4 md:w-5 h-4 md:h-5 text-red-500 flex-shrink-0" />
            <p className="text-red-700 dark:text-red-400 font-medium">
              اشتراكك ينتهي بـ <span className="font-bold">{remainingDays}</span> أيام – <span className="md:inline hidden">نوصي بتجديده مبكراً</span>
            </p>
          </div>
        </div>
      )}

      {/* ===== الهيدر / رأس الصفحة ===== */}
      <header
        className={
          "border-b border-border shadow-sm sticky top-0 z-10 " +
          (isVip
            ? "bg-gradient-to-l from-yellow-50 via-amber-50 to-white dark:from-amber-950 dark:via-amber-900 dark:to-background"
            : "bg-card")
        }
      >
        <div className="max-w-7xl mx-auto px-3 md:px-4 py-3 md:py-4">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <div
              className={
                "w-10 md:w-12 h-10 md:h-12 rounded-full flex items-center justify-center flex-shrink-0 " +
                (isVip ? "bg-amber-100 border border-amber-300 dark:bg-amber-900 dark:border-amber-700" : "bg-primary/10")
              }
            >
              {isVip ? (
                <Crown className="w-5 md:w-6 h-5 md:h-6 text-amber-500" />
              ) : (
                <Home className="w-5 md:w-6 h-5 md:h-6 text-primary" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg md:text-xl font-bold text-primary truncate">لوحة التحكم</h1>
                {isVip && (
                  <Badge className="bg-amber-500 text-white flex items-center gap-1 px-2 md:px-3 py-0.5 md:py-1 text-xs md:text-sm flex-shrink-0">
                    <Crown className="w-3 h-3" />
                    <span className="hidden md:inline">موثوق</span>
                  </Badge>
                )}
              </div>
              <p className="text-xs md:text-sm text-muted-foreground truncate">
                عقار #{property.propertyNumber}
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-3 md:px-4 py-6 md:py-8 space-y-6 md:space-y-8">
        {/* ===== كرت حالة الاشتراك + Progress Bar ===== */}
        <Card className="p-4 md:p-6 !border-primary/15 bg-primary/5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 md:gap-6">
            <div className="space-y-2 flex-1">
              <h2 className="font-bold text-base md:text-lg text-primary">حالة الاشتراك</h2>
              <div className="flex items-center gap-2 md:gap-3 flex-wrap">
                <Badge
                  variant={isVip ? "default" : "secondary"}
                  className="text-xs md:text-sm px-3 md:px-4 py-1"
                >
                  {property.subscriptionType}
                </Badge>
                {property.subscriptionDate && (
                  <span className="text-xs text-muted-foreground">
                    منذ {new Date(property.subscriptionDate).toLocaleDateString("ar-SA")}
                  </span>
                )}
              </div>

              {remainingDays !== null && (
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>التقدم</span>
                    <span>
                      باقي <span className="font-bold text-primary">{remainingDays}</span> يوم
                    </span>
                  </div>
                  <ProgressBar value={progressPercent ?? 0} />
                </div>
              )}
            </div>

            <Button
              className="w-full md:w-auto h-10 md:h-12 text-sm md:text-base font-bold gap-2 bg-primary text-white hover:bg-primary/90 flex-shrink-0"
              onClick={() => setLocation("/owner/subscription")}
              data-testid="button-subscription-manage"
            >
              <CreditCard className="w-4 md:w-5 h-4 md:h-5" />
              <span className="hidden md:inline">{subscriptionButtonLabel}</span>
              <span className="md:hidden">إدارة</span>
            </Button>
          </div>
        </Card>

        {/* ===== معلومات العقار + أداء العقار ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* معلومات العقار */}
          <Card className="p-6">
            <h2 className="text-lg font-bold text-primary mb-4">
              معلومات العقار
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <Info title="اسم العقار" value={property.name} />
              <Info title="المدينة" value={property.city} />
              <Info title="الموقع" value={property.location} />
              <Info title="الاتجاه" value={property.direction} />
              <Info title="النوع" value={property.type} />
              <Info title="سعر وسط الأسبوع" value={property.prices?.weekday ? <PriceDisplay amount={property.prices.weekday} size="sm" /> : "غير محدد"} />
              <Info title="سعر نهاية الأسبوع" value={property.prices?.weekend ? <PriceDisplay amount={property.prices.weekend} size="sm" /> : "غير محدد"} />
              <Info title="سعر المبيت" value={property.prices?.overnight ? <PriceDisplay amount={property.prices.overnight} size="sm" /> : "غير محدد"} />
              <Info title="سعر الإجازات" value={property.prices?.holidays ? <PriceDisplay amount={property.prices.holidays} size="sm" /> : "غير محدد"} />
            </div>
          </Card>

          {/* أداء العقار */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-primary">أداء العقار</h2>
              <Badge variant="outline" className="flex items-center gap-1">
                <Activity className="w-3 h-3" />
                تجريبي
              </Badge>
            </div>
              <div className="grid grid-cols-2 gap-4">
              <StatCard
                label="معدل التفاعل"
                value={analytics?.engagementRate || "متوسط"}
                icon={<Activity className="w-4 h-4" />}
              />
              <StatCard
                label="الأكثر طلباً"
                value={analytics?.peakRequestPeriod || "فترة المساء"}
                icon={<BarChart2 className="w-4 h-4" />}
              />
              <StatCard
                label="نمو عن الشهر الماضي"
                value={`+${analytics?.previousMonthGrowth || 0}%`}
                icon={<TrendingUpIcon />}
              />
              <StatCard
                label="حالة الظهور"
                value={isVip ? "بارز في القائمة" : (analytics?.visibilityStatus || "ظهور عادي")}
                icon={<Eye className="w-4 h-4" />}
              />
            </div>
          </Card>
        </div>

        {/* ===== تحليلات المالك (Analytics) ===== */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-primary">تحليلات وملخص</h2>
            <Badge variant="outline" className="text-xs">
              الأرقام للعرض فقط – اربطها من الباك إند
            </Badge>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <AnalyticsBox
              label="طلبات واتساب هذا الشهر"
              value={analytics?.monthlyWhatsappRequests || 0}
              note={`نمو +${analytics?.previousMonthGrowth || 0}% عن الشهر الماضي`}
            />
            <AnalyticsBox
              label="إجمالي الشاليهات في النظام"
              value={analytics?.totalPropertiesInSystem || 0}
              note="موقعك بين الأعلى طلباً"
            />
            <AnalyticsBox
              label="متوسط الطلبات يومياً"
              value={analytics?.averageDailyRequests || 0}
              note="معدل ثابت وجيد"
            />
            <AnalyticsBox
              label="اليوم الأعلى طلباً"
              value={analytics?.highestDemandDay || "الجمعة"}
              note="ركّز عروضك في نهاية الأسبوع"
            />
          </div>
        </Card>

        {/* ===== أزرار التحكم (أيقونات كبيرة) ===== */}
        <Card className="p-6">
          <h2 className="text-lg font-bold text-primary mb-4">
            إدارة العقار والإعدادات
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <BigActionButton
              icon={<ImageIcon className="w-6 h-6" />}
              title="إدارة الصور"
              desc="رفع وتحديث صور العقار"
              onClick={() => setLocation("/owner/images")}
            />
            <BigActionButton
              icon={<Edit3 className="w-6 h-6" />}
              title="تحديث بيانات العقار"
              desc="الاسم – المدينة – الوصف"
              onClick={() => setLocation("/owner/update-property")}
            />
            <PropertyActionsButton handleComingSoon={handleComingSoon} />
            <BigActionButton
              icon={<BarChart2 className="w-6 h-6" />}
              title="الإحصائيات المفصلة"
              desc="رسوم بيانية وفلترة حسب التاريخ"
              onClick={handleComingSoon}
            />
          </div>
        </Card>

        {/* ===== صور العقار ===== */}
        {property.imageUrls && property.imageUrls.length > 0 && (
          <Card className="p-6 mt-2">
            <h2 className="text-lg font-bold text-primary mb-4">
              صور العقار ({property.imageUrls.length})
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {property.imageUrls.map((url, idx) => (
                <img
                  key={idx}
                  src={url}
                  alt={`صورة ${idx + 1}`}
                  className="w-full h-32 object-cover rounded-lg"
                />
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ================== مكوّنات مساعدة ================== */

function Loader({ text }: { text: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center text-center">
      <div>
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="mt-4 text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function ErrorView({ setLocation }: { setLocation: (path: string) => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-xl font-bold mb-2">خطأ في تحميل البيانات</h2>
        <p className="text-muted-foreground mb-4">
          تعذر تحميل بيانات العقار، حاول مرة أخرى.
        </p>
        <div className="flex gap-2 justify-center">
          <Button onClick={() => window.location.reload()}>إعادة المحاولة</Button>
          <Button variant="outline" onClick={() => setLocation("/owner/login")}>
            تسجيل الدخول
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Info({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <div className="p-3 rounded-lg bg-[#e6e4e026]">
      <p className="text-xs text-muted-foreground">{title}</p>
      <div className="font-semibold text-base truncate">{value || "---"}</div>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-lg bg-muted/15 flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
        {icon}
      </div>
      <div className="flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-semibold text-sm">{value}</p>
      </div>
    </div>
  );
}

function AnalyticsBox({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="p-4 rounded-xl bg-muted/15 border border-border/40">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-bold text-primary mb-1">{value}</p>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function BigActionButton({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-xl border border-border bg-card hover:bg-primary/5 transition p-4 flex flex-col gap-2 text-right h-full"
    >
      <div className="flex items-center justify-between">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition">
          {icon}
        </div>
      </div>
      <div>
        <div className="font-bold text-sm mb-1">{title}</div>
        <div className="text-[11px] text-muted-foreground leading-relaxed">
          {desc}
        </div>
      </div>
    </button>
  );
}

function TrendingUpIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}
