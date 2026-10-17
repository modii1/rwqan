import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { createAdminDeployRouter, type DeployRestoreContext } from "./deploy";
import {
  InMemoryDeploySystemStore,
  UnavailableDeploySystemStore,
  type DeploySystemStoreContract,
} from "../../services/DeploySystemStore";
import type { DeployCheckReport } from "../../services/DeployChecksService";
import type { DeployExecutor } from "../../services/DeployExecutor";
import type {
  DeployCheckRun,
  DeployChecks,
  DeployGitSource,
  DeployRelease,
  DeployRestorePreview,
  DeployRestoreResult,
} from "../../../shared/deploySystem";

const PASSING_CHECKS: DeployChecks = {
  typescript: "NOT_RUN",
  tests: "NOT_RUN",
  build: "NOT_RUN",
  secretScan: "PASS",
  postDeployHealth: "NOT_RUN",
};

const GIT: DeployGitSource = {
  commit: "server123",
  branch: "main",
  tag: null,
  repoUrl: "https://github.com/iheeb1/rwqan-sa.git",
};

function passingReport(): DeployCheckReport {
  return { checks: { ...PASSING_CHECKS }, git: { ...GIT }, reasons: {} };
}

function failingReport(): DeployCheckReport {
  return {
    checks: { ...PASSING_CHECKS, secretScan: "FAIL" },
    git: { ...GIT },
    reasons: { secretScan: "ملفات قد تحوي أسرارًا: .env.production" },
  };
}

function buildApp(
  store: DeploySystemStoreContract,
  options: {
    enabled?: boolean;
    collectChecks?: () => Promise<DeployCheckReport>;
    runChecks?: () => Promise<DeployCheckRun>;
    executor?: DeployExecutor;
    restoreRunner?: (
      release: DeployRelease,
      context: DeployRestoreContext,
    ) => Promise<DeployRestoreResult>;
    restorePreview?: (
      release: DeployRelease,
      context: DeployRestoreContext,
    ) => Promise<DeployRestorePreview>;
  } = {},
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const hasAdmin = Boolean(req.headers["x-test-admin"]);
    (req as unknown as { session: { isAdmin?: boolean } }).session = hasAdmin
      ? { isAdmin: true }
      : {};
    next();
  });
  app.use(
    createAdminDeployRouter(store, {
      enabled: () => options.enabled ?? true,
      collectChecks: options.collectChecks ?? (async () => passingReport()),
      runChecks: options.runChecks,
      executor: options.executor,
      restoreRunner: options.restoreRunner,
      restorePreview: options.restorePreview,
    }),
  );
  return app;
}

