import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:5001";
const NEW_SHA = "c".repeat(40);
const TEST_BRANCH = "test/unified-gateway-ui-only";
const LIVE_BRANCH = "main";

async function adminLogin(page: any) {
  const adminCode = process.env.ADMIN_CODE || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "123";
  await page.goto(`${BASE_URL}/owner/login`);
  await page.click("text=المسؤول");
  await page.waitForSelector('[data-testid="auth-panel-admin"]');
  await page.fill('[data-testid="input-admin-code"]', adminCode);
  await page.fill('[data-testid="input-admin-password"]', adminPassword);
  await page.click('[data-testid="button-admin-login"]');
  await page.waitForURL(`${BASE_URL}/admin`, { timeout: 60000 });

  // Pin both stores to TEST so login is always possible while the test runs.
  const statuses = await page.evaluate(async () => {
    const switchEnvironment = async (url: string) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment: "TEST" }),
      });
      return res.status;
    };
    return {
      data: await switchEnvironment("/api/admin/live/environment"),
      deploy: await switchEnvironment("/api/admin/deploy/environment"),
    };
  });
  expect(statuses.data).toBe(200);
  expect(statuses.deploy).toBe(200);
  await page.reload({ waitUntil: "networkidle" });
}

async function setDeployEnvironment(page: any, environment: "TEST" | "LIVE") {
  const status = await page.evaluate(async (value: "TEST" | "LIVE") => {
    const res = await fetch("/api/admin/deploy/environment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environment: value }),
    });
    return res.status;
  }, environment);
  expect(status).toBe(200);
  await page.reload({ waitUntil: "networkidle" });
}

function syncResult(environment: "TEST" | "LIVE", branch: string) {
  return {
    environment,
    ok: true,
    pushed: true,
    skipped: false,
    branch,
    localSha: NEW_SHA,
    remoteSha: NEW_SHA,
    pushedSha: NEW_SHA,
    commitSha: NEW_SHA,
    commitMessage: `sync(${environment}): 3 ملف`,
    commitUrl: `https://github.com/modii1/rwqan/commit/${NEW_SHA}`,
    changeCount: 3,
    detail:
      environment === "TEST"
        ? "تمت مزامنة TEST ورفع Commit ccccccc."
        : "تمت مزامنة 3 ملف برمجي معتمد إلى main.",
    stage: "final",
    stages: [
      { stage: "connection", status: "ok", message: "اتصال بمستودع Git متاح." },
      { stage: "branch", status: "ok", message: `الفرع ${branch} مطابق.` },
      { stage: "changes", status: "ok", message: "3 ملف." },
      { stage: "checks", status: "ok", message: "نجح Typecheck والاختبارات." },
      { stage: "build", status: "ok", message: "نجح بناء LIVE." },
      { stage: "commit", status: "ok", message: "تم إنشاء Commit ccccccc." },
      { stage: "push", status: "ok", message: "تم رفع Commit ccccccc." },
      { stage: "verify", status: "ok", message: "تم التحقق من Commit ccccccc." },
    ],
  };
}

const LIVE_PREFLIGHT = {
  environment: "LIVE",
  branch: LIVE_BRANCH,
  workspace: {
    environment: "LIVE",
    branch: LIVE_BRANCH,
    path: "/repo-live",
    label: "مساحة LIVE المستقلة (main)",
    created: false,
  },
  approvedCount: 3,
  counts: {
    total: 3,
    modified: 2,
    added: 1,
    deleted: 0,
    renamed: 0,
    untracked: 0,
    sensitive: 0,
  },
  commitMessage: "sync(LIVE): 3 ملف — 2 معدّل، 1 جديد",
  canSync: true,
  blockedReason: null,
  detail: "3 ملف برمجي معتمد من TEST.",
  prepared: false,
  preparedCount: 0,
  token: "sync-token-123",
};

