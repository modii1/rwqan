import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Property } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LogOut,
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
      setLocation("/owner/login");
    } catch (e) {
      console.error(e);
    }
  };

  if (isSessionLoading || isAuthenticated === null)
    return <Loader text="جاري التحقق من الجلسة..." />;
  if (isPropertyLoading) return <Loader text="جاري تحميل بيانات العقار..." />;
  if (propertyError || !property) return <ErrorView setLocation={setLocation} />;

  // ================== من هنا يبدأ الذكاء البصري للوحة ==================

  const isVip = property.subscriptionType === "موثوق";

  // TODO: اربط هذه القيم من الباك إند لاحقًا
  const totalDays = 90; // إجمالي مدة الاشتراك مثلاً
  const remainingDays =
    isVip
      ? 25 // مثال: باقي 25 يوم – استبدلها من الباك
      : null;

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
        <div className="bg-red-50 border-b border-red-200">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <p className="text-sm text-red-700 font-medium">
              اشتراكك الموثوق يوشك على الانتهاء. باقي{" "}
              <span className="font-bold">{remainingDays}</span> أيام – نوصي
              بتجديده مبكراً.
            </p>
          </div>
        </div>
      )}

      {/* ===== الهيدر / رأس الصفحة ===== */}
      <header
        className={
          "border-b border-border shadow-sm " +
          (isVip
            ? "bg-gradient-to-l from-yellow-50 via-amber-50 to-white"
            : "bg-card")
        }
      >
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={
                "w-12 h-12 rounded-full flex items-center justify-center " +
                (isVip ? "bg-amber-100 border border-amber-300" : "bg-primary/10")
              }
            >
              {isVip ? (
                <Crown className="w-6 h-6 text-amber-500" />
              ) : (
                <Home className="w-6 h-6 text-primary" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-primary">لوحة التحكم</h1>
                {isVip && (
                  <Badge className="bg-amber-500 text-white flex items-center gap-1 px-3 py-1">
                    <Crown className="w-3 h-3" />
                    موثوق VIP
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                عقار رقم {property.propertyNumber}
              </p>
            </div>
          </div>

          <Button variant="outline" size="sm" onClick={handleLogout}>
            <LogOut className="w-4 h-4 ml-2" />
            تسجيل الخروج
          </Button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* ===== كرت حالة الاشتراك + Progress Bar ===== */}
        <Card className="p-6 !border-primary/15 bg-primary/5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="space-y-2">
              <h2 className="font-bold text-lg text-primary">حالة الاشتراك</h2>
              <div className="flex items-center gap-3 flex-wrap">
                <Badge
                  variant={isVip ? "default" : "secondary"}
                  className="text-base px-4 py-1"
                >
                  {property.subscriptionType}
                </Badge>
                {property.subscriptionDate && (
                  <span className="text-xs text-muted-foreground">
                    تاريخ البداية:{" "}
                    {new Date(property.subscriptionDate).toLocaleDateString(
                      "ar-SA"
                    )}
                  </span>
                )}
              </div>

              {remainingDays !== null && (
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>تقدم الاشتراك</span>
                    <span>
                      باقي{" "}
                      <span className="font-bold text-primary">
                        {remainingDays}
                      </span>{" "}
                      يوم
                    </span>
                  </div>
                  <ProgressBar value={progressPercent ?? 0} />
                </div>
              )}
            </div>

            <div className="w-full md:w-64">
              <Button
                className="w-full h-14 text-base font-bold gap-2 bg-primary text-white hover:bg-primary/90"
                onClick={() => setLocation("/owner/subscription")}
              >
                <CreditCard className="w-5 h-5" />
                {subscriptionButtonLabel}
              </Button>
            </div>
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
              <Info title="الاتجاه" value={property.direction} />
              <Info title="النوع" value={property.type} />
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
            {/* TODO: اربط الأرقام الحقيقية من الباك إند */}
            <div className="grid grid-cols-2 gap-4">
              <StatCard
                label="معدل التفاعل"
                value="مرتفـع"
                icon={<Activity className="w-4 h-4" />}
              />
              <StatCard
                label="الأكثر طلباً"
                value="فترة المساء"
                icon={<BarChart2 className="w-4 h-4" />}
              />
              <StatCard
                label="نمو عن الشهر الماضي"
                value="+18%"
                icon={<TrendingUpIcon />}
              />
              <StatCard
                label="حالة الظهور"
                value={isVip ? "بارز في القائمة" : "ظهور عادي"}
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

          {/* TODO: عدّل هذه القيم عندما توفر API للأناليتكس */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <AnalyticsBox
              label="طلبات واتساب هذا الشهر"
              value="76"
              note="نمو +32% عن الشهر الماضي"
            />
            <AnalyticsBox
              label="إجمالي الشاليهات في النظام"
              value="31"
              note="موقعك بين الأعلى طلباً"
            />
            <AnalyticsBox
              label="متوسط الطلبات يومياً"
              value="4"
              note="معدل ثابت وجيد"
            />
            <AnalyticsBox
              label="اليوم الأعلى طلباً"
              value="الجمعة"
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
              icon={<CreditCard className="w-6 h-6" />}
              title="إدارة الاشتراك"
              desc="عرض الباقات والتجديد"
              onClick={() => setLocation("/owner/subscription")}
            />
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
              onClick={handleComingSoon}
            />
            <BigActionButton
              icon={<MessageCircle className="w-6 h-6" />}
              title="طلبات واتساب"
              desc="إجمالي النقرات على زر واتساب"
              onClick={handleComingSoon}
            />
            <BigActionButton
              icon={<BarChart2 className="w-6 h-6" />}
              title="الإحصائيات المفصلة"
              desc="رسوم بيانية وفلترة حسب التاريخ"
              onClick={handleComingSoon}
            />
            <BigActionButton
              icon={<Home className="w-6 h-6" />}
              title="عرض العقار للزوار"
              desc="فتح صفحة العقار كما تظهر للعملاء"
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

function Info({ title, value }: { title: string; value: string | null | undefined }) {
  return (
    <div className="p-3 rounded-lg bg-muted/20">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className="font-semibold text-base truncate">{value || "---"}</p>
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
