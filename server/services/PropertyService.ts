/**
 * PropertyService
 * Encapsulates all property-related business logic.
 */

import { firebaseService } from "../firebaseService";
import type { Property, InsertProperty } from "../../shared/schema";
import {
  checkPropertyDataComplete,
  detectSensitiveChanges,
  smartVerification,
} from "../utils/verification";
import { toRiyadhISO, getNowInRiyadh } from "../utils/dateUtils";

export class PropertyService {
  // ─── Read ───────────────────────────────────────────────────────────────────

  async getAll(): Promise<Property[]> {
    return firebaseService.getProperties();
  }

  async getByNumber(propertyNumber: string): Promise<Property | null> {
    return firebaseService.getPropertyByNumber(propertyNumber);
  }

  // ─── Create ─────────────────────────────────────────────────────────────────

  async create(data: InsertProperty): Promise<Property> {
    return firebaseService.createProperty(data);
  }

  // ─── Update ─────────────────────────────────────────────────────────────────

  /**
   * Update a property.
   * Automatically handles smart verification status based on changes.
   */
  async update(
    propertyNumber: string,
    updates: Partial<Property>,
    options: { skipVerification?: boolean } = {}
  ): Promise<Property> {
    const current = await firebaseService.getPropertyByNumber(propertyNumber);
    if (!current) throw new Error(`Property not found: ${propertyNumber}`);

    const merged: Property = { ...(current as any), ...(updates as any) };

    if (!options.skipVerification) {
      const hasSensitiveChange = detectSensitiveChanges(current, updates);
      if (hasSensitiveChange) {
        merged.verificationStatus = "pending";
      }
    }

    merged.lastUpdate = toRiyadhISO(getNowInRiyadh()).split("T")[0];

    return firebaseService.updateProperty(propertyNumber, merged);
  }

  // ─── Verification ───────────────────────────────────────────────────────────

  async approve(propertyNumber: string): Promise<Property> {
    return firebaseService.updateVerificationStatus(propertyNumber, "approved");
  }

  async reject(propertyNumber: string): Promise<Property> {
    return firebaseService.updateVerificationStatus(propertyNumber, "rejected");
  }

  async markIncomplete(propertyNumber: string): Promise<Property> {
    return firebaseService.updateVerificationStatus(propertyNumber, "incomplete");
  }

  async setPending(propertyNumber: string): Promise<Property> {
    return firebaseService.updateVerificationStatus(propertyNumber, "pending");
  }

  /**
   * Apply smart verification rules:
   * - Auto-approve if data is complete and no sensitive changes
   * - Mark incomplete otherwise
   */
  async applySmartVerification(
    propertyNumber: string,
    updates: Partial<Property>
  ): Promise<"approved" | "pending" | "incomplete"> {
    const current = await firebaseService.getPropertyByNumber(propertyNumber);
    const merged = { ...(current ?? {}), ...(updates as any) } as Property;

    const completionResult = await checkPropertyDataComplete(merged);
    const hasSensitive = detectSensitiveChanges(current ?? {}, updates).length > 0;

    if (!completionResult.isComplete) return "incomplete";
    if (hasSensitive) return "pending";
    return "approved";
  }

  // ─── Mute Expiry ─────────────────────────────────────────────────────────────

  async setMuteExpiry(propertyNumber: string, muted: boolean): Promise<Property> {
    return firebaseService.updateMuteExpiryNotification(propertyNumber, muted);
  }

  // ─── Delete ─────────────────────────────────────────────────────────────────

  async delete(propertyNumber: string): Promise<void> {
    return firebaseService.deleteProperty(propertyNumber);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Check if all required fields for a property are filled (eligibility for approval).
   */
  async isDataComplete(property: Property): Promise<boolean> {
    const result = await checkPropertyDataComplete(property);
    return result.isComplete;
  }
}

export const propertyService = new PropertyService();
