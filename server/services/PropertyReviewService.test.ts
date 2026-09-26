import assert from "node:assert/strict";
import test from "node:test";

import type { PropertyReviewDocument } from "../../shared/property-reviews";
import type { BookingFollowUpDocument } from "./BookingCommissionTypes";
import {
  PropertyReviewError,
  PropertyReviewService,
  isBookingReviewEligible,
  type PropertyReviewStore,
} from "./PropertyReviewService";

const NOW = new Date("2026-09-26T12:00:00.000Z");
const CUSTOMER_SUBJECT = "customer-subject";

function booking(overrides: Partial<BookingFollowUpDocument> = {}): BookingFollowUpDocument {
  return {
    id: "booking-1",
    contactRequestId: "request-1",
    requestCode: "REQ-1",
    propertyNumber: "P-101",
    propertyName: "شاليه الاختبار",
    customerSubject: CUSTOMER_SUBJECT,
    followUpDueAt: "2026-09-20T12:00:00.000Z",
    createdAt: "2026-09-19T12:00:00.000Z",
    updatedAt: "2026-09-20T12:00:00.000Z",
    bookingStatus: "confirmed",
    commissionStatus: "not_applicable",
    complianceStatus: "clear",
    confirmationFacts: {
      timing: "weekend",
      bookingDate: { value: "2026-09-25", precision: "day" },
      pricePaidHalalas: 50_000,
    },
    confirmedAt: "2026-09-20T12:00:00.000Z",
    declinedAt: null,
    commissionAmountHalalas: null,
    commissionDueAt: null,
    commissionNoticeSentAt: null,
    commissionPaidAt: null,
    commissionReminderOffsetsSent: [],
    schemaVersion: 1,
    ownerPhone: "512345678",
    customerPhone: "598765432",
    isFreeProperty: false,
    freeEligibilityRevokedAt: null,
    bookingDecision: "yes",
    questionnaireStartedAt: null,
    activeAttemptId: null,
    paidAttemptId: null,
    disputeStatus: "none",
    disputedAt: null,
    disputeReason: null,
    enforcementDeferredUntil: null,
    enforcementLastError: null,
    events: [],
    ...overrides,
  } as BookingFollowUpDocument;
}

class MemoryReviewStore implements PropertyReviewStore {
  bookings = new Map<string, BookingFollowUpDocument>();
  reviews = new Map<string, PropertyReviewDocument>();

  async getBooking(id: string) {
    return structuredClone(this.bookings.get(id) || null);
  }

  async listBookingsForCustomer(customerSubject: string) {
    return [...this.bookings.values()]
      .filter((candidate) => candidate.customerSubject === customerSubject)
      .map((candidate) => structuredClone(candidate));
  }

  async getReview(id: string) {
    return structuredClone(this.reviews.get(id) || null);
  }

  async saveReview(review: PropertyReviewDocument) {
    this.reviews.set(review.bookingId, structuredClone(review));
    return structuredClone(review);
  }

  async listReviewsForCustomer(customerSubject: string) {
    return [...this.reviews.values()]
      .filter((review) => review.customerSubject === customerSubject)
      .map((review) => structuredClone(review));
  }

  async listReviewsForProperty(propertyNumber: string) {
    return [...this.reviews.values()]
      .filter((review) => review.propertyNumber === propertyNumber)
      .map((review) => structuredClone(review));
  }

  async listAllReviews() {
    return [...this.reviews.values()].map((review) => structuredClone(review));
  }
}

function service(store: MemoryReviewStore) {
  return new PropertyReviewService(store, {
    now: () => new Date(NOW),
    customerSubjectForPhone: () => CUSTOMER_SUBJECT,
  });
}

const validInput = {
  overallRating: 5,
  cleanlinessRating: 4,
  accuracyRating: 5,
  ownerResponsivenessRating: 3,
  text: "إقامة ممتازة",
};

test("review eligibility starts only after the confirmed booking date has passed", () => {
  assert.equal(isBookingReviewEligible(booking(), NOW), true);
  assert.equal(isBookingReviewEligible(booking({
    confirmationFacts: {
      timing: "weekend",
      bookingDate: { value: "2026-09-26", precision: "day" },
      pricePaidHalalas: 50_000,
    },
  }), NOW), false);
  assert.equal(isBookingReviewEligible(booking({
    confirmationFacts: {
      timing: "weekend",
      bookingDate: {
        value: "1448-04",
        precision: "month",
        calendar: "hijri",
        startDate: "2026-09-12",
        endDate: "2026-10-10",
      },
      pricePaidHalalas: 50_000,
    },
  }), NOW), false);
});

