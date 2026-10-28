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
import type { DeployExecutor, DeployRestoreOutcome } from "../../services/DeployExecutor";
import type {
  DeployCheckRun,
  DeployChecks,
  DeployGitSource,
  DeployPostDeployVerification,
  DeployRelease,
  DeployRestorePreview,
  DeployToolsInfo,
} from "../../../shared/deploySystem";
import {
  DEPLOY_DEV_BACKEND_ID,
  DEPLOY_DEV_BASE_URL,
  DEPLOY_DEV_PROJECT_ID,
} from "../../config/deployTarget";
import {
  __test_setDeployCredentials,
  __test_clearAllDeployCredentials,
} from "../../services/deployAuth";

const PASSING_CHECKS: DeployChecks = {
  typescript: "NOT_RUN",
  tests: "NOT_RUN",
  build: "NOT_RUN",
  secretScan: "PASS",
  postDeployHealth: "NOT_RUN",
};

// OAuth env vars required by deploy auth check; tests that need a real
// publish path set credentials via deployAuth or skip auth by not passing
// sessionId (the route only checks auth when the executor is asked with a
// sessionId, and the route always passes req.sessionID).
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client-id";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-client-secret";
process.env.DEPLOY_AUTH_REDIRECT_URI = "https://example.com/callback";

// Store Firebase CLI credentials for the empty session ID used by the test
// fake middleware (req.sessionID is not set), so the auth check passes and
// publish tests can proceed to the executor.
__test_setDeployCredentials("", "test-refresh-token");

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

/** A reachability/source verification that passes (fail-closed tests override). */
function okVerification(): DeployPostDeployVerification {
  return {
    attempted: true,
    reachable: true,
    ok: true,
    url: "https://dev.example.com/api/deploy-version",
    httpStatus: 200,
    expectedCommit: "server123",
    reportedCommit: "server123",
    reportedVersion: null,
    match: true,
    verifiedAt: "2026-01-01T00:00:00.000Z",
  };
}

