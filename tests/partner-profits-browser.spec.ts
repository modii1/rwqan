import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:5001";

async function adminLogin(page: any) {
  const adminCode = process.env.ADMIN_CODE || "0000";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin";
  await page.goto(`${BASE_URL}/owner/login`, { waitUntil: "networkidle", timeout: 30000 });
  await page.click('text=المسؤول');
  await page.waitForSelector('[data-testid="auth-panel-admin"]', { timeout: 10000 });
  await page.fill('[data-testid="input-admin-code"]', adminCode);
  await page.fill('[data-testid="input-admin-password"]', adminPassword);
  await page.click('[data-testid="button-admin-login"]');
  await page.waitForURL(/\/admin/, { timeout: 30000 });
}

function getUniqueTestMonth(offset = 0): string {
  // Use a far-future year and vary the month every minute to avoid collisions with previous test runs.
  const month = String(((new Date().getMinutes() + offset) % 12) + 1).padStart(2, "0");
  return `2050-${month}`;
}

async function createTestProfitCycle(page: any, monthYear: string): Promise<string | null> {
  const payload = {
    monthYear,
    activeSubscriptions: 1,
    totalRevenue: 200,
    revenueAfterFees: 200,
    totalExpenses: 0,
    netProfitAfterExpenses: 200,
    carriedLossForward: 0,
    carriedLossRemaining: 0,
    distributableProfit: 200,
    partnerShare: 100,
    partnerPercentage: 50,
    ourShare: 100,
    owedToPartner: 100,
    transferredToPartner: 0,
    remainingToTransfer: 100,
    transfers: [],
    transferStatus: "pending",
    status: "pending_review",
    notes: "سجل اختبار للتحقق من التحويلات",
  };
  try {
    const res = await page.request.post(`${BASE_URL}/api/admin/partner-profits`, {
      headers: { "Content-Type": "application/json", Origin: BASE_URL },
      data: payload,
    });
    if (!res.ok()) return null;
    const data = await res.json();
    return data.id;
  } catch {
    return null;
  }
}

test("partner profits page loads and buttons respond", async ({ page }) => {
  await adminLogin(page);

  // Create an isolated test cycle with a positive partner share via API.
  const transferTestMonth = getUniqueTestMonth(0);
  const transferTestId = await createTestProfitCycle(page, transferTestMonth);
  expect(transferTestId).not.toBeNull();

  await page.goto(`${BASE_URL}/admin/partner-profits`);
  await page.waitForLoadState("networkidle");

  // Verify page title and main sections
  await expect(page.locator('text=الدورة الحالية')).toBeVisible();
  await expect(page.locator('text=سجل الدورات الشهرية')).toBeVisible();
  await expect(page.locator('text=إدارة التكاليف والمصروفات')).toBeVisible();

  // 1. Prepare a manual cycle for a guaranteed unique month
  const uniqueMonth = getUniqueTestMonth(1);
  await page.locator('[data-testid="button-add-profit"]').click();
  await page.waitForSelector('[data-testid="input-manual-month"]');
  await page.fill('[data-testid="input-manual-month"]', uniqueMonth);
  await page.click('[data-testid="button-submit-manual"]');
  await expect(page.locator('[role="status"]:has-text("تم تجهيز الدورة اليدوية")')).toBeVisible({ timeout: 10000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // 2. Refresh profits list and locate the new row
  await page.locator('[data-testid="button-refresh-profits"]').click();
  await page.waitForTimeout(500);
  const newRow = page.locator('[data-testid^="cycle-row-"]').filter({ hasText: uniqueMonth }).first();
  await expect(newRow).toBeVisible();

  // 3. Expand the newly created cycle
  await newRow.locator('[data-testid^="cycle-header-"]').click();
  await page.waitForTimeout(800);

  // 4. Edit notes
  await newRow.locator('button:has-text("تعديل ملاحظات")').click();
  await page.waitForSelector('textarea');
  await page.fill('textarea', "ملاحظة اختبار");
  await page.locator('button:has-text("حفظ")').first().click();
  await expect(page.locator('[role="status"]:has-text("تم تحديث الملاحظات")')).toBeVisible({ timeout: 10000 });

  // 5. Close cycle
  await newRow.locator('button:has-text("إقفال")').click();
  await expect(page.locator('[role="status"]:has-text("تم إقفال الدورة")')).toBeVisible({ timeout: 10000 });

  // 6. Verify transfer button hidden after close
  await expect(newRow.locator('button:has-text("تسجيل تحويل")')).not.toBeVisible();

  // 7. Toggle payments list
  await page.locator('text=مدفوعات الشهر الحالي').locator('xpath=../..').locator('button:has-text("عرض")').click();
  await expect(page.locator('text=لا توجد مدفوعات مكتملة في هذا الشهر')).toBeVisible();
  await page.locator('text=مدفوعات الشهر الحالي').locator('xpath=../..').locator('button:has-text("إخفاء")').click();

  // 8. Record a partial transfer on the isolated test cycle
  const testCycleRow = page.locator('[data-testid^="cycle-row-"]').filter({ hasText: transferTestMonth }).first();
  await testCycleRow.locator('[data-testid^="cycle-header-"]').click();
  await page.waitForTimeout(500);
  await testCycleRow.locator('button:has-text("تسجيل تحويل")').click();
  await page.waitForSelector('[data-testid="input-transfer-amount"]');
  await page.fill('[data-testid="input-transfer-amount"]', "10");
  await page.fill('[data-testid="input-transfer-reference"]', "BROWSER-TEST-1");
  await page.click('[data-testid="button-submit-transfer"]');
  await expect(page.locator('[role="status"]:has-text("تم تسجيل التحويل")')).toBeVisible({ timeout: 10000 });

  // 9. Add expense dialog open/cancel
  await page.locator('[data-testid="button-add-expense"]').click();
  await expect(page.locator('text=إضافة تكلفة جديدة')).toBeVisible();
  await page.fill('[data-testid="input-expense-title"]', "تكلفة اختبار");
  await page.fill('[data-testid="input-expense-amount"]', "50");
  await page.locator('button:has-text("إلغاء")').first().click();
  await expect(page.locator('text=إضافة تكلفة جديدة')).not.toBeVisible();
});
