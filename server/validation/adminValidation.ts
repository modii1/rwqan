/**
 * adminValidation.ts
 * Zod schemas for all admin-facing route bodies.
 */

import { z } from "zod";
import { validateBody } from "./subscriptionValidation";

// ─── Primitives ───────────────────────────────────────────────────────────────

const nonEmpty = (label: string) =>
  z.string({ required_error: `${label} مطلوب` }).trim().min(1, `${label} لا يمكن أن يكون فارغاً`);

const propertyNumberSchema = nonEmpty("رقم العقار");

const positiveNum = (label: string) =>
  z.number({ required_error: `${label} مطلوب`, invalid_type_error: `${label} يجب أن يكون رقماً` })
    .positive(`${label} يجب أن يكون أكبر من صفر`);

// ─── Add-ons ──────────────────────────────────────────────────────────────────

/** POST /api/admin/addons/create */
export const createAddonSchema = z.object({
  name: nonEmpty("الاسم"),
  description: z.string().trim().optional().default(""),
  price: z.number({ required_error: "السعر مطلوب" }).nonnegative("السعر يجب ألا يكون سالباً"),
  durationDays: z.number().int().nonnegative().optional().default(0),
  category: nonEmpty("الفئة"),
  isActive: z.boolean().optional().default(true),
});
export type CreateAddonBody = z.infer<typeof createAddonSchema>;
export const validateCreateAddon = validateBody(createAddonSchema);

/** POST /api/admin/addons/approve  &  /reject */
export const addonApproveRejectSchema = z.object({
  propertyAddOnId: nonEmpty("معرف الإضافة"),
});
export type AddonApproveRejectBody = z.infer<typeof addonApproveRejectSchema>;
export const validateAddonApproveReject = validateBody(addonApproveRejectSchema);

/** POST /api/admin/addons/pay (owner-facing, in admin router) */
export const addonPaySchema = z.object({
  propertyNumber: propertyNumberSchema,
  addOnPackageId: nonEmpty("معرف الإضافة"),
});
export type AddonPayBody = z.infer<typeof addonPaySchema>;
export const validateAddonPay = validateBody(addonPaySchema);

/** POST /api/admin/addons/bank-transfer (multipart) */
export const addonBankTransferSchema = z.object({
  propertyNumber: propertyNumberSchema,
  addOnPackageId: nonEmpty("معرف الإضافة"),
  amount: z.coerce.number().nonnegative().optional(),
});
export type AddonBankTransferBody = z.infer<typeof addonBankTransferSchema>;
export const validateAddonBankTransfer = validateBody(addonBankTransferSchema);

// ─── Payments ─────────────────────────────────────────────────────────────────

/** POST /api/admin/payment/approve  &  /reject */
export const paymentIdBodySchema = z.object({
  paymentId: nonEmpty("معرف الدفع"),
});
export type PaymentIdBody = z.infer<typeof paymentIdBodySchema>;
export const validatePaymentIdBody = validateBody(paymentIdBodySchema);

/** PUT /api/admin/payments/:id/status */
export const updatePaymentStatusSchema = z.object({
  status: nonEmpty("الحالة"),
});
export type UpdatePaymentStatusBody = z.infer<typeof updatePaymentStatusSchema>;
export const validateUpdatePaymentStatus = validateBody(updatePaymentStatusSchema);

/** POST /api/admin/payments/:transactionId/update-fees */
export const updateFeesSchema = z.object({
  feeAmount: z.number().nonnegative().optional().default(0),
  vatAmount: z.number().nonnegative().optional().default(0),
  merchantFees: z.number().nonnegative().optional().default(0),
  acqFees: z.number().nonnegative().optional().default(0),
});
export type UpdateFeesBody = z.infer<typeof updateFeesSchema>;
export const validateUpdateFees = validateBody(updateFeesSchema);

// ─── Finance – Discounts ─────────────────────────────────────────────────────

