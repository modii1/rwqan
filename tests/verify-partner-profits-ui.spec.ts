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

async function ensureTestEnvironment(page: any) {
  const result = await page.evaluate(async () => {
    const res = await fetch("/api/admin/live/environment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environment: "TEST" }),
    });
    return res.status;
  });
  console.log("Environment switch status:", result);
}

function getMetricValue(page: any, label: string) {
  return page
    .locator("span", { hasText: label })
    .locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]/p")
    .first()
    .textContent();
}

test("عرض أرقام دورة نوفمبر 2026 بشكل صحيح في الواجهة", async ({ page }) => {
  const consoleLogs: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    consoleLogs.push(text);
    console.log(text);
  });

  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("/api/admin/")) {
      const status = response.status();
      const ok = response.ok();
      console.log(`API ${status} ${ok ? "OK" : "FAIL"} ${url}`);
      if (!ok) {
        try {
          const body = await response.text();
          failedRequests.push(`${status} ${url} => ${body.slice(0, 200)}`);
        } catch {}
      }
    }
  });

  await adminLogin(page);
  await ensureTestEnvironment(page);

  await page.goto(`${BASE_URL}/admin/partner-profits`, { waitUntil: "networkidle", timeout: 60000 });

  // التأكد من ظهور بطاقة المقاييس
  await expect(page.getByText("إيرادات الشهر (صافي)")).toBeVisible({ timeout: 30000 });

  // قراءة استجابة API مباشرة من نفس جلسة المتصفح
  const apiResponse = await page.evaluate(async () => {
    const res = await fetch("/api/admin/partner-profits");
    return { status: res.status, body: await res.json() };
  });
  console.log("\n=== API Response (/api/admin/partner-profits) ===");
  console.log(JSON.stringify(apiResponse.body, null, 2));

  // قراءة القيم المعروضة
  const revenueText = await getMetricValue(page, "إيرادات الشهر (صافي)");
  const expensesText = await getMetricValue(page, "تكاليف الشهر");
  const profitText = await getMetricValue(page, "صافي نتيجة الشهر");
  const partnerShareText = await getMetricValue(page, "حصة الشريك (50%)");

  console.log("\n=== القيم المعروضة في الواجهة ===");
  console.log("الإيرادات الصافية المعروضة:", revenueText);
  console.log("التكاليف المعروضة:", expensesText);
  console.log("صافي الربح المعروض:", profitText);
  console.log("حصة الشريك المعروضة:", partnerShareText);

  const parseValue = (text: string) => {
    const match = text.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    return match ? parseFloat(match[0]) : NaN;
  };

  const apiCycles = Array.isArray(apiResponse.body) ? apiResponse.body : [apiResponse.body];
  const apiCycle = apiCycles.find((p: any) => p.monthYear === "2026-11");
  expect(apiCycle, "دورة نوفمبر 2026 غير موجودة في API").toBeTruthy();
  // API values used for comparison
  expect(apiCycle.totalRevenue).toBeCloseTo(80, 2);
  expect(apiCycle.revenueAfterFees).toBeCloseTo(77.24, 2);
  expect(apiCycle.totalExpenses).toBeCloseTo(20, 2);
  expect(apiCycle.netProfitAfterExpenses).toBeCloseTo(57.24, 2);
  expect(apiCycle.partnerShare).toBeCloseTo(28.62, 2);

  // UI matches API
  expect(parseValue(revenueText)).toBeCloseTo(apiCycle.revenueAfterFees, 2);
  expect(parseValue(expensesText)).toBeCloseTo(-apiCycle.totalExpenses, 2);
  expect(parseValue(profitText)).toBeCloseTo(apiCycle.netProfitAfterExpenses, 2);
  expect(parseValue(partnerShareText)).toBeCloseTo(apiCycle.partnerShare, 2);

  if (failedRequests.length > 0) {
    console.log("\n⚠️ Failed API requests (pre-login or non-critical):", failedRequests);
  }

  await page.screenshot({ path: "partner-profits-ui-verified.png", fullPage: true });
  console.log("\n✅ لقطة شاشة حُفظت: partner-profits-ui-verified.png");
});
