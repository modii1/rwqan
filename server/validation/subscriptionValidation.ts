/**
 * subscriptionValidation.ts
 * Zod schemas and Express middleware for validating all
 * subscription-related inputs (service params + route bodies).
 */

import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import type { Request, Response, NextFunction } from "express";

// ─── Primitives ─────────────────────────────────────────────────────────────

/** Non-empty trimmed string used for IDs / property numbers */
const propertyNumberSchema = z
  .string({ required_error: "رقم العقار مطلوب" })
  .trim()
  .min(1, "رقم العقار لا يمكن أن يكون فارغاً");

const packageIdSchema = z
  .string({ required_error: "معرف الباقة مطلوب" })
  .trim()
  .min(1, "معرف الباقة لا يمكن أن يكون فارغاً");

const paymentIdSchema = z
  .string({ required_error: "معرف الدفعة مطلوب" })
  .trim()
  .min(1, "معرف الدفعة لا يمكن أن يكون فارغاً");

export const subscriptionIdentifierSchema = z
  .string({ required_error: "معرف الاشتراك مطلوب" })
  .trim()
  .min(1, "معرف الاشتراك لا يمكن أن يكون فارغاً")
  .max(200, "معرف الاشتراك غير صالح");

const positiveAmount = z
  .number({ required_error: "المبلغ مطلوب", invalid_type_error: "المبلغ يجب أن يكون رقماً" })
  .nonnegative("المبلغ يجب أن يكون صفراً أو أكبر");

// ─── Service-layer schemas ────────────────────────────────────────────────────

/**
 * Input params for SubscriptionService.activate()
 * Note: `pkg` is fetched from the DB by the service/route – not part of the HTTP body.
 */
export const activateSubscriptionSchema = z.object({
  propertyNumber: propertyNumberSchema,
  packageId: packageIdSchema,
  paymentId: paymentIdSchema,
  finalAmount: positiveAmount,
  receiptUrl: z.string().url("رابط الإيصال غير صالح").optional(),
  startDate: z
    .string()
    .datetime({ message: "تاريخ البداية غير صالح" })
    .optional(),
  forceStart: z.boolean().optional(),
});

export type ActivateSubscriptionInput = z.infer<typeof activateSubscriptionSchema>;

/**
 * Input params for SubscriptionService.activateMultiProperty()
 */
export const activateMultiPropertySchema = z
  .object({
    propertyNumber1: propertyNumberSchema,
    propertyNumber2: propertyNumberSchema,
    packageId: packageIdSchema,
    paymentId: paymentIdSchema,
    finalAmount: positiveAmount,
    receiptUrl: z.string().url("رابط الإيصال غير صالح").optional(),
  })
  .refine(
    (data) => data.propertyNumber1 !== data.propertyNumber2,
    { message: "رقما العقارين يجب أن يكونا مختلفَين", path: ["propertyNumber2"] }
  );

export type ActivateMultiPropertyInput = z.infer<typeof activateMultiPropertySchema>;

/**
 * Input params for SubscriptionService.cancel()
 */
export const cancelSubscriptionSchema = z.object({
  propertyNumber: propertyNumberSchema,
  reason: z.string().trim().optional(),
});

export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>;

/**
 * Single item inside the array passed to SubscriptionService.updateRemainingDays()
 */
export const remainingDaysItemSchema = z.object({
  propertyNumber: propertyNumberSchema,
  remainingDays: z
    .number({ invalid_type_error: "الأيام المتبقية يجب أن تكون رقماً" })
    .int("الأيام المتبقية يجب أن تكون عدداً صحيحاً"),
});

export const updateRemainingDaysSchema = z
  .array(remainingDaysItemSchema)
  .min(1, "يجب توفير اشتراك واحد على الأقل");

export type UpdateRemainingDaysInput = z.infer<typeof updateRemainingDaysSchema>;

// ─── Route-level body schemas ────────────────────────────────────────────────

/**
 * POST /api/admin/subscription/cancel
 */
export const adminCancelBodySchema = cancelSubscriptionSchema;

/**
 * POST /api/admin/subscription/manual-activate
 */
export const adminManualActivateBodySchema = z.object({
  propertyNumber: propertyNumberSchema,
  packageId: packageIdSchema,
  startDate: z.string({ required_error: "تاريخ البداية مطلوب" }).trim().min(1, "تاريخ البداية مطلوب"),
  endDate: z.string({ required_error: "تاريخ الانتهاء مطلوب" }).trim().min(1, "تاريخ الانتهاء مطلوب"),
  linkedProperty: z.string().trim().optional(),
  paymentId: z.string().trim().optional(),
});

export type AdminManualActivateBody = z.infer<typeof adminManualActivateBodySchema>;

/**
 * POST /api/multi-property-subscription
 */
export const adminMultiPropertyBodySchema = z
  .object({
    packageId: packageIdSchema,
    propertyNumber1: propertyNumberSchema,
    propertyNumber2: propertyNumberSchema,
  })
  .refine(
    (data) => data.propertyNumber1 !== data.propertyNumber2,
    { message: "رقما العقارين يجب أن يكونا مختلفَين", path: ["propertyNumber2"] }
  );

export type AdminMultiPropertyBody = z.infer<typeof adminMultiPropertyBodySchema>;

// ─── Middleware helper ────────────────────────────────────────────────────────

/**
 * Returns an Express middleware that validates req.body against `schema`.
 * On failure it responds with 400 and a human-readable Arabic/English error.
 *
 * @example
 * router.post("/cancel", validateBody(adminCancelBodySchema), async (req, res) => { ... })
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const readable = fromZodError(result.error, {
        prefix: null,
        issueSeparator: " | ",
      });
      res.status(400).json({ error: readable.message });
      return;
    }
    // Attach parsed (and coerced) data back to req.body
    req.body = result.data;
    next();
  };
}