/** A stub executor that reports a fully verified real deploy. */
function deployingExecutor(
  overrides: Partial<Awaited<ReturnType<DeployExecutor["publish"]>>> = {},
): DeployExecutor {
  return {
    publish: async () => ({
      deployed: true,
      savedToGit: false,
      detail: "نشر حقيقي متحقَّق منه.",
      blocked: false,
      stage: null,
      target: "rwqan-sa-dev",
      releaseRef: "rwqan-dev-backend:abcdef0",
      verify: okVerification(),
      buildSource: {
        attempted: true,
        ok: true,
        backend: "rwqan-dev-backend",
        expectedCommit: "server123",
        reportedCommit: "server123",
        sourceKind: "codebase",
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
      ...overrides,
    }),
    restore: async () => ({ restored: false, detail: "غير مُستخدم." }),
  };
}

function buildApp(
  store: DeploySystemStoreContract,
  options: {
    enabled?: boolean;
    collectChecks?: () => Promise<DeployCheckReport>;
    runChecks?: () => Promise<DeployCheckRun>;
    executor?: DeployExecutor;
    productionDeployEnabled?: () => boolean;
    restorePreview?: (
      release: DeployRelease,
      context: DeployRestoreContext,
    ) => Promise<DeployRestorePreview>;
    resolveStableRelease?: (cwd: string) => Promise<DeployRelease | null>;
    /** Test seam: inject the deploy-tools availability (never a real probe). */
    readTools?: () => Promise<DeployToolsInfo>;
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
      productionDeployEnabled: options.productionDeployEnabled,
      restorePreview: options.restorePreview,
      // Deterministic by default: tests opt into a stable release explicitly.
      resolveStableRelease: options.resolveStableRelease ?? (async () => null),
      // Deterministic tools: explicit availability without any CLI dependence.
      readTools:
        options.readTools ??
        (async () => ({
          firebaseCliAvailable: true,
          firebaseCliVersion: "15.34.0",
          readAt: "2026-10-26T00:00:00.000Z",
        })),
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

test("publish stores a durable record with server-derived git and a verified deploy", async () => {
  const store = new InMemoryDeploySystemStore();
  const app = buildApp(store, { executor: deployingExecutor() });

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
        savedToGit: false,
        deployed: false,
      }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.equal(body.release.version, "1.2.3");
    assert.equal(body.release.changeSummary, "تعديل تجريبي");
    // Server-derived git wins; client values are ignored.
    assert.equal(body.release.gitCommit, "server123");
    assert.equal(body.release.gitBranch, "main");
    // Client cannot forge the actor; deploy truth comes from the executor only.
    assert.equal(body.release.createdBy, "admin");
    assert.equal(body.release.status, "deployed");
    assert.equal(body.release.deployed, true);
    // The stub reported savedToGit:false — the client's value never leaks in.
    assert.equal(body.release.savedToGit, false);
    assert.equal((await store.listAudit())[0]?.action, "publish");
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
  const app = buildApp(store, { executor: deployingExecutor() });

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
  const app = buildApp(store, { executor: deployingExecutor({ savedToGit: true }) });

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

test("the default executor fails closed (blocked, no release record)", async () => {
  const store = new InMemoryDeploySystemStore();
  const app = buildApp(store);

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/releases`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ version: "3.0.0" }),
    });
    assert.equal(res.status, 409);
    const body = (await res.json()) as any;
    assert.equal(body.code, "DEPLOY_BLOCKED");
    assert.equal((await store.listReleases()).length, 0);
    assert.equal((await store.listAudit())[0]?.action, "publish_blocked");
    assert.equal((await store.listAudit())[0]?.result, "rejected");
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
    // explicit confirmation the real restore refuses it (never reported as ok).
    const unsafe = await fetch(`${url}/rel-seed-0003/restore`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(unsafe.status, 409);
    assert.equal(((await unsafe.json()) as any).code, "RELEASE_SOURCE_NOT_IMMUTABLE");
    assert.equal((await store.listAudit())[0]?.action, "restore_rejected");
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
    releaseStatus: "validated",
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

/** A stub executor whose restore returns the given (real hosting) outcome. */
function restoringExecutor(
  outcome: DeployRestoreOutcome,
  gate?: Promise<void>,
): DeployExecutor {
  return {
    publish: async () => ({ deployed: false, savedToGit: false, detail: "غير مُستخدم." }),
    restore: async () => {
      if (gate) await gate;
      return outcome;
    },
  };
}

function successfulRestore(): DeployRestoreOutcome {
  return {
    restored: true,
    detail: "استعادة حقيقية عبر الاستضافة لـcommit محدد.",
    blocked: false,
    stage: null,
    target: "rwqan-sa-dev",
    releaseRef: `rwqan-dev-backend:${FAKE_SHA.slice(0, 7)}`,
    buildSource: {
      attempted: true,
      ok: true,
      backend: "rwqan-dev-backend",
      expectedCommit: FAKE_SHA,
      reportedCommit: FAKE_SHA,
      sourceKind: "codebase",
      verifiedAt: "2026-01-01T00:00:00.000Z",
    },
    verify: okVerification(),
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
  const app = buildApp(store, { executor: restoringExecutor(successfulRestore()) });

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
    // A pre-restore snapshot is saved, then the success is recorded.
    const audit = await store.listAudit();
    assert.equal(audit[0]?.action, "restore_real");
    assert.equal(audit[0]?.result, "ok");
    assert.equal(audit[1]?.action, "restore_snapshot");
  });
});

test("a blocked real restore is refused with 409 and never audited as success", async () => {
  const store = new InMemoryDeploySystemStore();
  const release = await seedRestorableRelease(store);
  const app = buildApp(store, {
    executor: restoringExecutor({
      restored: false,
      blocked: true,
      stage: "target",
      detail: "أُمنعت الاستعادة قبل التنفيذ: تغييرات محلية غير متتبعة.",
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
    assert.equal(body.stage, "target");
    const audit = await store.listAudit();
    assert.equal(audit[0]?.action, "restore_rejected");
    assert.equal(audit[0]?.result, "rejected");
  });
});

test("a failed real restore reports 502 and never a restored release", async () => {
  const store = new InMemoryDeploySystemStore();
  const release = await seedRestorableRelease(store);
  const app = buildApp(store, {
    executor: restoringExecutor({
      restored: false,
      blocked: false,
      stage: "verify",
      detail: "فشل التحقق بعد الاستعادة: SHA مُقدَّم لا يطابق الإصدار المطلوب.",
      buildSource: {
        attempted: true,
        ok: false,
        backend: "rwqan-dev-backend",
        expectedCommit: FAKE_SHA,
        reportedCommit: null,
        sourceKind: "unknown",
        verifiedAt: "2026-01-01T00:00:00.000Z",
      },
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
    assert.equal(body.stage, "verify");
    assert.equal((await store.listAudit())[0]?.action, "restore_rejected");
  });
});

test("a second concurrent restore is refused while one is in flight", async () => {
  const store = new InMemoryDeploySystemStore();
  const release = await seedRestorableRelease(store);
  let releaseInFlight: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    releaseInFlight = resolve;
  });
  const app = buildApp(store, { executor: restoringExecutor(successfulRestore(), gate) });

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

test("a LIVE-source release can be restored to TEST; a failed rollout is never faked as success", async () => {
  const store = new InMemoryDeploySystemStore();
  const stable: DeployRelease = {
    releaseId: "rel-stable-live",
    version: "النسخة المستقرة",
    environment: "LIVE",
    gitCommit: FAKE_SHA,
    gitTag: null,
    gitBranch: "main",
    sourceRepoUrl: "https://github.com/iheeb1/rwqan-sa.git",
    createdAt: "2026-09-24T22:24:23.519Z",
    createdBy: "admin",
    changeSummary: "النسخة المستقرة",
    status: "deployed",
    checks: { ...PASSING_CHECKS },
    deployTarget: "rwqan-757",
    savedToGit: true,
    deployed: true,
    simulated: false,
    stableBaseline: true,
  };
  const calls: Array<{ environment?: string; gitCommit: string }> = [];
  const executor: DeployExecutor = {
    publish: async () => {
      throw new Error("publish must not be used by a restore");
    },
    restore: async (input) => {
      calls.push({ environment: input.environment, gitCommit: input.gitCommit });
      return {
        restored: false,
        blocked: false,
        stage: "deploy",
        detail: "فشل إنشاء rollout للاستعادة على rwqan-dev-backend (رمز الخروج: 1).",
        target: "rwqan-sa-dev",
      };
    },
  };
  const app = buildApp(store, {
    executor,
    resolveStableRelease: async () => ({ ...stable }),
  });

  await withServer(app, async (base) => {
    const res = await fetch(
      `${base}/api/admin/deploy/releases/${stable.releaseId}/restore`,
      { method: "POST", headers: ADMIN_HEADERS, body: JSON.stringify({ confirm: true }) },
    );
    // The LIVE SOURCE env does not block a TEST TARGET, so the real rollout is
    // attempted — but it FAILED, so the response is a 502, never a success.
    assert.equal(res.status, 502);
    const body = (await res.json()) as any;
    assert.equal(body.code, "RESTORE_FAILED");
    assert.equal(body.restored, undefined);
    // The rollout was attempted against the TEST target only.
    assert.deepEqual(calls, [{ environment: "TEST", gitCommit: FAKE_SHA }]);
    // The failure is audited as rejected, never as a restore_real.
    const audit = await store.listAudit();
    assert.equal(audit[0]?.action, "restore_rejected");
    assert.equal(audit[0]?.result, "rejected");
    assert.equal(audit.some((entry) => entry.action === "restore_real"), false);
  });
});

test("restoring into LIVE is refused unless production is explicitly enabled", async () => {
  const store = new InMemoryDeploySystemStore();
  const release = await seedRestorableRelease(store);
  await store.setEnvironment("LIVE");
  let restoreCalls = 0;
  const executor: DeployExecutor = {
    publish: async () => {
      throw new Error("publish must not be used by a restore");
    },
    restore: async () => {
      restoreCalls += 1;
      return successfulRestore();
    },
  };
  // productionDeployEnabled defaults to false in the test app.
  const app = buildApp(store, { executor });

  await withServer(app, async (base) => {
    const res = await fetch(
      `${base}/api/admin/deploy/releases/${release.releaseId}/restore`,
      { method: "POST", headers: ADMIN_HEADERS, body: JSON.stringify({ confirm: true }) },
    );
    assert.equal(res.status, 409);
    const body = (await res.json()) as any;
    assert.equal(body.code, "LIVE_RESTORE_DISABLED");
    // No production rollout was ever attempted.
    assert.equal(restoreCalls, 0);
    assert.equal((await store.listAudit())[0]?.result, "rejected");
  });
});

test("even with production enabled, a TEST-source release is refused for a LIVE target", async () => {
  const store = new InMemoryDeploySystemStore();
  const release = await seedRestorableRelease(store); // stamped TEST source
  await store.setEnvironment("LIVE");
  let restoreCalls = 0;
  const executor: DeployExecutor = {
    publish: async () => {
      throw new Error("publish must not be used by a restore");
    },
    restore: async () => {
      restoreCalls += 1;
      return successfulRestore();
    },
  };
  const app = buildApp(store, {
    executor,
    productionDeployEnabled: () => true,
  });

  await withServer(app, async (base) => {
    const res = await fetch(
      `${base}/api/admin/deploy/releases/${release.releaseId}/restore`,
      { method: "POST", headers: ADMIN_HEADERS, body: JSON.stringify({ confirm: true }) },
    );
    assert.equal(res.status, 409);
    const body = (await res.json()) as any;
    assert.equal(body.code, "RESTORE_TARGET_SOURCE_MISMATCH");
    assert.equal(restoreCalls, 0);
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
  const app = buildApp(store, {
    collectChecks: async () => passingReport(),
    executor: deployingExecutor(),
  });

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
  let seen: {
    approval?: boolean;
    requestedTarget?: string | null;
    environment?: string;
  } = {};
  const executor: DeployExecutor = {
    publish: async (input) => {
      seen = {
        approval: input.approval,
        requestedTarget: input.requestedTarget,
        environment: input.environment,
      };
      return {
        deployed: true,
        savedToGit: false,
        detail: "نشر حقيقي متحقَّق منه.",
        blocked: false,
        stage: null,
        target: "rwqan-sa-dev",
        releaseRef: "rwqan-dev-backend:abcdef0",
        verify: okVerification(),
        buildSource: {
          attempted: true,
          ok: true,
          backend: "rwqan-dev-backend",
          expectedCommit: "server123",
          reportedCommit: "server123",
          sourceKind: "codebase",
          verifiedAt: "2026-01-01T00:00:00.000Z",
        },
      };
    },
    restore: async () => ({ restored: false, detail: "غير مُستخدم." }),
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
    assert.equal(seen.environment, "TEST");
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
  const app = buildApp(store, { executor: deployingExecutor() });

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

test("a real deploy with no explicit version carries a real (non-prototype) version", async () => {
  const store = new InMemoryDeploySystemStore();
  const app = buildApp(store, { executor: deployingExecutor() });

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/releases`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ approve: true }),
    });
    assert.equal(res.status, 201);
    const body = (await res.json()) as any;
    assert.equal(body.release.deployed, true);
    // The prototype placeholder must never label a real deploy.
    assert.notEqual(body.release.version, "0.0.0-prototype");
    assert.equal(body.release.version, "server1");
  });
});