async function withServer<T>(
  app: express.Express,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const ADMIN_HEADERS = {
  "content-type": "application/json",
  "sec-fetch-site": "same-origin",
  "x-test-admin": "1",
};

test("deploy endpoints reject unauthenticated requests", async () => {
  const store = new InMemoryDeploySystemStore();
  const app = buildApp(store);

  await withServer(app, async (base) => {
    for (const path of [
      "/api/admin/deploy/state",
      "/api/admin/deploy/environment",
      "/api/admin/deploy/releases",
    ]) {
      const res = await fetch(`${base}${path}`, {
        method: path.endsWith("state") ? "GET" : "POST",
        headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
        body: path.endsWith("state") ? undefined : JSON.stringify({}),
      });
      assert.equal(res.status, 401, `${path} must require an admin session`);
    }
  });
});

test("cross-origin and disabled requests never reach the store", async () => {
  const store = new InMemoryDeploySystemStore({ seed: true });
  const app = buildApp(store);

  await withServer(app, async (base) => {
    const crossOrigin = await fetch(`${base}/api/admin/deploy/releases`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "cross-site",
        "x-test-admin": "1",
      },
      body: JSON.stringify({}),
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal((await store.listReleases()).length, 3);
  });

  const disabledApp = buildApp(new InMemoryDeploySystemStore(), { enabled: false });
  await withServer(disabledApp, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/state`, {
      headers: { "sec-fetch-site": "same-origin", "x-test-admin": "1" },
    });
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { code: string }).code, "DEPLOY_SYSTEM_DISABLED");
  });
});

test("state reports persistence, defaults to TEST, and never leaks secrets", async () => {
  const app = buildApp(new InMemoryDeploySystemStore({ seed: true }));

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/state`, {
      headers: { "sec-fetch-site": "same-origin", "x-test-admin": "1" },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store, private");
    const body = (await res.json()) as any;
    assert.equal(body.state.environment, "TEST");
    assert.equal(body.state.persistent, true);
    assert.equal(typeof body.state.persistenceNotice, "string");
    assert.ok(body.state.releases.length <= 5);
    assert.ok(body.state.releases.length >= 1);
    assert.doesNotMatch(JSON.stringify(body), /sk_live_|PRIVATE KEY|BEGIN RSA/);
    // Stable baseline + rollback are exposed read-only and never claimed as proven.
    assert.equal(body.state.stableBaseline.site, "rwqan.sa");
    assert.equal(body.state.stableBaseline.confidence, "unknown");
    assert.equal(body.state.stableBaseline.publishedSha, null);
    assert.equal(body.state.stableBaseline.publishedVersionId, null);
    assert.equal(body.state.stableBaseline.headMatchesBaseline, null);
    assert.equal(body.state.rollback.supported, true);
    assert.equal(body.state.rollback.confirmed, false);
    assert.equal(body.state.rollback.readyToRollback, false);
  });
});

test("publish stores a durable record with server-derived git and status", async () => {
  const store = new InMemoryDeploySystemStore();
  const app = buildApp(store);

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/releases`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      // A malicious client tries to set git, status, actor and deploy flags.
      body: JSON.stringify({
        version: "1.2.3",
        changeSummary: "تعديل تجريبي",
        gitCommit: "client-supplied",
        gitBranch: "hacker-branch",
        status: "deployed",
        createdBy: "root",
        savedToGit: true,
        deployed: true,
      }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.equal(body.release.version, "1.2.3");
    assert.equal(body.release.changeSummary, "تعديل تجريبي");
    // Server-derived git wins; client values are ignored.
    assert.equal(body.release.gitCommit, "server123");
    assert.equal(body.release.gitBranch, "main");
    // Client cannot forge status/actor/deploy flags.
    assert.equal(body.release.status, "simulated");
    assert.equal(body.release.createdBy, "admin");
    assert.equal(body.release.deployed, false);
    assert.equal(body.release.savedToGit, false);
    assert.ok(body.publishNotice.includes("حفظ سجل الإصدار"));
    assert.equal((await store.listAudit())[0]?.action, "publish_simulated");
    assert.equal((await store.listAudit())[0]?.actor, "admin");
  });
});

test("a failed secret scan is recorded as failure, never as a published release", async () => {
  const store = new InMemoryDeploySystemStore();
  const app = buildApp(store, { collectChecks: async () => failingReport() });

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/releases`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ version: "9.9.9" }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.equal(body.release.status, "validation_failed");
    assert.equal(body.release.deployed, false);
    assert.equal(body.release.checks.secretScan, "FAIL");
    assert.ok(body.checkNotes.secretScan.includes(".env.production"));
    assert.equal((await store.listAudit())[0]?.action, "publish_failed");
    assert.equal((await store.listAudit())[0]?.result, "rejected");
  });
});

test("release history is ordered newest-first and capped at five", async () => {
  const store = new InMemoryDeploySystemStore();
  const app = buildApp(store);

  await withServer(app, async (base) => {
    for (let index = 0; index < 7; index += 1) {
      const res = await fetch(`${base}/api/admin/deploy/releases`, {
        method: "POST",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ version: `0.0.${index}` }),
      });
      assert.equal(res.status, 201);
    }
    const releases = await store.listReleases();
    assert.equal(releases.length, 5);
    for (let index = 1; index < releases.length; index += 1) {
      assert.ok(
        releases[index - 1]!.createdAt >= releases[index]!.createdAt,
        "releases must be newest-first",
      );
    }
  });
});

test("environment switch validates input and audits the change", async () => {
  const store = new InMemoryDeploySystemStore();
  const app = buildApp(store);

  await withServer(app, async (base) => {
    const invalid = await fetch(`${base}/api/admin/deploy/environment`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ environment: "PROD" }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(await store.getEnvironment(), "TEST");

    const live = await fetch(`${base}/api/admin/deploy/environment`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ environment: "LIVE" }),
    });
    assert.equal(live.status, 200);
    assert.equal(await store.getEnvironment(), "LIVE");
    assert.equal((await store.listAudit())[0]?.action, "environment_changed");
  });
});

