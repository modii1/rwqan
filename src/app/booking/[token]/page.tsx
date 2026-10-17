import type { Metadata } from "next";
import BookingFollowupClient from "@/components/booking/booking-followup-client";

export const metadata: Metadata = {
  title: "تأكيد الحجز | روقان",
  description: "تأكيد نتيجة طلب الحجز وتسجيل التفاصيل",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function BookingFollowupPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <BookingFollowupClient token={token} />;
}