test("state surfaces only real stable releases (old/prototype/failed hidden)", async () => {
  const store = new InMemoryDeploySystemStore({ seed: true });
  const stable = await store.createRelease({
    version: "abc1234",
    environment: "TEST",
    changeSummary: "نشر حقيقي متحقَّق منه",
    git: {
      commit: FAKE_SHA,
      branch: "main",
      tag: null,
      repoUrl: "https://github.com/iheeb1/rwqan-sa.git",
    },
    checks: { ...PASSING_CHECKS },
    deployed: true,
  });
  const seededCount = (await store.listReleases()).length;
  const app = buildApp(store);

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/state`, {
      headers: STATE_HEADERS,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    // The full history still carries the old/failed records...
    assert.equal(body.state.releases.length, seededCount);
    // ...but the restore list exposes ONLY the one real stable release.
    assert.equal(body.state.stableReleases.length, 1);
    assert.equal(body.state.stableReleases[0].releaseId, stable.releaseId);
  });
});

test("state surfaces the verified official stable release sourced from config", async () => {
  const store = new InMemoryDeploySystemStore();
  const stable: DeployRelease = {
    releaseId: "rel-stable-test",
    version: "النسخة المستقرة",
    environment: "LIVE",
    gitCommit: FAKE_SHA,
    gitTag: null,
    gitBranch: "main",
    sourceRepoUrl: "https://github.com/iheeb1/rwqan-sa.git",
    createdAt: "2026-09-24T22:24:23.519Z",
    createdBy: "admin",
    changeSummary: "النسخة المستقرة الحقيقية على الإنتاج",
    status: "deployed",
    checks: { ...PASSING_CHECKS, secretScan: "NOT_RUN" },
    gitShortSha: FAKE_SHA.slice(0, 7),
    deployTarget: "rwqan-757",
    savedToGit: true,
    deployed: true,
    simulated: false,
    stableBaseline: true,
  };
  const app = buildApp(store, { resolveStableRelease: async () => ({ ...stable }) });

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/state`, {
      headers: STATE_HEADERS,
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    // Only the verified stable release is surfaced, named as required.
    assert.equal(body.state.stableReleases.length, 1);
    assert.equal(body.state.stableReleases[0].releaseId, "rel-stable-test");
    assert.equal(body.state.stableReleases[0].version, "النسخة المستقرة");
    assert.equal(body.state.stableReleases[0].stableBaseline, true);
  });
});

