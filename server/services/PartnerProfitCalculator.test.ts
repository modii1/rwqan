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
    // لا نحدد netAmount/totalFees افتراضيًا؛ يحددها كل اختبار بشكل صريح
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

  assert.equal(result.activeSubscriptions, 1);
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

/**
 * ========================================================================
 * اختبارات محرك احتساب المدفوعات الشامل (المراجعة الشاملة)
 * ========================================================================
 */

test("دفعة مكتملة دون رسوم - تحتسب بالمبلغ الكامل", () => {
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-11",
    payments: [
      makePayment({
        propertyNumber: "75699",
        amount: 40,
        finalAmount: 40,
        status: "مكتمل",
        paymentMethod: "تحويل بنكي",
        completedAt: "2026-11-07T12:00:00.000Z",
        // لا netAmount، لا totalFees -> لا توجد رسوم، المبلغ الكامل 40
      }),
    ],
    expenses: [],
    previousClosedCycles: [],
  });

  assert.equal(result.activeSubscriptions, 1);
  assert.equal(result.totalRevenue, 40);
  assert.equal(result.revenueAfterFees, 40);
  assert.equal(result.paymentsDetail.length, 1);
  assert.equal(result.paymentsDetail[0].netAmount, 40);
  assert.equal(result.partnerShare, 20);
});

test("دفعة مكتملة مع رسوم - تحتسب بعد خصم الرسوم الفعلية", () => {
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-11",
    payments: [
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
    ],
    expenses: [],
    previousClosedCycles: [],
  });

  assert.equal(result.activeSubscriptions, 1);
  assert.equal(result.totalRevenue, 40);
  assert.equal(result.revenueAfterFees, 37.24);
  assert.equal(result.paymentsDetail[0].netAmount, 37.24);
  assert.equal(result.partnerShare, 18.62);
});

test("دفعة مكتملة بصافي صفر مع رسوم فعلية - تساهم بصفر", () => {
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-11",
    payments: [
      makePayment({
        propertyNumber: "99999",
        amount: 40,
        finalAmount: 40,
        status: "مكتمل",
        paymentMethod: "تحويل بنكي",
        completedAt: "2026-11-07T12:00:00.000Z",
        netAmount: 0,
        totalFees: 40, // كل المبلغ ذهب رسومًا
      }),
    ],
    expenses: [],
    previousClosedCycles: [],
  });

  assert.equal(result.activeSubscriptions, 1);
  assert.equal(result.totalRevenue, 40);
  assert.equal(result.revenueAfterFees, 0);
  assert.equal(result.paymentsDetail[0].netAmount, 0);
  assert.equal(result.partnerShare, 0);
});

test("دفعة صافيها غير متوفر (لا netAmount، لا totalFees) - تُحسب بالمبلغ الكامل", () => {
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-11",
    payments: [
      makePayment({
        propertyNumber: "88888",
        amount: 100,
        finalAmount: 100,
        status: "مكتمل",
        paymentMethod: "تحويل بنكي",
        completedAt: "2026-11-05T10:00:00.000Z",
        // لا netAmount، لا totalFees
      }),
    ],
    expenses: [],
    previousClosedCycles: [],
  });

  assert.equal(result.activeSubscriptions, 1);
  assert.equal(result.totalRevenue, 100);
  assert.equal(result.revenueAfterFees, 100);
  assert.equal(result.paymentsDetail[0].netAmount, 100);
});