test("a real executor outcome is recorded (deployed/publish), never forged by the client", async () => {
  const store = new InMemoryDeploySystemStore();
  const executor: DeployExecutor = {
    publish: async () => ({
      deployed: true,
      savedToGit: true,
      detail: "نشر فعلي عبر مسار حقيقي",
    }),
    restore: async () => ({
      restored: true,
      detail: "استعادة فعلية",
    }),
  };
  const app = buildApp(store, { executor });

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/releases`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ version: "2.0.0" }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.equal(body.release.deployed, true);
    assert.equal(body.release.savedToGit, true);
    assert.equal(body.release.simulated, false);
    // Git provenance stays server-derived; the executor cannot override it.
    assert.equal(body.release.gitCommit, "server123");
    assert.equal(body.audit.action, "publish");
  });
});

test("the default executor is a safe simulation (no real deploy)", async () => {
  const store = new InMemoryDeploySystemStore();
  const app = buildApp(store);

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/releases`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ version: "3.0.0" }),
    });
    const body = (await res.json()) as any;
    assert.equal(body.release.deployed, false);
    assert.equal(body.release.simulated, true);
    assert.equal(body.audit.action, "publish_simulated");
  });
});

test("restore requires confirmation and rejects unknown/incomplete/unsafe releases", async () => {
  const store = new InMemoryDeploySystemStore({ seed: true });
  const app = buildApp(store);

  await withServer(app, async (base) => {
    const url = `${base}/api/admin/deploy/releases`;
    const noConfirm = await fetch(`${url}/rel-seed-0003/restore`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({}),
    });
    assert.equal(noConfirm.status, 400);

    const unknown = await fetch(`${url}/does-not-exist/restore`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(unknown.status, 404);

    const incomplete = await fetch(`${url}/rel-seed-0002/restore`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(incomplete.status, 409);
    assert.equal(((await incomplete.json()) as any).code, "RELEASE_INCOMPLETE");

    // rel-seed-0003 has only a short, non-SHA "seed00003" commit: even with an
    // explicit confirmation the REAL restore refuses it (never reported as ok).
    const unsafe = await fetch(`${url}/rel-seed-0003/restore`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(unsafe.status, 409);
    assert.equal(((await unsafe.json()) as any).code, "RESTORE_BLOCKED");
    assert.equal((await store.listAudit())[0]?.action, "restore_real");
    assert.equal((await store.listAudit())[0]?.result, "rejected");
  });
});

const FAKE_SHA = "a".repeat(40);

async function seedRestorableRelease(
  store: InMemoryDeploySystemStore,
): Promise<DeployRelease> {
  const release = await store.createRelease({
    version: "9.9.9",
    environment: "TEST",
    changeSummary: "إصدار قابل للاستعادة",
    git: {
      commit: FAKE_SHA,
      branch: "main",
      tag: null,
      repoUrl: "https://github.com/iheeb1/rwqan-sa.git",
    },
    checks: { ...PASSING_CHECKS },
  });
  assert.equal(release.gitCommit, FAKE_SHA);
  return release;
}

function previewResult(
  overrides: Partial<DeployRestorePreview> = {},
): DeployRestorePreview {
  return {
    releaseId: "rel-restore-0001",
    version: "9.9.9",
    commitSha: FAKE_SHA,
    shortSha: FAKE_SHA.slice(0, 7),
    releaseStatus: "simulated",
    environment: "TEST",
    sourceRepoUrl: "https://github.com/iheeb1/rwqan-sa.git",
    worktree: "clean",
    shaFormatValid: true,
    commitExists: true,
    canRestore: true,
    blockers: [],
    targetPath: ".deploy-restore/rel-restore-0001",
    ...overrides,
  };
}

function restoreResult(
  overrides: Partial<DeployRestoreResult> = {},
): DeployRestoreResult {
  return {
    releaseId: "rel-restore-0001",
    version: "9.9.9",
    commitSha: FAKE_SHA,
    status: "success",
    real: true,
    targetPath: ".deploy-restore/rel-restore-0001",
    fileCount: 3,
    verified: true,
    verification: { checked: 3, mismatches: [], prunedSecrets: [".env"] },
    requestedAt: "2026-01-01T00:00:00.000Z",
    executedAt: "2026-01-01T00:00:01.000Z",
    detail: "استعادة فعلية معزولة موثقة.",
    error: null,
    ...overrides,
  };
}

test("restore preview is read-only and reports blockers without executing", async () => {
  const store = new InMemoryDeploySystemStore();
  const release = await seedRestorableRelease(store);
  const app = buildApp(store, {
    restorePreview: async (target) =>
      previewResult({
        releaseId: target.releaseId,
        canRestore: false,
        commitExists: false,
        blockers: ["الـSHA غير موجود في المستودع المحلي (تحقّق بلا شبكة)."],
      }),
  });

  await withServer(app, async (base) => {
    const res = await fetch(
      `${base}/api/admin/deploy/releases/${release.releaseId}/restore/preview`,
      { method: "POST", headers: ADMIN_HEADERS, body: JSON.stringify({}) },
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store, private");
    const body = (await res.json()) as any;
    assert.equal(body.preview.releaseId, release.releaseId);
    assert.equal(body.preview.canRestore, false);
    assert.equal(body.preview.commitExists, false);
    assert.ok(body.restoreNotice.includes("استعادة فعلية"));
    assert.equal((await store.listAudit())[0]?.action, "restore_preview");
    assert.equal((await store.listAudit())[0]?.result, "rejected");
  });
});

test("restore preview reports unknown releases with 404", async () => {
  const store = new InMemoryDeploySystemStore();
  const app = buildApp(store);

  await withServer(app, async (base) => {
    const res = await fetch(
      `${base}/api/admin/deploy/releases/does-not-exist/restore/preview`,
      { method: "POST", headers: ADMIN_HEADERS, body: JSON.stringify({}) },
    );
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as any).code, "RELEASE_NOT_FOUND");
  });
});

test("a confirmed real restore is executed, verified and audited as restore_real", async () => {
  const store = new InMemoryDeploySystemStore();
  const release = await seedRestorableRelease(store);
  const app = buildApp(store, {
    restoreRunner: async (target) =>
      restoreResult({ releaseId: target.releaseId }),
  });

  await withServer(app, async (base) => {
    const res = await fetch(
      `${base}/api/admin/deploy/releases/${release.releaseId}/restore`,
      { method: "POST", headers: ADMIN_HEADERS, body: JSON.stringify({ confirm: true }) },
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.restore.status, "success");
    assert.equal(body.restore.real, true);
    assert.equal(body.restore.verified, true);
    assert.equal(body.restored.releaseId, release.releaseId);
    assert.equal((await store.listAudit())[0]?.action, "restore_real");
    assert.equal((await store.listAudit())[0]?.result, "ok");
  });
});

test("a blocked real restore is refused with 409 and never audited as success", async () => {
  const store = new InMemoryDeploySystemStore();
  const release = await seedRestorableRelease(store);
  const app = buildApp(store, {
    restoreRunner: async (target) =>
      restoreResult({
        releaseId: target.releaseId,
        status: "blocked",
        verified: false,
        fileCount: 0,
        verification: { checked: 0, mismatches: [], prunedSecrets: [] },
        executedAt: null,
        detail: "أُمنعت الاستعادة قبل التنفيذ.",
        error: "توجد تغييرات محلية أو ملفات غير متتبعة.",
      }),
  });

  await withServer(app, async (base) => {
    const res = await fetch(
      `${base}/api/admin/deploy/releases/${release.releaseId}/restore`,
      { method: "POST", headers: ADMIN_HEADERS, body: JSON.stringify({ confirm: true }) },
    );
    assert.equal(res.status, 409);
    const body = (await res.json()) as any;
    assert.equal(body.code, "RESTORE_BLOCKED");
    assert.equal(body.restore.status, "blocked");
    assert.equal((await store.listAudit())[0]?.action, "restore_real");
    assert.equal((await store.listAudit())[0]?.result, "rejected");
  });
});

test("a failed real restore reports 502 and never a restored release", async () => {
  const store = new InMemoryDeploySystemStore();
  const release = await seedRestorableRelease(store);
  const app = buildApp(store, {
    restoreRunner: async (target) =>
      restoreResult({
        releaseId: target.releaseId,
        status: "failed",
        verified: false,
        fileCount: 0,
        verification: { checked: 0, mismatches: [], prunedSecrets: [] },
        detail: "فشلت الاستعادة الفعلية.",
        error: "فشل التحقق: ملف واحد لا يطابق شجرة الإصدار.",
      }),
  });

  await withServer(app, async (base) => {
    const res = await fetch(
      `${base}/api/admin/deploy/releases/${release.releaseId}/restore`,
      { method: "POST", headers: ADMIN_HEADERS, body: JSON.stringify({ confirm: true }) },
    );
    assert.equal(res.status, 502);
    const body = (await res.json()) as any;
    assert.equal(body.code, "RESTORE_FAILED");
    assert.equal(body.restore.status, "failed");
  });
});

test("a second concurrent restore is refused while one is in flight", async () => {
  const store = new InMemoryDeploySystemStore();
  const release = await seedRestorableRelease(store);
  let releaseInFlight: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    releaseInFlight = resolve;
  });
  const app = buildApp(store, {
    restoreRunner: async (target) => {
      await gate;
      return restoreResult({ releaseId: target.releaseId });
    },
  });

  await withServer(app, async (base) => {
    const url = `${base}/api/admin/deploy/releases/${release.releaseId}/restore`;
    const first = fetch(url, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ confirm: true }),
    });
    // Give the first request time to acquire the lock.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await fetch(url, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(second.status, 409);
    assert.equal(((await second.json()) as any).code, "RESTORE_IN_PROGRESS");
    releaseInFlight?.();
    const firstRes = await first;
    assert.equal(firstRes.status, 200);
  });
});

