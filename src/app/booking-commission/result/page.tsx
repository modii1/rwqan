import type { Metadata } from "next";
import BookingCommissionResultClient from "@/components/booking/booking-commission-result-client";

export const metadata: Metadata = {
  title: "نتيجة دفع العمولة | روقان",
  robots: { index: false, follow: false },
};

export default async function BookingCommissionResultPage({
  searchParams,
}: {
  searchParams: Promise<{ payment?: string }>;
}) {
  const { payment } = await searchParams;
  const failed = payment === "failed";

  return <BookingCommissionResultClient failed={failed} />;
}
