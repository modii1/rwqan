import type { Property, Subscription } from "../../shared/schema";
import {
  getActiveCommissionHoldVersion,
  getActiveCommissionHoldObligationIds,
  hasActiveAdminAvailabilityHold,
  hasActiveCommissionHold,
  hasActivePropertyHold,
} from "../../shared/propertyAvailability";
import {
  isActivePremiumSubscription,
  isSubscriptionStatusSuspended,
} from "../../shared/subscriptionType";
import { firebaseService } from "../firebaseService";
import { calculateRemainingDays } from "../utils/dateUtils";
import { selectCurrentSubscriptionForProperty } from "../utils/subscriptionSelection";

export type AdminPropertyHoldKind =
  | "manual"
  | "commission"
  | "manual_and_commission";

export type AdminPropertyHold = {
  propertyNumber: string;
  name: string;
  kind: AdminPropertyHoldKind;
  suspendedAt: string | null;
  manualHold: boolean;
  commissionHold: boolean;
  commissionObligationCount: number;
  commissionHoldVersion: string | null;
};

export type AdminFreePropertyCandidate = {
  propertyNumber: string;
  name: string;
};

export type AdminPropertyAvailabilityDashboard = {
  holds: AdminPropertyHold[];
  candidates: AdminFreePropertyCandidate[];
};

function timestamp(value: unknown): number {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestTimestamp(...values: unknown[]): string | null {
  const latest = values
    .map((value) => ({ value: String(value || ""), time: timestamp(value) }))
    .sort((left, right) => right.time - left.time)[0];
  return latest?.time ? latest.value : null;
}

export function isAdminFreePropertyCandidate(
  property: Property,
  subscription: Subscription | undefined,
): boolean {
  const verificationStatus = String(property.verificationStatus || "").trim();
  if (
    verificationStatus &&
    verificationStatus !== "approved" &&
    verificationStatus !== "verified"
  ) return false;
  if (isSubscriptionStatusSuspended(subscription?.status)) return false;

  const isExpired = !subscription?.endDate ||
    calculateRemainingDays(subscription.endDate) < 0;
  return !subscription || !isActivePremiumSubscription({
    subscriptionType: subscription.subscriptionType,
    packageType: subscription.packageType,
    status: subscription.status,
    isExpired,
  });
}

export function buildAdminPropertyAvailabilityDashboard(
  properties: readonly Property[],
  subscriptions: readonly Subscription[],
): AdminPropertyAvailabilityDashboard {
  const holds: AdminPropertyHold[] = [];
  const candidates: AdminFreePropertyCandidate[] = [];

  for (const property of properties) {
    const propertyNumber = String(property.propertyNumber || "").trim();
    if (!propertyNumber) continue;
    const subscription = selectCurrentSubscriptionForProperty(
      subscriptions,
      propertyNumber,
    );
    const manualHold = hasActiveAdminAvailabilityHold(property);
    const commissionHold = hasActiveCommissionHold(property);
    const name = String(property.name || `عقار ${propertyNumber}`);

    if (manualHold || commissionHold) {
      holds.push({
        propertyNumber,
        name,
        kind: manualHold && commissionHold
          ? "manual_and_commission"
          : manualHold
            ? "manual"
            : "commission",
        suspendedAt: latestTimestamp(
          manualHold ? property.adminAvailabilityHold?.appliedAt : null,
          commissionHold ? property.commissionHold?.appliedAt : null,
        ),
        manualHold,
        commissionHold,
        commissionObligationCount:
          getActiveCommissionHoldObligationIds(property).length,
        commissionHoldVersion: commissionHold
          ? getActiveCommissionHoldVersion(property)
          : null,
      });
      continue;
    }

    if (
      !hasActivePropertyHold(property) &&
      isAdminFreePropertyCandidate(property, subscription)
    ) {
      candidates.push({ propertyNumber, name });
    }
  }

  holds.sort((left, right) =>
    timestamp(right.suspendedAt) - timestamp(left.suspendedAt));
  candidates.sort((left, right) =>
    left.propertyNumber.localeCompare(right.propertyNumber, "en"));
  return { holds, candidates };
}

export class AdminPropertyAvailabilityService {
  async getDashboard(): Promise<AdminPropertyAvailabilityDashboard> {
    const [properties, subscriptions] = await Promise.all([
      firebaseService.getProperties(),
      firebaseService.getSubscriptions(),
    ]);
    return buildAdminPropertyAvailabilityDashboard(properties, subscriptions);
  }

  async pause(propertyNumber: string) {
    return firebaseService.pauseFreePropertyAvailability(propertyNumber);
  }

  async resume(
    propertyNumber: string,
    expectedCommissionHoldVersion: string | null,
  ) {
    return firebaseService.resumePropertyAvailability(
      propertyNumber,
      expectedCommissionHoldVersion,
    );
  }
}

export const adminPropertyAvailabilityService =
  new AdminPropertyAvailabilityService();
