export function normalizePhoneDigits(value: unknown): string {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/\D/g, "");
}

/** Returns the canonical Saudi mobile format (5XXXXXXXX), or null. */
export function normalizeSaudiMobilePhone(value: unknown): string | null {
  let digits = normalizePhoneDigits(value);
  if (digits.startsWith("00966")) digits = digits.slice(5);
  else if (digits.startsWith("966")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);

  return /^5\d{8}$/.test(digits) ? digits : null;
}

/** Returns the international digits-only form required by WhatsApp links. */
export function normalizeWhatsAppDestination(value: unknown): string | null {
  const saudiMobile = normalizeSaudiMobilePhone(value);
  if (saudiMobile) return `966${saudiMobile}`;

  let digits = normalizePhoneDigits(value);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") || digits.startsWith("966")) return null;
  return /^\d{8,15}$/.test(digits) ? digits : null;
}
