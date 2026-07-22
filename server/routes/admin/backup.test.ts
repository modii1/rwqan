import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import backupRouter from "./backup";
import { storage } from "../../storage";

test("backup routes require an admin session before any backup handler runs", async (t) => {
  const methodNames = [
    "getBackups",
    "getBackupById",
    "createBackup",
    "updateBackup",
    "restoreBackup",
    "deleteBackup",
    "getCodeBackups",
    "getCodeBackupById",
    "createCodeBackup",
    "deleteCodeBackup",
  ] as const;
  const originals = new Map<string, unknown>();
  let handlerCalls = 0;

  for (const methodName of methodNames) {
    originals.set(methodName, (storage as any)[methodName]);
    (storage as any)[methodName] = async () => {
      handlerCalls += 1;
      throw new Error(`Unauthorized request reached ${methodName}`);
    };
  }

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = req.get("x-admin") ? { isAdmin: true } : {};
    next();
  });
  app.use(backupRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const requests: Array<{ method: string; path: string; body?: object }> = [
      { method: "GET", path: "/api/backups" },
      { method: "GET", path: "/api/backups/backup-1" },
      {
        method: "POST",
        path: "/api/backups",
        body: { backupType: "full", backupName: "test", dataTypes: [] },
      },
      { method: "POST", path: "/api/backups/backup-1/restore", body: {} },
      { method: "DELETE", path: "/api/backups/backup-1" },
      { method: "GET", path: "/api/backups/backup-1/download" },
      { method: "GET", path: "/api/code-backup/list" },
      { method: "GET", path: "/api/code-backup/code-1" },
      { method: "POST", path: "/api/code-backup/create", body: {} },
      { method: "POST", path: "/api/code-backup/code-1/restore", body: {} },
      { method: "DELETE", path: "/api/code-backup/code-1" },
      { method: "GET", path: "/api/code-backup/code-1/download" },
    ];

    for (const request of requests) {
      await t.test(`${request.method} ${request.path}`, async () => {
        const response = await fetch(`${baseUrl}${request.path}`, {
          method: request.method,
          headers: request.body ? { "content-type": "application/json" } : undefined,
          body: request.body ? JSON.stringify(request.body) : undefined,
        });

        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { error: "Admin Login Required" });
      });
    }

    assert.equal(handlerCalls, 0);
  } finally {
    for (const [methodName, original] of originals) {
      (storage as any)[methodName] = original;
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("backup authorization does not intercept unrelated application routes", async () => {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = req.get("x-admin") ? { isAdmin: true } : {};
    next();
  });
  app.use(backupRouter);
  app.get("/public-page", (_req, res) => res.json({ ok: true }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;

  try {
    const crossOrigin = await fetch(`http://127.0.0.1:${port}/api/backups`, {
      headers: { origin: "https://evil.example", "x-admin": "1" },
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal((await crossOrigin.json()).code, "CROSS_ORIGIN_REQUEST");

    const response = await fetch(`http://127.0.0.1:${port}/public-page`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("backup list and create responses omit stored payloads", async (t) => {
  const originals = {
    getBackups: storage.getBackups,
    createBackup: storage.createBackup,
    updateBackup: storage.updateBackup,
    getCodeBackups: storage.getCodeBackups,
    createCodeBackup: storage.createCodeBackup,
  };
  const dataBackup = {
    id: "backup-1",
    backupType: "full",
    backupName: "data backup",
    status: "complete",
    dataTypes: ["requests"],
    filesCount: 1,
    sizeInMB: 0.01,
    backupData: { requests: [{ clientPhone: "0512345678" }] },
    createdAt: "2026-07-22T00:00:00.000Z",
    autoBackup: false,
  };
  const codeBackup = {
    id: "code-1",
    backupName: "code backup",
    timestamp: "2026-07-22T00:00:00.000Z",
    files: { "server/secret.ts": "sensitive source" },
    fileCount: 1,
    totalSize: 0.01,
    createdAt: "2026-07-22T00:00:00.000Z",
  };

  (storage as any).getBackups = async () => [dataBackup];
  (storage as any).createBackup = async () => dataBackup;
  (storage as any).updateBackup = async () => dataBackup;
  (storage as any).getCodeBackups = async () => [codeBackup];
  (storage as any).createCodeBackup = async () => codeBackup;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { isAdmin: true };
    next();
  });
  app.use(backupRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await t.test("data backup list and create return metadata only", async () => {
      const list = await fetch(`${baseUrl}/api/backups`);
      const listed = await list.json();
      assert.equal(list.status, 200);
      assert.equal("backupData" in listed[0], false);

      const create = await fetch(`${baseUrl}/api/backups`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ backupType: "full", backupName: "test", dataTypes: [] }),
      });
      const created = await create.json();
      assert.equal(create.status, 200);
      assert.equal("backupData" in created, false);
    });

    await t.test("code backup list and create return metadata only", async () => {
      const list = await fetch(`${baseUrl}/api/code-backup/list`);
      const listed = await list.json();
      assert.equal(list.status, 200);
      assert.equal("files" in listed[0], false);

      const create = await fetch(`${baseUrl}/api/code-backup/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const created = await create.json();
      assert.equal(create.status, 200);
      assert.equal("files" in created, false);
    });
  } finally {
    storage.getBackups = originals.getBackups;
    storage.createBackup = originals.createBackup;
    storage.updateBackup = originals.updateBackup;
    storage.getCodeBackups = originals.getCodeBackups;
    storage.createCodeBackup = originals.createCodeBackup;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
