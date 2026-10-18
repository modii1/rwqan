import { Router } from "express";
import { requireAdmin } from "../middleware";
import { financeService, discountService } from "../../services";
import { firebaseService } from "../../firebaseService";

const router = Router();

// ======================
// 💰 أرباح الشريك (Partner Profits)
// ======================

router.get("/api/admin/partner-profits", async (req, res) => {
  try {
    const profits = await financeService.getPartnerProfits();
    res.json(profits);
  } catch (error) {
    console.error("Error fetching partner profits:", error);
    res.status(500).json({ error: "فشل في جلب أرباح الشريك" });
  }
});

router.get("/api/admin/partner-profits/current", async (req, res) => {
  try {
    const currentProfit = await financeService.calculateMonthlyProfits();
    res.json(currentProfit);
  } catch (error) {
    console.error("Error calculating current profits:", error);
    res.status(500).json({ error: "فشل في حساب الأرباح الحالية" });
  }
});

router.get("/api/admin/partner-profits/summary", async (req, res) => {
  try {
    const summary = await financeService.getProfitsSummary();
    res.json(summary);
  } catch (error) {
    console.error("Error fetching profits summary:", error);
    res.status(500).json({ error: "فشل في جلب ملخص الأرباح" });
  }
});

router.post("/api/admin/partner-profits", async (req, res) => {
  try {
    const profit = await financeService.createPartnerProfit(req.body);
    res.json(profit);
  } catch (error) {
    console.error("Error creating partner profit:", error);
    res.status(500).json({ error: "فشل في إنشاء سجل الأرباح" });
  }
});

router.put("/api/admin/partner-profits/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const profit = await financeService.updatePartnerProfit(id, req.body);
    if (!profit) {
      return res.status(404).json({ error: "سجل الأرباح غير موجود" });
    }
    res.json(profit);
  } catch (error) {
    console.error("Error updating partner profit:", error);
    res.status(500).json({ error: "فشل في تحديث سجل الأرباح" });
  }
});

// ======================
// 🎟️ أكواد الخصم (Discounts)
// ======================

router.get("/api/admin/discounts", async (req, res) => {
  try {
    // Admin sees ALL discounts (active + inactive)
    const { firebaseService } = await import("../../firebaseService");
    const discounts = await firebaseService.getAllDiscountCodes();
    res.json(discounts);
  } catch (error) {
    console.error("Error fetching discounts:", error);
    res.status(500).json({ error: "فشل في جلب أكواد الخصم" });
  }
});

router.post("/api/admin/discounts", async (req, res) => {
  try {
    // تحويل نوع الخصم لتتوافق مع schema
    const discountType = req.body.type === "ثابت" ? "قيمة ثابتة" : req.body.type;
    const discountData = {
      code: req.body.code || "",
      type: discountType,
      value: req.body.value || 0,
      expiryDate: req.body.expiryDate,
      isActive: req.body.isActive !== false,
    };
    const newDiscount = await firebaseService.createDiscountCode(discountData);
    res.json(newDiscount);
  } catch (error) {
    console.error("Error creating discount:", error);
    res.status(500).json({ error: "فشل في إنشاء كود الخصم" });
  }
});

router.put("/api/admin/discounts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    // تحويل نوع الخصم إذا موجود
    const updates: any = { ...req.body };
    if (updates.type === "ثابت") {
      updates.type = "قيمة ثابتة";
    }
    const updated = await discountService.update(id, updates);
    if (!updated) {
      return res.status(404).json({ error: "كود الخصم غير موجود" });
    }
    res.json(updated);
  } catch (error) {
    console.error("Error updating discount:", error);
    res.status(500).json({ error: "فشل في تحديث كود الخصم" });
  }
});

router.delete("/api/admin/discounts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await firebaseService.deleteDiscountCode(id);
    res.json({ success: true, message: "تم حذف كود الخصم بنجاح" });
  } catch (error) {
    console.error("Error deleting discount:", error);
    res.status(500).json({ error: "فشل في حذف كود الخصم" });
  }
});

// ======================
// 💰 إدارة الاسترجاعات (في الذاكرة المؤقتة)
// ======================
const refundsStore: any[] = [];

router.get("/api/admin/refunds", async (req, res) => {
  try {
    res.json(refundsStore);
  } catch (error) {
    console.error("Error fetching refunds:", error);
    res.status(500).json({ error: "فشل في جلب الاسترجاعات" });
  }
});

