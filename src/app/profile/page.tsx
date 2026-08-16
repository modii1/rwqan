import type { Metadata } from "next";
import CustomerBookingsProfile from "@/components/booking/customer-bookings-profile";

export const metadata: Metadata = {
  title: "حجوزاتي | روقان",
  description: "سجل طلبات التواصل والحجوزات",
  robots: { index: false, follow: false },
};

export default function CustomerProfilePage() {
  return <CustomerBookingsProfile />;
}