test("customer can create and update exactly one sanitized review per owned completed booking", async () => {
  const store = new MemoryReviewStore();
  store.bookings.set("booking-1", booking());
  const reviews = service(store);

  const created = await reviews.saveForCustomer("598765432", "booking-1", {
    ...validInput,
    text: "  ممتاز <script>  \u0000  جدًا  ",
  });
  assert.equal(created.review?.moderationStatus, "pending");
  assert.equal(created.review?.text, "ممتاز script جدًا");
  assert.equal(store.reviews.size, 1);

  const existing = store.reviews.get("booking-1")!;
  store.reviews.set("booking-1", {
    ...existing,
    moderationStatus: "approved",
    moderatedAt: NOW.toISOString(),
    moderatedBy: "admin",
  });
  const updated = await reviews.saveForCustomer("598765432", "booking-1", {
    ...validInput,
    overallRating: 4,
  });
  assert.equal(store.reviews.size, 1);
  assert.equal(updated.review?.overallRating, 4);
  assert.equal(updated.review?.moderationStatus, "pending");
  assert.equal(store.reviews.get("booking-1")?.createdAt, existing.createdAt);
  assert.equal(store.reviews.get("booking-1")?.moderatedAt, null);
});

test("customer cannot review another customer booking or a booking that has not ended", async () => {
  const store = new MemoryReviewStore();
  store.bookings.set("other", booking({ id: "other", customerSubject: "another-subject" }));
  store.bookings.set("future", booking({
    id: "future",
    confirmationFacts: {
      timing: "midweek",
      bookingDate: { value: "2026-09-27", precision: "day" },
      pricePaidHalalas: 40_000,
    },
  }));
  const reviews = service(store);

  await assert.rejects(
    reviews.saveForCustomer("598765432", "other", validInput),
    (error: unknown) => error instanceof PropertyReviewError
      && error.code === "REVIEW_BOOKING_NOT_FOUND",
  );
  await assert.rejects(
    reviews.saveForCustomer("598765432", "future", validInput),
    (error: unknown) => error instanceof PropertyReviewError
      && error.code === "REVIEW_BOOKING_NOT_COMPLETED",
  );
  assert.equal(store.reviews.size, 0);
});

test("public property response includes only approved reviews and no customer identity", async () => {
  const store = new MemoryReviewStore();
  store.bookings.set("booking-1", booking());
  const reviews = service(store);
  await reviews.saveForCustomer("598765432", "booking-1", validInput);
  await reviews.moderate("booking-1", { status: "approved" });

  store.bookings.set("booking-2", booking({ id: "booking-2", requestCode: "REQ-2" }));
  await reviews.saveForCustomer("598765432", "booking-2", {
    ...validInput,
    overallRating: 1,
  });

  const result = await reviews.listPublicForProperty("P-101");
  assert.equal(result.aggregate.count, 1);
  assert.equal(result.aggregate.averageOverall, 5);
  assert.equal(result.reviews.length, 1);
  assert.equal(result.reviews[0].customerDisplayName, "عميل موثّق");
  assert.equal(result.reviews[0].verifiedCustomer, true);
  assert.notEqual(result.reviews[0].id, "booking-1");
  assert.equal("customerSubject" in result.reviews[0], false);
  assert.equal("bookingId" in result.reviews[0], false);
});

test("admin moderation is visible to the customer and an edit returns it to pending", async () => {
  const store = new MemoryReviewStore();
  store.bookings.set("booking-1", booking());
  const reviews = service(store);
  await reviews.saveForCustomer("598765432", "booking-1", validInput);

  const approved = await reviews.moderate("booking-1", { status: "approved" });
  assert.equal(approved.moderationStatus, "approved");
  assert.equal("customerSubject" in approved, false);

  const customerRows = await reviews.listForCustomer("598765432");
  assert.equal(customerRows[0].eligible, true);
  assert.equal(customerRows[0].review?.moderationStatus, "approved");

  await reviews.saveForCustomer("598765432", "booking-1", {
    ...validInput,
    text: null,
  });
  assert.equal(store.reviews.get("booking-1")?.moderationStatus, "pending");
});
