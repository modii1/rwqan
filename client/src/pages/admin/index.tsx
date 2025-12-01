// client/src/pages/admin/index.tsx
import { useState } from "react";
import {
  LayoutDashboard,
  Home,
  CreditCard,
  Gift,
  Inbox,
  Settings,
  DollarSign,
  BarChart3,
} from "lucide-react";

import PropertiesSection from "./sections/properties";
import SubscriptionsSection from "./sections/subscriptions";
import PackagesSection from "./sections/packages";
import DiscountsSection from "./sections/discounts";
import RequestsSection from "./sections/requests";
import PaymentsSection from "./sections/payments"; // << تمت الإضافة هنا

type AdminSection =
  | ""
  | "properties"
  | "subscriptions"
  | "packages"
  | "discounts"
  | "requests"
  | "payments"; // << تمت الإضافة هنا

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
          onClick={() => window.open("/admin/analytics", "_blank")}
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
        {activeSection === "payments" && <PaymentsSection />}  {/* << مهم جدًا */}
        {activeSection === "packages" && <PackagesSection />}
        {activeSection === "discounts" && <DiscountsSection />}
        {activeSection === "requests" && <RequestsSection />}
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
