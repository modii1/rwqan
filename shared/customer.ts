import { z } from "zod";

export const CUSTOMER_FAVORITES_MAX = 500;
export const CUSTOMER_SESSION_REVISION_HEADER = "x-customer-session-revision";

export const customerSessionRevisionSchema = z.string()
  .regex(/^[a-f0-9]{64}$/);

export const customerPropertyNumberSchema = z.string()
  .trim()
  .min(1)
  .max(64);

export const customerFullNameSchema = z.string()
  .trim()
  .max(100);

export const customerProfileFullNameSchema = customerFullNameSchema.min(2);

export const customerEmailSchema = z.string()
  .trim()
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

export const customerNullableEmailSchema = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? null : value,
  customerEmailSchema.nullable(),
);

export const customerAccountSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  schemaVersion: z.literal(1),
  phone: z.string().regex(/^5\d{8}$/),
  fullName: customerFullNameSchema,
  email: customerNullableEmailSchema,
  favoritePropertyNumbers: z.array(customerPropertyNumberSchema)
    .max(CUSTOMER_FAVORITES_MAX)
    .superRefine((propertyNumbers, context) => {
      if (new Set(propertyNumbers).size !== propertyNumbers.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Favorite property numbers must be unique",
        });
      }
    }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  lastLoginAt: z.string().datetime(),
}).strict();

export type CustomerAccount = z.infer<typeof customerAccountSchema>;

export const customerProfileUpdateSchema = z.object({
  fullName: customerProfileFullNameSchema.optional(),
  email: customerNullableEmailSchema.optional(),
}).strict().refine(
  (input) => input.fullName !== undefined || input.email !== undefined,
  { message: "At least one profile field is required" },
);

export type CustomerProfileUpdate = z.infer<typeof customerProfileUpdateSchema>;

export type CustomerProfileDto = {
  fullName: string;
  email: string | null;
  maskedPhone: string | null;
  favoritePropertyNumbers: string[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
};

export type CustomerContactHistoryRow = {
  id: string;
  requestCode: string;
  propertyNumber: string;
  propertyName: string | null;
  listedPriceOptionsHalalas: number[];
  contactAt: string;
  bookingStatus: string;
  questionnaire: null | {
    timing: string;
    bookingDate: string;
    bookingDatePrecision: string;
    bookingDateCalendar?: string;
    bookingDateStart?: string;
    bookingDateEnd?: string;
    pricePaidHalalas: number;
  };
  answeredAt: string | null;
};
