import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
  ChevronDown,
  Eye as EyeIcon,
  EyeOff,
  Clock,
  CheckCircle2,
  XCircle,
  Receipt,
  Loader2,
  Filter,
  Plus,
  Minus,
  ChevronLeft,
  ChevronRight,
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
  const [showRequestsStats, setShowRequestsStats] = useState(false);
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'completed' | 'pending'>('all');
  const [paymentsExpanded, setPaymentsExpanded] = useState(true);


  // ===================== دالة استخراج فترة الذروة =====================
  function getPeakPeriod(requests: any[]) {
    if (!requests || requests.length === 0) return "غير محدد";

    const dayNames = [
      "الأحد",
      "الإثنين",
      "الثلاثاء",
      "الأربعاء",
      "الخميس",
      "الجمعة",
      "السبت",
    ];

    const dayCount: Record<string, number> = {};
    const hourCount: Record<number, number> = {};

    requests.forEach((req) => {
  const day = req.dayOfWeek || req.day || "غير محدد";
  const hour = req.hourOfDay || req.hour || 0;

  dayCount[day] = (dayCount[day] || 0) + 1;
  hourCount[hour] = (hourCount[hour] || 0) + 1;
});


    const bestDay =
      Object.entries(dayCount).sort(([, a], [, b]) => b - a)[0]?.[0] ||
      "غير محدد";

    const bestHour =
      Number(
        Object.entries(hourCount).sort(([, a], [, b]) => b - a)[0]?.[0]
      ) || 0;

    const suffix = bestHour >= 12 ? "مساءً" : "صباحاً";
    const hour12 = bestHour % 12 || 12;

    return `${bestDay} – ${hour12} ${suffix}`;
  }

  
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

// 5) جلب المدفوعات
const {
  data: paymentsData,
  isLoading: paymentsLoading,
} = useQuery<any[]>({
  queryKey: ["/api/owner/payments"],
  enabled: sessionData?.isLoggedIn === true,
  retry: false,
  refetchOnWindowFocus: false,
});

// 6) إعادة محاولة الدفع
const retryPaymentMutation = useMutation({
  mutationFn: async (paymentId: string) => {
    const response = await apiRequest('POST', '/api/owner/payment/retry', { paymentId });
    return response.json();
  },
  onSuccess: (data) => {
    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
    }
  },
  onError: (error: any) => {
    toast({
      title: "خطأ",
      description: error.message || "حدث خطأ في إعادة الدفع",
      variant: "destructive",
    });
  },
});

// ================= DEBUG LOGS =================
console.log("🔍 requestsData:", requestsData);
console.log("🔍 sessionData:", sessionData);
console.log("🔍 isLoggedIn:", sessionData?.isLoggedIn);
console.log("🔍 paymentsData:", paymentsData);


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

  const isVip = property.subscriptionType === "مميز";

  // Calculate subscription progress from actual subscription data
  const calculateRemainingDays = () => {
    if (!property.subscriptionType || property.subscriptionType === "عادي") {
      return null;
    }
    
    // From subscriptionDate field
    if (property.subscriptionDate) {
      const endDate = new Date(property.subscriptionDate);
      const now = new Date();
      const diffTime = endDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return Math.max(0, diffDays);
    }
    
    return null;
  };

  const remainingDays = calculateRemainingDays();
  const totalDays = 30; // مدة الاشتراك الأساسية
  const usedDays =
    remainingDays !== null ? Math.max(totalDays - remainingDays, 0) : null;
  const progressPercent =
    usedDays !== null
      ? Math.max(0, Math.min(100, (usedDays / totalDays) * 100))
      : null;

  const isNearExpiry =
    remainingDays !== null && remainingDays <= 7 && remainingDays > 0;

  // زر واحد ذكي للاشتراك (ترقية / إدارة)
  const subscriptionButtonLabel = isVip ? "إدارة الاشتراك" : "ترقية الاشتراك";

  const handleComingSoon = () => {
    toast({
      title: "قريباً",
      description: "سيتم توفير هذه الميزة في التحديثات القادمة.",
    });
  };

  // ===== حساب الإحصائيات من البيانات الفعلية =====