test("a storage failure never reports success (fail closed)", async () => {
  const store = new UnavailableDeploySystemStore();
  const app = buildApp(store);

  await withServer(app, async (base) => {
    const state = await fetch(`${base}/api/admin/deploy/state`, {
      headers: { "sec-fetch-site": "same-origin", "x-test-admin": "1" },
    });
    assert.equal(state.status, 200);
    const stateBody = (await state.json()) as any;
    assert.equal(stateBody.state.persistent, false);
    assert.deepEqual(stateBody.state.releases, []);

    const publish = await fetch(`${base}/api/admin/deploy/releases`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ version: "1.0.0" }),
    });
    assert.equal(publish.status, 503);
    assert.equal(((await publish.json()) as any).code, "DEPLOY_STORE_UNAVAILABLE");

    const env = await fetch(`${base}/api/admin/deploy/environment`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ environment: "TEST" }),
    });
    assert.equal(env.status, 503);

    const restore = await fetch(
      `${base}/api/admin/deploy/releases/rel-x/restore`,
      { method: "POST", headers: ADMIN_HEADERS, body: JSON.stringify({ confirm: true }) },
    );
    assert.equal(restore.status, 503);
  });
});

function checkRun(
  overrides: Partial<DeployChecks> = {},
  ranAt = "2026-01-01T00:00:00.000Z",
): DeployCheckRun {
  return {
    ranAt,
    checks: { ...PASSING_CHECKS, ...overrides },
    meta: {
      typescript: { ranAt, command: "npx tsc --noEmit", exitCode: 0 },
    },
  };
}