router.post("/api/admin/refunds", async (req, res) => {
  try {
    const { paymentId, refundAmount, reason } = req.body;
    if (!paymentId || !refundAmount) {
      return res.status(400).json({ error: "paymentId و refundAmount مطلوبين" });
    }
    const refund = {
      id: Math.random().toString(36).substr(2, 9),
      paymentId,
      propertyNumber: "",
      refundAmount,
      reason: reason || "",
      status: "معلق",
      createdAt: new Date().toISOString(),
    };
    refundsStore.push(refund);
    res.json(refund);
  } catch (error) {
    console.error("Error creating refund:", error);
    res.status(500).json({ error: "فشل في إنشاء الاسترجاع" });
  }
});

router.put("/api/admin/refunds/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const index = refundsStore.findIndex(r => r.id === id);
    if (index === -1) {
      return res.status(404).json({ error: "الاسترجاع غير موجود" });
    }
    refundsStore[index] = { ...refundsStore[index], ...req.body };
    res.json(refundsStore[index]);
  } catch (error) {
    console.error("Error updating refund:", error);
    res.status(500).json({ error: "فشل في تحديث الاسترجاع" });
  }
});

router.delete("/api/admin/refunds/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const index = refundsStore.findIndex(r => r.id === id);
    if (index !== -1) {
      refundsStore.splice(index, 1);
    }
    res.json({ success: true, message: "تم حذف الاسترجاع بنجاح" });
  } catch (error) {
    console.error("Error deleting refund:", error);
    res.status(500).json({ error: "فشل في حذف الاسترجاع" });
  }
});

// ======================
// ⚙️ إعدادات الرسوم (Fee Configs)
// ======================

