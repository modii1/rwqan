export const ADMIN_CUSTOMER_WHATSAPP_COOLDOWN_MS = 30 * 60 * 1_000;

export function getAdminCustomerWhatsAppHref(bookingId: string): string {
  return `/api/admin/booking-commissions/${encodeURIComponent(bookingId)}/customer-whatsapp`;
}

export function getAdminCustomerWhatsAppRemainingMinutes(
  nextAllowedAt: string | null | undefined,
  nowMs: number,
): number {
  const nextAllowedAtMs = Date.parse(String(nextAllowedAt || ""));
  if (!Number.isFinite(nextAllowedAtMs) || nextAllowedAtMs <= nowMs) return 0;
  return Math.ceil((nextAllowedAtMs - nowMs) / (60 * 1_000));
}