const STATE_HEADERS = { "sec-fetch-site": "same-origin", "x-test-admin": "1" };

test("state exposes read-only Git/GitHub context and a null latest check run by default", async () => {
  const store = new InMemoryDeploySystemStore();
  const app = buildApp(store);

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/state`, {
      headers: { "sec-fetch-site": "same-origin", "x-test-admin": "1" },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(typeof body.state.git?.readAt, "string");
    assert.equal(body.state.latestCheckRun, null);
    const text = JSON.stringify(body);
    assert.ok(!/BEGIN [A-Z ]*PRIVATE KEY/.test(text), "never leak a private key");
  });
});

test("the checks endpoint runs and stores an explicit check run", async () => {
  const store = new InMemoryDeploySystemStore();
  const ranAt = "2026-01-01T00:00:00.000Z";
  const app = buildApp(store, {
    runChecks: async () => ({
      ranAt,
      checks: { ...PASSING_CHECKS, typescript: "PASS" },
      meta: { typescript: { ranAt, command: "npx tsc --noEmit", exitCode: 0 } },
    }),
  });

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/checks`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.checkRun.checks.typescript, "PASS");
    assert.equal(body.state.latestCheckRun.ranAt, ranAt);

    const stored = await store.getLatestCheckRun();
    assert.equal(stored?.checks.secretScan, "PASS");
    assert.equal((await store.listAudit())[0]?.action, "checks_run");
  });
});