test("the existing cloud icon runs a one-click TEST sync without any file list", async ({
  page,
}) => {
  // The sync action must NEVER reach the publish endpoint.
  await page.route("**/api/admin/deploy/releases**", () => {
    throw new Error("SYNC_MUST_NOT_PUBLISH");
  });
  await page.route("**/api/admin/deploy/upload**", () => {
    throw new Error("SYNC_MUST_NOT_USE_OLD_UPLOAD");
  });

  let syncCalled = false;
  await page.route("**/api/admin/deploy/sync/test", (route) => {
    syncCalled = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: syncResult("TEST", TEST_BRANCH) }),
    });
  });

  await adminLogin(page);
  await page.goto(`${BASE_URL}/admin/partner-profits`);
  await page.waitForLoadState("networkidle");

  const cloud = page.locator('[data-testid="deploy-bar-upload-test"]');
  await expect(cloud).toBeVisible();
  // Still icon-only: no new visible label/button was added.
  await expect(cloud).toHaveText("");
  await cloud.hover();
  await expect(page.locator('[role="tooltip"]')).toContainText(
    "مزامنة التحديثات"
  );
  await page.keyboard.press("Escape");

  await cloud.click();

  await expect.poll(() => syncCalled).toBe(true);
  const panel = page.locator('[data-testid="deploy-bar-upload-panel"]');
  await expect(panel).toBeVisible();
  await expect(
    page.locator('[data-testid="deploy-bar-upload-result-title"]')
  ).toHaveText(/تمت مزامنة التحديثات/);
  await expect(
    page.locator('[data-testid="deploy-bar-upload-result-sha"]')
  ).toHaveText(new RegExp(NEW_SHA));
  await expect(
    page.locator('[data-testid="deploy-bar-upload-result-url"]')
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="deploy-bar-upload-stage-commit"]')
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="deploy-bar-upload-stage-push"]')
  ).toBeVisible();
  await expect(
    page.locator('[data-testid="deploy-bar-upload-stage-verify"]')
  ).toBeVisible();

  // No file list, no checkboxes, no selection UI.
  await expect(page.locator('[data-testid="deploy-bar-upload-changes"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="deploy-bar-upload-preview"]')).toHaveCount(0);
  await expect(panel.locator('input[type="checkbox"]')).toHaveCount(0);

  await page.locator('[data-testid="deploy-bar-upload-done"]').click();
  await expect(panel).toBeHidden();
});

test("LIVE sync shows ONE confirmation and sends the preflight token", async ({
  page,
}) => {
  await page.route("**/api/admin/deploy/releases**", () => {
    throw new Error("SYNC_MUST_NOT_PUBLISH");
  });
  await page.route("**/api/admin/deploy/upload**", () => {
    throw new Error("SYNC_MUST_NOT_USE_OLD_UPLOAD");
  });

  let preflightCalled = false;
  await page.route("**/api/admin/deploy/sync/live/preflight", (route) => {
    preflightCalled = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ preflight: LIVE_PREFLIGHT }),
    });
  });

  let syncBody: any = null;
  await page.route("**/api/admin/deploy/sync/live", (route) => {
    if (route.request().url().endsWith("/preflight")) return route.fallback();
    syncBody = route.request().postDataJSON();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: syncResult("LIVE", LIVE_BRANCH) }),
    });
  });

  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.accept();
  });

  await adminLogin(page);
  await setDeployEnvironment(page, "LIVE");
  try {
    await page.goto(`${BASE_URL}/admin/partner-profits`);
    await page.waitForLoadState("networkidle");

    const cloud = page.locator('[data-testid="deploy-bar-upload-test"]');
    await cloud.click();

    await expect.poll(() => preflightCalled).toBe(true);
    await expect.poll(() => syncBody).not.toBeNull();
    expect(dialogs.length).toBe(1);
    expect(syncBody?.environment).toBe("LIVE");
    expect(syncBody?.confirm).toBe(true);
    expect(syncBody?.token).toBe("sync-token-123");

    const panel = page.locator('[data-testid="deploy-bar-upload-panel"]');
    await expect(panel).toBeVisible();
    await expect(
      page.locator('[data-testid="deploy-bar-upload-result-title"]')
    ).toHaveText(/تمت مزامنة التحديثات/);
    await expect(
      page.locator('[data-testid="deploy-bar-upload-result-sha"]')
    ).toHaveText(new RegExp(NEW_SHA));

    // No file list or selection UI.
    await expect(page.locator('[data-testid="deploy-bar-upload-changes"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="deploy-bar-upload-preview"]')).toHaveCount(0);
    await expect(panel.locator('input[type="checkbox"]')).toHaveCount(0);

    await page.locator('[data-testid="deploy-bar-upload-done"]').click();
  } finally {
    await setDeployEnvironment(page, "TEST");
  }
});

