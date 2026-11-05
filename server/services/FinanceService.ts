/**
 * FinanceService
 * Partner profit records, expenses, and financial summary calculations.
 */

import { firebaseService } from "../firebaseService";
import type {
  PartnerProfit,
  InsertPartnerProfit,
  Expense,
  InsertExpense,
} from "../../shared/schema";
import {
  calculatePartnerProfitMonth,
  computeRemainingToTransfer,
  isDuplicateTransfer,
  normalizeMonthYear,
} from "./PartnerProfitCalculator";
import { getNowInRiyadh, getNowISO } from "../utils/dateUtils";

export class FinanceService {
  // ─── Partner Profits ─────────────────────────────────────────────────────────

  async getPartnerProfits(): Promise<PartnerProfit[]> {
    const profits = await firebaseService.getPartnerProfits();
    return profits.map((p) => this.enrichProfit(p));
  }

  async createPartnerProfit(data: InsertPartnerProfit): Promise<PartnerProfit> {
    return firebaseService.createPartnerProfit(data);
  }

  async updatePartnerProfit(
    id: string,
    updates: Partial<PartnerProfit>
  ): Promise<PartnerProfit | null> {
    return firebaseService.updatePartnerProfit(id, updates);
  }

  /**
   * Update notes only. Financial fields and closed cycles are protected.
   */
  async updatePartnerProfitNotes(
    id: string,
    notes: string | undefined
  ): Promise<PartnerProfit | null> {
    const existing = await this.getPartnerProfitById(id);
    if (!existing) return null;
    if (this.isEffectivelyClosed(existing)) {
      throw new Error("لا يمكن تعديل ملاحظات دورة مقفلة أو تاريخية");
    }
    const updated = await firebaseService.updatePartnerProfit(id, {
      notes: notes?.trim(),
      updatedAt: getNowISO(),
    });
    return updated ? this.enrichProfit(updated) : null;
  }

  private isEffectivelyClosed(profit: PartnerProfit): boolean {
    // Historical records created before the cycle system have no status field.
    return profit.status === "closed" || !profit.status;
  }

  /**
   * Calculate profits for the current month and upsert/return the summary.
   */
  async calculateMonthlyProfits() {
    return firebaseService.calculateMonthlyProfits();
  }

  async calculateMonthlyExpenses() {
    return firebaseService.calculateMonthlyExpensesAsync();
  }

  async calculateAllTimeExpenses() {
    return firebaseService.calculateAllTimeExpensesAsync();
  }

  async getProfitsSummary() {
    return firebaseService.getProfitsSummary();
  }

  // ─── Monthly Partner Profit Cycle ────────────────────────────────────────────

  /**
   * Prepare (or recalculate) a monthly profit cycle.
   * The cycle remains mutable until it is closed.
   */
  async prepareMonthlyCycle(monthYear?: string): Promise<PartnerProfit> {
    const targetMonthYear =
      monthYear || this.formatMonthYear(getNowInRiyadh());

    const [payments, expenses, existingProfits] = await Promise.all([
      firebaseService.getPayments(),
      firebaseService.getExpenses(),
      firebaseService.getPartnerProfits(),
    ]);

    const closedCycles = existingProfits.filter((p) => this.isEffectivelyClosed(p));

    const calculation = calculatePartnerProfitMonth({
      monthYear: targetMonthYear,
      payments,
      expenses,
      previousClosedCycles: closedCycles,
    });

    const existing = existingProfits.find(
      (p) => normalizeMonthYear(p.monthYear) === calculation.monthYear
    );

    const partnerShare = calculation.partnerShare;
    const transferredToPartner = existing?.transferredToPartner || 0;
    const transfers = existing?.transfers || [];
    const remainingToTransfer = computeRemainingToTransfer({
      partnerShare,
      transferredToPartner,
      transfers,
    });

    const payload: InsertPartnerProfit = {
      monthYear: calculation.monthYear,
      activeSubscriptions: calculation.activeSubscriptions,
      totalRevenue: calculation.totalRevenue,
      revenueAfterFees: calculation.revenueAfterFees,
      totalExpenses: calculation.totalExpenses,
      netProfitAfterExpenses: calculation.netProfitAfterExpenses,
      carriedLossForward: calculation.carriedLossForward,
      carriedLossRemaining: calculation.carriedLossRemaining,
      distributableProfit: calculation.distributableProfit,
      partnerShare,
      partnerPercentage: calculation.partnerPercentage,
      ourShare: calculation.ourShare,
      owedToPartner: partnerShare,
      transferredToPartner,
      remainingToTransfer,
      transfers,
      transferStatus: "pending",
      status: existing?.status || "pending_review",
      notes: existing?.notes,
    };

    if (existing) {
      // Only mutable cycles may be recalculated.
      if (this.isEffectivelyClosed(existing)) {
        return this.enrichProfit(existing);
      }
      const updated = await firebaseService.updatePartnerProfit(existing.id, payload);
      return this.enrichProfit(updated!);
    }

    const created = await firebaseService.createPartnerProfit(payload);
    return this.enrichProfit(created);
  }

