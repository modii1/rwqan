/**
 * SubscriptionService
 * Manages subscription lifecycle: activation, extension, cancellation,
 * multi-property plans, and remaining-day updates.
 */

import { firebaseService } from "../firebaseService";
import type { Subscription, Package } from "../../shared/schema";
import {
  calculateSubscriptionEndDate,
  calculateExtensionEndDate,
  formatDateRiyadh,
  getStartOfDayRiyadh,
} from "../utils/dateUtils";
import {
  isPremiumSubscriptionType,
  isSubscriptionStatusActive,
} from "../../shared/subscriptionType";
import {
  SUSPENDED_SUBSCRIPTION_STATUS,
  SubscriptionLifecycleError,
  calculateFrozenRemainingDays,
  calculateRemainingDurationMs,
  calculateResumedEndDate,
} from "./subscriptionLifecycle";

export interface SubscriptionLifecycleResult {
  subscription: Subscription;
  updatedProperties: string[];
  remainingDays: number;
}

export class SubscriptionService {
  // ─── Read ───────────────────────────────────────────────────────────────────

  async getAll(): Promise<Subscription[]> {
    return firebaseService.getSubscriptions();
  }

  async getByProperty(propertyNumber: string): Promise<Subscription | null> {
    console.log(`[SUBSCRIPTION_SERVICE] getByProperty called for: ${propertyNumber}`);
    const result = await firebaseService.getSubscriptionByPropertyNumber(propertyNumber);
    console.log(`[SUBSCRIPTION_SERVICE] getByProperty result for ${propertyNumber}:`, result);
    return result;
  }

  async getPaymentsByProperty(propertyNumber: string) {
    return firebaseService.getPaymentsByProperty(propertyNumber);
  }

  // ─── Activate / Extend ─────────────────────────────────────────────────────

  /**
   * Activate or extend a subscription for a property.
   * If the property already has an active subscription, the new period is
   * appended after the current end date.
   */
  async activate(params: {
    propertyNumber: string;
    pkg: Package;
    paymentId: string;
    finalAmount: number;
    receiptUrl?: string;
    /** Override start date (defaults to today/current sub end) */
    startDate?: Date;
    /** If true, start immediately even if there's an active sub */
    forceStart?: boolean;
  }): Promise<{ startDate: string; endDate: string }> {
    const {
      propertyNumber,
      pkg,
      paymentId,
      finalAmount,
      receiptUrl,
      forceStart = false,
    } = params;

    const property = await firebaseService.getPropertyByNumber(propertyNumber);
    if (!property) throw new Error(`Property not found: ${propertyNumber}`);

    const currentSub = await firebaseService.getSubscriptionByPropertyNumber(propertyNumber);
    const today = getStartOfDayRiyadh();

    let startDate: Date;
    let endDate: Date;

    if (!forceStart && currentSub && new Date(currentSub.endDate) > today) {
      startDate = new Date(currentSub.endDate);
      endDate = calculateExtensionEndDate(startDate, pkg.duration);
    } else {
      startDate = params.startDate ?? today;
      endDate = calculateSubscriptionEndDate(startDate, pkg.duration);
    }

    const isMulti = pkg.propertyCount && pkg.propertyCount > 1;
    const pricePerProperty = isMulti ? finalAmount / (pkg.propertyCount ?? 1) : finalAmount;
    const isPremium = isPremiumSubscriptionType(pkg.type) || pricePerProperty > 0;

    const subscriptionData = {
      packageId: pkg.id,
      price: pricePerProperty,
      subscriptionType: isPremium ? "مميز" : "عادي",
      packageType: isPremium ? "مميز" : "عادي",
      startDate: formatDateRiyadh(startDate),
      endDate: formatDateRiyadh(endDate),
      paymentId,
    };

    await firebaseService.addSubscriptionToSheet(
      propertyNumber,
      subscriptionData,
      property,
      receiptUrl ?? ""
    );

    // Update property's subscriptionType to match the package
    await firebaseService.updateProperty(propertyNumber, { 
      subscriptionType: isPremium ? "مميز" : "عادي" 
    });

    return {
      startDate: subscriptionData.startDate,
      endDate: subscriptionData.endDate,
    };
  }