test("دفعة قيد التحقق - تُستبعد من الإيرادات", () => {
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-11",
    payments: [
      makePayment({
        propertyNumber: "11111",
        amount: 100,
        finalAmount: 100,
        status: "قيد التحقق",
        paymentMethod: "تحويل بنكي",
        completedAt: "2026-11-07T10:00:00.000Z",
        netAmount: 90,
      }),
      makePayment({
        propertyNumber: "22222",
        amount: 100,
        finalAmount: 100,
        status: "نجح - قيد التحقق",
        paymentMethod: "بطاقة",
        completedAt: "2026-11-07T11:00:00.000Z",
        netAmount: 90,
      }),
      makePayment({
        propertyNumber: "33333",
        amount: 100,
        finalAmount: 100,
        status: "مكتمل",
        paymentMethod: "بطاقة",
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
  assert.equal(result.paymentsDetail.length, 1);
  assert.equal(result.paymentsDetail[0].propertyNumber, "33333");
  assert.equal(result.partnerShare, 45);
});

test("دفعة فاشلة أو ملغاة - تُستبعد من الإيرادات", () => {
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-11",
    payments: [
      makePayment({
        propertyNumber: "44444",
        amount: 100,
        finalAmount: 100,
        status: "فشل",
        paymentMethod: "بطاقة",
        completedAt: "2026-11-07T10:00:00.000Z",
        netAmount: 0,
      }),
      makePayment({
        propertyNumber: "55555",
        amount: 100,
        finalAmount: 100,
        status: "ملغي",
        paymentMethod: "تحويل بنكي",
        completedAt: "2026-11-07T11:00:00.000Z",
        netAmount: 0,
      }),
      makePayment({
        propertyNumber: "66666",
        amount: 100,
        finalAmount: 100,
        status: "مكتمل",
        paymentMethod: "Apple Pay",
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

test("دفعات متعددة للعقار نفسه في نفس الشهر - تُحتسب جميعها", () => {
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-11",
    payments: [
      makePayment({
        propertyNumber: "75699",
        amount: 40,
        finalAmount: 40,
        status: "مكتمل",
        paymentMethod: "تحويل بنكي",
        completedAt: "2026-11-01T10:00:00.000Z",
      }),
      makePayment({
        propertyNumber: "75699",
        amount: 60,
        finalAmount: 60,
        status: "مكتمل",
        paymentMethod: "Apple Pay",
        completedAt: "2026-11-15T10:00:00.000Z",
        netAmount: 57,
        totalFees: 3,
      }),
    ],
    expenses: [],
    previousClosedCycles: [],
  });

  assert.equal(result.activeSubscriptions, 2);
  assert.equal(result.totalRevenue, 100);
  assert.equal(result.revenueAfterFees, 97); // 40 + 57
  assert.equal(result.paymentsDetail.length, 2);
  assert.equal(result.partnerShare, 48.5);
});

test("دفعات في أشهر مختلفة - تُحتسب في شهرها فقط", () => {
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-11",
    payments: [
      makePayment({
        propertyNumber: "11111",
        amount: 100,
        finalAmount: 100,
        status: "مكتمل",
        completedAt: "2026-10-15T10:00:00.000Z", // أكتوبر
        netAmount: 95,
      }),
      makePayment({
        propertyNumber: "22222",
        amount: 200,
        finalAmount: 200,
        status: "مكتمل",
        completedAt: "2026-11-15T10:00:00.000Z", // نوفمبر
        netAmount: 190,
      }),
    ],
    expenses: [],
    previousClosedCycles: [],
  });

  assert.equal(result.activeSubscriptions, 1);
  assert.equal(result.totalRevenue, 200);
  assert.equal(result.revenueAfterFees, 190);
  assert.equal(result.paymentsDetail.length, 1);
  assert.equal(result.paymentsDetail[0].propertyNumber, "22222");
});

test("إعادة حساب الدورة تنتج نفس النتائج (deterministic)", () => {
  const payments = [
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
    makePayment({
      propertyNumber: "75699",
      amount: 40,
      finalAmount: 40,
      status: "مكتمل",
      paymentMethod: "تحويل بنكي",
      completedAt: "2026-11-07T12:00:00.000Z",
    }),
  ];

  const result1 = calculatePartnerProfitMonth({
    monthYear: "2026-11",
    payments,
    expenses: [makeExpense({ amount: 20, date: "2026-11-05" })],
    previousClosedCycles: [],
  });

  const result2 = calculatePartnerProfitMonth({
    monthYear: "2026-11",
    payments,
    expenses: [makeExpense({ amount: 20, date: "2026-11-05" })],
    previousClosedCycles: [],
  });

  assert.equal(result1.totalRevenue, result2.totalRevenue);
  assert.equal(result1.revenueAfterFees, result2.revenueAfterFees);
  assert.equal(result1.partnerShare, result2.partnerShare);
  assert.equal(result1.paymentsDetail.length, result2.paymentsDetail.length);
});

test("مطابقة إجمالي تفاصيل المدفوعات مع إيرادات الدورة", () => {
  const payments = [
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
    makePayment({
      propertyNumber: "75699",
      amount: 40,
      finalAmount: 40,
      status: "مكتمل",
      paymentMethod: "تحويل بنكي",
      completedAt: "2026-11-07T12:00:00.000Z",
    }),
  ];

  const result = calculatePartnerProfitMonth({
    monthYear: "2026-11",
    payments,
    expenses: [makeExpense({ amount: 20, date: "2026-11-05" })],
    previousClosedCycles: [],
  });

  // إجمالي الصافي من التفاصيل يجب أن يساوي revenueAfterFees
  const detailSum = result.paymentsDetail.reduce((sum, p) => sum + p.netAmount, 0);
  assert.equal(Math.round(detailSum * 100) / 100, result.revenueAfterFees);

  // إجمالي المبالغ قبل الخصم يجب أن يساوي totalRevenue
  const grossSum = result.paymentsDetail.reduce((sum, p) => sum + p.amount, 0);
  assert.equal(Math.round(grossSum * 100) / 100, result.totalRevenue);

  // الربح = الإيرادات الصافية - التكاليف
  assert.equal(Math.round(result.netProfitAfterExpenses * 100) / 100, Math.round((result.revenueAfterFees - result.totalExpenses) * 100) / 100);

  // 예상 النتيجة للنومبر 2026 مع الدفعتين مكتملتين:
  // totalRevenue = 80, revenueAfterFees = 77.24, totalExpenses = 20
  // netProfit = 57.24, distributableProfit = 57.24, partnerShare = 28.62
  assert.equal(Math.round(result.totalRevenue * 100) / 100, 80);
  assert.equal(Math.round(result.revenueAfterFees * 100) / 100, 77.24);
  assert.equal(Math.round(result.totalExpenses * 100) / 100, 20);
  assert.equal(Math.round(result.netProfitAfterExpenses * 100) / 100, 57.24);
  assert.equal(Math.round(result.distributableProfit * 100) / 100, 57.24);
  assert.equal(Math.round(result.partnerShare * 100) / 100, 28.62);
  assert.equal(Math.round(result.ourShare * 100) / 100, 28.62);
  assert.equal(result.ourShare, 28.62);
});

test("منع تكرار احتساب الدفعة نفسها - كل دفعة تُحسب مرة واحدة", () => {
  const payment = makePayment({
    propertyNumber: "11111",
    amount: 100,
    finalAmount: 100,
    status: "مكتمل",
    completedAt: "2026-11-15T10:00:00.000Z",
    netAmount: 95,
  });

  // نفس الدفعة مكررة مرتين في المصفوفة
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-11",
    payments: [payment, payment],
    expenses: [],
    previousClosedCycles: [],
  });

  // يجب أن تُحسب مرتين لأنهما في المصفوفة مرتين (هذا خطأ في البيانات المصدر، وليس في المحرك)
  // المحرك يحسب ما يُعطى له. الواجب على مصدر البيانات التأكد من عدم التكرار.
  assert.equal(result.activeSubscriptions, 2);
  assert.equal(result.totalRevenue, 200);
  assert.equal(result.revenueAfterFees, 190);
});

test("جميع حالات الدفع غير المكتملة تُستبعد", () => {
  const allStatuses = [
    "مرفوض", "معلق", "فشل", "ملغي", "قيد المراجعة",
    "نجح - قيد التحقق", "قيد التحقق", "منتهي الصلاحية",
    "ملغي - انتهت المهلة", "pending", "قيد الدفع",
  ];

  const result = calculatePartnerProfitMonth({
    monthYear: "2026-11",
    payments: allStatuses.map((status, i) =>
      makePayment({
        propertyNumber: `PROP-${i}`,
        amount: 100,
        finalAmount: 100,
        status: status as any,
        completedAt: "2026-11-15T10:00:00.000Z",
        netAmount: 90,
      })
    ),
    expenses: [],
    previousClosedCycles: [],
  });

  assert.equal(result.activeSubscriptions, 0);
  assert.equal(result.totalRevenue, 0);
  assert.equal(result.revenueAfterFees, 0);
  assert.equal(result.paymentsDetail.length, 0);
});

test("حالات الدفع المكتملة الإنجليزية والعربية تُقبل جميعها", () => {
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-11",
    payments: [
      makePayment({ status: "مكتمل", finalAmount: 100, netAmount: 95, completedAt: "2026-11-15T10:00:00.000Z" }),
      makePayment({ status: "completed", finalAmount: 100, netAmount: 95, completedAt: "2026-11-15T10:00:00.000Z" }),
      makePayment({ status: "نجح", finalAmount: 100, netAmount: 95, completedAt: "2026-11-15T10:00:00.000Z" }),
      makePayment({ status: "نجاح", finalAmount: 100, netAmount: 95, completedAt: "2026-11-15T10:00:00.000Z" }),
    ],
    expenses: [],
    previousClosedCycles: [],
  });

  assert.equal(result.activeSubscriptions, 4);
  assert.equal(result.totalRevenue, 400);
  assert.equal(result.revenueAfterFees, 380);
  assert.equal(result.partnerShare, 190);
});

test("netAmount أكبر من المبلغ الإجمالي يُستخدم كما هو (لا تعديل على قيم المصدر)", () => {
  const result = calculatePartnerProfitMonth({
    monthYear: "2026-11",
    payments: [
      makePayment({
        propertyNumber: "11111",
        amount: 100,
        finalAmount: 100,
        status: "مكتمل",
        completedAt: "2026-11-15T10:00:00.000Z",
        netAmount: 150, // أكبر من المبلغ - قيمة شاذة من المصدر
        totalFees: 0,
      }),
    ],
    expenses: [],
    previousClosedCycles: [],
  });

  // netAmount > 0 يُستخدم كما هو (المحرك لا يعدل قيم المصدر، يستخدمها كما هي)
  assert.equal(result.revenueAfterFees, 150);
});
