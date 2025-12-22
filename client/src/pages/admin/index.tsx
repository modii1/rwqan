// client/src/pages/admin/index.tsx
import { useLocation } from "wouter";
import AdminWhatsAppSection from "./sections/whatsapp";
import AdminVerificationSection from "./sections/verification";
import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Home,
  CreditCard,
  Gift,
  Inbox,
  Settings,
  DollarSign,
  BarChart3,
  TrendingUp,
  Users,
  Zap,
  HardDrive,
  Code2,
  Eye,
  Smartphone,
  Monitor,
  Tablet,
  MapPin,
  MessageCircle,
  ArrowRight,
  Clock,
  Bell,
  Wallet,
  Settings2,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import PropertiesSection from "./sections/properties";
import AdminSubscriptionsSection from "./sections/admin-subscriptions";
import PackagesSection from "./sections/packages";
import DiscountsSection from "./sections/discounts";
import RequestsSection from "./sections/requests";
import PaymentsSection from "./sections/payments";
import AdminAnalytics from "./admin-analytics";
import AdminBackup from "./admin-backup";
import AdminCodeBackup from "./admin-code-backup";
import VerificationLogsPage from "./sections/verification-logs";
import SettingsSection from "./sections/settings";
import PartnerProfitsSection from "./sections/partner-profits";
import FeeConfigsSection from "./sections/fee-configs";


type AdminSection =
  | ""
  | "properties"
  | "subscriptions"
  | "packages"
  | "discounts"
  | "requests"
  | "payments"
  | "analytics"
  | "verification"
  | "verification-logs"
  | "backup"
  | "code-backup"
  | "whatsapp"
  | "settings"
  | "partner-profits"
  | "fee-configs";