test("the checks endpoint fails closed when the store is unavailable", async () => {
  const app = buildApp(new UnavailableDeploySystemStore(), {
    runChecks: async () => ({
      ranAt: "2026-01-01T00:00:00.000Z",
      checks: { ...PASSING_CHECKS },
    }),
  });

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/checks`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 503);
    assert.equal(((await res.json()) as any).code, "DEPLOY_STORE_UNAVAILABLE");
  });
});

test("publish folds the latest stored check run but keeps the fresh secret scan", async () => {
  const store = new InMemoryDeploySystemStore();
  const ranAt = "2026-02-02T00:00:00.000Z";
  await store.recordCheckRun({
    ranAt,
    checks: { ...PASSING_CHECKS, typescript: "PASS", secretScan: "FAIL" },
    meta: { typescript: { ranAt, command: "npx tsc --noEmit", exitCode: 0 } },
  });
  const app = buildApp(store, { collectChecks: async () => passingReport() });

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/releases`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ version: "4.0.0" }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.equal(body.release.checks.typescript, "PASS");
    assert.equal(
      body.release.checks.secretScan,
      "PASS",
      "the fresh secret scan must win over the stored run",
    );
    assert.equal(body.release.checkRunAt, ranAt);
    assert.equal(body.release.checksMeta?.typescript?.command, "npx tsc --noEmit");
  });
});

test("a stored TypeScript FAIL blocks publish (never a deployed release)", async () => {
  const store = new InMemoryDeploySystemStore();
  await store.recordCheckRun({
    ranAt: "2026-03-03T00:00:00.000Z",
    checks: { ...PASSING_CHECKS, typescript: "FAIL" },
    meta: {
      typescript: {
        ranAt: "2026-03-03T00:00:00.000Z",
        command: "npx tsc --noEmit",
        exitCode: 2,
      },
    },
  });
  const app = buildApp(store);

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/releases`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ version: "5.0.0" }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.equal(body.release.status, "validation_failed");
    assert.equal(body.release.deployed, false);
    assert.equal(body.release.checks.typescript, "FAIL");
    assert.equal((await store.listAudit())[0]?.action, "publish_failed");
  });
});

test("legacy release records without the new fields still serialize safely", async () => {
  const store = new InMemoryDeploySystemStore({ seed: true });
  const app = buildApp(store);

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/state`, {
      headers: ADMIN_HEADERS,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.ok(Array.isArray(body.state.releases));
    const release = body.state.releases[0];
    assert.equal(release.github, undefined);
    assert.equal(release.worktree, undefined);
    assert.equal(release.checkRunAt, undefined);
  });
});

