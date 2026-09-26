export type BookingHistoryTone = "green" | "amber" | "red" | "blue" | "slate" | "violet";

function normalize(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function fallback(value: unknown): string {
  return String(value || "").trim() || "—";
}

export function notificationKindLabel(value: unknown): string {
  const kind = normalize(value);
  const labels: Record<string, string> = {
    customer_followup: "متابعة نتيجة الحجز مع العميل",
    customer_final_reminder: "المتابعة الأخيرة مع العميل",
    owner_contact_limit_reached: "إشعار المالك باكتمال حد التواصل",
    owner_booking_confirmed: "إشعار المالك بتأكيد الحجز والعمولة",
    commission_dispute_rejected: "إشعار المالك برفض الاعتراض",
    commission_reminder_3: "تذكير العمولة لليوم الثالث",
    commission_reminder_4: "تذكير العمولة لليوم الرابع",
    commission_reminder_5: "تذكير العمولة لليوم الخامس",
    property_paused: "إشعار إيقاف العقار",
    property_released: "إشعار رفع إيقاف العقار",
  };
  return labels[kind] || fallback(value);
}

export function notificationStatusMeta(
  value: unknown,
  providerDeliveryStatus?: unknown,
): { label: string; tone: BookingHistoryTone } {
  const status = normalize(value);
  const providerStatus = normalize(providerDeliveryStatus);
  if (status === "sent") {
    if (providerStatus === "failed") {
      return { label: "فشل الإرسال", tone: "red" };
    }
    if (providerStatus === "delivered" || providerStatus === "read") {
      return { label: "تم الإرسال", tone: "green" };
    }
    if (providerStatus === "accepted") {
      return { label: "قيد الإرسال", tone: "blue" };
    }
    return { label: "تم الإرسال", tone: "green" };
  }
  if (status === "failed") return { label: "فشل الإرسال", tone: "red" };
  if (status === "suppressed_quota") return { label: "منعها حد الرسائل", tone: "amber" };
  if (status === "cancelled") return { label: "أُلغيت", tone: "slate" };
  if (status === "claimed") return { label: "قيد الإرسال", tone: "blue" };
  if (status === "pending") return { label: "مجدولة", tone: "blue" };
  return { label: fallback(value), tone: "slate" };
}

export function notificationRecipientLabel(value: unknown): string {
  const role = normalize(value);
  if (role === "customer") return "العميل";
  if (role === "owner") return "المالك";
  return fallback(value);
}

export function notificationProviderErrorLabel(value: unknown): string {
  const reason = normalize(value);
  const labels: Record<string, string> = {
    commission_waived: "أُلغيت العمولة قبل إرسال الإشعار.",
    booking_not_found: "تعذر العثور على سجل الحجز عند محاولة الإرسال.",
    customer_response_expired: "انتهت مهلة رد العميل قبل الإرسال.",
    owner_identity_changed: "تغيرت هوية مالك العقار فتوقف الإرسال.",
    booking_free_eligibility_lost: "أُلغيت الرسالة بعد تفعيل اشتراك مميز للعقار.",
    booking_followup_feature_disabled: "ميزة متابعة الحجز متوقفة.",
    commission_feature_disabled: "ميزة تحصيل العمولة متوقفة.",
    awaiting_owner_commission_notice: "بانتظار قبول مزود واتساب لإشعار العمولة الأساسي للإرسال.",
    commission_paid: "أُلغيت الرسالة بعد سداد العمولة.",
    commission_disputed: "أُلغيت الرسالة أثناء مراجعة الاعتراض.",
    superseded_reminder: "استُبدل التذكير بتذكير أحدث مستحق.",
    daily_notification_quota: "مُنع الإرسال بسبب بلوغ الحد اليومي للرسائل.",
    daily_notification_quota_deferred:
      "أُجل الإرسال إلى يوم الرياض التالي بسبب بلوغ الحد اليومي للرسائل.",
    send_failed: "فشل مزود الإرسال دون تفاصيل إضافية.",
    notification_state_changed: "أُلغيت الرسالة لأن حالة الحجز أو العقار تغيرت.",
  };
  return labels[reason] || fallback(value);
}
