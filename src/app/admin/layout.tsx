import { Metadata } from "next";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
    title: "لوحة التحكم | روقان",
    description: "إدارة العقارات والاشتراكات",
};

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <>
            {children}
            <Toaster />
        </>
    );
}
