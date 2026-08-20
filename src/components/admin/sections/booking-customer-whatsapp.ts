export function getAdminCustomerWhatsAppHref(bookingId: string): string {
  return `/api/admin/booking-commissions/${encodeURIComponent(bookingId)}/customer-whatsapp`;
}
