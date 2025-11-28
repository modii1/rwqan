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
    <div className="flex min-h-screen bg-muted/30" dir="rtl">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-background border-l md:border-l-0 md:border-r px-3 py-4 flex md:flex-col gap-2 sticky top-0 h-fit md:h-screen">
        <div className="flex items-center gap-2 mb-3 px-2">
          <LayoutDashboard className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-sm font-bold text-primary">لوحة تحكم مودي الذكي</h2>
            <p className="text-[11px] text-muted-foreground">
              إدارة العقارات والاشتراكات
            </p>
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
          icon={<DollarSign className="w-4 h-4" />} // << أيقونة المدفوعات
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
          label="الأكواد والخصومات"
          active={activeSection === "discounts"}
          onClick={() => setActiveSection("discounts")}
        />

        <SidebarButton
          icon={<Inbox className="w-4 h-4" />}
          label="الطلبات والاقتراحات"
          active={activeSection === "requests"}
          onClick={() => setActiveSection("requests")}
        />

        <div className="mt-auto hidden md:block">
          <SidebarButton
            icon={<Settings className="w-4 h-4" />}
            label="إعدادات (لاحقاً)"
            active={false}
            onClick={() => {}}
          />
        </div>
      </aside>

      {/* المحتوى */}
      <main className="flex-1 p-4 md:p-6 max-w-6xl mx-auto space-y-4">
        {activeSection === "" && (
          <div className="text-center text-muted-foreground text-sm mt-20">
            اختر قسم من القائمة الجانبية لبدء الإدارة
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
      className={`flex-1 md:flex-none flex items-center justify-center md:justify-start gap-2 px-2 py-2 rounded-lg text-xs md:text-sm border transition ${
        active
          ? "bg-primary/10 text-primary border-primary/40"
          : "bg-background text-muted-foreground hover:bg-muted/60 border-transparent"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
