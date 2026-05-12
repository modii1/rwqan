import AdminDashboard from "@/components/admin/admin-dashboard";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "لوحة التحكم | روقان",
    description: "إدارة العقارات والاشتراكات",
};

export default function AdminPage() {
    return (
        <div className="min-h-screen flex flex-col">
            <AdminDashboard />
        </div>
    );
}
