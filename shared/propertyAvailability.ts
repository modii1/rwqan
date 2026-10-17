export type CommissionHoldLike = {
  active?: unknown;
  obligationIds?: unknown;
  appliedAt?: unknown;
  updatedAt?: unknown;
};

export type AdminAvailabilityHoldLike = {
  active?: unknown;
};

export type CommissionHoldOverrideLike = {
  obligationIds?: unknown;
  emptyHoldFingerprint?: unknown;
};

export type PropertyWithCommissionHold = {
  commissionHold?: CommissionHoldLike | null;
  adminAvailabilityHold?: AdminAvailabilityHoldLike | null;
  commissionHoldOverride?: CommissionHoldOverrideLike | null;
};

export function hasUnreleasedCommissionHold(
  property: unknown,
): boolean {
  if (!property || typeof property !== "object") return false;
  const candidate = property as PropertyWithCommissionHold;
  return candidate.commissionHold?.active === true;
}

export function getActiveCommissionHoldVersion(
  property: unknown,
): string | null {
  if (!hasUnreleasedCommissionHold(property)) return null;
  const candidate = property as PropertyWithCommissionHold;
  const timestamp = String(
    candidate.commissionHold?.updatedAt ||
    candidate.commissionHold?.appliedAt ||
    "",
  ).trim();
  if (timestamp) return `timestamp:${timestamp}`;

  const obligationIds = Array.isArray(candidate.commissionHold?.obligationIds)
    ? Array.from(new Set(candidate.commissionHold.obligationIds.map(String))).sort()
    : [];
  return `legacy:${JSON.stringify(obligationIds)}`;
}

/**
 * A booking-commission hold is independent from subscription suspension.
 * It controls marketplace visibility/contact eligibility for one property
 * without changing subscription dates or linked-property membership.
 */
export function hasActiveCommissionHold(
  property: unknown,
): boolean {
  if (!hasUnreleasedCommissionHold(property)) return false;
  const candidate = property as PropertyWithCommissionHold;

  const obligationIds = Array.isArray(candidate.commissionHold?.obligationIds)
    ? candidate.commissionHold.obligationIds.map(String)
    : [];
  if (obligationIds.length === 0) {
    const fingerprint = String(
      candidate.commissionHold?.updatedAt ||
      candidate.commissionHold?.appliedAt ||
      "",
    );
    return !fingerprint ||
      candidate.commissionHoldOverride?.emptyHoldFingerprint !== fingerprint;
  }

  const overriddenIds = new Set(
    Array.isArray(candidate.commissionHoldOverride?.obligationIds)
      ? candidate.commissionHoldOverride.obligationIds.map(String)
      : [],
  );
  return obligationIds.some((obligationId) => !overriddenIds.has(obligationId));
}

export function getActiveCommissionHoldObligationIds(
  property: unknown,
): string[] {
  if (!hasUnreleasedCommissionHold(property)) return [];
  const candidate = property as PropertyWithCommissionHold;
  const overriddenIds = new Set(
    Array.isArray(candidate.commissionHoldOverride?.obligationIds)
      ? candidate.commissionHoldOverride.obligationIds.map(String)
      : [],
  );
  return Array.isArray(candidate.commissionHold?.obligationIds)
    ? Array.from(new Set(candidate.commissionHold.obligationIds.map(String)))
        .filter((obligationId) => !overriddenIds.has(obligationId))
    : [];
}

export function hasActiveAdminAvailabilityHold(
  property: unknown,
): boolean {
  if (!property || typeof property !== "object") return false;
  const candidate = property as PropertyWithCommissionHold;
  return candidate.adminAvailabilityHold?.active === true;
}

export function hasActivePropertyHold(
  property: unknown,
): boolean {
  return hasActiveAdminAvailabilityHold(property) ||
    hasActiveCommissionHold(property);
}
