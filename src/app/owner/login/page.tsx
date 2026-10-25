import OwnerLogin from "@/components/owner/owner-login";
import { parseAuthRole } from "@/lib/auth-role";
import type { Metadata } from "next";

type LoginPageProps = {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ searchParams }: LoginPageProps): Promise<Metadata> {
    const mode = parseAuthRole((await searchParams).mode);
    if (mode === "customer") {
        return {
            title: "تسجيل دخول العميل | روقان",
            description: "ادخل برقم جوالك الموثق للوصول إلى حسابك ومفضّلتك وسجل حجوزاتك.",
        };
    }
    if (mode === "admin") {
        return {
            title: "دخول المسؤول | روقان",
            description: "أدخل بيانات حسابك للمتابعة",
        };
    }
    return {
        title: "تسجيل الدخول | مالك العقار",
        description: "تسجيل الدخول لملاك العقارات",
    };
}

export default async function LoginPage({
    searchParams,
}: LoginPageProps) {
    const params = await searchParams;
    return <OwnerLogin initialMode={parseAuthRole(params.mode)} />;
}