export default function AdminDashboard() {
  const [activeSection, setActiveSection] = useState<AdminSection>("");

  // تحقق جلسة الأدمن
  const { data: adminSession, isLoading } = useQuery<{ isAdmin: boolean }>({
    queryKey: ["/api/admin/session"],
  });

  // جلب التنبيهات للعداد
  const { data: alertsData } = useQuery<any>({
    queryKey: ["/api/admin/alerts"],
    refetchInterval: 30000,
  });

  const alertCount = alertsData?.summary?.totalAlerts || 0;

  // صوت التنبيه عند زيادة عدد التنبيهات
  const prevAlertCount = useRef(alertCount);
  
  const playAlertSound = useCallback(() => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
      console.log('Sound not supported');
    }
  }, []);
  
  useEffect(() => {
    if (alertCount > prevAlertCount.current && prevAlertCount.current > 0) {
      playAlertSound();
    }
    prevAlertCount.current = alertCount;
  }, [alertCount, playAlertSound]);

  // إعادة التوجيه إذا لم يكن أدمن
  const [, setLocation] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 text-center">
          <div className="inline-block w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-lg font-semibold text-foreground">
            جارٍ التحقق من الدخول...
          </p>
        </Card>
      </div>
    );
  }

  // لو مو أدمن → رجوع لصفحة تسجيل الدخول
  if (!adminSession?.isAdmin) {
    setLocation("/owner/login");
    return null;
  }


  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-background" dir="rtl">
      {/* Header للموبايل */}
      <div className="md:hidden border-b border-border bg-card p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-sm font-bold text-primary">لوحة التحكم</h2>
            <p className="text-[10px] text-muted-foreground">إدارة العقارات</p>
          </div>
        </div>
        {/* أيقونة التنبيهات مع العداد */}
        <button
          onClick={() => setActiveSection("")}
          className="relative p-2 rounded-lg hover:bg-muted/50 transition"
          data-testid="button-alerts-mobile"
        >
          <Bell className="w-5 h-5 text-muted-foreground" />
          {alertCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-pulse">
              {alertCount > 9 ? '9+' : alertCount}
            </span>
          )}
        </button>
      </div>

      {/* Sidebar */}
      <aside className="w-full md:w-56 bg-card border-b md:border-b-0 md:border-l px-2 md:px-4 py-3 md:py-6 flex md:flex-col gap-1 md:gap-2 overflow-x-auto md:overflow-visible md:sticky md:top-0 md:h-screen md:border-l">
        <div className="hidden md:flex items-center justify-between mb-3 px-2">
          <div className="flex items-center gap-2">
            <LayoutDashboard className="w-5 h-5 text-primary" />
            <div>
              <h2 className="text-sm font-bold text-primary">لوحة التحكم</h2>
              <p className="text-[11px] text-muted-foreground">إدارة الموارد</p>
            </div>
          </div>
          {/* أيقونة التنبيهات في السايدبار */}
          <button
            onClick={() => setActiveSection("")}
            className="relative p-1.5 rounded-lg hover:bg-muted/50 transition"
            data-testid="button-alerts-desktop"
          >
            <Bell className="w-4 h-4 text-muted-foreground" />
            {alertCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center animate-pulse">
                {alertCount > 9 ? '9+' : alertCount}
              </span>
            )}
          </button>
        </div>

        <SidebarButton
          icon={<Home className="w-4 h-4" />}
          label="العقارات"
          active={activeSection === "properties"}
          onClick={() => setActiveSection("properties")}
        />

        <SidebarButton
          icon={<CreditCard className="w-4 h-4" />}
          label="الاشتراكات"
          active={activeSection === "subscriptions"}
          onClick={() => setActiveSection("subscriptions")}
        />

        <SidebarButton
          icon={<DollarSign className="w-4 h-4" />}
          label="المدفوعات"
          active={activeSection === "payments"}
          onClick={() => setActiveSection("payments")}
        />

        <SidebarButton
          icon={<Gift className="w-4 h-4" />}
          label="الباقات"
          active={activeSection === "packages"}
          onClick={() => setActiveSection("packages")}
        />

        <SidebarButton
          icon={<Gift className="w-4 h-4" />}
          label="الخصومات"
          active={activeSection === "discounts"}
          onClick={() => setActiveSection("discounts")}
        />

        <SidebarButton
          icon={<Inbox className="w-4 h-4" />}
          label="الطلبات"
          active={activeSection === "requests"}
          onClick={() => setActiveSection("requests")}
        />

        <SidebarButton
          icon={<BarChart3 className="w-4 h-4" />}
          label="إحصائيات"
          active={activeSection === "analytics"}
          onClick={() => setActiveSection("analytics")}
        />

        {/*  - زر نظام الواتساب */}
        <SidebarButton
          icon={<MessageCircle className="w-4 h-4 text-green-600" />}
          label="نظام الواتساب"
          active={activeSection === "whatsapp"}
          onClick={() => setActiveSection("whatsapp")}
        />

        <SidebarButton
          icon={<Clock className="w-4 h-4" />}
          label="نظام التحقق"
          active={activeSection === "verification"}
          onClick={() => setActiveSection("verification")}
        />

        <SidebarButton
          icon={<BarChart3 className="w-4 h-4 text-orange-500" />}
          label="سجل التحقق"
          active={activeSection === "verification-logs"}
          onClick={() => setActiveSection("verification-logs")}
        />

        <div className="hidden md:block h-px bg-border my-2" />

        <SidebarButton
          icon={<HardDrive className="w-4 h-4" />}
          label="النسخ الاحتياطية"
          active={activeSection === "backup"}
          onClick={() => setActiveSection("backup")}
        />

        <SidebarButton
          icon={<Code2 className="w-4 h-4" />}
          label="نسخ الأكواس"
          active={activeSection === "code-backup"}
          onClick={() => setActiveSection("code-backup")}
        />

        <div className="hidden md:block h-px bg-border my-2" />

        <SidebarButton
          icon={<Bell className="w-4 h-4" />}
          label="الإعدادات"
          active={activeSection === "settings"}
          onClick={() => setActiveSection("settings")}
        />

        <SidebarButton
          icon={<Wallet className="w-4 h-4 text-emerald-600" />}
          label="أرباح الشريك"
          active={activeSection === "partner-profits"}
          onClick={() => setActiveSection("partner-profits")}
        />

        <SidebarButton
          icon={<Settings2 className="w-4 h-4 text-amber-600" />}
          label="إعدادات الرسوم"
          active={activeSection === "fee-configs"}
          onClick={() => setActiveSection("fee-configs")}
        />

        <div className="hidden md:block h-px bg-border my-2" />

        <SidebarButton
          icon={<ArrowRight className="w-4 h-4 text-red-500" />}
          label="رجوع للموقع"
          active={false}
          onClick={() => setLocation("/")}
        />
      </aside>

      {/* المحتوى */}
      <main className="flex-1 p-3 md:p-6 space-y-4 overflow-auto">
        {/* زر الرجوع */}
        {activeSection !== "" && (
          <button
            onClick={() => setActiveSection("")}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary/10 text-primary border border-primary/30 rounded-lg hover:bg-primary/20 mb-4 transition"
            data-testid="button-back"
          >
            <ArrowRight className="w-4 h-4" />
            رجوع للرئيسية
          </button>
        )}

        {activeSection === "" && <AlertsDashboard />}

        {activeSection === "properties" && <PropertiesSection />}
        {activeSection === "subscriptions" && <AdminSubscriptionsSection />}
        {activeSection === "payments" && <PaymentsSection />}
        {activeSection === "packages" && <PackagesSection />}
        {activeSection === "discounts" && <DiscountsSection />}
        {activeSection === "requests" && <RequestsSection />}
        {activeSection === "analytics" && <AnalyticsContent />}
        {activeSection === "backup" && <AdminBackup />}
        {activeSection === "code-backup" && <AdminCodeBackup />}
        {activeSection === "whatsapp" && <AdminWhatsAppSection />}
        {activeSection === "verification" && <AdminVerificationSection />}
        {activeSection === "verification-logs" && <VerificationLogsPage />}
        {activeSection === "settings" && <SettingsSection />}
        {activeSection === "partner-profits" && <PartnerProfitsSection />}
        {activeSection === "fee-configs" && <FeeConfigsSection />}
      </main>
    </div>
  );
}

function SidebarButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 flex items-center justify-center md:justify-start gap-2 px-2 md:px-3 py-2 md:py-2.5 rounded-lg text-xs md:text-sm whitespace-nowrap md:whitespace-normal border transition ${
        active
          ? "bg-primary/10 text-primary border-primary/40"
          : "bg-transparent text-muted-foreground hover:bg-muted/50 border-transparent hover:text-foreground"
      }`}
    >
      {icon}
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

function AlertsDashboard() {
  const [expandedAlerts, setExpandedAlerts] = useState<Record<number, boolean>>({});
  
  const { data: alertsData, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/alerts"],
    refetchInterval: 30000,
  });

  const toggleExpand = (idx: number) => {
    setExpandedAlerts(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto mb-3"></div>
          <p className="text-muted-foreground text-sm">جاري تحميل التنبيهات...</p>
        </div>
      </div>
    );
  }

  const alerts = alertsData?.alerts || [];
  const stats = alertsData?.stats || {};
  const summary = alertsData?.summary || {};

  const getAlertIcon = (category: string) => {
    switch (category) {
      case 'new-subscriptions': return <Home className="w-5 h-5 text-emerald-500" />;
      case 'property-updates': return <TrendingUp className="w-5 h-5 text-blue-500" />;
      case 'new-payments': return <CreditCard className="w-5 h-5 text-emerald-500" />;
      case 'pending-payments': return <Bell className="w-5 h-5 text-red-500" />;
      case 'suggestions': return <Zap className="w-5 h-5 text-blue-500" />;
      case 'requests': return <MessageCircle className="w-5 h-5 text-blue-500" />;
      case 'expiring-subscriptions': return <Clock className="w-5 h-5 text-amber-500" />;
      case 'expired-subscriptions': return <Bell className="w-5 h-5 text-red-500" />;
      case 'updates': return <TrendingUp className="w-5 h-5 text-blue-500" />;
      default: return <Bell className="w-5 h-5" />;
    }
  };

  const getAlertStyles = (type: string) => {
    switch (type) {
      case 'danger': return 'bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800';
      case 'warning': return 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800';
      case 'info': return 'bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-800';
      case 'success': return 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800';
      default: return 'bg-muted border-border';
    }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      {/* رأس الصفحة مع ملخص التنبيهات */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <Bell className="w-5 h-5 md:w-6 md:h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-lg md:text-xl font-bold text-foreground">مركز التنبيهات</h1>
            <p className="text-xs md:text-sm text-muted-foreground">متابعة كل ما يحدث في النظام</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {summary.criticalAlerts > 0 && (
            <Badge className="bg-red-500 text-white px-2 md:px-3 py-1 text-xs">
              {summary.criticalAlerts} عاجل
            </Badge>
          )}
          {summary.warningAlerts > 0 && (
            <Badge className="bg-amber-500 text-white px-2 md:px-3 py-1 text-xs">
              {summary.warningAlerts} تحذير
            </Badge>
          )}
        </div>
      </div>

      {/* بطاقات الإحصائيات الكبيرة */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4">
        <Card className="p-3 md:p-5 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/50 dark:to-blue-900/50 border-blue-200 dark:border-blue-800" data-testid="stat-properties">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <Home className="w-4 h-4 md:w-5 md:h-5 text-blue-600" />
            </div>
            <span className="text-xs md:text-sm font-medium text-blue-700 dark:text-blue-400">العقارات</span>
          </div>
          <p className="text-2xl md:text-3xl font-bold text-blue-600">{stats.totalProperties || 0}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] md:text-xs text-emerald-600 font-medium">{stats.trustedProperties || 0} مميز</span>
            <span className="text-[10px] md:text-xs text-muted-foreground">| {stats.normalProperties || 0} عادي</span>
          </div>
        </Card>

        <Card className="p-3 md:p-5 bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/50 dark:to-emerald-900/50 border-emerald-200 dark:border-emerald-800" data-testid="stat-subscriptions">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <CreditCard className="w-4 h-4 md:w-5 md:h-5 text-emerald-600" />
            </div>
            <span className="text-xs md:text-sm font-medium text-emerald-700 dark:text-emerald-400">الاشتراكات</span>
          </div>
          <p className="text-2xl md:text-3xl font-bold text-emerald-600">{stats.activeSubscriptions || 0}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] md:text-xs text-emerald-600 font-medium">نشط</span>
            <span className="text-[10px] md:text-xs text-red-500">| {stats.expiredSubscriptions || 0} منتهي</span>
          </div>
        </Card>

        <Card className="p-3 md:p-5 bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/50 dark:to-amber-900/50 border-amber-200 dark:border-amber-800" data-testid="stat-requests">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <MessageCircle className="w-4 h-4 md:w-5 md:h-5 text-amber-600" />
            </div>
            <span className="text-xs md:text-sm font-medium text-amber-700 dark:text-amber-400">الطلبات</span>
          </div>
          <p className="text-2xl md:text-3xl font-bold text-amber-600">{stats.todayRequests || 0}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] md:text-xs text-amber-600 font-medium">اليوم</span>
            <span className="text-[10px] md:text-xs text-muted-foreground">| {stats.weekRequests || 0} هذا الأسبوع</span>
          </div>
        </Card>

        <Card className="p-3 md:p-5 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950/50 dark:to-purple-900/50 border-purple-200 dark:border-purple-800" data-testid="stat-payments">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <DollarSign className="w-4 h-4 md:w-5 md:h-5 text-purple-600" />
            </div>
            <span className="text-xs md:text-sm font-medium text-purple-700 dark:text-purple-400">المدفوعات</span>
          </div>
          <p className="text-2xl md:text-3xl font-bold text-purple-600">{stats.todayPayments || 0}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] md:text-xs text-purple-600 font-medium">اليوم</span>
            {stats.pendingPayments > 0 && (
              <span className="text-[10px] md:text-xs text-red-500 font-bold">| {stats.pendingPayments} معلقة</span>
            )}
          </div>
        </Card>
      </div>

      {/* بطاقات إحصائيات إضافية */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 md:gap-3">
        <Card className="p-2 md:p-3 text-center border" data-testid="stat-today-subscriptions">
          <p className="text-lg md:text-2xl font-bold text-emerald-600">{stats.todaySubscriptions || 0}</p>
          <p className="text-[10px] md:text-xs text-muted-foreground">اشتراكات اليوم</p>
        </Card>
        <Card className="p-2 md:p-3 text-center border" data-testid="stat-property-updates">
          <p className="text-lg md:text-2xl font-bold text-blue-600">{stats.propertyUpdates || 0}</p>
          <p className="text-[10px] md:text-xs text-muted-foreground">تحديثات العقارات</p>
        </Card>
        <Card className="p-2 md:p-3 text-center border" data-testid="stat-week-revenue">
          <p className="text-lg md:text-2xl font-bold text-emerald-600">{stats.weekRevenue || 0}</p>
          <p className="text-[10px] md:text-xs text-muted-foreground">إيرادات الأسبوع</p>
        </Card>
        <Card className="p-2 md:p-3 text-center border" data-testid="stat-week-payments">
          <p className="text-lg md:text-2xl font-bold text-blue-600">{stats.weekPayments || 0}</p>
          <p className="text-[10px] md:text-xs text-muted-foreground">مدفوعات الأسبوع</p>
        </Card>
        <Card className="p-2 md:p-3 text-center border" data-testid="stat-suggestions">
          <p className="text-lg md:text-2xl font-bold text-amber-600">{stats.pendingSuggestions || 0}</p>
          <p className="text-[10px] md:text-xs text-muted-foreground">اقتراحات جديدة</p>
        </Card>
        <Card className="p-2 md:p-3 text-center border" data-testid="stat-pending">
          <p className="text-lg md:text-2xl font-bold text-red-600">{stats.pendingPayments || 0}</p>
          <p className="text-[10px] md:text-xs text-muted-foreground">مدفوعات معلقة</p>
        </Card>
      </div>

      {/* عنوان التنبيهات */}
      <div className="flex items-center gap-2 pt-2">
        <Bell className="w-4 h-4 text-primary" />
        <h2 className="text-sm md:text-base font-bold text-foreground">التنبيهات والأحداث</h2>
        <Badge variant="outline" className="text-xs">{alerts.length}</Badge>
      </div>

      {/* قائمة التنبيهات */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
        {alerts.map((alert: any, idx: number) => (
          <Card key={idx} className={`p-3 md:p-4 border-2 ${getAlertStyles(alert.type)}`} data-testid={`alert-${alert.category}`}>
            <div className="flex items-start gap-2 md:gap-3">
              {getAlertIcon(alert.category)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h3 className="text-xs md:text-sm font-bold text-foreground truncate">{alert.title}</h3>
                  {alert.count > 0 && (
                    <Badge variant="outline" className="text-[10px] md:text-xs flex-shrink-0">
                      {alert.count}
                    </Badge>
                  )}
                </div>
                <p className="text-[10px] md:text-xs text-muted-foreground mb-2">{alert.message}</p>
                
                {/* تفاصيل التنبيه */}
                {alert.items && alert.items.length > 0 && (
                  <div className={`space-y-1 ${expandedAlerts[idx] ? 'max-h-64' : 'max-h-24'} overflow-y-auto transition-all duration-300`}>
                    {(expandedAlerts[idx] ? alert.items : alert.items.slice(0, 3)).map((item: any, i: number) => (
                      <div key={i} className="flex items-center justify-between text-[10px] md:text-xs bg-background/60 rounded px-2 py-1">
                        {item.propertyNumber && (
                          <span className="font-mono font-semibold">#{item.propertyNumber}</span>
                        )}
                        {item.name && !item.propertyNumber && (
                          <span className="font-semibold truncate max-w-[100px]">{item.name}</span>
                        )}
                        {item.daysLeft !== undefined && (
                          <span className="text-amber-600 font-medium">متبقي {item.daysLeft} يوم</span>
                        )}
                        {item.endDate && !item.daysLeft && (
                          <span className="text-muted-foreground">{new Date(item.endDate).toLocaleDateString('en-US')}</span>
                        )}
                        {item.amount && (
                          <span className="text-emerald-600 font-medium">{item.amount} ر.س</span>
                        )}
                        {item.requestCode && (
                          <span className="text-blue-600 font-mono">{item.requestCode}</span>
                        )}
                        {item.city && (
                          <span className="text-muted-foreground">{item.city}</span>
                        )}
                      </div>
                    ))}
                    {alert.items.length > 3 && (
                      <button 
                        onClick={() => toggleExpand(idx)}
                        className="w-full text-[10px] text-primary hover:text-primary/80 font-medium text-center py-1 hover:bg-primary/5 rounded transition"
                        data-testid={`button-expand-${idx}`}
                      >
                        {expandedAlerts[idx] ? 'عرض أقل ▲' : `+${alert.items.length - 3} المزيد ▼`}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}

        {alerts.length === 0 && (
          <Card className="p-6 md:p-8 text-center border-2 border-dashed col-span-full">
            <div className="w-12 h-12 md:w-16 md:h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-3 md:mb-4">
              <TrendingUp className="w-6 h-6 md:w-8 md:h-8 text-emerald-600" />
            </div>
            <h3 className="text-base md:text-lg font-bold text-foreground mb-2">كل شيء تمام!</h3>
            <p className="text-xs md:text-sm text-muted-foreground">لا توجد تنبيهات مهمة حالياً</p>
          </Card>
        )}
      </div>

      {/* وقت آخر تحديث */}
      <p className="text-[10px] md:text-xs text-muted-foreground text-center pt-2">
        آخر تحديث: {summary.lastUpdated || '-'}
      </p>
    </div>
  );
}

function AnalyticsContent() {
  const { data: analyticsData, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics"],
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: visitorsData } = useQuery<any>({
    queryKey: ["/api/admin/visitors"],
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPIs - Row 1 */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-6 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-blue-200 dark:border-blue-800">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-2 font-medium">إجمالي الزوار</p>
              <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
                {analyticsData?.visitors || 0}
              </p>
            </div>
            <TrendingUp className="w-8 h-8 text-blue-400 opacity-70" />
          </div>
        </Card>
        <Card className="p-6 bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950 dark:to-emerald-900 border-emerald-200 dark:border-emerald-800">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-2 font-medium">عدد العقارات</p>
              <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                {analyticsData?.totalProperties || 0}
              </p>
            </div>
            <Home className="w-8 h-8 text-emerald-400 opacity-70" />
          </div>
        </Card>
        <Card className="p-6 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900 border-purple-200 dark:border-purple-800">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-2 font-medium">زوار فريدون</p>
              <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">
                {analyticsData?.uniqueVisitors || 0}
              </p>
            </div>
            <Eye className="w-8 h-8 text-purple-400 opacity-70" />
          </div>
        </Card>
        <Card className="p-6 bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950 dark:to-amber-900 border-amber-200 dark:border-amber-800">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-2 font-medium">متوسط الطلبات</p>
              <p className="text-3xl font-bold text-amber-600 dark:text-amber-400">
                {analyticsData?.totalProperties
                  ? Math.round(analyticsData.totalRequests / analyticsData.totalProperties)
                  : 0}
              </p>
            </div>
            <Zap className="w-8 h-8 text-amber-400 opacity-70" />
          </div>
        </Card>
      </div>

      {/* Devices & Cities */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Devices */}
        <Card className="p-6 border-2 border-primary/20">
          <h2 className="text-lg font-bold text-primary mb-4 flex items-center gap-2">
            <Smartphone className="w-5 h-5" />
            توزيع الأجهزة
          </h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-gradient-to-r from-blue-50 to-transparent dark:from-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-2">
                <Monitor className="w-5 h-5 text-blue-600" />
                <span className="font-semibold">سطح المكتب</span>
              </div>
              <Badge className="bg-blue-600">{analyticsData?.devices?.desktop || 0}</Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-gradient-to-r from-green-50 to-transparent dark:from-green-950/30 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-green-600" />
                <span className="font-semibold">الأجهزة المحمولة</span>
              </div>
              <Badge className="bg-green-600">{analyticsData?.devices?.mobile || 0}</Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-gradient-to-r from-purple-50 to-transparent dark:from-purple-950/30 rounded-lg border border-purple-200 dark:border-purple-800">
              <div className="flex items-center gap-2">
                <Tablet className="w-5 h-5 text-purple-600" />
                <span className="font-semibold">الأجهزة اللوحية</span>
              </div>
              <Badge className="bg-purple-600">{analyticsData?.devices?.tablet || 0}</Badge>
            </div>
          </div>
        </Card>

        {/* Cities */}
        <Card className="p-6 border-2 border-primary/20">
          <h2 className="text-lg font-bold text-primary mb-4 flex items-center gap-2">
            <MapPin className="w-5 h-5" />
            توزيع المدن
          </h2>
          <div className="space-y-2">
            {analyticsData?.cities?.slice(0, 6)?.map((city: any, idx: number) => (
              <div key={idx} className="flex items-center justify-between p-2 bg-gradient-to-r from-primary/5 to-transparent hover:from-primary/10 rounded-lg border border-primary/10 transition-colors">
                <span className="font-semibold text-sm">{city.name}</span>
                <Badge variant="outline">{city.count}</Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Visitor Details */}
      <Card className="p-6 border-2 border-primary/20">
        <h2 className="text-lg font-bold text-primary mb-4 flex items-center gap-2">
          <Eye className="w-5 h-5" />
          آخر الزوار
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-primary/20 bg-primary/5">
                <th className="text-right p-3 font-semibold text-primary">اسم العقار</th>
                <th className="text-right p-3 font-semibold text-primary">الجهاز</th>
                <th className="text-right p-3 font-semibold text-primary">الوقت</th>
              </tr>
            </thead>
            <tbody>
              {visitorsData?.visitors?.slice(0, 20)?.map((visitor: any, idx: number) => (
                <tr key={idx} className="border-b border-border/50 hover:bg-primary/5 transition-colors">
                  <td className="p-3 font-semibold text-foreground">{visitor.propertyName}</td>
                  <td className="p-3">
                    <Badge variant="outline" className="flex w-fit gap-1 text-xs">
                      {visitor.deviceType === 'mobile' && <Smartphone className="w-3 h-3" />}
                      {visitor.deviceType === 'desktop' && <Monitor className="w-3 h-3" />}
                      {visitor.deviceType === 'tablet' && <Tablet className="w-3 h-3" />}
                      <span>{
                        visitor.deviceType === 'mobile' ? 'جوال' :
                        visitor.deviceType === 'tablet' ? 'تابلت' :
                        'سطح المكتب'
                      }</span>
                    </Badge>
                  </td>
                  <td className="p-3 text-muted-foreground text-xs">{visitor.dayOfWeek} {visitor.hourOfDay}:00</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Top Properties */}
      <Card className="p-6 border-2 border-primary/20">
        <h2 className="text-lg font-bold text-primary mb-4 flex items-center gap-2">
          <Home className="w-5 h-5" />
          أفضل العقارات طلباً
        </h2>
        <div className="space-y-2">
          {analyticsData?.byProperty?.slice(0, 10)?.map((prop: any, idx: number) => (
            <div
              key={idx}
              className="flex items-center justify-between p-3 bg-gradient-to-r from-primary/5 to-transparent hover:from-primary/10 rounded-lg border border-primary/10 transition-colors"
            >
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                    {idx + 1}
                  </span>
                  <div>
                    <p className="font-semibold text-foreground text-sm">{prop.propertyName}</p>
                  </div>
                </div>
              </div>
              <Badge className="bg-primary text-white">{prop.requestCount}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
