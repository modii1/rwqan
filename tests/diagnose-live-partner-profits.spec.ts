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

async function setEnvironment(page: any, env: "TEST" | "LIVE") {
  const result = await page.evaluate(async (target: string) => {
    const res = await fetch("/api/admin/live/environment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environment: target }),
    });
    return res.status;
  }, env);
  console.log(`Switch to ${env} status:`, result);
}

test("تشخيص قراءة فقط لدورة نوفمبر 2026 في LIVE", async ({ page }) => {
  await adminLogin(page);

  // --- TEST baseline ---
  const testStatus = await page.evaluate(async () => {
    const res = await fetch("/api/admin/live/status");
    return (await res.json()).status;
  });
  console.log("\n[TEST] environment:", testStatus.environment, "project:", testStatus.activeProjectId);

  // --- Switch to LIVE for read-only diagnosis ---
  console.log("\n--- Switching to LIVE (read-only) ---");
  await setEnvironment(page, "LIVE");

  const liveStatus = await page.evaluate(async () => {
    const res = await fetch("/api/admin/live/status");
    return (await res.json()).status;
  });
  console.log("[LIVE] environment:", liveStatus.environment, "project:", liveStatus.activeProjectId, "writeBlocked:", liveStatus.writeBlocked);

  // Fetch partner profits
  const profits = await page.evaluate(async () => {
    const res = await fetch("/api/admin/partner-profits");
    return await res.json();
  });
  const novCycle = Array.isArray(profits)
    ? profits.find((p: any) => p.monthYear === "2026-11")
    : null;

  console.log("\n=== LIVE Partner Profit Cycle 2026-11 ===");
  if (novCycle) {
    console.log("  id:", novCycle.id);
    console.log("  status:", novCycle.status);
    console.log("  createdAt:", novCycle.createdAt);
    console.log("  updatedAt:", novCycle.updatedAt);
    console.log("  activeSubscriptions:", novCycle.activeSubscriptions);
    console.log("  totalRevenue:", novCycle.totalRevenue);
    console.log("  revenueAfterFees:", novCycle.revenueAfterFees);
    console.log("  totalExpenses:", novCycle.totalExpenses);
    console.log("  netProfitAfterExpenses:", novCycle.netProfitAfterExpenses);
    console.log("  partnerShare:", novCycle.partnerShare);
    console.log("  paymentsDetail count:", novCycle.paymentsDetail?.length || 0);
    if (novCycle.paymentsDetail?.length) {
      novCycle.paymentsDetail.forEach((p: any) => {
        console.log("    payment:", p.id, "|", p.propertyNumber, "|", p.amount, "| net=", p.netAmount, "|", p.status, "|", p.paymentMethod);
      });
    }
  } else {
    console.log("  No 2026-11 cycle found");
  }

  // Fetch all LIVE payments
  const payments = await page.evaluate(async () => {
    const res = await fetch("/api/admin/payments");
    return await res.json();
  });

  console.log("\n=== LIVE Payments (all) ===");
  console.log("Total payments:", payments.length);
  payments.forEach((p: any) => {
    console.log(
      " ", p.id, "|", p.propertyNumber, "| amount=", p.amount, "| final=", p.finalAmount, "| net=", p.netAmount,
      "| fees=", p.totalFees, "| status=", p.status, "| method=", p.paymentMethod,
      "| completedAt=", p.completedAt, "| createdAt=", p.createdAt
    );
  });

  const novPayments = payments.filter((p: any) =>
    (p.completedAt || p.createdAt || "").startsWith("2026-11")
  );
  console.log("\n=== LIVE Payments for 2026-11 ===");
  console.log("Count:", novPayments.length);
  novPayments.forEach((p: any) => {
    console.log(
      " ", p.id, "|", p.propertyNumber, "| amount=", p.amount, "| final=", p.finalAmount, "| net=", p.netAmount,
      "| fees=", p.totalFees, "| status=", p.status, "| method=", p.paymentMethod,
      "| completedAt=", p.completedAt
    );
  });

  // Fetch expenses
  const expenses = await page.evaluate(async () => {
    const res = await fetch("/api/admin/expenses");
    return await res.json();
  });
  console.log("\n=== LIVE Expenses ===");
  expenses.forEach((e: any) => {
    console.log(" ", e.id, "|", e.title, "|", e.amount, "| date=", e.date, "| type=", e.expenseType, "| active=", e.isActive);
  });

  // --- Switch back to TEST ---
  console.log("\n--- Switching back to TEST ---");
  await setEnvironment(page, "TEST");

  const finalStatus = await page.evaluate(async () => {
    const res = await fetch("/api/admin/live/status");
    return (await res.json()).status;
  });
  console.log("[FINAL] environment:", finalStatus.environment, "project:", finalStatus.activeProjectId);

  // Basic assertions to ensure we read something
  expect(liveStatus.environment).toBe("LIVE");
  expect(liveStatus.writeBlocked).toBe(true);
  expect(finalStatus.environment).toBe("TEST");
});
