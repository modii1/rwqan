import OwnerDashboard from "@/components/owner/owner-dashboard";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "لوحة التحكم | مالك العقار",
    description: "إدارة العقار والاشتراكات",
};

export default function DashboardPage() {
    return <OwnerDashboard />;
}
