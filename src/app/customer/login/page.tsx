import type { Metadata } from "next";
import { Suspense } from "react";
import CustomerAuthPage, { CustomerAuthPageFallback } from "@/components/customer/customer-auth-page";

export const metadata: Metadata = {
  title: "تسجيل دخول العميل | روقان",
  robots: { index: false, follow: false },
};

export default function CustomerLoginPage() {
  return (
    <Suspense fallback={<CustomerAuthPageFallback variant="login" />}>
      <CustomerAuthPage variant="login" />
    </Suspense>
  );
}
