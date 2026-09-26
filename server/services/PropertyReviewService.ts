import { createHash } from "node:crypto";
import { z } from "zod";

import {
  propertyReviewDocumentSchema,
  propertyReviewInputSchema,
  propertyReviewModerationInputSchema,
  propertyReviewModerationStatusSchema,
  type AdminPropertyReview,
  type CustomerPropertyReview,
  type PropertyReviewAggregate,
  type PropertyReviewDocument,
  type PublicPropertyReview,
} from "../../shared/property-reviews";
import { customerPropertyNumberSchema } from "../../shared/customer";
import { db } from "../config/firebase";
import { customerAccountService } from "./CustomerAccountService";
import { bookingCommissionStore } from "./BookingCommissionStore";
import type { BookingFollowUpDocument } from "./BookingCommissionTypes";

const PROPERTY_REVIEWS_COLLECTION = "property_reviews";

export type PropertyReviewErrorCode =
  | "REVIEW_BOOKING_NOT_FOUND"
  | "REVIEW_BOOKING_NOT_CONFIRMED"
  | "REVIEW_BOOKING_NOT_COMPLETED"
  | "REVIEW_NOT_FOUND";

export class PropertyReviewError extends Error {
  constructor(
    readonly code: PropertyReviewErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PropertyReviewError";
  }
}

export interface PropertyReviewStore {
  getBooking(id: string): Promise<BookingFollowUpDocument | null>;
  listBookingsForCustomer(customerSubject: string): Promise<BookingFollowUpDocument[]>;
  getReview(id: string): Promise<PropertyReviewDocument | null>;
  saveReview(review: PropertyReviewDocument): Promise<PropertyReviewDocument>;
  listReviewsForCustomer(customerSubject: string): Promise<PropertyReviewDocument[]>;
  listReviewsForProperty(propertyNumber: string): Promise<PropertyReviewDocument[]>;
  listAllReviews(): Promise<PropertyReviewDocument[]>;
}

type PropertyReviewServiceOptions = {
  now?: () => Date;
  customerSubjectForPhone?: (phone: unknown) => string;
};

