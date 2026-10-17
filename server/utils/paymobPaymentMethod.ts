const GENERIC_PAYMOB_METHODS = new Set([
  "",
  "بطاقة",
  "card",
  "cards",
  "paymob",
  "تحويل بنكي",
  "bank_transfer",
  "bank transfer",
  "تأكيد يدوي",
  "manual",
  "unknown",
  "n/a",
]);

export function isGenericPaymobPaymentMethod(value: unknown): boolean {
  return GENERIC_PAYMOB_METHODS.has(
    String(value || "").trim().toLowerCase(),
  );
}

function exactMethod(value: unknown): string | null {
  const method = String(value || "").trim();
  return isGenericPaymobPaymentMethod(method) ? null : method;
}

/**
 * Return the exact, provider-signed payment subtype used for settlement.
 * Generic checkout labels are deliberately not accepted as financial
 * metadata because they cannot distinguish Apple Pay, mada, Visa, etc.
 */
export function getExactPaymobPaymentMethod(transaction: {
  cardSubType?: unknown;
  paymentMethod?: unknown;
}): string | null {
  return exactMethod(transaction.cardSubType) || exactMethod(transaction.paymentMethod);
}