  /**
   * Activate subscriptions for two properties simultaneously (multi-property plan).
   */
  async activateMultiProperty(params: {
    propertyNumber1: string;
    propertyNumber2: string;
    pkg: Package;
    paymentId: string;
    finalAmount: number;
    receiptUrl?: string;
  }): Promise<{ startDate: string; endDate: string }> {
    const { propertyNumber1, propertyNumber2, pkg, paymentId, finalAmount, receiptUrl } = params;

    const result = await this.activate({
      propertyNumber: propertyNumber1,
      pkg,
      paymentId,
      finalAmount,
      receiptUrl,
    });

    const property2 = await firebaseService.getPropertyByNumber(propertyNumber2);
    if (property2) {
      const pricePerProperty = finalAmount / 2;
      const isPremium = isPremiumSubscriptionType(pkg.type) || pricePerProperty > 0;

      await firebaseService.addSubscriptionToSheet(
        propertyNumber2,
        {
          packageId: pkg.id,
          price: pricePerProperty,
          subscriptionType: isPremium ? "مميز" : "عادي",
          packageType: isPremium ? "مميز" : "عادي",
          startDate: result.startDate,
          endDate: result.endDate,
          paymentId,
          linkedProperty: propertyNumber1,
        },
        property2,
        receiptUrl ?? ""
      );
    }

    await firebaseService.createMultiPropertySubscription({
      packageId: pkg.id,
      propertyNumber1,
      propertyNumber2,
      startDate: result.startDate,
      endDate: result.endDate,
      status: "نشط",
      paymentId,
    });

    return result;
  }

  // ─── Cancel ─────────────────────────────────────────────────────────────────

  async cancel(propertyNumber: string, reason?: string): Promise<void> {
    await firebaseService.cancelSubscription(propertyNumber, reason);
  }

  // ─── Suspend / Resume ──────────────────────────────────────────────────────

  async suspend(
    identifier: string,
    suspendedAt: Date = new Date(),
  ): Promise<SubscriptionLifecycleResult> {
    const { source, subscriptions } = await this.getLifecycleGroup(identifier);

    if (source.status === SUSPENDED_SUBSCRIPTION_STATUS) {
      throw new SubscriptionLifecycleError(
        "ALREADY_SUSPENDED",
        "الاشتراك موقوف مؤقتاً بالفعل.",
      );
    }
    if (!isSubscriptionStatusActive(source.status) || source.cancelledAt) {
      throw new SubscriptionLifecycleError(
        "NOT_ACTIVE",
        "يمكن إيقاف الاشتراكات السارية فقط مؤقتاً.",
      );
    }

    const remainingDurationMs = calculateRemainingDurationMs(
      source.endDate,
      suspendedAt,
    );
    const suspendedAtIso = suspendedAt.toISOString();
    const subscriptionUpdates: Partial<Subscription> = {
      status: SUSPENDED_SUBSCRIPTION_STATUS,
      endDate: source.endDate,
      suspendedAt: suspendedAtIso,
      remainingDurationMs,
      cancelledAt: null,
      cancelReason: null,
    };

    await firebaseService.updateSubscriptionLifecycleGroup(
      subscriptions.map((subscription) => ({
        subscriptionId: subscription.id,
        propertyNumber: subscription.propertyNumber,
        subscriptionUpdates,
        propertySubscriptionType: "عادي",
      })),
    );

    return {
      subscription: { ...source, ...subscriptionUpdates },
      updatedProperties: subscriptions.map(({ propertyNumber }) => propertyNumber),
      remainingDays: calculateFrozenRemainingDays(remainingDurationMs),
    };
  }