test("the config-sourced stable release is resolvable for a restore preview", async () => {
  const store = new InMemoryDeploySystemStore();
  const stable: DeployRelease = {
    releaseId: "rel-stable-test",
    version: "النسخة المستقرة",
    environment: "TEST",
    gitCommit: FAKE_SHA,
    gitTag: null,
    gitBranch: "main",
    sourceRepoUrl: "https://github.com/iheeb1/rwqan-sa.git",
    createdAt: "2026-09-24T22:24:23.519Z",
    createdBy: "admin",
    changeSummary: "النسخة المستقرة",
    status: "deployed",
    checks: { ...PASSING_CHECKS },
    deployTarget: "rwqan-757",
    savedToGit: true,
    deployed: true,
    simulated: false,
    stableBaseline: true,
  };
  const previews: string[] = [];
  const app = buildApp(store, {
    resolveStableRelease: async () => ({ ...stable }),
    restorePreview: async (release) => {
      previews.push(release.releaseId);
      return {
        releaseId: release.releaseId,
        version: release.version,
        commitSha: release.gitCommit,
        shortSha: release.gitCommit.slice(0, 7),
        releaseStatus: release.status,
        environment: release.environment,
        sourceRepoUrl: release.sourceRepoUrl,
        worktree: "clean",
        shaFormatValid: true,
        commitExists: true,
        canRestore: true,
        blockers: [],
        targetPath: null,
      };
    },
  });

  await withServer(app, async (base) => {
    const res = await fetch(
      `${base}/api/admin/deploy/releases/rel-stable-test/restore/preview`,
      { method: "POST", headers: ADMIN_HEADERS, body: JSON.stringify({}) },
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.equal(body.preview.releaseId, "rel-stable-test");
    assert.deepEqual(previews, ["rel-stable-test"]);
  });
});

test("a real publish whose post-deploy verification fails is never recorded as deployed", async () => {
  const store = new InMemoryDeploySystemStore();
  const executor: DeployExecutor = {
    publish: async () => ({
      deployed: true,
      savedToGit: false,
      detail: "ادعى النشر لكن التحقق فشل.",
      blocked: false,
      stage: "verify",
      target: "rwqan-sa-dev",
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
    restore: async () => ({ restored: false, detail: "غير مُستخدم." }),
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
    assert.equal(body.code, "DEPLOY_UNVERIFIED");
    assert.equal((await store.listReleases()).length, 0);
    assert.equal((await store.listAudit())[0]?.action, "publish_failed");
    assert.equal((await store.listAudit())[0]?.result, "rejected");
  });
});

test("state exposes the gate, target location/expectedDomain, data environment and tools", async () => {
  const app = buildApp(new InMemoryDeploySystemStore({ seed: true }), {
    // DEFAULT BY BUILDAPP: `readTools` resolves before the state snapshot is
    // built, so no test needs a real CLI.
  });

  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/deploy/state`, {
      headers: { "sec-fetch-site": "same-origin", "x-test-admin": "1" },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    const state = body.state;

    // The fixed TEST target now carries the region + EXPECTED domain. Without a
    // configured DEPLOY_APP_HOSTING_LOCATION the expected domain stays null —
    // the gate must show غير متحقق, never a guessed host.
    assert.equal(state.deployTarget.projectId, DEPLOY_DEV_PROJECT_ID);
    assert.equal(state.deployTarget.backendId, DEPLOY_DEV_BACKEND_ID);
    assert.equal(state.deployTarget.location, "europe-west4");
    assert.equal(state.deployTarget.expectedDomain, DEPLOY_DEV_BASE_URL);

    // The data environment (TEST default) flows into the state.
    assert.equal(state.dataEnvironment, "TEST");

    // The three-verdict gate is present with all 12 items.
    assert.ok(
      ["ready_for_review", "blocked_by_failed_check", "unverified_missing_info"].includes(
        state.gate?.status,
      ),
    );
    const keys = (state.gate?.items ?? []).map((entry: { key: string }) => entry.key);
    for (const key of [
      "admin_permissions",
      "git_worktree",
      "commit_sha",
      "release_checks",
      "target_config",
      "real_deploy_opt_in",
      "production_opt_in",
      "apphosting_location",
      "verify_url",
      "build_source_verify",
      "firebase_cli",
      "data_isolation",
    ]) {
      assert.ok(keys.includes(key), `gate item ${key} expected`);
    }
    assert.equal(
      (state.gate?.items ?? []).find(
        (entry: { key: string }) => entry.key === "apphosting_location",
      )?.state,
      "ok",
    );
    assert.equal(
      (state.gate?.items ?? []).find(
        (entry: { key: string }) => entry.key === "data_isolation",
      )?.state,
      "ok",
    );

    // The tools probe result (injected) is exposed read-only.
    assert.equal(state.tools?.firebaseCliAvailable, true);
    assert.equal(state.tools?.firebaseCliVersion, "15.34.0");
  });
});

test("with a configured location the expected domain follows the proven convention", async () => {
  const app = buildApp(new InMemoryDeploySystemStore({ seed: true }));
  // The location comes from env; the convention is pure code, so asserting it
  // end-to-end here proves state+gate wiring without any cloud call.
  process.env.DEPLOY_APP_HOSTING_LOCATION = "europe-west1";
  try {
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/deploy/state`, {
        headers: { "sec-fetch-site": "same-origin", "x-test-admin": "1" },
      });
      assert.equal(res.status, 200);
      const state = ((await res.json()) as any).state;
      assert.equal(
        state.deployTarget.expectedDomain,
        "https://rwqan-backend--rwqan-757.europe-west1.hosted.app",
      );
      assert.equal(
        (state.gate?.items ?? []).find(
          (entry: { key: string }) => entry.key === "apphosting_location",
        )?.state,
        "ok",
      );
    });
  } finally {
    delete process.env.DEPLOY_APP_HOSTING_LOCATION;
  }
});

