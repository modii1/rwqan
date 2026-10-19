/**
 * RWQAN — LIVE integration acceptance tests.
 *
 * Each test maps to an acceptance criterion and states its status explicitly.
 * Criteria that require PRODUCTION READ CREDENTIALS are marked BLOCKED: the
 * server refuses to switch to LIVE (fail closed) instead of silently reading
 * the wrong project, which is the safe and correct behaviour until the missing
 * configuration is supplied.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminLiveDataRouter } from "./live";
import {
  createDataEnvironmentStore,
  dataEnvironmentStore,
  type DataEnvironmentStore,
} from "../../services/LiveDataEnvironmentStore";
import {
  getActiveFirestore,
  getActiveFirestoreProjectId,
  LiveDataSourceError,
  LiveWriteBlockedError,
  setDevFirestoreForTests,
  resetDataEnvironmentForTests,
} from "../../config/dataEnvironment";
import { readLiveDataConfig } from "../../config/liveDataEnvironment";

const LIVE_ENV_KEYS = [
  "LIVE_DATA_READONLY_ACK",
  "LIVE_FIREBASE_PROJECT_ID",
  "LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT",
  "LIVE_WRITE_MODE",
  "LIVE_R2_ENDPOINT",
  "LIVE_R2_ACCESS_KEY_ID",
  "LIVE_R2_SECRET_ACCESS_KEY",
  "LIVE_R2_BUCKET_NAME",
  "LIVE_R2_PUBLIC_URL",
  "LIVE_R2_REGION",
] as const;

function clearLiveEnv(): void {
  for (const key of LIVE_ENV_KEYS) delete process.env[key];
}

/** Firestore-only LIVE config: enough to switch, but the image store is absent. */
function setLiveFirebaseEnv(): void {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  process.env.LIVE_DATA_READONLY_ACK = "read-only";
  process.env.LIVE_FIREBASE_PROJECT_ID = "rwqan-sa";
  process.env.LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT = JSON.stringify({
    type: "service_account",
    project_id: "rwqan-sa",
    private_key_id: "test-key",
    private_key: pem,
    client_email: "test@rwqan-sa.iam.gserviceaccount.com",
    client_id: "1",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
  });
}

/** Complete LIVE config: Firestore + read-only production image store. */
function setLiveEnv(): void {
  setLiveFirebaseEnv();
  process.env.LIVE_R2_ENDPOINT = "https://account.r2.cloudflarestorage.com";
  process.env.LIVE_R2_ACCESS_KEY_ID = "live-test-key";
  process.env.LIVE_R2_SECRET_ACCESS_KEY = "live-test-secret";
  process.env.LIVE_R2_BUCKET_NAME = "rwqan-live";
  process.env.LIVE_R2_PUBLIC_URL = "https://pub-live.r2.dev";
}

function buildApp(store: DataEnvironmentStore) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const hasAdmin = Boolean(req.headers["x-test-admin"]);
    (req as unknown as { session: { isAdmin?: boolean } }).session = hasAdmin
      ? { isAdmin: true }
      : {};
    next();
  });
  app.use(createAdminLiveDataRouter({ enabled: () => true, environmentStore: store }));
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

const ADMIN = {
  "content-type": "application/json",
  "sec-fetch-site": "same-origin",
  "x-test-admin": "1",
};

test.afterEach(() => {
  dataEnvironmentStore.set("TEST");
  clearLiveEnv();
  resetDataEnvironmentForTests();
});

test("AC1 — TEST reads the isolated DEV project (rwqan-sa-dev)", async () => {
  clearLiveEnv();
  const store = createDataEnvironmentStore("TEST");
  const app = buildApp(store);
  await withServer(app, async (base) => {
    const status = await (
      await fetch(`${base}/api/admin/live/status`, { headers: ADMIN })
    ).json();
    assert.equal(status.status.environment, "TEST");
    assert.equal(status.status.liveAvailable, false);
    assert.match(status.status.dataSources.properties, /rwqan-sa-dev/);
  });
  // The resolver returns the DEV Firestore in TEST mode.
  dataEnvironmentStore.set("TEST");
  clearLiveEnv();
  setDevFirestoreForTests({ collection: () => ({ doc: () => ({}) }) } as never);
  assert.doesNotThrow(() => getActiveFirestore());
  setDevFirestoreForTests(null);
});

