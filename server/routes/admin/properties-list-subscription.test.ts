import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";

import { firebaseService } from "../../firebaseService";
import { propertyService } from "../../services";
import propertiesRouter from "./properties";

test("admin property list uses the canonical subscription when legacy duplicates exist", async () => {
  const originalGetAll = propertyService.getAll;
  const originalGetSubscriptions = firebaseService.getSubscriptions;
  const originalGetMultiPropertySubscriptions =
    firebaseService.getMultiPropertySubscriptions;

  (propertyService as any).getAll = async () => [
    { propertyNumber: "DUP-1", name: "Duplicate property" },
  ];
  (firebaseService as any).getSubscriptions = async () => [
    {
      id: "LEGACY-DUP-1",
      propertyNumber: "DUP-1",
      packageId: "legacy",
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2031-01-01T00:00:00.000Z",
      status: "active",
      subscriptionType: "premium",
    },
    {
      id: "SUB-DUP-1",
      propertyNumber: "DUP-1",
      packageId: "current",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2030-01-01T00:00:00.000Z",
      status: "suspended",
      subscriptionType: "premium",
      suspendedAt: "2026-07-20T00:00:00.000Z",
      remainingDurationMs: 864000000,
    },
  ];
  (firebaseService as any).getMultiPropertySubscriptions = async () => [];

  const app = express();
  app.use(propertiesRouter);
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${port}/api/admin/properties`,
    );
    const properties = await response.json();

    assert.equal(response.status, 200);
    assert.equal(properties.length, 1);
    assert.equal(properties[0].subscriptionStatus, "suspended");
    assert.equal(properties[0].isSubscriptionExpired, false);
    assert.equal(properties[0].isPremiumActive, false);
  } finally {
    propertyService.getAll = originalGetAll;
    firebaseService.getSubscriptions = originalGetSubscriptions;
    firebaseService.getMultiPropertySubscriptions =
      originalGetMultiPropertySubscriptions;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
