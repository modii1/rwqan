import { z } from "zod";

export const PROPERTY_REVIEW_TEXT_MAX_LENGTH = 1_000;

export const propertyReviewRatingSchema = z.number().int().min(1).max(5);

const reviewTextControlCharacters =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export function sanitizePropertyReviewText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(reviewTextControlCharacters, "")
    .replace(/[<>]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const propertyReviewInputSchema = z.object({
  overallRating: propertyReviewRatingSchema,
  cleanlinessRating: propertyReviewRatingSchema,
  accuracyRating: propertyReviewRatingSchema,
  ownerResponsivenessRating: propertyReviewRatingSchema,
  text: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? null : value,
    z.string()
      .max(PROPERTY_REVIEW_TEXT_MAX_LENGTH)
      .transform(sanitizePropertyReviewText)
      .refine((value) => value.length <= PROPERTY_REVIEW_TEXT_MAX_LENGTH)
      .nullable()
      .optional(),
  ).transform((value) => value ?? null),
}).strict();

export type PropertyReviewInput = z.infer<typeof propertyReviewInputSchema>;

export const propertyReviewModerationStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
]);
export type PropertyReviewModerationStatus = z.infer<
  typeof propertyReviewModerationStatusSchema
>;

export const propertyReviewDocumentSchema = z.object({
  id: z.string().trim().min(1).max(256),
  schemaVersion: z.literal(1),
  bookingId: z.string().trim().min(1).max(256),
  requestCode: z.string().trim().min(1).max(160),
  propertyNumber: z.string().trim().min(1).max(160),
  propertyName: z.string().trim().max(300),
  customerSubject: z.string().trim().min(1).max(160),
  overallRating: propertyReviewRatingSchema,
  cleanlinessRating: propertyReviewRatingSchema,
  accuracyRating: propertyReviewRatingSchema,
  ownerResponsivenessRating: propertyReviewRatingSchema,
  text: z.string().max(PROPERTY_REVIEW_TEXT_MAX_LENGTH).nullable(),
  moderationStatus: propertyReviewModerationStatusSchema,
  moderationNote: z.string().trim().max(500).nullable(),
  moderatedAt: z.string().datetime().nullable(),
  moderatedBy: z.string().trim().max(100).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type PropertyReviewDocument = z.infer<typeof propertyReviewDocumentSchema>;

export type CustomerPropertyReview = {
  bookingId: string;
  propertyNumber: string;
  propertyName: string;
  eligible: boolean;
  review: null | {
    overallRating: number;
    cleanlinessRating: number;
    accuracyRating: number;
    ownerResponsivenessRating: number;
    text: string | null;
    moderationStatus: PropertyReviewModerationStatus;
    createdAt: string;
    updatedAt: string;
  };
};

export type PublicPropertyReview = {
  id: string;
  customerDisplayName: "عميل موثّق";
  verifiedCustomer: true;
  overallRating: number;
  cleanlinessRating: number;
  accuracyRating: number;
  ownerResponsivenessRating: number;
  text: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PropertyReviewAggregate = {
  count: number;
  averageOverall: number | null;
  averageCleanliness: number | null;
  averageAccuracy: number | null;
  averageOwnerResponsiveness: number | null;
};

export type AdminPropertyReview = Omit<
  PropertyReviewDocument,
  "customerSubject"
> & {
  customerDisplayName: "عميل موثّق";
};

export const propertyReviewModerationInputSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().max(500).nullable().optional(),
  ),
}).strict();