const calculateAnalytics = () => {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const allRequests = requestsData?.requests || [];

  // طلبات هذا الشهر
  const monthlyRequestsArray = allRequests.filter((req: any) => {
    const d = new Date(req.timestamp);
    return (
      d.getMonth() === currentMonth &&
      d.getFullYear() === currentYear
    );
  });

  const monthlyRequests = monthlyRequestsArray.length;

  // اليوم الأعلى طلباً
  const dayNames = [
    "الأحد",
    "الإثنين",
    "الثلاثاء",
    "الأربعاء",
    "الخميس",
    "الجمعة",
    "السبت",
  ];

  const dayCount: Record<string, number> = {};

  monthlyRequestsArray.forEach((req: any) => {
    const d = new Date(req.timestamp);
    const day = req.dayOfWeek || req.day || "غير محدد";
    dayCount[day] = (dayCount[day] || 0) + 1;
  });

  const highestDemandDay =
    Object.keys(dayCount).length
      ? Object.entries(dayCount).sort(([, a], [, b]) => b - a)[0][0]
      : "لا يوجد بيانات";

  // متوسط الطلبات يومياً
  const uniqueDays = Object.keys(dayCount).length || 1;
  const dailyAverage = Math.round(monthlyRequests / uniqueDays);

  // 🔥 هنا مكان peakPeriod الصحيح
  const peakPeriod = getPeakPeriod(allRequests);

  return {
    monthlyRequests,
    dailyAverage,
    highestDemandDay,
    previousMonthGrowth: 0,
    totalProperties: 1,
    peakPeriod,
    rank: 1,
  };
};



  const stats = calculateAnalytics();

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
                  <Badge className="text-white flex items-center gap-1 px-2 md:px-3 py-0.5 md:py-1 text-xs md:text-sm flex-shrink-0 bg-[#2e2f31]">
                    <Crown className="w-3 h-3" />
                    <span className="hidden md:inline">مميز</span>
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
                    منذ {new Date(property.subscriptionDate).toLocaleDateString("en-US")}
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

        {/* ===== سجل المدفوعات ===== */}
        <Card className="p-4 md:p-6">
          {/* رأس القسم مع زر التوسيع/الطي */}
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={() => setPaymentsExpanded(!paymentsExpanded)}
              className="flex items-center gap-2 hover:opacity-80 transition"
              data-testid="button-toggle-payments"
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                {paymentsExpanded ? (
                  <Minus className="w-4 h-4 text-primary" />
                ) : (
                  <Plus className="w-4 h-4 text-primary" />
                )}
              </div>
              <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                <Receipt className="w-5 h-5" />
                سجل المدفوعات
              </h2>
            </button>
            <Badge variant="outline" className="text-xs">
              {paymentsData?.length || 0} عملية
            </Badge>
          </div>

          {/* أزرار الفلترة */}
          {paymentsExpanded && paymentsData && paymentsData.length > 0 && (
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Filter className="w-4 h-4" />
                <span>فلترة:</span>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={paymentFilter === 'all' ? 'default' : 'outline'}
                  onClick={() => setPaymentFilter('all')}
                  className="text-xs"
                  data-testid="button-filter-all"
                >
                  الكل ({paymentsData.length})
                </Button>
                <Button
                  size="sm"
                  variant={paymentFilter === 'completed' ? 'default' : 'outline'}
                  onClick={() => setPaymentFilter('completed')}
                  className="text-xs"
                  data-testid="button-filter-completed"
                >
                  <CheckCircle2 className="w-3 h-3 ml-1" />
                  مكتمل ({paymentsData.filter((p: any) => p.status === 'مكتمل').length})
                </Button>
                <Button
                  size="sm"
                  variant={paymentFilter === 'pending' ? 'default' : 'outline'}
                  onClick={() => setPaymentFilter('pending')}
                  className="text-xs"
                  data-testid="button-filter-pending"
                >
                  <Clock className="w-3 h-3 ml-1" />
                  معلق ({paymentsData.filter((p: any) => p.status === 'قيد المراجعة' || p.status === 'معلق').length})
                </Button>
              </div>
            </div>
          )}
          
          {/* محتوى المدفوعات */}
          {paymentsExpanded && (
            <>
              {paymentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <span className="mr-2 text-muted-foreground">جاري تحميل المدفوعات...</span>
                </div>
              ) : !paymentsData || paymentsData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>لا توجد مدفوعات حتى الآن</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {paymentsData
                    .filter((payment: any) => {
                      if (paymentFilter === 'all') return true;
                      if (paymentFilter === 'completed') return payment.status === 'مكتمل';
                      if (paymentFilter === 'pending') return payment.status === 'قيد المراجعة' || payment.status === 'معلق';
                      return true;
                    })
                    .map((payment: any) => (
                      <PaymentRow 
                        key={payment.id} 
                        payment={payment} 
                        onRetryPayment={(p) => {
                          retryPaymentMutation.mutate(p.id);
                        }}
                        isRetrying={retryPaymentMutation.isPending}
                      />
                    ))}
                  
                  {/* رسالة إذا لم توجد نتائج بعد الفلترة */}
                  {paymentsData.filter((payment: any) => {
                    if (paymentFilter === 'all') return true;
                    if (paymentFilter === 'completed') return payment.status === 'مكتمل';
                    if (paymentFilter === 'pending') return payment.status === 'قيد المراجعة' || payment.status === 'معلق';
                    return true;
                  }).length === 0 && (
                    <div className="text-center py-6 text-muted-foreground">
                      <Filter className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      <p>لا توجد مدفوعات مطابقة للفلتر المحدد</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* رسالة عند الطي */}
          {!paymentsExpanded && (
            <div className="text-center py-4 text-muted-foreground text-sm">
              اضغط على <Plus className="w-4 h-4 inline mx-1" /> لعرض سجل المدفوعات
            </div>
          )}
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

{/* ===== أداء العقار ===== */}
<Card className="p-6">
  <div className="flex items-center justify-between mb-4">
    <h2 className="text-lg font-bold text-primary">أداء العقار</h2>
    <Badge variant="outline" className="flex items-center gap-1">
      <Activity className="w-3 h-3" />
      تحليلات ذكية
    </Badge>
  </div>

  <div className="grid grid-cols-2 gap-4">
    {/* معدل التفاعل */}
    <StatCard
      label="معدل التفاعل"
      value={analytics?.engagementRate || "متوسط"}
      icon={<Activity className="w-4 h-4" />}
    />

    {/* فترة الذروة: يوم + ساعة */}
    <StatCard
      label="فترة الذروة"
      value={stats.peakPeriod}
      icon={<BarChart2 className="w-4 h-4" />}
    />

    {/* نسبة النمو */}
    <StatCard
      label="النمو الشهري"
      value={`+${analytics?.previousMonthGrowth || 0}%`}
      icon={<TrendingUpIcon />}
    />

    {/* حالة الظهور */}
    <StatCard
      label="حالة الظهور"
      value={isVip ? "ظهور بارز" : analytics?.visibilityStatus || "ظهور عادي"}
      icon={<Eye className="w-4 h-4" />}
    />
  </div>
</Card>

        </div>

{/* ===== تحليلات وملخص ===== */}
<Card className="p-6">
  <div className="flex items-center justify-between mb-4">
    <h2 className="text-lg font-bold text-primary">تحليلات وملخص</h2>
    <Badge variant="outline" className="text-xs">
      بيانات حقيقية
    </Badge>
  </div>

  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
    <AnalyticsBox
      label="طلبات واتساب هذا الشهر"
      value={String(stats.monthlyRequests)}
      note={`نمو +${stats.previousMonthGrowth}% عن الشهر الماضي`}
    />

    <AnalyticsBox
      label="متوسط الطلبات يومياً"
      value={String(stats.dailyAverage)}
      note="معدل ثابت وجيد"
    />

    <AnalyticsBox
      label="اليوم الأعلى طلباً"
      value={stats.highestDemandDay}
      note="ركز عروضك في أيام الذروة"
    />

    <AnalyticsBox
      label="ترتيبك بين العقارات"
      value={`#${stats.rank || 1}`}
      note={`من أصل ${stats.totalProperties} عقار`}
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

        {/* ===== Modal إحصائيات الطلبات ===== */}
        {showRequestsStats && (
          <RequestsStatsModal
            requestsData={requestsData}
            requestsLoading={requestsLoading}
            onClose={() => setShowRequestsStats(false)}
          />
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

function PaymentRow({ payment, onRetryPayment, isRetrying }: { payment: any; onRetryPayment?: (payment: any) => void; isRetrying?: boolean }) {
  const [showDetails, setShowDetails] = useState(false);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "مكتمل":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "قيد المراجعة":
        return <Clock className="w-4 h-4 text-amber-500" />;
      case "معلق":
        return <Clock className="w-4 h-4 text-blue-500" />;
      case "ملغي":
      case "فشل":
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "مكتمل":
        return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
      case "قيد المراجعة":
        return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
      case "معلق":
        return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
      case "ملغي":
      case "فشل":
        return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "---";
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("ar-SA", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  const getPackageNameArabic = (packageId: string) => {
    const packageNames: Record<string, string> = {
      'pkg-month': 'اشتراك شهر',
      'pkg-2months': 'عرض خاص شهرين',
      'pkg-2properties': 'اشتراك شهر لعقارين',
      'pkg-camps': 'باقة المخيمات',
      'pkg-free': 'باقة مجانية',
    };
    return packageNames[packageId] || packageId || 'باقة';
  };

  const amount = payment.finalAmount || payment.amount || 0;
  const isCompleted = payment.status === "مكتمل";

  return (
    <div 
      className="rounded-lg bg-muted/10 border border-border/40 hover:bg-muted/20 transition overflow-hidden"
      data-testid={`payment-row-${payment.id}`}
    >
      {/* الصف الرئيسي */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 p-4">
        {/* السعر على اليسار */}
        <div className="flex items-center gap-2 md:order-first order-last flex-shrink-0">
          <div className="text-center md:text-right min-w-[80px]">
            <div className="font-bold text-primary text-lg">
              {amount} ر.س
            </div>
            {payment.paymentMethod && (
              <div className="text-xs text-muted-foreground">{payment.paymentMethod}</div>
            )}
          </div>
        </div>

        {/* معلومات الباقة */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <CreditCard className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={`text-xs px-2 py-0.5 flex items-center gap-1 ${getStatusBadgeClass(payment.status)}`}>
                {getStatusIcon(payment.status)}
                {payment.status}
              </Badge>
              <span className="font-semibold text-sm truncate">{getPackageNameArabic(payment.packageId)}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {formatDate(payment.createdAt)}
            </div>
          </div>
        </div>

        {/* زر عرض التفاصيل - فقط للدفعات المكتملة */}
        {isCompleted && (
          <Button
            size="sm"
            variant="ghost"
            className="flex-shrink-0 gap-1"
            onClick={() => setShowDetails(!showDetails)}
            data-testid={`button-toggle-details-${payment.id}`}
          >
            {showDetails ? (
              <ChevronDown className="w-4 h-4 rotate-180" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
            <span className="text-xs">تفاصيل</span>
          </Button>
        )}

        {/* زر إكمال الدفع */}
        {(payment.status === "قيد المراجعة" || payment.status === "معلق") && onRetryPayment && (
          <Button
            size="sm"
            variant="default"
            className="bg-primary text-white gap-1 flex-shrink-0"
            onClick={() => onRetryPayment(payment)}
            disabled={isRetrying}
            data-testid={`button-retry-payment-${payment.id}`}
          >
            {isRetrying ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CreditCard className="w-4 h-4" />
            )}
            {isRetrying ? "جاري التحويل..." : "إكمال الدفع"}
          </Button>
        )}
      </div>

      {/* تفاصيل الدفعة الموسعة - فقط للدفعات المكتملة */}
      {showDetails && isCompleted && (
        <div className="border-t border-border/40 bg-muted/5 p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            {/* المبلغ الأصلي */}
            {payment.amount && payment.amount !== amount && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">المبلغ الأصلي</div>
                <div className="font-semibold">{payment.amount} ر.س</div>
              </div>
            )}
            
            {/* كود الخصم */}
            {payment.discountCode && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">كود الخصم</div>
                <div className="font-semibold text-green-600">{payment.discountCode}</div>
              </div>
            )}
            
            {/* قيمة الخصم */}
            {payment.discountAmount > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">قيمة الخصم</div>
                <div className="font-semibold text-green-600">-{payment.discountAmount} ر.س</div>
              </div>
            )}
            
            {/* المبلغ المدفوع */}
            <div>
              <div className="text-xs text-muted-foreground mb-1">المبلغ المدفوع</div>
              <div className="font-bold text-primary">{amount} ر.س</div>
            </div>

            {/* فترة الاشتراك */}
            {payment.pendingStartDate && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">بداية الاشتراك</div>
                <div className="font-semibold">{payment.pendingStartDate}</div>
              </div>
            )}
            {payment.pendingEndDate && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">نهاية الاشتراك</div>
                <div className="font-semibold">{payment.pendingEndDate}</div>
              </div>
            )}
            
            {/* نوع الاشتراك */}
            {payment.pendingSubscriptionType && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">نوع الاشتراك</div>
                <Badge variant={payment.pendingSubscriptionType === 'موثوق' ? 'default' : 'outline'} className="text-xs">
                  {payment.pendingSubscriptionType === 'موثوق' && <Crown className="w-3 h-3 ml-1" />}
                  {payment.pendingSubscriptionType}
                </Badge>
              </div>
            )}
            
            {/* نوع العملية */}
            {payment.action && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">نوع العملية</div>
                <div className="font-semibold">
                  {payment.action === 'activate' ? 'تفعيل جديد' : 
                   payment.action === 'renew' ? 'تجديد' : 
                   payment.action === 'upgrade' ? 'ترقية' : payment.action}
                </div>
              </div>
            )}
            
            {/* تاريخ الإتمام */}
            {payment.completedAt && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">تاريخ الإتمام</div>
                <div className="font-semibold">{formatDate(payment.completedAt)}</div>
              </div>
            )}
          </div>
        </div>
      )}
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

function RequestsStatsModal({
  requestsData,
  requestsLoading,
  onClose,
}: {
  requestsData: any;
  requestsLoading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border p-6 flex items-center justify-between">
          <h2 className="text-lg font-bold text-primary flex items-center gap-2">
            <BarChart2 className="w-5 h-5" />
            إحصائيات طلبات واتساب
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            data-testid="button-close-modal"
          >
            ✕
          </button>
        </div>
        <div className="p-6">
          {requestsLoading ? (
            <div className="text-center py-12 text-muted-foreground">
              جاري التحميل...
            </div>
          ) : requestsData?.requests?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              لا توجد طلبات حتى الآن
            </div>
          ) : (
            <>
              <div className="mb-6 p-4 bg-primary/5 rounded-lg border border-primary/15">
                <p className="text-sm text-muted-foreground mb-2">إجمالي الطلبات</p>
                <p className="text-2xl font-bold text-primary">{requestsData?.requests?.length || 0}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border">
                    <tr className="text-muted-foreground">
                      <th className="text-right p-3">الكود</th>
                      <th className="text-right p-3">التاريخ والوقت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requestsData?.requests?.map((req: any, idx: number) => (
                      <tr key={idx} className="border-b border-border/50 hover:bg-primary/5">
                        <td className="p-3 font-mono text-primary">{req.requestCode || req.id}</td>
                        <td className="p-3 text-muted-foreground">
                          {req.timestamp ? new Date(req.timestamp).toLocaleString('ar-SA') : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
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