function canonicalRiyadhDay(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function lastGregorianDayOfMonth(value: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isSafeInteger(year) || month < 1 || month > 12) return null;
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${match[1]}-${match[2]}-${String(day).padStart(2, "0")}`;
}

export function reviewableBookingEndDay(
  booking: Pick<BookingFollowUpDocument, "bookingStatus" | "confirmationFacts">,
): string | null {
  if (booking.bookingStatus !== "confirmed" || !booking.confirmationFacts) return null;
  const bookingDate = booking.confirmationFacts.bookingDate;
  if (bookingDate.precision === "day") return bookingDate.value;
  if ("endDate" in bookingDate) return bookingDate.endDate;
  return lastGregorianDayOfMonth(bookingDate.value);
}

export function isBookingReviewEligible(
  booking: Pick<BookingFollowUpDocument, "bookingStatus" | "confirmationFacts">,
  now: Date,
): boolean {
  const bookingEndDay = reviewableBookingEndDay(booking);
  return Boolean(bookingEndDay && bookingEndDay < canonicalRiyadhDay(now));
}

function customerReviewDto(
  booking: BookingFollowUpDocument,
  review: PropertyReviewDocument | null,
  now: Date,
): CustomerPropertyReview {
  return {
    bookingId: booking.id,
    propertyNumber: booking.propertyNumber,
    propertyName: booking.propertyName,
    eligible: isBookingReviewEligible(booking, now),
    review: review ? {
      overallRating: review.overallRating,
      cleanlinessRating: review.cleanlinessRating,
      accuracyRating: review.accuracyRating,
      ownerResponsivenessRating: review.ownerResponsivenessRating,
      text: review.text,
      moderationStatus: review.moderationStatus,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
    } : null,
  };
}

function publicReviewDto(review: PropertyReviewDocument): PublicPropertyReview {
  return {
    id: createHash("sha256")
      .update(`public-property-review:${review.id}`)
      .digest("hex")
      .slice(0, 24),
    customerDisplayName: "عميل موثّق",
    verifiedCustomer: true,
    overallRating: review.overallRating,
    cleanlinessRating: review.cleanlinessRating,
    accuracyRating: review.accuracyRating,
    ownerResponsivenessRating: review.ownerResponsivenessRating,
    text: review.text,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

function adminReviewDto(review: PropertyReviewDocument): AdminPropertyReview {
  const { customerSubject: _customerSubject, ...safeReview } = review;
  return { ...safeReview, customerDisplayName: "عميل موثّق" };
}

function roundedAverage(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(
    (values.reduce((total, value) => total + value, 0) / values.length) * 10,
  ) / 10;
}

export class PropertyReviewService {
  private readonly now: () => Date;
  private readonly customerSubjectForPhone: (phone: unknown) => string;

  constructor(
    private readonly store: PropertyReviewStore,
    options: PropertyReviewServiceOptions = {},
  ) {
    this.now = options.now || (() => new Date());
    this.customerSubjectForPhone = options.customerSubjectForPhone
      || ((phone) => customerAccountService.subjectForPhone(phone).customerSubject);
  }

  async listForCustomer(phone: unknown): Promise<CustomerPropertyReview[]> {
    const customerSubject = this.customerSubjectForPhone(phone);
    const [bookings, reviews] = await Promise.all([
      this.store.listBookingsForCustomer(customerSubject),
      this.store.listReviewsForCustomer(customerSubject),
    ]);
    const reviewsByBooking = new Map(reviews.map((review) => [review.bookingId, review]));
    const now = this.currentDate();
    return bookings
      .filter((booking) => booking.bookingStatus === "confirmed")
      .map((booking) => customerReviewDto(
        booking,
        reviewsByBooking.get(booking.id) || null,
        now,
      ));
  }

  async saveForCustomer(
    phone: unknown,
    rawBookingId: unknown,
    rawInput: unknown,
  ): Promise<CustomerPropertyReview> {
    const bookingId = z.string().trim().min(1).max(256).parse(rawBookingId);
    const input = propertyReviewInputSchema.parse(rawInput);
    const customerSubject = this.customerSubjectForPhone(phone);
    const booking = await this.store.getBooking(bookingId);
    if (!booking || booking.customerSubject !== customerSubject) {
      throw new PropertyReviewError(
        "REVIEW_BOOKING_NOT_FOUND",
        404,
        "الحجز غير موجود",
      );
    }
    if (booking.bookingStatus !== "confirmed") {
      throw new PropertyReviewError(
        "REVIEW_BOOKING_NOT_CONFIRMED",
        409,
        "يمكن تقييم الحجوزات المؤكدة فقط",
      );
    }
    const now = this.currentDate();
    if (!isBookingReviewEligible(booking, now)) {
      throw new PropertyReviewError(
        "REVIEW_BOOKING_NOT_COMPLETED",
        409,
        "يتاح التقييم بعد انتهاء تاريخ الحجز",
      );
    }

    const existing = await this.store.getReview(booking.id);
    const timestamp = now.toISOString();
    const review = propertyReviewDocumentSchema.parse({
      id: booking.id,
      schemaVersion: 1,
      bookingId: booking.id,
      requestCode: booking.requestCode,
      propertyNumber: booking.propertyNumber,
      propertyName: booking.propertyName || "",
      customerSubject,
      ...input,
      moderationStatus: "pending",
      moderationNote: null,
      moderatedAt: null,
      moderatedBy: null,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    });
    const saved = await this.store.saveReview(review);
    return customerReviewDto(booking, saved, now);
  }

  async listPublicForProperty(rawPropertyNumber: unknown): Promise<{
    aggregate: PropertyReviewAggregate;
    reviews: PublicPropertyReview[];
  }> {
    const propertyNumber = customerPropertyNumberSchema.parse(rawPropertyNumber);
    const approved = (await this.store.listReviewsForProperty(propertyNumber))
      .filter((review) => review.moderationStatus === "approved")
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    return {
      aggregate: {
        count: approved.length,
        averageOverall: roundedAverage(approved.map((review) => review.overallRating)),
        averageCleanliness: roundedAverage(approved.map((review) => review.cleanlinessRating)),
        averageAccuracy: roundedAverage(approved.map((review) => review.accuracyRating)),
        averageOwnerResponsiveness: roundedAverage(
          approved.map((review) => review.ownerResponsivenessRating),
        ),
      },
      reviews: approved.slice(0, 20).map(publicReviewDto),
    };
  }

  async listForAdmin(
    rawStatus?: unknown,
  ): Promise<AdminPropertyReview[]> {
    const status = rawStatus === undefined || rawStatus === "all"
      ? null
      : propertyReviewModerationStatusSchema.parse(rawStatus);
    return (await this.store.listAllReviews())
      .filter((review) => !status || review.moderationStatus === status)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .map(adminReviewDto);
  }

  async moderate(
    rawReviewId: unknown,
    rawInput: unknown,
  ): Promise<AdminPropertyReview> {
    const reviewId = z.string().trim().min(1).max(256).parse(rawReviewId);
    const input = propertyReviewModerationInputSchema.parse(rawInput);
    const existing = await this.store.getReview(reviewId);
    if (!existing) {
      throw new PropertyReviewError(
        "REVIEW_NOT_FOUND",
        404,
        "التقييم غير موجود",
      );
    }
    const timestamp = this.currentDate().toISOString();
    const review = propertyReviewDocumentSchema.parse({
      ...existing,
      moderationStatus: input.status,
      moderationNote: input.note || null,
      moderatedAt: timestamp,
      moderatedBy: "admin",
      updatedAt: timestamp,
    });
    return adminReviewDto(await this.store.saveReview(review));
  }

  private currentDate(): Date {
    const date = this.now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
      throw new TypeError("Property review clock returned an invalid time");
    }
    return date;
  }
}

function propertyReviewsCollection() {
  if (!db) throw new Error("Firestore is not configured");
  return db.collection(PROPERTY_REVIEWS_COLLECTION);
}

function reviewDocumentId(bookingId: string): string {
  return createHash("sha256")
    .update(`booking-review:${bookingId}`)
    .digest("hex");
}

const firestorePropertyReviewStore: PropertyReviewStore = {
  getBooking: (id) => bookingCommissionStore.getBooking(id),
  listBookingsForCustomer: (customerSubject) =>
    bookingCommissionStore.listBookingsForCustomer(customerSubject),
  getReview: async (id) => {
    const snapshot = await propertyReviewsCollection().doc(reviewDocumentId(id)).get();
    return snapshot.exists
      ? propertyReviewDocumentSchema.parse(snapshot.data())
      : null;
  },
  saveReview: async (review) => {
    const parsed = propertyReviewDocumentSchema.parse(review);
    await propertyReviewsCollection().doc(reviewDocumentId(parsed.bookingId)).set(parsed);
    return parsed;
  },
  listReviewsForCustomer: async (customerSubject) => {
    const snapshot = await propertyReviewsCollection()
      .where("customerSubject", "==", customerSubject)
      .get();
    return snapshot.docs.map((document) =>
      propertyReviewDocumentSchema.parse(document.data()));
  },
  listReviewsForProperty: async (propertyNumber) => {
    const snapshot = await propertyReviewsCollection()
      .where("propertyNumber", "==", propertyNumber)
      .get();
    return snapshot.docs.map((document) =>
      propertyReviewDocumentSchema.parse(document.data()));
  },
  listAllReviews: async () => {
    const snapshot = await propertyReviewsCollection().get();
    return snapshot.docs.map((document) =>
      propertyReviewDocumentSchema.parse(document.data()));
  },
};

export const propertyReviewService = new PropertyReviewService(
  firestorePropertyReviewStore,
);
