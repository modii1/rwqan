export type BookingCommissionDetailsPresentation = "mobile_sheet" | "desktop_inline";

export function getBookingCommissionDetailsPresentation(
  isMobile: boolean,
): BookingCommissionDetailsPresentation {
  return isMobile ? "mobile_sheet" : "desktop_inline";
}
