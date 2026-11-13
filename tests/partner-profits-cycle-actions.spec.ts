import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:5001";

async function adminLogin(page: any) {
  const adminCode = process.env.ADMIN_CODE || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "123";
  await page.goto(`${BASE_URL}/owner/login`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });
  await page.click('[data-testid="auth-role-admin"]');
  await page.waitForSelector('[data-testid="auth-panel-admin"]', { timeout: 10000 });
  await page.fill('[data-testid="input-admin-code"]', adminCode);
  await page.fill('[data-testid="input-admin-password"]', adminPassword);
  await page.click('[data-testid="button-admin-login"]');
  await page.waitForURL(/\/admin/, { timeout: 60000 });
}

async function ensureTestEnvironment(page: any) {
  const status = await page.evaluate(async () => {
    const res = await fetch("/api/admin/live/environment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environment: "TEST" }),
    });
    return res.status;
  });
  expect(status).toBe(200);
}

async function apiJson(page: any, method: string, url: string, body?: unknown) {
  return page.evaluate(
    async (args: { method: string; url: string; body?: unknown }) => {
      const res = await fetch(args.url, {
        method: args.method,
        headers: args.body ? { "Content-Type": "application/json" } : {},
        body: args.body ? JSON.stringify(args.body) : undefined,
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      return { status: res.status, body: json };
    },
    { method, url, body }
  );
}

async function deleteCyclesForMonth(page: any, monthYear: string) {
  const list = await apiJson(page, "GET", "/api/admin/partner-profits");
  if (!Array.isArray(list.body)) return;
  const matches = list.body.filter(
    (cycle: any) => String(cycle.monthYear).replace("/", "-") === monthYear
  );
  for (const cycle of matches) {
    await apiJson(page, "DELETE", `/api/admin/partner-profits/${cycle.id}`);
  }
}

async function getCycleForMonth(page: any, monthYear: string) {
  const list = await apiJson(page, "GET", "/api/admin/partner-profits");
  if (!Array.isArray(list.body)) return null;
  return (
    list.body.find(
      (cycle: any) => String(cycle.monthYear).replace("/", "-") === monthYear
    ) || null
  );
}

function parseMetric(text: string | null): number {
  if (!text) return NaN;
  const match = text.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : NaN;
}

test("إعادة حساب الدورة من واجهة TEST تعرض القيم وتطابق API دون تكرار", async ({ page }) => {
  await adminLogin(page);
  await ensureTestEnvironment(page);
  await page.goto(`${BASE_URL}/admin/partner-profits`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });

  await expect(page.getByText("إيرادات الشهر (صافي)")).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("environment-badge-current")).toHaveText(/TEST/);

  // Recalculate the current November 2026 cycle from the UI.
  const recalcButton = page.getByTestId("button-prepare-current");
  await expect(recalcButton).toBeEnabled();
  await recalcButton.click();

  await expect(page.getByTestId("recalc-result")).toBeVisible({ timeout: 30000 });
  const resultText = await page.getByTestId("recalc-result").innerText();
  expect(resultText).toContain("TEST");
  expect(resultText).toContain("2026-11");

  // API values after the UI operation.
  const cycle = await getCycleForMonth(page, "2026-11");
  expect(cycle).toBeTruthy();
  expect(cycle.revenueAfterFees).toBeCloseTo(77.24, 2);
  expect(cycle.totalExpenses).toBeCloseTo(20, 2);
  expect(cycle.netProfitAfterExpenses).toBeCloseTo(57.24, 2);
  expect(cycle.partnerShare).toBeCloseTo(28.62, 2);
  expect(cycle.status).toBe("pending_review");

  // No duplicate cycles for the same month.
  const list = await apiJson(page, "GET", "/api/admin/partner-profits");
  const sameMonth = list.body.filter(
    (c: any) => String(c.monthYear).replace("/", "-") === "2026-11"
  );
  expect(sameMonth).toHaveLength(1);

  // UI matches the API after the operation.
  const revenueText = await page
    .locator("span", { hasText: "إيرادات الشهر (صافي)" })
    .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]/p")
    .first()
    .textContent();
  const profitText = await page
    .locator("span", { hasText: "صافي نتيجة الشهر" })
    .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]/p")
    .first()
    .textContent();
  const partnerShareText = await page
    .locator("span", { hasText: "حصة الشريك (50%)" })
    .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]/p")
    .first()
    .textContent();

  expect(parseMetric(revenueText)).toBeCloseTo(cycle.revenueAfterFees, 2);
  expect(parseMetric(profitText)).toBeCloseTo(cycle.netProfitAfterExpenses, 2);
  expect(parseMetric(partnerShareText)).toBeCloseTo(cycle.partnerShare, 2);

  await page.screenshot({ path: "partner-profits-recalc-verified.png", fullPage: true });
});

test("حذف دورة اختبارية غير مقفلة من واجهة TEST يحذف الدورة فقط", async ({ page }) => {
  const testMonth = "2099-03";

  await adminLogin(page);
  await ensureTestEnvironment(page);

  // Clean any leftover fixture, then create a fresh derived cycle with no
  // payments, expenses, or transfers.
  await deleteCyclesForMonth(page, testMonth);
  const created = await apiJson(page, "POST", "/api/admin/partner-profits/prepare", {
    monthYear: testMonth,
  });
  expect(created.status).toBe(200);
  const cycleId = created.body.id as string;
  expect(cycleId).toBeTruthy();

  // Snapshot unrelated data so we can prove the delete only removed the cycle.
  const paymentsBefore = await apiJson(page, "GET", "/api/admin/payments");
  const expensesBefore = await apiJson(page, "GET", "/api/admin/expenses");
  const currentCycleBefore = await getCycleForMonth(page, "2026-11");

  await page.goto(`${BASE_URL}/admin/partner-profits`, {
    waitUntil: "networkidle",
    timeout: 60000,
  });

  const row = page.getByTestId(`cycle-row-${cycleId}`);
  await expect(row).toBeVisible({ timeout: 30000 });
  await page.getByTestId(`cycle-header-${cycleId}`).click();

  const deleteButton = page.getByTestId(`button-delete-${cycleId}`);
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();

  const dialog = page.getByTestId("dialog-delete-cycle");
  await expect(dialog).toBeVisible();
  const dialogText = await dialog.innerText();
  expect(dialogText).toContain(testMonth);
  expect(dialogText).toContain("TEST");
  expect(dialogText).toContain(cycleId);
  expect(dialogText).toContain("لن يتم حذف المدفوعات");

  await page.getByTestId("button-confirm-delete").click();
  await expect(page.getByTestId(`cycle-row-${cycleId}`)).toHaveCount(0, {
    timeout: 30000,
  });

  // The cycle is gone from the API.
  const after = await apiJson(page, "GET", "/api/admin/partner-profits");
  expect(
    after.body.some((cycle: any) => cycle.id === cycleId)
  ).toBe(false);

  // Payments, expenses, and the other cycle are untouched.
  const paymentsAfter = await apiJson(page, "GET", "/api/admin/payments");
  const expensesAfter = await apiJson(page, "GET", "/api/admin/expenses");
  expect(paymentsAfter.body.length).toBe(paymentsBefore.body.length);
  expect(expensesAfter.body.length).toBe(expensesBefore.body.length);

  const currentCycleAfter = await getCycleForMonth(page, "2026-11");
  expect(currentCycleAfter?.id).toBe(currentCycleBefore?.id);

  // Cleaning up the fixture is a no-op now (it is already deleted).
  await deleteCyclesForMonth(page, testMonth);

  await page.screenshot({ path: "partner-profits-delete-verified.png", fullPage: true });
});