router.get("/api/admin/fee-configs", async (req, res) => {
  try {
    const configs = await financeService.getFeeConfigs();
    res.json(configs);
  } catch (error: any) {
    console.error("Error fetching fee configs:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/admin/fee-configs", async (req, res) => {
  try {
    const config = await firebaseService.createFeeConfig(req.body);
    res.json(config);
  } catch (error: any) {
    console.error("Error creating fee config:", error);
    res.status(500).json({ error: error.message });
  }
});

router.put("/api/admin/fee-configs/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const config = await firebaseService.updateFeeConfig(id, req.body);
    if (!config) {
      return res.status(404).json({ error: "إعدادات الرسوم غير موجودة" });
    }
    res.json(config);
  } catch (error: any) {
    console.error("Error updating fee config:", error);
    res.status(500).json({ error: error.message });
  }
});

router.delete("/api/admin/fee-configs/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await firebaseService.deleteFeeConfig(id);
    res.json({ success: true, message: "تم حذف إعدادات الرسوم بنجاح" });
  } catch (error: any) {
    console.error("Error deleting fee config:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/admin/fee-configs/initialize", async (req, res) => {
  try {
    await firebaseService.initializeFeeConfigs();
    res.json({ success: true, message: "تم تهيئة إعدادات الرسوم الافتراضية" });
  } catch (error: any) {
    console.error("Error initializing fee configs:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/admin/fee-configs/remove-duplicates", async (req, res) => {
  try {
    const result = await firebaseService.removeDuplicateFeeConfigs();
    res.json({
      success: true,
      message: `تم حذف ${result.removed} سجل مكرر`,
      ...result
    });
  } catch (error: any) {
    console.error("Error removing duplicate fee configs:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/admin/calculate-fees", async (req, res) => {
  try {
    const { amount, paymentMethod, cardType, useConfigs } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "المبلغ مطلوب ويجب أن يكون أكبر من 0" });
    }

    let fees;
    if (useConfigs) {
      fees = await firebaseService.calculatePaymentFeesFromConfigs(amount, paymentMethod, cardType);
    } else {
      fees = firebaseService.calculatePaymentFees(amount, paymentMethod, cardType);
    }

    res.json(fees);
  } catch (error: any) {
    console.error("Error calculating fees:", error);
    res.status(500).json({ error: error.message });
  }
});

// ======================
// 💵 التكاليف/المصاريف (Expenses)
// ======================

router.get("/api/admin/expenses", async (req, res) => {
  try {
    const expenses = await financeService.getExpenses();
    res.json(expenses);
  } catch (error: any) {
    console.error("Error fetching expenses:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/admin/expenses/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const expense = await firebaseService.getExpenseById(id);
    if (!expense) {
      return res.status(404).json({ error: "التكلفة غير موجودة" });
    }
    res.json(expense);
  } catch (error: any) {
    console.error("Error fetching expense:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/api/admin/expenses", async (req, res) => {
  try {
    const { title, amount, category, description, date } = req.body;

    if (!title || !amount || !date) {
      return res.status(400).json({ error: "العنوان والمبلغ والتاريخ مطلوبة" });
    }

    const expense = await financeService.createExpense({
      title,
      amount: parseFloat(amount),
      category: (category as any) || "أخرى",
      description,
      date,
      expenseType: "مرة واحدة",
      isActive: true,
    });
    res.json(expense);
  } catch (error: any) {
    console.error("Error creating expense:", error);
    res.status(500).json({ error: error.message });
  }
});

router.put("/api/admin/expenses/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    if (updates.amount) {
      updates.amount = parseFloat(updates.amount);
    }

    const expense = await firebaseService.updateExpense(id, updates);
    if (!expense) {
      return res.status(404).json({ error: "التكلفة غير موجودة" });
    }
    res.json(expense);
  } catch (error: any) {
    console.error("Error updating expense:", error);
    res.status(500).json({ error: error.message });
  }
});

router.delete("/api/admin/expenses/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await firebaseService.deleteExpense(id);
    res.json({ success: true, message: "تم حذف التكلفة بنجاح" });
  } catch (error: any) {
    console.error("Error deleting expense:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/api/admin/expenses/total", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const total = await firebaseService.getTotalExpenses(
      startDate as string | undefined,
      endDate as string | undefined
    );
    res.json({ total });
  } catch (error: any) {
    console.error("Error calculating total expenses:", error);
    res.status(500).json({ error: error.message });
  }
});

// =======================================
// 💱 تحويل العملات (Currency Conversion)
// =======================================

// الحصول على سعر الصرف الحالي USD → SAR
router.get("/api/currency/rate", async (req, res) => {
  try {
    // استخدام Frankfurter API (مجاني بدون مفتاح)
    const response = await fetch('https://api.frankfurter.dev/v1/latest?base=USD&symbols=SAR');
    if (!response.ok) {
      throw new Error('Failed to fetch exchange rate');
    }
    const data = await response.json();
    const rate = data.rates?.SAR || 3.75; // سعر احتياطي

    res.json({
      base: 'USD',
      target: 'SAR',
      rate,
      date: data.date || new Date().toISOString().split('T')[0],
      source: 'Frankfurter API'
    });
  } catch (error: any) {
    console.error("Error fetching exchange rate:", error);
    // إرجاع سعر احتياطي
    res.json({
      base: 'USD',
      target: 'SAR',
      rate: 3.75,
      date: new Date().toISOString().split('T')[0],
      source: 'fallback',
      error: error.message
    });
  }
});

const ISO_CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

function normalizeCurrencyCode(value: unknown, fallback: string): string {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return ISO_CURRENCY_CODE_PATTERN.test(code) ? code : fallback;
}

// تحويل مبلغ من USD إلى SAR
router.post("/api/currency/convert", async (req, res) => {
  try {
    const { amount } = req.body;
    const baseCurrency = typeof req.body.from === "string"
      ? req.body.from.trim().toUpperCase()
      : "USD";
    const quoteCurrency = typeof req.body.to === "string"
      ? req.body.to.trim().toUpperCase()
      : "SAR";

    if (!amount || isNaN(parseFloat(amount))) {
      return res.status(400).json({ error: "المبلغ مطلوب ويجب أن يكون رقماً" });
    }

    if (!ISO_CURRENCY_CODE_PATTERN.test(baseCurrency) || !ISO_CURRENCY_CODE_PATTERN.test(quoteCurrency)) {
      return res.status(400).json({ error: "رمز العملة غير صحيح" });
    }

    // استخدام Frankfurter API
    const response = await fetch(`https://api.frankfurter.dev/v1/latest?base=${baseCurrency}&symbols=${quoteCurrency}`);
    let rate = 3.75; // سعر احتياطي

    if (response.ok) {
      const data = await response.json();
      rate = data.rates?.[quoteCurrency] || 3.75;
    }

    const convertedAmount = parseFloat(amount) * rate;

    res.json({
      originalAmount: parseFloat(amount),
      originalCurrency: baseCurrency,
      convertedAmount: Math.round(convertedAmount * 100) / 100,
      targetCurrency: quoteCurrency,
      rate,
      date: new Date().toISOString().split('T')[0]
    });
  } catch (error: any) {
    console.error("Error converting currency:", error);
    // تحويل بسعر احتياطي
    const amount = parseFloat(req.body.amount) || 0;
    res.json({
      originalAmount: amount,
      originalCurrency: normalizeCurrencyCode(req.body.from, 'USD'),
      convertedAmount: Math.round(amount * 3.75 * 100) / 100,
      targetCurrency: normalizeCurrencyCode(req.body.to, 'SAR'),
      rate: 3.75,
      date: new Date().toISOString().split('T')[0],
      source: 'fallback'
    });
  }
});

export default router;
