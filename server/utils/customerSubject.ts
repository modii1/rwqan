import { createHmac } from "node:crypto";

/**
 * Stable identity used by the existing booking workflow.
 *
 * Keep the domain separator and digit normalization byte-for-byte compatible
 * with BookingCommissionService.createCustomerSubject so historical booking
 * records remain attached to the same verified phone.
 */
export function createCustomerSubject(customerPhone: unknown): string {
  const normalizedPhone = String(customerPhone || "").replace(/\D/g, "");
  if (normalizedPhone.length < 9 || normalizedPhone.length > 15) {
    throw new RangeError("Invalid customer phone");
  }

  const secret = process.env.SESSION_SECRET || "";
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must be at least 32 bytes for booking workflows");
  }

  return createHmac("sha256", secret)
    .update(`booking-customer-phone:${normalizedPhone}`)
    .digest("hex");
}