/** POST /api/admin/discounts */
export const createDiscountSchema = z.object({
  code: nonEmpty("كود الخصم"),
  type: z.enum(["نسبة", "قيمة ثابتة", "ثابت"], {
    errorMap: () => ({ message: "نوع الخصم يجب أن يكون 'نسبة' أو 'قيمة ثابتة'" }),
  }),
  value: z.number({ required_error: "القيمة مطلوبة" }).nonnegative("القيمة يجب ألا تكون سالبة"),
  expiryDate: z.string().optional(),
  isActive: z.boolean().optional().default(true),
});
export type CreateDiscountBody = z.infer<typeof createDiscountSchema>;
export const validateCreateDiscount = validateBody(createDiscountSchema);

// ─── Finance – Refunds ───────────────────────────────────────────────────────

/** POST /api/admin/refunds */
export const createRefundSchema = z.object({
  paymentId: nonEmpty("معرف الدفعة"),
  refundAmount: positiveNum("مبلغ الاسترجاع"),
  reason: z.string().trim().optional().default(""),
});
export type CreateRefundBody = z.infer<typeof createRefundSchema>;
export const validateCreateRefund = validateBody(createRefundSchema);

// ─── Finance – Fee calculation ───────────────────────────────────────────────

/** POST /api/admin/calculate-fees */
export const calculateFeesSchema = z.object({
  amount: positiveNum("المبلغ"),
  paymentMethod: z.string().trim().optional(),
  cardType: z.string().trim().optional(),
  useConfigs: z.boolean().optional(),
});
export type CalculateFeesBody = z.infer<typeof calculateFeesSchema>;
export const validateCalculateFees = validateBody(calculateFeesSchema);

// ─── Finance – Expenses ──────────────────────────────────────────────────────

/** POST /api/admin/expenses */
export const createExpenseSchema = z.object({
  title: nonEmpty("العنوان"),
  amount: z.coerce.number({ required_error: "المبلغ مطلوب" }).positive("المبلغ يجب أن يكون أكبر من صفر"),
  category: z.string().trim().optional(),
  description: z.string().trim().optional(),
  date: nonEmpty("التاريخ"),
});
export type CreateExpenseBody = z.infer<typeof createExpenseSchema>;
export const validateCreateExpense = validateBody(createExpenseSchema);

// ─── Finance – Currency conversion ──────────────────────────────────────────

/** POST /api/admin/convert-currency */
export const convertCurrencySchema = z.object({
  amount: z.coerce.number().positive("المبلغ يجب أن يكون أكبر من صفر"),
  from: z.string().trim().default("USD"),
  to: z.string().trim().default("SAR"),
});
export type ConvertCurrencyBody = z.infer<typeof convertCurrencySchema>;
export const validateConvertCurrency = validateBody(convertCurrencySchema);

// ─── Properties ──────────────────────────────────────────────────────────────

/** PUT /api/admin/properties/:propertyNumber/reject */
export const rejectPropertySchema = z.object({
  reason: z.string().trim().optional(),
});
export type RejectPropertyBody = z.infer<typeof rejectPropertySchema>;
export const validateRejectProperty = validateBody(rejectPropertySchema);

/** PUT /api/admin/properties/:propertyNumber/mute */
export const mutePropertySchema = z.object({
  muted: z.boolean({ required_error: "حالة الإشعارات مطلوبة" }),
});
export type MutePropertyBody = z.infer<typeof mutePropertySchema>;
export const validateMuteProperty = validateBody(mutePropertySchema);

// ─── Settings – Notifications ────────────────────────────────────────────────

/** POST /api/admin/send-owner-notification */
export const sendNotificationSchema = z.object({
  propertyNumber: propertyNumberSchema,
  notificationType: z.enum(["expired", "expiring_soon", "custom"], {
    errorMap: () => ({ message: "نوع الإشعار غير صحيح" }),
  }),
  customMessage: z.string().trim().optional(),
}).refine(
  (d) => d.notificationType !== "custom" || (d.customMessage && d.customMessage.length > 0),
  { message: "الرسالة المخصصة مطلوبة عند اختيار 'custom'", path: ["customMessage"] },
);
export type SendNotificationBody = z.infer<typeof sendNotificationSchema>;
export const validateSendNotification = validateBody(sendNotificationSchema);

