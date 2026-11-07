import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePartnerProfitMonth,
  computeRemainingToTransfer,
  isDuplicateTransfer,
} from "./PartnerProfitCalculator";
import type { Expense, Payment, PartnerProfit } from "../../shared/schema";

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: `PAY-${Math.random().toString(36).slice(2, 8)}`,
    propertyNumber: "12345",
    packageId: "PKG-1",
    amount: 1000,
    finalAmount: 1000,
    status: "مكتمل",
    paymentMethod: "بطاقة",
    createdAt: "2026-08-15T10:00:00.000Z",
    completedAt: "2026-08-15T10:00:00.000Z",
    netAmount: 960,
    totalFees: 40,
    ...overrides,
  } as Payment;
}

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: `EXP-${Math.random().toString(36).slice(2, 8)}`,
    title: "تكلفة تشغيلية",
    amount: 100,
    category: "أخرى",
    date: "2026-08-10",
    expenseType: "مرة واحدة",
    isActive: true,
    ...overrides,
  } as Expense;
}

function makeClosedCycle(
  monthYear: string,
  carriedLossRemaining: number
): PartnerProfit {
  return {
    id: `PP-${monthYear}`,
    monthYear,
    status: "closed",
    carriedLossRemaining,
    partnerShare: 0,
    transfers: [],
    activeSubscriptions: 0,
    totalRevenue: 0,
    revenueAfterFees: 0,
    partnerPercentage: 50,
    totalExpenses: 0,
    netProfitAfterExpenses: 0,
    carriedLossForward: 0,
    distributableProfit: 0,
    ourShare: 0,
    owedToPartner: 0,
    transferredToPartner: 0,
    remainingToTransfer: 0,
  } as unknown as PartnerProfit;
}

test("شهر خاسر وترحيل الخسارة", () => {
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-08",
    payments: [],
    expenses: [makeExpense({ amount: 500 })],
    previousClosedCycles: [],
  });

  assert.equal(result.revenueAfterFees, 0);
  assert.equal(result.totalExpenses, 500);
  assert.equal(result.netProfitAfterExpenses, -500);
  assert.equal(result.carriedLossForward, 0);
  assert.equal(result.carriedLossRemaining, 500);
  assert.equal(result.distributableProfit, 0);
  assert.equal(result.partnerShare, 0);
});

test("شهر مربح يغطي الخسارة ويوزع المتبقي", () => {
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-09",
    payments: [makePayment({ finalAmount: 3000, netAmount: 2880, completedAt: "2026-09-10T10:00:00.000Z" })],
    expenses: [makeExpense({ amount: 200, date: "2026-09-05" })],
    previousClosedCycles: [makeClosedCycle("2026-08", 500)],
  });

  assert.equal(result.revenueAfterFees, 2880);
  assert.equal(result.totalExpenses, 200);
  assert.equal(result.netProfitAfterExpenses, 2680);
  assert.equal(result.carriedLossForward, 500);
  assert.equal(result.carriedLossRemaining, 0);
  assert.equal(result.distributableProfit, 2180);
  assert.equal(result.partnerShare, 1090);
  assert.equal(result.ourShare, 1090);
});

test("شهر لا يكفي لتغطية الخسارة", () => {
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-09",
    payments: [makePayment({ finalAmount: 1000, netAmount: 960, completedAt: "2026-09-10T10:00:00.000Z" })],
    expenses: [],
    previousClosedCycles: [makeClosedCycle("2026-08", 1500)],
  });

  assert.equal(result.revenueAfterFees, 960);
  assert.equal(result.netProfitAfterExpenses, 960);
  assert.equal(result.carriedLossForward, 1500);
  assert.equal(result.carriedLossRemaining, 540);
  assert.equal(result.distributableProfit, 0);
  assert.equal(result.partnerShare, 0);
});

test("التحويل الجزئي واستكمال المتبقي", () => {
  const remaining = computeRemainingToTransfer({
    partnerShare: 1000,
    transferredToPartner: 300,
    transfers: [
      { id: "T1", amount: 300, date: "2026-09-10", reference: "REF-1" },
    ],
  });

  assert.equal(remaining, 700);
});

test("منع تكرار التحويل", () => {
  const transfers = [
    { id: "T1", amount: 300, date: "2026-09-10", reference: "REF-1" },
  ];

  assert.equal(isDuplicateTransfer(transfers, "REF-1", 300), true);
  assert.equal(isDuplicateTransfer(transfers, "REF-1", 400), false);
  assert.equal(isDuplicateTransfer(transfers, "", 300), false);
});

