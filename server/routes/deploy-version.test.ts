import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { createDeployVersionRouter } from "./deploy-version";
import { DEPLOY_PROTOTYPE_VERSION } from "../../shared/deploySystem";

const SHA = "c".repeat(40);
const FIXED_NOW = () => new Date("2026-01-01T00:00:00.000Z");

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

function appWith(projectId: string | null, commit: string | null): express.Express {
  const app = express();
  app.use(
    createDeployVersionRouter({
      projectId: () => projectId,
      now: FIXED_NOW,
      resolveInfo: async () => ({
        commit,
        version: DEPLOY_PROTOTYPE_VERSION,
        commitSource: commit ? "env" : "unknown",
        versionSource: "default",
      }),
    }),
  );
  return app;
}

test("serves the running version on the isolated DEV project", async () => {
  await withServer(appWith("rwqan-sa-dev", SHA), async (base) => {
    const res = await fetch(`${base}/api/deploy-version`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store, private");
    const body = (await res.json()) as { commit: string; version: string };
    assert.equal(body.commit, SHA);
    assert.equal(body.version, DEPLOY_PROTOTYPE_VERSION);
  });
});

test("is not served on the production project", async () => {
  await withServer(appWith("rwqan-757", SHA), async (base) => {
    const res = await fetch(`${base}/api/deploy-version`);
    assert.equal(res.status, 404);
  });
});

test("is not served when the project cannot be identified", async () => {
  await withServer(appWith(null, SHA), async (base) => {
    const res = await fetch(`${base}/api/deploy-version`);
    assert.equal(res.status, 404);
  });
});

test("ignores client-supplied commit/version values entirely", async () => {
  await withServer(appWith("rwqan-sa-dev", SHA), async (base) => {
    const res = await fetch(
      `${base}/api/deploy-version?commit=${"d".repeat(40)}&version=9.9.9`,
    );
    const body = (await res.json()) as { commit: string; version: string };
    assert.equal(body.commit, SHA);
    assert.equal(body.version, DEPLOY_PROTOTYPE_VERSION);
  });
});

test("reports an unverifiable commit as null (the probe then fails closed)", async () => {
  await withServer(appWith("rwqan-sa-dev", null), async (base) => {
    const res = await fetch(`${base}/api/deploy-version`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { commit: string | null };
    assert.equal(body.commit, null);
  });
});