/** POST /api/admin/send-bulk-notifications */
export const bulkNotificationSchema = z.object({
  notificationType: z.enum(["all", "expired", "expiring_soon"], {
    errorMap: () => ({ message: "نوع الإشعار غير صحيح" }),
  }),
});
export type BulkNotificationBody = z.infer<typeof bulkNotificationSchema>;
export const validateBulkNotification = validateBody(bulkNotificationSchema);

// ─── Settings – Bank Accounts ────────────────────────────────────────────────

/** POST /api/admin/bank-accounts */
export const createBankAccountSchema = z.object({
  bankName: nonEmpty("اسم البنك"),
  beneficiaryName: nonEmpty("اسم المستفيد"),
  iban: nonEmpty("IBAN"),
  accountNumber: z.string().trim().optional(),
  isActive: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
});
export type CreateBankAccountBody = z.infer<typeof createBankAccountSchema>;
export const validateCreateBankAccount = validateBody(createBankAccountSchema);

// ─── Settings – Feature flags ────────────────────────────────────────────────

/** PUT /api/admin/feature-flags/:key */
export const updateFeatureFlagSchema = z.object({
  isEnabled: z.boolean({ required_error: "الحالة مطلوبة" }),
});
export type UpdateFeatureFlagBody = z.infer<typeof updateFeatureFlagSchema>;
export const validateUpdateFeatureFlag = validateBody(updateFeatureFlagSchema);

// ─── Subscriptions – Link ────────────────────────────────────────────────────

/** POST /api/admin/subscription/link */
export const linkPropertySchema = z.object({
  propertyNumber: propertyNumberSchema,
  linkedProperty: nonEmpty("رقم العقار المرتبط"),
});
export type LinkPropertyBody = z.infer<typeof linkPropertySchema>;
export const validateLinkProperty = validateBody(linkPropertySchema);

// ─── Testing ─────────────────────────────────────────────────────────────────

/** POST /api/admin/smart-verify */
export const smartVerifySchema = z.object({
  propertyNumber: propertyNumberSchema,
  paymentId: z.string().trim().optional(),
  secondPropertyNumber: z.string().trim().optional(),
});
export type SmartVerifyBody = z.infer<typeof smartVerifySchema>;
export const validateSmartVerify = validateBody(smartVerifySchema);

/** POST /api/admin/test-enjazatik */
export const testWhatsappSchema = z.object({
  phone: z.string().trim().optional(),
  message: z.string().trim().optional(),
});
export type TestWhatsappBody = z.infer<typeof testWhatsappSchema>;
export const validateTestWhatsapp = validateBody(testWhatsappSchema);

/** POST /api/admin/test-inquiry */
export const testInquirySchema = z.object({
  orderId: nonEmpty("معرف الطلب"),
});
export type TestInquiryBody = z.infer<typeof testInquirySchema>;
export const validateTestInquiry = validateBody(testInquirySchema);

// ─── Backup ──────────────────────────────────────────────────────────────────

/** POST /api/admin/backup */
export const createBackupSchema = z.object({
  backupType: z.string().trim().optional(),
  backupName: z.string().trim().optional(),
  dataTypes: z.array(z.string()).optional(),
  description: z.string().trim().optional(),
});
export type CreateBackupBody = z.infer<typeof createBackupSchema>;
export const validateCreateBackup = validateBody(createBackupSchema);

// ─── Admin images ────────────────────────────────────────────────────────────

/** POST /api/admin/images/delete (in images router) */
export const adminDeleteImageSchema = z.object({
  url: nonEmpty("رابط الصورة"),
});
export type AdminDeleteImageBody = z.infer<typeof adminDeleteImageSchema>;
export const validateAdminDeleteImage = validateBody(adminDeleteImageSchema);