  async resume(
    identifier: string,
    resumedAt: Date = new Date(),
  ): Promise<SubscriptionLifecycleResult> {
    const { source, subscriptions } = await this.getLifecycleGroup(identifier);

    if (source.status !== SUSPENDED_SUBSCRIPTION_STATUS) {
      throw new SubscriptionLifecycleError(
        "NOT_SUSPENDED",
        "الاشتراك غير موقوف مؤقتاً.",
      );
    }

    const suspendedAtTime = source.suspendedAt
      ? new Date(source.suspendedAt).getTime()
      : Number.NaN;
    if (!Number.isFinite(suspendedAtTime)) {
      throw new SubscriptionLifecycleError(
        "INVALID_SUSPENSION_STATE",
        "تاريخ الإيقاف المؤقت غير صالح.",
      );
    }

    const remainingDurationMs = Number(source.remainingDurationMs);
    const endDate = calculateResumedEndDate(remainingDurationMs, resumedAt);
    const subscriptionUpdates: Partial<Subscription> = {
      status: "ساري",
      endDate,
      suspendedAt: null,
      remainingDurationMs: null,
      cancelledAt: null,
      cancelReason: null,
    };

    await firebaseService.updateSubscriptionLifecycleGroup(
      subscriptions.map((subscription) => ({
        subscriptionId: subscription.id,
        propertyNumber: subscription.propertyNumber,
        subscriptionUpdates,
        propertySubscriptionType: isPremiumSubscriptionType(
          subscription.subscriptionType || subscription.packageType,
        )
          ? "مميز"
          : "عادي",
      })),
    );

    return {
      subscription: { ...source, ...subscriptionUpdates },
      updatedProperties: subscriptions.map(({ propertyNumber }) => propertyNumber),
      remainingDays: calculateFrozenRemainingDays(remainingDurationMs),
    };
  }

  private async getLifecycleGroup(identifier: string): Promise<{
    source: Subscription;
    subscriptions: Subscription[];
  }> {
    const subscriptions = await firebaseService.getSubscriptions();
    const current = subscriptions.find((subscription) =>
      subscription.id === identifier ||
      subscription.propertyNumber === identifier ||
      `SUB-${subscription.propertyNumber}` === identifier
    );

    if (!current) {
      throw new SubscriptionLifecycleError(
        "NOT_FOUND",
        "لم يتم العثور على الاشتراك المطلوب.",
      );
    }

    const requestedMainProperty = current.linkedProperty || current.propertyNumber;
    const main = subscriptions.find(
      ({ propertyNumber }) => propertyNumber === requestedMainProperty,
    );
    const source = main || current;
    const mainPropertyNumber = source.propertyNumber;
    const propertyNumbers = new Set<string>([
      mainPropertyNumber,
      current.propertyNumber,
    ]);

    for (const propertyNumber of source.linkedProperties || []) {
      if (propertyNumber) propertyNumbers.add(String(propertyNumber));
    }
    for (const propertyNumber of current.linkedProperties || []) {
      if (propertyNumber) propertyNumbers.add(String(propertyNumber));
    }
    for (const subscription of subscriptions) {
      if (subscription.linkedProperty === mainPropertyNumber) {
        propertyNumbers.add(subscription.propertyNumber);
      }
    }

    const groupSubscriptions = subscriptions.filter(({ propertyNumber }) =>
      propertyNumbers.has(propertyNumber)
    );

    return { source, subscriptions: groupSubscriptions };
  }

  // ─── Remaining Days ──────────────────────────────────────────────────────────

  async updateRemainingDays(
    updates: Array<{ propertyNumber: string; remainingDays: number }>
  ): Promise<number> {
    return firebaseService.updateAllSubscriptionsRemainingDays(updates);
  }

  // ─── Packages ───────────────────────────────────────────────────────────────

  async getPackages(): Promise<Package[]> {
    return firebaseService.getPackages();
  }

  async getPackageById(id: string): Promise<Package | null> {
    return firebaseService.getPackageById(id);
  }

  async getPurchasablePackageById(id: string): Promise<Package | null> {
    return firebaseService.getPurchasablePackageById(id);
  }
}

export const subscriptionService = new SubscriptionService();