test("the publish route forwards approval and the client-confirmed target to the executor", async () => {
  const store = new InMemoryDeploySystemStore();
  let seen: { approval?: boolean; requestedTarget?: string | null } = {};
  const executor: DeployExecutor = {
    publish: async (input) => {
      seen = { approval: input.approval, requestedTarget: input.requestedTarget };
      return { deployed: false, savedToGit: false, detail: "sim" };
    },
    restore: async () => ({ restored: false, detail: "sim" }),
  };
  const app = buildApp(store, { executor });

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/releases`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ version: "1.0.0", approve: true, target: "rwqan-sa-dev" }),
    });
    assert.equal(res.status, 201);
    assert.equal(seen.approval, true);
    assert.equal(seen.requestedTarget, "rwqan-sa-dev");
  });
});

test("a blocked real publish is refused with 409 and audited as publish_blocked", async () => {
  const store = new InMemoryDeploySystemStore();
  const executor: DeployExecutor = {
    publish: async () => ({
      deployed: false,
      savedToGit: false,
      detail: "النشر الحقيقي يتطلب موافقة إدارية صريحة.",
      blocked: true,
      stage: "approval",
      target: "rwqan-sa-dev",
    }),
    restore: async () => ({ restored: false, detail: "sim" }),
  };
  const app = buildApp(store, { executor });

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/releases`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ version: "1.0.0" }),
    });
    assert.equal(res.status, 409);
    const body = (await res.json()) as any;
    assert.equal(body.code, "DEPLOY_BLOCKED");
    assert.equal(body.stage, "approval");
    assert.equal(await store.getRelease("nope"), undefined);
    assert.equal((await store.listReleases()).length, 0);
    assert.equal((await store.listAudit())[0]?.action, "publish_blocked");
    assert.equal((await store.listAudit())[0]?.result, "rejected");
  });
});

test("a real publish that fails at a stage reports 502 with the stage and no release", async () => {
  const store = new InMemoryDeploySystemStore();
  const executor: DeployExecutor = {
    publish: async () => ({
      deployed: false,
      savedToGit: false,
      detail: "فشل بناء الإصدار قبل النشر. (رمز الخروج: 2)",
      blocked: false,
      stage: "build",
      target: "rwqan-sa-dev",
    }),
    restore: async () => ({ restored: false, detail: "sim" }),
  };
  const app = buildApp(store, { executor });

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/releases`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ version: "1.0.0", approve: true }),
    });
    assert.equal(res.status, 502);
    const body = (await res.json()) as any;
    assert.equal(body.code, "DEPLOY_EXECUTOR_FAILED");
    assert.equal(body.stage, "build");
    assert.equal((await store.listReleases()).length, 0);
    assert.equal((await store.listAudit())[0]?.action, "publish_failed");
  });
});

test("a verified real publish is recorded with target, ref and post-deploy verification", async () => {
  const store = new InMemoryDeploySystemStore();
  const executor: DeployExecutor = {
    publish: async () => ({
      deployed: true,
      savedToGit: false,
      detail: "نشر حقيقي إلى هدف التطوير rwqan-sa-dev وتحقّق مطابقة الإصدار.",
      blocked: false,
      stage: null,
      target: "rwqan-sa-dev",
      releaseRef: "rwqan-dev-backend:abcdef0",
      verify: {
        attempted: true,
        reachable: true,
        ok: true,
        url: "https://dev.example.com/api/deploy-version",
        httpStatus: 200,
        expectedCommit: "server123",
        reportedCommit: "server123",
        reportedVersion: "1.0.0",
        match: true,
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
    }),
    restore: async () => ({ restored: false, detail: "sim" }),
  };
  const app = buildApp(store, { executor });

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/releases`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ version: "1.0.0", approve: true }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.equal(body.release.deployed, true);
    assert.equal(body.release.simulated, false);
    assert.equal(body.release.deployTarget, "rwqan-sa-dev");
    assert.equal(body.release.deployRef, "rwqan-dev-backend:abcdef0");
    assert.equal(body.release.postDeploy.ok, true);
    assert.equal(body.audit.action, "publish");
  });
});

test("a real publish whose post-deploy verification fails is never recorded as deployed", async () => {
  const store = new InMemoryDeploySystemStore();
  const executor: DeployExecutor = {
    publish: async () => ({
      deployed: true,
      savedToGit: false,
      detail: "ادعى النشر لكن التحقق فشل.",
      verify: {
        attempted: true,
        reachable: true,
        ok: false,
        url: "https://dev.example.com/api/deploy-version",
        httpStatus: 200,
        expectedCommit: "server123",
        reportedCommit: "different",
        reportedVersion: null,
        match: false,
        verifiedAt: "2026-01-01T00:00:00.000Z",
        reason: "الـcommit لا يطابق.",
      },
    }),
    restore: async () => ({ restored: false, detail: "sim" }),
  };
  const app = buildApp(store, { executor });

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/releases`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ version: "1.0.0", approve: true }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.equal(body.release.deployed, false);
    assert.equal(body.release.simulated, true);
    assert.equal(body.audit.action, "publish_simulated");
  });
});

