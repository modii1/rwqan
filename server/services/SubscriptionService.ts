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
import { isPremiumSubscriptionType } from "../../shared/subscriptionType";

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
      endDate = calculateSubscriptionEndDate(null, pkg.duration);
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
}

export const subscriptionService = new SubscriptionService();
