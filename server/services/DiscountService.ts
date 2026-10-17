/**
 * DiscountService
 * Discount code validation, application, and management.
 */

import { firebaseService } from "../firebaseService";
import type { DiscountCode } from "../../shared/schema";

export interface DiscountApplicationResult {
  valid: boolean;
  message: string;
  discountAmount: number;
  finalAmount: number;
}

export class DiscountService {
  // ─── Read ───────────────────────────────────────────────────────────────────

  async getAll(): Promise<DiscountCode[]> {
    return firebaseService.getDiscountCodes();
  }

  async getByCode(code: string): Promise<DiscountCode | null> {
    const codes = await firebaseService.getDiscountCodes();
    return codes.find((c) => c.code === code) ?? null;
  }

  // ─── Validate & Apply ───────────────────────────────────────────────────────

  /**
   * Validate a discount code and calculate the discounted price.
   * Does NOT increment usage — call recordUsage() after confirming payment.
   */
  async apply(code: string, originalAmount: number): Promise<DiscountApplicationResult> {
    const discount = await this.getByCode(code);

    if (!discount) {
      return { valid: false, message: "كود الخصم غير موجود", discountAmount: 0, finalAmount: originalAmount };
    }

    if (!discount.isActive) {
      return { valid: false, message: "كود الخصم غير نشط", discountAmount: 0, finalAmount: originalAmount };
    }

    if (discount.expiryDate && new Date(discount.expiryDate) < new Date()) {
      return { valid: false, message: "كود الخصم منتهي الصلاحية", discountAmount: 0, finalAmount: originalAmount };
    }

    let discountAmount = 0;
    if (discount.type === "نسبة") {
      discountAmount = Math.round((originalAmount * discount.value) / 100);
    } else {
      discountAmount = Math.min(discount.value, originalAmount);
    }

    const finalAmount = Math.max(0, originalAmount - discountAmount);

    return {
      valid: true,
      message: "تم تطبيق الخصم بنجاح",
      discountAmount,
      finalAmount,
    };
  }

  /**
   * Increment usage count for a discount code after a successful payment.
   */
  async recordUsage(code: string): Promise<void> {
    const discount = await this.getByCode(code);
    if (!discount) return;

    await firebaseService.updateDiscountCode(code, {
      usageCount: (discount.usageCount ?? 0) + 1,
    });
  }

  // ─── Manage ─────────────────────────────────────────────────────────────────

  async update(code: string, updates: Partial<DiscountCode>): Promise<DiscountCode | null> {
    return firebaseService.updateDiscountCode(code, updates);
  }

  async toggleActive(code: string, active: boolean): Promise<DiscountCode | null> {
    return firebaseService.updateDiscountCode(code, { isActive: active });
  }
}

export const discountService = new DiscountService();
