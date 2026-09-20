import type { Metadata } from "next";
import { Suspense } from "react";
import CustomerAuthPage from "@/components/customer/customer-auth-page";

export const metadata: Metadata = {
  title: "إنشاء حساب عميل | روقان",
  robots: { index: false, follow: false },
};

export default function CustomerRegisterPage() {
  return (
    <Suspense fallback={null}>
      <CustomerAuthPage variant="register" />
    </Suspense>
  );
}
