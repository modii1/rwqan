// client/src/pages/admin/index.tsx
import { useState } from "react";
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
} from "lucide-react";

import PropertiesSection from "./sections/properties";
import SubscriptionsSection from "./sections/subscriptions";
import PackagesSection from "./sections/packages";
import DiscountsSection from "./sections/discounts";
import RequestsSection from "./sections/requests";
import PaymentsSection from "./sections/payments";
import AdminAnalytics from "./admin-analytics";

type AdminSection =
  | ""
  | "properties"
  | "subscriptions"
  | "packages"
  | "discounts"
  | "requests"
  | "payments"
  | "analytics";

export default function AdminDashboard() {
  const [activeSection, setActiveSection] = useState<AdminSection>("");

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
      </div>

      {/* Sidebar */}
      <aside className="w-full md:w-56 bg-card border-b md:border-b-0 md:border-l px-2 md:px-4 py-3 md:py-6 flex md:flex-col gap-1 md:gap-2 overflow-x-auto md:overflow-visible md:sticky md:top-0 md:h-screen md:border-l">
        <div className="hidden md:flex items-center gap-2 mb-3 px-2">
          <LayoutDashboard className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-sm font-bold text-primary">لوحة التحكم</h2>
            <p className="text-[11px] text-muted-foreground">إدارة الموارد</p>
          </div>
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
      </aside>

      {/* المحتوى */}
      <main className="flex-1 p-3 md:p-6 space-y-4 overflow-auto">
        {activeSection === "" && (
          <div className="text-center text-muted-foreground text-sm mt-10 md:mt-20">
            اختر قسم من القائمة لبدء الإدارة
          </div>
        )}

        {activeSection === "properties" && <PropertiesSection />}
        {activeSection === "subscriptions" && <SubscriptionsSection />}
        {activeSection === "payments" && <PaymentsSection />}
        {activeSection === "packages" && <PackagesSection />}
        {activeSection === "discounts" && <DiscountsSection />}
        {activeSection === "requests" && <RequestsSection />}
        {activeSection === "analytics" && <AnalyticsContent />}
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

function AnalyticsContent() {
  const { data: analyticsData, isLoading } = useQuery<any>({
    queryKey: ["admin-requests"],
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
      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border border-blue-200 dark:border-blue-800 p-6 rounded-lg">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-2 font-medium">إجمالي الطلبات</p>
              <p className="text-4xl font-bold text-blue-600 dark:text-blue-400">
                {analyticsData?.totalRequests || 0}
              </p>
            </div>
            <TrendingUp className="w-8 h-8 text-blue-400 opacity-70" />
          </div>
        </div>
        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950 dark:to-emerald-900 border border-emerald-200 dark:border-emerald-800 p-6 rounded-lg">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-2 font-medium">عدد العقارات</p>
              <p className="text-4xl font-bold text-emerald-600 dark:text-emerald-400">
                {analyticsData?.totalProperties || 0}
              </p>
            </div>
            <Users className="w-8 h-8 text-emerald-400 opacity-70" />
          </div>
        </div>
        <div className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950 dark:to-amber-900 border border-amber-200 dark:border-amber-800 p-6 rounded-lg">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-2 font-medium">متوسط الطلبات</p>
              <p className="text-4xl font-bold text-amber-600 dark:text-amber-400">
                {analyticsData?.totalProperties
                  ? Math.round(analyticsData.totalRequests / analyticsData.totalProperties)
                  : 0}
              </p>
            </div>
            <Zap className="w-8 h-8 text-amber-400 opacity-70" />
          </div>
        </div>
      </div>

      {/* Top Properties */}
      <div className="bg-card p-6 rounded-lg border-2 border-primary/20">
        <h2 className="text-lg font-bold text-primary mb-4 flex items-center gap-2">
          <Home className="w-5 h-5" />
          أفضل العقارات طلباً
        </h2>
        <div className="space-y-2">
          {analyticsData?.byProperty?.slice(0, 15)?.map((prop: any, idx: number) => (
            <div
              key={idx}
              className="flex items-center justify-between p-4 bg-gradient-to-r from-primary/5 to-transparent hover:from-primary/10 rounded-lg border border-primary/10 transition-colors"
            >
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                    {idx + 1}
                  </span>
                  <div>
                    <p className="font-semibold text-foreground">{prop.propertyName}</p>
                    <p className="text-xs text-muted-foreground">#{prop.propertyNumber}</p>
                  </div>
                </div>
              </div>
              <div className="bg-primary text-white px-3 py-1 rounded-full text-sm font-semibold">
                {prop.requestCount}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
