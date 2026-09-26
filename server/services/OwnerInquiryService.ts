import type {
  OwnerInquiryResponse,
  OwnerInquiryRow,
} from "../../shared/owner-inquiries";
import type { Request as PropertyRequest } from "../../shared/schema";
import { maskContactPhone } from "./ContactIdentityService";
import {
  BOOKING_CUSTOMER_RESPONSE_WINDOW_MS,
} from "./BookingCommissionStore";
import type { BookingFollowUpDocument } from "./BookingCommissionTypes";
import type { OwnerInquiryNote } from "./OwnerInquiryNoteService";
import type { OwnerInquiryVisibilityRecord } from "./OwnerInquiryVisibilityService";

function validTime(value: unknown): number {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isExpired(
  booking: BookingFollowUpDocument,
  now: Date,
): boolean {
  return booking.bookingStatus === "awaiting_response" &&
    validTime(booking.createdAt) + BOOKING_CUSTOMER_RESPONSE_WINDOW_MS <= now.getTime();
}

function bookingDate(
  booking?: BookingFollowUpDocument,
): OwnerInquiryRow["bookingDate"] {
  const value = booking?.confirmationFacts?.bookingDate;
  if (!value) return null;
  return {
    value: value.value,
    precision: value.precision,
    ...("calendar" in value ? { calendar: value.calendar } : {}),
    ...("startDate" in value ? { startDate: value.startDate } : {}),
    ...("endDate" in value ? { endDate: value.endDate } : {}),
  };
}

function rowFrom(
  request: PropertyRequest | undefined,
  booking: BookingFollowUpDocument | undefined,
  now: Date,
  note?: OwnerInquiryNote,
): OwnerInquiryRow {
  if (!request && !booking) {
    throw new TypeError("An owner inquiry requires a request or booking");
  }
  const rawStatus = booking?.bookingStatus || "contact_only";
  const bookingStatus = booking && isExpired(booking, now)
    ? "expired"
    : rawStatus;
  const contactedAt = booking?.createdAt || request?.timestamp || request?.createdAt || "";
  const contactParts = riyadhContactParts(contactedAt);
  return {
    id: request?.id || booking!.id,
    contactRequestId: request?.id || null,
    canDelete: Boolean(request),
    requestCode: booking?.requestCode || request?.requestCode || request?.id || "",
    propertyNumber: booking?.propertyNumber || request!.propertyNumber,
    propertyName: booking?.propertyName || null,
    contactedAt,
    timestamp: contactedAt,
    clientPhoneMasked: maskContactPhone(
      booking?.customerPhone || request?.clientPhone,
    ),
    deviceType: request?.deviceType || null,
    dayOfWeek: request?.dayOfWeek || contactParts.dayOfWeek,
    hourOfDay: Number.isInteger(request?.hourOfDay)
      ? Number(request?.hourOfDay)
      : contactParts.hourOfDay,
    bookingStatus,
    commissionStatus: booking?.commissionStatus || "not_applicable",
    complianceStatus: booking?.complianceStatus || "clear",
    bookingDate: bookingDate(booking),
    timing: booking?.confirmationFacts?.timing || null,
    pricePaidHalalas: booking?.confirmationFacts?.pricePaidHalalas || null,
    commissionAmountHalalas: booking?.commissionAmountHalalas || null,
    commissionDueAt: booking?.commissionDueAt || null,
    answeredAt: booking?.confirmedAt || booking?.declinedAt || null,
    ownerNote: note?.note || null,
    ownerNoteUpdatedAt: note?.updatedAt || null,
    customerOwnerNoResponseReportedAt:
      booking?.customerOwnerNoResponseReportedAt || null,
  };
}

function riyadhDayKey(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function riyadhContactParts(value: string): {
  dayOfWeek: string | null;
  hourOfDay: number | null;
} {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return { dayOfWeek: null, hourOfDay: null };
  }
  const parts = new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    timeZone: "Asia/Riyadh",
    weekday: "long",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const dayOfWeek = parts.find((part) => part.type === "weekday")?.value || null;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  return {
    dayOfWeek,
    hourOfDay: Number.isInteger(hour) ? hour : null,
  };
}

export function buildOwnerInquiryResponse(options: {
  propertyNumber: string;
  requests: PropertyRequest[];
  bookings: BookingFollowUpDocument[];
  notes?: OwnerInquiryNote[];
  hidden?: OwnerInquiryVisibilityRecord[];
  now?: Date;
}): OwnerInquiryResponse {
  const now = options.now || new Date();
  const requests = options.requests.filter(
    (request) => request.propertyNumber === options.propertyNumber,
  );
  const bookings = options.bookings.filter(
    (booking) => booking.propertyNumber === options.propertyNumber,
  );
  const bookingByRequestId = new Map(
    bookings.map((booking) => [booking.contactRequestId, booking]),
  );
  const bookingByRequestCode = new Map(
    bookings.map((booking) => [booking.requestCode, booking]),
  );
  const usedBookingIds = new Set<string>();
  const notes = new Map(
    (options.notes || [])
      .filter((note) => note.propertyNumber === options.propertyNumber)
      .map((note) => [note.inquiryId, note]),
  );
  const hiddenIds = new Set(
    (options.hidden || [])
      .filter((record) => record.propertyNumber === options.propertyNumber)
      .flatMap((record) => [
        record.inquiryId,
        record.contactRequestId,
        record.bookingId || "",
      ])
      .filter(Boolean),
  );
  const rows: OwnerInquiryRow[] = [];
  for (const request of requests) {
    const booking = bookingByRequestId.get(request.id) ||
      bookingByRequestCode.get(request.requestCode);
    if (booking) usedBookingIds.add(booking.id);
    if (
      hiddenIds.has(request.id) ||
      hiddenIds.has(request.requestCode) ||
      Boolean(booking && hiddenIds.has(booking.id))
    ) {
      continue;
    }
    rows.push(rowFrom(request, booking, now, notes.get(request.id)));
  }

  for (const booking of bookings) {
    if (!usedBookingIds.has(booking.id) && !hiddenIds.has(booking.id)) {
      rows.push(rowFrom(undefined, booking, now, notes.get(booking.id)));
    }
  }

  rows.sort((left, right) => validTime(right.contactedAt) - validTime(left.contactedAt));
  const today = riyadhDayKey(now);
  return {
    requests: rows,
    summary: {
      total: rows.length,
      today: rows.filter((row) => riyadhDayKey(row.contactedAt) === today).length,
      awaitingResponse: rows.filter((row) =>
        row.bookingStatus === "awaiting_response" || row.bookingStatus === "contact_only"
      ).length,
      confirmed: rows.filter((row) => row.bookingStatus === "confirmed").length,
      declined: rows.filter((row) =>
        row.bookingStatus === "declined" || row.bookingStatus === "expired"
      ).length,
      commissionAttention: rows.filter((row) =>
        row.commissionStatus === "pending" || row.commissionStatus === "overdue"
      ).length,
    },
  };
}
