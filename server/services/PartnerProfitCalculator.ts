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
  /** تفاصيل كل دفعة ساهمت في إيرادات الدورة (للمطابقة والمراجعة). */
  paymentsDetail: Array<{
    id: string;
    propertyNumber: string;
    amount: number;
    netAmount: number;
    status: string;
    paymentMethod: string | undefined;
    completedAt: string | undefined;
  }>;
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

/**
 * حساب صافي دفعة واحدة بعد الرسوم.
 *
 * القواعد:
 * - إذا كان netAmount > 0: يُستخدم كصافي صحيح (قد يكون चुका محسوبًا من المزود).
 * - إذا كان netAmount = 0且 totalFees > 0: الصافي صحيح = 0 (كل المبلغ ذهب رسومًا).
 * - إذا كان netAmount غير موجود و totalFees > 0: الصافي = المبلغ ناقص الرسوم.
 * - إذا كان netAmount غير موجود أو = 0 و totalFees غير موجود أو = 0: لا توجد رسوم،
 *   يُستخدم المبلغ الكامل (لا يُفترض أن الصفر يعني رسومًا دون دليل).
 * - لا تُخصم الرسوم مرتين.
 */
function calculatePaymentNetAmount(payment: Payment): number {
  const amount = payment.finalAmount || 0;
  const totalFees =
    typeof payment.totalFees === "number" ? payment.totalFees : 0;
  const netAmount =
    typeof payment.netAmount === "number" ? payment.netAmount : null;

  // netAmount محسوم وموجب: استخدمه كما هو.
  if (netAmount !== null && netAmount > 0) {
    return netAmount;
  }

  // netAmount = 0且 هناك رسوم فعلية: الصافي صحيح = 0.
  if (netAmount === 0 && totalFees > 0) {
    return 0;
  }

  // netAmount غير موجود و هناك رسوم: احسب الصافي من المبلغ ناقص الرسوم.
  if (netAmount === null && totalFees > 0) {
    return Math.max(0, amount - totalFees);
  }

  // لا يوجد netAmount محسوم ولا رسوم فعلية: استخدم المبلغ الكامل.
  // لا نُفترض أن netAmount = 0 بدون رسوم يعني صافي صفر.
  return amount;
}

function calculateRevenueAfterFees(payments: Payment[], monthYear: string): {
  totalRevenue: number;
  revenueAfterFees: number;
  activeSubscriptions: number;
  paymentsDetail: Array<{
    id: string;
    propertyNumber: string;
    amount: number;
    netAmount: number;
    status: string;
    paymentMethod: string | undefined;
    completedAt: string | undefined;
  }>;
} {
  const normalized = normalizeMonthYear(monthYear);
  let totalRevenue = 0;
  let revenueAfterFees = 0;
  let activeSubscriptions = 0;
  const paymentsDetail: Array<{
    id: string;
    propertyNumber: string;
    amount: number;
    netAmount: number;
    status: string;
    paymentMethod: string | undefined;
    completedAt: string | undefined;
  }> = [];

  for (const payment of payments) {
    if (!COMPLETED_PAYMENT_STATUSES.has(payment.status)) continue;
    if (!isInMonth(payment.completedAt || payment.createdAt, normalized)) continue;

    const amount = payment.finalAmount || 0;
    totalRevenue += amount;
    activeSubscriptions += 1;

    const net = calculatePaymentNetAmount(payment);
    revenueAfterFees += net;

    paymentsDetail.push({
      id: payment.id,
      propertyNumber: payment.propertyNumber,
      amount,
      netAmount: net,
      status: payment.status,
      paymentMethod: payment.paymentMethod,
      completedAt: payment.completedAt,
    });
  }

  return {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    revenueAfterFees: Math.round(revenueAfterFees * 100) / 100,
    activeSubscriptions,
    paymentsDetail,
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
  const { totalRevenue, revenueAfterFees, activeSubscriptions, paymentsDetail } =
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
    paymentsDetail,
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
