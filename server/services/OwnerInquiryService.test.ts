import assert from "node:assert/strict";
import test from "node:test";

import type { BookingFollowUpDocument } from "./BookingCommissionTypes";
import type { Request as PropertyRequest } from "../../shared/schema";
import { buildOwnerInquiryResponse } from "./OwnerInquiryService";

function contactRequest(
  id: string,
  propertyNumber: string,
  timestamp: string,
): PropertyRequest {
  return {
    id,
    propertyNumber,
    requestCode: `CODE-${id}`,
    timestamp,
    clientPhone: "0551234567",
    ipAddress: "127.0.0.1",
    deviceType: "mobile",
    dayOfWeek: "الجمعة",
    hourOfDay: 12,
  };
}

function booking(
  overrides: Partial<BookingFollowUpDocument>,
): BookingFollowUpDocument {
  return {
    schemaVersion: 1,
    id: "BOOK-1",
    contactRequestId: "REQ-1",
    requestCode: "CODE-REQ-1",
    propertyNumber: "PROP-1",
    propertyName: "العقار الأول",
    customerSubject: "customer-subject",
    ownerPhone: "0550000000",
    customerPhone: "0551234567",
    isFreeProperty: true,
    bookingStatus: "confirmed",
    bookingDecision: "yes",
    confirmationFacts: {
      timing: "weekend",
      bookingDate: { value: "2026-10-03", precision: "day" },
      pricePaidHalalas: 100_000,
    },
    followUpDueAt: "2026-09-30T10:00:00.000Z",
    confirmedAt: "2026-10-01T10:00:00.000Z",
    declinedAt: null,
    questionnaireStartedAt: "2026-10-01T09:00:00.000Z",
    commissionStatus: "pending",
    complianceStatus: "clear",
    commissionAmountHalalas: 10_000,
    commissionDueAt: "2026-10-06T10:00:00.000Z",
    commissionNoticeSentAt: "2026-10-01T10:00:00.000Z",
    commissionPaidAt: null,
    commissionReminderOffsetsSent: [],
    activeAttemptId: null,
    paidAttemptId: null,
    disputeStatus: "none",
    disputedAt: null,
    disputeReason: null,
    enforcementDeferredUntil: null,
    enforcementLastError: null,
    events: [],
    createdAt: "2026-09-29T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  } as BookingFollowUpDocument;
}

test("owner inquiry response joins booking state and preserves property isolation", () => {
  const response = buildOwnerInquiryResponse({
    propertyNumber: "PROP-1",
    requests: [
      contactRequest("REQ-1", "PROP-1", "2026-09-29T10:00:00.000Z"),
      contactRequest("REQ-2", "PROP-1", "2026-10-01T12:00:00.000Z"),
      contactRequest("REQ-OTHER", "PROP-2", "2026-10-01T13:00:00.000Z"),
    ],
    bookings: [
      booking({}),
      booking({
        id: "BOOK-ORPHAN",
        contactRequestId: "REQ-MISSING",
        requestCode: "CODE-ORPHAN",
        bookingStatus: "declined",
        bookingDecision: null,
        confirmationFacts: null,
        confirmedAt: null,
        declinedAt: "2026-10-01T08:00:00.000Z",
        commissionStatus: "not_applicable",
        commissionAmountHalalas: null,
        commissionDueAt: null,
        commissionNoticeSentAt: null,
        createdAt: "2026-10-01T07:00:00.000Z",
      }),
      booking({ propertyNumber: "PROP-2", id: "BOOK-OTHER" }),
    ],
    now: new Date("2026-10-01T15:00:00.000Z"),
  });

  assert.equal(response.requests.length, 3);
  assert.equal(response.summary.total, 3);
  assert.equal(response.summary.today, 2);
  assert.equal(response.summary.confirmed, 1);
  assert.equal(response.summary.declined, 1);
  assert.equal(response.summary.awaitingResponse, 1);
  assert.equal(response.summary.commissionAttention, 1);
  const confirmed = response.requests.find((row) => row.requestCode === "CODE-REQ-1");
  assert.equal(confirmed?.bookingStatus, "confirmed");
  assert.equal(confirmed?.canDelete, true);
  assert.equal(confirmed?.contactRequestId, "REQ-1");
  assert.equal(confirmed?.bookingDate?.value, "2026-10-03");
  assert.equal(confirmed?.clientPhoneMasked, "05•• ••4567");
  assert.equal(confirmed?.timestamp, "2026-09-29T10:00:00.000Z");
  assert.equal(confirmed?.dayOfWeek, "الجمعة");
  assert.equal(confirmed?.hourOfDay, 12);
  assert.doesNotMatch(JSON.stringify(response), /0551234567/);
  assert.doesNotMatch(JSON.stringify(response), /PROP-2/);
  const bookingOnly = response.requests.find((row) => row.id === "BOOK-ORPHAN");
  assert.equal(bookingOnly?.canDelete, false);
  assert.equal(bookingOnly?.contactRequestId, null);
});

test("owner inquiry response marks unanswered workflows expired without changing storage", () => {
  const unanswered = booking({
    bookingStatus: "awaiting_response",
    bookingDecision: null,
    confirmationFacts: null,
    confirmedAt: null,
    commissionStatus: "not_applicable",
    commissionAmountHalalas: null,
    commissionDueAt: null,
    commissionNoticeSentAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  });
  const response = buildOwnerInquiryResponse({
    propertyNumber: "PROP-1",
    requests: [],
    bookings: [unanswered],
    now: new Date("2026-09-20T00:00:00.000Z"),
  });
  assert.equal(response.requests[0].bookingStatus, "expired");
  assert.equal(response.requests[0].canDelete, false);
  assert.equal(response.requests[0].contactRequestId, null);
  assert.equal(unanswered.bookingStatus, "awaiting_response");
  assert.equal(response.summary.awaitingResponse, 0);
  assert.equal(response.summary.declined, 1);
});

test("an owner-hidden joined inquiry does not reappear as a booking-only row", () => {
  const request = contactRequest(
    "REQ-1",
    "PROP-1",
    "2026-09-29T10:00:00.000Z",
  );
  const joinedBooking = booking({
    id: "BOOK-1",
    contactRequestId: request.id,
    requestCode: request.requestCode,
  });

  const response = buildOwnerInquiryResponse({
    propertyNumber: "PROP-1",
    requests: [request],
    bookings: [joinedBooking],
    hidden: [{
      propertyNumber: "PROP-1",
      inquiryId: request.id,
      contactRequestId: request.id,
      bookingId: joinedBooking.id,
      hiddenAt: "2026-10-01T12:00:00.000Z",
    }],
    now: new Date("2026-10-01T15:00:00.000Z"),
  });

  assert.deepEqual(response.requests, []);
  assert.equal(response.summary.total, 0);
});
