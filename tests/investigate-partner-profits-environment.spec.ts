import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:5001";

async function adminLogin(page: any) {
  const adminCode = process.env.ADMIN_CODE || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "123";
  await page.goto(`${BASE_URL}/owner/login`, { waitUntil: "networkidle", timeout: 60000 });
  await page.click('[data-testid="auth-role-admin"]');
  await page.waitForSelector('[data-testid="auth-panel-admin"]', { timeout: 10000 });
  await page.fill('[data-testid="input-admin-code"]', adminCode);
  await page.fill('[data-testid="input-admin-password"]', adminPassword);
  await page.click('[data-testid="button-admin-login"]');
  await page.waitForURL(/\/admin/, { timeout: 60000 });
}

async function getEnvironment(page: any) {
  const res = await page.evaluate(async () => {
    const r = await fetch("/api/admin/live/status");
    const data = await r.json();
    return data.status;
  });
  return res;
}

async function setEnvironment(page: any, env: "TEST" | "LIVE") {
  await page.evaluate(async (target: string) => {
    await fetch("/api/admin/live/environment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environment: target }),
    });
    await fetch("/api/admin/deploy/environment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environment: target }),
    });
  }, env);
}

async function getPartnerProfits(page: any) {
  const res = await page.evaluate(async () => {
    const r = await fetch("/api/admin/partner-profits");
    return { status: r.status, body: await r.json() };
  });
  return res;
}

function findNov2026(cycles: any[]) {
  return (Array.isArray(cycles) ? cycles : [cycles]).find((p: any) => p.monthYear === "2026-11");
}

function getMetricValue(page: any, label: string) {
  return page
    .locator("span", { hasText: label })
    .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]/p")
    .first()
    .textContent();
}

test("تتبع مصدر الرقم 40 وإثبات أنه ناتج عن بيئة LIVE", async ({ page }) => {
  const timestamp = new Date().toISOString();
  console.log("\n=== بدء التحقق عند", timestamp, "===");

  await adminLogin(page);

  // --- الحالة الأولى: TEST (القيم الصحيحة) ---
  let env = await getEnvironment(page);
  console.log("\n[TEST] البيئة النشطة:", env.environment, "| المشروع:", env.activeProjectId);

  await page.goto(`${BASE_URL}/admin/partner-profits`, { waitUntil: "networkidle", timeout: 60000 });
  await expect(page.getByText("إيرادات الشهر (صافي)")).toBeVisible({ timeout: 30000 });

  let apiResp = await getPartnerProfits(page);
  let novCycle = findNov2026(apiResp.body);
  console.log("[TEST] API دورة نوفمبر:", novCycle ? { revenueAfterFees: novCycle.revenueAfterFees, totalRevenue: novCycle.totalRevenue, totalExpenses: novCycle.totalExpenses, partnerShare: novCycle.partnerShare } : "غير موجودة");

  const testRevenueText = await getMetricValue(page, "إيرادات الشهر (صافي)");
  console.log("[TEST] الواجهة قبل التبديل:", testRevenueText);

  await page.screenshot({ path: "partner-profits-before-switch-test.png", fullPage: true });

  // --- الحالة الثانية: LIVE (لإثبات مصدر الرقم 40) ---
  console.log("\n--- التبديل إلى LIVE لقراءة البيانات الحقيقية ---");
  await setEnvironment(page, "LIVE");
  env = await getEnvironment(page);
  console.log("[LIVE] البيئة النشطة:", env.environment, "| المشروع:", env.activeProjectId);

  await page.goto(`${BASE_URL}/admin/partner-profits`, { waitUntil: "networkidle", timeout: 60000 });
  await expect(page.getByText("إيرادات الشهر (صافي)")).toBeVisible({ timeout: 30000 });

  apiResp = await getPartnerProfits(page);
  novCycle = findNov2026(apiResp.body);
  console.log("[LIVE] API دورة نوفمبر:", novCycle ? { revenueAfterFees: novCycle.revenueAfterFees, totalRevenue: novCycle.totalRevenue, totalExpenses: novCycle.totalExpenses, partnerShare: novCycle.partnerShare } : "غير موجودة");

  const liveRevenueText = await getMetricValue(page, "إيرادات الشهر (صافي)");
  console.log("[LIVE] الواجهة:", liveRevenueText);

  await page.screenshot({ path: "partner-profits-in-live-env.png", fullPage: true });

  // --- الحالة الثالثة: العودة إلى TEST وإعادة الحساب ---
  console.log("\n--- العودة إلى TEST وإعادة حساب الدورة ---");
  await setEnvironment(page, "TEST");
  env = await getEnvironment(page);
  console.log("[TEST-again] البيئة النشطة:", env.environment, "| المشروع:", env.activeProjectId);

  await page.goto(`${BASE_URL}/admin/partner-profits`, { waitUntil: "networkidle", timeout: 60000 });
  await expect(page.getByText("إيرادات الشهر (صافي)")).toBeVisible({ timeout: 30000 });

  // الضغط على زر إعادة حساب الدورة مرة واحدة
  const prepareButton = page.locator('[data-testid="button-prepare-current"]');
  await prepareButton.click();
  await page.waitForTimeout(2000);

  apiResp = await getPartnerProfits(page);
  novCycle = findNov2026(apiResp.body);
  console.log("[TEST-after-recompute] API دورة نوفمبر:", novCycle ? { revenueAfterFees: novCycle.revenueAfterFees, totalRevenue: novCycle.totalRevenue, totalExpenses: novCycle.totalExpenses, partnerShare: novCycle.partnerShare } : "غير موجودة");

  const finalRevenueText = await getMetricValue(page, "إيرادات الشهر (صافي)");
  const finalExpensesText = await getMetricValue(page, "تكاليف الشهر");
  const finalProfitText = await getMetricValue(page, "صافي نتيجة الشهر");
  const finalPartnerText = await getMetricValue(page, "حصة الشريك (50%)");

  console.log("\n[TEST-after-recompute] الواجهة النهائية:");
  console.log("  إيرادات الشهر (صافي):", finalRevenueText);
  console.log("  تكاليف الشهر:", finalExpensesText);
  console.log("  صافي نتيجة الشهر:", finalProfitText);
  console.log("  حصة الشريك:", finalPartnerText);

  await page.screenshot({ path: "partner-profits-after-recompute-test.png", fullPage: true });

  const parseValue = (text: string) => {
    const match = text.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    return match ? parseFloat(match[0]) : NaN;
  };

  expect(novCycle, "دورة نوفمبر 2026 غير موجودة في API").toBeTruthy();
  expect(novCycle.revenueAfterFees).toBeCloseTo(77.24, 2);
  expect(novCycle.totalExpenses).toBeCloseTo(20, 2);
  expect(novCycle.netProfitAfterExpenses).toBeCloseTo(57.24, 2);
  expect(novCycle.partnerShare).toBeCloseTo(28.62, 2);

  expect(parseValue(finalRevenueText)).toBeCloseTo(novCycle.revenueAfterFees, 2);
  expect(parseValue(finalExpensesText)).toBeCloseTo(-novCycle.totalExpenses, 2);
  expect(parseValue(finalProfitText)).toBeCloseTo(novCycle.netProfitAfterExpenses, 2);
  expect(parseValue(finalPartnerText)).toBeCloseTo(novCycle.partnerShare, 2);

  console.log("\n✅ التحقق اكتمل: الواجهة تطابق API في بيئة TEST");
});
