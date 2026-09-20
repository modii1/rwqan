import type { Metadata } from "next";
import { Suspense } from "react";
import CustomerAuthPage from "@/components/customer/customer-auth-page";

export const metadata: Metadata = {
  title: "تسجيل دخول العميل | روقان",
  robots: { index: false, follow: false },
};

export default function CustomerLoginPage() {
  return (
    <Suspense fallback={null}>
      <CustomerAuthPage variant="login" />
    </Suspense>
  );
}
