export type CustomerBookingActions = {
  canContactAgain: boolean;
  canBookAgain: boolean;
  canDownloadSummary: boolean;
};

function normalizeBookingStatus(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function getCustomerBookingActions(
  bookingStatus: unknown,
): CustomerBookingActions {
  const status = normalizeBookingStatus(bookingStatus);
  const isConfirmed = [
    "confirmed",
    "completed",
    "reported",
    "booking_confirmed",
  ].includes(status);

  return {
    canContactAgain: ["contact_only", "expired", "failed", "cancelled"].includes(status),
    canBookAgain: isConfirmed || ["declined", "not_booked", "no_booking", "expired"].includes(status),
    canDownloadSummary: isConfirmed,
  };
}
