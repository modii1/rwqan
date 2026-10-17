import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminLiveDataRouter } from "./live";
import {
  createDataEnvironmentStore,
  type DataEnvironmentStore,
} from "../../services/LiveDataEnvironmentStore";
import { dataEnvironmentStore } from "../../services/LiveDataEnvironmentStore";

const LIVE_ENV_KEYS = [
  "LIVE_DATA_READONLY_ACK",
  "LIVE_FIREBASE_PROJECT_ID",
  "LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT",
] as const;

function clearLiveEnv(): void {
  for (const key of LIVE_ENV_KEYS) delete process.env[key];
}

function setLiveEnv(): void {
  process.env.LIVE_DATA_READONLY_ACK = "read-only";
  process.env.LIVE_FIREBASE_PROJECT_ID = "rwqan-sa";
  process.env.LIVE_FIREBASE_READONLY_SERVICE_ACCOUNT = JSON.stringify({
    type: "service_account",
    project_id: "rwqan-sa",
  });
}

interface BuildOptions {
  enabled?: boolean;
  store?: DataEnvironmentStore;
}

function buildApp(options: BuildOptions = {}) {
  const store = options.store ?? createDataEnvironmentStore();
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
    createAdminLiveDataRouter({
      enabled: () => options.enabled ?? true,
      environmentStore: store,
    }),
  );
  return { app, store };
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

test("the environment switch rejects unauthenticated requests", async () => {
  const { app } = buildApp();
  await withServer(app, async (base) => {
    const status = await fetch(`${base}/api/admin/live/status`, {
      headers: { "sec-fetch-site": "same-origin" },
    });
    assert.equal(status.status, 401);

    const environment = await fetch(`${base}/api/admin/live/environment`, {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
      body: JSON.stringify({ environment: "LIVE" }),
    });
    assert.equal(environment.status, 401);
  });
});

test("cross-origin requests are rejected before reaching the handlers", async () => {
  const { app } = buildApp();
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/live/status`, {
      headers: { "sec-fetch-site": "cross-site", "x-test-admin": "1" },
    });
    assert.equal(res.status, 403);
  });
});

test("disabled runtime hides every environment endpoint", async () => {
  const { app } = buildApp({ enabled: false });
  await withServer(app, async (base) => {
    const status = await fetch(`${base}/api/admin/live/status`, { headers: ADMIN_HEADERS });
    assert.equal(status.status, 404);
    assert.equal((await status.json()).code, "LIVE_DATA_DISABLED");
  });
});

test("TEST is the default and the switch to LIVE fails closed without config", async () => {
  clearLiveEnv();
  const { app, store } = buildApp();
  await withServer(app, async (base) => {
    const status = await fetch(`${base}/api/admin/live/status`, { headers: ADMIN_HEADERS });
    const body = await status.json();
    assert.equal(body.status.environment, "TEST");
    assert.equal(body.status.liveAvailable, false);
    assert.ok(body.status.liveUnavailableReason.length > 0);
    assert.equal(body.status.writeMode, "read-only");
    assert.equal(body.status.writeBlocked, false);

    const switchAttempt = await fetch(`${base}/api/admin/live/environment`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ environment: "LIVE" }),
    });
    assert.equal(switchAttempt.status, 503);
    assert.equal(store.get(), "TEST", "the environment must not switch without config");
  });
});

test("LIVE properties are read from the PUBLIC production API (read-only)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("rwqan.sa")) {
      return originalFetch(input, init);
    }
    return new Response(
      JSON.stringify([
        {
          propertyNumber: "00001",
          name: "شاليه بيت القمر",
          city: "بريدة",
          imageUrls: ["https://pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev/00001/1.jpg"],
        },
      ]),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  try {
    const store = createDataEnvironmentStore("LIVE");
    const { app } = buildApp({ store });
    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/admin/live/properties`, {
        headers: ADMIN_HEADERS,
      });
      assert.equal(res.status, 200);
      const body = (await res.json()) as {
        environment: string;
        source: string;
        total: number;
        properties: { propertyNumber?: string }[];
      };
      assert.equal(body.environment, "LIVE");
      assert.match(body.source, /الإنتاج/);
      assert.equal(body.total, 1);
      assert.equal(body.properties[0]?.propertyNumber, "00001");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invalid environment bodies are rejected", async () => {
  const { app } = buildApp();
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/admin/live/environment`, {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({ environment: "PRODUCTION" }),
    });
    assert.equal(res.status, 400);
  });
});

test("with config, LIVE switches the whole app and TEST switches it back", async () => {
  setLiveEnv();
  try {
    const { app, store } = buildApp();
    await withServer(app, async (base) => {
      const switchToLive = await fetch(`${base}/api/admin/live/environment`, {
        method: "POST",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ environment: "LIVE" }),
      });
      assert.equal(switchToLive.status, 200);
      const liveStatus = (await switchToLive.json()).status;
      assert.equal(liveStatus.environment, "LIVE");
      assert.equal(liveStatus.liveProjectId, "rwqan-sa");
      assert.equal(liveStatus.activeProjectId, "rwqan-sa");
      assert.equal(liveStatus.writeMode, "read-only");
      assert.equal(liveStatus.writeBlocked, true);
      assert.equal(store.get(), "LIVE");

      const switchToTest = await fetch(`${base}/api/admin/live/environment`, {
        method: "POST",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ environment: "TEST" }),
      });
      assert.equal((await switchToTest.json()).status.environment, "TEST");
      assert.equal(store.get(), "TEST");
    });
  } finally {
    clearLiveEnv();
  }
});

test("the environment switch exposes no write endpoints", async () => {
  const { app } = buildApp();
  await withServer(app, async (base) => {
    for (const path of [
      "/api/admin/live/subscriptions",
      "/api/admin/live/properties/20001/images",
    ]) {
      const res = await fetch(`${base}${path}`, { headers: ADMIN_HEADERS });
      assert.equal(res.status, 404, `${path} must not exist`);
    }
  });
});

test("the shared store defaults to TEST", () => {
  assert.equal(dataEnvironmentStore.get(), "TEST");
});
