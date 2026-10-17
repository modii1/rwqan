import SubscriptionPage from "@/components/subscription-page";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "اشترك معنا | روقان",
    description: "سجل عقارك وابدأ باستقبال الحجوزات",
};

export default function Page() {
    return <SubscriptionPage />;
}
