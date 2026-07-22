/**
 * ownerValidation.ts
 * Zod schemas for all owner-facing route bodies.
 */

import { z } from "zod";
import { validateBody } from "./subscriptionValidation";

// ─── Primitives ───────────────────────────────────────────────────────────────

const nonEmpty = (label: string) =>
  z.string({ required_error: `${label} مطلوب` }).trim().min(1, `${label} لا يمكن أن يكون فارغاً`);

const propertyNumberSchema = nonEmpty("رقم العقار");
const packageIdSchema = nonEmpty("معرف الباقة");

// ─── SEO ──────────────────────────────────────────────────────────────────────

/** PUT /api/owner/seo */
export const updateSeoSchema = z.object({
  seoDescription: z.string().trim().optional(),
  metaTitle: z.string().trim().optional(),
  keywords: z.string().trim().optional(),
});
export type UpdateSeoBody = z.infer<typeof updateSeoSchema>;
export const validateUpdateSeo = validateBody(updateSeoSchema);

// ─── Second Property ─────────────────────────────────────────────────────────

/** POST /api/owner/verify-second-property */
export const verifySecondPropertySchema = z.object({
  secondPropertyNumber: propertyNumberSchema,
});
export type VerifySecondPropertyBody = z.infer<typeof verifySecondPropertySchema>;
export const validateVerifySecondProperty = validateBody(verifySecondPropertySchema);

// ─── Subscription actions ────────────────────────────────────────────────────

/** POST /api/owner/subscription/prepare-payment */
export const preparePaymentSchema = z.object({
  action: z.enum(["extend", "upgrade"], {
    errorMap: () => ({ message: "الإجراء يجب أن يكون 'extend' أو 'upgrade'" }),
  }),
  packageId: packageIdSchema,
});
export type PreparePaymentBody = z.infer<typeof preparePaymentSchema>;
export const validatePreparePayment = validateBody(preparePaymentSchema);

/** POST /api/owner/subscription/confirm */
export const confirmSubscriptionSchema = z.object({
  action: z.string().trim().optional(),
  packageId: packageIdSchema,
  paymentId: z.string().trim().optional(),
});
export type ConfirmSubscriptionBody = z.infer<typeof confirmSubscriptionSchema>;
export const validateConfirmSubscription = validateBody(confirmSubscriptionSchema);

// ─── Images ──────────────────────────────────────────────────────────────────

/** POST /api/owner/images/delete */
export const deleteImageSchema = z.object({
  url: z
    .string({ required_error: "URL مطلوبة" })
    .trim()
    .min(1, "URL لا يمكن أن تكون فارغة"),
});
export type DeleteImageBody = z.infer<typeof deleteImageSchema>;
export const validateDeleteImage = validateBody(deleteImageSchema);

// ─── Property activation ─────────────────────────────────────────────────────

/** POST /api/owner/property/activate */
export const activatePropertySchema = z.object({
  status: z.enum(["approved", "rejected"]).default("approved"),
});
export type ActivatePropertyBody = z.infer<typeof activatePropertySchema>;
export const validateActivateProperty = validateBody(activatePropertySchema);

// ─── Add-ons ─────────────────────────────────────────────────────────────────

/** POST /api/owner/addons/pay */
export const payAddonSchema = z.object({
  propertyNumber: propertyNumberSchema,
  addOnPackageId: nonEmpty("معرف الإضافة"),
});
export type PayAddonBody = z.infer<typeof payAddonSchema>;
export const validatePayAddon = validateBody(payAddonSchema);

/** POST /api/owner/addons/bank-transfer (multipart – body fields only) */
export const bankTransferAddonSchema = z.object({
  propertyNumber: propertyNumberSchema,
  addOnPackageId: nonEmpty("معرف الإضافة"),
  amount: z.string().optional(), // comes as string from FormData
});
export type BankTransferAddonBody = z.infer<typeof bankTransferAddonSchema>;
export const validateBankTransferAddon = validateBody(bankTransferAddonSchema);

// ─── Passwords ────────────────────────────────────────────────────────────────

/** POST /api/owner/change-password */
export const ownerChangePasswordSchema = z.object({
  currentPassword: nonEmpty("الرقم السري الحالي"),
  newPassword: nonEmpty("الرقم السري الجديد").min(4, "الرقم السري يجب أن يكون 4 أحرف على الأقل"),
});
export type OwnerChangePasswordBody = z.infer<typeof ownerChangePasswordSchema>;
export const validateOwnerChangePassword = validateBody(ownerChangePasswordSchema);

// ─── Payment initiation ──────────────────────────────────────────────────────

/** POST /api/owner/payment/initiate */
export const initiatePaymentSchema = z.object({
  propertyNumber: propertyNumberSchema,
  packageId: packageIdSchema,
  discountCode: z.string().trim().optional(),
  paymentMethod: z.enum(["cards", "applepay"]).default("cards"),
  action: z.enum(["new", "extend", "upgrade"]).optional(),
  secondPropertyNumber: z.string().trim().optional(),
});
export type InitiatePaymentBody = z.infer<typeof initiatePaymentSchema>;
export const validateInitiatePayment = validateBody(initiatePaymentSchema);

/** POST /api/owner/payment/retry */
export const retryPaymentSchema = z.object({
  paymentId: nonEmpty("معرف الدفعة"),
});
export type RetryPaymentBody = z.infer<typeof retryPaymentSchema>;
export const validateRetryPayment = validateBody(retryPaymentSchema);

/** POST /api/owner/payment/upload-receipt (multipart – body fields only) */
export const uploadReceiptSchema = z.object({
  paymentId: nonEmpty("معرف الدفعة"),
  action: z.string().trim().optional(),
});
export type UploadReceiptBody = z.infer<typeof uploadReceiptSchema>;
export const validateUploadReceipt = validateBody(uploadReceiptSchema);

/** POST /api/owner/payment/bank-transfer (multipart – body fields only) */
export const bankTransferPaymentSchema = z.object({
  propertyNumber: propertyNumberSchema,
  packageId: packageIdSchema,
  discountCode: z.string().trim().optional(),
  action: z.string().trim().optional(),
  secondPropertyNumber: z.string().trim().optional(),
});
export type BankTransferPaymentBody = z.infer<typeof bankTransferPaymentSchema>;
export const validateBankTransferPayment = validateBody(bankTransferPaymentSchema);

// ─── Tracking ─────────────────────────────────────────────────────────────────

/** POST /api/requests/smart */
export const smartRequestSchema = z.object({
  propertyNumber: propertyNumberSchema,
  clientPhone: z.string().trim().optional(),
});
export type SmartRequestBody = z.infer<typeof smartRequestSchema>;
export const validateSmartRequest = validateBody(smartRequestSchema);

/** POST /api/track-pageview */
export const trackPageviewSchema = z.object({
  propertyNumber: propertyNumberSchema,
  userAgent: z.string().optional(),
});
export type TrackPageviewBody = z.infer<typeof trackPageviewSchema>;
export const validateTrackPageview = validateBody(trackPageviewSchema);
