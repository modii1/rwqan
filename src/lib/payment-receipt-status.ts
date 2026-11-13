/**
 * Receipt status shown in the owner's payment history.
 *
 * The label and the upload button must depend on whether a usable receipt is
 * actually attached, not only on the payment status/method. This module is
 * display-only: the server remains the source of truth for verification and
 * approval.
 */

export type ReceiptAvailability = "none" | "checking" | "valid" | "invalid";

export interface PaymentReceiptStatusInput {
  /** Arabic payment method as rendered by the dashboard. */
  paymentMethod: string;
  /** Arabic payment status as rendered by the dashboard. */
  status: string;
  /** True when the payment document references a receipt (URL or object key). */
  hasReceiptReference: boolean;
  /** Result of checking the receipt file itself. */
  receiptAvailability: ReceiptAvailability;
  /** Safe scan classification returned by the API. */
  scanStatus?: string | null;
}

export interface PaymentReceiptStatusView {
  reason: string;
  showUpload: boolean;
}

/**
 * Returns null when the standard status-based rendering should be used
 * (non-bank methods, or statuses other than pending/review).
 */
export function resolvePaymentReceiptStatus(
  input: PaymentReceiptStatusInput,
): PaymentReceiptStatusView | null {
  if (input.paymentMethod !== "تحويل بنكي") return null;
  if (input.status !== "معلق" && input.status !== "قيد المراجعة") return null;

  if (!input.hasReceiptReference) {
    return { reason: "لم يتم رفع إيصال بعد", showUpload: true };
  }

  if (
    input.receiptAvailability === "none" ||
    input.receiptAvailability === "checking"
  ) {
    return { reason: "جارٍ التحقق من ملف الإيصال...", showUpload: false };
  }

  if (input.receiptAvailability === "invalid") {
    return {
      reason: "ملف الإيصال غير متاح — يرجى رفع إيصال جديد",
      showUpload: true,
    };
  }

  if (input.scanStatus === "not_receipt") {
    return {
      reason:
        "المستند المرفوع ليس إيصال تحويل بنكي — يرجى رفع إيصال صحيح",
      showUpload: true,
    };
  }

  if (input.scanStatus === "error") {
    return {
      reason: "تعذر التحقق من الإيصال — يرجى إعادة رفعه",
      showUpload: true,
    };
  }

  if (input.status === "قيد المراجعة") {
    return {
      reason: "بانتظار مراجعة الإدارة للإيصال",
      showUpload: false,
    };
  }

  return {
    reason: "تم رفع الإيصال وبانتظار المراجعة",
    showUpload: false,
  };
}