test("a second concurrent publish is refused with 409 DEPLOY_PUBLISH_IN_PROGRESS", async () => {
  const store = new InMemoryDeploySystemStore();
  let publishGateResolve: (() => void) | null = null;
  const firstPublishGate = new Promise<void>((resolve) => {
    publishGateResolve = resolve;
  });
  let publishCalls = 0;
  const executor: DeployExecutor = {
    publish: async () => {
      publishCalls += 1;
      await firstPublishGate;
      return {
        deployed: true,
        savedToGit: false,
        detail: "نشر حقيقي متحقَّق منه.",
        blocked: false,
        stage: null,
        target: "rwqan-sa-dev",
        releaseRef: "rwqan-dev-backend:abc",
        verify: okVerification(),
        buildSource: {
          attempted: true,
          ok: true,
          backend: "rwqan-dev-backend",
          expectedCommit: "server123",
          reportedCommit: "server123",
          sourceKind: "codebase",
          verifiedAt: "2026-01-01T00:00:00.000Z",
        },
      };
    },
    restore: async () => ({ restored: false, detail: "غير مُستخدم." }),
  };
  const app = buildApp(store, { executor });

  await withServer(app, async (base) => {
    const url = `${base}/api/admin/deploy/releases`;
    const first = fetch(url, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ approve: true, version: "p1" }),
    });
    // The first request holds the single-flight lock while its executor pends.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await fetch(url, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ approve: true, version: "p2" }),
    });
    assert.equal(second.status, 409);
    assert.equal(
      ((await second.json()) as { code: string }).code,
      "DEPLOY_PUBLISH_IN_PROGRESS",
    );
    // Release the first publish and verify it succeeds once, exactly once.
    publishGateResolve?.();
    const firstRes = await first;
    assert.equal(firstRes.status, 201);
    assert.equal(publishCalls, 1);
  });
});

