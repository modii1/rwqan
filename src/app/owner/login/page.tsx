import OwnerLogin from "@/components/owner/owner-login";
import { Metadata } from "next";

export const metadata: Metadata = {
    title: "تسجيل الدخول | مالك العقار",
    description: "تسجيل الدخول لملاك العقارات",
};

export default function LoginPage() {
    return <OwnerLogin />;
}
