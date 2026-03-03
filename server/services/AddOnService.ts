/**
 * AddOnService
 * Add-on package lifecycle: purchase, activation, expiry, cancellation.
 */

import { firebaseService } from "../firebaseService";
import type {
  AddOnPackage,
  InsertAddOnPackage,
  PropertyAddOn,
  InsertPropertyAddOn,
  AddOnHistory,
} from "@shared/schema";

export class AddOnService {
  // ─── Add-On Packages ─────────────────────────────────────────────────────────

  async getAllPackages(): Promise<AddOnPackage[]> {
    return firebaseService.getAddOnPackages();
  }

  async getPackageById(id: string): Promise<AddOnPackage | null> {
    return firebaseService.getAddOnPackageById(id);
  }

  async createPackage(data: InsertAddOnPackage): Promise<AddOnPackage> {
    return firebaseService.createAddOnPackage(data);
  }

  async updatePackage(id: string, updates: Partial<AddOnPackage>): Promise<AddOnPackage | null> {
    return firebaseService.updateAddOnPackage(id, updates);
  }

  // ─── Property Add-Ons ────────────────────────────────────────────────────────

  async getForProperty(propertyNumber: string): Promise<PropertyAddOn[]> {
    return firebaseService.getPropertyAddOns(propertyNumber);
  }

  async getAll(): Promise<PropertyAddOn[]> {
    return firebaseService.getAllPropertyAddOns();
  }

  /**
   * Purchase an add-on for a property.
   * Creates a pending record — must be activated after payment confirmation.
   */
  async purchase(data: InsertPropertyAddOn): Promise<PropertyAddOn> {
    const pkg = await firebaseService.getAddOnPackageById(data.addOnPackageId);
    if (!pkg) throw new Error("باقة الإضافة غير موجودة");
    if (!pkg.isActive) throw new Error("باقة الإضافة غير مفعّلة");

    const addon = await firebaseService.createPropertyAddOn(data);

    await firebaseService.logAddOnHistory({
      propertyNumber: data.propertyNumber,
      addOnPackageId: data.addOnPackageId,
      action: "purchased",
      notes: "تم الشراء",
      timestamp: new Date().toISOString(),
      createdBy: "owner",
    });

    return addon;
  }

  /**
   * Activate a pending property add-on after payment is confirmed.
   */
  async activate(
    addonId: string,
    params: { startDate: string; endDate?: string }
  ): Promise<PropertyAddOn | null> {
    const updated = await firebaseService.updatePropertyAddOn(addonId, {
      status: "active",
      startDate: params.startDate,
      endDate: params.endDate,
    });

    if (updated) {
      await firebaseService.logAddOnHistory({
        propertyNumber: updated.propertyNumber,
        addOnPackageId: updated.addOnPackageId,
        action: "activated",
        notes: "تم التفعيل بعد تأكيد الدفع",
        timestamp: new Date().toISOString(),
        createdBy: "system",
      });
    }

    return updated;
  }

  /**
   * Cancel an active add-on.
   */
  async cancel(addonId: string, reason?: string): Promise<PropertyAddOn | null> {
    return firebaseService.cancelPropertyAddOn(addonId, reason);
  }

  /**
   * Update any expired add-ons (run from scheduler).
   */
  async processExpired(): Promise<number> {
    return firebaseService.updateExpiredAddOns();
  }

  // ─── History ─────────────────────────────────────────────────────────────────

  async logHistory(entry: Parameters<typeof firebaseService.logAddOnHistory>[0]): Promise<void> {
    return firebaseService.logAddOnHistory(entry);
  }
}

export const addOnService = new AddOnService();