test("استبعاد المدفوعات غير المكتملة", () => {
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-08",
    payments: [
      makePayment({ status: "مكتمل", finalAmount: 1000, netAmount: 960 }),
      makePayment({ status: "قيد المراجعة", finalAmount: 1000, netAmount: 960 }),
      makePayment({ status: "فشل", finalAmount: 1000, netAmount: 960 }),
      makePayment({ status: "معلق", finalAmount: 1000, netAmount: 960 }),
    ],
    expenses: [],
    previousClosedCycles: [],
  });

  assert.equal(result.activeSubscriptions, 1);
  assert.equal(result.revenueAfterFees, 960);
  assert.equal(result.partnerShare, 480);
});

test("عدم تغير السجلات التاريخية", () => {
  const historical = makeClosedCycle("2026-07", 200);
  const previous = [historical];

  calculatePartnerProfitMonth({
    monthYear: "2026-08",
    payments: [makePayment({ finalAmount: 2000, netAmount: 1920 })],
    expenses: [],
    previousClosedCycles: previous,
  });

  assert.equal(historical.carriedLossRemaining, 200);
  assert.equal(historical.status, "closed");
});

test("زيادة الخسارة المرحّلة عند خسارة إضافية", () => {
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-09",
    payments: [],
    expenses: [makeExpense({ amount: 300, date: "2026-09-05" })],
    previousClosedCycles: [makeClosedCycle("2026-08", 500)],
  });

  assert.equal(result.carriedLossForward, 500);
  assert.equal(result.carriedLossRemaining, 800);
});

test("Contabilizes completed Apple Pay payment with netAmount and excludes bank transfer with netAmount zero", () => {
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-11",
    payments: [
      // Property 31285: Apple Pay، 40 ريال، رسوم 2.76، صافي 37.24، تاريخ 2026-11-07
      makePayment({
        propertyNumber: "31285",
        amount: 40,
        finalAmount: 40,
        status: "مكتمل",
        paymentMethod: "Apple Pay",
        completedAt: "2026-11-07T10:00:00.000Z",
        netAmount: 37.24,
        totalFees: 2.76,
      }),
      // Property 75699: تحويل بنكي، 40 ريال، صافي معروض صفر، حالة قيد التحقق (غير مكتمل مالياً)
      makePayment({
        propertyNumber: "75699",
        amount: 40,
        finalAmount: 40,
        status: "قيد التحقق",
        paymentMethod: "تحويل بنكي",
        completedAt: "2026-11-07T12:00:00.000Z",
        netAmount: 0,
        totalFees: 0,
      }),
    ],
    expenses: [makeExpense({ amount: 20, date: "2026-11-05" })],
    previousClosedCycles: [],
  });

  assert.equal(result.activeSubscriptions, 1);
  assert.equal(result.totalRevenue, 40);
  assert.equal(result.revenueAfterFees, 37.24);
  assert.equal(result.totalExpenses, 20);
  assert.equal(result.netProfitAfterExpenses, 17.24);
  assert.equal(result.distributableProfit, 17.24);
  assert.equal(result.partnerShare, 8.62);
  assert.equal(result.ourShare, 8.62);
});

test("completed payment with netAmount zero contributes zero to revenueAfterFees", () => {
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-11",
    payments: [
      // دفعة مكتملة ولكن صافيها صفر (كل المبلغ ذهب رسوماً)
      makePayment({
        propertyNumber: "99999",
        amount: 40,
        finalAmount: 40,
        status: "مكتمل",
        paymentMethod: "تحويل بنكي",
        completedAt: "2026-11-07T12:00:00.000Z",
        netAmount: 0,
        totalFees: 0,
      }),
    ],
    expenses: [],
    previousClosedCycles: [],
  });

  assert.equal(result.activeSubscriptions, 1);
  assert.equal(result.totalRevenue, 40);
  assert.equal(result.revenueAfterFees, 0);
  assert.equal(result.netProfitAfterExpenses, 0);
  assert.equal(result.distributableProfit, 0);
  assert.equal(result.partnerShare, 0);
});

test("pending verification statuses are excluded from revenue", () => {
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-11",
    payments: [
      makePayment({
        propertyNumber: "11111",
        amount: 100,
        finalAmount: 100,
        status: "قيد التحقق",
        completedAt: "2026-11-07T10:00:00.000Z",
        netAmount: 90,
      }),
      makePayment({
        propertyNumber: "22222",
        amount: 100,
        finalAmount: 100,
        status: "نجح - قيد التحقق",
        completedAt: "2026-11-07T11:00:00.000Z",
        netAmount: 90,
      }),
      makePayment({
        propertyNumber: "33333",
        amount: 100,
        finalAmount: 100,
        status: "مكتمل",
        completedAt: "2026-11-07T12:00:00.000Z",
        netAmount: 90,
      }),
    ],
    expenses: [],
    previousClosedCycles: [],
  });

  assert.equal(result.activeSubscriptions, 1);
  assert.equal(result.totalRevenue, 100);
  assert.equal(result.revenueAfterFees, 90);
  assert.equal(result.partnerShare, 45);
});
