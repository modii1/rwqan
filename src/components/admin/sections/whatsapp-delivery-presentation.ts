import {
  notificationStatusMeta,
  type BookingHistoryTone,
} from "@/components/booking/booking-admin-history";

export interface BookingWorkflowNotificationJob {
  status?: string | null;
  providerError?: string | null;
  providerDeliveryStatus?: string | null;
}

export interface BookingWorkflowDashboardPayload {
  bookings?: Array<{
    notificationJobs?: BookingWorkflowNotificationJob[] | null;
  }>;
}

export interface BookingWorkflowNotificationStats {
  sent: number;
  pending: number;
  failed: number;
  suppressed: number;
  deferred: number;
}

export function summarizeBookingWorkflowNotifications(
  payload: BookingWorkflowDashboardPayload,
): BookingWorkflowNotificationStats {
  return (payload.bookings || [])
    .flatMap((booking) => booking.notificationJobs || [])
    .reduce<BookingWorkflowNotificationStats>(
      (summary, job) => {
        const status = String(job.status || "")
          .trim()
          .toLowerCase();
        const providerStatus = String(job.providerDeliveryStatus || "")
          .trim()
          .toLowerCase();
        const providerError = String(job.providerError || "")
          .trim()
          .toLowerCase();

        if (providerError === "daily_notification_quota_deferred") {
          summary.deferred += 1;
        } else if (status === "failed" || providerStatus === "failed") {
          summary.failed += 1;
        } else if (
          status === "sent" &&
          (providerStatus === "delivered" || providerStatus === "read")
        ) {
          summary.sent += 1;
        } else if (status === "suppressed_quota") {
          summary.suppressed += 1;
        } else if (status !== "cancelled") {
          summary.pending += 1;
        }
        return summary;
      },
      { sent: 0, pending: 0, failed: 0, suppressed: 0, deferred: 0 },
    );
}

export function generalWhatsAppStatusMeta(log: {
  status?: string | null;
  providerDeliveryStatus?: string | null;
}): { label: string; tone: BookingHistoryTone } {
  const transportStatus = String(log.status || "").trim().toLowerCase();
  return notificationStatusMeta(
    transportStatus === "success" ? "sent" : "failed",
    log.providerDeliveryStatus,
  );
}
