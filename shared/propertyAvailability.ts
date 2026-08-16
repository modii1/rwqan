export type CommissionHoldLike = {
  active?: unknown;
  obligationIds?: unknown;
};

export type PropertyWithCommissionHold = {
  commissionHold?: CommissionHoldLike | null;
};

/**
 * A booking-commission hold is independent from subscription suspension.
 * It controls marketplace visibility/contact eligibility for one property
 * without changing subscription dates or linked-property membership.
 */
export function hasActiveCommissionHold(
  property: unknown,
): boolean {
  if (!property || typeof property !== "object") return false;
  const candidate = property as PropertyWithCommissionHold;
  return candidate.commissionHold?.active === true;
}