test("publish refuses a client-supplied environment that conflicts with the server state", async () => {
  const store = new InMemoryDeploySystemStore(); // active environment defaults to TEST
  const app = buildApp(store, { executor: deployingExecutor() });

  await withServer(app, async (base) => {
    const url = `${base}/api/admin/deploy/releases`;

    // Client says LIVE while server state is TEST -> refused before any work.
    const mismatch = await fetch(url, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ version: "5.5.5", environment: "LIVE" }),
    });
    assert.equal(mismatch.status, 409);
    assert.equal(
      (await mismatch.json()).code,
      "DEPLOY_ENVIRONMENT_MISMATCH",
    );
    assert.equal(await store.getEnvironment(), "TEST");

    // Matching client-supplied environment proceeds.
    const match = await fetch(url, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ version: "6.6.6", environment: "TEST" }),
    });
    assert.equal(match.status, 201);
    assert.equal((await match.json()).release.environment, "TEST");

    // Omitting the environment keeps using the store's active environment.
    const omitted = await fetch(url, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ version: "7.7.7" }),
    });
    assert.equal(omitted.status, 201);
  });
});

test("publish returns 403 DEPLOY_AUTH_REQUIRED with authUrl when no Firebase CLI credentials", async () => {
  // Clear the globally-set credentials so this test simulates no auth.
  await __test_clearAllDeployCredentials();

  const store = new InMemoryDeploySystemStore({ seed: true });
  const app = buildApp(store, {
    collectChecks: async () => passingReport(),
  });

  await withServer(app, async (base) => {
    const url = `${base}/api/admin/deploy/releases`;
    const res = await fetch(url, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ version: "auth-test", approve: true }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, "DEPLOY_AUTH_REQUIRED");
    assert.ok(body.authUrl);
    assert.ok(body.authUrl.includes("accounts.google.com/o/oauth2/v2/auth"));
    assert.ok(
      body.error.includes("مصادقة Firebase CLI مطلوبة"),
      "error should be in Arabic",
    );
  });
});
