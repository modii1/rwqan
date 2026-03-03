/**
 * publicValidation.ts
 * Zod schemas for public-facing (unauthenticated) route bodies.
 */

import { z } from "zod";
import { validateBody } from "./subscriptionValidation";

// ─── Primitives ───────────────────────────────────────────────────────────────

const nonEmpty = (label: string) =>
  z.string({ required_error: `${label} مطلوب` }).trim().min(1, `${label} لا يمكن أن يكون فارغاً`);

// ─── Payment calculation ─────────────────────────────────────────────────────

/** POST /api/payment/calculate */
export const paymentCalculateSchema = z.object({
  packageId: nonEmpty("معرف الباقة"),
  discountCode: z.string().trim().optional(),
});
export type PaymentCalculateBody = z.infer<typeof paymentCalculateSchema>;
export const validatePaymentCalculate = validateBody(paymentCalculateSchema);

// ─── Discount validation ─────────────────────────────────────────────────────

/** POST /api/discount/validate */
export const discountValidateSchema = z.object({
  code: nonEmpty("كود الخصم"),
});
export type DiscountValidateBody = z.infer<typeof discountValidateSchema>;
export const validateDiscountValidate = validateBody(discountValidateSchema);