test("AC2 — LIVE without production credentials is refused (fail closed)", async () => {
  clearLiveEnv();
  const store = createDataEnvironmentStore("TEST");
  const app = buildApp(store);
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/live/environment`, {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ environment: "LIVE" }),
    });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, "LIVE_DATA_UNAVAILABLE");
    assert.equal(store.get(), "TEST", "must not switch without credentials");
  });
  // BLOCKED: switching to LIVE cannot succeed until a production read-only
  // service account + project id are supplied as LIVE_* env vars.
  assert.equal(readLiveDataConfig().config, null);
});

test("AC2c — LIVE is refused when the production image store is unconfigured", async () => {
  clearLiveEnv();
  setLiveFirebaseEnv();
  const store = createDataEnvironmentStore("TEST");
  const app = buildApp(store);
  await withServer(app, async (base) => {
    const status = await (
      await fetch(`${base}/api/admin/live/status`, { headers: ADMIN })
    ).json();
    assert.equal(status.status.liveAvailable, true);
    assert.equal(status.status.liveImagesAvailable, false);

    const res = await fetch(`${base}/api/admin/live/environment`, {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ environment: "LIVE" }),
    });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, "LIVE_IMAGES_UNAVAILABLE");
    assert.equal(
      store.get(),
      "TEST",
      "must not switch without the production image store",
    );
  });
});

test("AC2b — LIVE read guard is real (writes rejected in-process)", async () => {
  setLiveEnv();
  dataEnvironmentStore.set("LIVE");
  const firestore = getActiveFirestore();
  try {
    await firestore.collection("properties").doc("1").set({});
    assert.fail("expected the write to be blocked");
  } catch (error: unknown) {
    assert.ok(error instanceof LiveWriteBlockedError);
  }
  dataEnvironmentStore.set("TEST");
});

test("AC6 — the failing request is identified (reason surfaced, no fallback)", async () => {
  clearLiveEnv();
  dataEnvironmentStore.set("LIVE");
  assert.throws(() => getActiveFirestore(), LiveDataSourceError);
  const { reason } = readLiveDataConfig();
  assert.ok(reason.length > 0, "the exact missing requirement is reported");
});

test("AC7 — returning to TEST restores the DEV source", async () => {
  setLiveEnv();
  const store = createDataEnvironmentStore("TEST");
  const app = buildApp(store);
  await withServer(app, async (base) => {
    await fetch(`${base}/api/admin/live/environment`, {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ environment: "LIVE" }),
    });
    assert.equal(store.get(), "LIVE");
    const back = await fetch(`${base}/api/admin/live/environment`, {
      method: "POST",
      headers: ADMIN,
      body: JSON.stringify({ environment: "TEST" }),
    });
    assert.equal((await back.json()).status.environment, "TEST");
    assert.equal(store.get(), "TEST");
  });
  dataEnvironmentStore.set("TEST");
});

test("AC8 — unauthenticated and cross-origin access is rejected", async () => {
  const store = createDataEnvironmentStore("TEST");
  const app = buildApp(store);
  await withServer(app, async (base) => {
    const unauth = await fetch(`${base}/api/admin/live/status`, {
      headers: { "sec-fetch-site": "same-origin" },
    });
    assert.equal(unauth.status, 401);

    const crossOrigin = await fetch(`${base}/api/admin/live/status`, {
      headers: { "sec-fetch-site": "cross-site", "x-test-admin": "1" },
    });
    assert.equal(crossOrigin.status, 403);
  });
});

test("AC9 — the environment surface exposes no write/payment/notification path", async () => {
  const store = createDataEnvironmentStore("TEST");
  const app = buildApp(store);
  await withServer(app, async (base) => {
    for (const path of [
      "/api/admin/live/subscriptions",
      "/api/admin/live/properties/1/images",
    ]) {
      const res = await fetch(`${base}${path}`, { headers: ADMIN });
      assert.equal(res.status, 404, `${path} must not exist`);
    }
  });
});

test("AC3/4/5 — BLOCKED: production properties/images/subscriptions need credentials", () => {
  // These criteria require a real production read-only connection. Without the
  // LIVE_* credentials the server refuses to switch (AC2), so the original
  // property pages cannot show production data yet. This assertion documents
  // the blocker rather than claiming success.
  clearLiveEnv();
  assert.equal(readLiveDataConfig().config, null);
  assert.equal(
    getActiveFirestoreProjectId(dataEnvironmentStore),
    null,
    "no production project is configured",
  );
});
