import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:5001";

async function adminLogin(page: any) {
  const adminCode = process.env.ADMIN_CODE || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "123";
  await page.goto(`${BASE_URL}/owner/login`);
  await page.click("text=المسؤول");
  await page.waitForSelector('[data-testid="auth-panel-admin"]');
  await page.fill('[data-testid="input-admin-code"]', adminCode);
  await page.fill('[data-testid="input-admin-password"]', adminPassword);
  await page.click('[data-testid="button-admin-login"]');
  await page.waitForURL(`${BASE_URL}/admin`, { timeout: 10000 });
}

const UPLOADED_RESULT = {
  ok: true,
  pushed: true,
  skipped: false,
  branch: "test/unified-gateway-ui-only",
  localSha: "a".repeat(40),
  remoteSha: "b".repeat(40),
  pushedSha: "a".repeat(40),
  detail: "تم رفع الفرع إلى GitHub بنجاح.",
  stage: "final",
  stages: [
    { stage: "connection", status: "ok", message: "اتصال بمستودع Git متاح." },
    { stage: "branch", status: "ok", message: "الفرع الحالي مطابق للفرع المعتمد (test/unified-gateway-ui-only)." },
    { stage: "changes", status: "ok", message: "Commit الحالي: aaaaaaaa." },
    { stage: "github_connection", status: "ok", message: "اتصال بـ GitHub متاح." },
    { stage: "push", status: "ok", message: "تم رفع Commit aaaaaaa إلى GitHub." },
    { stage: "verify", status: "ok", message: "تم التحقق من نزول Commit aaaaaaa إلى GitHub." },
  ],
};

test("deploy bar upload button renders icon-only with tooltip and runs the dedicated upload flow", async ({ page }) => {
  // The upload action must NEVER reach the publish endpoint (no publish dispatch).
  await page.route("**/api/admin/deploy/releases**", (route) => {
    throw new Error("UPLOAD_MUST_NOT_CALL_PUBLISH");
  });

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
  await expect(tooltip).toBeVisible({ timeout: 10000 });
  await expect(tooltip).toContainText("رفع إلى GitHub");
  await page.keyboard.press("Escape");

  // Dedicated upload endpoint is mocked (safe test environment — no real push).
  await page.route("**/api/admin/deploy/upload**", (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: UPLOADED_RESULT }),
    });
  });

  // Open the smart stepper panel and run the upload.
  await uploadButton.click();

  const panel = page.locator('[data-testid="deploy-bar-upload-panel"]');
  await expect(panel).toBeVisible();
  const stages = page.locator('[data-testid="deploy-bar-upload-stages"]');
  await expect(stages).toBeVisible();
  await expect(page.locator('[data-testid="deploy-bar-upload-stage-connection"]')).toBeVisible();
  await expect(page.locator('[data-testid="deploy-bar-upload-stage-branch"]')).toBeVisible();
  await expect(page.locator('[data-testid="deploy-bar-upload-stage-changes"]')).toBeVisible();
  await expect(page.locator('[data-testid="deploy-bar-upload-stage-github_connection"]')).toBeVisible();
  await expect(page.locator('[data-testid="deploy-bar-upload-stage-push"]')).toBeVisible();
  await expect(page.locator('[data-testid="deploy-bar-upload-stage-verify"]')).toBeVisible();

  // Final result surfaces from the dedicated upload endpoint.
  const resultPanel = page.locator('[data-testid="deploy-bar-upload-result"]');
  await expect(resultPanel).toBeVisible();
  await expect(page.locator('[data-testid="deploy-bar-upload-result-title"]')).toHaveText(
    /تم رفع الفرع إلى GitHub بنجاح/,
  );
  await expect(page.locator('[data-testid="deploy-bar-upload-result-detail"]')).toHaveText(
    /تم رفع الفرع إلى GitHub بنجاح/,
  );
  const sha = page.locator('[data-testid="deploy-bar-upload-result-sha"]');
  await expect(sha).toHaveText(/Commit/);

  // Close the panel.
  await page.locator('[data-testid="deploy-bar-upload-done"]').click();
  await expect(panel).toBeHidden();
});
