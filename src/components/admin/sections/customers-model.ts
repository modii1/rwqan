import type { BookingDisplayRow } from "@/components/booking/booking-display";

export type CustomerContactStatusFilter =
  | "all"
  | "contact_only"
  | "awaiting"
  | "confirmed"
  | "declined"
  | "expired";

function normalize(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function hasEvent(row: BookingDisplayRow, type: string): boolean {
  return [...(row.events || []), ...(row.timeline || [])]
    .some((event) => normalize(event.type) === type);
}

export function customerContactStatus(
  row: BookingDisplayRow,
): Exclude<CustomerContactStatusFilter, "all"> {
  const status = normalize(row.bookingStatus);
  if (status === "contact_only") return "contact_only";
  if (status === "expired" || hasEvent(row, "customer_followup_expired")) {
    return "expired";
  }
  if (["confirmed", "completed", "reported", "booking_confirmed"].includes(status)) {
    return "confirmed";
  }
  if (["declined", "not_booked", "no_booking"].includes(status)) {
    return "declined";
  }
  return "awaiting";
}

export function filterCustomerContacts(
  rows: BookingDisplayRow[],
  search: string,
  statusFilter: CustomerContactStatusFilter,
): BookingDisplayRow[] {
  const normalizedSearch = search.trim().toLowerCase();
  return rows
    .filter((row) => {
      if (statusFilter !== "all" && customerContactStatus(row) !== statusFilter) {
        return false;
      }
      if (!normalizedSearch) return true;
      return [
        row.customerPhoneMasked,
        row.propertyNumber,
        row.propertyName,
        row.requestCode,
        row.id,
      ].some((value) => String(value || "").toLowerCase().includes(normalizedSearch));
    })
    .sort((left, right) => {
      const rightAt = Date.parse(String(right.contactAt || ""));
      const leftAt = Date.parse(String(left.contactAt || ""));
      return (Number.isFinite(rightAt) ? rightAt : 0)
        - (Number.isFinite(leftAt) ? leftAt : 0);
    });
}

export function summarizeCustomerContacts(rows: BookingDisplayRow[]) {
  const statuses = rows.map(customerContactStatus);
  return {
    total: rows.length,
    contactOnly: statuses.filter((status) => status === "contact_only").length,
    awaiting: statuses.filter((status) => status === "awaiting").length,
    confirmed: statuses.filter((status) => status === "confirmed").length,
    declined: statuses.filter((status) => status === "declined").length,
    expired: statuses.filter((status) => status === "expired").length,
  };
}
