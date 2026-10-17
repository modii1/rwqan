import type { Metadata } from "next";
import { Suspense } from "react";
import CustomerAuthPage, { CustomerAuthPageFallback } from "@/components/customer/customer-auth-page";

export const metadata: Metadata = {
  title: "إنشاء حساب عميل | روقان",
  robots: { index: false, follow: false },
};

export default function CustomerRegisterPage() {
  return (
    <Suspense fallback={<CustomerAuthPageFallback variant="register" />}>
      <CustomerAuthPage variant="register" />
    </Suspense>
  );
}
