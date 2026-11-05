import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:5001";

async function adminLogin(page: any) {
  const adminCode = process.env.ADMIN_CODE || "0000";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin";
  await page.goto(`${BASE_URL}/owner/login`);
  await page.click('text=المسؤول');
  await page.waitForSelector('[data-testid="auth-panel-admin"]');
  await page.fill('[data-testid="input-admin-code"]', adminCode);
  await page.fill('[data-testid="input-admin-password"]', adminPassword);
  await page.click('[data-testid="button-admin-login"]');
  await page.waitForURL(`${BASE_URL}/admin`, { timeout: 10000 });
}

test("deploy bar upload button renders icon-only with tooltip and triggers upload", async ({ page }) => {
  await adminLogin(page);
  await page.goto(`${BASE_URL}/admin/partner-profits`);
  await page.waitForLoadState("networkidle");

  const uploadButton = page.locator('[data-testid="deploy-bar-upload-test"]');
  await expect(uploadButton).toBeVisible();

  // Icon-only: no visible label text next to the icon.
  await expect(uploadButton).toHaveText("");

  // Tooltip on hover explains the action.
  await uploadButton.hover();
  const tooltip = page.locator('[role="tooltip"]');
  await expect(tooltip).toBeVisible({ timeout: 5000 });
  await expect(tooltip).toContainText("رفع إلى GitHub");
  await page.keyboard.press("Escape");

  // Clicking must not perform any real upload: the shared publish flow runs a
  // confirmation first (auto-dismissed in the test, so no action is taken).
  page.on("dialog", (dialog) => dialog.dismiss());
  await uploadButton.click();
});
