/**
 * Unified currency formatting for the entire application
 * All currency displays should use these functions
 */

export const CURRENCY_SYMBOL = "ريال";
export const CURRENCY_CODE = "SAR";

/**
 * Format a price with currency suffix
 * @param amount The price amount
 * @param withSpace Whether to add space before currency (default: true)
 * @returns Formatted string like "500 ريال"
 */
export function formatPrice(amount: number | string, withSpace = true): string {
  const space = withSpace ? " " : "";
  return `${amount}${space}${CURRENCY_SYMBOL}`;
}

/**
 * Format discount display
 * @param value The discount value
 * @param type The discount type ('نسبة' for percentage or 'مبلغ' for fixed amount)
 * @returns Formatted string like "10%" or "100 ريال"
 */
export function formatDiscount(value: number | string, type: "نسبة" | "مبلغ"): string {
  if (type === "نسبة") {
    return `${value}%`;
  } else {
    return formatPrice(value);
  }
}

/**
 * Get currency label for UI headers
 * @returns Currency display label
 */
export function getCurrencyLabel(): string {
  return `(${CURRENCY_SYMBOL})`;
}
