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
} from "@shared/schema";

export class FinanceService {
  // ─── Partner Profits ─────────────────────────────────────────────────────────

  async getPartnerProfits(): Promise<PartnerProfit[]> {
    return firebaseService.getPartnerProfits();
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
