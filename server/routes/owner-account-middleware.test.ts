import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";

import express from "express";

import { ownerAccountStore } from "../services/OwnerAccountStore";
import { requireOwner } from "./middleware";

async function withServer(
  session: Record<string, unknown>,
  run: (baseUrl: string) => Promise<void>,
) {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = session;
    next();
  });
  app.get("/protected", requireOwner, (req, res) => {
    res.json({ propertyNumber: (req as any).propertyNumber });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("legacy property-number sessions remain compatible without account lookup", async () => {
  const original = ownerAccountStore.validateActiveMembership;
  let accountLookups = 0;
  (ownerAccountStore as any).validateActiveMembership = async () => {
    accountLookups += 1;
    return false;
  };
  try {
    await withServer({ propertyNumber: "12345" }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { propertyNumber: "12345" });
    });
    assert.equal(accountLookups, 0);
  } finally {
    ownerAccountStore.validateActiveMembership = original;
  }
});

test("account sessions fail closed after membership revocation", async () => {
  const original = ownerAccountStore.validateActiveMembership;
  (ownerAccountStore as any).validateActiveMembership = async () => false;
  try {
    await withServer({
      propertyNumber: "12345",
      ownerAccountId: "A".repeat(43),
      authVersion: 1,
    }, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`);
      assert.equal(response.status, 401);
    });
  } finally {
    ownerAccountStore.validateActiveMembership = original;
  }
});

test("partial account markers never downgrade to a legacy session", async () => {
  await withServer({
    propertyNumber: "12345",
    ownerAccountId: "A".repeat(43),
  }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/protected`);
    assert.equal(response.status, 401);
  });
});