  /**
   * Close a monthly profit cycle. After closing it becomes immutable.
   */
  async closeMonthlyCycle(
    id: string,
    adminId: string
  ): Promise<PartnerProfit | null> {
    const existing = await this.getPartnerProfitById(id);
    if (!existing) return null;
    if (this.isEffectivelyClosed(existing)) {
      throw new Error("الدورة مغلقة بالفعل ولا يمكن إقفالها مرة أخرى");
    }

    const updated = await firebaseService.updatePartnerProfit(id, {
      status: "closed",
      closedAt: getNowISO(),
      closedBy: adminId,
    });
    return updated ? this.enrichProfit(updated) : null;
  }

  /**
   * Record a transfer to the partner for a given cycle.
   * Prevents duplicate transfers by reference+amount.
   */
  async recordTransfer(
    id: string,
    amount: number,
    reference: string | undefined,
    adminId: string
  ): Promise<PartnerProfit | null> {
    if (!amount || amount <= 0) {
      throw new Error("مبلغ التحويل يجب أن يكون أكبر من صفر");
    }

    const existing = await this.getPartnerProfitById(id);
    if (!existing) return null;
    if (this.isEffectivelyClosed(existing)) {
      throw new Error("لا يمكن تسجيل تحويل على دورة مقفلة أو تاريخية");
    }

    const transfers = existing.transfers || [];
    if (isDuplicateTransfer(transfers, reference, amount)) {
      throw new Error("تحويل بنفس المرجع والمبلغ مسجل مسبقًا");
    }

    const currentRemaining = computeRemainingToTransfer({
      partnerShare: existing.partnerShare,
      transferredToPartner: existing.transferredToPartner,
      transfers,
    });
    if (amount > currentRemaining + 0.001) {
      throw new Error("مبلغ التحويل يتجاوز المستحق المتبقي للشريك");
    }

    const transfer = {
      id: `TRF-${Date.now()}`,
      amount,
      date: getNowISO(),
      reference: reference?.trim(),
      createdBy: adminId,
      createdAt: getNowISO(),
    };

    const transferredToPartner = Math.round((existing.transferredToPartner + amount) * 100) / 100;
    const remainingToTransfer = computeRemainingToTransfer({
      partnerShare: existing.partnerShare,
      transferredToPartner,
      transfers: [...transfers, transfer],
    });

    const updated = await firebaseService.updatePartnerProfit(id, {
      transfers: [...transfers, transfer],
      transferredToPartner,
      remainingToTransfer,
      transferStatus: remainingToTransfer <= 0 ? "transferred" : "pending",
    });
    return updated ? this.enrichProfit(updated) : null;
  }

  async getPartnerProfitById(id: string): Promise<PartnerProfit | null> {
    const profit = await firebaseService.getPartnerProfitById(id);
    if (!profit) return null;
    return this.enrichProfit(profit);
  }

  private enrichProfit(profit: PartnerProfit): PartnerProfit {
    const transfers = profit.transfers || [];
    const transferredToPartner = Math.max(
      profit.transferredToPartner || 0,
      transfers.reduce((sum, t) => sum + (t.amount || 0), 0)
    );
    const remainingToTransfer = computeRemainingToTransfer({
      partnerShare: profit.partnerShare,
      transferredToPartner,
      transfers,
    });
    return {
      ...profit,
      transferredToPartner,
      remainingToTransfer,
      owedToPartner: profit.partnerShare,
    };
  }

  private formatMonthYear(date: Date): string {
    return normalizeMonthYear(`${date.getFullYear()}-${date.getMonth() + 1}`);
  }

  // ─── Expenses ────────────────────────────────────────────────────────────────

  async getExpenses(): Promise<Expense[]> {
    return firebaseService.getExpenses();
  }

  async createExpense(data: InsertExpense): Promise<Expense> {
    return firebaseService.createExpense(data);
  }

  // ─── Fee Configs ──────────────────────────────────────────────────────────────

  async getFeeConfigs() {
    return firebaseService.getFeeConfigs();
  }

  async getFeeConfigById(id: string) {
    return firebaseService.getFeeConfigById(id);
  }
}

export const financeService = new FinanceService();