test("a failed sync displays the full failure log in the panel", async ({ page }) => {
  await page.route("**/api/admin/deploy/sync/test", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          environment: "TEST",
          ok: false,
          pushed: false,
          skipped: false,
          branch: TEST_BRANCH,
          localSha: null,
          remoteSha: null,
          pushedSha: null,
          changeCount: 0,
          detail:
            "فشل البناء في LIVE: TypeError: Cannot read properties of null (reading 'useContext')",
          failureLog:
            "> next build\n✓ Compiled successfully\n" +
            'Error occurred prerendering page "/_global-error"\n' +
            "TypeError: Cannot read properties of null (reading 'useContext')\n" +
            "Build failed",
          stage: "build",
          stages: [
            {
              stage: "connection",
              status: "ok",
              message: "اتصال بمستودع Git متاح.",
            },
            {
              stage: "build",
              status: "failed",
              message:
                "فشل البناء في LIVE: TypeError: Cannot read properties of null (reading 'useContext')",
            },
          ],
        },
      }),
    })
  );

  await adminLogin(page);
  await page.goto(`${BASE_URL}/admin/partner-profits`);
  await page.waitForLoadState("networkidle");

  await page.locator('[data-testid="deploy-bar-upload-test"]').click();

  await expect(
    page.locator('[data-testid="deploy-bar-upload-result-title"]')
  ).toHaveText(/تعذّرت مزامنة التحديثات/);
  const log = page.locator('[data-testid="deploy-bar-upload-failure-log"]');
  await expect(log).toBeVisible();
  await expect(log).toContainText("Compiled successfully");
  await expect(log).toContainText("TypeError: Cannot read properties");
  await expect(log).toContainText("Build failed");
});

test("LIVE preflight blocks with a short reason and never starts a sync", async ({
  page,
}) => {
  await page.route("**/api/admin/deploy/sync/live/preflight", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        preflight: {
          ...LIVE_PREFLIGHT,
          canSync: false,
          blockedReason:
            "مساحة LIVE لا تحتوي على node_modules — لن يتم تثبيتها تلقائيًا.",
          token: "",
        },
      }),
    })
  );
  let syncCalled = false;
  await page.route("**/api/admin/deploy/sync/live", (route) => {
    syncCalled = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ result: syncResult("LIVE", LIVE_BRANCH) }),
    });
  });

  await adminLogin(page);
  await setDeployEnvironment(page, "LIVE");
  try {
    await page.goto(`${BASE_URL}/admin/partner-profits`);
    await page.waitForLoadState("networkidle");

    await page.locator('[data-testid="deploy-bar-upload-test"]').click();

    const panel = page.locator('[data-testid="deploy-bar-upload-panel"]');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/node_modules/);
    await expect(syncCalled).toBe(false);
    await expect(
      page.locator('[data-testid="deploy-bar-upload-result"]')
    ).toHaveCount(0);
  } finally {
    await setDeployEnvironment(page, "TEST");
  }
});
