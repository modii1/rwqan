/**
 * PartnerProfitCalculator
 *
 * Pure, Firestore-free calculator for monthly partner profit cycles.
 *
 * Rules:
 * - Revenue = completed/successful payments after payment fees.
 * - Costs = approved operational expenses for the month.
 * - Monthly net result = revenue - costs.
 * - Carried losses are deducted from future months' profits first (gradual reduction).
 * - No distribution before covering all carried losses.
 * - Remaining distributable profit is split 50% partner / 50% us.
 * - Closed cycles are immutable and never recalculated.
 */

import type { Expense, Payment, PartnerProfit, PartnerProfitTransfer } from "../../shared/schema";

export type PartnerProfitMonthInput = {
  monthYear: string; // normalized YYYY-MM
  payments: Payment[];
  expenses: Expense[];
  previousClosedCycles: PartnerProfit[];
};

export type PartnerProfitCalculation = {
  monthYear: string;
  activeSubscriptions: number;
  totalRevenue: number;
  revenueAfterFees: number;
  totalExpenses: number;
  netProfitAfterExpenses: number;
  carriedLossForward: number;
  carriedLossRemaining: number;
  distributableProfit: number;
  partnerShare: number;
  ourShare: number;
  partnerPercentage: number;
};

const COMPLETED_PAYMENT_STATUSES = new Set([
  "مكتمل",
  "نجح",
  "نجاح",
  "completed",
]);

export function normalizeMonthYear(value: string): string {
  return value.replace("/", "-").slice(0, 7);
}

function isInMonth(isoDate: string | undefined, monthYear: string): boolean {
  if (!isoDate) return false;
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return false;
  const normalized = normalizeMonthYear(monthYear);
  const prefix = d.toISOString().slice(0, 7);
  return prefix === normalized;
}

function calculateMonthlyExpenses(expenses: Expense[], monthYear: string): number {
  const normalized = normalizeMonthYear(monthYear);
  const [year, month] = normalized.split("-").map(Number);
  const targetMonthStart = new Date(year, month - 1, 1);
  const targetMonthEnd = new Date(year, month, 0, 23, 59, 59, 999);

  let total = 0;
  for (const expense of expenses) {
    if (!expense.isActive) continue;

    switch (expense.expenseType) {
      case "مرة واحدة":
        if (expense.date && normalizeMonthYear(expense.date) === normalized) {
          total += expense.amount;
        }
        break;
      case "شهرية": {
        const expenseDate = new Date(expense.date);
        if (expenseDate <= targetMonthEnd) {
          total += expense.amount;
        }
        break;
      }
      case "موزعة":
        if (expense.startDate && expense.endDate && expense.monthlyAmount) {
          const startDate = new Date(expense.startDate);
          const endDate = new Date(expense.endDate);
          if (targetMonthStart >= startDate && targetMonthStart <= endDate) {
            total += expense.monthlyAmount;
          }
        }
        break;
    }
  }
  return Math.round(total * 100) / 100;
}

function calculateRevenueAfterFees(payments: Payment[], monthYear: string): {
  totalRevenue: number;
  revenueAfterFees: number;
  activeSubscriptions: number;
} {
  const normalized = normalizeMonthYear(monthYear);
  let totalRevenue = 0;
  let revenueAfterFees = 0;
  let activeSubscriptions = 0;

  for (const payment of payments) {
    if (!COMPLETED_PAYMENT_STATUSES.has(payment.status)) continue;
    if (!isInMonth(payment.completedAt || payment.createdAt, normalized)) continue;

    const amount = payment.finalAmount || 0;
    totalRevenue += amount;
    activeSubscriptions += 1;

    if (typeof payment.netAmount === "number") {
      //netAmount قد يكون صفرًا بصريح الحال (مثلاً رسوم تُستنفذ المبلغ كاملاً)،
      //فلا يُعامل الصفر على أنه "غير مضبوط" ويُعاود استخدام المبلغ الإجمالي.
      revenueAfterFees += payment.netAmount;
    } else if (typeof payment.totalFees === "number" && payment.totalFees > 0) {
      revenueAfterFees += Math.max(0, amount - payment.totalFees);
    } else {
      revenueAfterFees += amount;
    }
  }

  return {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    revenueAfterFees: Math.round(revenueAfterFees * 100) / 100,
    activeSubscriptions,
  };
}

export function sumCarriedLossRemaining(
  previousClosedCycles: PartnerProfit[]
): number {
  let total = 0;
  for (const cycle of previousClosedCycles) {
    // Historical records created before the cycle system have no status field;
    // they are treated as finalized and their carried loss still applies.
    const isClosed = cycle.status === "closed" || !cycle.status;
    if (isClosed && cycle.carriedLossRemaining > 0) {
      total += cycle.carriedLossRemaining;
    }
  }
  return Math.round(total * 100) / 100;
}

export function calculatePartnerProfitMonth(
  input: PartnerProfitMonthInput
): PartnerProfitCalculation {
  const normalizedMonth = normalizeMonthYear(input.monthYear);
  const { totalRevenue, revenueAfterFees, activeSubscriptions } =
    calculateRevenueAfterFees(input.payments, normalizedMonth);

  const totalExpenses = calculateMonthlyExpenses(input.expenses, normalizedMonth);
  const netProfitAfterExpenses = Math.round((revenueAfterFees - totalExpenses) * 100) / 100;

  const carriedLossForward = sumCarriedLossRemaining(input.previousClosedCycles);

  let carriedLossRemaining: number;
  let distributableProfit: number;

  if (netProfitAfterExpenses <= 0) {
    // Loss adds to carried loss.
    carriedLossRemaining = Math.round((carriedLossForward + Math.abs(netProfitAfterExpenses)) * 100) / 100;
    distributableProfit = 0;
  } else if (netProfitAfterExpenses <= carriedLossForward) {
    // Profit reduces carried loss gradually, no distribution yet.
    carriedLossRemaining = Math.round((carriedLossForward - netProfitAfterExpenses) * 100) / 100;
    distributableProfit = 0;
  } else {
    // Profit covers all carried loss; remainder is distributable.
    carriedLossRemaining = 0;
    distributableProfit = Math.round((netProfitAfterExpenses - carriedLossForward) * 100) / 100;
  }

  const partnerPercentage = 50;
  const partnerShare = Math.round(distributableProfit * (partnerPercentage / 100) * 100) / 100;
  const ourShare = Math.round(distributableProfit * (1 - partnerPercentage / 100) * 100) / 100;

  return {
    monthYear: normalizedMonth,
    activeSubscriptions,
    totalRevenue,
    revenueAfterFees,
    totalExpenses,
    netProfitAfterExpenses,
    carriedLossForward,
    carriedLossRemaining,
    distributableProfit,
    partnerShare,
    ourShare,
    partnerPercentage,
  };
}

export function computeRemainingToTransfer(
  cycle: Pick<PartnerProfit, "partnerShare" | "transferredToPartner" | "transfers">
): number {
  const transferred = cycle.transfers.reduce((sum, t) => sum + (t.amount || 0), 0);
  const recordedTransferred = Math.max(transferred, cycle.transferredToPartner || 0);
  return Math.round(Math.max(0, (cycle.partnerShare || 0) - recordedTransferred) * 100) / 100;
}

export function isDuplicateTransfer(
  transfers: PartnerProfitTransfer[],
  reference: string | undefined,
  amount: number
): boolean {
  if (!reference) return false;
  return transfers.some(
    (t) =>
      t.reference === reference.trim() &&
      Math.abs((t.amount || 0) - amount) < 0.001
  );
}
