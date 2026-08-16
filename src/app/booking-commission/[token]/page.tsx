import type { Metadata } from "next";
import BookingCommissionClient from "@/components/booking/booking-commission-client";

export const metadata: Metadata = {
  title: "عمولة الحجز | روقان",
  description: "مراجعة بيانات الحجز وسداد العمولة",
  robots: { index: false, follow: false },
};

export default async function BookingCommissionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <BookingCommissionClient token={token} />;
}
